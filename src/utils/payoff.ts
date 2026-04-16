import type { OptionPosition } from '../types';

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export function calculatePayoff(pos: OptionPosition, pricePoints: number[]): PayoffPoint[] {
  const size = pos.contractSize;
  const premiumTotal = pos.premium * size;

  return pricePoints.map((price) => {
    let pnl: number;

    if (pos.strategy === 'CSP') {
      if (price >= pos.strikePrice) {
        pnl = premiumTotal;
      } else {
        pnl = premiumTotal - (pos.strikePrice - price) * size;
      }
    } else {
      const stockPnl = (price - pos.currentPrice) * size;
      if (price <= pos.strikePrice) {
        pnl = stockPnl + premiumTotal;
      } else {
        pnl = (pos.strikePrice - pos.currentPrice) * size + premiumTotal;
      }
    }

    return { price, pnl };
  });
}

export function getBreakeven(pos: OptionPosition): number {
  if (pos.strategy === 'CSP') {
    return pos.strikePrice - pos.premium;
  }
  return pos.currentPrice - pos.premium;
}

export function getMaxProfit(pos: OptionPosition): number {
  return pos.premium * pos.contractSize;
}

export function getMaxLoss(pos: OptionPosition): number {
  if (pos.strategy === 'CSP') {
    return (pos.strikePrice - pos.premium) * pos.contractSize;
  }
  return Infinity;
}

/**
 * 1-standard-deviation expected price movement through expiration, in $.
 * Formula: currentPrice × (IV / 100) × sqrt(DTE / 365)
 */
export function calcImpliedMove1SD(pos: OptionPosition): number {
  if (pos.dte <= 0 || pos.iv <= 0 || pos.currentPrice <= 0) return 0;
  const ivDecimal = pos.iv / 100;
  return pos.currentPrice * ivDecimal * Math.sqrt(pos.dte / 365);
}

/**
 * Number of standard deviations the strike is away from current price.
 * Positive when OTM, negative when ITM. Uses 1-SD expected move as the unit.
 */
export function sigmaOTM(pos: OptionPosition): number {
  const move1SD = calcImpliedMove1SD(pos);
  if (move1SD <= 0) return 0;
  const distance = pos.strategy === 'CSP'
    ? pos.currentPrice - pos.strikePrice
    : pos.strikePrice - pos.currentPrice;
  return distance / move1SD;
}

export function generatePriceRange(pos: OptionPosition, steps: number = 200): number[] {
  const center = pos.strategy === 'CSP' ? pos.strikePrice : pos.currentPrice;
  const range = center * 0.35;
  const min = Math.max(0, center - range);
  const max = center + range;
  const step = (max - min) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => min + i * step);
}
