import { useRef, useEffect, useMemo, useState } from 'react';
import type { OptionPosition } from '../types';
import { calculatePayoff, generatePriceRange, getBreakeven, getMaxProfit } from '../utils/payoff';
import { formatCurrency } from '../utils/formatting';

interface Props {
  positions: OptionPosition[];
}

const COLORS = ['#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24', '#f87171', '#2dd4bf', '#a78bfa'];

export default function PayoffDiagram({ positions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; price: number; pnls: number[] } | null>(null);

  const chartInfo = useMemo(() => {
    if (positions.length === 0) return null;
    const allPriceRanges = positions.map((pos) => generatePriceRange(pos));
    const globalMin = allPriceRanges.reduce((min, r) => Math.min(min, r[0]), Infinity);
    const globalMax = allPriceRanges.reduce((max, r) => Math.max(max, r[r.length - 1]), -Infinity);
    const numPoints = 100;
    const step = (globalMax - globalMin) / numPoints;
    const prices = Array.from({ length: numPoints + 1 }, (_, i) => +(globalMin + i * step).toFixed(2));
    const payoffs = positions.map((pos) => calculatePayoff(pos, prices));
    let minPnl = Infinity, maxPnl = -Infinity;
    for (const series of payoffs) {
      for (const pt of series) {
        if (pt.pnl < minPnl) minPnl = pt.pnl;
        if (pt.pnl > maxPnl) maxPnl = pt.pnl;
      }
    }
    return { prices, payoffs, minPnl, maxPnl, globalMin, globalMax };
  }, [positions]);

  useEffect(() => {
    if (!chartInfo || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = 340;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const pad = { top: 20, right: 20, bottom: 40, left: 70 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const { payoffs, minPnl, maxPnl, globalMin, globalMax } = chartInfo;
    const pnlRange = maxPnl - minPnl || 1;
    const pnlPad = pnlRange * 0.1;
    const yMin = minPnl - pnlPad;
    const yMax = maxPnl + pnlPad;

    const toX = (price: number) => pad.left + ((price - globalMin) / (globalMax - globalMin)) * cw;
    const toY = (pnl: number) => pad.top + ch - ((pnl - yMin) / (yMax - yMin)) * ch;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const yTicks = 6;
    for (let i = 0; i <= yTicks; i++) {
      const val = yMin + (i / yTicks) * (yMax - yMin);
      const y = toY(val);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(formatCurrency(val), pad.left - 8, y + 4);
    }

    const xTicks = 8;
    for (let i = 0; i <= xTicks; i++) {
      const val = globalMin + (i / xTicks) * (globalMax - globalMin);
      const x = toX(val);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + ch);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`$${val.toFixed(0)}`, x, h - pad.bottom + 20);
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      const zeroY = toY(0);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(w - pad.right, zeroY);
      ctx.stroke();
    }

    // Breakeven lines
    positions.forEach((pos, i) => {
      const be = getBreakeven(pos);
      const x = toX(be);
      if (x >= pad.left && x <= w - pad.right) {
        ctx.strokeStyle = COLORS[i % COLORS.length];
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ch);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Payoff lines
    ctx.setLineDash([]);
    payoffs.forEach((payoff, j) => {
      const color = COLORS[j % COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < payoff.length; i++) {
        const x = toX(payoff[i].price);
        const y = toY(payoff[i].pnl);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

  }, [chartInfo, positions]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartInfo || !containerRef.current) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { prices, payoffs } = chartInfo;
    const pad = { left: 70, right: 20 };
    const cw = containerRef.current.clientWidth - pad.left - pad.right;
    const priceFrac = (mx - pad.left) / cw;
    if (priceFrac < 0 || priceFrac > 1) { setTooltip(null); return; }
    const idx = Math.round(priceFrac * (prices.length - 1));
    const price = prices[idx];
    const pnls = payoffs.map(p => p[idx].pnl);
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, price, pnls });
  };

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center text-sm text-slate-500">
        Select positions to compare payoff diagrams.
      </div>
    );
  }

  const breakevenPrices = positions.map(getBreakeven);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="text-sm font-semibold text-white mb-1">Payoff at Expiration</h2>
      <div className="flex flex-wrap gap-4 mb-3 text-[10px] text-slate-400">
        {positions.map((pos, i) => (
          <div key={pos.id} className="flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span style={{ color: COLORS[i % COLORS.length] }} className="font-semibold">
              {pos.ticker} {pos.strategy} ${pos.strikePrice}
            </span>
            <span>BE: {formatCurrency(breakevenPrices[i])}</span>
            <span>Max Profit: {formatCurrency(getMaxProfit(pos))}</span>
          </div>
        ))}
      </div>
      <div ref={containerRef} className="relative">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
          className="w-full cursor-crosshair"
        />
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-xs shadow-lg"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
          >
            <div className="text-slate-400 mb-1">Price: {formatCurrency(tooltip.price)}</div>
            {positions.map((pos, i) => (
              <div key={pos.id} className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="text-slate-300">{pos.ticker}:</span>
                <span className={tooltip.pnls[i] >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {formatCurrency(tooltip.pnls[i])}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
