import { ChevronDown, ChevronRight, Plus, X, Shield, AlertTriangle, TrendingUp, MessageSquare } from 'lucide-react';
import type { InvestmentIdea } from '../types';
import { formatCurrency, formatPercent, formatDelta, formatIVRank, formatPSafe, scoreColor, scoreBgColor } from '../utils/formatting';
import { calcAnnualizedYield } from '../scoring/engine';
import { getBreakeven, getMaxProfit } from '../utils/payoff';
import PayoffDiagram from './PayoffDiagram';

interface Props {
  idea: InvestmentIdea;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onAddToScreener: () => void;
  onDismiss: () => void;
}

const CONFIDENCE_STYLES = {
  high: 'bg-green-900/40 text-green-300 border-green-700/50',
  medium: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  low: 'bg-red-900/40 text-red-300 border-red-700/50',
};

export default function IdeaCard({ idea, rank, expanded, onToggle, onAddToScreener, onDismiss }: Props) {
  const { position: p, score, thesis } = idea;
  const annYield = calcAnnualizedYield(p);

  return (
    <div className="border-b border-slate-700/50">
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/20 transition-colors"
        onClick={onToggle}
      >
        <span className="text-xs text-slate-500 w-6 text-right font-mono">#{rank}</span>

        {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}

        <span className={`text-lg font-bold font-mono px-2 py-0.5 rounded border ${scoreColor(score.compositeScore)} ${scoreBgColor(score.compositeScore)}`}>
          {score.compositeScore.toFixed(0)}
        </span>

        <span className="font-semibold text-white w-16">{p.ticker}</span>

        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.strategy === 'CSP' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'}`}>
          {p.strategy}
        </span>

        <span className="text-xs text-slate-400 w-16">${p.strikePrice}</span>

        <span className="text-xs text-emerald-400 w-16 font-mono">{formatPercent(annYield)}</span>

        <span className="text-xs text-slate-300 w-12 font-mono">{formatDelta(p.delta)}</span>

        <span className="text-xs text-slate-300 w-8">{p.dte}d</span>

        <span className="text-xs text-slate-300 w-12">{formatIVRank(p.ivRank)}</span>

        <span className={`ml-auto rounded border px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLES[thesis.confidence]}`}>
          {thesis.confidence}
        </span>

        <div className="flex-1 min-w-0 ml-2">
          <p className="text-xs text-slate-400 truncate">{thesis.summary}</p>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 bg-slate-900/50 border-t border-slate-700/30">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr] pt-4">
            {/* Left: Thesis */}
            <div className="space-y-4">
              {/* Summary */}
              <div>
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> Thesis
                </h4>
                <p className="text-sm text-white leading-relaxed">{thesis.summary}</p>
              </div>

              {/* Setup */}
              {thesis.setup && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Setup</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{thesis.setup}</p>
                </div>
              )}

              {/* Rationale */}
              {thesis.rationale && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Rationale</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{thesis.rationale}</p>
                </div>
              )}

              {/* Key Metrics */}
              {thesis.keyMetrics && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Key Metrics</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">{thesis.keyMetrics}</p>
                </div>
              )}

              {/* Risks & Catalysts side by side */}
              <div className="grid grid-cols-2 gap-3">
                {thesis.risks.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Risks
                    </h4>
                    <ul className="space-y-1">
                      {thesis.risks.map((r, i) => (
                        <li key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                          <span className="text-red-500 mt-0.5">-</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {thesis.catalysts.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Catalysts
                    </h4>
                    <ul className="space-y-1">
                      {thesis.catalysts.map((c, i) => (
                        <li key={i} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                          <span className="text-blue-500 mt-0.5">+</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Analyst Note */}
              {thesis.analystNote && (
                <div className="rounded bg-slate-800 border border-slate-700 p-3">
                  <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Analyst Note</h4>
                  <p className="text-xs text-slate-300 italic leading-relaxed">{thesis.analystNote}</p>
                </div>
              )}
            </div>

            {/* Right: Metrics + Payoff */}
            <div className="space-y-4">
              {/* Quick metrics */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Premium', value: formatCurrency(p.premium) },
                  { label: 'Breakeven', value: formatCurrency(getBreakeven(p)) },
                  { label: 'Max Profit', value: formatCurrency(getMaxProfit(p)) },
                  { label: 'Ann. Yield', value: formatPercent(annYield) },
                  { label: 'Delta', value: formatDelta(p.delta) },
                  { label: 'P(Safe)', value: formatPSafe(p.delta) },
                  { label: 'IV Rank', value: formatIVRank(p.ivRank) },
                  { label: 'DTE', value: `${p.dte}d` },
                  { label: 'Volume', value: p.volume.toLocaleString() },
                  { label: 'Open Int.', value: p.openInterest.toLocaleString() },
                ].map((m) => (
                  <div key={m.label} className="rounded bg-slate-800 border border-slate-700 p-2 text-center">
                    <div className="text-[10px] text-slate-500">{m.label}</div>
                    <div className="text-sm font-mono text-white">{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Score breakdown bars */}
              <div className="rounded bg-slate-800 border border-slate-700 p-3">
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Score Breakdown
                </h4>
                <div className="space-y-1.5">
                  {score.breakdown.map((b) => (
                    <div key={b.key} className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500 w-24 shrink-0">{b.label}</span>
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500/70 transition-all"
                          style={{ width: `${b.normalizedScore}%` }}
                        />
                      </div>
                      <span className="text-slate-400 w-7 text-right font-mono">{b.normalizedScore.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mini payoff diagram */}
              <PayoffDiagram positions={[p]} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-700/30">
            <button
              onClick={(e) => { e.stopPropagation(); onAddToScreener(); }}
              className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add to Screener
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="flex items-center gap-2 rounded bg-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-600 transition-colors"
            >
              <X className="h-4 w-4" /> Dismiss
            </button>
            <span className="ml-auto text-[10px] text-slate-600">
              Generated {new Date(idea.generatedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
