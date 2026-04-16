import type { IdeaThesis, OptionPosition, ScoreBreakdownItem, InvestmentIdea } from '../types';
import type { ScanCandidate } from './scanner';
import { calcAnnualizedYield } from '../scoring/engine';
import { getBreakeven } from '../utils/payoff';
import { formatCurrency, formatPercent, formatDelta, formatIVRank } from '../utils/formatting';
import { calcImpliedMove1SD, sigmaOTM } from '../utils/payoff';

type Tier = 'strong' | 'neutral' | 'weak';

function tier(score: number): Tier {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'neutral';
  return 'weak';
}

function pctOTM(p: OptionPosition): number {
  if (p.currentPrice <= 0) return 0;
  return p.strategy === 'CSP'
    ? ((p.currentPrice - p.strikePrice) / p.currentPrice) * 100
    : ((p.strikePrice - p.currentPrice) / p.currentPrice) * 100;
}

function probOTM(delta: number): number {
  return Math.round((1 - Math.abs(delta)) * 100);
}

function spreadPct(p: OptionPosition): number {
  const mid = (p.bid + p.ask) / 2;
  return mid > 0 ? ((p.ask - p.bid) / mid) * 100 : 0;
}

// --- Per-component observation generators ---

function yieldObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const annYield = calcAnnualizedYield(p);
  const capital = p.strategy === 'CSP' ? p.strikePrice * p.contractSize : p.currentPrice * p.contractSize;
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return `${formatPercent(annYield)} annualized return on ${formatCurrency(capital)} capital at risk — well above the 15% threshold for premium sellers.`;
  } else if (t === 'neutral') {
    return `${formatPercent(annYield)} annualized yield is moderate — acceptable for a conservative income position on ${formatCurrency(capital)} capital.`;
  }
  return `${formatPercent(annYield)} annualized yield is thin relative to the assignment risk on ${formatCurrency(capital)} capital.`;
}

function deltaObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const prob = probOTM(p.delta);
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return `${formatDelta(p.delta)} delta implies ~${prob}% probability of staying safe (not assigned) — favorable odds for the seller.`;
  } else if (t === 'neutral') {
    return `${formatDelta(p.delta)} delta gives ~${prob}% probability of staying safe — reasonable but not deeply OTM.`;
  }
  return `${formatDelta(p.delta)} delta puts the probability of assignment at ${100 - prob}% — uncomfortably close to ATM.`;
}

function ivRankObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const t = tier(b.normalizedScore);
  const baseline = p.atmIV != null && p.medianIV != null
    ? ` (current IV ${p.atmIV.toFixed(1)}% vs chain median ${p.medianIV.toFixed(1)}%${p.atmIV > p.medianIV ? ', +' + (p.atmIV - p.medianIV).toFixed(1) + 'pts elevated' : ''})`
    : '';
  if (t === 'strong') {
    return `IV Rank of ${formatIVRank(p.ivRank)} means current volatility is in the ${formatIVRank(p.ivRank)} percentile of its range${baseline} — selling premium at an elevated level.`;
  } else if (t === 'neutral') {
    return `IV Rank of ${formatIVRank(p.ivRank)} is mid-range${baseline} — premium is neither rich nor cheap relative to historical norms.`;
  }
  return `IV Rank of ${formatIVRank(p.ivRank)} suggests volatility is compressed${baseline} — premium may be cheap relative to potential moves.`;
}

function liquidityObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const spread = spreadPct(p);
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return `Bid-ask spread of ${spread.toFixed(1)}% with ${p.volume.toLocaleString()} volume and ${p.openInterest.toLocaleString()} OI — excellent execution quality.`;
  } else if (t === 'neutral') {
    return `${spread.toFixed(1)}% spread with ${p.volume.toLocaleString()} volume — adequate liquidity for entry and exit.`;
  }
  return `Wide ${spread.toFixed(1)}% spread with only ${p.volume.toLocaleString()} contracts traded — expect slippage on entry/exit.`;
}

function thetaObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return `${p.dte} DTE sits in the theta decay sweet spot (30-45 days) where time decay accelerates most.`;
  } else if (t === 'neutral') {
    return `${p.dte} DTE is outside the ideal 30-45 day window but still reasonable for theta capture.`;
  }
  return p.dte < 30
    ? `Only ${p.dte} DTE remaining — limited premium left and gamma risk is elevated near expiration.`
    : `${p.dte} DTE means slow theta decay for the next several weeks — capital is tied up longer than ideal.`;
}

function otmObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const otm = pctOTM(p);
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return `Strike is ${otm.toFixed(1)}% ${p.strategy === 'CSP' ? 'below' : 'above'} current price — meaningful buffer before assignment.`;
  } else if (t === 'neutral') {
    return `${otm.toFixed(1)}% OTM provides moderate cushion against adverse price movement.`;
  }
  return `Only ${otm.toFixed(1)}% OTM — a single bad session could push this in-the-money.`;
}

function earningsObs(p: OptionPosition, b: ScoreBreakdownItem): string {
  const t = tier(b.normalizedScore);
  if (t === 'strong') {
    return p.nextEarningsDate
      ? `Earnings on ${p.nextEarningsDate} fall outside the expiration window — no binary event risk.`
      : 'No earnings within the expiration window — eliminates gap risk.';
  } else if (t === 'neutral') {
    return `Earnings are near the expiration window — monitor for date changes.`;
  }
  return `Earnings on ${p.nextEarningsDate} fall within the ${p.dte}-day window — binary event risk during the trade.`;
}

const OBS_MAP: Record<string, (p: OptionPosition, b: ScoreBreakdownItem) => string> = {
  annualizedYield: yieldObs,
  delta: deltaObs,
  ivRank: ivRankObs,
  liquidity: liquidityObs,
  thetaEfficiency: thetaObs,
  otmDistance: otmObs,
  earningsProximity: earningsObs,
};

// --- Thesis builder ---

