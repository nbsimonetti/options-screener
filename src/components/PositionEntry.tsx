import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { OptionPosition, StrategyType } from '../types';
import { createEmptyPosition } from '../types';

interface Props {
  onAdd: (pos: OptionPosition) => void;
}

export default function PositionEntry({ onAdd }: Props) {
  const [pos, setPos] = useState<OptionPosition>(createEmptyPosition());

  const update = <K extends keyof OptionPosition>(key: K, value: OptionPosition[K]) => {
    setPos((p) => ({ ...p, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pos.ticker || pos.strikePrice <= 0 || pos.premium <= 0) return;
    onAdd({ ...pos, id: crypto.randomUUID() });
    setPos(createEmptyPosition());
  };

  const inputClass =
    'w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const labelClass = 'block text-xs font-medium text-slate-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Add Position</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <div>
          <label className={labelClass}>Ticker</label>
          <input
            className={inputClass}
            placeholder="AAPL"
            value={pos.ticker}
            onChange={(e) => update('ticker', e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <label className={labelClass}>Strategy</label>
          <select
            className={inputClass}
            value={pos.strategy}
            onChange={(e) => update('strategy', e.target.value as StrategyType)}
          >
            <option value="CSP">Cash Secured Put</option>
            <option value="CC">Covered Call</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Current Price</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="175.00"
            value={pos.currentPrice || ''}
            onChange={(e) => update('currentPrice', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Strike Price</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="170.00"
            value={pos.strikePrice || ''}
            onChange={(e) => update('strikePrice', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Premium</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="2.50"
            value={pos.premium || ''}
            onChange={(e) => update('premium', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Bid</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="2.45"
            value={pos.bid || ''}
            onChange={(e) => update('bid', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Ask</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="2.55"
            value={pos.ask || ''}
            onChange={(e) => update('ask', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>DTE</label>
          <input
            className={inputClass}
            type="number"
            placeholder="30"
            value={pos.dte || ''}
            onChange={(e) => update('dte', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Delta</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="0.30"
            value={pos.delta || ''}
            onChange={(e) => update('delta', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Theta</label>
          <input
            className={inputClass}
            type="number"
            step="0.001"
            placeholder="-0.035"
            value={pos.theta || ''}
            onChange={(e) => update('theta', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Vega</label>
          <input
            className={inputClass}
            type="number"
            step="0.01"
            placeholder="0.18"
            value={pos.vega || ''}
            onChange={(e) => update('vega', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Gamma</label>
          <input
            className={inputClass}
            type="number"
            step="0.001"
            placeholder="0.01"
            value={pos.gamma || ''}
            onChange={(e) => update('gamma', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>IV (%)</label>
          <input
            className={inputClass}
            type="number"
            step="0.1"
            placeholder="35.0"
            value={pos.iv || ''}
            onChange={(e) => update('iv', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>IV Rank (0-100)</label>
          <input
            className={inputClass}
            type="number"
            placeholder="65"
            value={pos.ivRank || ''}
            onChange={(e) => update('ivRank', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Volume</label>
          <input
            className={inputClass}
            type="number"
            placeholder="1500"
            value={pos.volume || ''}
            onChange={(e) => update('volume', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Open Interest</label>
          <input
            className={inputClass}
            type="number"
            placeholder="5000"
            value={pos.openInterest || ''}
            onChange={(e) => update('openInterest', +e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Next Earnings</label>
          <input
            className={inputClass}
            type="date"
            value={pos.nextEarningsDate}
            onChange={(e) => update('nextEarningsDate', e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
    </form>
  );
}
