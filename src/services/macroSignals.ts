import type { MacroSnapshot } from './macro';

export type Tier = 'strong' | 'neutral' | 'weak';

export interface SignalResult {
  label: string;
  tier: Tier;
  score: number; // 0-100
  weight: number;
  rawValue: string;
  commentary: string;
}

export interface MacroAssessment {
  compositeScore: number;
  stance: 'favorable' | 'neutral' | 'unfavorable';
  signals: SignalResult[];
  summary: string;
  recommendations: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Logistic transform centered at zero: amplifies dispersion vs. a linear map by
// pulling values away from the midpoint as |x| grows. k controls steepness.
function sigmoid(x: number, k: number): number {
  return 100 / (1 + Math.exp(-k * x));
}

function tierOf(score: number): Tier {
  if (score >= 65) return 'strong';
  if (score >= 35) return 'neutral';
  return 'weak';
}

// Score helpers
function vixRankSignal(snap: MacroSnapshot): SignalResult | null {
  if (!snap.vix) return null;
  const rank = snap.vix.rank;
  // Sigmoid around rank 50: rank 20→8, 30→17, 50→50, 70→83, 80→92. Pushes
  // compressed-vol regimes meaningfully below 50 rather than mapping to 20-30.
  const score = sigmoid(rank - 50, 0.08);
  const tier = tierOf(score);
  const commentary = tier === 'strong'
    ? `VIX at ${snap.vix.level.toFixed(1)} (${rank.toFixed(0)}th percentile of 52w) — premium is rich.`
    : tier === 'neutral'
      ? `VIX at ${snap.vix.level.toFixed(1)} (${rank.toFixed(0)}th percentile) — premium is around typical.`
      : `VIX at ${snap.vix.level.toFixed(1)} (only ${rank.toFixed(0)}th percentile) — premium is compressed.`;
  return {
    label: 'VIX Rank',
    tier, score, weight: 25,
    rawValue: `${snap.vix.level.toFixed(2)} (${rank.toFixed(0)}%)`,
    commentary,
  };
}

function termStructureSignal(snap: MacroSnapshot): SignalResult | null {
  if (!snap.vix || !snap.vix3m) return null;
  const vix = snap.vix.level;
  const vix3m = snap.vix3m.level;
  const spread = vix3m - vix; // positive = contango (healthy), negative = backwardation (stress)
  // Sigmoid centered at +0.5 (typical healthy contango baseline): spread -2→7,
  // -1→16, 0→35, +1→65, +2→85, +3→94. Backwardation collapses fast.
  const score = sigmoid(spread - 0.5, 1.2);
  const tier = tierOf(score);
  const shape = spread > 0.5 ? 'contango' : spread < -0.5 ? 'backwardation' : 'flat';
  const commentary = tier === 'strong'
    ? `Term structure in healthy ${shape} (VIX ${vix.toFixed(1)} vs VIX3M ${vix3m.toFixed(1)}) — no acute stress.`
    : tier === 'neutral'
      ? `Term structure ${shape} (VIX ${vix.toFixed(1)} vs VIX3M ${vix3m.toFixed(1)}).`
      : `Term structure in ${shape} — short-dated vol elevated vs longer-dated. Market stress signal.`;
  return {
    label: 'Term Structure',
    tier, score, weight: 15,
    rawValue: `${spread >= 0 ? '+' : ''}${spread.toFixed(2)}`,
    commentary,
  };
}

function skewSignal(snap: MacroSnapshot): SignalResult | null {
  if (!snap.skew) return null;
  const skew = snap.skew.level;
  // Continuous linear: SKEW 120→100, 130→75, 140→50, 150→25, 160→5. Realistic
  // 130-150 range now produces 25-75 dispersion vs. the old bins of 35 or 65.
  const score = clamp(100 - (skew - 120) * 2.5, 5, 100);
  const tier = tierOf(score);
  const commentary = skew > 150
    ? `SKEW at ${skew.toFixed(1)} — elevated tail-risk hedging. Market is pricing fat left tail.`
    : skew > 135
      ? `SKEW at ${skew.toFixed(1)} — moderate tail-risk pricing.`
      : `SKEW at ${skew.toFixed(1)} — tail-risk pricing is subdued.`;
  return {
    label: 'SKEW',
    tier, score, weight: 10,
    rawValue: skew.toFixed(1),
    commentary,
  };
}

function spxTrendSignal(snap: MacroSnapshot): SignalResult | null {
  const spx = snap.indices.SPX;
  if (!spx) return null;
  // Continuous composite: MA-position base + distance-from-high adjustment +
  // short-term momentum. Replaces 25/50/85 bins so a bull near highs and a
  // bull 10% off highs don't both score 85.
  let ma: number;
  let state: string;
  if (spx.aboveMA50 && spx.aboveMA200) { ma = 70; state = 'above both 50 & 200 DMA'; }
  else if (!spx.aboveMA50 && !spx.aboveMA200) { ma = 15; state = 'below both 50 & 200 DMA'; }
  else { ma = spx.aboveMA200 ? 50 : 40; state = spx.aboveMA200 ? 'above 200 DMA but below 50 DMA' : 'above 50 DMA but below 200 DMA'; }

  const dfh = spx.distanceFromHigh;
  const distAdj = dfh >= -2 ? 20 : dfh >= -5 ? 10 : dfh >= -10 ? 0 : dfh >= -15 ? -15 : -30;

  const mom = spx.change5d ?? 0;
  const momAdj = mom > 2 ? 10 : mom > 0.5 ? 5 : mom > -0.5 ? 0 : mom > -2 ? -5 : -15;

  const score = clamp(ma + distAdj + momAdj, 0, 100);
  const tier = tierOf(score);
  const commentary = `SPX at ${spx.level.toFixed(0)} is ${state}. ${dfh >= -2 ? 'Near all-time highs.' : `${Math.abs(dfh).toFixed(1)}% off 52w high.`}${mom !== 0 ? ` 5d ${mom >= 0 ? '+' : ''}${mom.toFixed(1)}%.` : ''}`;
  return {
    label: 'SPX Trend',
    tier, score, weight: 15,
    rawValue: state,
    commentary,
  };
}

function creditSignal(snap: MacroSnapshot): SignalResult | null {
  if (!snap.creditSpread) return null;
  const trend = snap.creditSpread.ratioTrend20d;
  // Sigmoid amplifies sensitivity: trend -2%→5, -1%→18, 0→50, +1%→82, +2%→95.
  // Previous linear formula barely moved off 50 for typical ±0.5% trend.
  const score = sigmoid(trend, 1.5);
  const tier = tierOf(score);
  const direction = trend > 0.3 ? 'tightening' : trend < -0.3 ? 'widening' : 'flat';
  const commentary = tier === 'strong'
    ? `Credit spreads ${direction} (HYG/LQD +${trend.toFixed(1)}% over 20d) — no stress in corporate debt.`
    : tier === 'weak'
      ? `Credit spreads ${direction} (HYG/LQD ${trend.toFixed(1)}% over 20d) — deteriorating risk appetite.`
      : `Credit spreads ${direction} (HYG/LQD ${trend >= 0 ? '+' : ''}${trend.toFixed(1)}% over 20d).`;
  return {
    label: 'Credit Spread',
    tier, score, weight: 10,
    rawValue: `${trend >= 0 ? '+' : ''}${trend.toFixed(2)}%`,
    commentary,
  };
}

function vrpSignal(snap: MacroSnapshot): SignalResult | null {
  if (!snap.vrp) return null;
  const d = snap.vrp.delta;
  // Asymmetric: negative VRP (IV < realized) is catastrophic for premium
  // sellers — punish 75% harder than positive VRP is rewarded.
  // delta -3→8, -1→36, 0→50, +2→66, +5→90, +7→100.
  const score = clamp(50 + (d >= 0 ? d * 8 : d * 14), 0, 100);
  const tier = tierOf(score);
  const commentary = d > 3
    ? `IV ${snap.vrp.impliedVol.toFixed(1)} exceeds 20d realized vol ${snap.vrp.realizedVol20d.toFixed(1)} by ${d.toFixed(1)} — sellers paid to take on volatility risk.`
    : d < 0
      ? `IV ${snap.vrp.impliedVol.toFixed(1)} below realized vol ${snap.vrp.realizedVol20d.toFixed(1)} — negative VRP, selling premium is mispriced.`
      : `IV ${snap.vrp.impliedVol.toFixed(1)} close to realized vol ${snap.vrp.realizedVol20d.toFixed(1)} — modest VRP.`;
  return {
    label: 'Vol Risk Premium',
    tier, score, weight: 15,
    rawValue: `${d >= 0 ? '+' : ''}${d.toFixed(2)}`,
    commentary,
  };
}

function breadthSignal(snap: MacroSnapshot): SignalResult | null {
  const values = Object.values(snap.sectorReturns20d);
  if (values.length === 0) return null;
  const positives = values.filter((v) => v > 0).length;
  const total = values.length;
  const pct = (positives / total) * 100;
  // Sigmoid pulls extremes outward: 20%→5, 40%→27, 50%→50, 60%→73, 80%→95.
  const score = sigmoid(pct - 50, 0.10);
  const tier = tierOf(score);
  const commentary = `${positives} of ${total} sector ETFs positive over 20 days (${pct.toFixed(0)}% breadth).`;
  return {
    label: 'Sector Breadth',
    tier, score, weight: 10,
    rawValue: `${positives}/${total}`,
    commentary,
  };
}

// --- Composite + memo generator ---

export function assessMacro(snap: MacroSnapshot): MacroAssessment {
  const signals: SignalResult[] = [];
  const builders = [
    vixRankSignal, termStructureSignal, skewSignal, spxTrendSignal,
    creditSignal, vrpSignal, breadthSignal,
  ];
  for (const b of builders) {
    const s = b(snap);
    if (s) signals.push(s);
  }

  const totalWeight = signals.reduce((s, v) => s + v.weight, 0);
  const weighted = signals.reduce((s, v) => s + v.score * v.weight, 0);
  const baseScore = totalWeight > 0 ? weighted / totalWeight : 0;

  // Stress penalty: when multiple signals collapse simultaneously, arithmetic
  // averaging understates systemic risk because a high VIX-rank score keeps
  // propping up the composite. Deduct 4pts per signal below 20 so that
  // crisis-like multi-alarm regimes drop into the single digits.
  const stressCount = signals.filter((s) => s.score < 20).length;
  const compositeScore = clamp(baseScore - 4 * stressCount, 0, 100);

  const stance: MacroAssessment['stance'] =
    compositeScore >= 60 ? 'favorable' : compositeScore >= 35 ? 'neutral' : 'unfavorable';

  // Build summary + recommendations
  const strong = signals.filter((s) => s.tier === 'strong');
  const weak = signals.filter((s) => s.tier === 'weak');

  let summary: string;
  if (stance === 'favorable') {
    const lead = strong[0]?.label || 'multiple signals';
    summary = `Favorable setup for premium sellers. ${lead} and ${strong.length - 1} other signal${strong.length > 2 ? 's' : ''} strong; ${weak.length} weak. Composite ${compositeScore.toFixed(0)}/100.`;
  } else if (stance === 'unfavorable') {
    const lead = weak[0]?.label || 'multiple signals';
    summary = `Hostile environment for premium sellers. ${lead} and other warning signs flashing. Composite ${compositeScore.toFixed(0)}/100 — consider reducing size or waiting for conditions to reset.`;
  } else {
    summary = `Mixed environment for premium sellers. ${strong.length} strong signal${strong.length !== 1 ? 's' : ''} offset by ${weak.length} weak. Composite ${compositeScore.toFixed(0)}/100 — trade selectively.`;
  }

  const recommendations: string[] = [];
  if (stance === 'favorable') {
    recommendations.push('Favor 30-45 DTE positions to capture elevated theta in rich premium.');
    if (signals.find((s) => s.label === 'SPX Trend')?.tier === 'strong') {
      recommendations.push('Cash-secured puts on strong-trending names offer solid risk/reward.');
    }
  } else if (stance === 'unfavorable') {
    recommendations.push('Reduce position sizing; avoid deploying fresh capital until composite improves.');
    if (signals.find((s) => s.label === 'Term Structure')?.tier === 'weak') {
      recommendations.push('Backwardation in the VIX curve — favor shorter DTEs (7-21) to limit exposure.');
    }
    if (signals.find((s) => s.label === 'SKEW')?.tier === 'weak') {
      recommendations.push('Elevated SKEW signals tail-risk pricing — avoid naked positions in index products.');
    }
  } else {
    recommendations.push('Neutral — favor individual setups scoring >70 rather than broad allocation.');
  }

  return { compositeScore, stance, signals, summary, recommendations };
}
