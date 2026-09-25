import { useState, useEffect, useMemo } from 'react';
import { Plus, X, RotateCcw, Bookmark, Save, Pencil, Trash2, Check } from 'lucide-react';
import type { SavedWatchlist } from '../types';
import { DEFAULT_SCAN_FILTER } from '../types';
import {
  getUniverse, getWatchlist, addTicker, removeTicker, setWatchlist, getDefaultUniverse, resetToDefault,
  getExcluded, excludeTicker, includeTicker, clearExcluded, DEFAULT_UNIVERSE_SET, normalizeTickers,
  getSavedWatchlists, getActiveWatchlistId, setActiveWatchlistId, createWatchlist, updateWatchlist, deleteWatchlist,
  mergeSavedDelta,
} from '../services/universe';
import type { UniverseScope } from '../services/universe';

export interface UniverseSelection {
  tickers: string[];      // what a scan will actually cover
  label: string;          // "Default universe" or the watchlist name
  mode: 'default' | 'watchlist';
  savedId: string | null; // active saved watchlist; null for the default list or an unsaved draft
  dirty: boolean;         // unsaved watchlist edits
}

interface Props {
  scope: UniverseScope;
  /** Reports the effective universe whenever it changes. */
  onChange: (sel: UniverseSelection) => void;
  /** Bump to re-read storage after external edits (e.g. Discovery promotion). */
  refreshKey?: number;
  /** Render only the summary state, not the editing UI. */
  collapsed?: boolean;
}

function tickersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

/**
 * Scan-universe editor: the default universe (defaults + custom − excluded)
 * or a named saved watchlist, independent per scope. Mirrors the Short tab's
 * watchlist panel; saved watchlists are explicit-save (edits live in a
 * working buffer until "Save Watchlist").
 */
