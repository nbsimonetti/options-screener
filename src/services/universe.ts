import { LS_WATCHLIST, LS_EXCLUDED, LS_SAVED_WATCHLISTS, LS_ACTIVE_WATCHLIST } from '../types';
import type { ScanFilter, SavedWatchlist } from '../types';

// Each Idea Generator owns an independent scan universe: the short (income)
// screener wants names with EXPENSIVE options, the long screener wants names
// with CHEAP options, so their ticker lists diverge. 'short' keeps the
// original storage keys (existing data untouched); 'long' has its own keys,
// seeded once from the short lists so the split starts from what the user
// already curated.
export type UniverseScope = 'short' | 'long';

const KEYS: Record<UniverseScope, { watchlist: string; excluded: string; saved: string; active: string }> = {
  short: { watchlist: LS_WATCHLIST, excluded: LS_EXCLUDED, saved: LS_SAVED_WATCHLISTS, active: LS_ACTIVE_WATCHLIST },
  long: {
    watchlist: 'options-screener-long-watchlist',
    excluded: 'options-screener-long-excluded',
    saved: 'options-screener-long-saved-watchlists',
    active: 'options-screener-long-active-watchlist',
  },
};
const LONG_SEEDED_KEY = 'options-screener-long-universe-seeded';

function keysFor(scope: UniverseScope) {
  if (scope === 'long') seedLongUniverse();
  return KEYS[scope];
}

/** One-time copy of the short universe into the long scope. */
function seedLongUniverse() {
  try {
    if (localStorage.getItem(LONG_SEEDED_KEY)) return;
    for (const k of ['watchlist', 'excluded'] as const) {
      const v = localStorage.getItem(KEYS.short[k]);
      if (v !== null && localStorage.getItem(KEYS.long[k]) === null) localStorage.setItem(KEYS.long[k], v);
    }
    localStorage.setItem(LONG_SEEDED_KEY, new Date().toISOString());
  } catch { /* storage unavailable — scopes simply start empty */ }
}

const DEFAULT_UNIVERSE = [
  // Tech
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE',
  // Finance
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'C',
  // Healthcare
  'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY',
  // Consumer
  'WMT', 'HD', 'COST', 'MCD', 'NKE', 'SBUX', 'DIS',
  // Industrial
  'CAT', 'BA', 'GE', 'HON', 'UPS',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK', 'GLD', 'TLT', 'EEM', 'HYG',
];

export const DEFAULT_UNIVERSE_SET = new Set(DEFAULT_UNIVERSE);

