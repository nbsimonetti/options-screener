import type { IdeaThesis, InvestmentIdea } from '../types';
import type { ScanCandidate } from './scanner';
import { calcAnnualizedYield } from '../scoring/engine';
import { getBreakeven } from '../utils/payoff';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: ClaudeMessage[],
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data: ClaudeResponse = await res.json();
  return data.content[0]?.text || '';
}

function formatCandidateForPrompt(c: ScanCandidate, index: number): string {
  const p = c.position;
  const annYield = calcAnnualizedYield(p);
  const breakeven = getBreakeven(p);
  const spreadPct = p.ask > 0 && p.bid > 0 ? ((p.ask - p.bid) / ((p.ask + p.bid) / 2) * 100) : 0;

  const scoreDetails = c.score.breakdown
    .map((b) => `${b.label}: ${b.normalizedScore.toFixed(0)}/100 (wt ${b.weight})`)
    .join(', ');

  return `
#${index + 1}: ${p.ticker} — ${p.strategy === 'CSP' ? 'Cash Secured Put' : 'Covered Call'}
  Strike: $${p.strikePrice} | Current Price: $${p.currentPrice} | Premium: $${p.premium}
  DTE: ${p.dte} days | Delta: ${p.delta.toFixed(2)} | IV: ${p.iv.toFixed(1)}% | IV Rank: ${p.ivRank.toFixed(0)}
  Annualized Yield: ${(annYield * 100).toFixed(1)}% | Breakeven: $${breakeven.toFixed(2)}
  Volume: ${p.volume} | Open Interest: ${p.openInterest} | Bid-Ask Spread: ${spreadPct.toFixed(1)}%
  Earnings: ${p.nextEarningsDate || 'Not within DTE window'}
  Composite Score: ${c.score.compositeScore.toFixed(1)}/100
  Score Breakdown: ${scoreDetails}
`.trim();
}

const SYSTEM_PROMPT = `You are a senior options analyst presenting investment ideas to a portfolio manager. You specialize in selling cash-secured puts and covered calls to generate premium income while minimizing assignment risk.

For each candidate, write a concise investment thesis. Be direct and specific about why THIS strike, THIS expiration, and THIS premium represent attractive risk/reward. Reference the scoring metrics to support your case. Flag specific risks honestly — the PM trusts your judgment but expects you to highlight what could go wrong.

IMPORTANT: Respond ONLY with a valid JSON array. No markdown, no code fences, no explanation outside the JSON. Each element must have this exact structure:
{
  "ticker": "AAPL",
  "strategy": "CSP",
  "strike": 190,
  "summary": "1-2 sentence thesis hook",
  "setup": "Market context and timing rationale (2-3 sentences)",
  "rationale": "Why this specific strike/expiration/premium (2-3 sentences)",
  "keyMetrics": "Highlight the most compelling scoring metrics (1-2 sentences)",
  "risks": ["risk 1", "risk 2", "risk 3"],
  "catalysts": ["catalyst 1", "catalyst 2"],
  "confidence": "high" | "medium" | "low",
  "analystNote": "Additional color or edge explanation (1-2 sentences)"
}`;

export async function generateTheses(
  candidates: ScanCandidate[],
  apiKey: string,
): Promise<InvestmentIdea[]> {
  const candidateText = candidates
    .map((c, i) => formatCandidateForPrompt(c, i))
    .join('\n\n');

  const userMessage = `Here are the top ${candidates.length} candidates from today's options scan. Generate an investment thesis for each one.\n\n${candidateText}`;

  const responseText = await callClaude(apiKey, SYSTEM_PROMPT, [
    { role: 'user', content: userMessage },
  ]);

  // Parse JSON — handle potential markdown fences
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let theses: Array<{
    ticker: string;
    strategy: string;
    strike: number;
    summary: string;
    setup: string;
    rationale: string;
    keyMetrics: string;
    risks: string[];
    catalysts: string[];
    confidence: string;
    analystNote: string;
  }>;

  try {
    theses = JSON.parse(cleaned);
  } catch {
    throw new Error('Failed to parse Claude response as JSON. Response: ' + cleaned.substring(0, 200));
  }

  // Merge theses with candidates
  const now = new Date().toISOString();
  const ideas: InvestmentIdea[] = [];

  for (const candidate of candidates) {
    const p = candidate.position;
    const match = theses.find(
      (t) =>
        t.ticker === p.ticker &&
        t.strategy === p.strategy &&
        Math.abs(t.strike - p.strikePrice) < 0.01,
    );

    const thesis: IdeaThesis = match
      ? {
          summary: match.summary || '',
          setup: match.setup || '',
          rationale: match.rationale || '',
          keyMetrics: match.keyMetrics || '',
          risks: match.risks || [],
          catalysts: match.catalysts || [],
          confidence: (['high', 'medium', 'low'].includes(match.confidence) ? match.confidence : 'medium') as 'high' | 'medium' | 'low',
          analystNote: match.analystNote || '',
        }
      : {
          summary: `${p.ticker} ${p.strategy} at $${p.strikePrice} strike — scored ${candidate.score.compositeScore.toFixed(0)}/100.`,
          setup: 'Thesis generation incomplete for this candidate.',
          rationale: '',
          keyMetrics: '',
          risks: [],
          catalysts: [],
          confidence: 'medium',
          analystNote: '',
        };

    ideas.push({
      id: crypto.randomUUID(),
      position: p,
      score: candidate.score,
      thesis,
      generatedAt: now,
    });
  }

  return ideas;
}
