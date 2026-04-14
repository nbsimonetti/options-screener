import type { OptionPosition, StrategyType, ChainFilter } from '../types';
import type { YahooOption, YahooQuote } from './yahoo';
import { earningsDateFromQuote } from './yahoo';
import { computeGreeks } from './greeks';

function calcDTE(expirationEpoch: number): number {
  const exp = new Date(expirationEpoch * 1000);
  const now = new Date();
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function yahooOptionToPosition(
  opt: YahooOption,
  quote: YahooQuote,
  strategy: StrategyType,
  ivRank: number,
): OptionPosition {
  const price = quote.regularMarketPrice || quote.regularMarketPreviousClose || 0;
  const midPrice = opt.bid > 0 && opt.ask > 0 ? (opt.bid + opt.ask) / 2 : opt.lastPrice || 0;
  const dte = calcDTE(opt.expiration);
  const iv = opt.impliedVolatility || 0; // Yahoo returns decimal (e.g., 0.35)
  const optType = strategy === 'CSP' ? 'put' as const : 'call' as const;
  const greeks = computeGreeks(price, opt.strike, dte, iv, optType);

  return {
    id: crypto.randomUUID(),
    ticker: quote.symbol,
    strategy,
    currentPrice: price,
    strikePrice: opt.strike,
    premium: +midPrice.toFixed(2),
    bid: opt.bid || 0,
    ask: opt.ask || 0,
    dte,
    delta: Math.abs(greeks.delta),
    iv: iv * 100,
    ivRank,
    volume: opt.volume || 0,
    openInterest: opt.openInterest || 0,
    nextEarningsDate: earningsDateFromQuote(quote),
    contractSize: 100,
  };
}

export function filterYahooChain(
  calls: YahooOption[],
  puts: YahooOption[],
  quote: YahooQuote,
  filter: ChainFilter,
): YahooOption[] {
  const price = quote.regularMarketPrice || quote.regularMarketPreviousClose || 0;
  if (price <= 0) return [];

  const source = filter.strategy === 'CSP' ? puts : calls;

  return source.filter((opt) => {
    const dte = calcDTE(opt.expiration);
    if (dte < filter.minDTE || dte > filter.maxDTE) return false;

    // Compute delta for filtering
    const iv = opt.impliedVolatility || 0;
    if (iv <= 0) return false;
    const optType = filter.strategy === 'CSP' ? 'put' as const : 'call' as const;
    const greeks = computeGreeks(price, opt.strike, dte, iv, optType);
    const absDelta = Math.abs(greeks.delta);
    if (absDelta < filter.minDelta || absDelta > filter.maxDelta) return false;

    // OTM filter
    let otmPct: number;
    if (filter.strategy === 'CSP') {
      otmPct = ((price - opt.strike) / price) * 100;
    } else {
      otmPct = ((opt.strike - price) / price) * 100;
    }
    if (otmPct < filter.minOTMPct) return false;

    // Must have some premium
    const mid = opt.bid > 0 && opt.ask > 0 ? (opt.bid + opt.ask) / 2 : opt.lastPrice || 0;
    if (mid <= 0) return false;

    return true;
  });
}

export function yahooChainToPositions(
  options: YahooOption[],
  quote: YahooQuote,
  strategy: StrategyType,
  ivRank: number,
): OptionPosition[] {
  return options.map((opt) => yahooOptionToPosition(opt, quote, strategy, ivRank));
}
