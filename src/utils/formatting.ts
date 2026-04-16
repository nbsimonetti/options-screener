export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals: number = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDelta(value: number): string {
  return value.toFixed(2);
}

export function formatIVRank(value: number): string {
  return value.toFixed(1);
}

export function formatPSafe(delta: number): string {
  return `${((1 - Math.abs(delta)) * 100).toFixed(0)}%`;
}

export function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

export function scoreBgColor(score: number): string {
  if (score >= 70) return 'bg-green-900/30 border-green-700/50';
  if (score >= 40) return 'bg-yellow-900/30 border-yellow-700/50';
  return 'bg-red-900/30 border-red-700/50';
}

// Color helpers for table cells — consistent across the app
export function yieldColor(annualYield: number): string {
  // annualYield is decimal (0.25 = 25%)
  if (annualYield > 0.25) return 'text-green-400';
  if (annualYield > 0.12) return 'text-yellow-400';
  return 'text-red-400';
}

export function deltaColor(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < 0.20) return 'text-green-400';
  if (abs < 0.32) return 'text-yellow-400';
  return 'text-red-400';
}

export function ivrColor(ivRank: number): string {
  if (ivRank > 90) return 'text-red-400';      // crisis — too elevated
  if (ivRank >= 40) return 'text-green-400';   // sweet spot for premium sellers
  if (ivRank >= 25) return 'text-yellow-400';
  return 'text-red-400';                        // compressed — premium is cheap
}

export function spreadColor(spreadPct: number): string {
  // spreadPct as decimal (0.05 = 5%)
  if (spreadPct < 0.02) return 'text-green-400';
  if (spreadPct < 0.05) return 'text-yellow-400';
  return 'text-red-400';
}
