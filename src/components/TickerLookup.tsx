import { useState, useCallback } from 'react';
import { Search, Loader2, Plus, Filter, AlertCircle } from 'lucide-react';
import type { APIConfig, OptionPosition, TradierOption, TradierQuote, ChainFilter, StrategyType } from '../types';
import { DEFAULT_CHAIN_FILTER } from '../types';
import { getQuote, getExpirations, getOptionChain } from '../services/tradier';
import { estimateIVRankFromATM, getCachedIVRank, setCachedIVRank } from '../services/ivRank';
import { getNextEarningsDate } from '../services/finnhub';
import { filterChain, chainToPositions } from '../services/adapter';
import { formatCurrency, formatPercent, formatDelta } from '../utils/formatting';

interface Props {
  apiConfig: APIConfig;
  onImport: (positions: OptionPosition[]) => void;
}

export default function TickerLookup({ apiConfig, onImport }: Props) {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<TradierQuote | null>(null);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExp, setSelectedExp] = useState('');
  const [chain, setChain] = useState<TradierOption[]>([]);
  const [filteredChain, setFilteredChain] = useState<TradierOption[]>([]);
  const [filter, setFilter] = useState<ChainFilter>(DEFAULT_CHAIN_FILTER);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [ivRank, setIvRank] = useState(50);
  const [earningsDate, setEarningsDate] = useState('');
  const [marketStatus, setMarketStatus] = useState('');

  const hasToken = apiConfig.tradierToken.length > 0;

  const searchTicker = useCallback(async () => {
    if (!ticker || !hasToken) return;
    setLoading(true);
    setError('');
    setChain([]);
    setFilteredChain([]);
    setSelected(new Set());
    setSelectedExp('');

    try {
      const [q, exps] = await Promise.all([
        getQuote(ticker, apiConfig.tradierToken, apiConfig.tradierSandbox),
        getExpirations(ticker, apiConfig.tradierToken, apiConfig.tradierSandbox),
      ]);

      setQuote(q);
      setExpirations(exps);

      // Detect market status
      if (q.trade_date) {
        const tradeDate = new Date(q.trade_date);
        const now = new Date();
        const sameDay = tradeDate.toDateString() === now.toDateString();
        if (!sameDay) {
          setMarketStatus(`Market closed — data as of ${q.trade_date}`);
        } else {
          setMarketStatus('');
        }
      }

      // Fetch earnings date in background
      if (apiConfig.finnhubToken) {
        getNextEarningsDate(ticker, apiConfig.finnhubToken).then(setEarningsDate);
      }

      // Auto-select first expiration in the DTE range
      const now = new Date();
      const targetExp = exps.find((exp) => {
        const expDate = new Date(exp + 'T16:00:00');
        const dte = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return dte >= filter.minDTE && dte <= filter.maxDTE;
      });
      if (targetExp) {
        setSelectedExp(targetExp);
        await loadChain(targetExp, q);
      } else if (exps.length > 0) {
        setSelectedExp(exps[0]);
        await loadChain(exps[0], q);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [ticker, apiConfig, filter.minDTE, filter.maxDTE, hasToken]);

  const loadChain = async (expiration: string, q: TradierQuote | null) => {
    if (!q) return;
    setLoading(true);
    try {
      const rawChain = await getOptionChain(ticker, expiration, apiConfig.tradierToken, apiConfig.tradierSandbox);
      setChain(rawChain);

      // Compute IV Rank
      let rank = getCachedIVRank(ticker);
      if (rank === null) {
        rank = estimateIVRankFromATM(rawChain, q.last || q.close || 0);
        setCachedIVRank(ticker, rank);
      }
      setIvRank(rank);

      const filtered = filterChain(rawChain, q, filter);
      setFilteredChain(filtered);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chain');
    } finally {
      setLoading(false);
    }
  };

  const handleExpChange = (exp: string) => {
    setSelectedExp(exp);
    loadChain(exp, quote);
  };

  const applyFilter = (newFilter: ChainFilter) => {
    setFilter(newFilter);
    if (quote && chain.length > 0) {
      const filtered = filterChain(chain, quote, newFilter);
      setFilteredChain(filtered);
      setSelected(new Set());
    }
  };

  const toggleRow = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filteredChain.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredChain.map((_, i) => i)));
    }
  };

  const addSelected = () => {
    if (!quote || selected.size === 0) return;
    const selectedOptions = filteredChain.filter((_, i) => selected.has(i));
    const positions = chainToPositions(selectedOptions, quote, filter.strategy, ivRank, earningsDate);
    onImport(positions);
    setSelected(new Set());
  };

  const inputClass = 'rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const labelClass = 'text-[10px] font-medium text-slate-500 uppercase tracking-wider';

  if (!hasToken) {
    return (
      <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-4 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
        <div>
          <p className="text-sm text-amber-300 font-medium">API token required</p>
          <p className="text-xs text-amber-400/70">Enter your Tradier API token in the Data Source settings panel to search for live option data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white flex-1">Live Option Lookup</h2>
        {marketStatus && (
          <span className="text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/50 rounded px-2 py-0.5">
            {marketStatus}
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            className={`${inputClass} w-full pl-9`}
            placeholder="Enter ticker (e.g., AAPL)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && searchTicker()}
          />
        </div>
        <button
          onClick={searchTicker}
          disabled={loading || !ticker}
          className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`rounded px-3 py-1.5 text-sm border transition-colors ${showFilters ? 'bg-slate-700 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'}`}
        >
          <Filter className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Quote summary */}
      {quote && (
        <div className="flex items-center gap-4 text-xs text-slate-400 bg-slate-900/50 rounded px-3 py-2">
          <span className="text-white font-semibold">{quote.symbol}</span>
          <span>{quote.description}</span>
          <span className="text-emerald-400 font-mono">{formatCurrency(quote.last || quote.close)}</span>
          {quote.change != null && (
            <span className={quote.change >= 0 ? 'text-green-400' : 'text-red-400'}>
              {quote.change >= 0 ? '+' : ''}{formatCurrency(quote.change)} ({formatPercent(quote.change_percentage / 100)})
            </span>
          )}
          <span>IV Rank: <span className="text-white font-mono">{ivRank.toFixed(0)}</span></span>
          {earningsDate && <span>Earnings: <span className="text-white">{earningsDate}</span></span>}
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 bg-slate-900/50 rounded p-3">
          <div>
            <label className={labelClass}>Strategy</label>
            <select
              className={`${inputClass} w-full mt-1`}
              value={filter.strategy}
              onChange={(e) => applyFilter({ ...filter, strategy: e.target.value as StrategyType })}
            >
              <option value="CSP">Cash Secured Put</option>
              <option value="CC">Covered Call</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Min Delta</label>
            <input className={`${inputClass} w-full mt-1`} type="number" step="0.05" value={filter.minDelta} onChange={(e) => applyFilter({ ...filter, minDelta: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Max Delta</label>
            <input className={`${inputClass} w-full mt-1`} type="number" step="0.05" value={filter.maxDelta} onChange={(e) => applyFilter({ ...filter, maxDelta: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Min DTE</label>
            <input className={`${inputClass} w-full mt-1`} type="number" value={filter.minDTE} onChange={(e) => applyFilter({ ...filter, minDTE: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Max DTE</label>
            <input className={`${inputClass} w-full mt-1`} type="number" value={filter.maxDTE} onChange={(e) => applyFilter({ ...filter, maxDTE: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Min OTM %</label>
            <input className={`${inputClass} w-full mt-1`} type="number" step="0.5" value={filter.minOTMPct} onChange={(e) => applyFilter({ ...filter, minOTMPct: +e.target.value })} />
          </div>
        </div>
      )}

      {/* Expiration picker */}
      {expirations.length > 0 && (
        <div className="flex items-center gap-2">
          <span className={labelClass}>Expiration:</span>
          <select
            className={`${inputClass} flex-1`}
            value={selectedExp}
            onChange={(e) => handleExpChange(e.target.value)}
          >
            {expirations.map((exp) => {
              const dte = Math.ceil((new Date(exp + 'T16:00:00').getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <option key={exp} value={exp}>
                  {exp} ({dte}d)
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Results table */}
      {filteredChain.length > 0 && (
        <>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 sticky top-0 z-10">
                <tr className="text-slate-400">
                  <th className="px-2 py-1.5 text-left">
                    <input type="checkbox" checked={selected.size === filteredChain.length} onChange={selectAll} className="accent-emerald-500" />
                  </th>
                  <th className="px-2 py-1.5 text-left">Strike</th>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-right">Bid</th>
                  <th className="px-2 py-1.5 text-right">Ask</th>
                  <th className="px-2 py-1.5 text-right">Mid</th>
                  <th className="px-2 py-1.5 text-right">Delta</th>
                  <th className="px-2 py-1.5 text-right">IV</th>
                  <th className="px-2 py-1.5 text-right">Vol</th>
                  <th className="px-2 py-1.5 text-right">OI</th>
                  <th className="px-2 py-1.5 text-right">OTM%</th>
                </tr>
              </thead>
              <tbody>
                {filteredChain.map((opt, i) => {
                  const mid = opt.bid > 0 && opt.ask > 0 ? (opt.bid + opt.ask) / 2 : opt.last || 0;
                  const price = quote?.last || quote?.close || 0;
                  const otm = filter.strategy === 'CSP'
                    ? ((price - opt.strike) / price) * 100
                    : ((opt.strike - price) / price) * 100;
                  return (
                    <tr
                      key={opt.symbol}
                      className={`border-t border-slate-700/50 cursor-pointer transition-colors ${selected.has(i) ? 'bg-emerald-900/20' : 'hover:bg-slate-700/30'}`}
                      onClick={() => toggleRow(i)}
                    >
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} className="accent-emerald-500" />
                      </td>
                      <td className="px-2 py-1.5 text-white font-mono">{formatCurrency(opt.strike)}</td>
                      <td className="px-2 py-1.5">
                        <span className={opt.option_type === 'put' ? 'text-blue-300' : 'text-purple-300'}>
                          {opt.option_type}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{formatCurrency(opt.bid)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{formatCurrency(opt.ask)}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-400 font-mono">{formatCurrency(mid)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{formatDelta(Math.abs(opt.greeks?.delta || 0))}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{((opt.greeks?.mid_iv || 0) * 100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{(opt.volume || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{(opt.open_interest || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{otm.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{filteredChain.length} contracts found, {selected.size} selected</span>
            <button
              onClick={addSelected}
              disabled={selected.size === 0}
              className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-4 w-4" /> Add {selected.size} Position{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </>
      )}

      {chain.length > 0 && filteredChain.length === 0 && !loading && (
        <p className="text-xs text-slate-500 text-center py-4">No contracts match your filters. Try adjusting delta range or DTE.</p>
      )}
    </div>
  );
}
