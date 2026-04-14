import type { MDQuote, MDOption } from './marketdata';

const QUOTE_CACHE_KEY = 'options-screener-quote-cache';
const EXPIRATIONS_CACHE_KEY = 'options-screener-expirations-cache';
const CHAIN_CACHE_KEY = 'options-screener-chain-cache';

const QUOTE_TTL_MS = 15 * 60 * 1000;            // 15 min
const EXPIRATIONS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const CHAIN_TTL_MS = 60 * 60 * 1000;            // 1 hour

const MAX_CHAIN_ENTRIES = 100;

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

function readCache<T>(key: string): Record<string, CacheEntry<T>> {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function writeCache<T>(key: string, cache: Record<string, CacheEntry<T>>) {
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Quota exceeded — fall back to clearing the cache for this key
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

function isFresh<T>(entry: CacheEntry<T> | undefined, ttl: number): boolean {
  return !!entry && Date.now() - entry.timestamp < ttl;
}

// --- Quote cache ---

export function getCachedQuote(ticker: string): MDQuote | null {
  const cache = readCache<MDQuote>(QUOTE_CACHE_KEY);
  const entry = cache[ticker.toUpperCase()];
  return isFresh(entry, QUOTE_TTL_MS) ? entry.value : null;
}

export function setCachedQuote(ticker: string, quote: MDQuote) {
  const cache = readCache<MDQuote>(QUOTE_CACHE_KEY);
  cache[ticker.toUpperCase()] = { value: quote, timestamp: Date.now() };
  writeCache(QUOTE_CACHE_KEY, cache);
}

// --- Expirations cache ---

export function getCachedExpirations(ticker: string): string[] | null {
  const cache = readCache<string[]>(EXPIRATIONS_CACHE_KEY);
  const entry = cache[ticker.toUpperCase()];
  return isFresh(entry, EXPIRATIONS_TTL_MS) ? entry.value : null;
}

export function setCachedExpirations(ticker: string, expirations: string[]) {
  const cache = readCache<string[]>(EXPIRATIONS_CACHE_KEY);
  cache[ticker.toUpperCase()] = { value: expirations, timestamp: Date.now() };
  writeCache(EXPIRATIONS_CACHE_KEY, cache);
}

// --- Chain cache ---

export interface ChainCacheParams {
  dte?: number;
  side?: string;
  expiration?: string;
  strikeLimit?: number;
}

export function chainCacheKey(ticker: string, params?: ChainCacheParams): string {
  const parts = [ticker.toUpperCase()];
  if (params?.dte != null) parts.push(`dte=${params.dte}`);
  if (params?.side) parts.push(`side=${params.side}`);
  if (params?.expiration) parts.push(`exp=${params.expiration}`);
  if (params?.strikeLimit != null) parts.push(`lim=${params.strikeLimit}`);
  return parts.join('|');
}

export function getCachedChain(key: string): MDOption[] | null {
  const cache = readCache<MDOption[]>(CHAIN_CACHE_KEY);
  const entry = cache[key];
  return isFresh(entry, CHAIN_TTL_MS) ? entry.value : null;
}

export function setCachedChain(key: string, chain: MDOption[]) {
  const cache = readCache<MDOption[]>(CHAIN_CACHE_KEY);

  // LRU-style cap: if over the limit, evict oldest half
  const entries = Object.entries(cache);
  if (entries.length >= MAX_CHAIN_ENTRIES) {
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const keepEntries = entries.slice(Math.floor(entries.length / 2));
    const trimmed = Object.fromEntries(keepEntries);
    cache[key] = { value: chain, timestamp: Date.now() };
    writeCache(CHAIN_CACHE_KEY, { ...trimmed, [key]: cache[key] });
    return;
  }

  cache[key] = { value: chain, timestamp: Date.now() };
  writeCache(CHAIN_CACHE_KEY, cache);
}

// --- Management ---

export function clearMarketDataCache() {
  localStorage.removeItem(QUOTE_CACHE_KEY);
  localStorage.removeItem(EXPIRATIONS_CACHE_KEY);
  localStorage.removeItem(CHAIN_CACHE_KEY);
}

export function getCacheStats(): { quotes: number; expirations: number; chains: number } {
  const q = readCache(QUOTE_CACHE_KEY);
  const e = readCache(EXPIRATIONS_CACHE_KEY);
  const c = readCache(CHAIN_CACHE_KEY);
  return {
    quotes: Object.keys(q).length,
    expirations: Object.keys(e).length,
    chains: Object.keys(c).length,
  };
}

// Helpers for scanner to check hit status without issuing a fetch
export function hasQuoteCached(ticker: string): boolean {
  return getCachedQuote(ticker) !== null;
}

export function hasChainCached(key: string): boolean {
  return getCachedChain(key) !== null;
}
