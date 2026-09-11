export type StrategyType = 'CSP' | 'CC';

export interface OptionPosition {
  id: string;
  ticker: string;
  strategy: StrategyType;
  currentPrice: number;
  strikePrice: number;
  premium: number;
  bid: number;
  ask: number;
  dte: number;
  expirationDate: string; // ISO "YYYY-MM-DD"
  delta: number;
  theta: number;           // per-share theta (negative for long options)
  vega: number;            // per-share vega
  gamma: number;           // per-share gamma
  iv: number;
  ivRank: number;
  atmIV?: number;          // ticker's current ATM implied vol, % — optional
  medianIV?: number;       // ticker's median chain IV, % — baseline for comparison
  extrinsicValue: number;  // time premium $ per share
  intrinsicValue: number;  // in-the-money $ per share
  volume: number;
  openInterest: number;
  nextEarningsDate: string;
  contractSize: number;
  // Preserved from the raw chain for position marking / delta math.
  signedDelta?: number;
  optionSymbol?: string;
  // Chain-detected binary-event kink: front-expiration ATM IV exceeds the
  // next expiration's by > 8 vol pts (almost always earnings). undefined =
  // insufficient data to tell.
  eventKink?: boolean;
}

export interface ScoringWeights {
  annualizedYield: number;
  delta: number;
  ivRank: number;
  liquidity: number;
  thetaEfficiency: number;
  otmDistance: number;
  earningsProximity: number;
}

export interface ScoreBreakdownItem {
  label: string;
  key: keyof ScoringWeights;
  rawValue: number;
  rawUnit: string;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
}

export interface PositionScore {
  compositeScore: number;
  breakdown: ScoreBreakdownItem[];
}

export interface WeightPreset {
  name: string;
  weights: ScoringWeights;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  annualizedYield: 25,
  delta: 20,
  ivRank: 15,
  liquidity: 15,
  thetaEfficiency: 10,
  otmDistance: 10,
  earningsProximity: 5,
};

export const WEIGHT_PRESETS: WeightPreset[] = [
  { name: 'Balanced', weights: { ...DEFAULT_WEIGHTS } },
  {
    name: 'Premium Heavy',
    weights: {
      annualizedYield: 35,
      delta: 10,
      ivRank: 25,
      liquidity: 10,
      thetaEfficiency: 10,
      otmDistance: 5,
      earningsProximity: 5,
    },
  },
  {
    name: 'Safety Heavy',
    weights: {
      annualizedYield: 10,
      delta: 30,
      ivRank: 10,
      liquidity: 15,
      thetaEfficiency: 10,
      otmDistance: 20,
      earningsProximity: 5,
    },
  },
];

// --- Configuration ---

export interface APIConfig {
  marketDataToken: string;
  claudeApiKey: string;
}

export const DEFAULT_API_CONFIG: APIConfig = {
  marketDataToken: '',
  claudeApiKey: '',
};

export const LS_API_CONFIG = 'options-screener-api-config';

export interface ChainFilter {
  strategy: StrategyType;
  minDelta: number;
  maxDelta: number;
  minDTE: number;
  maxDTE: number;
  minOTMPct: number;
  maxOTMPct: number;
}

export const DEFAULT_CHAIN_FILTER: ChainFilter = {
  strategy: 'CSP',
  minDelta: 0.10,
  maxDelta: 0.40,
  minDTE: 14,
  maxDTE: 60,
  minOTMPct: 2,
  maxOTMPct: 15,
};

export function createEmptyPosition(): OptionPosition {
  return {
    id: crypto.randomUUID(),
    ticker: '',
    strategy: 'CSP',
    currentPrice: 0,
    strikePrice: 0,
    premium: 0,
    bid: 0,
    ask: 0,
    dte: 30,
    expirationDate: '',
    delta: 0.3,
    theta: 0,
    vega: 0,
    gamma: 0,
    iv: 0,
    ivRank: 50,
    extrinsicValue: 0,
    intrinsicValue: 0,
    volume: 0,
    openInterest: 0,
    nextEarningsDate: '',
    contractSize: 100,
  };
}

// --- AI Idea Generator ---

export type AppView = 'screener' | 'ideas' | 'ideasLong' | 'macro' | 'paper';

export interface IdeaThesis {
  summary: string;
  setup: string;
  rationale: string;
  keyMetrics: string;
  risks: string[];
  catalysts: string[];
  confidence: 'high' | 'medium' | 'low';
  analystNote: string;
}

export interface InvestmentIdea {
  id: string;
  position: OptionPosition;
  score: PositionScore;
  thesis: IdeaThesis;
  generatedAt: string;
}

export interface ScanProgress {
  phase: 'idle' | 'fetching' | 'scoring' | 'analyzing' | 'complete' | 'error';
  current: number;
  total: number;
  currentTicker: string;
  message: string;
  requestsUsed: number;
  requestBudget: number;
}

export const LS_IDEAS = 'options-screener-ideas';
export const LS_WATCHLIST = 'options-screener-watchlist';
export const LS_EXCLUDED = 'options-screener-excluded';
export const LS_TABLE_SETS = 'options-screener-table-sets';
export const LS_SAVED_WATCHLISTS = 'options-screener-saved-watchlists';
export const LS_ACTIVE_WATCHLIST = 'options-screener-active-watchlist';

