import { recordCredits, type CreditCategory } from './creditLedger';

const BASE = 'https://api.marketdata.app/v1';

// --- Credit counter ---
//
// MarketData.app bills per SYMBOL RETURNED, not per HTTP request: an option
// chain with strikeLimit 20 costs ~20 credits. Session counters below track
// real credits; creditLedger.ts persists the daily total across sessions.

let requestCount = 0; // HTTP requests this session (diagnostics only)
let creditCount = 0;  // billed credits this session — the number that matters
let creditListener: ((credits: number) => void) | null = null;

// Category attributed to credits spent by subsequent fetches (scans/marking
// set this around their work; default 'other').
let activeCategory: CreditCategory = 'other';
export function setCreditCategory(cat: CreditCategory) {
  activeCategory = cat;
}

export function resetRequestCount() {
  requestCount = 0;
  creditCount = 0;
  creditListener?.(0);
}

export function getRequestCount(): number {
  return requestCount;
}

export function getCreditCount(): number {
  return creditCount;
}

export function onRequestCountChange(cb: ((credits: number) => void) | null) {
  creditListener = cb;
}

export class BudgetExceededError extends Error {
  limit: number;
  used: number;
  constructor(limit: number, used: number) {
    super(`API credit budget exceeded: ${used}/${limit}`);
    this.name = 'BudgetExceededError';
    this.limit = limit;
    this.used = used;
  }
}

export function enforceBudget(limit: number) {
  if (creditCount >= limit) {
    throw new BudgetExceededError(limit, creditCount);
  }
}

function tallyCredits(n: number) {
  creditCount += n;
  recordCredits(n, activeCategory);
  creditListener?.(creditCount);
}

async function mdFetch<T>(path: string, params?: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Token ${token}`;

  let res = await fetch(url.toString(), { headers });
  if (res.status === 429) {
    // Rate-limited: single retry after a short backoff instead of silently
    // failing the ticker.
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetch(url.toString(), { headers });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MarketData API ${res.status}: ${text}`);
  }
  const data = await res.json();
  requestCount += 1;
  return data;
}

// --- Types ---

export interface MDQuoteResponse {
  s: string;
  symbol: string[];
  ask: number[];
  bid: number[];
  mid: number[];
  last: number[];
  change: number[];
  changepct: number[];
  volume: number[];
  updated: number[];
}

export interface MDChainResponse {
  s: string;
  optionSymbol: string[];
  underlying: string[];
  expiration: number[];
  side: string[];
  strike: number[];
  bid: number[];
  ask: number[];
  mid: number[];
  last: number[];
  volume: number[];
  openInterest: number[];
  iv: number[];
  delta: number[];
  gamma: number[];
  theta: number[];
  vega: number[];
  dte: number[];
  underlyingPrice: number[];
  inTheMoney: boolean[];
  updated: number[];
}

export interface MDExpirationsResponse {
  s: string;
  expirations: string[];
}

export interface MDOption {
  optionSymbol: string;
  underlying: string;
  expiration: number;
  side: string;
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  dte: number;
  underlyingPrice: number;
  inTheMoney: boolean;
}

export interface MDQuote {
  symbol: string;
  ask: number;
  bid: number;
  mid: number;
  last: number;
  change: number;
  changepct: number;
  volume: number;
  updated: number;
}

// --- Helper: convert columnar response to row-based ---

function chainToRows(data: MDChainResponse): MDOption[] {
  if (data.s !== 'ok' || !data.optionSymbol) return [];
  return data.optionSymbol.map((_, i) => ({
    optionSymbol: data.optionSymbol[i],
    underlying: data.underlying[i],
    expiration: data.expiration[i],
    side: data.side[i],
    strike: data.strike[i],
    bid: data.bid[i],
    ask: data.ask[i],
    mid: data.mid[i],
    last: data.last[i],
    volume: data.volume[i],
    openInterest: data.openInterest[i],
    iv: data.iv[i],
    delta: data.delta[i],
    gamma: data.gamma[i],
    theta: data.theta[i],
    vega: data.vega[i],
    dte: data.dte[i],
    underlyingPrice: data.underlyingPrice[i],
    inTheMoney: data.inTheMoney[i],
  }));
}

// --- Public API (cached) ---

import {
  getCachedQuote, setCachedQuote,
  getCachedExpirations, setCachedExpirations,
  getCachedChain, setCachedChain,
  chainCacheKey,
} from './marketdataCache';

