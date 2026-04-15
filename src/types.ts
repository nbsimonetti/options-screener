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
  iv: number;
  ivRank: number;
  volume: number;
  openInterest: number;
  nextEarningsDate: string;
  contractSize: number;
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
    iv: 0,
    ivRank: 50,
    volume: 0,
    openInterest: 0,
    nextEarningsDate: '',
    contractSize: 100,
  };
}

// --- AI Idea Generator ---

export type AppView = 'screener' | 'ideas';

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
