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

export function generatePriceRange(pos: OptionPosition, steps: number = 200): number[] {
  const center = pos.strategy === 'CSP' ? pos.strikePrice : pos.currentPrice;
  const range = center * 0.35;
  const min = Math.max(0, center - range);
  const max = center + range;
  const step = (max - min) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => min + i * step);
}
