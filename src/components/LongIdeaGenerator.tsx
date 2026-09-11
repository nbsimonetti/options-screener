import { useState, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Loader2, Rocket, Info, ChevronDown, ChevronRight, AlertTriangle, X } from 'lucide-react';
import type { APIConfig, LongIdea, ScanProgress } from '../types';
import { getUniverse } from '../services/universe';
import { scanForLongIdeas, DEFAULT_LONG_SCAN_CREDITS } from '../services/longScanner';
import { historySource, getHistorySnapshotAge } from '../services/history';
import { allocateBudget } from '../services/creditLedger';
import { loadPortfolio } from '../services/paperEngine';
import { getCreditCount } from '../services/marketdata';
import { formatCurrency } from '../utils/formatting';

interface Props {
  apiConfig: APIConfig;
  ideas: LongIdea[];
  onIdeasChange: (ideas: LongIdea[]) => void;
}

function breakeven(idea: LongIdea): number {
  return idea.direction === 'LC'
    ? idea.contract.strike + idea.contract.mid
    : idea.contract.strike - idea.contract.mid;
}

function scoreColorCls(score: number): string {
  if (score >= 70) return 'text-emerald-400 border-emerald-700/50 bg-emerald-900/30';
  if (score >= 55) return 'text-amber-300 border-amber-700/50 bg-amber-900/20';
  return 'text-slate-400 border-slate-600 bg-slate-800';
}

