# Senior Trader Review — Options Screener

_Perspective: a portfolio manager selling $500K–$5M notional in CSPs and covered calls monthly across a liquid equity universe._

---

## 1. Executive Summary

The app has a **strong foundation** — the scoring engine is traceable, the MarketData.app integration returns real Greeks, caching is well thought out, and the three-view layout (Screener / Idea Generator / Macro) mirrors how a real desk is organized. Where it falls short is **depth of information per position**: it fetches full Greeks (delta/gamma/theta/vega) but stores only delta, it computes capital at risk but never displays it in dollars, it generates theses without benchmarking against the ticker's own history, and the macro dashboard shows point-in-time values with no historical context. The single biggest gap is that **none of the Greeks except delta survive the adapter step** — a senior trader's primary decision variables (theta $/day, vega exposure, gamma risk) are thrown away despite being freely available.

---

## 2. High-Impact Gaps

### 2.1 Theta ($/day) and Vega displayed per position — **INFO GAIN: 10/10**
- **What's missing**: `MDOption` (src/services/marketdata.ts lines 114-117) includes `theta`, `gamma`, `vega`. `mdOptionToPosition` (src/services/adapter.ts lines 4-30) maps only delta. `OptionPosition` in `src/types.ts` has no fields for them.
- **Why it matters**: A premium seller's P&L attribution is almost entirely theta (wins) minus vega shock (losses) minus delta movement. Without theta in dollars/day shown on every row, the user can't answer "how much will I make tomorrow if nothing moves?" Without vega, they can't size a position against a 2-point VIX spike.
- **Feasibility**: Free. The data is already fetched and cached. We literally throw it away in the adapter.
- **Sketch**:
  - Add `theta`, `vega`, `gamma` to `OptionPosition`
  - Populate them in `mdOptionToPosition`
  - Add columns "Theta $/day" (theta × contractSize) and "Vega" to PositionTable and the Idea Generator tables
  - Add an aggregate "portfolio Greeks" strip at the top of the Screener showing sum of theta, vega, delta across all displayed positions

### 2.2 Implied Move / 1-SD Expected Range — **INFO GAIN: 9/10**
- **What's missing**: Nowhere in `src/services/thesisTemplates.ts`, `src/services/macroSignals.ts`, or any display component is implied move computed or shown.
- **Why it matters**: The single most useful number for a premium seller: "the market expects this stock to move ±$X by expiration at 1 standard deviation." "Strike 7.2% OTM" is meaningless without this context — for SPY 7% OTM at 35 DTE with VIX 18 is deep OTM, but for TSLA with IV 55 the same 7% is *inside* 1-SD.
- **Feasibility**: Free. Formula: `1SD = currentPrice × IV × sqrt(DTE/365)`. IV comes from the chain's ATM option or from the position's `iv` field.
- **Sketch**:
  - Add `calcImpliedMove(position)` helper in `src/utils/payoff.ts` or similar
  - Display in PositionTable as "Expected Move" column (e.g., "±$12.40 (5.0%)")
  - In IdeaCard expanded view, show "Strike is 1.3σ OTM" as derived metric
  - In MacroAnalysis, show SPX weekly and monthly implied moves from SPY IV — a landmark number for market context

### 2.3 Historical context for macro signals (sparklines) — **INFO GAIN: 9/10**
- **What's missing**: `MacroAnalysis.tsx` shows current values only. No sparklines despite `macro.ts` already fetching 251 bars of daily history for every metric (we use it for 52-week range computation but throw the series away).
- **Why it matters**: VIX 18.2 means nothing without context. "Is it rising from 15 last week, or falling from 24 two weeks ago?" The difference signals opposite regimes. Same for composite score — today's 54 is "improving" if last week was 42, or "deteriorating" if it was 68.
- **Feasibility**: Free. The `history` array is already in every `VolIndex` (macro.ts line 22). Just don't discard it — and add a tiny `<canvas>` sparkline renderer.
- **Sketch**:
  - Keep the `history` field on VolIndex after snapshot save
  - Build a `<Sparkline values={...} width={80} height={24} />` primitive using canvas (no new library)
  - Add next to every VIX/VIX3M/VVIX/SKEW row, every index row, and the composite score
  - Store last 30 days of daily composite scores in localStorage to show the composite trajectory itself

