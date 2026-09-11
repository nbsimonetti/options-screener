// Deterministic paper-trading engine — $50,000 book, MID fills only.
// Rule set: docs/LONG_STRATEGY_DESIGN.md §3–4 (long rules R8–R19; short-book
// management: 50%-of-credit profit target, 21-DTE, 2×-credit loss backstop).
// Every action is journaled with the rule that triggered it. Objective is
// risk-adjusted return: sizing is fixed-fractional risk per trade, portfolio
// caps bound aggregate premium, net delta, and concentration.

import type {
  PaperPortfolio, PaperPosition, PaperClosedTrade, PaperJournalEntry,
  LongIdea, InvestmentIdea, PaperKind,
} from '../types';
import { PAPER_STARTING_CAPITAL, LS_PAPER_PORTFOLIO } from '../types';
import { getOptionQuote, getQuote, setCreditCategory, getCreditCount } from './marketdata';
import { allocateBudget } from './creditLedger';
import { canonicalUnderlying, getSectorInfo } from './sectors';
import { marksTooStale } from './paperMetrics';

// --- Sizing parameters ---
// Per-position risk budget (risk = full debit for longs, 2σ stress for CSPs).
// Raised from the research default of 1.5% to 10% at the user's request —
// note a 10-loss streak at full size now costs ~65% of the book vs ~14%.
export const RISK_PCT = 0.10;
// Aggregate open long premium (R15). Was 10% when positions were 1.5% each;
// scaled to 40% so the 8-position book (R16) stays reachable at larger sizes.
export const AGG_PREMIUM_PCT = 0.40;

// --- Persistence ---

export function loadPortfolio(): PaperPortfolio {
  try {
    const stored = localStorage.getItem(LS_PAPER_PORTFOLIO);
    if (stored) {
      const p: PaperPortfolio = JSON.parse(stored);
      if (p.version === 1) return p;
    }
  } catch { /* fall through */ }
  return freshPortfolio();
}

export function freshPortfolio(): PaperPortfolio {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    cash: PAPER_STARTING_CAPITAL,
    positions: [],
    closedTrades: [],
    equityHistory: [],
    journal: [{
      at: new Date().toISOString(),
      action: 'INFO',
      detail: `Portfolio initialized with $${PAPER_STARTING_CAPITAL.toLocaleString()} paper capital.`,
    }],
    lastCycleAt: null,
  };
}

export function savePortfolio(p: PaperPortfolio) {
  try {
    // Cap journal growth
    if (p.journal.length > 500) p.journal = p.journal.slice(-500);
    localStorage.setItem(LS_PAPER_PORTFOLIO, JSON.stringify(p));
  } catch { /* quota */ }
}

// --- Valuation ---

/** Equity = cash + long marks − short (CSP) marks-to-buy-back. */
export function equityOf(p: PaperPortfolio): number {
  let eq = p.cash;
  for (const pos of p.positions) {
    const v = pos.lastMark * 100 * pos.contracts;
    eq += pos.kind === 'CSP' ? -v : v;
  }
  return eq;
}

export function collateralOutstanding(p: PaperPortfolio): number {
  return p.positions.reduce((s, pos) => s + pos.collateral, 0);
}

export function openLongDebits(p: PaperPortfolio): number {
  return p.positions.filter((x) => x.kind !== 'CSP').reduce((s, x) => s + x.entryDebit, 0);
}

