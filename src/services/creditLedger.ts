// Persistent daily API-credit ledger for MarketData.app.
//
// MarketData bills 1 credit per option symbol returned on /options/chain/
// (verified against their rate-limit docs 2026-09-11), and 1 credit per
// symbol on quotes/expirations. The old per-HTTP-request counter understated
// chain spend by up to strikeLimit (20×). This ledger tracks real credits,
// persists across sessions, and resets at the start of each calendar day.

export type CreditCategory = 'shortScan' | 'longScan' | 'marking' | 'lookup' | 'other';

export interface DailyLedger {
  date: string; // 'YYYY-MM-DD' local
  total: number;
  byCategory: Record<CreditCategory, number>;
}

const LEDGER_KEY = 'options-screener-credit-ledger';
const BUDGET_KEY = 'options-screener-daily-credit-budget';

export const DEFAULT_DAILY_CREDIT_BUDGET = 10000; // MarketData "Starter" plan
export const PLAN_PRESETS = [
  { label: 'Free (100/day)', value: 100 },
  { label: 'Starter (10,000/day)', value: 10000 },
  { label: 'Trader (100,000/day)', value: 100000 },
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyLedger(): DailyLedger {
  return {
    date: today(),
    total: 0,
    byCategory: { shortScan: 0, longScan: 0, marking: 0, lookup: 0, other: 0 },
  };
}

export function getLedger(): DailyLedger {
  try {
    const stored = localStorage.getItem(LEDGER_KEY);
    if (!stored) return emptyLedger();
    const parsed: DailyLedger = JSON.parse(stored);
    if (parsed.date !== today()) return emptyLedger(); // new day → fresh ledger
    return { ...emptyLedger(), ...parsed, byCategory: { ...emptyLedger().byCategory, ...parsed.byCategory } };
  } catch {
    return emptyLedger();
  }
}

export function recordCredits(credits: number, category: CreditCategory = 'other') {
  if (credits <= 0) return;
  const ledger = getLedger();
  ledger.total += credits;
  ledger.byCategory[category] += credits;
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* quota — ledger is best-effort */
  }
  ledgerListener?.(ledger);
}

export function getDailyCreditBudget(): number {
  try {
    const stored = localStorage.getItem(BUDGET_KEY);
    const n = stored ? Number(JSON.parse(stored)) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CREDIT_BUDGET;
  } catch {
    return DEFAULT_DAILY_CREDIT_BUDGET;
  }
}

export function setDailyCreditBudget(budget: number) {
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
  } catch { /* ignore */ }
}

export function getRemainingCredits(): number {
  return Math.max(0, getDailyCreditBudget() - getLedger().total);
}

// --- Daily allocation policy ---
//
// Priorities (highest first): marking open paper positions is the smallest,
// highest-value spend and is funded first; user-initiated lookups get a
// small reserve; everything else is a SHARED scan pool drawn first-come-
// first-served. Scans run one at a time on the user's own click, so a fixed
// short/long split just strands credits: the old 50/50 split capped the
// short scan at ~4,700 on a fresh Starter day while a cold full-universe
// scan costs ~6,200 (and the long scan never needs more than ~2,000).
// Each scan is still capped by its own per-scan default, and every scan
// degrades to cached-only data when the pool runs out.

export interface BudgetAllocation {
  marking: number;
  lookupReserve: number;
  scanAvailable: number; // shared pool for whichever scan runs next
}

export function allocateBudget(openPaperPositions: number): BudgetAllocation {
  const remaining = getRemainingCredits();
  // ~2 credits per position per cycle (option quote + underlying quote),
  // buffered ×2 so a retry or second cycle in the day still marks.
  const marking = Math.min(remaining, Math.max(10, openPaperPositions * 4));
  const afterMarking = Math.max(0, remaining - marking);
  // Lookups cost ~21 credits each; a flat ~10-lookup reserve (2% of budget,
  // min 100) protects them without starving scans the way 5% did.
  const lookupReserve = Math.min(afterMarking, Math.max(100, Math.round(getDailyCreditBudget() * 0.02)));
  return {
    marking,
    lookupReserve,
    scanAvailable: Math.max(0, afterMarking - lookupReserve),
  };
}

// --- Change listener for UI ---
let ledgerListener: ((l: DailyLedger) => void) | null = null;
export function onLedgerChange(cb: ((l: DailyLedger) => void) | null) {
  ledgerListener = cb;
}
