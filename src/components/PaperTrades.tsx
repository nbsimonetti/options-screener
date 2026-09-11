import { useState, useCallback, useMemo } from 'react';
import { FlaskConical, Play, Loader2, RotateCcw, Info, ScrollText, TrendingUp, TrendingDown } from 'lucide-react';
import type { APIConfig, InvestmentIdea, LongIdea, PaperPortfolio } from '../types';
import { PAPER_STARTING_CAPITAL } from '../types';
import { loadPortfolio, freshPortfolio, savePortfolio, runTradingCycle, equityOf, collateralOutstanding, openLongDebits } from '../services/paperEngine';
import { computeMetrics, tradeRMultiple } from '../services/paperMetrics';
import { formatCurrency } from '../utils/formatting';
import Sparkline from './Sparkline';

interface Props {
  apiConfig: APIConfig;
  longIdeas: LongIdea[];
  shortIdeas: InvestmentIdea[];
}

const KIND_STYLES: Record<string, string> = {
  LC: 'bg-emerald-900/50 text-emerald-300',
  LP: 'bg-red-900/50 text-red-300',
  CSP: 'bg-blue-900/50 text-blue-300',
};

export default function PaperTrades({ apiConfig, longIdeas, shortIdeas }: Props) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio>(() => loadPortfolio());
  const [running, setRunning] = useState(false);
  const [lastSummary, setLastSummary] = useState('');
  const [error, setError] = useState('');
  const [showJournal, setShowJournal] = useState(true);

  const equity = equityOf(portfolio);
  const pnl = equity - PAPER_STARTING_CAPITAL;
  const metrics = useMemo(() => computeMetrics(portfolio, PAPER_STARTING_CAPITAL), [portfolio]);

  const runCycle = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runTradingCycle(portfolio, longIdeas, shortIdeas, apiConfig.marketDataToken || undefined);
      setPortfolio(result.portfolio);
      setLastSummary(result.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cycle failed');
    } finally {
      setRunning(false);
    }
  }, [portfolio, longIdeas, shortIdeas, apiConfig]);

  const resetPortfolio = () => {
    if (!window.confirm(`Reset the paper portfolio? All positions, trades, and history will be wiped and capital restored to ${formatCurrency(PAPER_STARTING_CAPITAL)}. This cannot be undone.`)) return;
    const fresh = freshPortfolio();
    savePortfolio(fresh);
    setPortfolio(fresh);
    setLastSummary('');
  };

  const tradeReady = longIdeas.filter((i) => i.tier === 'trade').length;
  const cspReady = shortIdeas.filter((i) => i.position.strategy === 'CSP' && i.position.optionSymbol).length;

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-violet-400" /> Paper Trades
          </h2>
          <button
            onClick={runCycle}
            disabled={running}
            className="flex items-center gap-2 rounded bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running cycle...' : 'Run Trading Cycle'}
          </button>
          <button
            onClick={resetPortfolio}
            className="flex items-center gap-1 rounded bg-slate-800 border border-slate-600 px-3 py-2 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset portfolio
          </button>
          <span className="ml-auto text-xs text-slate-500">
            {tradeReady} trade-ready long ideas &middot; {cspReady} CSP candidates &middot; {portfolio.lastCycleAt ? `last cycle ${new Date(portfolio.lastCycleAt).toLocaleString()}` : 'no cycles yet'}
          </span>
        </div>

        {/* Headline equity strip */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded bg-slate-900/60 border border-slate-700 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Equity</div>
            <div className="text-xl font-bold font-mono text-white">{formatCurrency(equity)}</div>
            <div className={`text-xs font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} ({metrics.totalReturnPct.display})</div>
          </div>
          <div className="rounded bg-slate-900/60 border border-slate-700 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Cash / Free</div>
            <div className="text-sm font-mono text-slate-200 mt-1">{formatCurrency(portfolio.cash)}</div>
            <div className="text-[10px] text-slate-500">collateral {formatCurrency(collateralOutstanding(portfolio))}</div>
          </div>
          <div className="rounded bg-slate-900/60 border border-slate-700 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Open Premium at Risk</div>
            <div className="text-sm font-mono text-slate-200 mt-1">{formatCurrency(openLongDebits(portfolio))}</div>
            <div className="text-[10px] text-slate-500">cap 10% of equity (R15)</div>
          </div>
          <div className="rounded bg-slate-900/60 border border-slate-700 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Positions</div>
            <div className="text-sm font-mono text-slate-200 mt-1">{portfolio.positions.length} open · {portfolio.closedTrades.length} closed</div>
            <div className="text-[10px] text-slate-500">max 8 long + 1 CSP</div>
          </div>
          <div className="rounded bg-slate-900/60 border border-slate-700 p-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Equity Curve</div>
            {portfolio.equityHistory.length >= 2 ? (
              <Sparkline values={portfolio.equityHistory.map((m) => m.equity)} width={110} height={30} color={pnl >= 0 ? '#34d399' : '#f87171'} filled />
            ) : (
              <div className="text-[10px] text-slate-600 mt-2">needs 2+ marks</div>
            )}
          </div>
        </div>

        {lastSummary && <div className="mt-3 rounded border border-violet-700/40 bg-violet-900/15 px-3 py-2 text-xs text-violet-200">{lastSummary}</div>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-3 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-500">
            Simulation only — fills at MID ((bid+ask)/2), never on missing or crossed quotes; mid fills are optimistic, so the spread paid-vs-mid is recorded on every entry as a slippage caveat.
            The agent trades mechanically: long entries need a trade-tier idea with a fresh trigger; exits run R8–R13 (longs) and 50%-credit / 21-DTE / 2×-credit (CSPs) before any entry. Sizing is 1.5% of equity per trade, optimizing risk-adjusted return, not raw P&L.
          </p>
        </div>
      </div>

      {/* Risk-adjusted metrics */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h3 className="text-xs font-semibold text-white mb-3">Risk-Adjusted Performance</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <MetricTile label="Sortino" headline value={metrics.sortino.display} gated={metrics.sortino.gated} title="Headline metric: annualized Sortino (MAR 0). Long-premium P&L is positively skewed — Sharpe punishes exactly the upside dispersion the strategy exists to capture." />
          <MetricTile label="Sharpe" value={metrics.sharpe.display} gated={metrics.sharpe.gated} title="Annualized Sharpe ± standard-error band (Lo 2002), rf 4.0%" />
          <MetricTile label="Max Drawdown" value={metrics.maxDrawdown.display} gated={metrics.maxDrawdown.gated} />
          <MetricTile label="CAGR" value={metrics.cagr.display} gated={metrics.cagr.gated} />
          <MetricTile label="Calmar" value={metrics.calmar.display} gated={metrics.calmar.gated} />
          <MetricTile label="Profit Factor" value={metrics.profitFactor.display} gated={metrics.profitFactor.gated} />
          <MetricTile label="Win Rate" value={metrics.winRate.display} gated={metrics.winRate.gated} title="With Wilson 90% interval — win rate alone is meaningless without payoff ratio" />
          <MetricTile label="R-Expectancy" value={metrics.rExpectancy.display} gated={metrics.rExpectancy.gated} title="Mean P&L per unit risked — ≥ 0 means edge exists" />
        </div>
        {metrics.skewCaution && (
          <p className="mt-2 text-[10px] text-amber-400">⚠ Sortino and Sharpe diverge by more than 2× — the return distribution is strongly skewed; treat small-sample Sortino with caution.</p>
        )}
      </div>

      {/* Open positions */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-700 bg-slate-900/50">
          <h3 className="text-sm font-semibold text-white">Open Positions ({portfolio.positions.length})</h3>
        </div>
        {portfolio.positions.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No open positions. Generate long/short ideas, then run a trading cycle.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 border-b border-slate-700 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-2 py-2 text-left">Ticker</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Contract</th>
                  <th className="px-2 py-2 text-right">Entry Mid</th>
                  <th className="px-2 py-2 text-right">Mark (Mid)</th>
                  <th className="px-2 py-2 text-right">P&L</th>
                  <th className="px-2 py-2 text-right" title="Underlying stop level (R10) for longs">Stop</th>
                  <th className="px-2 py-2 text-right">DTE</th>
                  <th className="px-2 py-2 text-right" title="Bid-ask spread as % of mid at entry — real fills would be worse than mid by up to half this">Spread @ Entry</th>
                  <th className="px-2 py-2 text-right">Marked</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((pos) => {
                  const sign = pos.kind === 'CSP' ? -1 : 1;
                  const posPnl = sign * (pos.lastMark - pos.entryMid) * 100 * pos.contracts;
                  const dte = Math.ceil((new Date(pos.expirationDate + 'T16:00:00').getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={pos.id} className="border-b border-slate-700/50">
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLES[pos.kind]}`}>{pos.kind}</span></td>
                      <td className="px-2 py-2 font-semibold text-white">{pos.ticker}</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{pos.contracts}{pos.scaledOut && <span className="text-emerald-400" title="Scaled out half at 2× target; trailing remainder">½</span>}</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">${pos.strike} {pos.kind === 'LP' || pos.kind === 'CSP' ? 'P' : 'C'} {pos.expirationDate}</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{pos.entryMid.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-white">{pos.lastMark.toFixed(2)}</td>
                      <td className={`px-2 py-2 text-right text-xs font-mono ${posPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{posPnl >= 0 ? '+' : ''}{formatCurrency(posPnl)}</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-amber-300/80">{pos.stopLevel > 0 ? formatCurrency(pos.stopLevel) : '—'}</td>
                      <td className={`px-2 py-2 text-right text-xs font-mono ${dte <= 25 ? 'text-amber-400' : 'text-slate-300'}`}>{dte}d</td>
                      <td className="px-2 py-2 text-right text-xs font-mono text-slate-400">{(pos.spreadPctAtEntry * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2 text-right text-[10px] text-slate-500">{pos.lastMarkDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed trades */}
      {portfolio.closedTrades.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 bg-slate-900/50">
            <h3 className="text-sm font-semibold text-white">Closed Trades ({portfolio.closedTrades.length})</h3>
          </div>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800 border-b border-slate-700 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-2 py-2 text-left">Ticker</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Entry → Exit</th>
                  <th className="px-2 py-2 text-right">P&L</th>
                  <th className="px-2 py-2 text-right" title="P&L ÷ risk at entry">R</th>
                  <th className="px-2 py-2 text-left">Exit Rule</th>
                  <th className="px-2 py-2 text-right">Closed</th>
                </tr>
              </thead>
              <tbody>
                {[...portfolio.closedTrades].reverse().map((t) => (
                  <tr key={t.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLES[t.kind]}`}>{t.kind}</span></td>
                    <td className="px-2 py-2 font-semibold text-white">{t.ticker}</td>
                    <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{t.contracts}</td>
                    <td className="px-2 py-2 text-right text-xs font-mono text-slate-300">{t.entryMid.toFixed(2)} → {t.exitMid.toFixed(2)}</td>
                    <td className={`px-2 py-2 text-right text-xs font-mono ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                      {t.pnl >= 0 ? '+' : ''}{formatCurrency(t.pnl)}
                    </td>
                    <td className={`px-2 py-2 text-right text-xs font-mono ${tradeRMultiple(t) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{tradeRMultiple(t).toFixed(2)}</td>
                    <td className="px-2 py-2 text-xs text-slate-400 font-mono">{t.exitRule}</td>
                    <td className="px-2 py-2 text-right text-[10px] text-slate-500">{new Date(t.closedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Journal */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
        <button onClick={() => setShowJournal(!showJournal)} className="w-full px-4 py-2 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2 text-left">
          <ScrollText className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-white">Decision Journal ({portfolio.journal.length})</h3>
          <span className="ml-auto text-[10px] text-slate-500">{showJournal ? 'hide' : 'show'}</span>
        </button>
        {showJournal && (
          <div className="max-h-[280px] overflow-y-auto p-2 space-y-0.5">
            {[...portfolio.journal].reverse().map((j, i) => (
              <div key={i} className="text-[11px] font-mono flex gap-2">
                <span className="text-slate-600 shrink-0">{new Date(j.at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`shrink-0 w-16 ${j.action === 'OPEN' ? 'text-emerald-400' : j.action === 'CLOSE' ? 'text-red-400' : j.action === 'VETO' || j.action === 'SKIP' ? 'text-amber-400' : j.action === 'ERROR' ? 'text-red-500' : 'text-slate-500'}`}>{j.action}</span>
                {j.rule && <span className="shrink-0 text-sky-400">[{j.rule}]</span>}
                {j.ticker && <span className="shrink-0 text-white">{j.ticker}</span>}
                <span className="text-slate-400">{j.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricTile({ label, value, gated, headline, title }: { label: string; value: string; gated: boolean; headline?: boolean; title?: string }) {
  return (
    <div className={`rounded border p-3 ${headline && !gated ? 'border-violet-600/60 bg-violet-900/20' : 'border-slate-700 bg-slate-900/60'}`} title={title}>
      <div className={`text-[10px] uppercase tracking-wider ${headline ? 'text-violet-400 font-semibold' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-1 font-mono ${gated ? 'text-[10px] text-slate-600 italic' : headline ? 'text-xl font-bold text-white' : 'text-sm text-slate-200'}`}>{value}</div>
    </div>
  );
}
