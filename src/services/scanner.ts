import type { OptionPosition, ScoringWeights, ScanProgress, ScanFilter } from '../types';
import type { PositionScore } from '../types';
import { DEFAULT_SCAN_FILTER } from '../types';
import {
  getQuote, getOptionChain, getExpirations,
  resetRequestCount, getCreditCount, BudgetExceededError, enforceBudget,
  setCreditCategory,
} from './marketdata';
import type { MDOption } from './marketdata';
import { filterMDChain, mdChainToPositions } from './adapter';
import { resolveIVRank, getCachedIVData, setCachedIVRank } from './ivRank';
import { hasQuoteCached, hasChainCached, chainCacheKey, getCachedExpirations } from './marketdataCache';
import { getRemainingCredits } from './creditLedger';
import { bearishStructureVeto } from './history';
import { scorePosition, calcAnnualizedYield } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

export interface ScanResult {
  top: ScanCandidate[];
  bestCSPByTicker: ScanCandidate[];
  bestCCByTicker: ScanCandidate[];
  degradedToCacheOnly: boolean;
  creditsUsed: number;
  vetoedTickers: string[];
}

const SCAN_DELAY_MS = 700;
const MAX_EXPIRATIONS_PER_TICKER = 3;
// NOTE: per-ticker candidate cap is now implicit — 1 best CSP + 1 best CC
// per ticker. Applying a combined cap made CSPs consistently evict CCs
// in low-vol markets.
//
// Budgets are in CREDITS (MarketData bills 1 per option symbol returned:
// a chain fetch with strikeLimit 20 costs ~20 credits). A full ticker is
// quote(1) + expirations(1) + 3 expirations × 2 sides × ~20 ≈ 125 credits.
const MAX_CREDITS_PER_TICKER = 150;
export const DEFAULT_SCAN_CREDITS = 8000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dteFromDate(iso: string): number {
  const exp = new Date(iso + 'T16:00:00');
  return Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function pickExpirations(expirations: string[], minDTE: number, maxDTE: number): string[] {
  const midpoint = (minDTE + maxDTE) / 2;
  const eligible = expirations
    .map((exp) => ({ exp, dte: dteFromDate(exp) }))
    .filter(({ dte }) => dte >= minDTE && dte <= maxDTE);

  eligible.sort((a, b) => Math.abs(a.dte - midpoint) - Math.abs(b.dte - midpoint));
  const selected = eligible.slice(0, MAX_EXPIRATIONS_PER_TICKER).map((e) => e.exp);
  selected.sort((a, b) => dteFromDate(a) - dteFromDate(b));
  return selected;
}

export async function scanForIdeas(
  universe: string[],
  weights: ScoringWeights,
  onProgress: (progress: ScanProgress) => void,
  marketDataToken?: string,
  scanFilter: ScanFilter = DEFAULT_SCAN_FILTER,
  creditBudget?: number,
): Promise<ScanResult> {
  resetRequestCount();
  setCreditCategory('shortScan');
  // Per-scan credit cap: the caller's allocation, bounded by what's left of
  // the daily budget. When it runs out the scan DOESN'T fail — it degrades
  // to cached-only data for the remaining tickers.
  const scanCredits = Math.max(0, Math.min(creditBudget ?? DEFAULT_SCAN_CREDITS, getRemainingCredits()));
  let cacheOnly = scanCredits === 0;
  const all: ScanCandidate[] = [];
  const vetoedTickers: string[] = [];
  const total = universe.length;
  const midpointDTE = (scanFilter.minDTE + scanFilter.maxDTE) / 2;

  const emit = (partial: Partial<ScanProgress>) => {
    onProgress({
      phase: 'fetching',
      current: 0,
      total,
      currentTicker: '',
      message: '',
      requestsUsed: getCreditCount(),
      requestBudget: scanCredits,
      ...partial,
    });
  };

  emit({ phase: 'fetching', message: cacheOnly ? 'Daily credit budget exhausted — serving from cache only...' : 'Starting scan...' });

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];

    if (!cacheOnly && getCreditCount() >= scanCredits) {
      cacheOnly = true;
    }

    // CSP trend veto (research finding: pure-IVR ranking adversely selects
    // breaking-down names). Only applies when cached history exists.
    const veto = bearishStructureVeto(ticker);
    const cspVetoed = veto?.vetoed === true;
    if (cspVetoed) vetoedTickers.push(`${ticker} (${veto!.reason})`);

    emit({
      phase: 'fetching',
      current: i + 1,
      currentTicker: ticker,
      message: cacheOnly
        ? `Credit budget reached — ${ticker} from cache only (${i + 1}/${total})`
        : `Scanning ${ticker} (${i + 1}/${total})`,
    });

    const creditsBeforeTicker = getCreditCount();
    const creditsThisTicker = () => getCreditCount() - creditsBeforeTicker;

    // Pre-check cache status for skip-delay decision
    let allCached = false;
    const cachedExps = getCachedExpirations(ticker);
    if (hasQuoteCached(ticker) && cachedExps) {
      const selectedExps = pickExpirations(cachedExps, scanFilter.minDTE, scanFilter.maxDTE);
      if (selectedExps.length > 0) {
        allCached = selectedExps.every((exp) =>
          hasChainCached(chainCacheKey(ticker, { expiration: exp, side: 'put', strikeLimit: 20 }))
          && hasChainCached(chainCacheKey(ticker, { expiration: exp, side: 'call', strikeLimit: 20 }))
        );
      }
    }

    try {
      // In cache-only mode, skip any ticker whose data isn't fully cached
      // (cache reads cost nothing; fetches would blow the budget).
      if (cacheOnly && !allCached) continue;
      if (!cacheOnly) enforceBudget(scanCredits);

      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || 0;
      if (!price) continue;
      if (creditsThisTicker() >= MAX_CREDITS_PER_TICKER) continue;

      const expirations = await getExpirations(ticker, marketDataToken);
      const selectedExps = pickExpirations(expirations, scanFilter.minDTE, scanFilter.maxDTE);
      if (selectedExps.length === 0) continue;
      if (creditsThisTicker() >= MAX_CREDITS_PER_TICKER) continue;

      // Bound the chain fetches to what fits in the per-ticker credit budget
      // (each side-chain fetch costs ~strikeLimit = 20 credits).
      const remainingBudget = MAX_CREDITS_PER_TICKER - creditsThisTicker();
      const maxExpirationsWeCanAfford = Math.max(1, Math.floor(remainingBudget / 40));
      const boundedExps = selectedExps.slice(0, maxExpirationsWeCanAfford);

      // Use allSettled so a single failure (rate-limit, delisted, 4xx)
      // doesn't wipe out the other strategies/expirations we fetched in
      // parallel. Failed fetches produce empty chains; successful ones
      // are processed normally.
      const fetchPromises = boundedExps.flatMap((exp) => [
        getOptionChain(ticker, marketDataToken, { expiration: exp, side: 'put', strikeLimit: 20 }),
        getOptionChain(ticker, marketDataToken, { expiration: exp, side: 'call', strikeLimit: 20 }),
      ]);
      const settled = await Promise.allSettled(fetchPromises);
      const results: MDOption[][] = settled.map((s) => s.status === 'fulfilled' ? s.value : []);

      const failures = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
      if (failures.length > 0) {
        console.debug(`[scanner:${ticker}] ${failures.length}/${settled.length} chain fetches failed:`, failures.map((f) => String(f.reason).substring(0, 100)));
      }

      const chainsByExp = boundedExps.map((exp, idx) => ({
        expiration: exp,
        puts: results[idx * 2],
        calls: results[idx * 2 + 1],
      }));

      const cachedIV = getCachedIVData(ticker);
      let ivRank = cachedIV?.ivRank ?? null;
      let atmIV = cachedIV?.atmIV;
      let medianIV = cachedIV?.medianIV;
      if (ivRank === null) {
        const closest = [...chainsByExp].sort(
          (a, b) => Math.abs(dteFromDate(a.expiration) - midpointDTE) - Math.abs(dteFromDate(b.expiration) - midpointDTE),
        )[0];
        const blend = closest ? [...closest.puts, ...closest.calls] : [];
        if (blend.length > 0) {
          // resolveIVRank records today's ATM-IV sample and returns the true
          // historical percentile once enough samples exist (smile-shape
          // estimate as a labeled fallback before that).
          const ivData = resolveIVRank(ticker, blend, price);
          ivRank = ivData.ivRank;
          atmIV = ivData.atmIV;
          medianIV = ivData.medianIV;
          setCachedIVRank(ticker, ivRank, atmIV, medianIV);
        } else {
          ivRank = 50;
        }
      }

      // Event-kink detection: front-expiration ATM IV > next expiration's by
      // 8+ vol pts ⇒ the chain is pricing a binary event (likely earnings)
      // inside the window. Needs at least two expirations with data.
      const atmIVForExp = (opts: MDOption[]): number => {
        let best = 0; let bestDist = Infinity;
        for (const o of opts) {
          if (!(o.iv > 0)) continue;
          const dist = Math.abs(o.strike - price);
          if (dist < bestDist) { bestDist = dist; best = o.iv; }
        }
        return best;
      };
      let eventKink: boolean | undefined;
      const expIVs = chainsByExp
        .map((c) => ({ dte: dteFromDate(c.expiration), iv: atmIVForExp([...c.puts, ...c.calls]) }))
        .filter((x) => x.iv > 0)
        .sort((a, b) => a.dte - b.dte);
      if (expIVs.length >= 2) {
        eventKink = expIVs[0].iv - expIVs[1].iv > 0.08;
      }

      const tickerCandidates: ScanCandidate[] = [];
      for (const { puts, calls } of chainsByExp) {
        if (puts.length === 0 && calls.length === 0) continue;

        if (!cspVetoed) {
          const cspFiltered = filterMDChain(puts, quote, {
            strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40,
            minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
            minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
          });
          const cspPositions = mdChainToPositions(cspFiltered, quote, 'CSP', ivRank, '', atmIV, medianIV)
            .map((pos) => ({ ...pos, eventKink }));
          const cspScored = cspPositions
            .map((pos) => ({ position: pos, score: scorePosition(pos, weights) }))
            .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
          if (cspScored[0]) tickerCandidates.push(cspScored[0]);
        }

        const ccFiltered = filterMDChain(calls, quote, {
          strategy: 'CC', minDelta: 0.10, maxDelta: 0.40,
          minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
          minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
        });
        const ccPositions = mdChainToPositions(ccFiltered, quote, 'CC', ivRank, '', atmIV, medianIV)
          .map((pos) => ({ ...pos, eventKink }));
        const ccScored = ccPositions
          .map((pos) => ({ position: pos, score: scorePosition(pos, weights) }))
          .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
        if (ccScored[0]) tickerCandidates.push(ccScored[0]);
      }

      // Keep the single best CSP and single best CC per ticker.
      // Previously we took the top 2 by composite score globally across
      // strategies for this ticker, which in low-vol uptrending markets
      // almost always selected 2 CSPs and dropped CCs entirely — wiping
      // out the CC-per-ticker downstream view.
      const bestCSP = tickerCandidates
        .filter((c) => c.position.strategy === 'CSP')
        .sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];
      const bestCC = tickerCandidates
        .filter((c) => c.position.strategy === 'CC')
        .sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];
      if (bestCSP) all.push(bestCSP);
      if (bestCC) all.push(bestCC);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        // Don't fail the scan — degrade to cached-only for the remainder.
        cacheOnly = true;
        continue;
      }
      // Skip tickers that fail for other reasons
    }

    if (!allCached && i < universe.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  emit({ phase: 'scoring', current: total, message: 'Ranking candidates...' });

  const allCSPCount = all.filter((c) => c.position.strategy === 'CSP').length;
  const allCCCount = all.filter((c) => c.position.strategy === 'CC').length;
  const uniqueTickers = new Set(all.map((c) => c.position.ticker));
  console.debug('[scanner] post-loop pool:', {
    tickersScanned: universe.length,
    candidatesTotal: all.length,
    csps: allCSPCount,
    ccs: allCCCount,
    uniqueTickers: uniqueTickers.size,
    creditsUsed: getCreditCount(),
    creditBudget: scanCredits,
    degradedToCacheOnly: cacheOnly,
    cspTrendVetoes: vetoedTickers,
  });

  // Sort the full candidate pool once by composite score
  all.sort((a, b) => b.score.compositeScore - a.score.compositeScore);

  // Top-15 table: prefer yield-filtered candidates, but backfill from the
  // full pool if the user's yield threshold leaves us with fewer than 15
  // so the "top 15 ideas" invariant always holds.
  const yieldFiltered = all.filter(
    (c) => calcAnnualizedYield(c.position) >= scanFilter.minAnnualYield,
  );
  const top: ScanCandidate[] = [...yieldFiltered.slice(0, 15)];
  if (top.length < 15) {
    const topIds = new Set(top.map((c) => c.position.id));
    for (const c of all) {
      if (top.length >= 15) break;
      if (!topIds.has(c.position.id)) {
        top.push(c);
        topIds.add(c.position.id);
      }
    }
  }

  // Per-ticker tables: iterate the FULL pool (not yield-filtered) so we
  // always surface the best available CSP/CC per ticker regardless of
  // the user's yield threshold, which is specific to the top table.
  const bestCSPByTicker = new Map<string, ScanCandidate>();
  const bestCCByTicker = new Map<string, ScanCandidate>();
  for (const c of all) {
    const ticker = c.position.ticker;
    if (c.position.strategy === 'CSP') {
      const existing = bestCSPByTicker.get(ticker);
      if (!existing || c.score.compositeScore > existing.score.compositeScore) {
        bestCSPByTicker.set(ticker, c);
      }
    } else {
      const existing = bestCCByTicker.get(ticker);
      if (!existing || c.score.compositeScore > existing.score.compositeScore) {
        bestCCByTicker.set(ticker, c);
      }
    }
  }

  return {
    top,
    bestCSPByTicker: [...bestCSPByTicker.values()].sort((a, b) => b.score.compositeScore - a.score.compositeScore),
    bestCCByTicker: [...bestCCByTicker.values()].sort((a, b) => b.score.compositeScore - a.score.compositeScore),
    degradedToCacheOnly: cacheOnly,
    creditsUsed: getCreditCount(),
    vetoedTickers,
  };
}