export default function LongIdeaGenerator({ apiConfig, ideas, onIdeasChange }: Props) {
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle', current: 0, total: 0, currentTicker: '', message: '', requestsUsed: 0, requestBudget: DEFAULT_LONG_SCAN_CREDITS });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSkips, setShowSkips] = useState(false);
  const [skips, setSkips] = useState<string[]>([]);

  const universe = getUniverse();

  const runScan = useCallback(async () => {
    setError('');
    setNotice('');
    setExpandedId(null);
    try {
      const alloc = allocateBudget(loadPortfolio().positions.length);
      const budget = Math.min(DEFAULT_LONG_SCAN_CREDITS, alloc.longScan);
      setProgress({ phase: 'fetching', current: 0, total: universe.length, currentTicker: '', message: 'Starting long scan...', requestsUsed: 0, requestBudget: budget });
      const result = await scanForLongIdeas(universe, setProgress, apiConfig.marketDataToken || undefined, budget);
      onIdeasChange(result.ideas);
      setSkips(result.skips);
      const notices: string[] = [];
      if (result.degradedToCacheOnly) notices.push('Credit budget ran low — some qualified tickers were skipped at the options stage.');
      if (result.ideas.length === 0) notices.push('No candidates cleared the funnel — long premium demands cheap vol AND directional structure, so an empty day is normal.');
      if (historySource() === 'static-snapshot') {
        const fetchedAt = await getHistorySnapshotAge();
        if (fetchedAt) {
          const ageDays = (Date.now() - new Date(fetchedAt).getTime()) / 86400000;
          if (ageDays > 2) notices.push(`History snapshot is ${ageDays.toFixed(0)} days old (CI refreshes it hourly during market hours — check the deploy workflow).`);
        }
      }
      setNotice(notices.join(' '));
      setProgress({ phase: 'complete', current: result.ideas.length, total: result.ideas.length, currentTicker: '', message: `${result.ideas.length} long ideas · ${result.creditsUsed} credits used`, requestsUsed: result.creditsUsed, requestBudget: budget });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
      setProgress({ phase: 'error', current: 0, total: 0, currentTicker: '', message: msg, requestsUsed: getCreditCount(), requestBudget: DEFAULT_LONG_SCAN_CREDITS });
    }
  }, [universe, apiConfig, onIdeasChange]);

  const isScanning = progress.phase === 'fetching' || progress.phase === 'scoring';
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const calls = useMemo(() => ideas.filter((i) => i.direction === 'LC'), [ideas]);
  const puts = useMemo(() => ideas.filter((i) => i.direction === 'LP'), [ideas]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Rocket className="h-4 w-4 text-sky-400" /> AI Idea Generator (Long)
          </h2>
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 rounded bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {isScanning ? 'Scanning...' : 'Generate Long Ideas'}
          </button>
          <span className="ml-auto text-xs text-slate-500">
            {universe.length} tickers &middot; buys calls/puts when vol is cheap and direction is evidenced
          </span>
        </div>

        <div className="mt-3 flex items-start gap-3 rounded border border-sky-700/40 bg-sky-900/15 p-3">
          <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
          <p className="text-xs text-sky-200/90">
            The long screener is the inverse of the income screener: it demands <b>low</b> IV Rank (≤ 50, ideally 5–30),
            IV cheap vs. realized movement, ITM 0.55–0.75Δ contracts at 60–120 DTE, and directional factor confluence
            (momentum, trend quality, relative strength). Full spec in <span className="font-mono">docs/LONG_STRATEGY_DESIGN.md</span>.
          </p>
        </div>

        {isScanning && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{progress.message}</span>
              <span className="font-mono">{progress.requestsUsed}/{progress.requestBudget} credits</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-sky-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {!isScanning && progress.phase === 'complete' && (
          <div className="mt-3 text-xs text-slate-500">{progress.message}</div>
        )}
        {notice && <div className="mt-2 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">{notice}</div>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        {skips.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowSkips(!showSkips)} className="text-[10px] text-slate-500 hover:text-slate-300">
              {showSkips ? 'Hide' : 'Show'} funnel rejections ({skips.length})
            </button>
            {showSkips && (
              <div className="mt-1 max-h-[160px] overflow-y-auto rounded bg-slate-900/50 border border-slate-700 p-2">
                {skips.map((s, i) => (
                  <div key={i} className="text-[10px] text-slate-500 font-mono">{s}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {ideas.length > 0 && (
        <>
          <LongTable title={`Long Calls (${calls.length})`} icon={<TrendingUp className="h-4 w-4 text-emerald-400" />} ideas={calls} expandedId={expandedId} onToggle={(id) => setExpandedId(expandedId === id ? null : id)} onDismiss={(id) => onIdeasChange(ideas.filter((i) => i.id !== id))} />
          <LongTable title={`Long Puts (${puts.length})`} icon={<TrendingDown className="h-4 w-4 text-red-400" />} ideas={puts} expandedId={expandedId} onToggle={(id) => setExpandedId(expandedId === id ? null : id)} onDismiss={(id) => onIdeasChange(ideas.filter((i) => i.id !== id))} />
          <div className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/50 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {ideas.length} ideas &middot; {ideas.filter((i) => i.tier === 'trade').length} trade-ready (score ≥ threshold with a fresh trigger) &middot; {ideas.filter((i) => i.tier === 'watchlist').length} watchlist
            </span>
            {ideas[0]?.generatedAt && <span className="text-[10px] text-slate-600">Generated {new Date(ideas[0].generatedAt).toLocaleString()}</span>}
          </div>
        </>
      )}

      {ideas.length === 0 && progress.phase === 'idle' && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <Rocket className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Click "Generate Long Ideas" to screen {universe.length} tickers for directional long call / long put setups.
          </p>
          <p className="text-xs text-slate-600 mt-1">Factor analysis uses free Yahoo history; option chains use MarketData credits only for qualified tickers.</p>
        </div>
      )}
    </div>
  );
}

interface TableProps {
  title: string;
  icon: React.ReactNode;
  ideas: LongIdea[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onDismiss: (id: string) => void;
}

function LongTable({ title, icon, ideas, expandedId, onToggle, onDismiss }: TableProps) {
  if (ideas.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2">
        {icon}<h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2 text-center">Score</th>
              <th className="px-2 py-2 text-left">Ticker</th>
              <th className="px-2 py-2 text-center">Tier</th>
              <th className="px-2 py-2 text-center" title="Fresh mechanical entry trigger (breakout / pullback), if any">Trigger</th>
              <th className="px-2 py-2 text-right">Contract</th>
              <th className="px-2 py-2 text-right" title="Signed contract delta">Δ</th>
              <th className="px-2 py-2 text-right">DTE</th>
              <th className="px-2 py-2 text-right" title="Debit at mid price — also the max loss per contract">Debit / Max Loss</th>
              <th className="px-2 py-2 text-right">Breakeven</th>
              <th className="px-2 py-2 text-right" title="Underlying stop (rule R10): thesis-invalidation level">Stop</th>
              <th className="px-2 py-2 text-right" title="IV Rank (history percentile when ≥20 samples, else smile estimate)">IVR</th>
              <th className="px-2 py-2 text-right" title="Contract IV ÷ max(HV20, HV30) — want ≤ 1.10">IV/HV</th>
              <th className="px-2 py-2 text-right" title="Implied expected move ÷ median historical move — want ≤ 1.0">EM×</th>
              <th className="px-2 py-2 text-center">Flags</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea) => {
              const expanded = expandedId === idea.id;
              return (
                <IdeaRow key={idea.id} idea={idea} expanded={expanded} onToggle={() => onToggle(idea.id)} onDismiss={() => onDismiss(idea.id)} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IdeaRow({ idea, expanded, onToggle, onDismiss }: { idea: LongIdea; expanded: boolean; onToggle: () => void; onDismiss: () => void }) {
  const be = breakeven(idea);
  return (
    <>
      <tr className="border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/20 transition-colors" onClick={onToggle}>
        <td className="px-2 py-2">{expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</td>
        <td className="px-2 py-2 text-center">
          <span className={`inline-block text-base font-bold font-mono px-2 py-0.5 rounded border ${scoreColorCls(idea.overallScore)}`}>{idea.overallScore.toFixed(0)}</span>
        </td>
        <td className="px-2 py-2 font-semibold text-white">{idea.ticker}<div className="text-[10px] font-normal text-slate-500">{formatCurrency(idea.currentPrice)}</div></td>
        <td className="px-2 py-2 text-center">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${idea.tier === 'trade' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>{idea.tier}</span>
        </td>
        <td className="px-2 py-2 text-center text-xs text-slate-300">
          {idea.entryTrigger ? <span className="text-sky-300">{idea.entryTrigger}<div className="text-[10px] text-slate-500">{idea.triggerDate}</div></span> : <span className="text-slate-600">—</span>}
        </td>
        <td className="px-2 py-2 text-right text-xs text-slate-300 font-mono">${idea.contract.strike} {idea.direction === 'LC' ? 'C' : 'P'}<div className="text-[10px] text-slate-500">{idea.contract.expirationDate}</div></td>
        <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{idea.contract.delta.toFixed(2)}</td>
        <td className="px-2 py-2 text-right text-xs text-slate-300">{idea.contract.dte}d</td>
        <td className="px-2 py-2 text-right text-xs font-mono text-white">{formatCurrency(idea.contract.mid)}<div className="text-[10px] text-red-400/80">max loss {formatCurrency(idea.contract.mid * 100)}</div></td>
        <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{formatCurrency(be)}</td>
        <td className="px-2 py-2 text-right text-xs font-mono text-amber-300/90">{formatCurrency(idea.stopLevel)}</td>
        <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{idea.ivRank.toFixed(0)}{idea.ivRankSource === 'smile' && <span className="text-slate-600" title="Smile-shape estimate — needs 20 daily samples for a true percentile">*</span>}</td>
        <td className={`px-2 py-2 text-right text-xs font-mono ${idea.ivHvRatio <= 0.9 ? 'text-emerald-400' : idea.ivHvRatio <= 1.1 ? 'text-slate-300' : 'text-amber-400'}`}>{idea.ivHvRatio.toFixed(2)}</td>
        <td className={`px-2 py-2 text-right text-xs font-mono ${idea.emRatio <= 0.8 ? 'text-emerald-400' : idea.emRatio <= 1 ? 'text-slate-300' : 'text-amber-400'}`}>{idea.emRatio.toFixed(2)}</td>
        <td className="px-2 py-2 text-center">{idea.flags.length > 0 ? <span title={idea.flags.join('\n')}><AlertTriangle className="h-4 w-4 text-amber-400 inline" /></span> : <span className="text-slate-700">—</span>}</td>
        <td className="px-2 py-2"><button onClick={(e) => { e.stopPropagation(); onDismiss(); }} className="text-slate-600 hover:text-red-400" aria-label="Dismiss"><X className="h-4 w-4" /></button></td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-700/50">
          <td colSpan={16} className="p-0">
            <div className="px-4 py-4 bg-slate-900/50 border-t border-slate-700/30 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-2">Factor Breakdown (composite {idea.compositeScore.toFixed(0)})</h4>
                <div className="space-y-1.5">
                  {idea.factors.map((fs) => (
                    <div key={fs.key} className="flex items-center gap-2 text-xs">
                      <span className="w-40 text-slate-400">{fs.label}</span>
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${fs.score >= 65 ? 'bg-emerald-500' : fs.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${fs.score}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono text-slate-300">{fs.score.toFixed(0)}</span>
                      <span className="w-12 text-right text-[10px] text-slate-600">wt {fs.weight}%</span>
                    </div>
                  ))}
                </div>
                {idea.flags.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Flags</h4>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {idea.flags.map((fl, i) => <li key={i} className="text-xs text-amber-300/90">{fl}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Rules That Will Govern This Trade</h4>
                <ul className="space-y-1 text-xs text-slate-300">
                  <li><span className="text-slate-500">Entry:</span> {idea.entryTrigger ? `${idea.entryTrigger} trigger fired ${idea.triggerDate} (SigRef ${formatCurrency(idea.sigRef)})` : 'no fresh trigger — watchlist until breakout/pullback fires'}</li>
                  <li><span className="text-slate-500">Stop (R10):</span> close {idea.direction === 'LC' ? 'below' : 'above'} {formatCurrency(idea.stopLevel)} (SigRef ∓ 1.0 × ATR {formatCurrency(idea.atr)})</li>
                  <li><span className="text-slate-500">Backstop (R8):</span> mark ≤ 40% of entry debit</li>
                  <li><span className="text-slate-500">Target (R9):</span> 2× debit — sell half if ≥ 2 contracts, then 2-ATR trail</li>
                  <li><span className="text-slate-500">Time stop (R11):</span> force-close at 21 DTE</li>
                  <li><span className="text-slate-500">Stale sweep (R13):</span> close after 40 sessions if never +20%</li>
                  <li><span className="text-slate-500">Sizing (R14):</span> 10% of paper equity, whole contracts, skip if 0</li>
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-slate-800/70 p-2"><div className="text-[10px] text-slate-500 uppercase">Vol context</div>HV20 {idea.hv20.toFixed(0)}% · HV60 {idea.hv60.toFixed(0)}% · IV {idea.contract.iv.toFixed(0)}%</div>
                  <div className="rounded bg-slate-800/70 p-2"><div className="text-[10px] text-slate-500 uppercase">Liquidity</div>{idea.contract.bid.toFixed(2)}×{idea.contract.ask.toFixed(2)} · OI {idea.contract.openInterest.toLocaleString()} · θ ${(Math.abs(idea.contract.theta) * 100).toFixed(0)}/day</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