### 2.4 Benchmark IV rank against the ticker's own history — **INFO GAIN: 8/10**
- **What's missing**: `ivRankObs` (src/services/thesisTemplates.ts lines 56-64) and `scoreIvRank` (src/scoring/engine.ts lines 33-36) treat IV rank as an absolute number. "AAPL at IVR 65" is compared to the same scale as "TSLA at IVR 65" — but AAPL's baseline IV is ~25, TSLA's is ~55. 65 IVR means very different things.
- **Why it matters**: Elevated IVR on a normally-quiet stock is a much stronger sell signal than elevated IVR on an already-volatile one. The thesis engine never makes this distinction.
- **Feasibility**: Free. IV rank already uses the chain's IV distribution (`src/services/ivRank.ts`). We'd add percentile context: "IVR 65, baseline IV 28%, currently 34% — 6 vol points above normal."
- **Sketch**:
  - Store the ATM IV at scan time alongside the IV rank in `ivRank.ts` cache
  - Pass both to `thesisTemplates.ts`
  - Update `ivRankObs` to include "baseline IV X%, current Y% (+Z pts)"

### 2.5 Portfolio-level diversification / concentration — **INFO GAIN: 8/10**
- **What's missing**: `scanner.ts` line 187 caps at 2 candidates per ticker, but there's no sector or correlation check. Top 15 could be 4 mega-cap tech + 3 semis + 2 regional banks, all dominated by rates/AI narratives.
- **Why it matters**: A "diversified" basket of 15 ideas that all correlate 0.8+ to QQQ isn't diversified. A senior trader adjusts position sizing by cluster, not by individual ticker count.
- **Feasibility**: Free. Each ticker maps to a sector ETF (we already track XLF/XLE/XLK/etc.). Add a sector map for the 51 defaults.
- **Sketch**:
  - Add `getSectorForTicker(ticker)` helper (hardcoded mapping for the 51 defaults, "Other" for custom)
  - In scanner, enforce a cap: max 3 ideas per sector in the final top 15
  - In IdeaGenerator UI, show a small sector-allocation bar above the top-15 table

### 2.6 Expected Move vs. OTM Distance (sigma-aware filtering) — **INFO GAIN: 7/10**
- **What's missing**: `scanFilter.minOTMPct` and `maxOTMPct` are absolute percentages. A 10% OTM put is "safe" on SPY and "barely OTM" on TSLA. `filterMDChain` (adapter.ts) applies the same % filter to both.
- **Why it matters**: Normalizes risk across tickers. A professional would filter "strikes beyond 1σ OTM" not "strikes beyond 5% OTM."
- **Feasibility**: Free. Compute per-strike sigma distance: `sigma = (strike - spot) / (spot × iv × sqrt(dte/365))`.
- **Sketch**:
  - Add optional `minSigmaOTM` field to `ScanFilter`
  - Apply in `filterMDChain` as secondary filter alongside `minOTMPct`
  - Display sigma distance in PositionTable as "σ" column (e.g., "1.4σ")

### 2.7 Capital at Risk and Dollar P&L on every row — **INFO GAIN: 7/10**
- **What's missing**: `PositionTable.tsx` shows Premium ($3.20) and Max Profit ($320) but never shows **capital deployed** in dollars. The user has to mentally multiply strike × 100 for every row.
- **Why it matters**: Position sizing is the first thing a risk manager looks at. "This is a $19,000 CSP" vs "this is a $46,000 CSP" changes ordering completely.
- **Feasibility**: Trivial. Already computed in `calcAnnualizedYield`.
- **Sketch**:
  - Add "Capital" column between Strike and Premium in PositionTable
  - CSP: `strike × 100`, CC: `currentPrice × 100`
  - Same for the Idea Generator tables

### 2.8 Better earnings treatment — **INFO GAIN: 6/10**
- **What's missing**: `scoreEarningsProximity` (engine.ts lines 76-87) monotonically penalizes earnings-inside-window and rewards no-earnings. But earnings BEFORE expiration with expected IV crush is a classic and desirable premium-seller setup when you want to exploit the vol drop.
- **Why it matters**: The scoring forces the user to avoid a strategy that many professionals actively pursue.
- **Feasibility**: Free. Already know earnings date + DTE.
- **Sketch**:
  - Add a "Trade Earnings" scan filter toggle — when on, INVERT the earnings score (closer to earnings = higher score)
  - Or add a second component "IV Crush Opportunity" that scores high when earnings falls within DTE and IV rank is elevated

