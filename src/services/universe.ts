import { LS_WATCHLIST, LS_EXCLUDED, LS_SAVED_WATCHLISTS, LS_ACTIVE_WATCHLIST } from '../types';
import type { ScanFilter, SavedWatchlist } from '../types';

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

function loadWatchlist(): string[] {
  try {
    const stored = localStorage.getItem(LS_WATCHLIST);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list: string[]) {
  localStorage.setItem(LS_WATCHLIST, JSON.stringify(list));
}

function loadExcluded(): string[] {
  try {
    const stored = localStorage.getItem(LS_EXCLUDED);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveExcluded(list: string[]) {
  localStorage.setItem(LS_EXCLUDED, JSON.stringify(list));
}

export function getUniverse(): string[] {
  const custom = loadWatchlist();
  const excluded = new Set(loadExcluded());
  const combined = new Set([...DEFAULT_UNIVERSE, ...custom]);
  return [...combined].filter((t) => !excluded.has(t)).sort();
}

export function getWatchlist(): string[] {
  return loadWatchlist();
}

export function getDefaultUniverse(): string[] {
  return [...DEFAULT_UNIVERSE];
}

export function getExcluded(): string[] {
  return loadExcluded();
}

export function addTicker(ticker: string) {
  const upper = ticker.toUpperCase().trim();
  if (!upper) return;

  // If it's currently excluded, un-exclude it so the add takes effect
  const excluded = loadExcluded();
  if (excluded.includes(upper)) {
    saveExcluded(excluded.filter((t) => t !== upper));
  }

  // Only add to watchlist if it's not already a default and not already in the watchlist
  if (DEFAULT_UNIVERSE_SET.has(upper)) return;
  const list = loadWatchlist();
  if (list.includes(upper)) return;
  list.push(upper);
  list.sort();
  saveWatchlist(list);
}

export function removeTicker(ticker: string) {
  const list = loadWatchlist().filter((t) => t !== ticker.toUpperCase());
  saveWatchlist(list);
}

export function excludeTicker(ticker: string) {
  const upper = ticker.toUpperCase().trim();
  if (!upper) return;
  const excluded = loadExcluded();
  if (excluded.includes(upper)) return;
  excluded.push(upper);
  excluded.sort();
  saveExcluded(excluded);
}

export function includeTicker(ticker: string) {
  const upper = ticker.toUpperCase().trim();
  const excluded = loadExcluded().filter((t) => t !== upper);
  saveExcluded(excluded);
}

export function clearExcluded() {
  saveExcluded([]);
}

export function setWatchlist(tickers: string[]) {
  saveWatchlist(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean));
}

export function resetToDefault() {
  saveWatchlist([]);
  saveExcluded([]);
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

function loadSavedWatchlists(): SavedWatchlist[] {
  try {
    const stored = localStorage.getItem(LS_SAVED_WATCHLISTS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistSavedWatchlists(list: SavedWatchlist[]) {
  localStorage.setItem(LS_SAVED_WATCHLISTS, JSON.stringify(list));
}

function nameTaken(list: SavedWatchlist[], name: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return list.some((w) => w.id !== exceptId && w.name.trim().toLowerCase() === n);
}

export function getSavedWatchlists(): SavedWatchlist[] {
  return loadSavedWatchlists();
}

export function getActiveWatchlistId(): string | null {
  try {
    const stored = localStorage.getItem(LS_ACTIVE_WATCHLIST);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function setActiveWatchlistId(id: string | null) {
  localStorage.setItem(LS_ACTIVE_WATCHLIST, JSON.stringify(id));
}

export function getActiveWatchlist(): SavedWatchlist | null {
  const id = getActiveWatchlistId();
  if (!id) return null;
  return loadSavedWatchlists().find((w) => w.id === id) ?? null;
}

/** Create and persist a new named watchlist. Throws on empty or duplicate name. */
export function createWatchlist(name: string, tickers: string[], filters: ScanFilter): SavedWatchlist {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Watchlist name cannot be empty.');
  const list = loadSavedWatchlists();
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
  persistSavedWatchlists([...list, watchlist]);
  return watchlist;
}

/** Update an existing watchlist's name, tickers, and/or filters. Throws on empty/duplicate name. */
export function updateWatchlist(
  id: string,
  patch: Partial<Pick<SavedWatchlist, 'name' | 'tickers' | 'filters'>>,
): SavedWatchlist {
  const list = loadSavedWatchlists();
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
  persistSavedWatchlists(copy);
  return next;
}

/** Delete a watchlist. If it was the active one, fall back to the default universe. */
export function deleteWatchlist(id: string) {
  persistSavedWatchlists(loadSavedWatchlists().filter((w) => w.id !== id));
  if (getActiveWatchlistId() === id) setActiveWatchlistId(null);
}
