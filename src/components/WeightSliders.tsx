import { RotateCcw } from 'lucide-react';
import type { ScoringWeights, WeightPreset } from '../types';
import { WEIGHT_PRESETS } from '../types';

interface Props {
  weights: ScoringWeights;
  onChange: (weights: ScoringWeights) => void;
}

const LABELS: Record<keyof ScoringWeights, string> = {
  annualizedYield: 'Annualized Yield',
  delta: 'Delta / P(OTM)',
  ivRank: 'IV Rank',
  liquidity: 'Liquidity',
  thetaEfficiency: 'Theta Efficiency',
  otmDistance: 'OTM Distance',
  earningsProximity: 'Earnings Proximity',
};

const DESCRIPTIONS: Record<keyof ScoringWeights, string> = {
  annualizedYield: 'Return on capital if option expires worthless',
  delta: 'Probability of NOT being assigned',
  ivRank: 'Whether IV is elevated vs. 52-week range',
  liquidity: 'Bid-ask spread, volume, open interest',
  thetaEfficiency: 'Optimal theta decay (30-45 DTE sweet spot)',
  otmDistance: 'Safety buffer from current price',
  earningsProximity: 'Risk of gap move from earnings',
};

export default function WeightSliders({ weights, onChange }: Props) {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const updateWeight = (key: keyof ScoringWeights, value: number) => {
    onChange({ ...weights, [key]: value });
  };

  const applyPreset = (preset: WeightPreset) => {
    onChange({ ...preset.weights });
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Scoring Weights</h2>
        <span className="text-xs text-slate-400">
          Total: <span className={totalWeight === 100 ? 'text-emerald-400' : 'text-yellow-400'}>{totalWeight}</span>/100
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        {WEIGHT_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPreset(preset)}
            className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
          >
            {preset.name}
          </button>
        ))}
        <button
          onClick={() => applyPreset(WEIGHT_PRESETS[0])}
          className="ml-auto rounded bg-slate-700 p-1 text-slate-400 hover:bg-slate-600 hover:text-white transition-colors"
          title="Reset to balanced"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        {(Object.keys(LABELS) as (keyof ScoringWeights)[]).map((key) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <span className="text-xs font-medium text-slate-300">{LABELS[key]}</span>
                <span className="ml-2 text-[10px] text-slate-500">{DESCRIPTIONS[key]}</span>
              </div>
              <span className="text-xs font-mono text-emerald-400 w-8 text-right">{weights[key]}</span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              value={weights[key]}
              onChange={(e) => updateWeight(key, +e.target.value)}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-700 accent-emerald-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
