// Risk-adjusted performance metrics for the paper-trading book.
// Formulas per docs/LONG_STRATEGY_DESIGN.md §4 (research brief D):
// Δ-weighted MLE estimators robust to irregular daily marks, Sortino (MAR 0)
// as the headline for a positively-skewed long-premium book, hard
// insufficient-history gates so a 3-week +6% never renders as "+101% CAGR".

import type { PaperPortfolio, PaperClosedTrade } from '../types';

const RF_ANNUAL = 0.04; // 13-week T-bill config param
const TRADING_DAYS = 252;

export interface MetricValue {
  value: number | null;   // null = gated (insufficient history)
  display: string;        // formatted value or gate explanation
  gated: boolean;
}

export interface PaperMetrics {
  totalReturnPct: MetricValue;
  totalPnl: MetricValue;
  cagr: MetricValue;
  sharpe: MetricValue;     // display includes ± Lo SE band
  sortino: MetricValue;    // headline
  maxDrawdown: MetricValue;
  calmar: MetricValue;
  profitFactor: MetricValue;
  winRate: MetricValue;    // display includes Wilson 90% interval
  payoffRatio: MetricValue;
  rExpectancy: MetricValue;
  skewCaution: boolean;    // Sortino/Sharpe divergence > 2x
  marksCount: number;
  tradesCount: number;
}

function gate(msg: string): MetricValue {
  return { value: null, display: msg, gated: true };
}

function val(v: number, display: string): MetricValue {
  return { value: v, display, gated: false };
}

function tradingDaysBetween(d1: string, d2: string): number {
  const ms = new Date(d2).getTime() - new Date(d1).getTime();
  const calendar = Math.max(1, Math.round(ms / 86400000));
  return Math.max(1, Math.round(calendar * 5 / 7));
}

