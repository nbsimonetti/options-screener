// Builds the discovery artifact: a pre-scored candidate pool spanning the
// S&P 500 + Nasdaq-100 + the liquid subset of the Russell 2000 (via IWM
// holdings), written to public/discovery-data.json.
//
// Runs in CI (Node 24 — native TypeScript type stripping lets this script
// import the SAME factor engine the browser uses: src/services/factors.ts).
// The browser never sees pool history: it receives only per-ticker composite
// scores, within-cap-bucket percentiles, and compact bars for the shortlist
// members so promoted tickers can be scanned without the dev proxy.
//
// Design: docs/DISCOVERY_DESIGN.md. Run with --limit N for a quick test pool.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const factorsUrl = pathToFileURL(join(here, '..', 'src', 'services', 'factors.ts')).href;
const { computeBullish, computeBearish, detectEntryTrigger, atr14, sma } = await import(factorsUrl);

const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Constituents
// ---------------------------------------------------------------------------

// Sources verified 2026-09-14 (see docs/DISCOVERY_DESIGN.md §1):
// - S&P 500: GitHub datasets CSV (auto-updated from Wikipedia, no headers needed)
// - Russell 2000: iShares IWM latest-holdings.csv (the old .ajax URL returns
//   HTML with HTTP 200 — validate payload shape, never trust the status code)
// - Nasdaq-100: MediaWiki API wikitext for List_of_NASDAQ-100_companies
//   (machine-stable JSON; the Nasdaq-100 article itself no longer carries the table)
const SP500_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const IWM_URL = 'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv';
const NDX_URL =
  'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_NASDAQ-100_companies&prop=wikitext&format=json&formatversion=2';

