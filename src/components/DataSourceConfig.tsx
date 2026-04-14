import { useState } from 'react';
import { Settings, Eye, EyeOff, ExternalLink } from 'lucide-react';
import type { APIConfig } from '../types';

interface Props {
  config: APIConfig;
  onChange: (config: APIConfig) => void;
}

export default function DataSourceConfig({ config, onChange }: Props) {
  const [showMD, setShowMD] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [expanded, setExpanded] = useState(!(config.marketDataToken || ''));

  const inputClass = 'w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Settings className="h-4 w-4" /> Settings
        </h2>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          {expanded ? 'Hide' : 'Configure'}
        </button>
      </div>

      {!expanded && (
        <p className="text-xs text-slate-500 mt-1">
          {(config.marketDataToken || '').length > 0 ? 'Market Data connected (all tickers)' : 'Demo mode (AAPL only)'}
          {(config.claudeApiKey || '').length > 0 ? ' · AI theses on' : ''}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Market Data section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400">Market Data Token</span>
              <a
                href="https://www.marketdata.app/apis"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-slate-500 hover:text-slate-400 flex items-center gap-1"
              >
                Get free token <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="relative">
              <input
                className={inputClass}
                type={showMD ? 'text' : 'password'}
                placeholder="Free token (optional — unlocks all tickers)"
                value={config.marketDataToken || ''}
                onChange={(e) => onChange({ ...config, marketDataToken: e.target.value })}
              />
              <button
                onClick={() => setShowMD(!showMD)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showMD ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600">
              Free signup, no credit card. Without a token, only AAPL works as a demo. With a token, all tickers are available (100 req/day free).
            </p>
          </div>

          {/* Claude section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-400">Claude API Key (Optional)</span>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-slate-500 hover:text-slate-400 flex items-center gap-1"
              >
                Get API key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="relative">
              <input
                className={inputClass}
                type={showClaude ? 'text' : 'password'}
                placeholder="sk-ant-... (optional)"
                value={config.claudeApiKey || ''}
                onChange={(e) => onChange({ ...config, claudeApiKey: e.target.value })}
              />
              <button
                onClick={() => setShowClaude(!showClaude)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showClaude ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600">
              Optional — enables AI-powered theses. Without it, uses algorithmic analysis with full score traceability.
            </p>
          </div>

          <div className="border-t border-slate-700 pt-3">
            <p className="text-[10px] text-slate-600">
              Keys stored in browser localStorage only. Options data includes real-time Greeks (delta, gamma, theta, vega) and IV from Market Data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
