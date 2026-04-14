import type { YahooOption } from './yahoo';

const IV_CACHE_KEY = 'options-screener-iv-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

export function estimateIVRankFromChain(
  calls: YahooOption[],
  puts: YahooOption[],
  currentPrice: number,
): number {
  // Collect all IV values from the chain
  const allOptions = [...calls, ...puts];
  const ivValues = allOptions
    .map((o) => o.impliedVolatility)
    .filter((v): v is number => v != null && v > 0);

  if (ivValues.length === 0) return 50;

  // Find ATM option (nearest to current price)
  let atmIV = 0;
  let minDist = Infinity;
  for (const opt of allOptions) {
    const dist = Math.abs(opt.strike - currentPrice);
    if (dist < minDist && opt.impliedVolatility > 0) {
      minDist = dist;
      atmIV = opt.impliedVolatility;
    }
  }

  if (atmIV <= 0) return 50;

  const minIV = Math.min(...ivValues);
  const maxIV = Math.max(...ivValues);
  if (maxIV === minIV) return 50;

  const rank = ((atmIV - minIV) / (maxIV - minIV)) * 100;
  return Math.max(0, Math.min(100, rank));
}