---

## 3. Data Already Collected But Not Surfaced

| Data | Where Fetched | Where Not Shown | Why Useful |
|------|---------------|-----------------|------------|
| `theta` per contract | `src/services/marketdata.ts:116` | Dropped in `adapter.ts:4-30`, never stored | P&L/day projection, core decision metric |
| `vega` per contract | `marketdata.ts:117` | Same — dropped | Vol-shock sensitivity |
| `gamma` per contract | `marketdata.ts:115` | Same — dropped | Gamma risk near expiration |
| `inTheMoney` flag | `marketdata.ts:120` | Used for filtering but never displayed | Visual badge would help |
| `underlyingPrice` per contract | `marketdata.ts:119` | Dropped | Redundant with quote, but useful for stale-data detection |
| 251-bar history arrays | `macro.ts` builds these for 52w range | Discarded after range computation | Sparklines, regime trajectory |
| Ticker ATM baseline IV | `ivRank.ts` computes to get rank | Only rank escapes, absolute IV lost | Benchmarking across tickers |
| Raw request count | `marketdata.ts:6` | Only shown during scan | Daily budget tracking would let users pace |
| Yahoo chart full response | `macro.ts` fetches but uses ~5 fields | `regularMarketVolume` ignored | Volume divergence signal |

---

## 4. Scoring and Signal Critique

### 4.1 Linear scaling is too coarse
`linearScale` (engine.ts lines 7-10) is used for yield, delta, IVR, liquidity, theta efficiency, and OTM distance. In practice these relationships are non-linear:
- **Yield 0→50% mapped linearly**: a move from 10% to 20% should be bigger than 40% to 50%. Diminishing returns on yield is real — 50% annualized almost always signals an undesirable setup (assignment certainty) but the engine rewards it.
- **IV Rank passthrough**: linear 0-100 mapping treats IVR 90 as "stronger" than IVR 70, but empirically IVR >80 often means "already-elevated, about to mean-revert lower" which is NOT optimal entry timing.

### 4.2 Earnings scoring is one-sided
`scoreEarningsProximity` (engine.ts lines 76-87) scores earnings-after-DTE at **100** and earnings-within-DTE closer to earnings as **lower** (via `linearScale(daysUntilEarnings, 0, 30)`). But the IV crush post-earnings can be the *best* premium-selling setup when intentionally selected. The engine has no way to say "I want this earnings exposure."

### 4.3 VIX rank signal is monotonic
`vixRankSignal` in `macroSignals.ts` lines 33-50 rewards higher VIX rank linearly. But VIX rank >90 usually means the market is in crisis — sellers should *not* lean in, they should reduce. A professional signal would have a bell curve: low rank = premium is compressed, mid = good, extreme high = crisis (bad).

### 4.4 SKEW thresholds encoded but never reach 100
`skewSignal` (macroSignals.ts lines 74-96) max score is 75 (line 81). A signal that can never be "strong" is oddly calibrated — either it should be excluded from the composite or the rubric should allow 100.

### 4.5 Sector breadth ignores magnitude
`breadthSignal` (macroSignals.ts lines 157-172) uses count only. "7 of 11 positive" with all near-zero is a very different tape from "7 strong winners, 4 big losers" (which is risk-on dispersion). A trader cares about both breadth and magnitude.

### 4.6 Weights don't regime-shift
`DEFAULT_WEIGHTS` and `WEIGHT_PRESETS` in `types.ts` are static. In a quiet low-vol regime yield matters more; in a stressed regime delta and OTM distance should dominate. The "Balanced / Premium Heavy / Safety Heavy" presets force the user to regime-switch manually.

### 4.7 No correlation adjustment across the composite score's own inputs
Yield and IVR are correlated (high IVR → elevated premium → higher yield). The composite counts them as 25% + 15% = 40% of the score, but they're moving together — effectively a single signal double-counted.

---

## 5. Visualization Improvements

