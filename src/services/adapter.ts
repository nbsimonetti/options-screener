import type { OptionPosition, StrategyType, ChainFilter } from '../types';
import type { MDOption, MDQuote } from './marketdata';

export function mdOptionToPosition(
  opt: MDOption,
  quote: MDQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
  atmIV?: number,
  medianIV?: number,
): OptionPosition {
  const currentPrice = quote.last || quote.mid || 0;
  const premium = +(opt.mid || opt.last || 0).toFixed(2);
  const intrinsic = strategy === 'CSP'
    ? Math.max(0, opt.strike - currentPrice)
    : Math.max(0, currentPrice - opt.strike);
  const extrinsic = Math.max(0, premium - intrinsic);

  return {
    id: crypto.randomUUID(),
    ticker: quote.symbol,
    strategy,
    currentPrice,
    strikePrice: opt.strike,
    premium,
    bid: opt.bid || 0,
    ask: opt.ask || 0,
    dte: opt.dte,
    expirationDate: new Date(opt.expiration * 1000).toISOString().split('T')[0],
    // Short-side scoring/display uses |delta|; the raw signed value and the
    // option symbol are preserved for position marking and delta math.
    delta: Math.abs(opt.delta || 0),
    signedDelta: opt.delta || 0,
    optionSymbol: opt.optionSymbol,
    theta: opt.theta || 0,
    vega: opt.vega || 0,
    gamma: opt.gamma || 0,
    iv: (opt.iv || 0) * 100,
    ivRank,
    atmIV,
    medianIV,
    extrinsicValue: +extrinsic.toFixed(2),
    intrinsicValue: +intrinsic.toFixed(2),
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
    if (otmPct > filter.maxOTMPct) return false;

    // Must have some premium
    const mid = opt.mid || opt.last || 0;
    if (mid <= 0) return false;

    // Hard liquidity floors (long-strategy research, applied to the short
    // book too — a short position may need to be bought back under stress,
    // and MID-fill results on wide markets overstate income returns):
    //   bid ≥ $0.05, spread ≤ 15% of mid, OI ≥ 100, credit ≥ 3× spread.
    const bid = opt.bid || 0;
    const ask = opt.ask || 0;
    if (bid < 0.05) return false;
    const spread = ask - bid;
    if (spread < 0) return false;
    if (mid > 0 && spread / mid > 0.15) return false;
    if ((opt.openInterest || 0) < 100) return false;
    if (mid < 3 * spread) return false;

    return true;
  });
}

export function mdChainToPositions(
  chain: MDOption[],
  quote: MDQuote,
  strategy: StrategyType,
  ivRank: number,
  earningsDate: string,
  atmIV?: number,
  medianIV?: number,
): OptionPosition[] {
  return chain.map((opt) => mdOptionToPosition(opt, quote, strategy, ivRank, earningsDate, atmIV, medianIV));
}
