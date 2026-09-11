# Phase 0 — Tool Evaluation & Improvement Backlog

_Date: 2026-09-11. Produced as the first phase of the Long Strategy / Paper Trades / API Budget build._

## 1. Architecture map

- **Views**: `AppView = 'screener' | 'ideas' | 'macro'` ([types.ts](../src/types.ts)), tabs in [Header.tsx](../src/components/Header.tsx), routed in [Dashboard.tsx](../src/components/Dashboard.tsx). Adding views is a 3-file change.
- **Income pipeline**: [IdeaGenerator.tsx](../src/components/IdeaGenerator.tsx) → [scanner.ts](../src/services/scanner.ts) (quote → expirations → per-expiration put+call chains, `strikeLimit: 20`) → [adapter.ts](../src/services/adapter.ts) filter/convert → [engine.ts](../src/scoring/engine.ts) 7-factor weighted score → [thesisTemplates.ts](../src/services/thesisTemplates.ts) or [claude.ts](../src/services/claude.ts) theses → three tables (top 15, best CSP/ticker, best CC/ticker).
- **Data layer**: [marketdata.ts](../src/services/marketdata.ts) with localStorage cache ([marketdataCache.ts](../src/services/marketdataCache.ts)): quotes 15 min, expirations 1 day, chains 1 hour, LRU cap 100 chains. Session-scoped request counter + `enforceBudget`.
- **Free underlying history**: the Vite dev proxy exposes Yahoo Finance (`/api/yahoo/v8/finance/chart/`) — [macro.ts](../src/services/macro.ts) already pulls 251-bar daily history for indices. **This is the seam for long-strategy momentum factors at zero MarketData credit cost** (dev mode; GitHub Pages uses a CI-built static snapshot for macro only).

### Reusable as-is for the long strategy
`getQuote` / `getExpirations` / `getOptionChain` + cache; `pickExpirations`; `Sparkline`; `formatting.ts`; `calcImpliedMove1SD` / `sigmaOTM`; the `ScoreBreakdownItem`/`PositionScore` shape and `WeightSliders` pattern; the IdeaTable/IdeaCard table pattern.

### Needs a parallel variant (not a fork)
- `OptionPosition` is short-premium-shaped (`strategy: 'CSP' | 'CC'`, `premium`, capital-at-risk math). Long ideas need `'LC' | 'LP'` strategy values, **signed** delta, and debit/max-loss/breakeven semantics.
- `engine.ts` scoring functions are seller-centric (low delta good, high IVR good, yield). Long mode needs its own factor set; keep the same breakdown data shape so `ScoreBreakdown`/cards render both.
- `scanner.ts` is CSP/CC-specific; a `scanForLongIdeas` sibling should share the data layer and expiration-picking logic.

## 2. Strengths
Traceable scoring with per-factor breakdowns; real Greeks end-to-end (post senior-review PR1/PR2: theta/vega/expected-move/capital columns all present); disciplined caching with cache-aware skip-delay; saved watchlists with explicit-save buffer; macro composite with non-linear signal scoring and stress penalty; graceful `allSettled` chain fetching.

## 3. Improvement backlog

Severity: **C** critical (wrong numbers / broken economics), **H** high, **N** nice-to-have. Effort: S/M/L.

| # | Sev | Effort | Finding |
|---|-----|--------|---------|
| B1 | C | M | **API credit accounting is wrong.** MarketData.app bills **1 credit per option symbol returned** on `options/chain` (verified against docs 2026-09-11), so each chain call with `strikeLimit: 20` costs ~20 credits, not 1. `requestCount` counts HTTP requests; the scanner's `MAX_TOTAL_REQUESTS = 2000` therefore permits ~**37k+ credits** of real spend, while the Settings copy says "100 req/day free." Full default scan (~51 tickers × 3 exp × 2 sides × 20 strikes) ≈ 6,200+ credits — 62× the free daily limit. Fix: count credits (chain cost = rows returned), persist a daily credit ledger, make the daily budget configurable. Feeds Phase 5. |
| B2 | C | S | **Earnings factor is dead.** `scanForIdeas` passes `''` as `earningsDate` to `mdChainToPositions`, so `scoreEarningsProximity` returns 100 for every scanned idea and theses claim "No earnings within the expiration window" as a positive — factually unsupported. Fix: source earnings dates (Yahoo `quoteSummary` via existing proxy) or drop the factor from scan scoring and label theses honestly ("earnings date unknown"). |
| B3 | H | S | **"IV Rank" is not IV rank.** `estimateIVRankFromChain` ranks ATM IV within the *strike-smile* of one expiration (min/max across strikes), i.e., it measures smile shape, not where current IV sits in its 1-year history. It drives 15% of the short score and would corrupt the long strategy's "cheap vol" screen. Fix: build true IV percentile from history — persist a rolling per-ticker daily ATM-IV sample (ledger in localStorage) and meanwhile blend with realized-vol context from Yahoo history; relabel honestly in UI until enough samples accrue. |
| B4 | H | S | **Adapter destroys delta sign** (`Math.abs(opt.delta)`). Harmless for short-side display, fatal for long puts. Keep signed delta on the raw side and expose `absDelta` where the short UI needs it. |
| B5 | H | S | **No persistent daily API usage tracking.** `resetRequestCount()` runs at every scan start; the free/paid plan limits are daily. Add a persisted per-day credit ledger surfaced in Settings. Feeds Phase 5. |
| B6 | H | S | **Budget exhaustion is a hard error.** `BudgetExceededError` stops the scan with an error banner; cached data isn't offered. Degrade to cached-only completion with a visible "served from cache" notice. Feeds Phase 5. |
| B7 | M | S | Yield scoring is linear 0→50% (senior review §4.1): 50% annualized scores best even though it usually signals assignment-certain setups. Apply diminishing-returns curve with soft cap. |
| B8 | M | S | Yield + IVR double-count (review §4.7): correlated inputs worth 40% combined. Mitigate via B7's curve + reweighting guidance; document. |
| B9 | M | M | No sector map / concentration guard (review §2.5). Needed anyway by the Paper Trades agent's risk rules — implement a hardcoded sector map for the 51 defaults, shared by scanner display and portfolio limits. |
| B10 | M | S | No retry/backoff on MarketData 429s; a rate-limited burst just fails that ticker silently. Add single retry with delay on 429. |
| B11 | N | S | `vixRankSignal` still monotonic (review §4.3): extreme VIX rank (>90, crisis) scores ~92 "favorable." The composite stress penalty partially compensates; add a crisis taper. |
| B12 | N | S | Claude thesis model pinned to an older Sonnet id in `claude.ts`; also thesis prompt has no portfolio context (review §5.6). Update model id; pass current positions summary. |
| B13 | N | S | Settings copy inconsistencies: "100 req/day free" vs scanner's 2000; no budget control in UI. Superseded by Phase 5 allocator UI. |
| B14 | N | S | `IdeaGenerator` hardcodes `requestBudget: 2000` in four places; centralize. |

## 4. Research-agent findings merged (Phase 1)
See `LONG_STRATEGY_DESIGN.md` § "Existing strategy changes" — items appended there after the four research briefs landed, with old→new values and justifications.

## 5. Deferred (documented, not implemented)
B11 (crisis taper) and B12 (portfolio-aware theses) unless they fall out of adjacent edits; historical backtesting, brokerage sync, multi-leg strategies remain explicit non-goals per the senior review §7.
