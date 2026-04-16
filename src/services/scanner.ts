import type { OptionPosition, ScoringWeights, ScanProgress, ScanFilter } from '../types';
import type { PositionScore } from '../types';
import { DEFAULT_SCAN_FILTER } from '../types';
import {
  getQuote, getOptionChain, getExpirations,
  resetRequestCount, getRequestCount, BudgetExceededError, enforceBudget,
} from './marketdata';
import type { MDOption } from './marketdata';
import { filterMDChain, mdChainToPositions } from './adapter';
import { estimateIVRankFromChain, getCachedIVData, setCachedIVRank } from './ivRank';
import { hasQuoteCached, hasChainCached, chainCacheKey, getCachedExpirations } from './marketdataCache';
import { scorePosition, calcAnnualizedYield } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

export interface ScanResult {
  top: ScanCandidate[];
  bestCSPByTicker: ScanCandidate[];
  bestCCByTicker: ScanCandidate[];
}

const SCAN_DELAY_MS = 700;
const MAX_EXPIRATIONS_PER_TICKER = 3;
// NOTE: per-ticker candidate cap is now implicit — 1 best CSP + 1 best CC
// per ticker. Applying a combined cap made CSPs consistently evict CCs
// in low-vol markets.
const MAX_REQUESTS_PER_TICKER = 50;
const MAX_TOTAL_REQUESTS = 2000;

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
): Promise<ScanResult> {
  resetRequestCount();
  const all: ScanCandidate[] = [];
  const total = universe.length;
  const midpointDTE = (scanFilter.minDTE + scanFilter.maxDTE) / 2;

  const emit = (partial: Partial<ScanProgress>) => {
    onProgress({
      phase: 'fetching',
      current: 0,
      total,
      currentTicker: '',
      message: '',
      requestsUsed: getRequestCount(),
      requestBudget: MAX_TOTAL_REQUESTS,
      ...partial,
    });
  };

  emit({ phase: 'fetching', message: 'Starting scan...' });

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];

    // Global budget check
    if (getRequestCount() >= MAX_TOTAL_REQUESTS) {
      emit({
        phase: 'error',
        current: i,
        currentTicker: ticker,
        message: `Total request budget reached (${MAX_TOTAL_REQUESTS}). Stopping scan.`,
      });
      break;
    }

    emit({
      phase: 'fetching',
      current: i + 1,
      currentTicker: ticker,
      message: `Scanning ${ticker} (${i + 1}/${total})`,
    });

    const requestsBeforeTicker = getRequestCount();
    const requestsThisTicker = () => getRequestCount() - requestsBeforeTicker;

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
      enforceBudget(MAX_TOTAL_REQUESTS);

      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || 0;
      if (!price) continue;
      if (requestsThisTicker() >= MAX_REQUESTS_PER_TICKER) continue;

      const expirations = await getExpirations(ticker, marketDataToken);
      const selectedExps = pickExpirations(expirations, scanFilter.minDTE, scanFilter.maxDTE);
      if (selectedExps.length === 0) continue;
      if (requestsThisTicker() >= MAX_REQUESTS_PER_TICKER) continue;

      // Bound the chain fetches to what fits in the per-ticker budget
      const remainingBudget = MAX_REQUESTS_PER_TICKER - requestsThisTicker();
      const maxExpirationsWeCanAfford = Math.max(1, Math.floor(remainingBudget / 2));
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
          const ivData = estimateIVRankFromChain(blend, price);
          ivRank = ivData.ivRank;
          atmIV = ivData.atmIV;
          medianIV = ivData.medianIV;
          setCachedIVRank(ticker, ivRank, atmIV, medianIV);
        } else {
          ivRank = 50;
        }
      }

      const tickerCandidates: ScanCandidate[] = [];
      for (const { puts, calls } of chainsByExp) {
        if (puts.length === 0 && calls.length === 0) continue;

        const cspFiltered = filterMDChain(puts, quote, {
          strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40,
          minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
          minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
        });
        const cspPositions = mdChainToPositions(cspFiltered, quote, 'CSP', ivRank, '', atmIV, medianIV);
        const cspScored = cspPositions
          .map((pos) => ({ position: pos, score: scorePosition(pos, weights) }))
          .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
        if (cspScored[0]) tickerCandidates.push(cspScored[0]);

        const ccFiltered = filterMDChain(calls, quote, {
          strategy: 'CC', minDelta: 0.10, maxDelta: 0.40,
          minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
          minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
        });
        const ccPositions = mdChainToPositions(ccFiltered, quote, 'CC', ivRank, '', atmIV, medianIV);
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
        emit({
          phase: 'error',
          current: i,
          currentTicker: ticker,
          message: `Total request budget reached (${MAX_TOTAL_REQUESTS}). Stopping scan.`,
        });
        break;
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
    apiRequestsUsed: getRequestCount(),
    budgetLimit: MAX_TOTAL_REQUESTS,
    budgetExhausted: getRequestCount() >= MAX_TOTAL_REQUESTS,
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
  };
}
