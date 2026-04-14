const PROXY = 'https://corsproxy.io/';
const BASE = 'https://query1.finance.yahoo.com';

async function yahooFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const proxied = `${PROXY}${encodeURIComponent(url.toString())}`;
  const res = await fetch(proxied);
  if (!res.ok) {
    throw new Error(`Yahoo Finance ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export interface YahooQuote {
  symbol: string;
  shortName: string;
  longName: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose: number;
  regularMarketTime: number;
  earningsTimestamp?: number;
  marketState: string;
}

export interface YahooOption {
  contractSymbol: string;
  strike: number;
  currency: string;
  lastPrice: number;
  change: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  expiration: number;
  contractSize: string;
  inTheMoney: boolean;
}

interface YahooOptionsResponse {
  optionChain: {
    result: Array<{
      underlyingSymbol: string;
      expirationDates: number[];
      strikes: number[];
      quote: YahooQuote;
      options: Array<{
        expirationDate: number;
        calls: YahooOption[];
        puts: YahooOption[];
      }>;
    }>;
  };
}

interface YahooQuoteResponse {
  quoteResponse: {
    result: YahooQuote[];
  };
}

export async function getQuote(ticker: string): Promise<YahooQuote> {
  const data = await yahooFetch<YahooQuoteResponse>('/v7/finance/quote', {
    symbols: ticker.toUpperCase(),
  });
  const quote = data.quoteResponse?.result?.[0];
  if (!quote) throw new Error(`No quote data for ${ticker}`);
  return quote;
}

export async function getExpirations(ticker: string): Promise<number[]> {
  const data = await yahooFetch<YahooOptionsResponse>(
    `/v7/finance/options/${ticker.toUpperCase()}`,
  );
  return data.optionChain?.result?.[0]?.expirationDates || [];
}

export interface YahooChainResult {
  quote: YahooQuote;
  calls: YahooOption[];
  puts: YahooOption[];
  expirationDates: number[];
}

export async function getOptionChain(
  ticker: string,
  expirationEpoch?: number,
): Promise<YahooChainResult> {
  const params: Record<string, string> = {};
  if (expirationEpoch) params.date = String(expirationEpoch);

  const data = await yahooFetch<YahooOptionsResponse>(
    `/v7/finance/options/${ticker.toUpperCase()}`,
    params,
  );
  const result = data.optionChain?.result?.[0];
  if (!result) throw new Error(`No options data for ${ticker}`);

  const options = result.options?.[0];
  return {
    quote: result.quote,
    calls: options?.calls || [],
    puts: options?.puts || [],
    expirationDates: result.expirationDates || [],
  };
}

export function epochToISO(epoch: number): string {
  return new Date(epoch * 1000).toISOString().split('T')[0];
}

export function earningsDateFromQuote(quote: YahooQuote): string {
  if (!quote.earningsTimestamp) return '';
  return epochToISO(quote.earningsTimestamp);
}
