import type { OptionPosition, TradierOption, TradierQuote, StrategyType, ChainFilter } from '../types';

function calcDTE(expirationDate: string): number {
  const exp = new Date(expirationDate + 'T16:00:00');
  const now = new Date();
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function tradierOptionToPosition(
  opt: TradierOption,
  quote: TradierQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
): OptionPosition {
  const midPrice = opt.bid > 0 && opt.ask > 0 ? (opt.bid + opt.ask) / 2 : opt.last || 0;

  return {
    id: crypto.randomUUID(),
    ticker: quote.symbol,
    strategy,
    currentPrice: quote.last || quote.close || 0,
    strikePrice: opt.strike,
    premium: +midPrice.toFixed(2),
    bid: opt.bid || 0,
    ask: opt.ask || 0,
    dte: calcDTE(opt.expiration_date),
    delta: Math.abs(opt.greeks?.delta || 0),
    iv: (opt.greeks?.mid_iv || 0) * 100,
    ivRank,
    volume: opt.volume || 0,
    openInterest: opt.open_interest || 0,
    nextEarningsDate: earningsDate,
    contractSize: 100,
  };
}

export function filterChain(
  chain: TradierOption[],
  quote: TradierQuote,
  filter: ChainFilter,
): TradierOption[] {
  const price = quote.last || quote.close || 0;
  if (price <= 0) return [];

  return chain.filter((opt) => {
    // Filter by option type based on strategy
    if (filter.strategy === 'CSP' && opt.option_type !== 'put') return false;
    if (filter.strategy === 'CC' && opt.option_type !== 'call') return false;

    // DTE filter
    const dte = calcDTE(opt.expiration_date);
    if (dte < filter.minDTE || dte > filter.maxDTE) return false;

    // Delta filter
    const absDelta = Math.abs(opt.greeks?.delta || 0);
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
    const mid = opt.bid > 0 && opt.ask > 0 ? (opt.bid + opt.ask) / 2 : opt.last || 0;
    if (mid <= 0) return false;

    return true;
  });
}

export function chainToPositions(
  chain: TradierOption[],
  quote: TradierQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
): OptionPosition[] {
  return chain.map((opt) =>
    tradierOptionToPosition(opt, quote, strategy, ivRank, earningsDate),
  );
}
