import { LS_WATCHLIST, LS_EXCLUDED } from '../types';

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
