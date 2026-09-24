// Long call / long put idea scanner — the directional mirror of scanner.ts.
// Pipeline per docs/LONG_STRATEGY_DESIGN.md:
//   Yahoo history (free) → factor composites → only factor-qualified tickers
//   spend MarketData credits (quote + expirations + ONE chain side) → funnel
//   stages 1–6 → contract selection → LongIdea.

import type { LongIdea, LongContract, ScanProgress, FactorScore } from '../types';
import {
  getQuote, getExpirations, getOptionChain,
  resetRequestCount, getCreditCount, BudgetExceededError, enforceBudget, setCreditCategory,
} from './marketdata';
import type { MDOption } from './marketdata';
import { fetchHistory, verifyHistorySource, HistoryUnavailableError, type DailyBars } from './history';
import {
  computeBullish, computeBearish, detectEntryTrigger,
  atr14, historicalVol, avgAbsDailyReturn, medianHistoricalMove, sma,
} from './factors';
import { resolveIVRank, getCachedIVData } from './ivRank';
import { getSectorInfo } from './sectors';
import { getRemainingCredits } from './creditLedger';

export const DEFAULT_LONG_SCAN_CREDITS = 2000;
// Funnel philosophy (retuned 2026-09-24): the screener RANKS the best
// available setups instead of gatekeeping for the textbook-ideal one.
// Quality shortfalls (rich vol, stretched expected move, mid HV) become
// score penalties + flags; hard rejects are reserved for true viability
// failures (illiquidity, missing data, extremes). The 'trade' tier still
// demands the research-brief criteria; everything else surfaces as
// 'watchlist' with its problems stated.
const BULL_TRADE = 70, BULL_WATCH = 55;
const BEAR_TRADE = 75, BEAR_WATCH = 60;
const HV_HARD_FLOOR = 12;   // stage-0 reject below (was 15; 12-15 now flagged)
const IVR_HARD_MAX = 65;    // reject above (was 50; 50-65 now penalized+flagged)
const IVHV_HARD_MAX = 1.6;  // reject above (was 1.25; bands below flagged)
const EM_HARD_MAX = 1.5;    // reject above (was 1.2; 1.2-1.5 penalized+flagged)
const SCAN_DELAY_MS = 400;

