import { useState, useEffect, useCallback } from 'react';
import type { OptionPosition, ScoringWeights, APIConfig, AppView, InvestmentIdea } from '../types';
import { DEFAULT_WEIGHTS, DEFAULT_API_CONFIG, LS_API_CONFIG, LS_IDEAS } from '../types';
import Header from './Header';
import TickerLookup from './TickerLookup';
import PositionEntry from './PositionEntry';
import CSVImport from './CSVImport';
import WeightSliders from './WeightSliders';
import DataSourceConfig from './DataSourceConfig';
import PositionTable from './PositionTable';
import PayoffDiagram from './PayoffDiagram';
import ScoreBreakdown from './ScoreBreakdown';
import IdeaGenerator from './IdeaGenerator';
import MacroAnalysis from './MacroAnalysis';

const LS_POSITIONS = 'options-screener-positions';
const LS_WEIGHTS = 'options-screener-weights';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

const SAMPLE_POSITIONS: OptionPosition[] = [
  {
    id: crypto.randomUUID(),
    ticker: 'AAPL',
    strategy: 'CSP',
    currentPrice: 198.50,
    strikePrice: 190.00,
    premium: 3.20,
    bid: 3.10,
    ask: 3.30,
    dte: 35,
    expirationDate: '2026-05-22',
    delta: 0.25,
    theta: -0.035,
    vega: 0.18,
    gamma: 0.012,
    iv: 28.5,
    ivRank: 62,
    extrinsicValue: 3.20,
    intrinsicValue: 0,
    volume: 2400,
    openInterest: 8500,
    nextEarningsDate: '2026-07-24',
    contractSize: 100,
  },
  {
    id: crypto.randomUUID(),
    ticker: 'NVDA',
    strategy: 'CSP',
    currentPrice: 135.20,
    strikePrice: 125.00,
    premium: 4.10,
    bid: 4.00,
    ask: 4.20,
    dte: 42,
    expirationDate: '2026-05-29',
    delta: 0.22,
    theta: -0.048,
    vega: 0.22,
    gamma: 0.008,
    iv: 52.0,
    ivRank: 78,
    extrinsicValue: 4.10,
    intrinsicValue: 0,
    volume: 5600,
    openInterest: 15200,
    nextEarningsDate: '2026-05-28',
    contractSize: 100,
  },
  {
    id: crypto.randomUUID(),
    ticker: 'MSFT',
    strategy: 'CC',
    currentPrice: 442.00,
    strikePrice: 460.00,
    premium: 5.80,
    bid: 5.70,
    ask: 5.90,
    dte: 30,
    expirationDate: '2026-05-15',
    delta: 0.30,
    theta: -0.062,
    vega: 0.35,
    gamma: 0.009,
    iv: 24.0,
    ivRank: 45,
    extrinsicValue: 5.80,
    intrinsicValue: 0,
    volume: 1800,
    openInterest: 6200,
    nextEarningsDate: '2026-07-22',
    contractSize: 100,
  },
  {
    id: crypto.randomUUID(),
    ticker: 'AMZN',
    strategy: 'CSP',
    currentPrice: 205.40,
    strikePrice: 195.00,
    premium: 3.90,
    bid: 3.80,
    ask: 4.00,
    dte: 28,
    expirationDate: '2026-05-15',
    delta: 0.28,
    theta: -0.055,
    vega: 0.19,
    gamma: 0.011,
    iv: 34.2,
    ivRank: 55,
    extrinsicValue: 3.90,
    intrinsicValue: 0,
    volume: 3200,
    openInterest: 9800,
    nextEarningsDate: '2026-07-31',
    contractSize: 100,
  },
];

export default function Dashboard() {
  const [activeView, setActiveView] = useState<AppView>('screener');
  const [positions, setPositions] = useState<OptionPosition[]>(() =>
    loadFromStorage(LS_POSITIONS, SAMPLE_POSITIONS)
  );
  const [weights, setWeights] = useState<ScoringWeights>(() =>
    loadFromStorage(LS_WEIGHTS, DEFAULT_WEIGHTS)
  );
  const [apiConfig, setApiConfig] = useState<APIConfig>(() =>
    loadFromStorage(LS_API_CONFIG, DEFAULT_API_CONFIG)
  );
  const [ideas, setIdeas] = useState<InvestmentIdea[]>(() =>
    loadFromStorage(LS_IDEAS, [])
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(positions.map(p => p.id)));

  useEffect(() => {
    localStorage.setItem(LS_POSITIONS, JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    localStorage.setItem(LS_WEIGHTS, JSON.stringify(weights));
  }, [weights]);

  useEffect(() => {
    localStorage.setItem(LS_API_CONFIG, JSON.stringify(apiConfig));
  }, [apiConfig]);

  useEffect(() => {
    localStorage.setItem(LS_IDEAS, JSON.stringify(ideas));
  }, [ideas]);

  const addPosition = useCallback((pos: OptionPosition) => {
    setPositions((prev) => [...prev, pos]);
    setSelectedIds((prev) => new Set([...prev, pos.id]));
  }, []);

  const importPositions = useCallback((newPositions: OptionPosition[]) => {
    setPositions((prev) => [...prev, ...newPositions]);
    setSelectedIds((prev) => new Set([...prev, ...newPositions.map(p => p.id)]));
  }, []);

  const removePosition = useCallback((id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addFromIdeas = useCallback((newPositions: OptionPosition[]) => {
    importPositions(newPositions);
    setActiveView('screener');
  }, [importPositions]);

  const selectedPositions = positions.filter((p) => selectedIds.has(p.id));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <Header activeView={activeView} onViewChange={setActiveView} />
      <div className="mx-auto max-w-[1400px] p-4 space-y-4">
        {activeView === 'screener' ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4 min-w-0">
                <TickerLookup apiConfig={apiConfig} onImport={importPositions} />
                <PositionEntry onAdd={addPosition} />
                <CSVImport onImport={importPositions} />
                <PositionTable
                  positions={positions}
                  weights={weights}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onRemove={removePosition}
                />
              </div>
              <div className="space-y-4">
                <DataSourceConfig config={apiConfig} onChange={setApiConfig} />
                <WeightSliders weights={weights} onChange={setWeights} />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <PayoffDiagram positions={selectedPositions} />
              <ScoreBreakdown positions={selectedPositions} weights={weights} />
            </div>
          </>
        ) : activeView === 'ideas' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <IdeaGenerator
                apiConfig={apiConfig}
                weights={weights}
                ideas={ideas}
                onIdeasChange={setIdeas}
                onAddToScreener={addFromIdeas}
              />
            </div>
            <div className="space-y-4">
              <DataSourceConfig config={apiConfig} onChange={setApiConfig} />
              <WeightSliders weights={weights} onChange={setWeights} />
            </div>
          </div>
        ) : (
          <MacroAnalysis />
        )}
      </div>
    </div>
  );
}
