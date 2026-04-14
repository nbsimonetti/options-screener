import { useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react';
import type { OptionPosition, ScoringWeights } from '../types';
import { scorePosition } from '../scoring/engine';
import { formatCurrency, formatPercent, formatDelta, formatIVRank, formatPSafe, scoreColor, scoreBgColor } from '../utils/formatting';
import { calcAnnualizedYield } from '../scoring/engine';
import { getBreakeven, getMaxProfit } from '../utils/payoff';

interface Props {
  positions: OptionPosition[];
  weights: ScoringWeights;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

type SortKey = 'ticker' | 'strategy' | 'score' | 'yield' | 'delta' | 'dte' | 'premium' | 'ivRank';

export default function PositionTable({ positions, weights, selectedIds, onToggleSelect, onRemove }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const scored = positions.map((pos) => ({
    pos,
    result: scorePosition(pos, weights),
    annualYield: calcAnnualizedYield(pos),
  }));

  const sorted = [...scored].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'ticker': cmp = a.pos.ticker.localeCompare(b.pos.ticker); break;
      case 'strategy': cmp = a.pos.strategy.localeCompare(b.pos.strategy); break;
      case 'score': cmp = a.result.compositeScore - b.result.compositeScore; break;
      case 'yield': cmp = a.annualYield - b.annualYield; break;
      case 'delta': cmp = Math.abs(a.pos.delta) - Math.abs(b.pos.delta); break;
      case 'dte': cmp = a.pos.dte - b.pos.dte; break;
      case 'premium': cmp = a.pos.premium - b.pos.premium; break;
      case 'ivRank': cmp = a.pos.ivRank - b.pos.ivRank; break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const thClass = 'px-3 py-2 text-left text-xs font-medium text-slate-400 cursor-pointer hover:text-white select-none';

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center text-sm text-slate-500">
        No positions added yet. Use the form above or import CSV data.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
      <div className="overflow-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-700 bg-slate-800 shadow-sm">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className={thClass} onClick={() => toggleSort('score')}>
                <span className="flex items-center gap-1">Score <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('ticker')}>
                <span className="flex items-center gap-1">Ticker <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('strategy')}>Type</th>
              <th className={thClass}>Strike</th>
              <th className={thClass} onClick={() => toggleSort('premium')}>
                <span className="flex items-center gap-1">Premium <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('yield')}>
                <span className="flex items-center gap-1">Ann. Yield <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('delta')}>
                <span className="flex items-center gap-1" title="Absolute delta — lower = safer">Delta <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('delta')}>
                <span className="flex items-center gap-1" title="Probability option expires OTM (not assigned)">P(Safe) <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className={thClass} onClick={() => toggleSort('dte')}>DTE</th>
              <th className={thClass} onClick={() => toggleSort('ivRank')}>IVR</th>
              <th className={thClass}>Breakeven</th>
              <th className={thClass}>Max Profit</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ pos, result, annualYield }) => {
              const isExpanded = expandedId === pos.id;
              return (
                <tr key={pos.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(pos.id)}
                      onChange={() => onToggleSelect(pos.id)}
                      className="rounded border-slate-600 accent-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                      className="flex items-center gap-1"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                      <span className={`font-bold text-lg font-mono ${scoreColor(result.compositeScore)} border rounded px-2 py-0.5 ${scoreBgColor(result.compositeScore)}`}>
                        {result.compositeScore.toFixed(0)}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 font-semibold text-white">{pos.ticker}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${pos.strategy === 'CSP' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'}`}>
                      {pos.strategy}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatCurrency(pos.strikePrice)}</td>
                  <td className="px-3 py-2 text-emerald-400">{formatCurrency(pos.premium)}</td>
                  <td className="px-3 py-2 text-slate-300">{formatPercent(annualYield)}</td>
                  <td className="px-3 py-2 text-slate-300">{formatDelta(pos.delta)}</td>
                  <td className="px-3 py-2 text-emerald-400 font-mono">{formatPSafe(pos.delta)}</td>
                  <td className="px-3 py-2 text-slate-300">{pos.dte}d</td>
                  <td className="px-3 py-2 text-slate-300">{formatIVRank(pos.ivRank)}</td>
                  <td className="px-3 py-2 text-slate-300">{formatCurrency(getBreakeven(pos))}</td>
                  <td className="px-3 py-2 text-emerald-400">{formatCurrency(getMaxProfit(pos))}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onRemove(pos.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expandedId && (() => {
        const item = scored.find(s => s.pos.id === expandedId);
        if (!item) return null;
        return (
          <div className="border-t border-slate-700 bg-slate-900/50 p-4">
            <h3 className="text-xs font-semibold text-white mb-3">Score Breakdown — {item.pos.ticker} {item.pos.strategy}</h3>
            <div className="grid grid-cols-7 gap-2">
              {item.result.breakdown.map((b) => (
                <div key={b.key} className="rounded bg-slate-800 border border-slate-700 p-2 text-center">
                  <div className="text-[10px] text-slate-500 mb-1">{b.label}</div>
                  <div className={`text-lg font-bold font-mono ${scoreColor(b.normalizedScore)}`}>
                    {b.normalizedScore.toFixed(0)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {b.rawUnit === '%' ? formatPercent(b.rawValue)
                      : b.rawUnit === 'delta' ? `${formatDelta(b.rawValue)} (${formatPSafe(b.rawValue)} safe)`
                      : b.rawUnit === 'ivr' ? formatIVRank(b.rawValue)
                      : b.rawUnit === 'DTE' ? `${b.rawValue}d`
                      : b.rawUnit === 'days' ? `${b.rawValue === Infinity ? 'N/A' : Math.round(b.rawValue as number) + 'd'}`
                      : formatPercent(b.rawValue)}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5">wt: {b.weight} &rarr; {b.weightedScore.toFixed(0)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