export async function getQuote(ticker: string, token?: string): Promise<MDQuote> {
  const upper = ticker.toUpperCase();
  const cached = getCachedQuote(upper);
  if (cached) return cached;

  const data = await mdFetch<MDQuoteResponse>(`/stocks/quotes/${upper}/`, {}, token);
  tallyCredits(1);
  if (data.s !== 'ok') throw new Error(`No quote data for ${ticker}`);

  const quote: MDQuote = {
    symbol: data.symbol[0],
    ask: data.ask[0],
    bid: data.bid[0],
    mid: data.mid[0],
    last: data.last[0],
    change: data.change[0],
    changepct: data.changepct[0],
    volume: data.volume[0],
    updated: data.updated[0],
  };
  setCachedQuote(upper, quote);
  return quote;
}

export async function getExpirations(ticker: string, token?: string): Promise<string[]> {
  const upper = ticker.toUpperCase();
  const cached = getCachedExpirations(upper);
  if (cached) return cached;

  const data = await mdFetch<MDExpirationsResponse>(`/options/expirations/${upper}/`, {}, token);
  tallyCredits(1);
  if (data.s !== 'ok' || !data.expirations) return [];
  setCachedExpirations(upper, data.expirations);
  return data.expirations;
}

export async function getOptionChain(
  ticker: string,
  token?: string,
  params?: { dte?: number; side?: 'call' | 'put'; strikeLimit?: number; expiration?: string },
): Promise<MDOption[]> {
  const upper = ticker.toUpperCase();
  const key = chainCacheKey(upper, params);
  const cached = getCachedChain(key);
  if (cached) return cached;

  const qp: Record<string, string> = {};
  if (params?.dte) qp.dte = String(params.dte);
  if (params?.side) qp.side = params.side;
  if (params?.strikeLimit) qp.strikeLimit = String(params.strikeLimit);
  if (params?.expiration) qp.expiration = params.expiration;

  const data = await mdFetch<MDChainResponse>(`/options/chain/${upper}/`, qp, token);
  const chain = chainToRows(data);
  // Chain requests bill 1 credit PER OPTION SYMBOL RETURNED.
  tallyCredits(Math.max(1, chain.length));
  setCachedChain(key, chain);
  return chain;
}

// --- Single option quote (used by the paper-trading engine to mark open
// positions at 1 credit per contract instead of refetching whole chains) ---

export interface MDOptionQuote {
  optionSymbol: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  underlyingPrice: number;
  dte: number;
  updated: number;
}

interface MDOptionQuoteResponse {
  s: string;
  optionSymbol: string[];
  bid: number[];
  ask: number[];
  mid: number[];
  last: number[];
  volume: number[];
  openInterest: number[];
  iv: number[];
  delta: number[];
  underlyingPrice: number[];
  dte: number[];
  updated: number[];
}

export async function getOptionQuote(optionSymbol: string, token?: string): Promise<MDOptionQuote | null> {
  const data = await mdFetch<MDOptionQuoteResponse>(`/options/quotes/${optionSymbol}/`, {}, token);
  tallyCredits(1);
  if (data.s !== 'ok' || !data.optionSymbol?.length) return null;
  return {
    optionSymbol: data.optionSymbol[0],
    bid: data.bid[0] ?? 0,
    ask: data.ask[0] ?? 0,
    mid: data.mid[0] ?? 0,
    last: data.last[0] ?? 0,
    volume: data.volume[0] ?? 0,
    openInterest: data.openInterest[0] ?? 0,
    iv: data.iv[0] ?? 0,
    delta: data.delta[0] ?? 0,
    underlyingPrice: data.underlyingPrice[0] ?? 0,
    dte: data.dte[0] ?? 0,
    updated: data.updated[0] ?? 0,
  };
}

// --- Daily candles (history fallback for tickers outside the CI snapshot) ---
// Billed at 1 credit per 1,000 candles, so ~2y of daily bars costs 1 credit.

export interface MDCandles {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
}

interface MDCandlesResponse extends Partial<MDCandles> {
  s: string;
}

export async function getDailyCandles(ticker: string, token?: string, countback = 520): Promise<MDCandles | null> {
  const upper = ticker.toUpperCase();
  const to = new Date().toISOString().slice(0, 10);
  const data = await mdFetch<MDCandlesResponse>(
    `/stocks/candles/D/${upper}/`,
    { to, countback: String(countback) },
    token,
  );
  const n = data.c?.length ?? 0;
  tallyCredits(Math.max(1, Math.ceil(n / 1000)));
  if (data.s !== 'ok' || !data.t || !data.c || n === 0) return null;
  return { t: data.t, o: data.o ?? data.c, h: data.h ?? data.c, l: data.l ?? data.c, c: data.c, v: data.v ?? data.c.map(() => 0) };
}
