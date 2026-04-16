import { useState, useCallback } from 'react';
import { Search, Loader2, Plus, Filter } from 'lucide-react';
import type { APIConfig, OptionPosition, ChainFilter, StrategyType } from '../types';
import { DEFAULT_CHAIN_FILTER } from '../types';
import { getQuote, getOptionChain } from '../services/marketdata';
import type { MDQuote, MDOption } from '../services/marketdata';
import { estimateIVRankFromChain, getCachedIVData, setCachedIVRank } from '../services/ivRank';
import { filterMDChain, mdChainToPositions } from '../services/adapter';
import { formatCurrency, formatPercent, formatDelta, formatIVRank, deltaColor } from '../utils/formatting';

interface Props {
  apiConfig: APIConfig;
  onImport: (positions: OptionPosition[]) => void;
}

export default function TickerLookup({ apiConfig, onImport }: Props) {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<MDQuote | null>(null);
  const [chain, setChain] = useState<MDOption[]>([]);
  const [filteredChain, setFilteredChain] = useState<MDOption[]>([]);
  const [filter, setFilter] = useState<ChainFilter>(DEFAULT_CHAIN_FILTER);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [ivRank, setIvRank] = useState(50);
  const [atmIV, setAtmIV] = useState<number | undefined>(undefined);
  const [medianIV, setMedianIV] = useState<number | undefined>(undefined);
  const [chainExpiration, setChainExpiration] = useState('');

  const token = apiConfig.marketDataToken || undefined;

  const searchTicker = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError('');
    setChain([]);
    setFilteredChain([]);
    setSelected(new Set());

    try {
      const q = await getQuote(ticker, token);
      setQuote(q);
      await loadChain(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [ticker, token]);

  const loadChain = async (q: MDQuote) => {
    setLoading(true);
    try {
      const side = filter.strategy === 'CSP' ? 'put' as const : 'call' as const;
      const targetDTE = Math.round((filter.minDTE + filter.maxDTE) / 2);
      const rawChain = await getOptionChain(ticker, token, { dte: targetDTE, side });
      setChain(rawChain);

      // Determine the actual expiration from the chain data
      if (rawChain.length > 0) {
        const expEpoch = rawChain[0].expiration;
        setChainExpiration(new Date(expEpoch * 1000).toISOString().split('T')[0]);
      }

      const price = q.last || q.mid || 0;
      const cached = getCachedIVData(ticker);
      let rank: number;
      let atmIV: number | undefined;
      let medianIV: number | undefined;
      if (cached) {
        rank = cached.ivRank;
        atmIV = cached.atmIV;
        medianIV = cached.medianIV;
      } else {
        const ivData = estimateIVRankFromChain(rawChain, price);
        rank = ivData.ivRank;
        atmIV = ivData.atmIV;
        medianIV = ivData.medianIV;
        setCachedIVRank(ticker, rank, atmIV, medianIV);
      }
      setIvRank(rank);
      setAtmIV(atmIV);
      setMedianIV(medianIV);

      const filtered = filterMDChain(rawChain, q, filter);
      setFilteredChain(filtered);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chain');
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = (newFilter: ChainFilter) => {
    setFilter(newFilter);
    if (quote && chain.length > 0) {
      const filtered = filterMDChain(chain, quote, newFilter);
      setFilteredChain(filtered);
      setSelected(new Set());
    }
  };

  const reloadWithFilter = (newFilter: ChainFilter) => {
    setFilter(newFilter);
    if (quote) loadChain(quote);
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
    if (selected.size === filteredChain.length) setSelected(new Set());
    else setSelected(new Set(filteredChain.map((_, i) => i)));
  };

  const addSelected = () => {
    if (!quote || selected.size === 0) return;
    const selectedOptions = filteredChain.filter((_, i) => selected.has(i));
    const positions = mdChainToPositions(selectedOptions, quote, filter.strategy, ivRank, '', atmIV, medianIV);
    onImport(positions);
    setSelected(new Set());
  };

  const inputClass = 'rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const labelClass = 'text-[10px] font-medium text-slate-500 uppercase tracking-wider';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white flex-1">Live Option Lookup</h2>
        {!token && (
          <span className="text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/50 rounded px-2 py-0.5">
            Demo mode (AAPL only) — add free Market Data token for all tickers
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            className={`${inputClass} w-full pl-9`}
            placeholder={token ? 'Enter ticker (e.g., AAPL, NVDA)' : 'Enter AAPL (demo) or add token for all tickers'}
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

      {quote && (
        <div className="flex items-center gap-4 text-xs text-slate-400 bg-slate-900/50 rounded px-3 py-2">
          <span className="text-white font-semibold">{quote.symbol}</span>
          <span className="text-emerald-400 font-mono">{formatCurrency(quote.last)}</span>
          {quote.change != null && (
            <span className={quote.change >= 0 ? 'text-green-400' : 'text-red-400'}>
              {quote.change >= 0 ? '+' : ''}{formatCurrency(quote.change)} ({formatPercent(quote.changepct)})
            </span>
          )}
          <span>IV Rank: <span className="text-white font-mono">{formatIVRank(ivRank)}</span></span>
          {chainExpiration && <span>Exp: <span className="text-white">{chainExpiration}</span></span>}
        </div>
      )}

      {showFilters && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3 bg-slate-900/50 rounded p-3">
          <div>
            <label className={labelClass}>Strategy</label>
            <select className={`${inputClass} w-full mt-1`} value={filter.strategy} onChange={(e) => { const f = { ...filter, strategy: e.target.value as StrategyType }; setFilter(f); if (quote) loadChain(quote); }}>
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
            <input className={`${inputClass} w-full mt-1`} type="number" value={filter.minDTE} onChange={(e) => reloadWithFilter({ ...filter, minDTE: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Max DTE</label>
            <input className={`${inputClass} w-full mt-1`} type="number" value={filter.maxDTE} onChange={(e) => reloadWithFilter({ ...filter, maxDTE: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Min OTM %</label>
            <input className={`${inputClass} w-full mt-1`} type="number" step="0.5" value={filter.minOTMPct} onChange={(e) => applyFilter({ ...filter, minOTMPct: +e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Max OTM %</label>
            <input className={`${inputClass} w-full mt-1`} type="number" step="0.5" value={filter.maxOTMPct} onChange={(e) => applyFilter({ ...filter, maxOTMPct: +e.target.value })} />
          </div>
        </div>
      )}

      {filteredChain.length > 0 && (
        <>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto rounded border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 sticky top-0 z-10">
                <tr className="text-slate-400">
                  <th className="px-2 py-1.5 text-left"><input type="checkbox" checked={selected.size === filteredChain.length} onChange={selectAll} className="accent-emerald-500" /></th>
                  <th className="px-2 py-1.5 text-left">Strike</th>
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
                  const price = quote?.last || 0;
                  const otm = filter.strategy === 'CSP'
                    ? ((price - opt.strike) / price) * 100
                    : ((opt.strike - price) / price) * 100;
                  return (
                    <tr key={opt.optionSymbol || i} className={`border-t border-slate-700/50 cursor-pointer transition-colors ${selected.has(i) ? 'bg-emerald-900/20' : 'hover:bg-slate-700/30'}`} onClick={() => toggleRow(i)}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} className="accent-emerald-500" /></td>
                      <td className="px-2 py-1.5 text-white font-mono">{formatCurrency(opt.strike)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{formatCurrency(opt.bid)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{formatCurrency(opt.ask)}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-400 font-mono">{formatCurrency(opt.mid)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${deltaColor(opt.delta)}`}>{formatDelta(Math.abs(opt.delta))}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300 font-mono">{(opt.iv * 100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{(opt.volume || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{(opt.openInterest || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right text-slate-400">{otm.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{filteredChain.length} contracts, {selected.size} selected</span>
            <button onClick={addSelected} disabled={selected.size === 0} className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
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
