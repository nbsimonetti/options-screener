import { TrendingUp } from 'lucide-react';

export default function Header() {
  return (
    <header className="border-b border-slate-700 bg-slate-900 px-6 py-4">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-7 w-7 text-emerald-400" />
        <div>
          <h1 className="text-xl font-bold text-white">Options Screener</h1>
          <p className="text-sm text-slate-400">CSP &amp; Covered Call Analyzer</p>
        </div>
      </div>
    </header>
  );
}
