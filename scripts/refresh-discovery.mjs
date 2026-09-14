// Keeps discovery-data.json in every deploy WITHOUT running the ~1,000-ticker
// build hourly: download the currently-published artifact from the live site;
// if it is fresher than MAX_AGE_H, reuse it; otherwise (or if missing) run the
// full build. Net effect: one heavy Yahoo run per day on the first scheduled
// deploy after the artifact ages out, and every other deploy is fast.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LIVE_URL = 'https://nbsimonetti.github.io/options-screener/discovery-data.json';
const MAX_AGE_H = 20;
// Must match the version written by build-discovery-data.mjs — a mismatch
// (schema change) forces regeneration instead of reusing a stale shape.
const EXPECTED_VERSION = 2;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'public', 'discovery-data.json');

async function tryReuse() {
  try {
    const res = await fetch(LIVE_URL);
    if (!res.ok) return null;
    const text = await res.text();
    const data = JSON.parse(text);
    if (!data.fetchedAt || !Array.isArray(data.scored)) return null;
    if (data.version !== EXPECTED_VERSION) {
      console.log(`Published artifact is schema v${data.version ?? 1} (need v${EXPECTED_VERSION}) — regenerating.`);
      return null;
    }
    const ageH = (Date.now() - new Date(data.fetchedAt).getTime()) / 3600000;
    if (ageH > MAX_AGE_H) {
      console.log(`Published artifact is ${ageH.toFixed(1)}h old (> ${MAX_AGE_H}h) — regenerating.`);
      return null;
    }
    console.log(`Reusing published artifact (${ageH.toFixed(1)}h old, ${data.scored.length} scored).`);
    return text;
  } catch {
    return null;
  }
}

const reused = await tryReuse();
if (reused) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, reused);
} else {
  console.log('Running full discovery build...');
  const result = spawnSync(process.execPath, [join(here, 'build-discovery-data.mjs')], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
