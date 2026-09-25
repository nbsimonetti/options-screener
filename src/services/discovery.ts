// Client side of the discovery feature: loads the CI-built pre-scored pool
// (discovery-data.json — S&P 500 + Nasdaq-100 + liquid Russell 2000, scored
// with the SAME factor engine in Node), exposes the shortlists, and handles
// promotion into the scan universe with provenance tracking.
//
// Zero MarketData credits: everything here is static data. In dev without the
// artifact, run `node scripts/build-discovery-data.mjs --limit 120` once to
// generate a local test pool (it lands in public/, which Vite serves).

import {
  addTicker, removeTicker, getActiveWatchlistId, getSavedWatchlists, updateWatchlist, normalizeTickers,
} from './universe';
import type { UniverseScope } from './universe';
import type { DailyBars } from './history';

export interface DiscoveryRow {
  t: string;             // ticker
  n?: string;            // company name (constituent files, Yahoo-cased for shortlist members)
  d?: string;            // 1-sentence business description (shortlist members; industry-line fallback)
  ind?: string;          // "Industry · Exchange" line (shortlist members only)
  cap: 'LC' | 'SC';
  sec: string;           // sector (from constituent source)
  p: number;             // price at snapshot
  adv: number;           // 20d avg dollar volume, $M
  bull: number;          // bullish composite 0-100
  bear: number;          // bearish composite (0 = excluded by a guard)
  bullP?: number;        // within-cap-bucket percentile
  bearP?: number;
  bf: [string, number][]; // bull factor [key, score] pairs (no ivq — unknown pre-options)
  sf: [string, number][];
  g: string[];           // small-cap put-side guards that fired
  trig?: string;         // entry trigger (shortlist members only)
  trigDate?: string;
}

interface CompactBars { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

export interface DiscoveryData {
  fetchedAt: string;
  stats: { poolSize: number; scored: number; lc: number; sc: number; failures: number };
  topLong: string[];
  topShort: string[];
  scored: DiscoveryRow[];
  topBars: Record<string, CompactBars>;
}

const DISCOVERY_URL = `${import.meta.env.BASE_URL}discovery-data.json`;
let discoveryPromise: Promise<DiscoveryData | null> | null = null;

export function loadDiscoveryData(): Promise<DiscoveryData | null> {
  if (!discoveryPromise) {
    discoveryPromise = fetch(DISCOVERY_URL)
      .then((res) => (res.ok ? (res.json() as Promise<DiscoveryData>) : null))
      .catch(() => null);
  }
  return discoveryPromise;
}

/** Bars for a shortlist member — lets the Long scanner evaluate promoted
 * tickers in production without the dev proxy. Sync over the cached load. */
let loadedData: DiscoveryData | null = null;
loadDiscoveryData().then((d) => { loadedData = d; });

export function getDiscoveryBars(ticker: string): DailyBars | null {
  const compact = loadedData?.topBars?.[ticker.toUpperCase()];
  if (!compact) return null;
  return {
    ticker: ticker.toUpperCase(),
    timestamps: compact.t,
    opens: compact.o,
    highs: compact.h,
    lows: compact.l,
    closes: compact.c,
    volumes: compact.v,
  };
}

// --- Promotion with provenance ---

const LS_PROMOTED = 'options-screener-promoted';

export interface PromotedRecord {
  ticker: string;
  promotedAt: string; // ISO
  direction: 'long' | 'short';
  watchlistId?: string; // set when the ticker went into a saved watchlist rather than the default list
}

export function getPromoted(): PromotedRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_PROMOTED) || '[]');
  } catch {
    return [];
  }
}

function savePromoted(list: PromotedRecord[]) {
  try {
    localStorage.setItem(LS_PROMOTED, JSON.stringify(list));
  } catch { /* ignore */ }
}

// Each Idea Generator has its own universe: bullish discovery candidates
// feed the Long tab, bearish ones the Short tab. Within a tab, a promotion
// goes into whatever that tab actually SCANS — the active saved watchlist
// when one is selected (a scan covers only that list), otherwise the
// default list. Sending promotions to the default list while a saved
// watchlist was active left them silently unscanned.
const scopeFor = (direction: 'long' | 'short'): UniverseScope => direction;

export interface PromotionTarget {
  kind: 'watchlist' | 'default';
  watchlistId?: string;
  label: string; // "Nick's Tickers" or "default list"
}

export function promotionTarget(direction: 'long' | 'short'): PromotionTarget {
  const scope = scopeFor(direction);
  const id = getActiveWatchlistId(scope);
  const wl = id ? getSavedWatchlists(scope).find((w) => w.id === id) : undefined;
  return wl ? { kind: 'watchlist', watchlistId: wl.id, label: wl.name } : { kind: 'default', label: 'default list' };
}

function addToWatchlist(watchlistId: string, ticker: string, scope: UniverseScope) {
  const wl = getSavedWatchlists(scope).find((w) => w.id === watchlistId);
  if (!wl || wl.tickers.includes(ticker)) return;
  updateWatchlist(watchlistId, { tickers: normalizeTickers([...wl.tickers, ticker]) }, scope);
}

function removeFromTarget(r: PromotedRecord) {
  const scope = scopeFor(r.direction);
  if (r.watchlistId) {
    const wl = getSavedWatchlists(scope).find((w) => w.id === r.watchlistId);
    if (wl) updateWatchlist(wl.id, { tickers: wl.tickers.filter((t) => t !== r.ticker) }, scope);
    return;
  }
  removeTicker(r.ticker, scope);
}

/** Adds the ticker to what the matching tab scans and records provenance. */
export function promoteTicker(ticker: string, direction: 'long' | 'short'): PromotionTarget {
  const upper = ticker.toUpperCase();
  const scope = scopeFor(direction);
  const target = promotionTarget(direction);
  if (target.kind === 'watchlist' && target.watchlistId) addToWatchlist(target.watchlistId, upper, scope);
  else addTicker(upper, scope);
  const list = getPromoted().filter((r) => !(r.ticker === upper && r.direction === direction));
  list.push({ ticker: upper, promotedAt: new Date().toISOString(), direction, watchlistId: target.watchlistId });
  savePromoted(list);
  return target;
}

export function demoteTicker(ticker: string, direction: 'long' | 'short') {
  const upper = ticker.toUpperCase();
  const all = getPromoted();
  for (const r of all.filter((x) => x.ticker === upper && x.direction === direction)) removeFromTarget(r);
  savePromoted(all.filter((r) => !(r.ticker === upper && r.direction === direction)));
}

/** Removes every discovery-promoted ticker for one direction's tab. */
export function demoteAll(direction: 'long' | 'short') {
  const all = getPromoted();
  for (const r of all.filter((x) => x.direction === direction)) removeFromTarget(r);
  savePromoted(all.filter((x) => x.direction !== direction));
}
