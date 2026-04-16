import type { MDOption } from './marketdata';

const IV_CACHE_KEY = 'options-screener-iv-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IVCacheEntry {
  ivRank: number;
  atmIV: number;     // current ATM implied vol (%)
  medianIV: number;  // 50th percentile of chain (%)
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
  const entry = getCachedIVData(ticker);
  return entry ? entry.ivRank : null;
}

export function getCachedIVData(ticker: string): IVCacheEntry | null {
  const cache = getCache();
  const entry = cache[ticker.toUpperCase()];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
  return entry;
}

export function setCachedIVRank(ticker: string, ivRank: number, atmIV?: number, medianIV?: number) {
  const cache = getCache();
  const existing = cache[ticker.toUpperCase()];
  cache[ticker.toUpperCase()] = {
    ivRank,
    atmIV: atmIV ?? existing?.atmIV ?? 0,
    medianIV: medianIV ?? existing?.medianIV ?? 0,
    timestamp: Date.now(),
  };
  setCache(cache);
}

export interface IVRankComputation {
  ivRank: number;
  atmIV: number;     // as %
  medianIV: number;  // as %
}

export function estimateIVRankFromChain(
  chain: MDOption[],
  currentPrice: number,
): IVRankComputation {
  const ivValues = chain
    .map((o) => o.iv)
    .filter((v): v is number => v != null && v > 0);

  if (ivValues.length === 0) return { ivRank: 50, atmIV: 0, medianIV: 0 };

  // Find ATM option IV (as decimal from API)
  let atmIV = 0;
  let minDist = Infinity;
  for (const opt of chain) {
    const dist = Math.abs(opt.strike - currentPrice);
    if (dist < minDist && opt.iv > 0) {
      minDist = dist;
      atmIV = opt.iv;
    }
  }

  // Median of chain IVs (as decimal from API)
  const sorted = [...ivValues].sort((a, b) => a - b);
  const medianIV = sorted[Math.floor(sorted.length / 2)];

  let ivRank = 50;
  if (atmIV > 0) {
    const minIV = Math.min(...ivValues);
    const maxIV = Math.max(...ivValues);
    if (maxIV > minIV) {
      ivRank = Math.max(0, Math.min(100, ((atmIV - minIV) / (maxIV - minIV)) * 100));
    }
  }

  return {
    ivRank,
    atmIV: atmIV * 100,    // convert to %
    medianIV: medianIV * 100,
  };
}