function netDeltaNotional(p: PaperPortfolio): number {
  return p.positions.reduce((s, pos) => {
    const delta = pos.kind === 'CSP' ? -pos.entryDelta : pos.entryDelta; // short put: -(-δ) = +
    return s + delta * 100 * pos.contracts * pos.lastUnderlying;
  }, 0);
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function dteOf(expirationDate: string): number {
  return Math.ceil((new Date(expirationDate + 'T16:00:00').getTime() - Date.now()) / 86400000);
}

function tradingDaysOpen(openedAt: string): number {
  const cal = (Date.now() - new Date(openedAt).getTime()) / 86400000;
  return Math.round(cal * 5 / 7);
}

export interface CycleResult {
  portfolio: PaperPortfolio;
  summary: string;
  creditsUsed: number;
}

export async function runTradingCycle(
  input: PaperPortfolio,
  longIdeas: LongIdea[],
  shortIdeas: InvestmentIdea[],
  marketDataToken?: string,
): Promise<CycleResult> {
  const p: PaperPortfolio = JSON.parse(JSON.stringify(input));
  const log = (e: Omit<PaperJournalEntry, 'at'>) => p.journal.push({ at: new Date().toISOString(), ...e });
  const today = todayISO();
  const creditsBefore = getCreditCount();

  setCreditCategory('marking');
  const alloc = allocateBudget(p.positions.length);
  let markingSpent = 0;
  let freshMarks = 0;

  // ---------- 1. MARK open positions at MID ----------
  for (const pos of p.positions) {
    if (markingSpent >= alloc.marking) {
      log({ action: 'MARK', ticker: pos.ticker, detail: `Marking budget exhausted — carrying last mark ${pos.lastMark.toFixed(2)} from ${pos.lastMarkDate}.` });
      continue;
    }
    try {
      const oq = await getOptionQuote(pos.optionSymbol, marketDataToken);
      markingSpent += 1;
      const crossed = !oq || !(oq.bid > 0) || !(oq.ask > 0) || oq.ask < oq.bid;
      if (crossed) {
        log({ action: 'MARK', ticker: pos.ticker, detail: `Quote missing/crossed for ${pos.optionSymbol} — carrying last mark (never trade on a bad quote).` });
        continue;
      }
      pos.lastMark = +(((oq!.bid + oq!.ask) / 2)).toFixed(2);
      pos.lastMarkDate = today;
      if (oq!.underlyingPrice > 0) {
        pos.lastUnderlying = oq!.underlyingPrice;
      } else {
        try {
          const q = await getQuote(pos.ticker, marketDataToken);
          markingSpent += 1;
          pos.lastUnderlying = q.last || q.mid || pos.lastUnderlying;
        } catch { /* keep last */ }
      }
      // Track the favorable extreme for the R9 trail (highest close for
      // calls; the same field stores the LOWEST close for puts).
      if (pos.kind === 'LP') pos.highestClose = Math.min(pos.highestClose || Infinity, pos.lastUnderlying);
      else pos.highestClose = Math.max(pos.highestClose || 0, pos.lastUnderlying);
      freshMarks += 1;
    } catch (e) {
      log({ action: 'ERROR', ticker: pos.ticker, detail: `Mark failed: ${e instanceof Error ? e.message.substring(0, 80) : 'unknown'} — carrying last mark.` });
    }
  }

  // ---------- 2. Equity mark ----------
  const equityNow = equityOf(p);
  const carried = p.positions.length > 0 && freshMarks === 0;
  const existing = p.equityHistory.findIndex((m) => m.d === today);
  const mark = { d: today, equity: +equityNow.toFixed(2), ...(carried ? { carried: true } : {}) };
  if (existing >= 0) p.equityHistory[existing] = mark;
  else p.equityHistory.push(mark);
  log({ action: 'MARK', detail: `Equity marked at $${equityNow.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${freshMarks}/${p.positions.length} positions freshly marked${carried ? ' — CARRIED' : ''}).` });

  // ---------- 3. EXITS (before entries, priority order, MID fills) ----------
  const closePosition = (pos: PaperPosition, contracts: number, rule: string, detail: string) => {
    const proceeds = pos.lastMark * 100 * contracts;
    let pnl: number;
    if (pos.kind === 'CSP') {
      p.cash -= proceeds; // buy back
      pnl = (pos.entryMid - pos.lastMark) * 100 * contracts;
    } else {
      p.cash += proceeds; // sell to close
      pnl = (pos.lastMark - pos.entryMid) * 100 * contracts;
    }
    const closed: PaperClosedTrade = {
      id: crypto.randomUUID(),
      kind: pos.kind, ticker: pos.ticker, optionSymbol: pos.optionSymbol,
      contracts, strike: pos.strike,
      openedAt: pos.openedAt, closedAt: new Date().toISOString(),
      entryMid: pos.entryMid, exitMid: pos.lastMark,
      pnl: +pnl.toFixed(2),
      riskAtEntry: pos.riskAtEntry * (contracts / Math.max(1, pos.contracts + (pos.scaledOut ? contracts : 0))),
      exitRule: rule, entryScore: pos.entryScore,
    };
    p.closedTrades.push(closed);
    pos.contracts -= contracts;
    if (pos.contracts <= 0) {
      p.positions = p.positions.filter((x) => x.id !== pos.id);
    }
    log({ action: 'CLOSE', ticker: pos.ticker, rule, detail: `${detail} — ${contracts}× ${pos.optionSymbol} @ mid ${pos.lastMark.toFixed(2)}, P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}.` });
  };

  for (const pos of [...p.positions]) {
    const dte = dteOf(pos.expirationDate);
    const freshToday = pos.lastMarkDate === today;
    const ratio = pos.entryMid > 0 ? pos.lastMark / pos.entryMid : 1;

    if (pos.kind === 'CSP') {
      if (!freshToday && dte > 21) continue;
      if (freshToday && ratio <= 0.5) { closePosition(pos, pos.contracts, 'S-50%', 'Short premium reached 50% of max profit'); continue; }
      if (freshToday && ratio >= 3.0) { closePosition(pos, pos.contracts, 'S-backstop', 'Loss ≥ 2× credit received'); continue; }
      if (dte <= 21) { closePosition(pos, pos.contracts, 'S-21DTE', `21-DTE management (DTE ${dte})${freshToday ? '' : ' — STALE MARK fill'}`); continue; }
      continue;
    }

    // Long rules (skip mark-based rules on stale marks; R11 always enforced)
    if (freshToday && ratio <= 0.40) { closePosition(pos, pos.contracts, 'R8', `Backstop: mark −${((1 - ratio) * 100).toFixed(0)}% of debit`); continue; }
    if (freshToday && !pos.scaledOut && ratio >= 2.0) {
      if (pos.contracts >= 2) {
        const half = Math.floor(pos.contracts / 2);
        const before = pos.contracts;
        pos.scaledOut = true;
        closePosition(pos, half, 'R9', `Target 2× debit — scaling out ${half}/${before}, trailing remainder at 2×ATR`);
        continue;
      }
      closePosition(pos, pos.contracts, 'R9', 'Target 2× debit reached');
      continue;
    }
    if (freshToday && pos.scaledOut) {
      const trailHit = pos.kind === 'LC'
        ? pos.lastUnderlying < pos.highestClose - 2 * pos.atrEntry
        : pos.lastUnderlying > pos.highestClose + 2 * pos.atrEntry;
      if (trailHit) { closePosition(pos, pos.contracts, 'R9-trail', `2×ATR trail from ${pos.highestClose.toFixed(2)}`); continue; }
    }
    if (freshToday) {
      const stopHit = pos.kind === 'LC' ? pos.lastUnderlying < pos.stopLevel : pos.lastUnderlying > pos.stopLevel;
      if (stopHit) { closePosition(pos, pos.contracts, 'R10', `Thesis invalidated: underlying ${pos.lastUnderlying.toFixed(2)} through stop ${pos.stopLevel.toFixed(2)}`); continue; }
    }
    if (dte <= 21) { closePosition(pos, pos.contracts, 'R11', `Time stop at 21 DTE (DTE ${dte})${freshToday ? '' : ' — STALE MARK fill'}`); continue; }
    if (freshToday && tradingDaysOpen(pos.openedAt) >= 40 && ratio < 1.2) {
      closePosition(pos, pos.contracts, 'R13', `Stale sweep: ${tradingDaysOpen(pos.openedAt)} sessions open, never reached +20%`);
      continue;
    }
  }

  // ---------- 4. ENTRIES ----------
  const equity = equityOf(p);
  if (marksTooStale(p)) {
    log({ action: 'VETO', detail: 'Entries blocked — last successful mark is > 3 trading days old (never size off stale equity).' });
  } else {
    let opened = 0;
    const freshCutoff = Date.now() - 3 * 86400000;
    const heldUnderlyings = new Set(p.positions.map((x) => canonicalUnderlying(x.ticker)));

    // --- Long entries ---
    const longCandidates = longIdeas
      .filter((i) => i.tier === 'trade' && i.entryTrigger && i.triggerDate)
      .filter((i) => new Date(i.generatedAt).getTime() >= freshCutoff)
      .filter((i) => Date.now() - new Date(i.triggerDate! + 'T16:00:00').getTime() <= 4 * 86400000)
      .sort((a, b) => b.overallScore - a.overallScore);

    for (const idea of longCandidates) {
      if (opened >= 2) { log({ action: 'VETO', ticker: idea.ticker, rule: 'R16', detail: 'Max 2 new positions per cycle.' }); break; }
      const longCount = p.positions.filter((x) => x.kind !== 'CSP').length;
      if (longCount >= 8) { log({ action: 'VETO', ticker: idea.ticker, rule: 'R16', detail: 'Max 8 open long positions.' }); break; }
      if (heldUnderlyings.has(canonicalUnderlying(idea.ticker))) {
        log({ action: 'VETO', ticker: idea.ticker, rule: 'R18', detail: 'Already holding this underlying.' });
        continue;
      }
      const bucket = getSectorInfo(idea.ticker).bucket;
      const dirSign = idea.direction === 'LC' ? 1 : -1;
      const sameBucket = p.positions.filter((x) =>
        getSectorInfo(x.ticker).bucket === bucket && (x.kind === 'LC' ? 1 : x.kind === 'LP' ? -1 : 1) === dirSign).length;
      const bucketCap = bucket === 'index-etf' ? 2 : 3;
      if (sameBucket >= bucketCap) {
        log({ action: 'VETO', ticker: idea.ticker, rule: 'R19', detail: `Bucket "${bucket}" already at ${sameBucket} same-direction positions.` });
        continue;
      }

      // Fresh quote at entry — never fill on scan-time (stale) prices.
      let oq;
      try {
        oq = await getOptionQuote(idea.contract.optionSymbol, marketDataToken);
      } catch { oq = null; }
      if (!oq || !(oq.bid > 0) || !(oq.ask > 0) || oq.ask < oq.bid) {
        log({ action: 'SKIP', ticker: idea.ticker, detail: `Entry quote missing/crossed for ${idea.contract.optionSymbol} — no fill on a bad quote.` });
        continue;
      }
      const mid = +(((oq.bid + oq.ask) / 2)).toFixed(2);
      const spreadPct = mid > 0 ? (oq.ask - oq.bid) / mid : 1;
      if (oq.bid < 0.05 || spreadPct > 0.15) {
        log({ action: 'SKIP', ticker: idea.ticker, detail: `Liquidity floor failed at entry (bid ${oq.bid.toFixed(2)}, spread ${(spreadPct * 100).toFixed(0)}% of mid).` });
        continue;
      }

      // R14 sizing: RISK_PCT of current equity, whole contracts, never round up.
      const riskBudget = RISK_PCT * equity;
      const contracts = Math.floor(riskBudget / (mid * 100));
      if (contracts === 0) {
        log({ action: 'SKIP', ticker: idea.ticker, rule: 'R14', detail: `1 contract ($${(mid * 100).toFixed(0)}) exceeds the ${(RISK_PCT * 100).toFixed(0)}% risk budget ($${riskBudget.toFixed(0)}) — skipped, never rounded up.` });
        continue;
      }
      const debit = mid * 100 * contracts;

      if (openLongDebits(p) + debit > AGG_PREMIUM_PCT * equity) {
        log({ action: 'VETO', ticker: idea.ticker, rule: 'R15', detail: `Aggregate open premium would exceed ${(AGG_PREMIUM_PCT * 100).toFixed(0)}% of equity.` });
        continue;
      }
      const underlying = oq.underlyingPrice > 0 ? oq.underlyingPrice : idea.currentPrice;
      const newNotional = netDeltaNotional(p) + (oq.delta || idea.contract.delta) * 100 * contracts * underlying;
      if (Math.abs(newNotional) > 0.5 * equity) {
        log({ action: 'VETO', ticker: idea.ticker, rule: 'R17', detail: `Net delta notional would exceed 50% of equity ($${Math.abs(newNotional).toFixed(0)}).` });
        continue;
      }
      if (debit > p.cash - collateralOutstanding(p)) {
        log({ action: 'VETO', ticker: idea.ticker, detail: 'Insufficient free cash.' });
        continue;
      }

      p.cash -= debit;
      const pos: PaperPosition = {
        id: crypto.randomUUID(),
        kind: idea.direction as PaperKind,
        ticker: idea.ticker,
        optionSymbol: idea.contract.optionSymbol,
        contracts,
        strike: idea.contract.strike,
        expirationDate: idea.contract.expirationDate,
        openedAt: new Date().toISOString(),
        entryUnderlying: underlying,
        entryMid: mid,
        entryDebit: debit,
        entryDelta: oq.delta || idea.contract.delta,
        entryScore: idea.overallScore,
        sigRef: idea.sigRef,
        atrEntry: idea.atr,
        stopLevel: idea.stopLevel,
        riskAtEntry: debit,
        collateral: 0,
        spreadPctAtEntry: spreadPct,
        lastMark: mid,
        lastMarkDate: today,
        lastUnderlying: underlying,
        highestClose: underlying,
        scaledOut: false,
      };
      p.positions.push(pos);
      heldUnderlyings.add(canonicalUnderlying(idea.ticker));
      opened += 1;
      log({
        action: 'OPEN', ticker: idea.ticker, rule: `${idea.entryTrigger}/R14`,
        detail: `${idea.direction} ${contracts}× ${idea.contract.optionSymbol} @ mid ${mid.toFixed(2)} (debit $${debit.toFixed(0)}, ${(spreadPct * 100).toFixed(1)}% spread paid-vs-mid caveat). Trigger ${idea.entryTrigger} ${idea.triggerDate}; stop ${idea.stopLevel.toFixed(2)}; score ${idea.overallScore.toFixed(0)}.`,
      });
    }

    // --- Short (CSP) entry: max 1 open, stress-sized ---
    const hasCSP = p.positions.some((x) => x.kind === 'CSP');
    if (!hasCSP) {
      const cspCandidates = shortIdeas
        .filter((i) => i.position.strategy === 'CSP' && i.position.optionSymbol)
        .filter((i) => new Date(i.generatedAt).getTime() >= freshCutoff)
        .filter((i) => i.score.compositeScore >= 60)
        .filter((i) => !heldUnderlyings.has(canonicalUnderlying(i.position.ticker)))
        .sort((a, b) => b.score.compositeScore - a.score.compositeScore);

      const cand = cspCandidates[0];
      if (cand) {
        let oq;
        try {
          oq = await getOptionQuote(cand.position.optionSymbol!, marketDataToken);
        } catch { oq = null; }
        if (!oq || !(oq.bid > 0) || !(oq.ask > 0) || oq.ask < oq.bid) {
          log({ action: 'SKIP', ticker: cand.position.ticker, detail: 'CSP entry quote missing/crossed.' });
        } else {
          const mid = +(((oq.bid + oq.ask) / 2)).toFixed(2);
          const S = oq.underlyingPrice > 0 ? oq.underlyingPrice : cand.position.currentPrice;
          const iv = (oq.iv > 0 ? oq.iv : cand.position.iv / 100);
          const dte = oq.dte > 0 ? oq.dte : cand.position.dte;
          const sd1 = S * iv * Math.sqrt(dte / 365);
          const stress = Math.max(0, (cand.position.strikePrice - (S - 2 * sd1)) * 100 - mid * 100);
          const collateral = cand.position.strikePrice * 100;
          const freeCash = p.cash - collateralOutstanding(p);
          if (stress > RISK_PCT * equity) {
            log({ action: 'SKIP', ticker: cand.position.ticker, rule: 'S-size', detail: `CSP 2σ stress loss $${stress.toFixed(0)} exceeds ${(RISK_PCT * 100).toFixed(0)}% of equity ($${(RISK_PCT * equity).toFixed(0)}) — risk ≠ premium.` });
          } else if (collateral > Math.min(0.4 * equity, freeCash)) {
            log({ action: 'SKIP', ticker: cand.position.ticker, rule: 'S-size', detail: `CSP collateral $${collateral.toFixed(0)} exceeds 40% of equity or free cash.` });
          } else {
            p.cash += mid * 100;
            const pos: PaperPosition = {
              id: crypto.randomUUID(),
              kind: 'CSP',
              ticker: cand.position.ticker,
              optionSymbol: cand.position.optionSymbol!,
              contracts: 1,
              strike: cand.position.strikePrice,
              expirationDate: cand.position.expirationDate,
              openedAt: new Date().toISOString(),
              entryUnderlying: S,
              entryMid: mid,
              entryDebit: -mid * 100,
              entryDelta: -(Math.abs(oq.delta || cand.position.delta)),
              entryScore: cand.score.compositeScore,
              sigRef: S,
              atrEntry: 0,
              stopLevel: 0,
              riskAtEntry: Math.max(stress, mid * 100),
              collateral,
              spreadPctAtEntry: mid > 0 ? (oq.ask - oq.bid) / mid : 0,
              lastMark: mid,
              lastMarkDate: today,
              lastUnderlying: S,
              highestClose: S,
              scaledOut: false,
            };
            p.positions.push(pos);
            log({
              action: 'OPEN', ticker: cand.position.ticker, rule: 'S-entry',
              detail: `CSP 1× ${cand.position.optionSymbol} @ mid ${mid.toFixed(2)} (credit $${(mid * 100).toFixed(0)}, collateral $${collateral.toFixed(0)}, 2σ stress $${stress.toFixed(0)}). Exits: 50% credit / 21 DTE / 2× credit backstop.`,
            });
          }
        }
      }
    }
  }

  p.lastCycleAt = new Date().toISOString();
  const creditsUsed = getCreditCount() - creditsBefore;
  const finalEquity = equityOf(p);
  const summary = `Cycle complete — equity $${finalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ${p.positions.length} open, ${p.closedTrades.length} closed all-time, ${creditsUsed} credits used.`;
  log({ action: 'INFO', detail: summary });
  savePortfolio(p);
  return { portfolio: p, summary, creditsUsed };
}
