import type { TradierOption } from '../types';

const IV_CACHE_KEY = 'options-screener-iv-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface IVCacheEntry {
  ivRank: number;
  timestamp: number;
}

function getCache(): Record<string, IVCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(IV_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, IVCacheEntry>) {
  localStorage.setItem(IV_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedIVRank(ticker: string): number | null {
  const cache = getCache();
  const entry = cache[ticker.toUpperCase()];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
  return entry.ivRank;
}

export function setCachedIVRank(ticker: string, ivRank: number) {
  const cache = getCache();
  cache[ticker.toUpperCase()] = { ivRank, timestamp: Date.now() };
  setCache(cache);
}

export function computeIVRankFromChain(chain: TradierOption[], currentATMiv: number): number {
  // Collect all mid_iv values from the chain as a proxy for current IV surface
  const ivValues = chain
    .map((o) => o.greeks?.mid_iv)
    .filter((v): v is number => v != null && v > 0);

  if (ivValues.length === 0 || currentATMiv <= 0) return 50; // default

  const minIV = Math.min(...ivValues);
  const maxIV = Math.max(...ivValues);

  if (maxIV === minIV) return 50;

  // IV Rank = (current - low) / (high - low) * 100
  const rank = ((currentATMiv - minIV) / (maxIV - minIV)) * 100;
  return Math.max(0, Math.min(100, rank));
}

export function estimateIVRankFromATM(
  chain: TradierOption[],
  currentPrice: number,
): number {
  // Find the nearest ATM option
  let atm: TradierOption | null = null;
  let minDist = Infinity;

  for (const opt of chain) {
    const dist = Math.abs(opt.strike - currentPrice);
    if (dist < minDist && opt.greeks?.mid_iv) {
      minDist = dist;
      atm = opt;
    }
  }

  if (!atm || !atm.greeks?.mid_iv) return 50;

  return computeIVRankFromChain(chain, atm.greeks.mid_iv);
}
