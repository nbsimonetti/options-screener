const BASE = 'https://api.marketdata.app/v1';

async function mdFetch<T>(path: string, params?: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MarketData API ${res.status}: ${text}`);
  }
  return res.json();
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

// --- Public API ---

export async function getQuote(ticker: string, token?: string): Promise<MDQuote> {
  const data = await mdFetch<MDQuoteResponse>(`/stocks/quotes/${ticker.toUpperCase()}/`, {}, token);
  if (data.s !== 'ok') throw new Error(`No quote data for ${ticker}`);
  return {
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
}

export async function getExpirations(ticker: string, token?: string): Promise<string[]> {
  const data = await mdFetch<MDExpirationsResponse>(`/options/expirations/${ticker.toUpperCase()}/`, {}, token);
  if (data.s !== 'ok' || !data.expirations) return [];
  return data.expirations;
}

export async function getOptionChain(
  ticker: string,
  token?: string,
  params?: { dte?: number; side?: 'call' | 'put'; strikeLimit?: number; expiration?: string },
): Promise<MDOption[]> {
  const qp: Record<string, string> = {};
  if (params?.dte) qp.dte = String(params.dte);
  if (params?.side) qp.side = params.side;
  if (params?.strikeLimit) qp.strikeLimit = String(params.strikeLimit);
  if (params?.expiration) qp.expiration = params.expiration;

  const data = await mdFetch<MDChainResponse>(`/options/chain/${ticker.toUpperCase()}/`, qp, token);
  return chainToRows(data);
}
