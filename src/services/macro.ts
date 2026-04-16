// Macro data service — fetches market-wide signals for the premium-seller dashboard.
// Primary source: Yahoo Finance via corsproxy.io (no token required).

const PROXY = 'https://corsproxy.io/?url=';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// --- Types ---

export interface VolIndex {
  symbol: string;
  level: number;
  prevClose: number;
  change: number;
  changePct: number;
  change5d?: number; // 5-day % change
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  rank: number; // 0-100 percentile of current within 52-week range
  asOf: string;
  history?: number[]; // daily closes, last 60 days, oldest first
}

export interface IndexSnapshot {
  symbol: string;
  level: number;
  change: number;
  changePct: number;
  change5d?: number;
  ma50: number;
  ma200: number;
  aboveMA50: boolean;
  aboveMA200: boolean;
  distanceFromHigh: number; // negative number when below ATH (e.g., -3.2 means 3.2% below)
  asOf: string;
  history?: number[]; // last 60 days
}

export interface MacroSnapshot {
  fetchedAt: string;
  vix?: VolIndex;
  vix3m?: VolIndex;
  vvix?: VolIndex;
  skew?: VolIndex;
  indices: Partial<Record<'SPX' | 'NDX' | 'RUT', IndexSnapshot>>;
  sectorReturns20d: Record<string, number>;
  creditSpread?: { hygPrice: number; lqdPrice: number; ratio: number; ratioTrend20d: number };
  yieldProxy?: { tltPrice: number; tltReturn20d: number };
  vrp?: { impliedVol: number; realizedVol20d: number; delta: number };
  spyPrice?: number; // used to compute implied moves on macro tab
  dataSources: string[];
  failures: string[];
}

export function computeImpliedMoveSPY(spyPrice: number, vixLevel: number, days: number): number {
  if (spyPrice <= 0 || vixLevel <= 0 || days <= 0) return 0;
  return spyPrice * (vixLevel / 100) * Math.sqrt(days / 365);
}

// --- Cache ---

const CACHE_KEY = 'options-screener-macro-cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

interface CacheEntry {
  value: unknown;
  timestamp: number;
}

function readCache(): Record<string, CacheEntry> {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

function getCached<T>(key: string, ttl: number): T | null {
  const cache = readCache();
  const entry = cache[key];
  if (!entry || Date.now() - entry.timestamp > ttl) return null;
  return entry.value as T;
}

function setCached<T>(key: string, value: T) {
  const cache = readCache();
  cache[key] = { value, timestamp: Date.now() };
  writeCache(cache);
}

export function clearMacroCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(LS_MACRO_SNAPSHOT);
}

export const LS_MACRO_SNAPSHOT = 'options-screener-macro-snapshot';
export const LS_COMPOSITE_HISTORY = 'options-screener-macro-composite-history';

export interface CompositeHistoryEntry {
  date: string; // YYYY-MM-DD
  score: number;
}

