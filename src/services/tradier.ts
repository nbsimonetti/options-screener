import type { TradierQuote, TradierOption } from '../types';

function baseUrl(sandbox: boolean): string {
  return sandbox
    ? 'https://sandbox.tradier.com/v1'
    : 'https://api.tradier.com/v1';
}

async function tradierFetch<T>(
  path: string,
  token: string,
  sandbox: boolean,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${baseUrl(sandbox)}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tradier API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getQuote(
  ticker: string,
  token: string,
  sandbox: boolean,
): Promise<TradierQuote> {
  const data = await tradierFetch<{ quotes: { quote: TradierQuote | TradierQuote[] } }>(
    '/markets/quotes',
    token,
    sandbox,
    { symbols: ticker.toUpperCase() },
  );
  const q = data.quotes.quote;
  return Array.isArray(q) ? q[0] : q;
}

export async function getExpirations(
  ticker: string,
  token: string,
  sandbox: boolean,
): Promise<string[]> {
  const data = await tradierFetch<{ expirations: { date: string[] | string } }>(
    '/markets/options/expirations',
    token,
    sandbox,
    { symbol: ticker.toUpperCase() },
  );
  const dates = data.expirations?.date;
  if (!dates) return [];
  return Array.isArray(dates) ? dates : [dates];
}

export async function getOptionChain(
  ticker: string,
  expiration: string,
  token: string,
  sandbox: boolean,
): Promise<TradierOption[]> {
  const data = await tradierFetch<{ options: { option: TradierOption[] | TradierOption } }>(
    '/markets/options/chains',
    token,
    sandbox,
    { symbol: ticker.toUpperCase(), expiration, greeks: 'true' },
  );
  const opts = data.options?.option;
  if (!opts) return [];
  return Array.isArray(opts) ? opts : [opts];
}

export interface HistoryDay {
  date: string;
  close: number;
}

export async function getHistory(
  ticker: string,
  token: string,
  sandbox: boolean,
  days: number = 365,
): Promise<HistoryDay[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const data = await tradierFetch<{ history: { day: HistoryDay[] | HistoryDay } }>(
    '/markets/history',
    token,
    sandbox,
    {
      symbol: ticker.toUpperCase(),
      interval: 'daily',
      start: fmt(start),
      end: fmt(end),
    },
  );
  const d = data.history?.day;
  if (!d) return [];
  return Array.isArray(d) ? d : [d];
}
