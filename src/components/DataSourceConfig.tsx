import { useState } from 'react';
import { Settings, Eye, EyeOff, ExternalLink } from 'lucide-react';
import type { APIConfig } from '../types';

interface Props {
  config: APIConfig;
  onChange: (config: APIConfig) => void;
}

export default function DataSourceConfig({ config, onChange }: Props) {
  const [showTradier, setShowTradier] = useState(false);
  const [showFinnhub, setShowFinnhub] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [expanded, setExpanded] = useState(!config.tradierToken);

  const inputClass = 'w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Settings className="h-4 w-4" /> Data Source
        </h2>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          {expanded ? 'Hide' : 'Configure'}
        </button>
      </div>

      {!expanded && config.tradierToken && (
        <p className="text-xs text-slate-500 mt-1">Tradier {config.tradierSandbox ? 'Sandbox' : 'Live'} connected</p>
      )}

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Tradier section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400">Tradier API</span>
              <a
                href="https://developer.tradier.com/user/sign_up"
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
                type={showTradier ? 'text' : 'password'}
                placeholder="Enter Tradier API token"
                value={config.tradierToken}
                onChange={(e) => onChange({ ...config, tradierToken: e.target.value })}
              />
              <button
                onClick={() => setShowTradier(!showTradier)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showTradier ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={config.tradierSandbox}
                onChange={(e) => onChange({ ...config, tradierSandbox: e.target.checked })}
                className="accent-emerald-500"
              />
              Use Sandbox (free, delayed data)
            </label>
          </div>

          {/* Finnhub section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-400">Finnhub (Earnings Dates)</span>
              <a
                href="https://finnhub.io/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-slate-500 hover:text-slate-400 flex items-center gap-1"
              >
                Get free key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="relative">
              <input
                className={inputClass}
                type={showFinnhub ? 'text' : 'password'}
                placeholder="Finnhub API key (optional)"
                value={config.finnhubToken}
                onChange={(e) => onChange({ ...config, finnhubToken: e.target.value })}
              />
              <button
                onClick={() => setShowFinnhub(!showFinnhub)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showFinnhub ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600">Optional — populates earnings dates for scoring. Free tier: 60 req/min.</p>
          </div>

          {/* Claude section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-400">Claude API (Idea Generator)</span>
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
                placeholder="Anthropic API key (sk-ant-...)"
                value={config.claudeApiKey}
                onChange={(e) => onChange({ ...config, claudeApiKey: e.target.value })}
              />
              <button
                onClick={() => setShowClaude(!showClaude)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
              >
                {showClaude ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600">Required for AI thesis generation. Uses Claude Sonnet for analysis.</p>
          </div>

          {/* Info */}
          <div className="border-t border-slate-700 pt-3">
            <p className="text-[10px] text-slate-600">
              API keys are stored only in your browser's localStorage and are never sent to any server other than the respective API providers.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