export function loadCompositeHistory(): CompositeHistoryEntry[] {
  try {
    const s = localStorage.getItem(LS_COMPOSITE_HISTORY);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

export function recordCompositeScore(score: number) {
  const today = new Date().toISOString().split('T')[0];
  let list = loadCompositeHistory();
  // Keep at most one entry per day; overwrite today's if it exists
  list = list.filter((e) => e.date !== today);
  list.push({ date: today, score });
  list = list.slice(-30); // keep last 30 days
  try { localStorage.setItem(LS_COMPOSITE_HISTORY, JSON.stringify(list)); } catch { /* ignore */ }
}

// --- Yahoo chart fetcher ---

interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice: number;
    chartPreviousClose: number;
    fiftyTwoWeekHigh: number;
    fiftyTwoWeekLow: number;
    regularMarketTime: number;
  };
  timestamp: number[];
  indicators: {
    quote: Array<{
      close: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

async function fetchYahooChart(symbol: string, range: string = '1y'): Promise<YahooChartResult> {
  const cacheKey = `yahoo:${symbol}:${range}`;
  const cached = getCached<YahooChartResult>(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const url = `${YAHOO}${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result || !result.meta) throw new Error(`Yahoo ${symbol}: no data`);
  setCached(cacheKey, result);
  return result;
}

// --- Helpers ---

function closes(r: YahooChartResult): number[] {
  return (r.indicators?.quote?.[0]?.close || []).filter((c): c is number => c != null);
}

function movingAverage(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function percentileInRange(value: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

function percentReturn(values: number[], window: number): number {
  if (values.length < window + 1) return 0;
  const start = values[values.length - window - 1];
  const end = values[values.length - 1];
  if (start <= 0) return 0;
  return ((end - start) / start) * 100;
}

// Annualized realized vol from daily closes (log returns)
function realizedVol(values: number[], window: number): number {
  if (values.length < window + 1) return 0;
  const slice = values.slice(-window - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    logReturns.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252) * 100; // annualized %
}

// --- Metric builders ---

async function buildVolIndex(symbol: string): Promise<VolIndex> {
  const r = await fetchYahooChart(symbol);
  const fullHistory = closes(r);
  const history = fullHistory.slice(-60);
  const level = r.meta.regularMarketPrice;
  const prevClose = r.meta.chartPreviousClose;
  const high52 = r.meta.fiftyTwoWeekHigh;
  const low52 = r.meta.fiftyTwoWeekLow;
  const change = level - prevClose;
  const close5dAgo = fullHistory.length >= 6 ? fullHistory[fullHistory.length - 6] : undefined;
  const change5d = close5dAgo && close5dAgo > 0 ? ((level - close5dAgo) / close5dAgo) * 100 : undefined;
  return {
    symbol,
    level,
    prevClose,
    change,
    changePct: prevClose > 0 ? (change / prevClose) * 100 : 0,
    change5d,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    rank: percentileInRange(level, low52, high52),
    asOf: new Date(r.meta.regularMarketTime * 1000).toISOString(),
    history,
  };
}

async function buildIndex(symbol: string): Promise<IndexSnapshot> {
  const r = await fetchYahooChart(symbol);
  const h = closes(r);
  const history = h.slice(-60);
  const level = r.meta.regularMarketPrice;
  const prevClose = r.meta.chartPreviousClose;
  const ma50 = movingAverage(h, 50);
  const ma200 = movingAverage(h, 200);
  const high52 = r.meta.fiftyTwoWeekHigh;
  const change = level - prevClose;
  const close5dAgo = h.length >= 6 ? h[h.length - 6] : undefined;
  const change5d = close5dAgo && close5dAgo > 0 ? ((level - close5dAgo) / close5dAgo) * 100 : undefined;

  return {
    symbol,
    level,
    change,
    changePct: prevClose > 0 ? (change / prevClose) * 100 : 0,
    change5d,
    ma50,
    ma200,
    aboveMA50: level > ma50,
    aboveMA200: level > ma200,
    distanceFromHigh: high52 > 0 ? ((level - high52) / high52) * 100 : 0,
    asOf: new Date(r.meta.regularMarketTime * 1000).toISOString(),
    history,
  };
}

const SECTOR_SYMBOLS = ['XLF', 'XLE', 'XLK', 'XLY', 'XLV', 'XLI', 'XLP', 'XLU', 'XLB', 'XLC', 'XLRE'] as const;

// --- Public API ---

export async function getMacroSnapshot(): Promise<MacroSnapshot> {
  const failures: string[] = [];

  const safeRun = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); }
    catch (e) { failures.push(`${label}: ${e instanceof Error ? e.message : 'failed'}`); return undefined; }
  };

  // Volatility family
  const [vix, vix3m, vvix, skew] = await Promise.all([
    safeRun('VIX', () => buildVolIndex('^VIX')),
    safeRun('VIX3M', () => buildVolIndex('^VIX3M')),
    safeRun('VVIX', () => buildVolIndex('^VVIX')),
    safeRun('SKEW', () => buildVolIndex('^SKEW')),
  ]);

  // Indices
  const [spx, ndx, rut] = await Promise.all([
    safeRun('SPX', () => buildIndex('^GSPC')),
    safeRun('NDX', () => buildIndex('^NDX')),
    safeRun('RUT', () => buildIndex('^RUT')),
  ]);

  // Sector ETF 20-day returns
  const sectorResults = await Promise.all(
    SECTOR_SYMBOLS.map((s) => safeRun(`sector-${s}`, async () => {
      const r = await fetchYahooChart(s);
      return { s, ret: percentReturn(closes(r), 20) };
    })),
  );
  const sectorReturns20d: Record<string, number> = {};
  for (const item of sectorResults) {
    if (item) sectorReturns20d[item.s] = item.ret;
  }

  // Credit spread proxy: HYG/LQD
  const creditSpread = await safeRun('credit', async () => {
    const [hyg, lqd] = await Promise.all([fetchYahooChart('HYG'), fetchYahooChart('LQD')]);
    const hygCloses = closes(hyg);
    const lqdCloses = closes(lqd);
    const hygPrice = hyg.meta.regularMarketPrice;
    const lqdPrice = lqd.meta.regularMarketPrice;
    const ratio = lqdPrice > 0 ? hygPrice / lqdPrice : 0;
    const ratioTrend20d = percentReturn(
      hygCloses.map((h, i) => lqdCloses[i] > 0 ? h / lqdCloses[i] : 0).filter((v) => v > 0),
      20,
    );
    return { hygPrice, lqdPrice, ratio, ratioTrend20d };
  });

  // 10Y Treasury proxy via TLT (inversely correlated with yields)
  const yieldProxy = await safeRun('TLT', async () => {
    const tlt = await fetchYahooChart('TLT');
    return {
      tltPrice: tlt.meta.regularMarketPrice,
      tltReturn20d: percentReturn(closes(tlt), 20),
    };
  });

  // SPY (for VRP + implied moves)
  const spyChart = await safeRun('SPY', () => fetchYahooChart('SPY'));
  const spyPrice = spyChart?.meta.regularMarketPrice;

  // VRP: implied (VIX) vs realized (SPY 20-day)
  const vrp = spyChart && vix ? {
    impliedVol: vix.level,
    realizedVol20d: realizedVol(closes(spyChart), 20),
    delta: vix.level - realizedVol(closes(spyChart), 20),
  } : undefined;

  return {
    fetchedAt: new Date().toISOString(),
    vix,
    vix3m,
    vvix,
    skew,
    indices: { SPX: spx, NDX: ndx, RUT: rut },
    sectorReturns20d,
    creditSpread,
    yieldProxy,
    vrp,
    spyPrice,
    dataSources: ['Yahoo Finance'],
    failures,
  };
}

// --- Load/save snapshot for instant reload ---

export function loadSavedSnapshot(): MacroSnapshot | null {
  try {
    const s = localStorage.getItem(LS_MACRO_SNAPSHOT);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(snap: MacroSnapshot) {
  try {
    localStorage.setItem(LS_MACRO_SNAPSHOT, JSON.stringify(snap));
  } catch {
    // ignore
  }
}
