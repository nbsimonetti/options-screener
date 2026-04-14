import type { OptionPosition, ScoringWeights, ScoreBreakdownItem, PositionScore } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function linearScale(value: number, minVal: number, maxVal: number): number {
  if (maxVal === minVal) return 50;
  return clamp(((value - minVal) / (maxVal - minVal)) * 100, 0, 100);
}

export function calcAnnualizedYield(pos: OptionPosition): number {
  const capitalAtRisk = pos.strategy === 'CSP'
    ? pos.strikePrice * pos.contractSize
    : pos.currentPrice * pos.contractSize;
  if (capitalAtRisk <= 0 || pos.dte <= 0) return 0;
  const yieldPerPeriod = (pos.premium * pos.contractSize) / capitalAtRisk;
  return (yieldPerPeriod * 365) / pos.dte;
}

export function scoreAnnualizedYield(pos: OptionPosition): { raw: number; score: number } {
  const raw = calcAnnualizedYield(pos);
  const score = linearScale(raw, 0, 0.50);
  return { raw, score };
}

export function scoreDelta(pos: OptionPosition): { raw: number; score: number } {
  const absDelta = Math.abs(pos.delta);
  const score = linearScale(absDelta, 0.50, 0.05);
  return { raw: absDelta, score };
}

export function scoreIvRank(pos: OptionPosition): { raw: number; score: number } {
  const score = clamp(pos.ivRank, 0, 100);
  return { raw: pos.ivRank, score };
}

export function scoreLiquidity(pos: OptionPosition): { raw: number; score: number } {
  const midPrice = (pos.bid + pos.ask) / 2;
  const spreadPct = midPrice > 0 ? (pos.ask - pos.bid) / midPrice : 1;
  const spreadScore = linearScale(spreadPct, 0.20, 0.01);

  const volumeScore = linearScale(Math.min(pos.volume, 5000), 0, 5000);
  const oiScore = linearScale(Math.min(pos.openInterest, 10000), 0, 10000);

  const composite = spreadScore * 0.50 + volumeScore * 0.25 + oiScore * 0.25;
  return { raw: spreadPct, score: composite };
}

export function scoreThetaEfficiency(pos: OptionPosition): { raw: number; score: number } {
  const dte = pos.dte;
  let score: number;
  if (dte >= 30 && dte <= 45) {
    score = 100;
  } else if (dte < 30) {
    score = linearScale(dte, 0, 30);
  } else {
    score = linearScale(dte, 120, 45);
  }
  return { raw: dte, score };
}

export function scoreOtmDistance(pos: OptionPosition): { raw: number; score: number } {
  if (pos.currentPrice <= 0) return { raw: 0, score: 0 };
  let otmPct: number;
  if (pos.strategy === 'CSP') {
    otmPct = (pos.currentPrice - pos.strikePrice) / pos.currentPrice;
  } else {
    otmPct = (pos.strikePrice - pos.currentPrice) / pos.currentPrice;
  }
  otmPct = Math.max(otmPct, 0);
  const score = linearScale(otmPct, 0, 0.15);
  return { raw: otmPct, score };
}

export function scoreEarningsProximity(pos: OptionPosition): { raw: number; score: number } {
  if (!pos.nextEarningsDate) return { raw: Infinity, score: 100 };
  const now = new Date();
  const earnings = new Date(pos.nextEarningsDate);
  const daysUntilEarnings = (earnings.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (daysUntilEarnings < 0 || daysUntilEarnings > pos.dte) {
    return { raw: daysUntilEarnings, score: 100 };
  }
  const score = linearScale(daysUntilEarnings, 0, 30);
  return { raw: daysUntilEarnings, score };
}

export function scorePosition(pos: OptionPosition, weights: ScoringWeights): PositionScore {
  const yield_ = scoreAnnualizedYield(pos);
  const delta_ = scoreDelta(pos);
  const iv_ = scoreIvRank(pos);
  const liq_ = scoreLiquidity(pos);
  const theta_ = scoreThetaEfficiency(pos);
  const otm_ = scoreOtmDistance(pos);
  const earn_ = scoreEarningsProximity(pos);

  const breakdown: ScoreBreakdownItem[] = [
    {
      label: 'Annualized Yield',
      key: 'annualizedYield',
      rawValue: yield_.raw,
      rawUnit: '%',
      normalizedScore: yield_.score,
      weight: weights.annualizedYield,
      weightedScore: yield_.score * weights.annualizedYield,
    },
    {
      label: 'Delta (P(OTM))',
      key: 'delta',
      rawValue: delta_.raw,
      rawUnit: 'delta',
      normalizedScore: delta_.score,
      weight: weights.delta,
      weightedScore: delta_.score * weights.delta,
    },
    {
      label: 'IV Rank',
      key: 'ivRank',
      rawValue: iv_.raw,
      rawUnit: '%',
      normalizedScore: iv_.score,
      weight: weights.ivRank,
      weightedScore: iv_.score * weights.ivRank,
    },
    {
      label: 'Liquidity',
      key: 'liquidity',
      rawValue: liq_.raw,
      rawUnit: 'spread%',
      normalizedScore: liq_.score,
      weight: weights.liquidity,
      weightedScore: liq_.score * weights.liquidity,
    },
    {
      label: 'Theta Efficiency',
      key: 'thetaEfficiency',
      rawValue: theta_.raw,
      rawUnit: 'DTE',
      normalizedScore: theta_.score,
      weight: weights.thetaEfficiency,
      weightedScore: theta_.score * weights.thetaEfficiency,
    },
    {
      label: 'OTM Distance',
      key: 'otmDistance',
      rawValue: otm_.raw,
      rawUnit: '%',
      normalizedScore: otm_.score,
      weight: weights.otmDistance,
      weightedScore: otm_.score * weights.otmDistance,
    },
    {
      label: 'Earnings Proximity',
      key: 'earningsProximity',
      rawValue: earn_.raw,
      rawUnit: 'days',
      normalizedScore: earn_.score,
      weight: weights.earningsProximity,
      weightedScore: earn_.score * weights.earningsProximity,
    },
  ];

  const totalWeight = breakdown.reduce((sum, b) => sum + b.weight, 0);
  const totalWeighted = breakdown.reduce((sum, b) => sum + b.weightedScore, 0);
  const compositeScore = totalWeight > 0 ? totalWeighted / totalWeight : 0;

  return { compositeScore, breakdown };
}
