import type { APIConfig, OptionPosition, ScoringWeights, ScanProgress } from '../types';
import type { PositionScore } from '../types';
import { getQuote, getExpirations, getOptionChain } from './tradier';
import { filterChain, chainToPositions } from './adapter';
import { estimateIVRankFromATM, getCachedIVRank, setCachedIVRank } from './ivRank';
import { getNextEarningsDate } from './finnhub';
import { scorePosition } from '../scoring/engine';

export interface ScanCandidate {
  position: OptionPosition;
  score: PositionScore;
}

const SCAN_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function scanForIdeas(
  universe: string[],
  apiConfig: APIConfig,
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
      // Fetch quote
      const quote = await getQuote(ticker, apiConfig.tradierToken, apiConfig.tradierSandbox);
      if (!quote || (!quote.last && !quote.close)) continue;

      // Find best expiration (30-45 DTE target)
      const expirations = await getExpirations(ticker, apiConfig.tradierToken, apiConfig.tradierSandbox);
      if (expirations.length === 0) continue;

      const now = Date.now();
      const targetExp = expirations.find((exp) => {
        const dte = Math.ceil((new Date(exp + 'T16:00:00').getTime() - now) / (1000 * 60 * 60 * 24));
        return dte >= 21 && dte <= 55;
      }) || expirations[0];

      // Fetch chain
      const chain = await getOptionChain(ticker, targetExp, apiConfig.tradierToken, apiConfig.tradierSandbox);
      if (chain.length === 0) continue;

      // IV Rank
      let ivRank = getCachedIVRank(ticker);
      if (ivRank === null) {
        ivRank = estimateIVRankFromATM(chain, quote.last || quote.close || 0);
        setCachedIVRank(ticker, ivRank);
      }

      // Earnings date
      let earningsDate = '';
      if (apiConfig.finnhubToken) {
        earningsDate = await getNextEarningsDate(ticker, apiConfig.finnhubToken);
      }

      // Filter and score CSP candidates
      const cspFiltered = filterChain(chain, quote, {
        strategy: 'CSP',
        minDelta: 0.10,
        maxDelta: 0.40,
        minDTE: 14,
        maxDTE: 60,
        minOTMPct: 1,
      });
      const cspPositions = chainToPositions(cspFiltered, quote, 'CSP', ivRank, earningsDate);
      const cspScored = cspPositions.map((pos) => ({
        position: pos,
        score: scorePosition(pos, weights),
      }));

      // Filter and score CC candidates
      const ccFiltered = filterChain(chain, quote, {
        strategy: 'CC',
        minDelta: 0.10,
        maxDelta: 0.40,
        minDTE: 14,
        maxDTE: 60,
        minOTMPct: 1,
      });
      const ccPositions = chainToPositions(ccFiltered, quote, 'CC', ivRank, earningsDate);
      const ccScored = ccPositions.map((pos) => ({
        position: pos,
        score: scorePosition(pos, weights),
      }));

      // Keep the single best CSP and best CC per ticker
      const bestCSP = cspScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];
      const bestCC = ccScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore)[0];

      if (bestCSP) all.push(bestCSP);
      if (bestCC) all.push(bestCC);
    } catch {
      // Skip tickers that fail — don't break the scan
    }

    // Rate limit
    if (i < universe.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  onProgress({ phase: 'scoring', current: total, total, currentTicker: '', message: 'Ranking candidates...' });

  // Global rank by composite score, take top 15
  all.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  return all.slice(0, 15);
}
