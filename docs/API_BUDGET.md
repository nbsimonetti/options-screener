# Market Data API Token Budget Model

_Date: 2026-09-11. Phase 5 of the long-strategy build._

## 1. The billing model (verified against MarketData.app docs)

MarketData.app bills **1 credit per symbol returned**, not per HTTP request. For `options/chain` that means **1 credit per option contract in the response** — a chain fetch with `strikeLimit: 20` costs ~20 credits. Quotes and expirations cost 1 credit each. Plan limits: **Free 100/day, Starter 10,000/day, Trader 100,000/day** (daily limits; no per-minute limit below Quant tier; 50 concurrent-request hard cap on all plans).

**Plan assumption:** the app defaults its budget to the **Starter plan (10,000 credits/day)**; the Settings panel has presets for all three plans plus custom values. Free-plan users should expect cached-only scans after roughly one ticker.

## 2. Tokens per workflow — before vs. after

Assumptions: default universe = 51 tickers, 3 expirations/ticker on the short scan.

| Workflow | Before (real cost) | After | How |
|---|---|---|---|
| Short scan, cold cache | 51×(1 quote + 1 exps) + 51×3×2 sides×20 strikes ≈ **6,222 credits** — while the old counter claimed "306 requests" and the budget of "2,000 requests" permitted ~37k credits | Same per-ticker cost but honestly counted, capped by the allocation (default ≤ 8,000, bounded by remaining daily budget), degrades to cached-only instead of erroring | Real credit tally in `marketdata.ts`; per-scan cap in `scanner.ts` |
| Short scan, warm cache | 0 credits (was already cached) | 0 — and the expirations TTL extension (1 → 3 days) saves 51 credits/scan on half-warm days | `marketdataCache.ts` |
| Long scan | n/a (new) | Factor stage is **0 credits** (Yahoo history via dev proxy). Options stage only for funnel-qualified tickers: ~1+1+12 = **14 credits per qualified ticker**, typically 5–15 tickers ⇒ **~70–210 credits** | `longScanner.ts` fetches ONE chain side at `strikeLimit: 12` |
| Paper-trade cycle | n/a (new) | 1 credit per open position (single option-symbol quote carries the underlying price) + occasional 1-credit stock quote + 1 credit per entry re-quote ⇒ **~10–25 credits** at full book | `paperEngine.ts` marks via `/options/quotes/{symbol}` instead of refetching chains (20× cheaper) |
| Ticker lookup | ~21 credits | unchanged (~21), tagged to the `lookup` category | |

Biggest single lever: the paper book's daily marking — the highest-value data in the app — costs ~0.2% of a Starter day, while a cold full-universe short scan costs ~62%. The allocator (below) exists to make sure the first is never starved by the second.

## 3. Daily allocation policy (`creditLedger.allocateBudget`)

Priorities, funded from the configured daily budget minus what today's ledger already spent:

1. **Marking open paper positions** — funded first (`max(10, positions × 4)` credits: option quote + underlying fallback, ×2 buffer). Smallest, highest-value spend; portfolio stops/targets cannot be evaluated without it.
2. **User-initiated lookups** — 5% reserve of what remains.
3. **Short scan / Long scan** — 50/50 split of the remainder, each additionally capped by its own default (8,000 / 2,000).

Enforcement is graceful everywhere: when an allocation runs out mid-scan, the scanner switches to **cached-only mode** (cache reads cost nothing) and the UI shows a "budget low — served from cache" notice instead of a hard `BudgetExceededError`. The paper engine carries forward the last mark and journals the skip; entries are blocked only when marks are > 3 trading days stale.

## 4. Cache TTL audit

| Data | Staleness reality | TTL before | TTL after |
|---|---|---|---|
| Stock quotes | minutes | 15 min | 15 min (unchanged — drives fills) |
| Expirations list | changes ~weekly when new series list | 1 day | **3 days** (saves 1 credit/ticker/scan) |
| Option chains | reprices intraday | 1 hour | 1 hour (unchanged — drives idea pricing) |
| IV rank inputs | daily | 1 day | 1 day, plus a rolling 260-sample daily ATM-IV ledger for true percentiles |
| Underlying daily history (Yahoo) | daily bars | n/a | 20 h, **0 credits** (dev proxy) |

## 5. Levers the user can pull

- **Daily budget** (Settings → Daily Credit Budget): plan presets or custom; everything downstream respects it.
- **Universe size / saved watchlists**: scan cost is linear in tickers — a 10-ticker watchlist short-scans for ~1,220 credits cold.
- **Scan frequency**: warm-cache re-scans within 1 hour are nearly free; the cache-aware skip-delay already fast-paths them.
- **Expirations per ticker** (`MAX_EXPIRATIONS_PER_TICKER`) and `strikeLimit` in `scanner.ts`: 3×2×20 is the depth knob; halving expirations halves cold-scan cost.
- **Clear cache** only when you actually need fresh data — clearing forces a full-cost cold scan.
