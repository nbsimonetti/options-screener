import type { OptionPosition, ScoringWeights, ScanProgress } from '../types';
import type { PositionScore } from '../types';
import { getQuote, getOptionChain } from './marketdata';
import { filterMDChain, mdChainToPositions } from './adapter';
import { estimateIVRankFromChain, getCachedIVRank, setCachedIVRank } from './ivRank';
import { scorePosition } from '../scoring/engine';

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
): Promise<ScanCandidate[]> {
  const all: ScanCandidate[] = [];
  const total = universe.length;

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

    try {
      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || 0;
      if (!price) continue;

      // Fetch puts (CSP candidates) and calls (CC candidates) with ~35 DTE target
      const [puts, calls] = await Promise.all([
        getOptionChain(ticker, marketDataToken, { dte: 35, side: 'put', strikeLimit: 20 }),
        getOptionChain(ticker, marketDataToken, { dte: 35, side: 'call', strikeLimit: 20 }),
      ]);

      const chain = [...puts, ...calls];
      if (chain.length === 0) continue;

      // IV Rank
      let ivRank = getCachedIVRank(ticker);
      if (ivRank === null) {
        ivRank = estimateIVRankFromChain(chain, price);
        setCachedIVRank(ticker, ivRank);
      }

      // Score CSP candidates
      const cspFiltered = filterMDChain(puts, quote, {
        strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40, minDTE: 14, maxDTE: 60, minOTMPct: 1,
      });
      const cspPositions = mdChainToPositions(cspFiltered, quote, 'CSP', ivRank, '');
      const cspScored = cspPositions.map((pos) => ({ position: pos, score: scorePosition(pos, weights) }));

      // Score CC candidates
      const ccFiltered = filterMDChain(calls, quote, {
        strategy: 'CC', minDelta: 0.10, maxDelta: 0.40, minDTE: 14, maxDTE: 60, minOTMPct: 1,
      });
      const ccPositions = mdChainToPositions(ccFiltered, quote, 'CC', ivRank, '');
      const ccScored = ccPositions.map((pos) => ({ position: pos, score: scorePosition(pos, weights) }));

      // Keep single best per strategy per ticker
      const bestCSP = cspScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];
      const bestCC = ccScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];

      if (bestCSP) all.push(bestCSP);
      if (bestCC) all.push(bestCC);
    } catch {
      // Skip tickers that fail
    }

    if (i < universe.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  onProgress({ phase: 'scoring', current: total, total, currentTicker: '', message: 'Ranking candidates...' });

  all.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  return all.slice(0, 15);
}
