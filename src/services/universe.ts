import { LS_WATCHLIST } from '../types';

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

export function getUniverse(): string[] {
  const custom = loadWatchlist();
  const combined = new Set([...DEFAULT_UNIVERSE, ...custom]);
  return [...combined].sort();
}

export function getWatchlist(): string[] {
  return loadWatchlist();
}

export function getDefaultUniverse(): string[] {
  return [...DEFAULT_UNIVERSE];
}

export function addTicker(ticker: string) {
  const list = loadWatchlist();
  const upper = ticker.toUpperCase().trim();
  if (!upper || list.includes(upper)) return;
  list.push(upper);
  list.sort();
  saveWatchlist(list);
}

export function removeTicker(ticker: string) {
  const list = loadWatchlist().filter((t) => t !== ticker.toUpperCase());
  saveWatchlist(list);
}

export function setWatchlist(tickers: string[]) {
  saveWatchlist(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean));
}

export function resetToDefault() {
  saveWatchlist([]);
}
