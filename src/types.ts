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

// --- API Configuration ---

export type DataSource = 'tradier' | 'schwab' | 'manual';

export interface APIConfig {
  source: DataSource;
  tradierToken: string;
  tradierSandbox: boolean;
  schwabClientId: string;
  schwabRefreshToken: string;
  finnhubToken: string;
}

export const DEFAULT_API_CONFIG: APIConfig = {
  source: 'tradier',
  tradierToken: '',
  tradierSandbox: true,
  schwabClientId: '',
  schwabRefreshToken: '',
  finnhubToken: '',
};

export const LS_API_CONFIG = 'options-screener-api-config';

export interface TradierQuote {
  symbol: string;
  last: number;
  change: number;
  change_percentage: number;
  close: number;
  trade_date: string;
  description: string;
}

export interface TradierOption {
  symbol: string;
  description: string;
  strike: number;
  option_type: 'call' | 'put';
  expiration_date: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open_interest: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    phi: number;
    bid_iv: number;
    mid_iv: number;
    ask_iv: number;
    smv_vol: number;
  };
}

export interface ChainFilter {
  strategy: StrategyType;
  minDelta: number;
  maxDelta: number;
  minDTE: number;
  maxDTE: number;
  minOTMPct: number;
}

export const DEFAULT_CHAIN_FILTER: ChainFilter = {
  strategy: 'CSP',
  minDelta: 0.10,
  maxDelta: 0.40,
  minDTE: 14,
  maxDTE: 60,
  minOTMPct: 2,
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
    delta: 0.3,
    iv: 0,
    ivRank: 50,
    volume: 0,
    openInterest: 0,
    nextEarningsDate: '',
    contractSize: 100,
  };
}
