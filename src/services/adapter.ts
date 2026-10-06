import type { OptionPosition, StrategyType, ChainFilter, PositionWarning } from '../types';
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

    // Liquidity: bid ≥ $0.05 and OI ≥ 100 always. Spread ≤ 15% of mid is
    // clean; 15–50% passes only when the contract is cheap in dollars
    // (spread ≤ $0.10) or deep (OI ≥ 1,000), matching the long screener —
    // the idea carries a wide-spread warning (see spreadWarning) and the
    // paper engine won't enter it. Over 50% of mid is never a real market.
    const bid = opt.bid || 0;
    const ask = opt.ask || 0;
    if (bid < 0.05) return false;
    const spread = ask - bid;
    if (spread < 0) return false;
    if ((opt.openInterest || 0) < 100) return false;
    const spreadPct = spread / mid;
    if (spreadPct > 0.50) return false;
    if (spreadPct > 0.15 && !(spread <= 0.10 || (opt.openInterest || 0) >= 1000)) return false;

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

/** Warning for contracts admitted under the dollar-spread / open-interest exception. */
export function spreadWarning(bid: number, ask: number): PositionWarning | null {
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  const pct = (ask - bid) / mid;
  if (pct <= 0.15) return null;
  return {
    code: 'wide-spread',
    text: `Spread is ${(pct * 100).toFixed(0)}% of mid ($${(ask - bid).toFixed(2)}) — a real fill will land well below mid`,
  };
}
