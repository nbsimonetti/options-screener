// Underlying daily OHLCV history — zero MarketData credits either way:
//  - dev: live Yahoo Finance via the Vite dev proxy (same path as Macro)
//  - production (GitHub Pages): a CI-baked static snapshot
//    (history-data.json, built by scripts/fetch-history-data.mjs and
//    refreshed hourly during market hours — daily bars only change daily,
//    so the snapshot is effectively current). Custom watchlist tickers
//    outside the default universe are only available in dev.

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

// --- Static snapshot (production) ---

interface CompactBars {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
}

interface StaticHistoryFile {
  fetchedAt: string;
  failures: string[];
  bars: Record<string, CompactBars>;
}

const STATIC_HISTORY_URL = `${import.meta.env.BASE_URL}history-data.json`;
let staticHistoryPromise: Promise<StaticHistoryFile | null> | null = null;

async function fetchSnapshotOnce(): Promise<StaticHistoryFile | null> {
  try {
    // no-cache = revalidate against the server (cheap 304 on GH Pages) so a
    // previously cached truncated/bad body can't keep serving.
    const res = await fetch(STATIC_HISTORY_URL, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data: StaticHistoryFile = await res.json();
    if (!data?.bars || Object.keys(data.bars).length < 40) return null;
    return data;
  } catch {
    return null;
  }
}

function loadStaticHistory(): Promise<StaticHistoryFile | null> {
  if (!staticHistoryPromise) {
    staticHistoryPromise = (async () => {
      let snap = await fetchSnapshotOnce();
      if (!snap) {
        await new Promise((r) => setTimeout(r, 1500));
        snap = await fetchSnapshotOnce();
      }
      // Never memoize a failure: one transient network hiccup must not
      // poison every fetchHistory call for the rest of the session.
      if (!snap) staticHistoryPromise = null;
      return snap;
    })();
  }
  return staticHistoryPromise;
}

/**
 * Throws (with a clear message) when the production history source is
 * genuinely unavailable. Called by scanners BEFORE work starts so a snapshot
 * outage aborts loudly instead of surfacing as dozens of per-ticker
 * "insufficient history" rejects — localStorage cache can mask the outage
 * for a handful of tickers, which is exactly how it went undiagnosed.
 */
export async function verifyHistorySource(): Promise<void> {
  if (import.meta.env.DEV) return;
  const snap = await loadStaticHistory();
  if (!snap) {
    throw new HistoryUnavailableError(
      'history-data.json could not be loaded from the site (network hiccup or bad cached copy). Re-run the scan — the loader retries fresh each attempt. If it persists, check the deploy workflow.',
    );
  }
}

export function historySource(): 'live-proxy' | 'static-snapshot' {
  return import.meta.env.DEV ? 'live-proxy' : 'static-snapshot';
}

/** ISO timestamp of the production snapshot, or null (dev / snapshot missing). */
export async function getHistorySnapshotAge(): Promise<string | null> {
  if (import.meta.env.DEV) return null;
  const snap = await loadStaticHistory();
  return snap?.fetchedAt ?? null;
}

export function historyAvailable(): boolean {
  // Dev has the live proxy; production has the CI snapshot. Whether the
  // snapshot actually loads is discovered on first fetchHistory call.
  return true;
}

/** Cached bars only — never triggers a network request. */
export function getCachedHistory(ticker: string): DailyBars | null {
  const entry = readCache()[ticker.toUpperCase()];
  if (!entry || Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
  return entry.value;
}

function cacheBars(bars: DailyBars): DailyBars {
  const cache = readCache();
  const entries = Object.entries(cache);
  if (entries.length >= MAX_ENTRIES) {
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (const [k] of entries.slice(0, entries.length - MAX_ENTRIES + 1)) delete cache[k];
  }
  cache[bars.ticker] = { value: bars, timestamp: Date.now() };
  writeCache(cache);
  return bars;
}

/**
 * Daily bars for any ticker. Production source order (cheapest first):
 *   1. localStorage cache (~1 day)
 *   2. CI snapshot history-data.json (default universe + sector ETFs, free)
 *   3. discovery shortlist bars (free)
 *   4. MarketData daily candles — 1 credit per ticker (billed per 1,000
 *      candles), which is what makes custom watchlist tickers work on the
 *      static build.
 */
export async function fetchHistory(ticker: string, marketDataToken?: string): Promise<DailyBars> {
  const upper = ticker.toUpperCase();
  const cached = getCachedHistory(upper);
  if (cached) return cached;

  // Production: serve from the CI-baked snapshot (and write it into the same
  // localStorage cache so sync consumers like bearishStructureVeto see it).
  if (!import.meta.env.DEV) {
    const snap = await loadStaticHistory();
    if (!snap) {
      throw new HistoryUnavailableError(
        'history-data.json is missing from this deploy — re-run the GitHub Pages workflow (it bakes the history snapshot), or use the local dev server.',
      );
    }
    const compact = snap.bars[upper];
    if (!compact) {
      // Promoted discovery tickers: the discovery artifact carries compact
      // bars for its shortlist members — use them so promotion works on the
      // static build without the dev proxy.
      const { getDiscoveryBars } = await import('./discovery');
      const disc = getDiscoveryBars(upper);
      if (disc) return cacheBars(disc);

      const { getDailyCandles } = await import('./marketdata');
      let candles = null;
      try {
        candles = await getDailyCandles(upper, marketDataToken);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          /401|403/.test(msg)
            ? `${upper} is outside the free snapshot and needs 1 MarketData credit for history — add your token in Settings.`
            : `${upper}: MarketData candles failed (${msg.substring(0, 80)})`,
        );
      }
      if (!candles) throw new Error(`${upper}: MarketData returned no daily candles (delisted or bad symbol?)`);
      return cacheBars({
        ticker: upper,
        timestamps: candles.t,
        opens: candles.o,
        highs: candles.h,
        lows: candles.l,
        closes: candles.c,
        volumes: candles.v,
      });
    }
    return cacheBars({
      ticker: upper,
      timestamps: compact.t,
      opens: compact.o,
      highs: compact.h,
      lows: compact.l,
      closes: compact.c,
      volumes: compact.v,
    });
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
