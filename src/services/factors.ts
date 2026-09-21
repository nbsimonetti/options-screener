// Directional factor engine for the long call / long put strategy.
// Design + research citations: docs/LONG_STRATEGY_DESIGN.md §1, §3.
// All inputs are daily OHLCV bars (Yahoo via history.ts) + IV Rank.

import type { DailyBars } from './history';
import type { FactorScore, EntryTrigger } from '../types';

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export function sma(values: number[], period: number, endIdx?: number): number {
  const end = endIdx ?? values.length;
  const start = end - period;
  if (start < 0) return NaN;
  let s = 0;
  for (let i = start; i < end; i++) s += values[i];
  return s / period;
}

/** Wilder ATR(14) in $ */
export function atr14(bars: DailyBars, endIdx?: number): number {
  const end = endIdx ?? bars.closes.length;
  const period = 14;
  if (end < period + 1) return NaN;
  let atr = 0;
  // simple average of true range over first window, then Wilder smoothing
  const trAt = (i: number) => Math.max(
    bars.highs[i] - bars.lows[i],
    Math.abs(bars.highs[i] - bars.closes[i - 1]),
    Math.abs(bars.lows[i] - bars.closes[i - 1]),
  );
  const start = Math.max(1, end - 60); // 60-bar warmup is plenty
  let n = 0;
  for (let i = start; i < end; i++) {
    const tr = trAt(i);
    if (n < period) {
      atr = (atr * n + tr) / (n + 1);
    } else {
      atr = (atr * (period - 1) + tr) / period;
    }
    n++;
  }
  return atr;
}