export interface LongScanResult {
  ideas: LongIdea[];
  degradedToCacheOnly: boolean;
  creditsUsed: number;
  skips: string[]; // human-readable skip/veto log
  stageCounts: Record<string, number>; // rejections per funnel stage (for tuning)
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dteFromDate(iso: string): number {
  const exp = new Date(iso + 'T16:00:00');
  return Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function pickLongExpiration(expirations: string[]): string | null {
  const inBand = (lo: number, hi: number) =>
    expirations
      .map((e) => ({ e, dte: dteFromDate(e) }))
      .filter(({ dte }) => dte >= lo && dte <= hi)
      .sort((a, b) => Math.abs(a.dte - 90) - Math.abs(b.dte - 90))[0]?.e ?? null;
  return inBand(60, 120) ?? inBand(45, 150);
}

interface ContractPick {
  opt: MDOption;
  liquidityScore: number; // 0-100
  reject?: string;
}

/** Funnel stages 4–5: delta band 0.55–0.75 target 0.65, liquidity gates, ATM fallback. */
function pickContract(chain: MDOption[], side: 'call' | 'put'): ContractPick | { reject: string } {
  const usable = chain.filter((o) => o.side === side && (o.mid > 0 || (o.bid > 0 && o.ask > 0)));
  if (usable.length === 0) return { reject: 'no chain data' };

  const liquidityOf = (o: MDOption): { ok: boolean; score: number; why: string } => {
    const mid = o.mid || (o.bid + o.ask) / 2;
    const spread = o.ask - o.bid;
    const spreadPct = mid > 0 ? spread / mid : 1;
    if ((o.bid || 0) < 0.05) return { ok: false, score: 0, why: 'no real bid' };
    const absCap = mid < 5 ? 0.30 : 0.50;
    if (spread > absCap) return { ok: false, score: 0, why: `spread $${spread.toFixed(2)} > cap` };
    if (spreadPct > 0.15) return { ok: false, score: 0, why: `spread ${(spreadPct * 100).toFixed(0)}% of mid` };
    if (spreadPct > 0.10 && !(spread <= 0.10 || o.openInterest >= 1000)) {
      return { ok: false, score: 0, why: `spread ${(spreadPct * 100).toFixed(0)}% without depth` };
    }
    if ((o.openInterest || 0) < 100) return { ok: false, score: 0, why: `OI ${o.openInterest}` };
    // Score: spread tier 60%, OI 40%
    const spreadScore = spreadPct <= 0.05 ? 100 : spreadPct <= 0.10 ? 70 : 40;
    const oiScore = o.openInterest >= 1000 ? 100 : o.openInterest >= 250 ? 70 : 40;
    return { ok: true, score: 0.6 * spreadScore + 0.4 * oiScore, why: '' };
  };

  const band = usable
    .filter((o) => Math.abs(o.delta) >= 0.55 && Math.abs(o.delta) <= 0.75)
    .map((o) => ({ o, liq: liquidityOf(o) }))
    .filter((x) => x.liq.ok)
    .sort((a, b) =>
      Math.abs(Math.abs(a.o.delta) - 0.65) - Math.abs(Math.abs(b.o.delta) - 0.65)
      || (a.o.ask - a.o.bid) - (b.o.ask - b.o.bid)
      || b.o.openInterest - a.o.openInterest);
  if (band[0]) return { opt: band[0].o, liquidityScore: band[0].liq.score };

  // ATM 0.50Δ fallback
  const atm = usable
    .map((o) => ({ o, liq: liquidityOf(o) }))
    .filter((x) => x.liq.ok)
    .sort((a, b) => Math.abs(Math.abs(a.o.delta) - 0.50) - Math.abs(Math.abs(b.o.delta) - 0.50))[0];
  if (atm && Math.abs(Math.abs(atm.o.delta) - 0.50) <= 0.08) {
    return { opt: atm.o, liquidityScore: atm.liq.score * 0.8 };
  }
  return { reject: 'no liquid contract in delta band (0.55–0.75) or at ATM' };
}

export async function scanForLongIdeas(
  universe: string[],
  onProgress: (p: ScanProgress) => void,
  marketDataToken?: string,
  creditBudget?: number,
): Promise<LongScanResult> {
  resetRequestCount();
  setCreditCategory('longScan');
  const scanCredits = Math.max(0, Math.min(creditBudget ?? DEFAULT_LONG_SCAN_CREDITS, getRemainingCredits()));
  let cacheOnly = scanCredits === 0;
  const ideas: LongIdea[] = [];
  const skips: string[] = [];
  const stageCounts: Record<string, number> = {};
  const reject = (stage: string, msg: string) => {
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
    skips.push(msg);
  };
  const total = universe.length;
  const now = new Date().toISOString();

  const emit = (partial: Partial<ScanProgress>) => {
    onProgress({
      phase: 'fetching', current: 0, total, currentTicker: '', message: '',
      requestsUsed: getCreditCount(), requestBudget: scanCredits, ...partial,
    });
  };

  emit({ message: 'Fetching benchmark history (SPY + sectors)...' });
  // Preflight: verify the history SOURCE itself (production snapshot) before
  // any work. This cannot be masked by localStorage cache the way a plain
  // SPY fetch can — a snapshot outage aborts loudly here instead of
  // surfacing as dozens of per-ticker "history" rejects.
  await verifyHistorySource();
  let spy: DailyBars | null;
  try {
    spy = await fetchHistory('SPY');
  } catch (e) {
    if (e instanceof HistoryUnavailableError) throw e;
    spy = null;
  }
  const sectorBars = new Map<string, DailyBars | null>();

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];
    emit({ current: i + 1, currentTicker: ticker, message: `Analyzing ${ticker} (${i + 1}/${total})` });

    try {
      // --- Factor stage (free: Yahoo history only) ---
      // Keep the REAL failure reason — "insufficient history" as a blanket
      // label hid a snapshot-fetch outage behind a misleading message.
      let bars: DailyBars | null = null;
      let histErr = '';
      try {
        bars = await fetchHistory(ticker);
      } catch (e) {
        histErr = e instanceof Error ? e.message.substring(0, 110) : 'history fetch failed';
      }
      if (!bars || bars.closes.length < 260) {
        reject('history', `${ticker}: ${histErr || `only ${bars?.closes.length ?? 0} bars (need 260)`}`);
        continue;
      }
      const close = bars.closes[bars.closes.length - 1];

      // Stage 0 underlying floor
      const advDollar = sma(bars.closes.map((c, j) => c * bars.volumes[j]), 20);
      const hv20 = historicalVol(bars.closes, 20);
      const hv30 = historicalVol(bars.closes, 30);
      const hv60 = historicalVol(bars.closes, 60);
      if (close < 20) { reject('stage0-floor', `${ticker}: price $${close.toFixed(0)} < $20`); continue; }
      if (advDollar < 25e6) { reject('stage0-floor', `${ticker}: dollar volume < $25M`); continue; }
      if (hv20 < HV_HARD_FLOOR) { reject('stage0-floor', `${ticker}: HV20 ${hv20.toFixed(0)}% < ${HV_HARD_FLOOR}% (dead stock)`); continue; }
      const lowHvFlag = hv20 < 15 ? `HV20 ${hv20.toFixed(0)}% is modest — the underlying must trend, not just wiggle` : '';

      const info = getSectorInfo(ticker);
      if (!sectorBars.has(info.etf)) {
        sectorBars.set(info.etf, await fetchHistory(info.etf).catch(() => null));
      }
      const sector = sectorBars.get(info.etf) ?? null;

      const cachedIV = getCachedIVData(ticker);
      const provisionalIVR = cachedIV?.ivRank ?? 50;

      const ctx = { bars, spy, sector, ivRank: provisionalIVR };
      const bull = computeBullish(ctx);
      const bear = computeBearish(ctx);

      let direction: 'bull' | 'bear' | null = null;
      if (bull.score >= BULL_WATCH && bull.score >= bear.score && !bull.gated) direction = 'bull';
      else if (bear.score >= BEAR_WATCH && !bear.gated) direction = 'bear';
      if (!direction) { stageCounts['factor-threshold'] = (stageCounts['factor-threshold'] ?? 0) + 1; continue; }

      const result = direction === 'bull' ? bull : bear;
      const side: 'call' | 'put' = direction === 'bull' ? 'call' : 'put';
      const tradeFloor = direction === 'bull' ? BULL_TRADE : BEAR_TRADE;

      // --- Options stage (credits) ---
      if (cacheOnly) { reject('budget', `${ticker}: credit budget exhausted (factor score ${result.score.toFixed(0)})`); continue; }
      try {
        enforceBudget(scanCredits);
      } catch (e) {
        if (e instanceof BudgetExceededError) { cacheOnly = true; reject('budget', `${ticker}: credit budget exhausted`); continue; }
        throw e;
      }

      const quote = await getQuote(ticker, marketDataToken);
      const price = quote.last || quote.mid || close;
      const expirations = await getExpirations(ticker, marketDataToken);
      const expiration = pickLongExpiration(expirations);
      if (!expiration) { reject('expirations', `${ticker}: no expiration in 45–150 DTE`); continue; }

      const chain = await getOptionChain(ticker, marketDataToken, { expiration, side, strikeLimit: 12 });
      if (chain.length === 0) { reject('chain', `${ticker}: empty chain`); continue; }

      // Resolve IV rank from the fetched chain (records today's sample)
      const ivData = resolveIVRank(ticker, chain, price);
      const ivRank = ivData.ivRank;
      const ivRankSource = ivData.source ?? 'smile';

      // Re-apply the IVR gate with the real number (funnel stage 1a).
      // > 65 rejects; 50–65 passes penalized + flagged (vol isn't cheap, but
      // a strong directional setup can still carry a flagged idea).
      if (ivRank > IVR_HARD_MAX) { reject('ivr-gate', `${ticker}: IVR ${ivRank.toFixed(0)} > ${IVR_HARD_MAX} (long premium far too expensive)`); continue; }
      const richIvrFlag = ivRank > 50 ? `IVR ${ivRank.toFixed(0)} — vol is NOT cheap; strongly prefer the debit-spread structure` : '';

      // Dead-stock disambiguation (stage 1c) — per the research brief this
      // applies at the EXTREME-cheap end (IVR < 10), where low IV is either
      // a bargain or an accurate forecast of a stock that stopped moving.
      // Applying it at every IVR (as originally shipped) rejected half the
      // large caps in any calm tape.
      if (ivRank < 10) {
        const aliveA = avgAbsDailyReturn(bars.closes, 20) >= 0.8;
        const aliveB = hv20 >= 0.75 * hv60;
        if (!aliveA || !aliveB) { reject('dead-stock', `${ticker}: IVR ${ivRank.toFixed(0)} with failed alive checks — low IV looks like a correct forecast, not a bargain`); continue; }
      }

      const pick = pickContract(chain, side);
      if ('reject' in pick && pick.reject) { reject('liquidity', `${ticker}: ${pick.reject}`); continue; }
      const { opt, liquidityScore } = pick as ContractPick;

      const mid = opt.mid || (opt.bid + opt.ask) / 2;
      const ivPct = (opt.iv || 0) * 100;

      // Stage 1b: IV vs realized. The volatility risk premium means most
      // names sit at 1.1–1.4× most of the time — treat that as a cost to
      // rank on (and flag), not a disqualifier. Only a truly rich > 1.6
      // rejects outright.
      const ivHvRatio = ivPct / Math.max(hv20, hv30, 1);
      let ivHvFlag = '';
      if (ivHvRatio > IVHV_HARD_MAX) { reject('iv-vs-hv', `${ticker}: IV/HV ${ivHvRatio.toFixed(2)} > ${IVHV_HARD_MAX}`); continue; }
      if (ivHvRatio > 1.25) {
        ivHvFlag = `IV is ${ivHvRatio.toFixed(2)}× realized vol — a meaningful markup; a debit spread trims it substantially`;
      } else if (ivHvRatio > 1.10) {
        ivHvFlag = `IV is ${ivHvRatio.toFixed(2)}× realized vol — paying slightly above fair; a debit spread trims the markup`;
      }

      // Stage 3: expected vs historical move over the holding horizon.
      // Compared against the SIGMA-EQUIVALENT of the historical median
      // (median × 1.4826): the implied EM is a 1σ move while the median
      // |move| is only ~0.67σ, so the raw-median ratio sat near 1.49 even at
      // perfectly fair pricing and rejected essentially everything.
      const horizon = Math.min(opt.dte, 90);
      const tradingDays = Math.round(horizon * 252 / 365);
      const impliedEM = price * (ivPct / 100) * Math.sqrt(horizon / 365);
      const hist = medianHistoricalMove(bars.closes, Math.max(10, tradingDays));
      const emRatio = Number.isFinite(hist.sigmaEquiv) && hist.sigmaEquiv > 0 ? (impliedEM / price) / hist.sigmaEquiv : 1;
      if (emRatio > EM_HARD_MAX) { reject('expected-move', `${ticker}: implied move ${emRatio.toFixed(2)}× historical σ-equivalent`); continue; }
      if (Number.isFinite(hist.p90) && impliedEM / price > hist.p90) { reject('expected-move', `${ticker}: implied move above p90 of historical moves`); continue; }

      // Extrinsic sanity: hard reject only when time value dominates an
      // ITM contract (> 55%); 40–55% passes flagged.
      const intrinsic = side === 'call' ? Math.max(0, price - opt.strike) : Math.max(0, opt.strike - price);
      const extrinsicPct = mid > 0 ? Math.max(0, mid - intrinsic) / mid : 1;
      if (extrinsicPct > 0.55 && Math.abs(opt.delta) >= 0.55) {
        reject('extrinsic', `${ticker}: extrinsic ${(extrinsicPct * 100).toFixed(0)}% at ${Math.abs(opt.delta).toFixed(2)}Δ — IV far fatter than deltas imply`);
        continue;
      }

      // Entry trigger + stop context (rules R3/R4/R6/R7 + R10)
      const trig = detectEntryTrigger(bars, direction);
      const atr = atr14(bars);
      const sigRef = trig?.sigRef ?? sma(bars.closes, 20);
      const stopLevel = direction === 'bull'
        ? Math.min(sigRef, price) - 1.0 * atr
        : Math.max(sigRef, price) + 1.0 * atr;

      // Flags (stage 6 — warn, don't reject)
      const flags: string[] = [];
      if (lowHvFlag) flags.push(lowHvFlag);
      if (richIvrFlag) flags.push(richIvrFlag);
      if (ivHvFlag) flags.push(ivHvFlag);
      if (!richIvrFlag && ivRank > 30) flags.push(`IVR ${ivRank.toFixed(0)} > 30 — a debit spread would cut vega/theta cost`);
      if (emRatio > 1.2) flags.push(`Implied move is ${emRatio.toFixed(2)}× the historical σ-equivalent — the market is pricing an outsized move`);
      else if (emRatio > 1.0) flags.push('Implied move slightly exceeds the historical σ-equivalent for this horizon');
      if (extrinsicPct > 0.40) flags.push(`Extrinsic is ${(extrinsicPct * 100).toFixed(0)}% of premium — heavy theta bill`);
      if (ivRankSource === 'smile') flags.push('IVR is a smile-shape estimate until 20 daily samples accrue');

      // 'trade' tier still demands the full research-brief criteria — the
      // loosened hard gates only decide what gets SHOWN, not what the paper
      // engine may trade.
      const researchClean = ivRank <= 50 && ivHvRatio <= 1.25 && emRatio <= 1.2 && !lowHvFlag;

      // Blended display score
      const volScore = 0.6 * Math.max(0, 100 - 1.5 * ivRank) + 0.4 * Math.max(0, Math.min(100, ((1.25 - ivHvRatio) / 0.5) * 100));
      const emScore = Math.max(0, Math.min(100, ((1.2 - emRatio) / 0.6) * 100));
      const overallScore = 0.6 * result.score + 0.2 * volScore + 0.1 * liquidityScore + 0.1 * emScore;

      const contract: LongContract = {
        optionSymbol: opt.optionSymbol,
        side,
        strike: opt.strike,
        expirationDate: new Date(opt.expiration * 1000).toISOString().split('T')[0],
        dte: opt.dte,
        bid: opt.bid || 0,
        ask: opt.ask || 0,
        mid: +mid.toFixed(2),
        delta: opt.delta || 0,
        iv: ivPct,
        theta: opt.theta || 0,
        vega: opt.vega || 0,
        volume: opt.volume || 0,
        openInterest: opt.openInterest || 0,
        extrinsicPct,
      };

      const factors: FactorScore[] = result.factors;
      ideas.push({
        id: crypto.randomUUID(),
        ticker,
        direction: side === 'call' ? 'LC' : 'LP',
        currentPrice: price,
        compositeScore: result.score,
        overallScore,
        factors,
        contract,
        ivRank,
        ivRankSource,
        hv20,
        hv60,
        ivHvRatio,
        emRatio,
        entryTrigger: trig?.trigger ?? null,
        triggerDate: trig?.triggerDate ?? null,
        sigRef,
        atr,
        stopLevel,
        flags,
        tier: result.score >= tradeFloor && trig && researchClean ? 'trade' : 'watchlist',
        generatedAt: now,
      });
    } catch (e) {
      if (e instanceof BudgetExceededError) { cacheOnly = true; continue; }
      reject('error', `${ticker}: ${e instanceof Error ? e.message.substring(0, 80) : 'failed'}`);
    }

    if (i < universe.length - 1) await delay(SCAN_DELAY_MS);
  }

  ideas.sort((a, b) => b.overallScore - a.overallScore);
  console.debug('[longScanner]', { ideas: ideas.length, creditsUsed: getCreditCount(), cacheOnly, stageCounts, skips });
  return { ideas, degradedToCacheOnly: cacheOnly, creditsUsed: getCreditCount(), skips, stageCounts };
}
