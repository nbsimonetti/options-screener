import { useState, useCallback } from 'react';
import { Sparkles, Loader2, Settings, Plus, X, RotateCcw, AlertCircle } from 'lucide-react';
import type { APIConfig, ScoringWeights, InvestmentIdea, ScanProgress, OptionPosition } from '../types';
import { getUniverse, getWatchlist, addTicker, removeTicker, getDefaultUniverse } from '../services/universe';
import { scanForIdeas } from '../services/scanner';
import { generateTheses } from '../services/claude';
import IdeaCard from './IdeaCard';

interface Props {
  apiConfig: APIConfig;
  weights: ScoringWeights;
  ideas: InvestmentIdea[];
  onIdeasChange: (ideas: InvestmentIdea[]) => void;
  onAddToScreener: (positions: OptionPosition[]) => void;
}

export default function IdeaGenerator({ apiConfig, weights, ideas, onIdeasChange, onAddToScreener }: Props) {
  const [progress, setProgress] = useState<ScanProgress>({ phase: 'idle', current: 0, total: 0, currentTicker: '', message: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [error, setError] = useState('');

  const hasTradier = (apiConfig.tradierToken || '').length > 0;
  const hasClaude = (apiConfig.claudeApiKey || '').length > 0;
  const canScan = hasTradier && hasClaude;

  const watchlist = getWatchlist();
  const defaultTickers = getDefaultUniverse();
  const universe = getUniverse();

  const runScan = useCallback(async () => {
    if (!canScan) return;
    setError('');
    setExpandedId(null);

    try {
      // Phase 1: Scan tickers
      setProgress({ phase: 'fetching', current: 0, total: universe.length, currentTicker: '', message: 'Starting scan...' });
      const candidates = await scanForIdeas(universe, apiConfig, weights, setProgress);

      if (candidates.length === 0) {
        setProgress({ phase: 'error', current: 0, total: 0, currentTicker: '', message: 'No viable candidates found.' });
        return;
      }

      // Phase 2: Generate theses with Claude
      setProgress({ phase: 'analyzing', current: candidates.length, total: candidates.length, currentTicker: '', message: `Analyzing ${candidates.length} candidates with Claude...` });
      const newIdeas = await generateTheses(candidates, apiConfig.claudeApiKey);

      onIdeasChange(newIdeas);
      setProgress({ phase: 'complete', current: newIdeas.length, total: newIdeas.length, currentTicker: '', message: `${newIdeas.length} ideas generated` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
      setProgress({ phase: 'error', current: 0, total: 0, currentTicker: '', message: msg });
    }
  }, [canScan, universe, apiConfig, weights, onIdeasChange]);

  const handleAddToScreener = (idea: InvestmentIdea) => {
    onAddToScreener([idea.position]);
  };

  const handleDismiss = (id: string) => {
    onIdeasChange(ideas.filter((i) => i.id !== id));
  };

  const handleAddWatchlistTicker = () => {
    if (newTicker.trim()) {
      addTicker(newTicker);
      setNewTicker('');
    }
  };

  const isScanning = progress.phase === 'fetching' || progress.phase === 'scoring' || progress.phase === 'analyzing';
  const progressPct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const inputClass = 'rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

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
            disabled={!canScan || isScanning}
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
            {universe.length} tickers in universe
          </span>
        </div>

        {/* Missing API keys warning */}
        {!canScan && (
          <div className="mt-3 flex items-center gap-3 rounded border border-amber-700/50 bg-amber-900/20 p-3">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-300">
              {!hasTradier && 'Tradier API token required. '}
              {!hasClaude && 'Claude API key required. '}
              Configure in the Data Source panel in the sidebar.
            </p>
          </div>
        )}

        {/* Progress bar */}
        {isScanning && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{progress.message}</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${progress.phase === 'analyzing' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}
                style={{ width: `${progress.phase === 'analyzing' ? 100 : progressPct}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
          <h3 className="text-xs font-semibold text-white">Scan Universe</h3>
          <p className="text-[10px] text-slate-500">
            Default: {defaultTickers.length} tickers (S&P 500 components + liquid ETFs). Custom watchlist tickers are added to the scan.
          </p>

          {/* Custom watchlist */}
          <div>
            <div className="flex gap-2 mb-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="Add ticker to watchlist"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddWatchlistTicker()}
              />
              <button
                onClick={handleAddWatchlistTicker}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {watchlist.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {watchlist.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                    {t}
                    <button onClick={() => { removeTicker(t); }} className="text-slate-500 hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => { removeTicker('__force_rerender__'); /* force re-render */ }}
                  className="text-[10px] text-slate-500 hover:text-slate-400 flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results table */}
      {ideas.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            <span className="w-6 text-right">#</span>
            <span className="w-4" />
            <span className="w-14">Score</span>
            <span className="w-16">Ticker</span>
            <span className="w-12">Type</span>
            <span className="w-16">Strike</span>
            <span className="w-16">Yield</span>
            <span className="w-12">Delta</span>
            <span className="w-8">DTE</span>
            <span className="w-8">IVR</span>
            <span className="w-16 ml-auto">Conf.</span>
            <span className="flex-1">Summary</span>
          </div>

          {ideas.map((idea, i) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              rank={i + 1}
              expanded={expandedId === idea.id}
              onToggle={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
              onAddToScreener={() => handleAddToScreener(idea)}
              onDismiss={() => handleDismiss(idea.id)}
            />
          ))}

          <div className="px-4 py-2 border-t border-slate-700 bg-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{ideas.length} ideas</span>
            {ideas.length > 0 && (
              <span className="text-[10px] text-slate-600">
                Generated {new Date(ideas[0].generatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}

      {ideas.length === 0 && progress.phase === 'idle' && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-12 text-center">
          <Sparkles className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Click "Generate Ideas" to scan {universe.length} tickers and find the best CSP and CC opportunities.</p>
          <p className="text-xs text-slate-600 mt-1">The AI analyst will write an investment thesis for each top candidate.</p>
        </div>
      )}
    </div>
  );
}
