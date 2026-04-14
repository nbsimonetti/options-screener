import type { OptionPosition, ScoringWeights, ScanProgress, ScanFilter } from '../types';
import type { PositionScore } from '../types';
import { DEFAULT_SCAN_FILTER } from '../types';
import { getQuote, getOptionChain, getExpirations } from './marketdata';
import { filterMDChain, mdChainToPositions } from './adapter';
import { estimateIVRankFromChain, getCachedIVRank, setCachedIVRank } from './ivRank';
import { hasQuoteCached, hasChainCached, chainCacheKey, getCachedExpirations } from './marketdataCache';
import { scorePosition, calcAnnualizedYield } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

const SCAN_DELAY_MS = 700;
const MAX_EXPIRATIONS_PER_TICKER = 3;
const MAX_CANDIDATES_PER_TICKER = 2;

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

  // Pick the N closest to the midpoint
  eligible.sort((a, b) => Math.abs(a.dte - midpoint) - Math.abs(b.dte - midpoint));
  const selected = eligible.slice(0, MAX_EXPIRATIONS_PER_TICKER).map((e) => e.exp);

  // Sort by DTE ascending for deterministic iteration order
  selected.sort((a, b) => dteFromDate(a) - dteFromDate(b));
  return selected;
}

export async function scanForIdeas(
  universe: string[],
  weights: ScoringWeights,
  onProgress: (progress: ScanProgress) => void,
  marketDataToken?: string,
  scanFilter: ScanFilter = DEFAULT_SCAN_FILTER,
): Promise<ScanCandidate[]> {
  const all: ScanCandidate[] = [];
  const total = universe.length;
  const midpointDTE = (scanFilter.minDTE + scanFilter.maxDTE) / 2;

  onProgress({ phase: 'fetching', current: 0, total, currentTicker: '', message: 'Starting scan...' });

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];
    onProgress({
      phase: 'fetching',
      current: i + 1,
      total,
      currentTicker: ticker,
      message: `Scanning ${ticker} (${i + 1}/${total})`,
    });

    // Pre-check cache status to decide whether to skip the delay
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
      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || 0;
      if (!price) continue;

      const expirations = await getExpirations(ticker, marketDataToken);
      const selectedExps = pickExpirations(expirations, scanFilter.minDTE, scanFilter.maxDTE);
      if (selectedExps.length === 0) continue;

      // Fire off all chain fetches in parallel
      const fetchPromises = selectedExps.flatMap((exp) => [
        getOptionChain(ticker, marketDataToken, { expiration: exp, side: 'put', strikeLimit: 20 }),
        getOptionChain(ticker, marketDataToken, { expiration: exp, side: 'call', strikeLimit: 20 }),
      ]);
      const results = await Promise.all(fetchPromises);

      // Split back into per-expiration { puts, calls }
      const chainsByExp = selectedExps.map((exp, idx) => ({
        expiration: exp,
        puts: results[idx * 2],
        calls: results[idx * 2 + 1],
      }));

      // Compute IV rank from the expiration closest to the DTE midpoint
      let ivRank = getCachedIVRank(ticker);
      if (ivRank === null) {
        const closest = [...chainsByExp].sort(
          (a, b) => Math.abs(dteFromDate(a.expiration) - midpointDTE) - Math.abs(dteFromDate(b.expiration) - midpointDTE),
        )[0];
        const blend = [...closest.puts, ...closest.calls];
        if (blend.length > 0) {
          ivRank = estimateIVRankFromChain(blend, price);
          setCachedIVRank(ticker, ivRank);
        } else {
          ivRank = 50;
        }
      }

      // Score each expiration's best CSP and best CC
      const tickerCandidates: ScanCandidate[] = [];
      for (const { puts, calls } of chainsByExp) {
        if (puts.length === 0 && calls.length === 0) continue;

        const cspFiltered = filterMDChain(puts, quote, {
          strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40,
          minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
          minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
        });
        const cspPositions = mdChainToPositions(cspFiltered, quote, 'CSP', ivRank, '');
        const cspScored = cspPositions
          .map((pos) => ({ position: pos, score: scorePosition(pos, weights) }))
          .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
        if (cspScored[0]) tickerCandidates.push(cspScored[0]);

        const ccFiltered = filterMDChain(calls, quote, {
          strategy: 'CC', minDelta: 0.10, maxDelta: 0.40,
          minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
          minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
        });
        const ccPositions = mdChainToPositions(ccFiltered, quote, 'CC', ivRank, '');
        const ccScored = ccPositions
          .map((pos) => ({ position: pos, score: scorePosition(pos, weights) }))
          .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
        if (ccScored[0]) tickerCandidates.push(ccScored[0]);
      }

      // Cap candidates per ticker to avoid one ticker dominating results
      tickerCandidates.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
      all.push(...tickerCandidates.slice(0, MAX_CANDIDATES_PER_TICKER));
    } catch {
      // Skip tickers that fail
    }

    if (!allCached && i < universe.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  onProgress({ phase: 'scoring', current: total, total, currentTicker: '', message: 'Ranking candidates...' });

  const yieldFiltered = all.filter(
    (c) => calcAnnualizedYield(c.position) >= scanFilter.minAnnualYield,
  );

  yieldFiltered.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  return yieldFiltered.slice(0, 15);
}