/** Annualized historical volatility (%) over `window` trading days of log returns. */
export function historicalVol(closes: number[], window: number, endIdx?: number): number {
  const end = endIdx ?? closes.length;
  if (end < window + 1) return NaN;
  const rets: number[] = [];
  for (let i = end - window; i < end; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

/** Average absolute daily return (%) over the last `window` sessions. */
export function avgAbsDailyReturn(closes: number[], window = 20): number {
  const n = closes.length;
  if (n < window + 1) return NaN;
  let s = 0;
  for (let i = n - window; i < n; i++) s += Math.abs(closes[i] / closes[i - 1] - 1);
  return (s / window) * 100;
}

/**
 * Historical |move| distribution over rolling windows of `horizon` trading
 * days. `sigmaEquiv` is the median scaled by 1.4826 (the MAD→σ constant):
 * for normal-ish returns median|move| ≈ 0.674σ, so a 1σ implied expected
 * move must be compared against median × 1.4826 to be apples-to-apples —
 * comparing against the raw median rejects even perfectly fair pricing at
 * a ~1.49 ratio.
 */
export function medianHistoricalMove(closes: number[], horizonDays: number): { median: number; sigmaEquiv: number; p90: number } {
  const moves: number[] = [];
  for (let i = 0; i + horizonDays < closes.length; i++) {
    moves.push(Math.abs(closes[i + horizonDays] / closes[i] - 1));
  }
  if (moves.length < 10) return { median: NaN, sigmaEquiv: NaN, p90: NaN };
  moves.sort((a, b) => a - b);
  const median = moves[Math.floor(moves.length * 0.5)];
  return {
    median,
    sigmaEquiv: median * 1.4826,
    p90: moves[Math.floor(moves.length * 0.9)],
  };
}

// --- Composite scoring ---

export interface DirectionalResult {
  score: number;
  factors: FactorScore[];
  gated: boolean;      // hard IVR gate tripped
  gateReason: string;
}

interface Ctx {
  bars: DailyBars;
  spy: DailyBars | null;
  sector: DailyBars | null;
  ivRank: number;
}

function ret(closes: number[], lookback: number, skip = 0): number {
  const n = closes.length;
  if (n < lookback + skip + 1) return NaN;
  return closes[n - 1 - skip] / closes[n - 1 - skip - lookback] - 1;
}

function f(key: string, label: string, rawValue: number, rawUnit: string, score: number, weight: number): FactorScore {
  return { key, label, rawValue, rawUnit, score: clamp(score), weight };
}

export function computeBullish(ctx: Ctx): DirectionalResult {
  const { bars, ivRank } = ctx;
  const c = bars.closes;
  const n = c.length;
  const close = c[n - 1];
  const factors: FactorScore[] = [];

  // B1 12-1 momentum
  const mom = ret(c, 231, 21); // t-252 → t-21
  factors.push(f('mom', '12-1 Momentum', mom * 100, '%', 50 + 100 * mom, 20));

  // B2 52w-high proximity
  const high252 = Math.max(...bars.highs.slice(-252));
  const phigh = close / high252;
  let b2 = clamp(((phigh - 0.70) / 0.30) * 100);
  const recentHigh = c.slice(-10).some((v, i) => v >= Math.max(...c.slice(0, n - 10 + i + 1)));
  if (recentHigh) b2 = Math.max(b2, 90);
  factors.push(f('phigh', '52w High Proximity', phigh * 100, '%', b2, 15));

  // B3 trend structure
  const sma20 = sma(c, 20), sma50 = sma(c, 50), sma200 = sma(c, 200);
  const align = (close > sma50 ? 50 : 0) + (sma50 > sma200 ? 50 : 0);
  const sma50Prev = sma(c, 50, n - 21);
  const slope50 = Number.isFinite(sma50Prev) ? (sma50 - sma50Prev) / sma50Prev : 0;
  const slopeScore = clamp(50 + 2000 * slope50);
  let up = 0;
  const smoothWindow = Math.min(126, n - 1);
  for (let i = n - smoothWindow; i < n; i++) if (c[i] > c[i - 1]) up++;
  const pctUp = up / smoothWindow;
  const smoothScore = clamp(((pctUp - 0.44) / 0.14) * 100);
  factors.push(f('trend', 'Trend Structure', slope50 * 100, '%/mo', (align + slopeScore + smoothScore) / 3, 15));

  // B4 relative strength vs SPY + sector
  let rsScore = 50, rsRaw = 0;
  if (ctx.spy) {
    const rsSpy = ret(c, 63) - ret(ctx.spy.closes, 63);
    const rsSect = ctx.sector ? ret(c, 63) - ret(ctx.sector.closes, 63) : rsSpy;
    const rs = 0.5 * rsSpy + 0.5 * rsSect;
    rsRaw = rs * 100;
    rsScore = clamp(50 + 250 * rs);
    const rs126 = ret(c, 126) - ret(ctx.spy.closes, 126);
    if (Math.sign(rs) !== Math.sign(rs126)) rsScore *= 0.7;
  }
  factors.push(f('rs', 'Relative Strength (63d)', rsRaw, '%', rsScore, 15));

  // B5 volume confirmation
  let upVol = 0, downVol = 0;
  for (let i = Math.max(1, n - 50); i < n; i++) {
    if (c[i] > c[i - 1]) upVol += bars.volumes[i];
    else if (c[i] < c[i - 1]) downVol += bars.volumes[i];
  }
  const udvr = downVol > 0 ? upVol / downVol : 2;
  const volA = clamp(((udvr - 0.8) / 0.8) * 100);
  let volB = 50;
  const high63 = Math.max(...c.slice(-63, -1));
  const madeHigh = c.slice(-10).some((v) => v > high63);
  if (madeHigh) {
    const volSMA50 = sma(bars.volumes, 50);
    const breakoutVol = bars.volumes[n - 1] / volSMA50;
    volB = clamp(((breakoutVol - 0.8) / 1.2) * 100);
  }
  factors.push(f('vol', 'Volume Confirmation', udvr, 'u/d', 0.6 * volA + 0.4 * volB, 10));

  // B6 gap-and-go / PEAD proxy
  let gapScore = 50;
  const volSMA = sma(bars.volumes, 50);
  for (let i = Math.max(1, n - 30); i < n; i++) {
    const gap = bars.opens[i] / c[i - 1] - 1;
    if (gap >= 0.04 && bars.volumes[i] >= 2 * volSMA && c[i] >= bars.opens[i]) {
      const freshness = 1 - (n - 1 - i) / 60;
      const hold = clamp(((close - c[i]) / c[i]) / 0.05 * 100, -100, 100) / 100;
      gapScore = clamp(50 + 50 * freshness * (0.5 + 0.5 * hold));
    }
  }
  factors.push(f('gap', 'Gap / PEAD Proxy', gapScore, 'score', gapScore, 10));

  // B7 extension modifier
  const atr = atr14(bars);
  const ext = Number.isFinite(atr) && atr > 0 ? (close - sma20) / atr : 0;
  let extScore: number;
  if (ext >= 0.5 && ext <= 3.0) extScore = 100;
  else if (ext > 3.0) extScore = clamp(100 - 25 * (ext - 3.0));
  else extScore = clamp(100 + 40 * ext, 20, 100);
  factors.push(f('ext', 'Extension', ext, 'ATR', extScore, 5));

  // B8 IV entry quality
  factors.push(f('ivq', 'IV Entry Quality', ivRank, 'IVR', 100 - 1.25 * ivRank, 10));

  let score = factors.reduce((s, x) => s + (x.score * x.weight) / 100, 0);
  // Chase guard: 21d return > +25% caps composite at 70
  if (ret(c, 21) > 0.25) score = Math.min(score, 70);

  const gated = ivRank > 65;
  return { score, factors, gated, gateReason: gated ? `IVR ${ivRank.toFixed(0)} > 65 (too expensive to buy)` : '' };
}

export function computeBearish(ctx: Ctx): DirectionalResult {
  const { bars, ivRank } = ctx;
  const c = bars.closes;
  const n = c.length;
  const close = c[n - 1];
  const factors: FactorScore[] = [];

  // S1 trend breakdown
  const sma50 = sma(c, 50), sma200 = sma(c, 200);
  const align = (close < sma50 ? 50 : 0) + (sma50 < sma200 ? 50 : 0);
  const sma50Prev = sma(c, 50, n - 21);
  const slope50 = Number.isFinite(sma50Prev) ? (sma50 - sma50Prev) / sma50Prev : 0;
  const slopeScore = clamp(50 - 2000 * slope50);
  const recentMaxHigh = Math.max(...bars.highs.slice(-21));
  const priorMaxHigh = Math.max(...bars.highs.slice(-42, -21));
  const lowerHighs = recentMaxHigh < priorMaxHigh ? 100 : 30;
  factors.push(f('trend', 'Trend Breakdown', slope50 * 100, '%/mo', (align + slopeScore + lowerHighs) / 3, 20));

  // S2 distance from 52w high
  const high252 = Math.max(...bars.highs.slice(-252));
  const phigh = close / high252;
  let s2 = clamp(((0.95 - phigh) / 0.35) * 100);
  const low63 = Math.min(...c.slice(-63, -1));
  if (c.slice(-10).some((v) => v < low63)) s2 = Math.max(s2, 80);
  if (close < 5 || ret(c, 252) < -0.70) s2 = Math.min(s2, 50); // snap-back guard
  factors.push(f('phigh', 'Off 52w High', (1 - phigh) * 100, '%', s2, 15));

  // S3 relative weakness
  let rwScore = 50, rwRaw = 0;
  if (ctx.spy) {
    const rsSpy = ret(c, 63) - ret(ctx.spy.closes, 63);
    const sectRet = ctx.sector ? ret(ctx.sector.closes, 63) : ret(ctx.spy.closes, 63);
    const rsSect = ctx.sector ? ret(c, 63) - sectRet : rsSpy;
    const rs = 0.5 * rsSpy + 0.5 * rsSect;
    rwRaw = rs * 100;
    rwScore = clamp(50 - 250 * rs);
    const rs126 = ret(c, 126) - ret(ctx.spy.closes, 126);
    if (Math.sign(rs) !== Math.sign(rs126)) rwScore *= 0.7;
    if (sectRet > 0 && rsSect < -0.10) rwScore = clamp(rwScore + 10);
  }
  factors.push(f('rw', 'Relative Weakness (63d)', rwRaw, '%', rwScore, 15));

  // S4 distribution volume
  let upVol = 0, downVol = 0;
  for (let i = Math.max(1, n - 50); i < n; i++) {
    if (c[i] > c[i - 1]) upVol += bars.volumes[i];
    else if (c[i] < c[i - 1]) downVol += bars.volumes[i];
  }
  const udvr = downVol > 0 ? upVol / downVol : 2;
  const distA = clamp(((1.2 - udvr) / 0.8) * 100);
  let distB = 40;
  const low63b = Math.min(...c.slice(-63, -1));
  if (c.slice(-10).some((v) => v < low63b)) {
    distB = bars.volumes[n - 1] >= 1.5 * sma(bars.volumes, 50) ? 100 : 50;
  }
  factors.push(f('dist', 'Distribution Volume', udvr, 'u/d', 0.6 * distA + 0.4 * distB, 15));

  // S5 negative-gap PEAD
  let gapScore = 50;
  const volSMA = sma(bars.volumes, 50);
  for (let i = Math.max(1, n - 30); i < n; i++) {
    const gap = bars.opens[i] / c[i - 1] - 1;
    if (gap <= -0.04 && bars.volumes[i] >= 2 * volSMA && c[i] <= bars.opens[i]) {
      // require the gap NOT 50% reclaimed
      const gapMid = c[i - 1] + (bars.opens[i] - c[i - 1]) * 0.5;
      if (close < gapMid) {
        const freshness = 1 - (n - 1 - i) / 60;
        const held = close < c[i] ? 1 : 0.3;
        gapScore = clamp(50 + 50 * freshness * held);
      }
    }
  }
  factors.push(f('gap', 'Negative Gap / PEAD', gapScore, 'score', gapScore, 15));

  // S6 market regime gate (needs SPY)
  let regime = 30;
  let reboundGuard = false;
  if (ctx.spy) {
    const sc = ctx.spy.closes;
    const spyClose = sc[sc.length - 1];
    const spySMA200 = sma(sc, 200);
    const spySMA50 = sma(sc, 50);
    const spySMA50Prev = sma(sc, 50, sc.length - 21);
    if (spyClose < spySMA200 && spySMA50 < spySMA50Prev) regime = 100;
    else if (spyClose < spySMA50) regime = 60;
    const spyHigh63 = Math.max(...sc.slice(-63));
    const spyRally5 = ret(sc, 5);
    if (spyClose < spyHigh63 * 0.92 && spyRally5 > 0.04) reboundGuard = true;
  }
  factors.push(f('regime', 'Market Regime', regime, 'score', regime, 10));

  // S7 IV entry quality (stricter)
  factors.push(f('ivq', 'IV Entry Quality', ivRank, 'IVR', 100 - 1.5 * ivRank, 10));

  let score = factors.reduce((s, x) => s + (x.score * x.weight) / 100, 0);
  if (reboundGuard) score *= 0.6;

  const gated = ivRank > 55;
  return { score, factors, gated, gateReason: gated ? `IVR ${ivRank.toFixed(0)} > 55 (bear case already priced)` : '' };
}

// --- Entry trigger detection (rules R3/R4/R6/R7 on daily closes) ---

export interface TriggerResult {
  trigger: EntryTrigger;
  triggerDate: string; // ISO
  sigRef: number;
}

/**
 * Scans the last 3 completed sessions for a fresh entry trigger (R7 allows
 * up to 2 trading days of staleness). Returns null when nothing fired or the
 * extension guard (R6) vetoes.
 */
export function detectEntryTrigger(bars: DailyBars, direction: 'bull' | 'bear'): TriggerResult | null {
  const c = bars.closes;
  const n = c.length;
  const atr = atr14(bars);
  if (!Number.isFinite(atr) || atr <= 0 || n < 60) return null;

  const sma20Now = sma(c, 20);
  const close = c[n - 1];

  // R6 extension guard
  if (direction === 'bull' && close > sma20Now + 2.5 * atr) return null;
  if (direction === 'bear' && close < sma20Now - 2.5 * atr) return null;

  const iso = (i: number) => new Date(bars.timestamps[i] * 1000).toISOString().split('T')[0];

  for (let back = 0; back <= 2; back++) {
    const i = n - 1 - back;
    if (i < 55) break;
    const vol = bars.volumes[i];
    const volAvg = sma(bars.volumes, 20, i);
    const sma20i = sma(c, 20, i + 1);
    const sma50i = sma(c, 50, i + 1);
    const sma20Prev = sma(c, 20, i - 4);
    const sma50Prev = sma(c, 50, i - 4);

    if (direction === 'bull') {
      // R3 breakout: close > 20d high (excl. today) on 1.5x volume, ≤1 ATR past trigger
      const hh20 = Math.max(...bars.highs.slice(i - 20, i));
      if (c[i] > hh20 && vol >= 1.5 * volAvg && c[i] <= hh20 + 1.0 * atr) {
        return { trigger: 'breakout', triggerDate: iso(i), sigRef: hh20 };
      }
      // R4 pullback: rising SMA20 > SMA50, touched SMA20 band, closed up
      if (sma20i > sma50i && sma20i > sma20Prev
        && bars.lows[i] <= sma20i + 0.25 * atr && c[i] >= sma20i - 0.25 * atr && c[i] > c[i - 1]) {
        return { trigger: 'pullback', triggerDate: iso(i), sigRef: sma20i };
      }
    } else {
      const ll20 = Math.min(...bars.lows.slice(i - 20, i));
      if (c[i] < ll20 && vol >= 1.5 * volAvg && c[i] >= ll20 - 1.0 * atr) {
        return { trigger: 'breakout', triggerDate: iso(i), sigRef: ll20 };
      }
      if (sma20i < sma50i && sma20i < sma20Prev && sma50i <= sma50Prev
        && bars.highs[i] >= sma20i - 0.25 * atr && c[i] <= sma20i + 0.25 * atr && c[i] < c[i - 1]) {
        return { trigger: 'pullback', triggerDate: iso(i), sigRef: sma20i };
      }
    }
  }
  return null;
}
