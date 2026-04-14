import { useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import type { OptionPosition } from '../types';

interface Props {
  onImport: (positions: OptionPosition[]) => void;
}

const COLUMN_MAP: Record<string, keyof OptionPosition> = {
  ticker: 'ticker',
  symbol: 'ticker',
  strategy: 'strategy',
  type: 'strategy',
  'current price': 'currentPrice',
  'stock price': 'currentPrice',
  'underlying': 'currentPrice',
  strike: 'strikePrice',
  'strike price': 'strikePrice',
  premium: 'premium',
  'mid price': 'premium',
  price: 'premium',
  bid: 'bid',
  ask: 'ask',
  dte: 'dte',
  'days to expiration': 'dte',
  delta: 'delta',
  iv: 'iv',
  'implied volatility': 'iv',
  'iv rank': 'ivRank',
  'ivr': 'ivRank',
  volume: 'volume',
  vol: 'volume',
  'open interest': 'openInterest',
  oi: 'openInterest',
  'earnings': 'nextEarningsDate',
  'next earnings': 'nextEarningsDate',
  'expiration': 'expirationDate',
  'expiry': 'expirationDate',
  'exp date': 'expirationDate',
  'expiration date': 'expirationDate',
};

function parseCSV(text: string): OptionPosition[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
  const mapping: (keyof OptionPosition | null)[] = headers.map((h) => COLUMN_MAP[h] ?? null);

  const positions: OptionPosition[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/['"]/g, ''));
    const pos: Record<string, unknown> = {
      id: crypto.randomUUID(),
      ticker: '',
      strategy: 'CSP',
      currentPrice: 0,
      strikePrice: 0,
      premium: 0,
      bid: 0,
      ask: 0,
      dte: 30,
      expirationDate: '',
      delta: 0.3,
      iv: 0,
      ivRank: 50,
      volume: 0,
      openInterest: 0,
      nextEarningsDate: '',
      contractSize: 100,
    };

    mapping.forEach((key, idx) => {
      if (!key || !values[idx]) return;
      const val = values[idx];
      if (key === 'ticker' || key === 'nextEarningsDate' || key === 'expirationDate') {
        pos[key] = val;
      } else if (key === 'strategy') {
        pos[key] = val.toUpperCase().includes('CALL') || val.toUpperCase() === 'CC' ? 'CC' : 'CSP';
      } else {
        pos[key] = parseFloat(val) || 0;
      }
    });

    if ((pos.ticker as string) && (pos.strikePrice as number) > 0) {
      positions.push(pos as unknown as OptionPosition);
    }
  }
  return positions;
}

export default function CSVImport({ onImport }: Props) {
  const [csvText, setCsvText] = useState('');
  const [showArea, setShowArea] = useState(false);

  const handleImport = () => {
    const positions = parseCSV(csvText);
    if (positions.length > 0) {
      onImport(positions);
      setCsvText('');
      setShowArea(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText className="h-4 w-4" /> CSV Import
        </h2>
        <button
          onClick={() => setShowArea(!showArea)}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          {showArea ? 'Hide' : 'Show'}
        </button>
      </div>
      {showArea && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-400">
            Paste CSV data or upload a file. Columns: ticker, strategy, strike, premium, current price, bid, ask, dte, delta, iv, iv rank, volume, open interest, earnings
          </p>
          <textarea
            className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:border-emerald-500 focus:outline-none h-28 resize-y"
            placeholder="ticker,strategy,current price,strike,premium,bid,ask,dte,delta,iv,iv rank,volume,oi&#10;AAPL,CSP,175.00,170.00,2.50,2.45,2.55,30,0.25,32.5,65,1500,5000"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <div className="flex gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-600 transition-colors">
              <Upload className="h-3 w-3" /> Upload CSV
              <input type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
            </label>
            <button
              onClick={handleImport}
              className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
