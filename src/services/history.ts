// Underlying daily OHLCV history — Yahoo Finance via the Vite dev proxy
// (same path the Macro tab uses; zero MarketData credits). Only available in
// dev mode: the static GitHub Pages build has no proxy, so callers must
// degrade gracefully (historyAvailable() === false).

export interface DailyBars {
  ticker: string;
  timestamps: number[]; // unix seconds
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

export class HistoryUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HistoryUnavailableError';
  }
}

const YAHOO = '/api/yahoo/v8/finance/chart/';
const CACHE_KEY = 'options-screener-history-cache';
const CACHE_TTL_MS = 20 * 60 * 60 * 1000; // ~1 trading day
const MAX_ENTRIES = 80;

interface CacheEntry {
  value: DailyBars;
  timestamp: number;
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota — drop the oldest half and retry once.
    try {
      const entries = Object.entries(cache).sort((a, b) => a[1].timestamp - b[1].timestamp);
      const trimmed = Object.fromEntries(entries.slice(Math.floor(entries.length / 2)));
      localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

export function historyAvailable(): boolean {
  return import.meta.env.DEV;
}

/** Cached bars only — never triggers a network request. */
export function getCachedHistory(ticker: string): DailyBars | null {
  const entry = readCache()[ticker.toUpperCase()];
  if (!entry || Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
  return entry.value;
}

export async function fetchHistory(ticker: string): Promise<DailyBars> {
  const upper = ticker.toUpperCase();
  const cached = getCachedHistory(upper);
  if (cached) return cached;

  if (!historyAvailable()) {
    throw new HistoryUnavailableError(
      'Underlying history requires the local dev server (Yahoo proxy). Factor scanning is unavailable on the static build.',
    );
  }

  const url = `${YAHOO}${encodeURIComponent(upper)}?interval=1d&range=2y`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo ${upper} ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote?.close) throw new Error(`Yahoo ${upper}: no data`);

  // Drop null rows (holidays / partial bars) and round to keep localStorage small.
  const bars: DailyBars = { ticker: upper, timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = quote.close[i];
    if (c == null) continue;
    bars.timestamps.push(result.timestamp[i]);
    bars.opens.push(r2(quote.open?.[i] ?? c));
    bars.highs.push(r2(quote.high?.[i] ?? c));
    bars.lows.push(r2(quote.low?.[i] ?? c));
    bars.closes.push(r2(c));
    bars.volumes.push(Math.round(quote.volume?.[i] ?? 0));
  }
  if (bars.closes.length < 60) throw new Error(`Yahoo ${upper}: only ${bars.closes.length} bars`);

  const cache = readCache();
  const entries = Object.entries(cache);
  if (entries.length >= MAX_ENTRIES) {
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (const [k] of entries.slice(0, entries.length - MAX_ENTRIES + 1)) delete cache[k];
  }
  cache[upper] = { value: bars, timestamp: Date.now() };
  writeCache(cache);
  return bars;
}

// --- Bearish-structure veto for the income (CSP) screener ---
//
// Research finding (docs/LONG_STRATEGY_DESIGN.md §5): ranking CSP candidates
// purely on IV Rank adversely selects names whose IV is high because they are
// breaking down. Veto CSPs when the chart shows bearish structure. Uses cached
// history only (populated by long scans / prior fetches) — no-op when absent.

export interface BearishVeto {
  vetoed: boolean;
  reason: string;
}

export function bearishStructureVeto(ticker: string): BearishVeto | null {
  const bars = getCachedHistory(ticker);
  if (!bars || bars.closes.length < 210) return null;
  const closes = bars.closes;
  const n = closes.length;
  const close = closes[n - 1];

  const sma200 = closes.slice(n - 200).reduce((s, v) => s + v, 0) / 200;
  if (close < sma200) {
    return { vetoed: true, reason: `below 200-day SMA (${close.toFixed(2)} < ${sma200.toFixed(2)})` };
  }

  // Unreclaimed −4% gap-down on ≥2× volume within the last 60 sessions.
  const volSMA50 = (i: number) => {
    const start = Math.max(0, i - 50);
    const slice = bars.volumes.slice(start, i);
    return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
  };
  for (let i = Math.max(1, n - 60); i < n; i++) {
    const gap = bars.opens[i] / closes[i - 1] - 1;
    if (gap <= -0.04 && bars.volumes[i] >= 2 * volSMA50(i) && close < closes[i - 1]) {
      const when = new Date(bars.timestamps[i] * 1000).toISOString().split('T')[0];
      return { vetoed: true, reason: `unreclaimed −4% gap-down on volume (${when})` };
    }
  }
  return { vetoed: false, reason: '' };
}
