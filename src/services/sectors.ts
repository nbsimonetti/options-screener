// Static sector map for the default universe + concentration buckets for the
// paper-trading engine (rule R19: a hand-maintained bucket list is a
// 90%-effective correlation matrix at 0% of the cost).

export interface SectorInfo {
  sector: string;     // display sector
  etf: string;        // mapped sector ETF for relative-strength factors
  bucket: string;     // correlation bucket for concentration limits
}

const MAP: Record<string, SectorInfo> = {
  // Tech / semis
  AAPL: { sector: 'Technology', etf: 'XLK', bucket: 'mega-tech' },
  MSFT: { sector: 'Technology', etf: 'XLK', bucket: 'mega-tech' },
  NVDA: { sector: 'Technology', etf: 'XLK', bucket: 'mega-tech' },
  GOOGL: { sector: 'Communication', etf: 'XLK', bucket: 'mega-tech' },
  AMZN: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'mega-tech' },
  META: { sector: 'Communication', etf: 'XLK', bucket: 'mega-tech' },
  TSLA: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'mega-tech' },
  AMD: { sector: 'Technology', etf: 'XLK', bucket: 'mega-tech' },
  INTC: { sector: 'Technology', etf: 'XLK', bucket: 'mega-tech' },
  CRM: { sector: 'Technology', etf: 'XLK', bucket: 'software' },
  ORCL: { sector: 'Technology', etf: 'XLK', bucket: 'software' },
  ADBE: { sector: 'Technology', etf: 'XLK', bucket: 'software' },
  // Financials
  JPM: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  BAC: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  GS: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  MS: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  V: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  MA: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  C: { sector: 'Financials', etf: 'XLF', bucket: 'financials' },
  // Healthcare
  JNJ: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  UNH: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  PFE: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  ABBV: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  MRK: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  LLY: { sector: 'Healthcare', etf: 'XLV', bucket: 'healthcare' },
  // Consumer
  WMT: { sector: 'Consumer Staples', etf: 'XLP', bucket: 'consumer' },
  HD: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'consumer' },
  COST: { sector: 'Consumer Staples', etf: 'XLP', bucket: 'consumer' },
  MCD: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'consumer' },
  NKE: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'consumer' },
  SBUX: { sector: 'Consumer Disc.', etf: 'XLY', bucket: 'consumer' },
  DIS: { sector: 'Communication', etf: 'XLY', bucket: 'consumer' },
  // Industrials
  CAT: { sector: 'Industrials', etf: 'XLI', bucket: 'industrials' },
  BA: { sector: 'Industrials', etf: 'XLI', bucket: 'industrials' },
  GE: { sector: 'Industrials', etf: 'XLI', bucket: 'industrials' },
  HON: { sector: 'Industrials', etf: 'XLI', bucket: 'industrials' },
  UPS: { sector: 'Industrials', etf: 'XLI', bucket: 'industrials' },
  // Energy
  XOM: { sector: 'Energy', etf: 'XLE', bucket: 'energy' },
  CVX: { sector: 'Energy', etf: 'XLE', bucket: 'energy' },
  COP: { sector: 'Energy', etf: 'XLE', bucket: 'energy' },
  SLB: { sector: 'Energy', etf: 'XLE', bucket: 'energy' },
  // ETFs
  SPY: { sector: 'Index ETF', etf: 'SPY', bucket: 'index-etf' },
  QQQ: { sector: 'Index ETF', etf: 'QQQ', bucket: 'index-etf' },
  IWM: { sector: 'Index ETF', etf: 'IWM', bucket: 'index-etf' },
  XLF: { sector: 'Sector ETF', etf: 'XLF', bucket: 'financials' },
  XLE: { sector: 'Sector ETF', etf: 'XLE', bucket: 'energy' },
  XLK: { sector: 'Sector ETF', etf: 'XLK', bucket: 'mega-tech' },
  GLD: { sector: 'Commodity ETF', etf: 'GLD', bucket: 'metals' },
  TLT: { sector: 'Bond ETF', etf: 'TLT', bucket: 'rates' },
  EEM: { sector: 'Intl ETF', etf: 'EEM', bucket: 'index-etf' },
  HYG: { sector: 'Bond ETF', etf: 'HYG', bucket: 'rates' },
};

// Leveraged/inverse siblings count as the same underlying for the
// one-position-per-underlying rule (R18).
const ALIASES: Record<string, string> = {
  SPX: 'SPY', UPRO: 'SPY', SH: 'SPY', SPXL: 'SPY', SPXU: 'SPY',
  TQQQ: 'QQQ', SQQQ: 'QQQ', PSQ: 'QQQ', NDX: 'QQQ',
  TNA: 'IWM', TZA: 'IWM', RUT: 'IWM',
};

export function getSectorInfo(ticker: string): SectorInfo {
  const upper = ticker.toUpperCase();
  return MAP[upper] ?? { sector: 'Other', etf: 'SPY', bucket: 'other' };
}

export function canonicalUnderlying(ticker: string): string {
  const upper = ticker.toUpperCase();
  return ALIASES[upper] ?? upper;
}
