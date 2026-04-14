import { useState } from 'react';
import { Sparkles, Eye, EyeOff, ExternalLink } from 'lucide-react';
import type { APIConfig } from '../types';

interface Props {
  config: APIConfig;
  onChange: (config: APIConfig) => void;
}

export default function DataSourceConfig({ config, onChange }: Props) {
  const [showKey, setShowKey] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const inputClass = 'w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" /> AI Settings
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
          {(config.claudeApiKey || '').length > 0
            ? 'Claude AI connected — AI-powered theses enabled'
            : 'Using algorithmic analysis (no API key needed)'}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-3">
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
                type={showKey ? 'text' : 'password'}
                placeholder="sk-ant-... (optional)"
                value={config.claudeApiKey || ''}
                onChange={(e) => onChange({ ...config, claudeApiKey: e.target.value })}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600">
              Optional — enables AI-powered investment theses in the Idea Generator. Without it, the app uses algorithmic analysis with full score traceability.
            </p>
          </div>

          <div className="rounded bg-slate-900/50 border border-slate-700 p-3">
            <p className="text-[10px] text-slate-500">
              <strong className="text-slate-400">Data source:</strong> Yahoo Finance (free, no API key required). Greeks computed via Black-Scholes. Earnings dates from Yahoo quote data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
