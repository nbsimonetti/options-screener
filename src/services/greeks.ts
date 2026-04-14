// Black-Scholes Greeks calculator
// All inputs: S=stock price, K=strike, T=time in years, r=risk-free rate, sigma=IV (decimal)

const RISK_FREE_RATE = 0.045; // ~4.5% as of 2026

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function normalCDF(x: number): number {
  // Abramowitz & Stegun approximation (error < 7.5e-8)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1 + sign * y);
}

function d1(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

function d2(S: number, K: number, T: number, r: number, sigma: number): number {
  return d1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
}

export function calcDelta(
  S: number, K: number, T: number, sigma: number,
  optionType: 'call' | 'put', r: number = RISK_FREE_RATE,
): number {
  if (T <= 0 || sigma <= 0) return optionType === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d = d1(S, K, T, r, sigma);
  return optionType === 'call' ? normalCDF(d) : normalCDF(d) - 1;
}

export function calcGamma(
  S: number, K: number, T: number, sigma: number, r: number = RISK_FREE_RATE,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  const d = d1(S, K, T, r, sigma);
  return normalPDF(d) / (S * sigma * Math.sqrt(T));
}

export function calcTheta(
  S: number, K: number, T: number, sigma: number,
  optionType: 'call' | 'put', r: number = RISK_FREE_RATE,
): number {
  if (T <= 0 || sigma <= 0) return 0;
  const d1_ = d1(S, K, T, r, sigma);
  const d2_ = d2(S, K, T, r, sigma);

  const term1 = -(S * normalPDF(d1_) * sigma) / (2 * Math.sqrt(T));

  if (optionType === 'call') {
    return (term1 - r * K * Math.exp(-r * T) * normalCDF(d2_)) / 365;
  }
  return (term1 + r * K * Math.exp(-r * T) * normalCDF(-d2_)) / 365;
}

export function calcVega(
  S: number, K: number, T: number, sigma: number, r: number = RISK_FREE_RATE,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  const d = d1(S, K, T, r, sigma);
  return (S * normalPDF(d) * Math.sqrt(T)) / 100; // per 1% change in IV
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export function computeGreeks(
  stockPrice: number,
  strike: number,
  dte: number,
  iv: number, // decimal (e.g., 0.35 for 35%)
  optionType: 'call' | 'put',
): Greeks {
  const T = Math.max(dte, 1) / 365;
  return {
    delta: calcDelta(stockPrice, strike, T, iv, optionType),
    gamma: calcGamma(stockPrice, strike, T, iv),
    theta: calcTheta(stockPrice, strike, T, iv, optionType),
    vega: calcVega(stockPrice, strike, T, iv),
  };
}
