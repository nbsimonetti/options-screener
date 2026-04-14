import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend } from 'recharts';
import type { OptionPosition, ScoringWeights } from '../types';
import { scorePosition } from '../scoring/engine';
import { scoreColor } from '../utils/formatting';

interface Props {
  positions: OptionPosition[];
  weights: ScoringWeights;
}

const COLORS = ['#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24', '#f87171'];

const SHORT_LABELS: Record<string, string> = {
  'Annualized Yield': 'Yield',
  'Delta (P(OTM))': 'Delta',
  'IV Rank': 'IV Rank',
  'Liquidity': 'Liquidity',
  'Theta Efficiency': 'Theta',
  'OTM Distance': 'OTM %',
  'Earnings Proximity': 'Earnings',
};

export default function ScoreBreakdown({ positions, weights }: Props) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center text-sm text-slate-500">
        Select positions to see score breakdown.
      </div>
    );
  }

  const scored = positions.map((pos) => ({
    pos,
    result: scorePosition(pos, weights),
  }));

  const radarData = scored[0].result.breakdown.map((b, i) => {
    const row: Record<string, string | number> = { metric: SHORT_LABELS[b.label] || b.label };
    scored.forEach(({ pos, result }) => {
      row[`${pos.ticker} ${pos.strategy}`] = +result.breakdown[i].normalizedScore.toFixed(1);
    });
    return row;
  });

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="text-sm font-semibold text-white mb-3">Score Comparison</h2>

      <div className="grid gap-4" style={{ gridTemplateColumns: positions.length > 1 ? '1fr 1fr' : '1fr' }}>
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#64748b' }} />
              {scored.map(({ pos }, i) => (
                <Radar
                  key={pos.id}
                  name={`${pos.ticker} ${pos.strategy}`}
                  dataKey={`${pos.ticker} ${pos.strategy}`}
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              ))}
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-3 overflow-auto max-h-[300px]">
          {scored.map(({ pos, result }, i) => (
            <div key={pos.id} className="rounded bg-slate-800 border border-slate-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold" style={{ color: COLORS[i % COLORS.length] }}>
                  {pos.ticker} {pos.strategy} ${pos.strikePrice}
                </span>
                <span className={`text-lg font-bold font-mono ${scoreColor(result.compositeScore)}`}>
                  {result.compositeScore.toFixed(0)}
                </span>
              </div>
              <div className="space-y-1">
                {result.breakdown.map((b) => (
                  <div key={b.key} className="flex items-center gap-2 text-[11px]">
                    <span className="text-slate-500 w-20 shrink-0">{SHORT_LABELS[b.label] || b.label}</span>
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${b.normalizedScore}%`,
                          backgroundColor: COLORS[i % COLORS.length],
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="text-slate-400 w-7 text-right font-mono">{b.normalizedScore.toFixed(0)}</span>
                    <span className="text-slate-600 w-10 text-right font-mono">x{b.weight}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
