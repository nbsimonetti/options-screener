import { TrendingUp, BarChart3, Sparkles, Gauge } from 'lucide-react';
import type { AppView } from '../types';

interface Props {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
}

export default function Header({ activeView, onViewChange }: Props) {
  const tabClass = (view: AppView) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t transition-colors ${
      activeView === view
        ? 'bg-slate-800 text-white border-b-2 border-emerald-400'
        : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <header className="border-b border-slate-700 bg-slate-900 px-6">
      <div className="flex items-center gap-6 pt-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-7 w-7 text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Options Screener</h1>
            <p className="text-[11px] text-slate-500">CSP &amp; Covered Call Analyzer</p>
          </div>
        </div>

        <nav className="flex items-end gap-1 ml-8 mt-auto">
          <button className={tabClass('screener')} onClick={() => onViewChange('screener')}>
            <BarChart3 className="h-4 w-4" /> Screener
          </button>
          <button className={tabClass('ideas')} onClick={() => onViewChange('ideas')}>
            <Sparkles className="h-4 w-4" /> Idea Generator
          </button>
          <button className={tabClass('macro')} onClick={() => onViewChange('macro')}>
            <Gauge className="h-4 w-4" /> Options Macro Analysis
          </button>
        </nav>
      </div>
    </header>
  );
}
