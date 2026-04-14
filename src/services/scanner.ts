import type { OptionPosition, ScoringWeights, ScanProgress } from '../types';
import type { PositionScore } from '../types';
import { getOptionChain } from './yahoo';
import { filterYahooChain, yahooChainToPositions } from './adapter';
import { estimateIVRankFromChain, getCachedIVRank, setCachedIVRank } from './ivRank';
import { scorePosition } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

const SCAN_DELAY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function scanForIdeas(
  universe: string[],
  weights: ScoringWeights,
  onProgress: (progress: ScanProgress) => void,
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
      // Fetch chain (includes quote + expirations)
      const result = await getOptionChain(ticker);
      const quote = result.quote;
      const price = quote.regularMarketPrice || quote.regularMarketPreviousClose || 0;
      if (!price) continue;

      // Find best expiration (21-55 DTE target)
      const now = Date.now();
      const targetExpEpoch = result.expirationDates.find((epoch) => {
        const dte = Math.ceil((epoch * 1000 - now) / (1000 * 60 * 60 * 24));
        return dte >= 21 && dte <= 55;
      }) || result.expirationDates[0];

      if (!targetExpEpoch) continue;

      // Fetch specific expiration if different from default
      let calls = result.calls;
      let puts = result.puts;
      const defaultExp = result.calls[0]?.expiration || result.puts[0]?.expiration;
      if (defaultExp && defaultExp !== targetExpEpoch) {
        const specific = await getOptionChain(ticker, targetExpEpoch);
        calls = specific.calls;
        puts = specific.puts;
      }

      if (calls.length === 0 && puts.length === 0) continue;

      // IV Rank
      let ivRank = getCachedIVRank(ticker);
      if (ivRank === null) {
        ivRank = estimateIVRankFromChain(calls, puts, price);
        setCachedIVRank(ticker, ivRank);
      }

      // Filter and score CSP candidates
      const cspFiltered = filterYahooChain(calls, puts, quote, {
        strategy: 'CSP', minDelta: 0.10, maxDelta: 0.40, minDTE: 14, maxDTE: 60, minOTMPct: 1,
      });
      const cspPositions = yahooChainToPositions(cspFiltered, quote, 'CSP', ivRank);
      const cspScored = cspPositions.map((pos) => ({ position: pos, score: scorePosition(pos, weights) }));

      // Filter and score CC candidates
      const ccFiltered = filterYahooChain(calls, puts, quote, {
        strategy: 'CC', minDelta: 0.10, maxDelta: 0.40, minDTE: 14, maxDTE: 60, minOTMPct: 1,
      });
      const ccPositions = yahooChainToPositions(ccFiltered, quote, 'CC', ivRank);
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
