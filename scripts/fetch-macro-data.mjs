// Fetches Yahoo Finance chart data for every symbol the macro tab needs and
// writes a stripped snapshot to public/macro-data.json. Runs in CI (see
// .github/workflows/deploy.yml) where there is no CORS, so the deployed
// static site can read the data without a proxy.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SYMBOLS = [
  '^VIX', '^VIX3M', '^VVIX', '^SKEW',
  '^GSPC', '^NDX', '^RUT',
  'XLF', 'XLE', 'XLK', 'XLY', 'XLV', 'XLI', 'XLP', 'XLU', 'XLB', 'XLC', 'XLRE',
  'HYG', 'LQD', 'TLT', 'SPY',
];

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChart(symbol) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result?.meta) throw new Error('no chart result');
      // Keep only the fields src/services/macro.ts reads.
      const { symbol: sym, regularMarketPrice, chartPreviousClose, fiftyTwoWeekHigh, fiftyTwoWeekLow, regularMarketTime } = result.meta;
      return {
        meta: { symbol: sym, regularMarketPrice, chartPreviousClose, fiftyTwoWeekHigh, fiftyTwoWeekLow, regularMarketTime },
        timestamp: result.timestamp ?? [],
        indicators: { quote: [{ close: result.indicators?.quote?.[0]?.close ?? [] }] },
      };
    } catch (e) {
      lastError = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

const charts = {};
const failures = [];
for (const symbol of SYMBOLS) {
  try {
    charts[symbol] = await fetchChart(symbol);
    console.log(`ok  ${symbol}`);
  } catch (e) {
    failures.push(symbol);
    console.error(`FAIL ${symbol}: ${e.message}`);
  }
  await sleep(250); // stay well under Yahoo's rate limits
}

// If most symbols failed, bail without writing so a broken run fails the
// deploy and the previously published data stays live.
if (Object.keys(charts).length < 15) {
  console.error(`Only ${Object.keys(charts).length}/${SYMBOLS.length} symbols fetched — aborting.`);
  process.exit(1);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'macro-data.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), failures, charts }));
console.log(`Wrote ${outPath} (${Object.keys(charts).length} symbols, ${failures.length} failures)`);
