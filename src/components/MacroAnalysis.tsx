import { useState, useEffect, useCallback, useMemo } from 'react';
import { Gauge, Loader2, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { MacroSnapshot } from '../services/macro';
import { getMacroSnapshot, loadSavedSnapshot, saveSnapshot, clearMacroCache, computeImpliedMoveSPY, recordCompositeScore, loadCompositeHistory } from '../services/macro';
import { assessMacro } from '../services/macroSignals';
import type { MacroAssessment, SignalResult } from '../services/macroSignals';
import Sparkline from './Sparkline';
import { formatPercent, scoreColor, scoreBgColor } from '../utils/formatting';

const SECTOR_LABELS: Record<string, string> = {
  XLF: 'Financials', XLE: 'Energy', XLK: 'Technology', XLY: 'Consumer Disc.',
  XLV: 'Healthcare', XLI: 'Industrials', XLP: 'Consumer Staples', XLU: 'Utilities',
  XLB: 'Materials', XLC: 'Communication', XLRE: 'Real Estate',
};

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function tierColor(tier: 'strong' | 'neutral' | 'weak'): string {
  return tier === 'strong' ? 'text-green-400' : tier === 'neutral' ? 'text-yellow-400' : 'text-red-400';
}

function tierBg(tier: 'strong' | 'neutral' | 'weak'): string {
  return tier === 'strong' ? 'bg-green-500/70' : tier === 'neutral' ? 'bg-yellow-500/70' : 'bg-red-500/70';
}

function stanceBadge(stance: MacroAssessment['stance']): { text: string; cls: string } {
  if (stance === 'favorable') return { text: 'FAVORABLE — good setup for premium sellers', cls: 'bg-green-900/40 text-green-300 border-green-700/50' };
  if (stance === 'unfavorable') return { text: 'UNFAVORABLE — reduce size or wait for better conditions', cls: 'bg-red-900/40 text-red-300 border-red-700/50' };
  return { text: 'NEUTRAL — trade selectively, favor high-conviction setups', cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' };
}

export default function MacroAnalysis() {
  const [snapshot, setSnapshot] = useState<MacroSnapshot | null>(() => loadSavedSnapshot());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const assessment: MacroAssessment | null = useMemo(() => snapshot ? assessMacro(snapshot) : null, [snapshot]);

  // Record today's composite score on any update
  useEffect(() => {
    if (assessment) recordCompositeScore(assessment.compositeScore);
  }, [assessment]);

  const compositeHistory = loadCompositeHistory();
  const compositeHistoryValues = compositeHistory.map((e) => e.score);

  const refresh = useCallback(async (force: boolean = false) => {
    setError('');
    setLoading(true);
    try {
      if (force) clearMacroCache();
      const snap = await getMacroSnapshot();
      setSnapshot(snap);
      saveSnapshot(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load macro data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount if we have no snapshot OR it's >1h old
  useEffect(() => {
    if (!snapshot) { refresh(false); return; }
    const age = Date.now() - new Date(snapshot.fetchedAt).getTime();
    if (age > 60 * 60 * 1000) refresh(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Gauge className="h-4 w-4 text-emerald-400" /> Options Macro Analysis
        </h2>
        <button
          onClick={() => refresh(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {snapshot ? `Last updated ${formatTimeAgo(snapshot.fetchedAt)}` : 'No data yet'}
        </span>
      </div>

      {error && (
        <div className="rounded border border-red-700/50 bg-red-900/20 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {snapshot?.failures && snapshot.failures.length > 0 && (
        <div className="rounded border border-amber-700/50 bg-amber-900/20 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300">
            <p className="font-medium mb-1">Some metrics unavailable:</p>
            <ul className="space-y-0.5">
              {snapshot.failures.map((f, i) => <li key={i} className="text-[11px] text-amber-400/80">• {f}</li>)}
            </ul>
          </div>
        </div>
      )}

      {!snapshot && loading && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <Loader2 className="h-8 w-8 text-emerald-400 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-slate-400">Fetching macro data...</p>
        </div>
      )}

      {snapshot && assessment && (
        <>
          {/* Composite score + stance */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex flex-col items-center">
                <div className={`text-5xl font-bold font-mono px-4 py-2 rounded border ${scoreColor(assessment.compositeScore)} ${scoreBgColor(assessment.compositeScore)}`}>
                  {assessment.compositeScore.toFixed(0)}
                </div>
                {compositeHistoryValues.length > 1 && (
                  <div className="mt-2">
                    <Sparkline values={compositeHistoryValues} width={120} height={24} color="#34d399" filled />
                    <div className="text-[10px] text-slate-500 text-center mt-0.5">{compositeHistoryValues.length}-day history</div>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className={`inline-block rounded border px-3 py-1 text-xs font-semibold ${stanceBadge(assessment.stance).cls}`}>
                  {stanceBadge(assessment.stance).text}
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{assessment.summary}</p>
              </div>
            </div>
          </div>

          {/* Metric cards grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Volatility */}
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">Volatility</h3>
              <div className="space-y-2 text-xs">
                <VolRow label="VIX" vol={snapshot.vix} />
                <VolRow label="VIX3M" vol={snapshot.vix3m} />
                <VolRow label="VVIX" vol={snapshot.vvix} />
                <VolRow label="SKEW" vol={snapshot.skew} />
                {snapshot.vix && snapshot.vix3m && (
                  <div className="pt-1 text-[11px] text-slate-500">
                    Term structure: <span className={snapshot.vix3m.level > snapshot.vix.level ? 'text-green-400' : 'text-red-400'}>
                      {snapshot.vix3m.level > snapshot.vix.level ? 'Contango ✓' : 'Backwardation ⚠'}
                    </span>
                    <span className="text-slate-600"> (spread {(snapshot.vix3m.level - snapshot.vix.level).toFixed(2)})</span>
                  </div>
                )}
              </div>
            </div>

            {/* Indices */}
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Index Trend</h3>
              <div className="space-y-3 text-xs">
                <IndexRow label="S&P 500" snap={snapshot.indices.SPX} />
                <IndexRow label="Nasdaq 100" snap={snapshot.indices.NDX} />
                <IndexRow label="Russell 2000" snap={snapshot.indices.RUT} />
                {snapshot.spyPrice && snapshot.vix && (
                  <div className="pt-2 border-t border-slate-700 text-[11px] text-slate-500 space-y-0.5">
                    <div>SPY 1-week expected move: <span className="text-white font-mono">±${computeImpliedMoveSPY(snapshot.spyPrice, snapshot.vix.level, 7).toFixed(2)}</span></div>
                    <div>SPY 1-month expected move: <span className="text-white font-mono">±${computeImpliedMoveSPY(snapshot.spyPrice, snapshot.vix.level, 30).toFixed(2)}</span></div>
                  </div>
                )}
              </div>
            </div>

            {/* Credit / Rates / VRP */}
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">Credit &middot; Rates &middot; VRP</h3>
              <div className="space-y-2 text-xs">
                {snapshot.creditSpread && (
                  <div>
                    <span className="text-slate-400">Credit spread (HYG/LQD):</span>{' '}
                    <span className={snapshot.creditSpread.ratioTrend20d > 0 ? 'text-green-400' : 'text-red-400'}>
                      {snapshot.creditSpread.ratioTrend20d > 0 ? 'tightening' : 'widening'}
                    </span>
                    <span className="text-slate-500"> ({formatPercent(snapshot.creditSpread.ratioTrend20d / 100)} 20d)</span>
                  </div>
                )}
                {snapshot.yieldProxy && (
                  <div>
                    <span className="text-slate-400">10Y proxy (TLT):</span>{' '}
                    <span className="font-mono text-white">${snapshot.yieldProxy.tltPrice.toFixed(2)}</span>
                    <span className="text-slate-500"> ({formatPercent(snapshot.yieldProxy.tltReturn20d / 100)} 20d)</span>
                  </div>
                )}
                {snapshot.vrp && (
                  <div>
                    <span className="text-slate-400">Vol Risk Premium:</span>{' '}
                    <span className={`font-mono ${snapshot.vrp.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {snapshot.vrp.delta >= 0 ? '+' : ''}{snapshot.vrp.delta.toFixed(2)}
                    </span>
                    <span className="text-slate-500"> (IV {snapshot.vrp.impliedVol.toFixed(1)} vs RV {snapshot.vrp.realizedVol20d.toFixed(1)})</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sector breadth */}
          {Object.keys(snapshot.sectorReturns20d).length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Sector 20-Day Returns</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {Object.entries(snapshot.sectorReturns20d).map(([sym, ret]) => (
                  <div key={sym} className="rounded bg-slate-900/50 border border-slate-700 p-2">
                    <div className="text-[10px] text-slate-500">{SECTOR_LABELS[sym] || sym}</div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-white font-mono">{sym}</span>
                      <span className={`text-xs font-mono ml-auto ${ret > 0 ? 'text-green-400' : ret < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signal breakdown */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Signal Breakdown</h3>
            <div className="space-y-2">
              {assessment.signals.map((s) => <SignalRow key={s.label} sig={s} />)}
            </div>
          </div>

          {/* Memo */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Market Memo</h3>
            <p className="text-sm text-white leading-relaxed mb-3">{assessment.summary}</p>
            {assessment.recommendations.length > 0 && (
              <div>
                <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Recommendations</h4>
                <ul className="space-y-1.5">
                  {assessment.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">→</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/50 flex items-center justify-between text-[10px] text-slate-500">
            <span>Data sources: {snapshot.dataSources.join(', ')}</span>
            <span>As of {new Date(snapshot.fetchedAt).toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
}

// --- Sub-rows ---

function VolRow({ label, vol }: { label: string; vol?: { level: number; changePct: number; change5d?: number; rank: number; history?: number[] } }) {
  if (!vol) return <div className="flex items-center gap-2 text-slate-600"><span className="w-16">{label}</span><span className="text-[10px]">unavailable</span></div>;
  const arrow = vol.changePct > 0 ? <TrendingUp className="h-3 w-3 text-red-400" /> : vol.changePct < 0 ? <TrendingDown className="h-3 w-3 text-green-400" /> : <Minus className="h-3 w-3 text-slate-500" />;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-slate-400">{label}</span>
      <span className="w-14 text-right font-mono text-white">{vol.level.toFixed(2)}</span>
      {arrow}
      <span className={`text-[11px] font-mono ${vol.changePct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
        {vol.changePct >= 0 ? '+' : ''}{vol.changePct.toFixed(2)}%
      </span>
      {vol.change5d != null && (
        <span className={`text-[10px] font-mono ${vol.change5d >= 0 ? 'text-red-400/70' : 'text-green-400/70'}`} title="5-day change">
          {vol.change5d >= 0 ? '+' : ''}{vol.change5d.toFixed(1)}%·5d
        </span>
      )}
      {vol.history && vol.history.length > 1 && (
        <Sparkline values={vol.history} width={60} height={16} color="#94a3b8" />
      )}
      <span className="ml-auto text-[10px] text-slate-500">rank {vol.rank.toFixed(0)}</span>
    </div>
  );
}

function IndexRow({ label, snap }: { label: string; snap?: { level: number; changePct: number; change5d?: number; aboveMA50: boolean; aboveMA200: boolean; distanceFromHigh: number; history?: number[] } }) {
  if (!snap) return <div className="text-slate-600 text-[11px]">{label}: unavailable</div>;
  const bothAbove = snap.aboveMA50 && snap.aboveMA200;
  const bothBelow = !snap.aboveMA50 && !snap.aboveMA200;
  const stateText = bothAbove ? 'above 50 & 200 DMA' : bothBelow ? 'below 50 & 200 DMA' : 'mixed vs. DMAs';
  const stateCls = bothAbove ? 'text-green-400' : bothBelow ? 'text-red-400' : 'text-yellow-400';
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-20 text-slate-400">{label}</span>
        <span className="font-mono text-white">{snap.level.toFixed(0)}</span>
        <span className={`text-[11px] font-mono ${snap.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {snap.changePct >= 0 ? '+' : ''}{snap.changePct.toFixed(2)}%
        </span>
        {snap.change5d != null && (
          <span className={`text-[10px] font-mono ${snap.change5d >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`} title="5-day change">
            {snap.change5d >= 0 ? '+' : ''}{snap.change5d.toFixed(1)}%·5d
          </span>
        )}
        {snap.history && snap.history.length > 1 && (
          <Sparkline values={snap.history} width={60} height={16} color="#60a5fa" />
        )}
      </div>
      <div className={`text-[10px] pl-20 ${stateCls}`}>
        {stateText} &middot; {snap.distanceFromHigh.toFixed(1)}% off 52w high
      </div>
    </div>
  );
}

function SignalRow({ sig }: { sig: SignalResult }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-32 shrink-0 text-slate-400">{sig.label}</span>
      <div className="flex-1 h-1.5 mt-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${tierBg(sig.tier)}`} style={{ width: `${sig.score}%` }} />
      </div>
      <span className={`w-10 text-right font-mono ${tierColor(sig.tier)}`}>{sig.score.toFixed(0)}</span>
      <span className="w-24 text-right font-mono text-slate-400 shrink-0">{sig.rawValue}</span>
      <span className="flex-[2] text-slate-500 text-[11px] leading-relaxed">{sig.commentary}</span>
    </div>
  );
}