export default function UniverseEditor({ scope, onChange, refreshKey = 0, collapsed = false }: Props) {
  const resolveInitialActive = (): SavedWatchlist | null => {
    const id = getActiveWatchlistId(scope);
    if (!id) return null;
    return getSavedWatchlists(scope).find((w) => w.id === id) ?? null;
  };

  const [newTicker, setNewTicker] = useState('');
  const [watchlistState, setWatchlistState] = useState<string[]>(() => getWatchlist(scope));
  const [excludedState, setExcludedState] = useState<string[]>(() => getExcluded(scope));
  const [savedWatchlists, setSavedWatchlists] = useState<SavedWatchlist[]>(() => getSavedWatchlists(scope));
  const [mode, setMode] = useState<'default' | 'watchlist'>(() => (resolveInitialActive() ? 'watchlist' : 'default'));
  const [activeId, setActiveId] = useState<string | null>(() => resolveInitialActive()?.id ?? null);
  const [workingName, setWorkingName] = useState<string>(() => resolveInitialActive()?.name ?? '');
  const [workingTickers, setWorkingTickers] = useState<string[]>(() => resolveInitialActive()?.tickers ?? []);
  const [formKind, setFormKind] = useState<null | 'create' | 'rename'>(null);
  const [formName, setFormName] = useState('');
  const [wlError, setWlError] = useState('');

  // External edits (Discovery promotion) write straight to storage — into
  // the active saved watchlist when one is selected, otherwise the default
  // list. Pull both back in, merging the watchlist change into the buffer.
  useEffect(() => {
    if (refreshKey === 0) return;
    setWatchlistState(getWatchlist(scope));
    setExcludedState(getExcluded(scope));
    const nextSaved = getSavedWatchlists(scope);
    if (mode === 'watchlist' && activeId !== null) {
      const prev = savedWatchlists.find((w) => w.id === activeId)?.tickers ?? [];
      const next = nextSaved.find((w) => w.id === activeId)?.tickers ?? prev;
      setWorkingTickers((working) => mergeSavedDelta(working, prev, next));
    }
    setSavedWatchlists(nextSaved);
    // Runs only on external-change signals; mode/activeId/savedWatchlists are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, scope]);

  const defaultTickers = getDefaultUniverse();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const universe = useMemo(() => getUniverse(scope), [scope, watchlistState, excludedState]);
  const effectiveUniverse = useMemo(
    () => (mode === 'watchlist' ? normalizeTickers(workingTickers) : universe),
    [mode, workingTickers, universe],
  );

  const activeSnapshot = useMemo(
    () => savedWatchlists.find((w) => w.id === activeId) ?? null,
    [savedWatchlists, activeId],
  );

  const dirty = mode === 'watchlist' && (
    activeId === null
      ? workingTickers.length > 0 || workingName.trim() !== ''
      : !!activeSnapshot && (
          activeSnapshot.name !== workingName ||
          !tickersEqual(normalizeTickers(activeSnapshot.tickers), normalizeTickers(workingTickers))
        )
  );

  const label = mode === 'watchlist' ? (workingName || 'Untitled watchlist') : 'Default universe';

  useEffect(() => {
    onChange({ tickers: effectiveUniverse, label, mode, savedId: mode === 'watchlist' ? activeId : null, dirty });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUniverse, label, mode, activeId, dirty]);

  // --- Default-universe ticker management ---

  const refreshDefault = () => {
    setWatchlistState(getWatchlist(scope));
    setExcludedState(getExcluded(scope));
  };

  const handleAddDefault = () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    addTicker(t, scope);
    refreshDefault();
    setNewTicker('');
  };

  const handleRemoveFromUniverse = (ticker: string) => {
    if (DEFAULT_UNIVERSE_SET.has(ticker)) excludeTicker(ticker, scope);
    else removeTicker(ticker, scope);
    refreshDefault();
  };

  // --- Saved watchlists (working buffer + explicit save) ---

  const refreshSaved = () => setSavedWatchlists(getSavedWatchlists(scope));

  const confirmDiscardIfDirty = () =>
    !dirty || window.confirm('Discard unsaved changes to the current watchlist?');

  const loadWatchlistById = (id: string) => {
    if (!confirmDiscardIfDirty()) return;
    const wl = getSavedWatchlists(scope).find((w) => w.id === id);
    if (!wl) return;
    setActiveWatchlistId(id, scope);
    setActiveId(id);
    setMode('watchlist');
    setWorkingName(wl.name);
    setWorkingTickers(wl.tickers);
    setFormKind(null);
    setWlError('');
  };

  const switchToDefault = () => {
    if (!confirmDiscardIfDirty()) return;
    setActiveWatchlistId(null, scope);
    setActiveId(null);
    setMode('default');
    setFormKind(null);
    setWlError('');
  };

  const startNewWatchlist = () => {
    if (!confirmDiscardIfDirty()) return;
    setActiveWatchlistId(null, scope);
    setActiveId(null);
    setMode('watchlist');
    setWorkingName('');
    setWorkingTickers([]);
    setFormKind(null);
    setWlError('');
    setNewTicker('');
  };

  const onSelectorChange = (value: string) => {
    if (value === '__default__') switchToDefault();
    else if (value === '__new__') { /* already on the unsaved draft */ }
    else loadWatchlistById(value);
  };

  const openCreateForm = () => {
    setFormKind('create');
    setFormName(activeId === null ? workingName : '');
    setWlError('');
  };

  const openRenameForm = () => {
    setFormKind('rename');
    setFormName(workingName);
    setWlError('');
  };

  const cancelForm = () => {
    setFormKind(null);
    setWlError('');
  };

  const handleSaveClick = () => {
    if (activeId === null) {
      openCreateForm();
      return;
    }
    try {
      const wl = updateWatchlist(activeId, { name: workingName, tickers: workingTickers }, scope);
      setWorkingName(wl.name);
      setWorkingTickers(wl.tickers);
      refreshSaved();
      setWlError('');
    } catch (e) {
      setWlError(e instanceof Error ? e.message : 'Could not save watchlist.');
    }
  };

  const confirmForm = () => {
    try {
      if (formKind === 'create') {
        const wl = createWatchlist(formName, workingTickers, DEFAULT_SCAN_FILTER, scope);
        setActiveWatchlistId(wl.id, scope);
        setActiveId(wl.id);
        setWorkingName(wl.name);
        setWorkingTickers(wl.tickers);
        refreshSaved();
      } else if (formKind === 'rename' && activeId !== null) {
        const wl = updateWatchlist(activeId, { name: formName }, scope);
        setWorkingName(wl.name);
        refreshSaved();
      }
      setFormKind(null);
      setWlError('');
    } catch (e) {
      setWlError(e instanceof Error ? e.message : 'Could not save watchlist.');
    }
  };

  const revertWorking = () => {
    if (!activeSnapshot) return;
    setWorkingName(activeSnapshot.name);
    setWorkingTickers(activeSnapshot.tickers);
    setWlError('');
  };

  const handleDeleteWatchlist = () => {
    if (activeId === null) return;
    const name = activeSnapshot?.name ?? workingName;
    if (!window.confirm(`Delete watchlist "${name}"? This cannot be undone.`)) return;
    deleteWatchlist(activeId, scope);
    refreshSaved();
    setActiveId(null);
    setMode('default');
    setFormKind(null);
    setWlError('');
  };

  const handleAddTicker = () => {
    if (mode === 'watchlist') {
      const t = newTicker.trim().toUpperCase();
      if (!t) return;
      setWorkingTickers((prev) => normalizeTickers([...prev, t]));
      setNewTicker('');
    } else {
      handleAddDefault();
    }
  };

  if (collapsed) return null;

  const inputClass = 'rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const wlBtn = 'flex items-center gap-1 rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition-colors';
  const selectorValue = mode === 'watchlist' ? (activeId ?? '__new__') : '__default__';

  return (
    <div className="space-y-4">
      {/* Watchlists */}
      <div>
        <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
          <Bookmark className="h-3.5 w-3.5 text-amber-400" /> Watchlists
          <span className="text-[10px] font-normal text-slate-500">
            (independent of the {scope === 'long' ? 'Short' : 'Long'} tab)
          </span>
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectorValue}
            onChange={(e) => onSelectorChange(e.target.value)}
            className={`${inputClass} min-w-[200px]`}
            aria-label="Active watchlist"
          >
            <option value="__default__">Default universe ({universe.length})</option>
            {savedWatchlists.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.tickers.length})</option>
            ))}
            {mode === 'watchlist' && activeId === null && (
              <option value="__new__">Untitled watchlist ({workingTickers.length})</option>
            )}
          </select>

          <button onClick={startNewWatchlist} className={wlBtn} title="Start a new watchlist">
            <Plus className="h-3.5 w-3.5" /> New
          </button>

          {mode === 'watchlist' && (
            <>
              <button
                onClick={handleSaveClick}
                disabled={!dirty}
                className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Save this watchlist"
              >
                <Save className="h-3.5 w-3.5" /> Save Watchlist
              </button>
              {activeId !== null && (
                <button onClick={openCreateForm} className={wlBtn} title="Save as a new watchlist">
                  <Plus className="h-3.5 w-3.5" /> Save as new
                </button>
              )}
              {activeId !== null && (
                <button onClick={openRenameForm} className={wlBtn} title="Rename this watchlist">
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </button>
              )}
              {dirty && activeId !== null && (
                <button onClick={revertWorking} className={wlBtn} title="Discard unsaved changes">
                  <RotateCcw className="h-3.5 w-3.5" /> Revert
                </button>
              )}
              {activeId !== null && (
                <button
                  onClick={handleDeleteWatchlist}
                  className="flex items-center gap-1 rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors"
                  title="Delete this watchlist"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </>
          )}
        </div>

        {mode === 'watchlist' && dirty && (
          <p className="mt-2 text-[10px] text-amber-400">
            &bull; Unsaved changes{activeId === null ? ' — click Save Watchlist to name and store this list.' : ''}
          </p>
        )}

        {formKind && (
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              className={`${inputClass} flex-1`}
              placeholder={formKind === 'rename' ? 'New watchlist name' : 'Name this watchlist'}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmForm();
                if (e.key === 'Escape') cancelForm();
              }}
            />
            <button onClick={confirmForm} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 transition-colors" aria-label="Confirm">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={cancelForm} className="rounded bg-slate-800 border border-slate-600 px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {wlError && <p className="mt-2 text-xs text-red-400">{wlError}</p>}
      </div>

      {/* Universe / watchlist tickers */}
      <div>
        <h3 className="text-xs font-semibold text-white mb-2">{mode === 'watchlist' ? 'Watchlist Tickers' : 'Scan Universe'}</h3>

        {mode === 'watchlist' ? (
          <p className="text-[10px] text-slate-500 mb-2">
            <span className="text-emerald-400 font-mono">{effectiveUniverse.length}</span> tickers in {workingName ? `"${workingName}"` : 'this watchlist'} &mdash; only these are scanned.
          </p>
        ) : (
          <p className="text-[10px] text-slate-500 mb-2">
            {defaultTickers.length} defaults + {watchlistState.length} custom &minus; {excludedState.length} excluded &nbsp;=&nbsp; <span className="text-emerald-400 font-mono">{universe.length}</span> being scanned
          </p>
        )}

        <div className="flex gap-2 mb-2">
          <input
            className={`${inputClass} flex-1`}
            placeholder={mode === 'watchlist' ? 'Add ticker to this watchlist' : 'Add ticker to universe'}
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTicker()}
          />
          <button onClick={handleAddTicker} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 transition-colors" aria-label="Add ticker">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {mode === 'watchlist' ? (
          <div className="mb-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Scanning ({effectiveUniverse.length})</div>
            {effectiveUniverse.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 items-center max-h-[160px] overflow-y-auto p-2 rounded bg-slate-900/50 border border-slate-700">
                {effectiveUniverse.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs bg-emerald-900/40 text-emerald-200 border border-emerald-700/50">
                    {t}
                    <button onClick={() => setWorkingTickers((prev) => prev.filter((x) => x !== t))} className="text-slate-500 hover:text-red-400 transition-colors" aria-label={`Remove ${t}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 italic">No tickers yet. Add some above, then click Save Watchlist.</p>
            )}
          </div>
        ) : (
          <>
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
                          isCustom ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-700/50' : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {isCustom && <span className="text-emerald-400">+</span>}
                        {t}
                        <button onClick={() => handleRemoveFromUniverse(t)} className="text-slate-500 hover:text-red-400 transition-colors" aria-label={`Remove ${t}`}>
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
                  <button onClick={() => { clearExcluded(scope); refreshDefault(); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" /> Restore defaults
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center p-2 rounded bg-slate-900/30 border border-slate-800">
                  {excludedState.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded bg-slate-800/50 text-slate-500 border border-slate-700 px-2 py-0.5 text-xs">
                      {t}
                      <button onClick={() => { includeTicker(t, scope); refreshDefault(); }} className="text-slate-500 hover:text-emerald-400 transition-colors" aria-label={`Include ${t}`}>
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setWatchlist([], scope); refreshDefault(); }}
                disabled={watchlistState.length === 0}
                className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-40 disabled:hover:text-slate-500 flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear all custom
              </button>
              <button onClick={() => { resetToDefault(scope); refreshDefault(); }} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
                <RotateCcw className="h-3 w-3" /> Reset everything
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
