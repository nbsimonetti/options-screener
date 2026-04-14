import type { OptionPosition, StrategyType, ChainFilter } from '../types';
import type { MDOption, MDQuote } from './marketdata';

export function mdOptionToPosition(
  opt: MDOption,
  quote: MDQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
): OptionPosition {
  return {
    id: crypto.randomUUID(),
    ticker: quote.symbol,
    strategy,
    currentPrice: quote.last || quote.mid || 0,
    strikePrice: opt.strike,
    premium: +(opt.mid || opt.last || 0).toFixed(2),
    bid: opt.bid || 0,
    ask: opt.ask || 0,
    dte: opt.dte,
    delta: Math.abs(opt.delta || 0),
    iv: (opt.iv || 0) * 100,
    ivRank,
    volume: opt.volume || 0,
    openInterest: opt.openInterest || 0,
    nextEarningsDate: earningsDate,
    contractSize: 100,
  };
}

export function filterMDChain(
  chain: MDOption[],
  quote: MDQuote,
  filter: ChainFilter,
): MDOption[] {
  const price = quote.last || quote.mid || 0;
  if (price <= 0) return [];

  return chain.filter((opt) => {
    // Side filter
    if (filter.strategy === 'CSP' && opt.side !== 'put') return false;
    if (filter.strategy === 'CC' && opt.side !== 'call') return false;

    // DTE filter
    if (opt.dte < filter.minDTE || opt.dte > filter.maxDTE) return false;

    // Delta filter
    const absDelta = Math.abs(opt.delta || 0);
    if (absDelta < filter.minDelta || absDelta > filter.maxDelta) return false;

    // OTM filter — skip ITM options
    if (opt.inTheMoney) return false;
    let otmPct: number;
    if (filter.strategy === 'CSP') {
      otmPct = ((price - opt.strike) / price) * 100;
    } else {
      otmPct = ((opt.strike - price) / price) * 100;
    }
    if (otmPct < filter.minOTMPct) return false;

    // Must have some premium
    const mid = opt.mid || opt.last || 0;
    if (mid <= 0) return false;

    return true;
  });
}

export function mdChainToPositions(
  chain: MDOption[],
  quote: MDQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
): OptionPosition[] {
  return chain.map((opt) => mdOptionToPosition(opt, quote, strategy, ivRank, earningsDate));
}