function buildThesis(candidate: ScanCandidate): IdeaThesis {
  const { position: p, score } = candidate;
  const breakdown = score.breakdown;
  const annYield = calcAnnualizedYield(p);
  const breakeven = getBreakeven(p);
  const strategyLabel = p.strategy === 'CSP' ? 'cash-secured put' : 'covered call';

  // Classify all components
  const classified = breakdown.map((b) => ({
    ...b,
    tier: tier(b.normalizedScore),
    observation: OBS_MAP[b.key]?.(p, b) || '',
  }));

  const strong = classified.filter((c) => c.tier === 'strong');
  const neutral = classified.filter((c) => c.tier === 'neutral');
  const weak = classified.filter((c) => c.tier === 'weak');

  // Top contributors by weighted score
  const topContributors = [...classified]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 3);

  // Summary: ticker + strategy + strongest metric
  const bestMetric = strong.length > 0 ? strong[0] : classified[0];
  const summary = `${p.ticker} $${p.strikePrice} ${strategyLabel} — ${bestMetric.observation}`;

  // Setup: IV Rank + OTM + Theta context
  const ivObs = classified.find((c) => c.key === 'ivRank')!;
  const otmItem = classified.find((c) => c.key === 'otmDistance')!;
  const thetaItem = classified.find((c) => c.key === 'thetaEfficiency')!;
  const setup = `${ivObs.observation} ${otmItem.observation} ${thetaItem.observation}`;

  // Rationale: yield math + delta probability
  const capital = p.strategy === 'CSP' ? p.strikePrice * p.contractSize : p.currentPrice * p.contractSize;
  const thetaPerDay = Math.abs(p.theta) * p.contractSize;
  const vegaDollar = p.vega * p.contractSize;
  const move1SD = calcImpliedMove1SD(p);
  const sigma = sigmaOTM(p);
  const rationale = `At ${formatCurrency(p.premium)} premium on a $${p.strikePrice} strike (${p.dte} DTE), the annualized return on the ${formatCurrency(capital)} capital commitment is ${formatPercent(annYield)}. Market's 1-SD expected move is ±${formatCurrency(move1SD)}; strike sits ${sigma.toFixed(2)}σ ${p.strategy === 'CSP' ? 'below' : 'above'} spot. Delta of ${formatDelta(p.delta)} gives this trade an estimated ${probOTM(p.delta)}% probability of full profit. Theta decay earns ${formatCurrency(thetaPerDay)}/day and the position is short ${formatCurrency(vegaDollar)} per 1-point IV rise. Breakeven at ${formatCurrency(breakeven)}.`;

  // Key Metrics: top 3 by weighted contribution with full math
  const keyMetrics = `Top contributors: ${topContributors.map((c) => `${c.label} ${c.normalizedScore.toFixed(0)}/100 (wt ${c.weight} → ${c.weightedScore.toFixed(0)})`).join(', ')}. Composite: ${score.compositeScore.toFixed(1)}/100.`;

  // Risks: from weak components + universal
  const risks: string[] = weak.map((c) => c.observation);
  risks.push(`Assignment risk: if assigned, effective cost basis is ${formatCurrency(breakeven)} per share.`);
  if (risks.length === 1) {
    risks.unshift('No major scoring weaknesses identified — primary risk is an unexpected market-wide selloff.');
  }

  // Catalysts: from strong components
  const catalysts: string[] = [];
  if (strong.find((c) => c.key === 'ivRank')) {
    catalysts.push('Elevated IV mean-reverting lower would accelerate profit as option prices deflate.');
  }
  if (strong.find((c) => c.key === 'thetaEfficiency')) {
    catalysts.push(`Theta decay accelerates daily — profitable if ${p.ticker} holds ${p.strategy === 'CSP' ? 'above' : 'below'} ${formatCurrency(breakeven)}.`);
  }
  if (strong.find((c) => c.key === 'delta')) {
    catalysts.push(`High probability of expiring OTM (${probOTM(p.delta)}%) — time is on the seller's side.`);
  }
  if (catalysts.length === 0) {
    catalysts.push(`Time decay works in the seller's favor — ${p.dte} days to expiration at ${formatCurrency(breakeven)} breakeven.`);
  }

  // Confidence: traceable formula
  const S = strong.length;
  const N = neutral.length;
  const W = weak.length;
  let confidence: 'high' | 'medium' | 'low';
  if (S >= 5 && W === 0 && score.compositeScore >= 70) confidence = 'high';
  else if (S >= 3 && W <= 1 && score.compositeScore >= 50) confidence = 'medium';
  else confidence = 'low';

  // Analyst note: find the most unusual pairing
  let analystNote: string;
  const ivItem = classified.find((c) => c.key === 'ivRank')!;
  const deltaItem = classified.find((c) => c.key === 'delta')!;

  if (ivItem.tier === 'strong' && deltaItem.tier === 'strong') {
    analystNote = `High IV Rank (${formatIVRank(p.ivRank)}) paired with low delta (${formatDelta(p.delta)}) is the ideal premium-selling setup — elevated vol with high probability of profit. Confidence: ${confidence} — ${S} strong, ${N} neutral, ${W} weak scoring factors.`;
  } else if (W === 0) {
    analystNote = `No weak scoring factors across all 7 components — a well-rounded candidate. Confidence: ${confidence} — ${S} strong, ${N} neutral, ${W} weak.`;
  } else {
    const worstItem = classified.sort((a, b) => a.normalizedScore - b.normalizedScore)[0];
    analystNote = `Watch the ${worstItem.label} score (${worstItem.normalizedScore.toFixed(0)}/100) — it's the weakest link in an otherwise ${score.compositeScore >= 60 ? 'solid' : 'marginal'} setup. Confidence: ${confidence} — ${S} strong, ${N} neutral, ${W} weak.`;
  }

  return {
    summary,
    setup,
    rationale,
    keyMetrics,
    risks,
    catalysts,
    confidence,
    analystNote,
  };
}

export function generateTemplateTheses(candidates: ScanCandidate[]): InvestmentIdea[] {
  const now = new Date().toISOString();
  return candidates.map((c) => ({
    id: crypto.randomUUID(),
    position: c.position,
    score: c.score,
    thesis: buildThesis(c),
    generatedAt: now,
  }));
}
