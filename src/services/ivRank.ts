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

// --- Daily ATM-IV history ledger → true IV percentile ---
//
// The smile-based estimate below ranks ATM IV within a single expiration's
// strike smile — it measures smile shape, NOT where today's IV sits in this
// ticker's own history, which is what "IV Rank" means. We therefore persist
// one ATM-IV sample per ticker per day; once ≥ MIN_IV_SAMPLES days have
// accrued, the true percentile takes over and the smile estimate becomes a
// labeled fallback.

const IV_HISTORY_KEY = 'options-screener-iv-history';
const MAX_IV_SAMPLES = 260; // ~1 trading year
export const MIN_IV_SAMPLES = 20;

interface IVSample { d: string; iv: number } // d = 'YYYY-MM-DD', iv as decimal

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getIVHistory(): Record<string, IVSample[]> {
  try {
    return JSON.parse(localStorage.getItem(IV_HISTORY_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Append today's ATM-IV sample for a ticker (idempotent per day). ivDecimal e.g. 0.28. */
export function recordDailyATMIV(ticker: string, ivDecimal: number) {
  if (!(ivDecimal > 0)) return;
  const key = ticker.toUpperCase();
  const all = getIVHistory();
  const series = all[key] ?? [];
  const today = todayKey();
  if (series.length > 0 && series[series.length - 1].d === today) {
    series[series.length - 1].iv = ivDecimal;
  } else {
    series.push({ d: today, iv: ivDecimal });
  }
  all[key] = series.slice(-MAX_IV_SAMPLES);
  try {
    localStorage.setItem(IV_HISTORY_KEY, JSON.stringify(all));
  } catch { /* best effort */ }
}

export function getIVSampleCount(ticker: string): number {
  return (getIVHistory()[ticker.toUpperCase()] ?? []).length;
}

/** True IV percentile: fraction of stored daily samples below current IV. Null until enough history. */
export function computeIVPercentile(ticker: string, currentIVDecimal: number): number | null {
  const series = getIVHistory()[ticker.toUpperCase()] ?? [];
  if (series.length < MIN_IV_SAMPLES || !(currentIVDecimal > 0)) return null;
  const below = series.filter((s) => s.iv < currentIVDecimal).length;
  return Math.round((below / series.length) * 100);
}

export type IVRankSource = 'history' | 'smile';

export interface IVRankComputation {
  ivRank: number;
  atmIV: number;     // as %
  medianIV: number;  // as %
  source?: IVRankSource;
}

/**
 * Preferred entry point: records today's ATM-IV sample, then returns the true
 * historical percentile when enough samples exist, else the smile estimate.
 */
export function resolveIVRank(ticker: string, chain: MDOption[], currentPrice: number): IVRankComputation {
  const est = estimateIVRankFromChain(chain, currentPrice);
  const atmDecimal = est.atmIV / 100;
  recordDailyATMIV(ticker, atmDecimal);
  const pct = computeIVPercentile(ticker, atmDecimal);
  if (pct !== null) {
    return { ...est, ivRank: pct, source: 'history' };
  }
  return { ...est, source: 'smile' };
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
