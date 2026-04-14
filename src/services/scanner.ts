import type { OptionPosition, ScoringWeights, ScanProgress, ScanFilter } from '../types';
import type { PositionScore } from '../types';
import { DEFAULT_SCAN_FILTER } from '../types';
import { getQuote, getOptionChain } from './marketdata';
import { filterMDChain, mdChainToPositions } from './adapter';
import { estimateIVRankFromChain, getCachedIVRank, setCachedIVRank } from './ivRank';
import { hasQuoteCached, hasChainCached, chainCacheKey } from './marketdataCache';
import { scorePosition, calcAnnualizedYield } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

const SCAN_DELAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  const targetDTE = Math.round((scanFilter.minDTE + scanFilter.maxDTE) / 2);

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

    // Pre-check cache for this ticker's required data
    const putKey = chainCacheKey(ticker, { dte: targetDTE, side: 'put', strikeLimit: 20 });
    const callKey = chainCacheKey(ticker, { dte: targetDTE, side: 'call', strikeLimit: 20 });
    const allCached = hasQuoteCached(ticker) && hasChainCached(putKey) && hasChainCached(callKey);

    try {
      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || 0;
      if (!price) continue;

      const [puts, calls] = await Promise.all([
        getOptionChain(ticker, marketDataToken, { dte: targetDTE, side: 'put', strikeLimit: 20 }),
        getOptionChain(ticker, marketDataToken, { dte: targetDTE, side: 'call', strikeLimit: 20 }),
      ]);

      const chain = [...puts, ...calls];
      if (chain.length === 0) continue;

      let ivRank = getCachedIVRank(ticker);
      if (ivRank === null) {
        ivRank = estimateIVRankFromChain(chain, price);
        setCachedIVRank(ticker, ivRank);
      }

      const cspFiltered = filterMDChain(puts, quote, {
        strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40,
        minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
        minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
      });
      const cspPositions = mdChainToPositions(cspFiltered, quote, 'CSP', ivRank, '');
      const cspScored = cspPositions.map((pos) => ({ position: pos, score: scorePosition(pos, weights) }));

      const ccFiltered = filterMDChain(calls, quote, {
        strategy: 'CC', minDelta: 0.10, maxDelta: 0.40,
        minDTE: scanFilter.minDTE, maxDTE: scanFilter.maxDTE,
        minOTMPct: scanFilter.minOTMPct, maxOTMPct: scanFilter.maxOTMPct,
      });
      const ccPositions = mdChainToPositions(ccFiltered, quote, 'CC', ivRank, '');
      const ccScored = ccPositions.map((pos) => ({ position: pos, score: scorePosition(pos, weights) }));

      const bestCSP = cspScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];
      const bestCC = ccScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];

      if (bestCSP) all.push(bestCSP);
      if (bestCC) all.push(bestCC);
    } catch {
      // Skip tickers that fail
    }

    if (!allCached && i < universe.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  onProgress({ phase: 'scoring', current: total, total, currentTicker: '', message: 'Ranking candidates...' });

  // Apply annualized yield floor
  const yieldFiltered = all.filter(
    (c) => calcAnnualizedYield(c.position) >= scanFilter.minAnnualYield,
  );

  yieldFiltered.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  return yieldFiltered.slice(0, 15);
}
