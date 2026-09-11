# Long Strategy Design — Consolidated Research (Phase 1)

_Date: 2026-09-11. Synthesized from four parallel research briefs: (A) directional factors, (B) long-premium screening funnel, (C) mechanical entry/exit/risk rules, (D) sizing & risk-adjusted metrics. This is the implementation spec for the "Idea Generator (Long)" tab and the Paper Trades engine._

## 0. Structural premise

Bought options fight the variance risk premium (IV > subsequent realized vol on average), so the long screener must be **stricter** than the income screener, not a loose mirror. All edge comes from conditioning: buy movement that is underpriced (low IV vs. the stock's own realized behavior), in structures that minimize premium bleed (ITM 0.55–0.75Δ, 60–120 DTE), on underlyings whose directional drift is evidenced (momentum/trend factors), and exit before the steep theta zone (≤21 DTE floor).

## 1. Directional factor composites (Agent A)

Computed from Yahoo daily OHLCV (free via the dev proxy; ~2y of bars). All scores 0–100.

**Bullish (call) composite** — action threshold ≥ 70, watchlist 60–70:

| Factor | Weight | Rule (summary) |
|---|---|---|
| B1 12-1 momentum | 20% | `mom = close[t-21]/close[t-252] − 1`; score = clamp(50 + 100·mom) |
| B2 52w-high proximity | 15% | `phigh = close / max(high,252d)`; score = clamp((phigh−0.70)/0.30·100); new 252d high in last 10 sessions floors at 90 |
| B3 Trend structure | 15% | mean of: alignment (close>SMA50 +50, SMA50>SMA200 +50); slope50 = clamp(50+2000·(ΔSMA50/21d)); smoothness = clamp((pctUpDays126−0.44)/0.14·100) |
| B4 Relative strength | 15% | 63d return vs 0.5·SPY + 0.5·sector ETF; score = clamp(50+250·rs); ×0.7 if 63d and 126d RS disagree in sign |
| B5 Volume confirmation | 10% | 0.6·up/down-volume-ratio-50d score + 0.4·breakout-volume score |
| B6 Gap/PEAD proxy | 10% | gap ≥ +4% on ≥2× vol that held, within 30 sessions; freshness-decayed; else 50 |
| B7 Extension modifier | 5% | 100 when 0.5 ≤ (close−SMA50)/ATR20 ≤ 3.0; penalized outside; 21d return > +25% caps the composite at 70 |
| B8 IV entry quality | 10% | clamp(100 − 1.25·IVR); hard gate: skip if IVR > 65 |

**Bearish (put) composite** — action threshold ≥ 75 (higher on purpose; short-side evidence is weaker):

| Factor | Weight | Rule (summary) |
|---|---|---|
| S1 Trend breakdown | 20% | mirror of B3 with lower-highs check |
| S2 Distance from 52w high | 15% | clamp((0.95−phigh)/0.35·100); fresh 63d low floors 80; capped at 50 if close < $5 or 252d return < −70% (snap-back guard) |
| S3 Relative weakness | 15% | mirror of B4; +10 bonus if sector is up while stock lags by >10% |
| S4 Distribution volume | 15% | mirror of B5 with high-volume-breakdown check |
| S5 Negative-gap PEAD | 15% | gap ≤ −4% on ≥2× vol, unreclaimed (< 50% gap fill after 2–3 sessions) |
| S6 Market regime gate | 10% | 100 if SPY<SMA200 & SMA50 slope<0; 60 if SPY<SMA50; else 30; rebound guard ×0.6 on whole composite |
| S7 IV entry quality | 10% | clamp(100 − 1.5·IVR); hard gate at IVR > 55 |

## 2. Options screening funnel (Agent B)

Applied to factor-qualified candidates, cheapest checks first:

- **Stage 0 underlying floor:** price ≥ $20, 20d avg dollar volume ≥ $25M, HV20 ≥ 15% annualized.
- **Stage 1 vol cheapness:** IV Rank/Percentile ≤ 50 hard (ideal 5–30); IV ÷ max(HV20, HV30) ≤ 1.10 (≤1.25 only if IVR ≤ 20; ideal ≤ 0.90); dead-stock checks: avg |daily return| (20d) ≥ 0.8% and HV20 ≥ 0.75 × HV60.
- **Stage 3 expected-move test:** implied EM = S·IV·√(DTE/365) ÷ median historical |move| over the same horizon ≤ 1.20 (ideal ≤ 0.80), and EM ≤ p75 historical move.
- **Stage 4 liquidity (MID-fill honesty):** spread ≤ 5% of mid ideal, 5–10% pass with penalty, 10–15% only if abs spread ≤ $0.10 or OI ≥ 1,000, > 15% reject; abs spread cap $0.30 (<$5 mid) / $0.50; bid ≥ $0.05; OI ≥ 100 hard (≥ 250 pass-grade, ≥ 1,000 ideal).
- **Stage 5 contract selection:** expiration nearest 90 DTE in [60, 120] (accept 45–150); delta band |Δ| 0.55–0.75, target 0.65 (tiebreak lower spread%, higher OI); fall back to ATM 0.50Δ if band fails liquidity, else reject the underlying; extrinsic ≤ 40% of premium sanity check.
- **Stage 6 flags (warn, don't reject):** IVR > 30 ("debit spread likely better"), event kink (front ATM IV − next ATM IV > 8 vol pts → binary catalyst inside window), EM ratio > 1.0, extrinsic > 60% of premium, debit > 3% of equity. Skew flags (25Δ risk-reversal) deferred — computing them would double chain credit cost; revisit if cached both-side chains are available opportunistically.

## 3. Mechanical rules for the trading engine (Agent C)

Daily-granularity; MID fills; evaluated exits-before-entries every cycle.

**Entry** = R1 ∧ R2 ∧ (R3 ∨ R4 ∨ R5) ∧ R6 ∧ R7:
- R1 gate: composite score ≥ threshold AND trend alignment (calls: close>SMA50 rising; puts mirrored).
- R2 contract: per funnel Stage 4/5; IVR ≤ 50.
- R3 breakout: close > HH20 on ≥1.5× volume, ≤ 1 ATR beyond trigger. R4 pullback: rising SMA20>SMA50, touch within 0.25 ATR of SMA20, close up on the day (mirrored for puts). R5 post-event IV-crush window: front ATM IV drop ≥ 20% day-over-day with a ≥0.75-ATR move; buy days +1..+5 in the move's direction with IVR ≤ 30.
- R6 don't-chase: skip if close > SMA20 + 2.5 ATR (mirrored). R7 freshness: trigger ≤ 2 trading days old.

**Exit priority (first true wins):** R8 backstop mark ≤ 40% of entry mid (−60%) → R9 target mark ≥ 2× entry (sell half if ≥2 contracts, then trail 2-ATR on closes; close all if 1) → R10 underlying stop: close beyond min(SigRef, entry price) ∓ 1.0 ATR_entry (thesis invalidation — the primary stop) → R11 time stop DTE ≤ 21 → R12 pre-earnings profit protection: close before a known event only if ≥ +50% (default is HOLD through events — this book owns cheap vol) → R13 stale sweep: ≥ 40 trading days open and never reached +20%.

**Portfolio caps:** R14 size = floor(1.5% equity / (mid×100)) contracts, skip if 0 (never round up); R15 aggregate open long debits ≤ 10% of equity; R16 ≤ 8 open long positions, ≤ 2 new per cycle (top by score); R17 |Σ signed delta × 100 × contracts × spot| ≤ 50% of equity; R18 one position per underlying (ETF-alias aware); R19 ≤ 3 same-direction positions per sector bucket, ≤ 2 in index ETFs.

## 4. Sizing & metrics (Agent D)

- **Sizing: fixed-fractional per-trade risk budget** (risk = full debit), floor to whole contracts, skip if 0. The research recommendation was 1.5% of equity; **the configured value is 10% per user decision (2026-09-11)** — at 10%, a 10-loss streak costs ~65% of the book vs ~14% at 1.5%, so the aggregate premium cap R15 was scaled 10% → 40% to keep the 8-position book reachable. Constants: `RISK_PCT` / `AGG_PREMIUM_PCT` in `paperEngine.ts`. No conviction multiplier in v1 (log score per trade; revisit at ≥50 closed trades). Equity = cash + marked open positions. Size at entry only; no pyramiding or averaging down. Log every skip.
- **Short-premium sizing in the paper book:** risk ≠ premium. CSP risk = stress loss at a 2σ underlying move (`max(0, strike − (S − 2σ)) × 100 − credit`); collateral = strike × 100 (cash-secured) capped at 40% of equity; max 1 open short-premium position; rolls are logged as new trades. Covered calls are excluded from the paper engine v1 (they require stock inventory).
- **Metrics (Δ-weighted for irregular daily marks):** `μ̂ = Σxᵢ/ΣΔᵢ`, `σ̂² = [Σ(xᵢ−μ̂Δᵢ)²/Δᵢ]/(N−1)` on log returns; Sharpe = (μ̂−rf_d)/σ̂·√252 with rf 4.0% config; Sortino (MAR 0, full-N denominator) as **headline** for the blended book with Sharpe ± Lo-SE beside it; max drawdown on running peak; Calmar (gated D≥90, MDD≥2%); profit factor, win rate + Wilson 90% interval, payoff ratio, R-expectancy = mean(P&L / initial risk). Gates: ≥ 20 marks / ≥ 20 closed trades / ≥ 90 days before annualized numbers render; greyed "insufficient history" tiles otherwise. Missed marks are **excluded** from the return series (Δ-weighting) but **carried forward** for the displayed curve and sizing; block new entries if the last good mark is > 3 trading days old.
- **Marking:** once per cycle at MID; never on crossed/missing quotes (carry last mark, journal the skip).

## 5. Existing strategy changes (Phase 2 ledger)

Changes applied to the short/income tool, with old → new and the finding that justified each:

| Change | Old | New | Justification |
|---|---|---|---|
| Hard liquidity floors in `filterMDChain` | mid > 0 only | bid ≥ $0.05, spread ≤ 15% of mid, OI ≥ 100, credit ≥ 3× spread | Agent B finding 1: MID-fill income results on wide markets are fiction; round-trip friction consumes small credits. |
| IV Rank measurement | strike-smile min/max within one expiration (not a time series) | rolling per-ticker daily ATM-IV ledger → true IV percentile once ≥ 20 samples; smile estimate labeled as fallback | Agents A/B: IVR drives both books' gates; the smile-based number is not an IV rank at all (backlog B3). |
| Earnings factor | always scored 100 (earnings date never populated — dead factor) | chain-detected event kink (front ATM IV − next ATM IV > 8 pts) scores 30; no kink 75; insufficient data 50; theses state "earnings date unknown" | Backlog B2 + Agent B stage 2d: the kink detector is free from data already fetched; the old behavior asserted "no earnings risk" with zero evidence. |
| Yield scoring curve | linear 0 → 50% annualized | saturating curve (diminishing returns above ~25%, soft-capped) | Senior review §4.1/§4.7: 50% annualized usually signals assignment-certain setups; linear scoring rewards the trap and double-counts IVR. |
| Trend veto for CSPs | none — high IVR names surface regardless of trend | bearish-structure veto: close < SMA200 or unreclaimed −4% gap-down within 60d excluded from CSP candidates (dev mode, when history is available; no-op otherwise) | Agent A finding 1–2: pure-IVR ranking adversely selects breaking-down names; negative-gap names are the CSPs that end up deep ITM. |
| Credit accounting | 1 per HTTP request; session-scoped | 1 credit per option symbol returned (chains), per-symbol elsewhere; persistent daily ledger with configurable budget | Verified MarketData.app billing docs (backlog B1). |
| 429 handling | fail the ticker silently | single retry with backoff | Backlog B10. |
| Thesis model | `claude-sonnet-4-6` | `claude-sonnet-5` (same tier, current generation, cheaper) | Backlog B12. |

**Confirmed as-is (research explicitly validated):** 30–45 DTE short entries with 0.10–0.40Δ strikes; selling into contango; 50%-of-credit profit target + 21-DTE management (encoded in the paper engine, where position management lives); high-IVR-with-intact-uptrend as the good CSP setup.

## 6. Data-source note

Underlying daily history costs zero MarketData credits on both builds: in dev it comes live from Yahoo through the Vite proxy (same path the Macro tab uses); on the static GitHub Pages build it comes from a CI-baked snapshot (`history-data.json`, built by `scripts/fetch-history-data.mjs`, refreshed hourly during market hours — daily bars only change once a day, so the snapshot is effectively current). The snapshot covers the default universe plus the sector ETFs; custom watchlist tickers outside it are only scannable via the dev server, and the scanner says so per ticker. All history is cached in localStorage with a ~1-day TTL.