export interface ScanFilter {
  minAnnualYield: number; // decimal, e.g. 0.10 = 10%
  minDTE: number;
  maxDTE: number;
  minOTMPct: number;
  maxOTMPct: number;
}

export const DEFAULT_SCAN_FILTER: ScanFilter = {
  minAnnualYield: 0.10,
  minDTE: 14,
  maxDTE: 60,
  minOTMPct: 1,
  maxOTMPct: 15,
};

export const LS_SCAN_FILTER = 'options-screener-scan-filter';

// --- Long Strategy (Idea Generator (Long)) ---
// Design: docs/LONG_STRATEGY_DESIGN.md. LC = long call, LP = long put.

export type LongStrategyType = 'LC' | 'LP';

export type EntryTrigger = 'breakout' | 'pullback' | 'post-event';

export interface FactorScore {
  key: string;
  label: string;
  rawValue: number;
  rawUnit: string;
  score: number;   // 0-100
  weight: number;  // %
}

export interface LongContract {
  optionSymbol: string;
  side: 'call' | 'put';
  strike: number;
  expirationDate: string; // ISO
  dte: number;
  bid: number;
  ask: number;
  mid: number;            // the debit per share at entry pricing
  delta: number;          // signed
  iv: number;             // %
  theta: number;
  vega: number;
  volume: number;
  openInterest: number;
  extrinsicPct: number;   // extrinsic / premium
}

export interface LongIdea {
  id: string;
  ticker: string;
  direction: LongStrategyType;
  currentPrice: number;
  compositeScore: number;      // directional factor composite 0-100
  overallScore: number;        // blended display score (factors + vol + liquidity + EM)
  factors: FactorScore[];
  contract: LongContract;
  // Vol context
  ivRank: number;
  ivRankSource: 'history' | 'smile';
  hv20: number;                // annualized %
  hv60: number;
  ivHvRatio: number;
  emRatio: number;             // implied expected move / median historical move
  // Trading-rule context the paper engine consumes (docs/LONG_STRATEGY_DESIGN.md §3)
  entryTrigger: EntryTrigger | null;
  triggerDate: string | null;  // ISO date the trigger fired
  sigRef: number;              // signal reference level for the R10 stop
  atr: number;                 // ATR14 at scan time
  stopLevel: number;           // R10 underlying stop
  flags: string[];             // Stage-6 warnings
  tier: 'trade' | 'watchlist';
  generatedAt: string;
}

export const LS_LONG_IDEAS = 'options-screener-long-ideas';

// --- Paper Trades ---

export type PaperKind = 'LC' | 'LP' | 'CSP';

export interface PaperPosition {
  id: string;
  kind: PaperKind;
  ticker: string;
  optionSymbol: string;
  contracts: number;
  strike: number;
  expirationDate: string;      // ISO
  openedAt: string;            // ISO datetime
  entryUnderlying: number;
  entryMid: number;            // per share
  entryDebit: number;          // total $ paid (negative = credit received)
  entryDelta: number;          // signed, per share
  entryScore: number;
  sigRef: number;              // long-side R10 stop inputs
  atrEntry: number;
  stopLevel: number;
  riskAtEntry: number;         // $ risk used for sizing (debit for longs, 2σ stress for CSP)
  collateral: number;          // $ reserved (CSP strike×100×n; 0 for longs)
  spreadPctAtEntry: number;    // slippage-risk caveat: (ask-bid)/mid at fill time
  lastMark: number;            // per-share mid
  lastMarkDate: string;        // ISO date
  lastUnderlying: number;
  highestClose: number;        // for R9 trailing stop after scale-out
  scaledOut: boolean;
}

export interface PaperClosedTrade {
  id: string;
  kind: PaperKind;
  ticker: string;
  optionSymbol: string;
  contracts: number;
  strike: number;
  openedAt: string;
  closedAt: string;
  entryMid: number;
  exitMid: number;
  pnl: number;                 // total $
  riskAtEntry: number;
  exitRule: string;            // which rule closed it (R8..R13 / S-rules)
  entryScore: number;
}

export interface PaperJournalEntry {
  at: string;                  // ISO datetime
  action: 'MARK' | 'OPEN' | 'CLOSE' | 'SCALE_OUT' | 'SKIP' | 'VETO' | 'INFO' | 'ERROR';
  ticker?: string;
  rule?: string;
  detail: string;
}

export interface PaperPortfolio {
  version: 1;
  createdAt: string;
  cash: number;
  positions: PaperPosition[];
  closedTrades: PaperClosedTrade[];
  equityHistory: { d: string; equity: number; carried?: boolean }[]; // one per marking day
  journal: PaperJournalEntry[];
  lastCycleAt: string | null;
}

export const PAPER_STARTING_CAPITAL = 50000;
export const LS_PAPER_PORTFOLIO = 'options-screener-paper-portfolio-v1';

// --- Saved Watchlists ---
// A named, reusable list of tickers plus its own scan filters. When a watchlist
// is active, the Idea Generator scans EXACTLY these tickers (the default universe
// and the excluded list are set aside).
export interface SavedWatchlist {
  id: string;
  name: string;
  tickers: string[];     // normalized: uppercased, trimmed, de-duped, sorted
  filters: ScanFilter;   // each watchlist owns its scan filters
  createdAt: string;     // ISO
  updatedAt: string;     // ISO
}