/** Wilson 90% interval for a binomial proportion. */
export function wilson90(wins: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.6449;
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export function computeMetrics(portfolio: PaperPortfolio, startingCapital: number): PaperMetrics {
  // Return series uses only NON-CARRIED marks (carried marks are display-only;
  // synthetic zero-return days would deflate vol and inflate Sharpe).
  const marks = portfolio.equityHistory.filter((m) => !m.carried);
  const trades = portfolio.closedTrades;
  const N = marks.length;
  const T = trades.length;

  const lastEquity = portfolio.equityHistory.length > 0
    ? portfolio.equityHistory[portfolio.equityHistory.length - 1].equity
    : startingCapital;

  const totalPnlNum = lastEquity - startingCapital;
  const totalReturn = lastEquity / startingCapital - 1;
  const totalReturnPct = val(totalReturn, `${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%`);
  const totalPnl = val(totalPnlNum, `${totalPnlNum >= 0 ? '+' : ''}$${Math.abs(totalPnlNum).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  // Calendar span
  const firstDate = marks[0]?.d;
  const lastDate = marks[N - 1]?.d;
  const spanDays = firstDate && lastDate
    ? Math.max(1, Math.round((new Date(lastDate).getTime() - new Date(firstDate).getTime()) / 86400000))
    : 0;

  // Δ-weighted estimators on log returns
  let mu = 0, sigma = 0, sumDelta = 0;
  const intervals: { x: number; delta: number }[] = [];
  for (let i = 1; i < N; i++) {
    if (marks[i - 1].equity <= 0 || marks[i].equity <= 0) continue;
    const x = Math.log(marks[i].equity / marks[i - 1].equity);
    const delta = tradingDaysBetween(marks[i - 1].d, marks[i].d);
    intervals.push({ x, delta });
    sumDelta += delta;
  }
  if (intervals.length >= 2 && sumDelta > 0) {
    mu = intervals.reduce((s, it) => s + it.x, 0) / sumDelta;
    const ss = intervals.reduce((s, it) => s + ((it.x - mu * it.delta) ** 2) / it.delta, 0);
    sigma = Math.sqrt(ss / (intervals.length - 1));
  }

  const rfDaily = Math.log(1 + RF_ANNUAL) / TRADING_DAYS;

  // CAGR — gated at 90 calendar days
  const cagr = spanDays >= 90
    ? (() => {
        const g = Math.pow(lastEquity / startingCapital, 365.25 / spanDays) - 1;
        return val(g, `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%`);
      })()
    : gate(`needs 90 days (${spanDays}d so far)`);

  // Sharpe — gated at 20 marks; ± Lo (2002) SE band
  let sharpeNum: number | null = null;
  let sharpe: MetricValue;
  if (N >= 20 && sigma > 0) {
    sharpeNum = ((mu - rfDaily) / sigma) * Math.sqrt(TRADING_DAYS);
    const se = Math.sqrt((1 + (sharpeNum * sharpeNum) / 2) / sumDelta) * Math.sqrt(TRADING_DAYS);
    sharpe = val(sharpeNum, `${sharpeNum.toFixed(2)} ± ${se.toFixed(2)}`);
  } else {
    sharpe = gate(`needs 20 marks (${N} so far)`);
  }

  // Sortino — MAR 0, full-N denominator; gated at 20 marks AND ≥5 negative intervals
  let sortinoNum: number | null = null;
  let sortino: MetricValue;
  const negCount = intervals.filter((it) => it.x < 0).length;
  if (N >= 20 && negCount >= 5) {
    const dsum = intervals.reduce((s, it) => {
      const d = Math.min(it.x, 0) / Math.sqrt(it.delta);
      return s + d * d;
    }, 0);
    const dd = Math.sqrt(dsum / intervals.length);
    if (dd > 0) {
      sortinoNum = (mu / dd) * Math.sqrt(TRADING_DAYS);
      sortino = val(sortinoNum, sortinoNum.toFixed(2));
    } else {
      sortino = gate('no downside observed yet');
    }
  } else {
    sortino = N < 20 ? gate(`needs 20 marks (${N} so far)`) : gate(`needs 5 down intervals (${negCount} so far)`);
  }

  // Max drawdown on running peak of ALL displayed marks
  let peak = startingCapital, mdd = 0;
  for (const m of portfolio.equityHistory) {
    peak = Math.max(peak, m.equity);
    mdd = Math.max(mdd, (peak - m.equity) / peak);
  }
  const maxDrawdown = val(-mdd, `−${(mdd * 100).toFixed(1)}%`);

  const calmar = cagr.gated
    ? gate('needs 90 days')
    : mdd < 0.02
      ? gate('needs MDD ≥ 2%')
      : val((cagr.value as number) / mdd, ((cagr.value as number) / mdd).toFixed(2));

  // Trade-level stats
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const profitFactor = T >= 20
    ? grossLoss > 0 ? val(grossWin / grossLoss, (grossWin / grossLoss).toFixed(2)) : gate('no losses yet')
    : gate(`needs 20 trades (${T} so far)`);

  const w = wilson90(wins.length, T);
  const winRate = T > 0
    ? val(wins.length / T, `${((wins.length / T) * 100).toFixed(0)}% (${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}%, n=${T})`)
    : gate('no closed trades yet');

  const payoffRatio = wins.length >= 10 && losses.length >= 10
    ? (() => {
        const r = (grossWin / wins.length) / (grossLoss / losses.length);
        return val(r, r.toFixed(2));
      })()
    : gate(`needs 10 wins & 10 losses (${wins.length}W/${losses.length}L)`);

  const rExpectancy = T >= 20
    ? (() => {
        const r = trades.reduce((s, t) => s + (t.riskAtEntry > 0 ? t.pnl / t.riskAtEntry : 0), 0) / T;
        return val(r, `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`);
      })()
    : gate(`needs 20 trades (${T} so far)`);

  const skewCaution = sharpeNum !== null && sortinoNum !== null
    && Math.abs(sharpeNum) > 0.01 && Math.abs(sortinoNum / sharpeNum) > 2;

  return {
    totalReturnPct, totalPnl, cagr, sharpe, sortino, maxDrawdown, calmar,
    profitFactor, winRate, payoffRatio, rExpectancy, skewCaution,
    marksCount: N, tradesCount: T,
  };
}

/** True if the last non-carried mark is older than 3 trading days — block new entries. */
export function marksTooStale(portfolio: PaperPortfolio): boolean {
  const real = portfolio.equityHistory.filter((m) => !m.carried);
  if (real.length === 0) return false; // brand-new book: entries allowed on first cycle
  const last = real[real.length - 1].d;
  return tradingDaysBetween(last, new Date().toISOString().split('T')[0]) > 3;
}

export function tradeRMultiple(t: PaperClosedTrade): number {
  return t.riskAtEntry > 0 ? t.pnl / t.riskAtEntry : 0;
}
