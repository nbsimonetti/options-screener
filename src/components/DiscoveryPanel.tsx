import { useState, useEffect, useMemo } from 'react';
import { Telescope, Plus, Check, ChevronDown, ChevronRight, Trash2, AlertTriangle } from 'lucide-react';
import { loadDiscoveryData, promoteTicker, demoteTicker, demoteAll, getPromoted } from '../services/discovery';
import type { DiscoveryData, DiscoveryRow } from '../services/discovery';

interface Props {
  direction: 'long' | 'short';
  onUniverseChange?: () => void; // lets the host tab refresh its universe count
}

const FACTOR_LABELS: Record<string, string> = {
  mom: '12-1 Mom', phigh: '52w High', trend: 'Trend', rs: 'Rel Strength',
  vol: 'Volume', gap: 'Gap/PEAD', ext: 'Extension', rw: 'Rel Weakness', dist: 'Distribution', regime: 'Regime',
};

export default function DiscoveryPanel({ direction, onUniverseChange }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DiscoveryData | null | 'loading'>('loading');
  const [promoted, setPromoted] = useState(() => new Set(getPromoted().map((r) => r.ticker)));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [snapshotAge, setSnapshotAge] = useState<number | null>(null);

  useEffect(() => {
    if (open && data === 'loading') {
      loadDiscoveryData().then((d) => {
        setData(d);
        if (d) setSnapshotAge(Math.round((Date.now() - new Date(d.fetchedAt).getTime()) / 3600000));
      });
    }
  }, [open, data]);

  const rows: DiscoveryRow[] = useMemo(() => {
    if (!data || data === 'loading') return [];
    const shortlist = direction === 'long' ? data.topLong : data.topShort;
    const byTicker = new Map(data.scored.map((r) => [r.t, r]));
    return shortlist.map((t) => byTicker.get(t)).filter((r): r is DiscoveryRow => !!r);
  }, [data, direction]);

  const scoreKey = direction === 'long' ? 'bull' : 'bear';
  const pctKey = direction === 'long' ? 'bullP' : 'bearP';

  const handlePromote = (ticker: string) => {
    promoteTicker(ticker, direction);
    setPromoted(new Set(getPromoted().map((r) => r.ticker)));
    onUniverseChange?.();
  };

  const handleDemote = (ticker: string) => {
    demoteTicker(ticker);
    setPromoted(new Set(getPromoted().map((r) => r.ticker)));
    onUniverseChange?.();
  };

  const promoteTop10 = () => {
    for (const r of rows.slice(0, 10)) promoteTicker(r.t, direction);
    setPromoted(new Set(getPromoted().map((r) => r.ticker)));
    onUniverseChange?.();
  };

  const removeAllPromoted = () => {
    if (!window.confirm('Remove ALL discovery-promoted tickers from the scan universe?')) return;
    demoteAll();
    setPromoted(new Set());
    onUniverseChange?.();
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-slate-700/20 transition-colors">
        <Telescope className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">
          Discovery — top {direction === 'long' ? 'bullish' : 'bearish'} candidates beyond your watchlist
        </h3>
        <span className="ml-auto flex items-center gap-3">
          {promoted.size > 0 && <span className="text-[10px] text-cyan-400">{promoted.size} promoted</span>}
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-700">
          {data === 'loading' && <p className="p-4 text-xs text-slate-500">Loading discovery data...</p>}

          {data === null && (
            <div className="p-4 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                discovery-data.json not found. On the live site it's built by the daily CI job — check the deploy workflow.
                In dev, generate a local test pool once: <span className="font-mono text-amber-200">node scripts/build-discovery-data.mjs --limit 120</span>
              </p>
            </div>
          )}

          {data && data !== 'loading' && (
            <>
              <div className="px-4 py-2 flex items-center gap-3 flex-wrap text-[10px] text-slate-500 border-b border-slate-700/60">
                <span>Pool: {data.stats.scored} scored of {data.stats.poolSize} ({data.stats.lc} large · {data.stats.sc} small-cap)</span>
                <span>· snapshot {snapshotAge}h old</span>
                <span className="ml-auto flex gap-2">
                  <button onClick={promoteTop10} className="rounded bg-cyan-700/60 hover:bg-cyan-600/60 px-2 py-1 text-cyan-100 transition-colors">Promote top 10</button>
                  {promoted.size > 0 && (
                    <button onClick={removeAllPromoted} className="rounded bg-slate-700 hover:bg-red-900/50 px-2 py-1 text-slate-300 hover:text-red-300 transition-colors flex items-center gap-1">
                      <Trash2 className="h-3 w-3" /> Remove promoted
                    </button>
                  )}
                </span>
              </div>

              {rows.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">No {direction} candidates cleared the discovery funnel today.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 border-b border-slate-700 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-1.5 text-left">#</th>
                      <th className="px-2 py-1.5 text-left">Ticker</th>
                      <th className="px-2 py-1.5 text-center" title="LC = S&P 500 / Nasdaq-100 · SC = Russell 2000 (small caps rank in their own percentile bucket and must clear the 90th percentile to appear)">Cap</th>
                      <th className="px-2 py-1.5 text-left">Sector</th>
                      <th className="px-2 py-1.5 text-right">Price</th>
                      <th className="px-2 py-1.5 text-right" title="20d average dollar volume">ADV</th>
                      <th className="px-2 py-1.5 text-right" title="Factor composite (IV-quality excluded — unknown until an options scan)">Score</th>
                      <th className="px-2 py-1.5 text-right" title="Percentile within its own cap bucket">Pctile</th>
                      <th className="px-2 py-1.5 text-center">Trigger</th>
                      <th className="px-2 py-1.5 text-center">Add</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const isPromoted = promoted.has(r.t);
                      const factors = direction === 'long' ? r.bf : r.sf;
                      const isExpanded = expanded === r.t;
                      return (
                        <FragmentRow
                          key={r.t}
                          rank={i + 1}
                          row={r}
                          score={r[scoreKey as 'bull' | 'bear']}
                          pct={r[pctKey as 'bullP' | 'bearP']}
                          factors={factors}
                          isPromoted={isPromoted}
                          isExpanded={isExpanded}
                          onToggle={() => setExpanded(isExpanded ? null : r.t)}
                          onPromote={() => handlePromote(r.t)}
                          onDemote={() => handleDemote(r.t)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              )}

              <p className="px-4 py-2 text-[10px] text-slate-600 border-t border-slate-700/60">
                Scored daily in CI with the same factor engine, zero API credits. Promoting adds the ticker to your scan
                universe; the next Long/Short scan evaluates its options chain (~14–125 credits per ticker). Shortlist
                rules: within-bucket percentile ranking, small caps need ≥ 90th percentile, max 3 per sector, put-side
                small caps face squeeze/exhaustion/liquidity guards.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FragmentRow({ rank, row, score, pct, factors, isPromoted, isExpanded, onToggle, onPromote, onDemote }: {
  rank: number;
  row: DiscoveryRow;
  score: number;
  pct: number | undefined;
  factors: [string, number][];
  isPromoted: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onPromote: () => void;
  onDemote: () => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/20 transition-colors" onClick={onToggle}>
        <td className="px-3 py-1.5 text-xs text-slate-500 font-mono">#{rank}</td>
        <td className="px-2 py-1.5 font-semibold text-white">{row.t}</td>
        <td className="px-2 py-1.5 text-center">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${row.cap === 'SC' ? 'bg-cyan-900/50 text-cyan-300' : 'bg-slate-700 text-slate-300'}`}>{row.cap}</span>
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-400">{row.sec}</td>
        <td className="px-2 py-1.5 text-right text-xs font-mono text-slate-300">${row.p.toFixed(2)}</td>
        <td className="px-2 py-1.5 text-right text-xs font-mono text-slate-400">${row.adv}M</td>
        <td className="px-2 py-1.5 text-right text-xs font-mono text-white">{score.toFixed(0)}</td>
        <td className="px-2 py-1.5 text-right text-xs font-mono text-slate-300">{pct ?? '—'}</td>
        <td className="px-2 py-1.5 text-center text-xs text-sky-300">{row.trig ?? <span className="text-slate-600">—</span>}</td>
        <td className="px-2 py-1.5 text-center">
          {isPromoted ? (
            <button onClick={(e) => { e.stopPropagation(); onDemote(); }} title="In universe — click to remove" className="text-emerald-400 hover:text-red-400 transition-colors">
              <Check className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onPromote(); }} title="Add to scan universe" className="text-slate-400 hover:text-cyan-300 transition-colors">
              <Plus className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-slate-700/50">
          <td colSpan={10} className="px-4 py-2 bg-slate-900/50">
            <div className="flex flex-wrap gap-3">
              {factors.map(([key, s]) => (
                <span key={key} className="text-[10px] text-slate-400">
                  {FACTOR_LABELS[key] ?? key}: <span className={`font-mono ${s >= 65 ? 'text-emerald-400' : s >= 40 ? 'text-amber-300' : 'text-red-400'}`}>{s}</span>
                </span>
              ))}
              {row.g.length > 0 && <span className="text-[10px] text-amber-400">guards: {row.g.join('; ')}</span>}
              {row.trigDate && <span className="text-[10px] text-sky-300">trigger fired {row.trigDate}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
