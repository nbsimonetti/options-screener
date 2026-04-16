import { useState, useCallback, useEffect, useMemo } from 'react';
import { Sparkles, Loader2, Settings, Plus, X, RotateCcw, Info, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { APIConfig, ScoringWeights, InvestmentIdea, ScanProgress, OptionPosition, ScanFilter } from '../types';
import { DEFAULT_SCAN_FILTER, LS_SCAN_FILTER, LS_TABLE_SETS } from '../types';
import { getUniverse, getWatchlist, addTicker, removeTicker, setWatchlist, getDefaultUniverse, resetToDefault, getExcluded, excludeTicker, includeTicker, clearExcluded, DEFAULT_UNIVERSE_SET } from '../services/universe';
import { scanForIdeas } from '../services/scanner';
import type { ScanCandidate } from '../services/scanner';
import { generateTheses } from '../services/claude';
import { getRequestCount } from '../services/marketdata';
import { calcAnnualizedYield } from '../scoring/engine';
import IdeaCard from './IdeaCard';

type SortKey = 'score' | 'ticker' | 'type' | 'strike' | 'price' | 'yield' | 'delta' | 'psafe' | 'dte' | 'expiry' | 'ivr' | 'confidence';

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function compareIdeas(a: InvestmentIdea, b: InvestmentIdea, key: SortKey): number {
  switch (key) {
    case 'score':      return a.score.compositeScore - b.score.compositeScore;
    case 'ticker':     return a.position.ticker.localeCompare(b.position.ticker);
    case 'type':       return a.position.strategy.localeCompare(b.position.strategy);
    case 'strike':     return a.position.strikePrice - b.position.strikePrice;
    case 'price':      return a.position.currentPrice - b.position.currentPrice;
    case 'yield':      return calcAnnualizedYield(a.position) - calcAnnualizedYield(b.position);
    case 'delta':      return Math.abs(a.position.delta) - Math.abs(b.position.delta);
    case 'psafe':      return (1 - Math.abs(a.position.delta)) - (1 - Math.abs(b.position.delta));
    case 'dte':        return a.position.dte - b.position.dte;
    case 'expiry':     return a.position.dte - b.position.dte;
    case 'ivr':        return a.position.ivRank - b.position.ivRank;
    case 'confidence': return (CONFIDENCE_RANK[a.thesis.confidence] || 0) - (CONFIDENCE_RANK[b.thesis.confidence] || 0);
    default: return 0;
  }
}

interface Props {
  apiConfig: APIConfig;
  weights: ScoringWeights;
  ideas: InvestmentIdea[];
  onIdeasChange: (ideas: InvestmentIdea[]) => void;
  onAddToScreener: (positions: OptionPosition[]) => void;
}

interface TableSets {
  topIds: string[];
  cspIds: string[];
  ccIds: string[];
}

const EMPTY_TABLE_SETS: TableSets = { topIds: [], cspIds: [], ccIds: [] };

function loadScanFilter(): ScanFilter {
  try {
    const stored = localStorage.getItem(LS_SCAN_FILTER);
    return stored ? { ...DEFAULT_SCAN_FILTER, ...JSON.parse(stored) } : DEFAULT_SCAN_FILTER;
  } catch {
    return DEFAULT_SCAN_FILTER;
  }
}

function loadTableSets(): TableSets {
  try {
    const stored = localStorage.getItem(LS_TABLE_SETS);
    return stored ? { ...EMPTY_TABLE_SETS, ...JSON.parse(stored) } : EMPTY_TABLE_SETS;
  } catch {
    return EMPTY_TABLE_SETS;
  }
}

export default function IdeaGenerator({ apiConfig, weights, ideas, onIdeasChange, onAddToScreener }: Props) {
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle', current: 0, total: 0, currentTicker: '', message: '', requestsUsed: 0, requestBudget: 2000 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [error, setError] = useState('');
  const [watchlistState, setWatchlistState] = useState<string[]>(() => getWatchlist());
  const [excludedState, setExcludedState] = useState<string[]>(() => getExcluded());
  const [tableSets, setTableSets] = useState<TableSets>(() => loadTableSets());
  const [scanFilter, setScanFilter] = useState<ScanFilter>(() => loadScanFilter());

  useEffect(() => {
    localStorage.setItem(LS_SCAN_FILTER, JSON.stringify(scanFilter));
  }, [scanFilter]);

  useEffect(() => {
    localStorage.setItem(LS_TABLE_SETS, JSON.stringify(tableSets));
  }, [tableSets]);

  const hasClaude = ((apiConfig.claudeApiKey) || '').length > 0;

  const defaultTickers = getDefaultUniverse();
  const universe = getUniverse();

  const ideaById = useMemo(() => new Map(ideas.map((i) => [i.position.id, i])), [ideas]);

  const topIdeas = useMemo(() => {
    if (tableSets.topIds.length === 0) return ideas; // backward-compat fallback
    return tableSets.topIds
      .map((id) => ideaById.get(id))
      .filter((i): i is InvestmentIdea => !!i);
  }, [ideaById, ideas, tableSets.topIds]);

  const cspIdeas = useMemo(
    () => tableSets.cspIds.map((id) => ideaById.get(id)).filter((i): i is InvestmentIdea => !!i),
    [ideaById, tableSets.cspIds],
  );

  const ccIdeas = useMemo(
    () => tableSets.ccIds.map((id) => ideaById.get(id)).filter((i): i is InvestmentIdea => !!i),
    [ideaById, tableSets.ccIds],
  );

  const runScan = useCallback(async () => {
    setError('');
    setExpandedId(null);

    try {
      setProgress({ phase: 'fetching', current: 0, total: universe.length, currentTicker: '', message: 'Starting scan...', requestsUsed: 0, requestBudget: 2000 });
      const scanResult = await scanForIdeas(universe, weights, setProgress, apiConfig.marketDataToken || undefined, scanFilter);
      const usedNow = getRequestCount();

      // De-duplicate by position id across all three sets so Claude sees each candidate once
      const seen = new Set<string>();
      const allCandidates: ScanCandidate[] = [];
      for (const c of [...scanResult.top, ...scanResult.bestCSPByTicker, ...scanResult.bestCCByTicker]) {
        if (!seen.has(c.position.id)) {
          seen.add(c.position.id);
          allCandidates.push(c);
        }
      }

      if (allCandidates.length === 0) {
        setProgress({ phase: 'error', current: 0, total: 0, currentTicker: '', message: 'No viable candidates found.', requestsUsed: usedNow, requestBudget: 2000 });
        return;
      }

      const analysisType = hasClaude ? 'Claude' : 'algorithmic analysis';
      setProgress({ phase: 'analyzing', current: allCandidates.length, total: allCandidates.length, currentTicker: '', message: `Generating theses via ${analysisType}...`, requestsUsed: usedNow, requestBudget: 2000 });

      const newIdeas = await generateTheses(
        allCandidates,
        hasClaude ? apiConfig.claudeApiKey : undefined,
      );

      // Build the three id sets. InvestmentIdea.position.id matches ScanCandidate.position.id.
      const newTableSets: TableSets = {
        topIds: scanResult.top.map((c) => c.position.id),
        cspIds: scanResult.bestCSPByTicker.map((c) => c.position.id),
        ccIds: scanResult.bestCCByTicker.map((c) => c.position.id),
      };

      onIdeasChange(newIdeas);
      setTableSets(newTableSets);
      setProgress({ phase: 'complete', current: newIdeas.length, total: newIdeas.length, currentTicker: '', message: `${newIdeas.length} ideas generated · ${usedNow} API calls used`, requestsUsed: usedNow, requestBudget: 2000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
      setProgress({ phase: 'error', current: 0, total: 0, currentTicker: '', message: msg, requestsUsed: getRequestCount(), requestBudget: 2000 });
    }
  }, [universe, apiConfig, weights, hasClaude, onIdeasChange, scanFilter]);

  const handleAddToScreener = (idea: InvestmentIdea) => {
    onAddToScreener([idea.position]);
  };

  const handleDismiss = (id: string) => {
    onIdeasChange(ideas.filter((i) => i.id !== id));
  };

  const handleToggle = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleAddWatchlistTicker = () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    addTicker(t);
    setWatchlistState(getWatchlist());
    setExcludedState(getExcluded());
    setNewTicker('');
  };

  const handleRemoveFromUniverse = (ticker: string) => {
    if (DEFAULT_UNIVERSE_SET.has(ticker)) {
      excludeTicker(ticker);
      setExcludedState(getExcluded());
    } else {
      removeTicker(ticker);
      setWatchlistState(getWatchlist());
    }
  };

  const handleIncludeDefault = (ticker: string) => {
    includeTicker(ticker);
    setExcludedState(getExcluded());
  };

  const handleRestoreDefaults = () => {
    clearExcluded();
    setExcludedState([]);
  };

  const handleClearCustom = () => {
    setWatchlist([]);
    setWatchlistState([]);
  };

  const handleResetAll = () => {
    resetToDefault();
    setWatchlistState([]);
    setExcludedState([]);
  };

  const isScanning = progress.phase === 'fetching' || progress.phase === 'scoring' || progress.phase === 'analyzing';
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const inputClass = 'rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const labelClass = 'text-[10px] font-medium text-slate-500 uppercase tracking-wider';

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" /> AI Idea Generator
          </h2>

          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 rounded bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isScanning ? 'Scanning...' : 'Generate Ideas'}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded px-3 py-2 text-sm border transition-colors ${showSettings ? 'bg-slate-700 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'}`}
          >
            <Settings className="h-4 w-4" />
          </button>

          <span className="ml-auto text-xs text-slate-500">
            {universe.length} tickers &middot; {hasClaude ? 'AI theses' : 'Algorithmic analysis'}
          </span>
        </div>

        {!hasClaude && (
          <div className="mt-3 flex items-center gap-3 rounded border border-blue-700/50 bg-blue-900/20 p-3">
            <Info className="h-4 w-4 text-blue-400 shrink-0" />
            <p className="text-xs text-blue-300">
              Using algorithmic analysis with full score traceability. Add a Claude API key in AI Settings for AI-powered theses.
            </p>
          </div>
        )}

        {isScanning && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{progress.message}</span>
              <span>
                {progress.current}/{progress.total} tickers &middot;{' '}
                <span className={progress.requestsUsed >= 0.8 * progress.requestBudget ? 'text-amber-400 font-mono' : 'font-mono'}>
                  {progress.requestsUsed}/{progress.requestBudget}
                </span>{' '}
                API calls
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${progress.phase === 'analyzing' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}
                style={{ width: `${progress.phase === 'analyzing' ? 100 : progressPct}%` }}
              />
            </div>
          </div>
        )}

        {!isScanning && progress.phase === 'complete' && progress.requestsUsed > 0 && (
          <div className="mt-3 text-xs text-slate-500">
            Last scan: <span className="font-mono text-slate-400">{progress.requestsUsed}</span> API calls used.
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-4">
          {/* Scan filters */}
          <div>
            <h3 className="text-xs font-semibold text-white mb-2">Scan Filters</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className={labelClass}>Min Ann. Yield %</label>
                <input
                  className={`${inputClass} w-full mt-1`}
                  type="number"
                  step="1"
                  value={+(scanFilter.minAnnualYield * 100).toFixed(1)}
                  onChange={(e) => setScanFilter({ ...scanFilter, minAnnualYield: +e.target.value / 100 })}
                />
              </div>
              <div>
                <label className={labelClass}>Min DTE</label>
                <input
                  className={`${inputClass} w-full mt-1`}
                  type="number"
                  value={scanFilter.minDTE}
                  onChange={(e) => setScanFilter({ ...scanFilter, minDTE: +e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Max DTE</label>
                <input
                  className={`${inputClass} w-full mt-1`}
                  type="number"
                  value={scanFilter.maxDTE}
                  onChange={(e) => setScanFilter({ ...scanFilter, maxDTE: +e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Min OTM %</label>
                <input
                  className={`${inputClass} w-full mt-1`}
                  type="number"
                  step="0.5"
                  value={scanFilter.minOTMPct}
                  onChange={(e) => setScanFilter({ ...scanFilter, minOTMPct: +e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Max OTM %</label>
                <input
                  className={`${inputClass} w-full mt-1`}
                  type="number"
                  step="0.5"
                  value={scanFilter.maxOTMPct}
                  onChange={(e) => setScanFilter({ ...scanFilter, maxOTMPct: +e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Universe management */}
          <div>
            <h3 className="text-xs font-semibold text-white mb-2">Scan Universe</h3>
            <p className="text-[10px] text-slate-500 mb-2">
              {defaultTickers.length} defaults + {watchlistState.length} custom &minus; {excludedState.length} excluded &nbsp;=&nbsp; <span className="text-emerald-400 font-mono">{universe.length}</span> being scanned
            </p>

            <div className="flex gap-2 mb-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="Add ticker to watchlist"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddWatchlistTicker()}
              />
              <button onClick={handleAddWatchlistTicker} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 transition-colors">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-2">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Scanning ({universe.length})</div>
              {universe.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 items-center max-h-[160px] overflow-y-auto p-2 rounded bg-slate-900/50 border border-slate-700">
                  {universe.map((t) => {
                    const isCustom = !DEFAULT_UNIVERSE_SET.has(t);
                    return (
                      <span
                        key={t}
                        className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                          isCustom
                            ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-700/50'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {isCustom && <span className="text-emerald-400">+</span>}
                        {t}
                        <button
                          onClick={() => handleRemoveFromUniverse(t)}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                          aria-label={`Remove ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-slate-600 italic">No active tickers. Add some or restore defaults below.</p>
              )}
            </div>

            {excludedState.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Excluded ({excludedState.length})</div>
                  <button
                    onClick={handleRestoreDefaults}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore defaults
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center p-2 rounded bg-slate-900/30 border border-slate-800">
                  {excludedState.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 rounded bg-slate-800/50 text-slate-500 border border-slate-700 px-2 py-0.5 text-xs"
                    >
                      {t}
                      <button
                        onClick={() => handleIncludeDefault(t)}
                        className="text-slate-500 hover:text-emerald-400 transition-colors"
                        aria-label={`Include ${t}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleClearCustom}
                disabled={watchlistState.length === 0}
                className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-40 disabled:hover:text-slate-500 flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear all custom
              </button>
              <button
                onClick={handleResetAll}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
              >
                <RotateCcw className="h-3 w-3" /> Reset everything
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results tables */}
      {ideas.length > 0 && (
        <>
          <IdeaTable
            ideas={topIdeas}
            expandedId={expandedId}
            onToggle={handleToggle}
            onAddToScreener={handleAddToScreener}
            onDismiss={handleDismiss}
          />

          <IdeaTable
            title={`Top Cash-Secured Put Per Ticker (${cspIdeas.length})`}
            ideas={cspIdeas}
            expandedId={expandedId}
            onToggle={handleToggle}
            onAddToScreener={handleAddToScreener}
            onDismiss={handleDismiss}
          />

          <IdeaTable
            title={`Top Covered Call Per Ticker (${ccIdeas.length})`}
            ideas={ccIdeas}
            expandedId={expandedId}
            onToggle={handleToggle}
            onAddToScreener={handleAddToScreener}
            onDismiss={handleDismiss}
          />

          <div className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/50 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {ideas.length} total ideas &middot; {cspIdeas.length} CSPs &middot; {ccIdeas.length} CCs
            </span>
            {ideas[0]?.generatedAt && (
              <span className="text-[10px] text-slate-600">
                Generated {new Date(ideas[0].generatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </>
      )}

      {ideas.length === 0 && progress.phase === 'idle' && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <Sparkles className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Click "Generate Ideas" to scan {universe.length} tickers and find the best CSP and CC opportunities.</p>
          <p className="text-xs text-slate-600 mt-1">Uses free MarketData.app data — no API key required for AAPL demo.</p>
        </div>
      )}
    </div>
  );
}

// --- IdeaTable subcomponent ---

interface IdeaTableProps {
  title?: string;
  ideas: InvestmentIdea[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onAddToScreener: (idea: InvestmentIdea) => void;
  onDismiss: (id: string) => void;
}

function IdeaTable({ title, ideas, expandedId, onToggle, onAddToScreener, onDismiss }: IdeaTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);

  const sortedIdeas = useMemo(() => {
    const copy = [...ideas];
    copy.sort((a, b) => {
      const cmp = compareIdeas(a, b, sortKey);
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [ideas, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (ideas.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
      {title && (
        <div className="px-4 py-2 border-b border-slate-700 bg-slate-900/50">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
      )}
      <div className="max-h-[600px] overflow-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-10" />
            <col className="w-8" />
            <col className="w-16" />
            <col className="w-20" />
            <col className="w-14" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-20" />
            <col className="w-16" />
            <col className="w-16" />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-12" />
            <col className="w-24" />
            <col className="w-14" />
            <col className="w-16" />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-2 py-2 text-right">#</th>
              <th></th>
              <SortableTh sortKey="score" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="center">Score</SortableTh>
              <SortableTh sortKey="ticker" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="left">Ticker</SortableTh>
              <SortableTh sortKey="type" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="center">Type</SortableTh>
              <SortableTh sortKey="strike" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">Strike</SortableTh>
              <SortableTh sortKey="price" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">Price</SortableTh>
              <th className="px-2 py-2 text-right" title="1-SD expected move through expiration">Exp. Move</th>
              <th className="px-2 py-2 text-right" title="Capital at risk in $ (strike × 100 for CSPs, stock price × 100 for CCs)">Capital</th>
              <SortableTh sortKey="yield" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">Yield</SortableTh>
              <SortableTh sortKey="delta" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right" title="Absolute delta — lower = safer">Delta</SortableTh>
              <SortableTh sortKey="psafe" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right" title="1 − |delta|, a Black-Scholes approximation of probability OTM at expiration, not true probability">P(Safe)</SortableTh>
              <th className="px-2 py-2 text-right" title="Theta in $/day — expected P&L per day if nothing moves">Θ/day</th>
              <th className="px-2 py-2 text-right" title="Vega × 100 — dollar P&L per 1-point change in implied volatility">Vega</th>
              <SortableTh sortKey="dte" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">DTE</SortableTh>
              <SortableTh sortKey="expiry" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">Expiry</SortableTh>
              <SortableTh sortKey="ivr" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="right">IVR</SortableTh>
              <SortableTh sortKey="confidence" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} align="center">Conf.</SortableTh>
              <th className="px-2 py-2 text-left">Summary</th>
            </tr>
          </thead>
          <tbody>
            {sortedIdeas.map((idea, i) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                rank={i + 1}
                expanded={expandedId === idea.id}
                onToggle={() => onToggle(idea.id)}
                onAddToScreener={() => onAddToScreener(idea)}
                onDismiss={() => onDismiss(idea.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SortableThProps {
  sortKey: SortKey;
  currentKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  align: 'left' | 'center' | 'right';
  title?: string;
  children: React.ReactNode;
}

function SortableTh({ sortKey, currentKey, asc, onSort, align, title, children }: SortableThProps) {
  const isActive = sortKey === currentKey;
  const Icon = !isActive ? ArrowUpDown : asc ? ArrowUp : ArrowDown;
  const alignClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const thAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <th
      className={`px-2 py-2 ${thAlign} cursor-pointer select-none hover:text-white transition-colors ${isActive ? 'text-emerald-400' : ''}`}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      <span className={`inline-flex items-center gap-1 ${alignClass}`}>
        {children}
        <Icon className="h-3 w-3" />
      </span>
    </th>
  );
}