function loadWatchlist(scope: UniverseScope): string[] {
  try {
    const stored = localStorage.getItem(keysFor(scope).watchlist);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list: string[], scope: UniverseScope) {
  localStorage.setItem(keysFor(scope).watchlist, JSON.stringify(list));
}

function loadExcluded(scope: UniverseScope): string[] {
  try {
    const stored = localStorage.getItem(keysFor(scope).excluded);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveExcluded(list: string[], scope: UniverseScope) {
  localStorage.setItem(keysFor(scope).excluded, JSON.stringify(list));
}

export function getUniverse(scope: UniverseScope = 'short'): string[] {
  const custom = loadWatchlist(scope);
  const excluded = new Set(loadExcluded(scope));
  const combined = new Set([...DEFAULT_UNIVERSE, ...custom]);
  return [...combined].filter((t) => !excluded.has(t)).sort();
}

export function getWatchlist(scope: UniverseScope = 'short'): string[] {
  return loadWatchlist(scope);
}

export function getDefaultUniverse(): string[] {
  return [...DEFAULT_UNIVERSE];
}

export function getExcluded(scope: UniverseScope = 'short'): string[] {
  return loadExcluded(scope);
}

export function addTicker(ticker: string, scope: UniverseScope = 'short') {
  const upper = ticker.toUpperCase().trim();
  if (!upper) return;

  // If it's currently excluded, un-exclude it so the add takes effect
  const excluded = loadExcluded(scope);
  if (excluded.includes(upper)) {
    saveExcluded(excluded.filter((t) => t !== upper), scope);
  }

  // Only add to watchlist if it's not already a default and not already in the watchlist
  if (DEFAULT_UNIVERSE_SET.has(upper)) return;
  const list = loadWatchlist(scope);
  if (list.includes(upper)) return;
  list.push(upper);
  list.sort();
  saveWatchlist(list, scope);
}

export function removeTicker(ticker: string, scope: UniverseScope = 'short') {
  const list = loadWatchlist(scope).filter((t) => t !== ticker.toUpperCase());
  saveWatchlist(list, scope);
}

export function excludeTicker(ticker: string, scope: UniverseScope = 'short') {
  const upper = ticker.toUpperCase().trim();
  if (!upper) return;
  const excluded = loadExcluded(scope);
  if (excluded.includes(upper)) return;
  excluded.push(upper);
  excluded.sort();
  saveExcluded(excluded, scope);
}

export function includeTicker(ticker: string, scope: UniverseScope = 'short') {
  const upper = ticker.toUpperCase().trim();
  const excluded = loadExcluded(scope).filter((t) => t !== upper);
  saveExcluded(excluded, scope);
}

export function clearExcluded(scope: UniverseScope = 'short') {
  saveExcluded([], scope);
}

export function setWatchlist(tickers: string[], scope: UniverseScope = 'short') {
  saveWatchlist(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean), scope);
}

export function resetToDefault(scope: UniverseScope = 'short') {
  saveWatchlist([], scope);
  saveExcluded([], scope);
}

// --- Saved Watchlists ---

/** Uppercase, trim, drop blanks, de-dupe, and sort a list of tickers. */
export function normalizeTickers(tickers: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tickers) {
    const u = t.toUpperCase().trim();
    if (u) seen.add(u);
  }
  return [...seen].sort();
}

function loadSavedWatchlists(scope: UniverseScope): SavedWatchlist[] {
  try {
    const stored = localStorage.getItem(keysFor(scope).saved);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistSavedWatchlists(list: SavedWatchlist[], scope: UniverseScope) {
  localStorage.setItem(keysFor(scope).saved, JSON.stringify(list));
}

function nameTaken(list: SavedWatchlist[], name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return list.some((w) => w.id !== exceptId && w.name.trim().toLowerCase() === n);
}

export function getSavedWatchlists(scope: UniverseScope = 'short'): SavedWatchlist[] {
  return loadSavedWatchlists(scope);
}

export function getActiveWatchlistId(scope: UniverseScope = 'short'): string | null {
  try {
    const stored = localStorage.getItem(keysFor(scope).active);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setActiveWatchlistId(id: string | null, scope: UniverseScope = 'short') {
  localStorage.setItem(keysFor(scope).active, JSON.stringify(id));
}

export function getActiveWatchlist(scope: UniverseScope = 'short'): SavedWatchlist | null {
  const id = getActiveWatchlistId(scope);
  if (!id) return null;
  return loadSavedWatchlists(scope).find((w) => w.id === id) ?? null;
}

/** Create and persist a new named watchlist. Throws on empty or duplicate name. */
export function createWatchlist(name: string, tickers: string[], filters: ScanFilter, scope: UniverseScope = 'short'): SavedWatchlist {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Watchlist name cannot be empty.');
  const list = loadSavedWatchlists(scope);
  if (nameTaken(list, trimmed)) throw new Error(`A watchlist named "${trimmed}" already exists.`);
  const now = new Date().toISOString();
  const watchlist: SavedWatchlist = {
    id: crypto.randomUUID(),
    name: trimmed,
    tickers: normalizeTickers(tickers),
    filters: { ...filters },
    createdAt: now,
    updatedAt: now,
  };
  persistSavedWatchlists([...list, watchlist], scope);
  return watchlist;
}

/** Update an existing watchlist's name, tickers, and/or filters. Throws on empty/duplicate name. */
export function updateWatchlist(
  id: string,
  patch: Partial<Pick<SavedWatchlist, 'name' | 'tickers' | 'filters'>>,
  scope: UniverseScope = 'short',
): SavedWatchlist {
  const list = loadSavedWatchlists(scope);
  const idx = list.findIndex((w) => w.id === id);
  if (idx === -1) throw new Error('Watchlist not found.');

  const next: SavedWatchlist = { ...list[idx] };
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error('Watchlist name cannot be empty.');
    if (nameTaken(list, trimmed, id)) throw new Error(`A watchlist named "${trimmed}" already exists.`);
    next.name = trimmed;
  }
  if (patch.tickers !== undefined) next.tickers = normalizeTickers(patch.tickers);
  if (patch.filters !== undefined) next.filters = { ...patch.filters };
  next.updatedAt = new Date().toISOString();

  const copy = [...list];
  copy[idx] = next;
  persistSavedWatchlists(copy, scope);
  return next;
}

/** Delete a watchlist. If it was the active one, fall back to the default universe. */
export function deleteWatchlist(id: string, scope: UniverseScope = 'short') {
  persistSavedWatchlists(loadSavedWatchlists(scope).filter((w) => w.id !== id), scope);
  if (getActiveWatchlistId(scope) === id) setActiveWatchlistId(null, scope);
}

/**
 * Re-applies an external change to a saved watchlist (e.g. a Discovery
 * promotion) onto an editor's working buffer. Only the delta between the
 * old and new saved lists is applied, so unsaved edits in the buffer
 * survive and a clean buffer stays clean.
 */
export function mergeSavedDelta(working: string[], prevSaved: string[], nextSaved: string[]): string[] {
  const prev = new Set(prevSaved);
  const next = new Set(nextSaved);
  const added = nextSaved.filter((t) => !prev.has(t));
  const removed = new Set(prevSaved.filter((t) => !next.has(t)));
  return normalizeTickers([...working.filter((t) => !removed.has(t)), ...added]);
}