function parseCsvLine(line) {
  // Handles quoted fields with embedded commas.
  const out = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,text/html,*/*' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function normalizeTicker(t) {
  // Yahoo uses '-' for share classes (BRK.B → BRK-B).
  return t.trim().toUpperCase().replace(/\./g, '-');
}

async function loadSP500() {
  const csv = await fetchText(SP500_URL);
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const symIdx = header.findIndex((h) => h === 'symbol');
  const nameIdx = header.findIndex((h) => h === 'security');
  const secIdx = header.findIndex((h) => h.includes('sector'));
  const out = new Map();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const sym = normalizeTicker(cols[symIdx] ?? '');
    if (sym) out.set(sym, { sector: cols[secIdx] || 'Unknown', cap: 'LC', name: cols[nameIdx] || '' });
  }
  if (out.size < 400) throw new Error(`S&P 500 source returned only ${out.size} rows`);
  return out;
}

async function loadNasdaq100() {
  // MediaWiki API returns the raw wikitext of the constituents table.
  // Wikimedia bot policy asks for a descriptive UA.
  const res = await fetch(NDX_URL, {
    headers: { 'User-Agent': 'options-screener-discovery/1.0 (personal project CI)' },
  });
  if (!res.ok) throw new Error(`NDX API → HTTP ${res.status}`);
  const data = await res.json();
  const wikitext = data.parse?.wikitext ?? '';
  // Table rows look like: |-\n| ADBE\n|| [[Adobe Inc.]] || Technology || ...
  // or single-line "| ADBE || [[Adobe Inc.]] || ...". Take the first cell of
  // each row when it looks like a ticker.
  const out = new Map();
  for (const row of wikitext.split(/\n\|-/)) {
    const cells = row.split(/\|\|/);
    const firstCell = cells[0] ?? '';
    const m = firstCell.match(/\|\s*([A-Z]{1,5}(?:\.[A-Z])?)\s*$/m);
    if (!m) continue;
    // Second cell holds the company as a wikilink: [[Adobe Inc.]] or [[Page|Display]]
    const nameCell = cells[1] ?? '';
    const nm = nameCell.match(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/);
    out.set(normalizeTicker(m[1]), nm ? nm[1].trim() : '');
  }
  if (out.size < 80) throw new Error(`Nasdaq-100 parse found only ${out.size} tickers`);
  return out;
}

async function loadRussell2000() {
  const csv = await fetchText(IWM_URL);
  // The dead .ajax URL returned HTML with HTTP 200 — validate payload shape
  // before trusting anything from this vendor.
  if (!csv.startsWith('iShares Russell 2000 ETF')) {
    throw new Error('IWM holdings: unexpected payload (first line is not the fund name)');
  }
  const lines = csv.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith('Ticker,Name,'));
  if (headerIdx < 0) throw new Error('IWM holdings: header row not found');
  const header = parseCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
  const symIdx = 0;
  const nameIdx = header.findIndex((h) => h === 'name');
  const secIdx = header.findIndex((h) => h === 'sector');
  const assetIdx = header.findIndex((h) => h.includes('asset class'));
  const priceIdx = header.findIndex((h) => h === 'price');
  const out = new Map();
  let equityRows = 0;
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = parseCsvLine(line);
    if (cols.length < header.length - 1) continue;
    if (assetIdx >= 0 && cols[assetIdx] && cols[assetIdx] !== 'Equity') continue;
    equityRows++;
    // Space-separated share classes ("MOG A") → Yahoo's dash form; drop
    // junk rows (ticker '-', escrow placeholders, zero price).
    const sym = normalizeTicker((cols[symIdx] ?? '').replace(/\s+/g, '-'));
    if (!sym || sym === '-' || /[^A-Z-]/.test(sym)) continue;
    // Pre-filter on the CSV's own price column: sub-$10 names fail the SC
    // floor anyway, so skip their Yahoo fetch entirely (~40% of the index).
    const csvPrice = priceIdx >= 0 ? Number((cols[priceIdx] || '0').replace(/[",]/g, '')) : 0;
    if (!(csvPrice >= 10)) continue;
    out.set(sym, { sector: cols[secIdx] || 'Unknown', cap: 'SC', name: cols[nameIdx] || '' });
  }
  // Validate on the RAW equity count (pre price-filter) so a truncated or
  // malformed payload fails loudly even though the filtered set is smaller.
  if (equityRows < 1800) throw new Error(`IWM holdings returned only ${equityRows} equities (expected ~1,950)`);
  console.log(`IWM: ${equityRows} equities, ${out.size} at price >= $10`);
  return out;
}

// ---------------------------------------------------------------------------
// 2. Bars
// ---------------------------------------------------------------------------

async function fetchBars(symbol) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = YAHOO_HOSTS[attempt % YAHOO_HOSTS.length];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote?.close) throw new Error('no chart result');
      const bars = { ticker: symbol, timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
      for (let i = 0; i < result.timestamp.length; i++) {
        const c = quote.close[i];
        if (c == null) continue;
        bars.timestamps.push(result.timestamp[i]);
        bars.opens.push(r2(quote.open?.[i] ?? c));
        bars.highs.push(r2(quote.high?.[i] ?? c));
        bars.lows.push(r2(quote.low?.[i] ?? c));
        bars.closes.push(r2(c));
        bars.volumes.push(Math.round(quote.volume?.[i] ?? 0));
      }
      return bars;
    } catch (e) {
      lastError = e;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// 3. Pool construction + scoring
// ---------------------------------------------------------------------------

console.log('Loading constituents...');
const [sp500, ndx, r2k] = await Promise.all([loadSP500(), loadNasdaq100(), loadRussell2000()]);
console.log(`S&P 500: ${sp500.size} · Nasdaq-100: ${ndx.size} · IWM equities: ${r2k.size}`);

// Merge: LC = S&P 500 ∪ NDX (NDX-only names get sector Unknown), SC = R2K.
const pool = new Map(sp500);
for (const [t, name] of ndx) if (!pool.has(t)) pool.set(t, { sector: 'Unknown', cap: 'LC', name });
for (const [t, info] of r2k) if (!pool.has(t)) pool.set(t, info);

// Liquidity floors (design doc §2): LC price ≥ $20 & ADDV ≥ $25M;
// SC price ≥ $10 & ADDV ≥ $15M (puts additionally gated later at $15/$25M).
const FLOORS = { LC: { price: 20, addv: 25e6 }, SC: { price: 10, addv: 15e6 } };

const tickers = [...pool.keys()].slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`Fetching bars + scoring ${tickers.length} tickers...`);

// Benchmarks for relative strength
const spyBars = await fetchBars('SPY');
// Covers both GICS (S&P/iShares) and ICB (Nasdaq/Wikipedia) sector names.
const sectorEtfBySector = {
  'Information Technology': 'XLK', Technology: 'XLK',
  'Communication Services': 'XLC', Telecommunications: 'XLC',
  Financials: 'XLF', 'Health Care': 'XLV', 'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP', Industrials: 'XLI', Energy: 'XLE', Utilities: 'XLU',
  Materials: 'XLB', 'Basic Materials': 'XLB', 'Real Estate': 'XLRE',
};
const etfBars = new Map();
for (const etf of new Set(Object.values(sectorEtfBySector))) {
  try { etfBars.set(etf, await fetchBars(etf)); } catch { etfBars.set(etf, null); }
  await sleep(150);
}

const scored = [];
const failures = [];
let processed = 0;
const barsByTicker = new Map(); // kept in memory for shortlist bar export

for (const ticker of tickers) {
  processed++;
  if (processed % 100 === 0) console.log(`  ${processed}/${tickers.length} (${scored.length} scored)`);
  const info = pool.get(ticker);
  try {
    const bars = await fetchBars(ticker);
    await sleep(200); // polite pacing (~5/sec incl. fetch time)
    const n = bars.closes.length;
    if (n < 260) continue;
    const price = bars.closes[n - 1];
    const addv = sma(bars.closes.map((c, j) => c * bars.volumes[j]), 20);
    const floor = FLOORS[info.cap];
    if (price < floor.price || addv < floor.addv) continue;

    const sector = etfBars.get(sectorEtfBySector[info.sector]) ?? null;
    const bull = computeBullish({ bars, spy: spyBars, sector, ivRank: 50 });
    const bear = computeBearish({ bars, spy: spyBars, sector, ivRank: 50 });

    // Small-cap put-side guards (design doc §4):
    let bearScore = bear.score;
    const guards = [];
    if (info.cap === 'SC') {
      // Squeeze fingerprint: ≥5 days of ≥+7% closes in trailing 126 sessions
      let ripDays = 0;
      for (let i = Math.max(1, n - 126); i < n; i++) {
        if (bars.closes[i] / bars.closes[i - 1] - 1 >= 0.07) ripDays++;
      }
      if (ripDays >= 5) { bearScore *= 0.55; guards.push(`squeeze fingerprint (${ripDays} +7% days)`); }
      // Down-gap exhaustion: >40% of 63d decline in worst 3-day window, or
      // >2.5 ATR below the 20d mean
      const decline63 = bars.closes[n - 64] > 0 ? bars.closes[n - 64] - price : 0;
      if (decline63 > 0) {
        let worst3 = 0;
        for (let i = n - 63; i < n - 2; i++) {
          worst3 = Math.max(worst3, bars.closes[i] - bars.closes[i + 3]);
        }
        if (worst3 / decline63 > 0.4) { bearScore = 0; guards.push('down-gap exhaustion'); }
      }
      const atr = atr14(bars);
      if (atr > 0 && price < sma(bars.closes, 20) - 2.5 * atr) { bearScore = 0; guards.push('overextended below 20d mean'); }
      // Put-side liquidity: held to the large-cap bar
      if (price < 15 || addv < 25e6) { bearScore = 0; guards.push('below put-side liquidity floor'); }
    }

    // IV-quality factor is neutral (IVR unknown without options credits) —
    // strip it from the shipped factor list to avoid implying knowledge.
    const packFactors = (r) => r.factors.filter((f) => f.key !== 'ivq').map((f) => [f.key, Math.round(f.score)]);

    scored.push({
      t: ticker,
      n: info.name || '',
      cap: info.cap,
      sec: info.sector,
      p: r2(price),
      adv: Math.round(addv / 1e6), // $M
      bull: r2(bull.score),
      bear: r2(bearScore),
      bf: packFactors(bull),
      sf: packFactors(bear),
      g: guards,
    });
    barsByTicker.set(ticker, bars);
  } catch (e) {
    failures.push(ticker);
    if (failures.length % 50 === 0) console.error(`  failures so far: ${failures.length} (latest ${ticker}: ${e.message})`);
  }
}

console.log(`Scored ${scored.length}; ${failures.length} fetch failures.`);
if (scored.length < Math.min(tickers.length, 200) * 0.5) {
  console.error('Too many failures — aborting without writing so the previous artifact stays live.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Percentiles, shortlists, shortlist bars
// ---------------------------------------------------------------------------

function pctRank(rows, key) {
  for (const cap of ['LC', 'SC']) {
    const bucket = rows.filter((r) => r.cap === cap).sort((a, b) => a[key] - b[key]);
    bucket.forEach((r, i) => { r[key + 'P'] = Math.round((i / Math.max(1, bucket.length - 1)) * 100); });
  }
}
pctRank(scored, 'bull');
pctRank(scored, 'bear');

// Shortlist (design doc §3): sort by within-bucket percentile then score; SC
// needs ≥90th percentile in its own bucket to interleave; max 3 per sector;
// N=20 per direction.
function shortlist(key) {
  const ordered = [...scored]
    .filter((r) => r[key] > 0)
    .filter((r) => r.cap === 'LC' || r[key + 'P'] >= 90)
    .sort((a, b) => b[key + 'P'] - a[key + 'P'] || b[key] - a[key]);
  const out = [];
  const perSector = {};
  for (const r of ordered) {
    if (out.length >= 20) break;
    const s = r.sec || 'Unknown';
    if ((perSector[s] ?? 0) >= 3) continue;
    perSector[s] = (perSector[s] ?? 0) + 1;
    out.push(r.t);
  }
  return out;
}
const topLong = shortlist('bull');
const topShort = shortlist('bear');

// Entry triggers + compact 300-bar OHLCV for shortlist members (lets the Long
// scanner evaluate promoted tickers in production without the dev proxy).
const topBars = {};
for (const t of new Set([...topLong, ...topShort])) {
  const bars = barsByTicker.get(t);
  if (!bars) continue;
  const row = scored.find((r) => r.t === t);
  const dir = topLong.includes(t) ? 'bull' : 'bear';
  const trig = detectEntryTrigger(bars, dir);
  if (row && trig) { row.trig = trig.trigger; row.trigDate = trig.triggerDate; }
  const s = Math.max(0, bars.closes.length - 300);
  topBars[t] = {
    t: bars.timestamps.slice(s),
    o: bars.opens.slice(s),
    h: bars.highs.slice(s),
    l: bars.lows.slice(s),
    c: bars.closes.slice(s),
    v: bars.volumes.slice(s),
  };
}

// Shortlist enrichment (~40 tickers, best-effort):
//  - name casing + "Industry · Exchange" line from the crumb-free search endpoint
//  - a 1-sentence business description from quoteSummary/assetProfile, which
//    sits behind Yahoo's auth crumb: obtain a session cookie (fc.yahoo.com)
//    and crumb (v1/test/getcrumb) once, then pass both per request.
async function getYahooSession() {
  try {
    const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const cookie = r1.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (!cookie) return null;
    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
    });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.includes('<')) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

function firstSentence(text, maxLen = 280) {
  if (!text) return '';
  // First sentence boundary that isn't an abbreviation like "Inc." / "Co."
  const m = text.match(/^.{20,}?(?<!\b(?:Inc|Co|Corp|Ltd|S\.A|N\.V|U\.S))\.(?=\s|$)/s);
  let s = m ? m[0] : text;
  if (s.length > maxLen) s = s.substring(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
  return s.trim();
}

const yahooSession = await getYahooSession();
if (!yahooSession) console.warn('No Yahoo crumb session — descriptions fall back to industry lines.');

for (const t of new Set([...topLong, ...topShort])) {
  const row = scored.find((r) => r.t === t);
  if (!row) continue;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(t)}&quotesCount=3&newsCount=0`,
      { headers: { 'User-Agent': UA } },
    );
    if (res.ok) {
      const data = await res.json();
      const q = (data.quotes ?? []).find((x) => x.symbol === t && x.quoteType === 'EQUITY');
      if (q) {
        if (q.longname || q.shortname) row.n = q.longname || q.shortname; // nicer casing than the holdings CSV
        const bits = [q.industry, q.exchDisp].filter(Boolean);
        if (bits.length) row.ind = bits.join(' · ');
      }
    }
  } catch { /* best-effort */ }

  if (yahooSession) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=assetProfile&crumb=${encodeURIComponent(yahooSession.crumb)}`,
        { headers: { 'User-Agent': UA, Cookie: yahooSession.cookie } },
      );
      if (res.ok) {
        const data = await res.json();
        const summary = data.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary;
        const s = firstSentence(summary);
        if (s) row.d = s;
      }
    } catch { /* best-effort */ }
  }
  if (!row.d && row.ind) row.d = row.ind; // fallback: at least the industry line
  await sleep(200);
}

const artifact = {
  version: 3, // bump forces refresh-discovery.mjs to regenerate instead of reusing
  fetchedAt: new Date().toISOString(),
  stats: {
    poolSize: tickers.length,
    scored: scored.length,
    lc: scored.filter((r) => r.cap === 'LC').length,
    sc: scored.filter((r) => r.cap === 'SC').length,
    failures: failures.length,
  },
  topLong,
  topShort,
  scored,
  topBars,
};

const outPath = join(here, '..', 'public', 'discovery-data.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(artifact));
const kb = Math.round(JSON.stringify(artifact).length / 1024);
console.log(`Wrote ${outPath} (${kb} KB · ${scored.length} scored · top ${topLong.length}L/${topShort.length}S)`);
