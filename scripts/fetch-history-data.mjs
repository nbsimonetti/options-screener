// Fetches 2 years of daily OHLCV from Yahoo Finance for every ticker the
// Long-strategy factor engine needs and writes a compact snapshot to
// public/history-data.json. Runs in CI (see .github/workflows/deploy.yml)
// where there is no CORS, so the deployed static site can run the Long
// scanner without the dev-server Yahoo proxy. Daily bars only change once a
// day, so the hourly CI cadence keeps this fresher than it needs to be.
//
// KEEP IN SYNC with DEFAULT_UNIVERSE in src/services/universe.ts and the
// sector ETFs in src/services/sectors.ts (same convention as
// fetch-macro-data.mjs duplicating the macro symbol list).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIVERSE = [
  // Tech
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE',
  // Finance
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'C',
  // Healthcare
  'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY',
  // Consumer
  'WMT', 'HD', 'COST', 'MCD', 'NKE', 'SBUX', 'DIS',
  // Industrial
  'CAT', 'BA', 'GE', 'HON', 'UPS',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK', 'GLD', 'TLT', 'EEM', 'HYG',
  // Sector ETFs used for relative-strength factors (sectors.ts) not already above
  'XLY', 'XLV', 'XLP', 'XLI',
];

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

async function fetchBars(symbol) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote?.close) throw new Error('no chart result');
      // Compact columnar bars, null rows dropped — the exact shape
      // src/services/history.ts expands into DailyBars.
      const bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
      for (let i = 0; i < result.timestamp.length; i++) {
        const c = quote.close[i];
        if (c == null) continue;
        bars.t.push(result.timestamp[i]);
        bars.o.push(r2(quote.open?.[i] ?? c));
        bars.h.push(r2(quote.high?.[i] ?? c));
        bars.l.push(r2(quote.low?.[i] ?? c));
        bars.c.push(r2(c));
        bars.v.push(Math.round(quote.volume?.[i] ?? 0));
      }
      if (bars.c.length < 260) throw new Error(`only ${bars.c.length} bars`);
      return bars;
    } catch (e) {
      lastError = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

const bars = {};
const failures = [];
for (const symbol of UNIVERSE) {
  try {
    bars[symbol] = await fetchBars(symbol);
    console.log(`ok  ${symbol} (${bars[symbol].c.length} bars)`);
  } catch (e) {
    failures.push(symbol);
    console.error(`FAIL ${symbol}: ${e.message}`);
  }
  await sleep(250); // stay well under Yahoo's rate limits
}

// If most symbols failed, bail without writing so a broken run fails the
// deploy and the previously published snapshot stays live.
if (Object.keys(bars).length < 40) {
  console.error(`Only ${Object.keys(bars).length}/${UNIVERSE.length} symbols fetched — aborting.`);
  process.exit(1);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'history-data.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), failures, bars }));
console.log(`Wrote ${outPath} (${Object.keys(bars).length} symbols, ${failures.length} failures)`);