### 5.1 Sector breadth as a heatmap, not a list
Current: 11 slate-gray tiles showing "XLF +2.1%". Better: 2×6 heatmap with green→red color gradient by return, plus a mini bar underneath each showing 20-day return trajectory. Immediately scannable for "where's the rotation happening."

### 5.2 VIX term structure as a line chart
Today: VIX + VIX3M shown as two numbers with a "contango/backwardation" label. Better: 4-point curve (VIX9D / VIX / VIX3M / VIX6M if available; else 3-point) drawn with two overlaid lines — today's curve and last week's — so the user sees curve shape AND curve change.

### 5.3 Composite score historical trajectory
Store the last 30 daily composite scores in localStorage (one append per tab mount per day). Display as a mini area chart above the big score number: "today 54 • ▁▂▃▅▇▇▆▅▄▃ • last 30d." User instantly knows if this is a local peak, trough, or middle.

### 5.4 Per-position "distance to assignment" curve
In IdeaCard expanded view, instead of (or alongside) the payoff-at-expiration diagram, show the underlying's 60-day price path with a horizontal line at the strike. If the price has come within 2% of the strike at any point in the last 60 days, the position is flagged "grazed strike." This is the kind of context a trader needs — "is this ticker routinely tests this level?"

### 5.5 Color-coded cell backgrounds in all tables
Score gets scoreColor/scoreBgColor treatment — extend to:
- Yield column: green if >25%, red if <10%
- Delta column: green if <0.20, red if >0.35
- IVR column: green if 40-80, yellow if 20-40 or 80+, red if <20 or >90
- Spread: red cell if >5% bid-ask spread
This converts scanning from "read each number" to "pattern-match colors."

### 5.6 Claude memo should know the portfolio
`generateTheses` in `claude.ts` feeds candidates to Claude with no context about what's already in the user's Screener. Passing the existing positions in the system prompt would let Claude say "you already have 3 tech CSPs; avoid adding NVDA" — concretely actionable.

### 5.7 IV surface visualization
The free chain data includes IV for every strike. For any ticker, plot a mini IV curve (strike vs IV) in the IdeaCard to show smile skew — a trader reads this to decide CSP vs. CC bias (a heavy put-side skew means puts are expensive, calls are cheap = sell calls).

---

## 6. Low-Risk Cleanups

1. **Display capital at risk in $**: add `formatCurrency(strike × 100)` column to PositionTable and IdeaGenerator tables — trivial. (S, 15 min)
2. **Show theta $/day**: after adding theta to OptionPosition, display `theta × 100` in existing tables. (S, 30 min once the type field is added)
3. **Fix SKEW signal ceiling**: in `macroSignals.ts` line 81, change max score from 75 to 100 so the signal can actually be "strong." (S, 5 min)
4. **Add "5D change" to macro metric cards**: VIX 18.2 with no context is dead data. Compute from the `history` array (which we already have). (S, 20 min)
5. **Reorder PositionTable columns**: put Score, Ticker, Type, Capital, Premium, Yield — current order buries Strike ahead of Premium. Move Delta/P(Safe) next to each other visually so the user sees the "probability" pair. (S, 10 min)
6. **Tooltip on IVR values**: native `title=` attribute on every IVR display explaining "IV Rank: current IV percentile within the last year's range for this ticker." (S, 10 min)
7. **Tell the truth about P(Safe)**: currently labeled "Probability option expires OTM (not assigned)" but it's actually `1 - |delta|`, which is a Black-Scholes approximation, not true probability. Add a `*` and footnote once. (S, 5 min)
8. **In the Claude prompt, include the full score breakdown — not just summary numbers.** The prompt today says "Annualized Yield 85/100 (wt 25)" but Claude would do better analysis with the raw `28% annualized on $19,000 capital`. (S, 15 min)
9. **Show data freshness on Macro tab**: each card should have its own "as of" timestamp since different metrics have different TTLs. (S, 20 min)
10. **Idea Generator: empty state for CSP/CC tables**: when one strategy has no candidates, the table is hidden but there's no message explaining why. Add "No CSP candidates passed filters" hint. (S, 10 min)

---

## 7. Explicit Non-Recommendations

