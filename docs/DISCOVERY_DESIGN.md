# Discovery Design — Candidates Beyond the Watchlist

_Date: 2026-09-14. Consolidates two research briefs: (1) verified constituent data sources, (2) small-cap ranking design. Implements the ticker-discovery prompt with Russell 2000 coverage._

## 0. Architecture

Russell 2000 scale makes browser-side scanning infeasible (~2,000 tickers × 2y OHLCV ≈ 45MB; 2,000 Yahoo fetches per run). The heavy lifting moved to CI:

- `scripts/build-discovery-data.mjs` (Node 24 — native type stripping imports the **same** `src/services/factors.ts` the browser uses; no forked factor math) builds the pool, fetches 2y bars per survivor, scores both composites, and writes a compact pre-scored `public/discovery-data.json`.
- `scripts/refresh-discovery.mjs` runs on **every** deploy: it re-downloads the currently-published artifact and reuses it when < 20h old, so the heavy ~1,000-ticker Yahoo run happens roughly once per trading day (on the first scheduled deploy after aging out) and hourly deploys stay fast.
- The browser (`src/services/discovery.ts` + `DiscoveryPanel.tsx`) lazily loads the artifact when the panel opens. **Zero MarketData credits** — promotion into the universe is when the existing scanners spend credits on the ticker's options chain.

## 1. Constituent sources (verified 2026-09-14)

| Index | Source | Notes |
|---|---|---|
| S&P 500 | `raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv` | Auto-updated from Wikipedia (last commit 2026-09-05); columns incl. `Symbol`, `GICS Sector`; no headers needed. Fallback: the Wikipedia table itself (`id="constituents"`). |
| Russell 2000 | `ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv` | ~1,957 equity rows; 9 preamble lines then `Ticker,Name,Sector,Asset Class,...`. **The old `.ajax` URL returns HTML with HTTP 200** — the script validates the first line is the fund name and requires ≥ 1,800 equities before trusting it. No UA needed. Vanguard VTWO is *not* a viable fallback (SPA redirect); fallback is IWO+IWN union (same URL pattern) or reusing the last good artifact. |
| Nasdaq-100 | MediaWiki API wikitext for `List_of_NASDAQ-100_companies` | The `Nasdaq-100` article no longer carries the table. API JSON is skin-change-immune; descriptive UA per Wikimedia bot policy. Uses ICB sectors (mapped alongside GICS in the sector→ETF table). |

Cross-cutting guard: every source is shape-validated (expected first line / header / minimum row count) and the script **aborts without writing** on mass failure so the previously published artifact stays live.

## 2. Pool floors (research brief §2)

| Tier | Price | 20d avg dollar volume | Rationale |
|---|---|---|---|
| LC (S&P 500 ∪ NDX) | ≥ $20 | ≥ $25M | Same as the existing funnel Stage 0. |
| SC (Russell 2000) | ≥ $10 | ≥ $15M | Below $10, strike spacing and spread-as-%-of-premium break down; below ~$15M ADDV, small-cap option books are single-market-maker fictions. Expected survivors: ~30–40% of the index (~400–600 usable). |
| SC **put** candidates | ≥ $15 | ≥ $25M | Put chains on small caps are systematically thinner than call chains (no covered-call flow anchoring the book); the short side is held to the large-cap bar. |

A market-cap floor (≥ $500M) was recommended but is not cleanly derivable from the holdings CSV; the price+ADDV floors catch most of what it would. Deviation noted.

## 3. Ranking & shortlist (research brief §1, §3)

- **Bucketed percentiles, one interleaved list.** Factor distributions are not cap-comparable (small caps dominate the right tail of raw momentum), so percentiles are computed **within** the LC and SC buckets separately — the institutional norm — and shown in a single list with LC/SC chips.
- **Shortlist (top 20 per direction):** ordered by within-bucket percentile; **SC names must be ≥ 90th percentile in their own bucket** to interleave (no forced cap quota — when small-cap momentum is broken, the list should show it); **max 3 per sector** (momentum shortlists are routinely 60%+ one sector at cycle peaks, which is one macro bet and one crash exposure).
- The IV-quality factor is **excluded** from discovery scores (IVR is unknowable without spending options credits); it re-enters when the promoted ticker goes through the real Long scan.

## 4. Small-cap put-side guards (research brief §4) — computed in CI

1. **Squeeze fingerprint** (short interest is unobservable in this stack): ≥ 5 days with close-to-close return ≥ +7% in the trailing 126 sessions → bear score × 0.55. Recurring violent up-days against a downtrend are the OHLCV signature of a crowded short.
2. **Down-gap exhaustion:** > 40% of the trailing 63d decline concentrated in the worst 3-day window, or price > 2.5 ATR below the 20d mean → excluded (score 0). Post-gap, the move is paid, IV is pumped, and snap-back risk dominates.
3. **Put-side liquidity floor** ($15 / $25M ADDV) as above → excluded below it.

## 5. Promotion flow

"Add" on a discovery row (or "Promote top 10") adds the ticker to whatever the matching tab actually **scans**: bullish candidates go to the Long tab, bearish to the Short tab, and within that tab to the **active saved watchlist** when one is selected (a scan covers only that list), otherwise to the tab's default list. The panel states the destination ("adds go to \"Nick's Tickers\"") and each Add button's tooltip names it. Provenance lives in `options-screener-promoted` (ticker, date, direction, and the watchlist id when it went into a saved watchlist), so "Remove" and "Remove promoted" take a ticker out of exactly where it was put without touching manually curated entries. An open watchlist editor picks up promotions immediately; only the change is merged into its working copy, so unsaved edits survive.

_The first version always sent promotions to the default list. While a saved watchlist was active, those tickers showed as promoted but were never scanned._

**History for promoted tickers in production:** the artifact carries compact 300-bar OHLCV for shortlist members (`topBars`, ~50 tickers). `history.ts` falls back to these when a ticker is missing from `history-data.json`, so promoted tickers scan on the live site without the dev proxy. Tickers promoted long ago (no longer on the shortlist) age out of `topBars` — they then need the dev server or removal; the scanner's per-ticker skip message says which.

## 6. Artifact size & freshness

`discovery-data.json` ≈ scored rows (~1,000 × ~120B compact fields) + topBars (~50 × 300 bars) ≈ **0.6–0.9MB raw, ~150–250KB gzipped**, fetched only when the Discovery panel opens. Snapshot age is shown in the panel; regeneration is self-scheduling via the 20h reuse window. Dev without an artifact: run `node scripts/build-discovery-data.mjs --limit 120` once (the panel shows this instruction).

## 7. Existing tool changes

| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | Node 22 → 24 (type stripping); new `refresh-discovery.mjs` step. |
| `src/services/history.ts` | Third history source: discovery `topBars` fallback for promoted tickers on the static build. |
| `src/components/LongIdeaGenerator.tsx` / `IdeaGenerator.tsx` | Discovery panel embedded below the header card; universe count refreshes on promotion. |
| Deferred | Weighting trend-smoothness up for put-side scoring (research suggestion); market-cap floor; full-pool browsing table (shortlists only in v1); live dev fallback pool (replaced by the `--limit` local build). |