- **Live brokerage sync (Schwab/Fidelity OAuth)** — violates the no-server architecture, requires hosted callback URLs. Out of scope.
- **Historical backtesting** — would need 1+ year of daily option chain snapshots per ticker. MarketData.app has this but it's expensive, and storing it client-side is impractical.
- **Real-time streaming quotes** — single-user app, not a trading terminal. Snapshot-on-demand is correct for this use case.
- **Order entry / broker API execution** — not the app's purpose; user explicitly left this out.
- **Machine-learning enhanced scoring** — the linear scoring is actually a feature (traceable). A ML blackbox would hurt the "I can see why this scored 72" value prop.
- **Multi-leg strategies (spreads, strangles, iron condors)** — the app is explicitly scoped to CSP and CC. Adding spreads bifurcates the scoring engine.
- **Options chain scraping for non-listed products (futures options, crypto)** — scope creep.

---

## 8. Recommended Next PRs

### PR #1: Persist all Greeks on OptionPosition and display them (S/M — 45 min)
**Description**: Add `theta`, `gamma`, `vega`, `extrinsicValue` to OptionPosition. Populate in `mdOptionToPosition`. Compute `extrinsicValue = premium - max(0, strike - currentPrice)` for puts, `premium - max(0, currentPrice - strike)` for calls. Add "Θ/day" (theta × contract size, displayed in $) and "Vega" columns to PositionTable and IdeaGenerator tables. Add to the IdeaCard Quick Metrics grid.

**Files touched**: `src/types.ts`, `src/services/adapter.ts`, `src/components/PositionTable.tsx`, `src/components/IdeaCard.tsx`, `src/components/IdeaGenerator.tsx`, `src/components/CSVImport.tsx`, `src/services/thesisTemplates.ts` (reference theta in thesis), `src/components/Dashboard.tsx` (sample positions).

### PR #2: Add implied move / expected range everywhere (M — 1 hr)
**Description**: Add `calcImpliedMove1SD(position)` helper returning dollars. Add "Expected Move" column to PositionTable and Idea Generator tables (formatted as `±$12.40`). Add "Strike is 1.3σ OTM" derivation to IdeaCard expanded view and thesis template rationale. Add SPY weekly and monthly implied move tiles to the Macro Analysis tab.

**Files touched**: `src/utils/payoff.ts` (new helper), `src/components/PositionTable.tsx`, `src/components/IdeaCard.tsx`, `src/components/IdeaGenerator.tsx`, `src/services/thesisTemplates.ts`, `src/components/MacroAnalysis.tsx`.

### PR #3: Sparklines on Macro Analysis (M — 1 hr)
**Description**: Build a small `<Sparkline>` canvas primitive (vanilla canvas, no chart lib). Preserve the `history` arrays in `VolIndex` after serialization. Add sparklines next to VIX / VIX3M / VVIX / SKEW / SPX / NDX / RUT rows. Add a 30-day composite score sparkline above the main score number (store scores daily in a new localStorage array `macro-composite-history`).

**Files touched**: `src/components/Sparkline.tsx` (new), `src/services/macro.ts` (keep history), `src/components/MacroAnalysis.tsx`, `src/types.ts` (optional composite history type).

### PR #4: Color-coded cells everywhere (S — 30 min)
**Description**: Extend `scoreColor` / `scoreBgColor` family with `yieldColor`, `deltaColor`, `ivrColor`, `spreadColor`. Apply to every table cell across PositionTable, IdeaGenerator (IdeaCard), and the macro signal rows. Turns scanning into pattern-matching.

**Files touched**: `src/utils/formatting.ts`, `src/components/PositionTable.tsx`, `src/components/IdeaCard.tsx`.

### PR #5: IV rank benchmarked against ticker's own history (M — 45 min)
**Description**: Cache not just `ivRank` but also `atmIV` and `medianIV` per ticker. Update `ivRankObs` in `thesisTemplates.ts` to include baseline context: "IV rank 65 — current IV 34%, baseline 28%, 6 vol points elevated." Add a small "IVR vs. ticker baseline" pill to the IdeaCard summary row.

**Files touched**: `src/services/ivRank.ts`, `src/services/thesisTemplates.ts`, `src/components/IdeaCard.tsx`.

---

_End of review._
