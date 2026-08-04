// Audio scheduling regression test.
//
// Plays a song twice in listen-only mode and asserts BOTH runs take roughly
// the real song duration. With the old absolute-time scheduling bug, the
// second run's pad/UI events were already in the past and fired instantly
// (song "finished" in <1s). Also exercises the done → "Practice again" path.
//
// Usage: BASE_URL=http://localhost:4322 SLUG=twinkle node scripts/audiotest.mjs
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:4322';
const SLUG = process.env.SLUG ?? 'twinkle';
const COUNTIN_BEATS = 4;

const song = JSON.parse(
  await readFile(new URL(`../src/data/songs/${SLUG}.json`, import.meta.url), 'utf8'),
);
const beatsPerBar = song.timeSignature[0];
const maxBar = Math.max(...song.events.map((e) => e.bar));
const expectedSec = (COUNTIN_BEATS + maxBar * beatsPerBar) * (60 / song.bpm);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
// Count every oscillator start in the page: proves sound is actually produced
// (twinkle ≈ 36 clicks + 8 pad stabs ×3 notes + 32 chord stabs ×3 notes = 156).
await page.evaluateOnNewDocument(() => {
  window.__oscStarts = 0;
  const orig = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    window.__oscStarts++;
    return orig.apply(this, args);
  };
});
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('[err] ' + m.text());
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

await page.goto(`${BASE}/song/${SLUG}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.start-btn', { timeout: 15000 });

// headless has no camera → listen-only mode
await page.click('.mode-toggle button:nth-child(2)');

async function runOnce(label) {
  await page.waitForSelector('.screen.idle .start-btn:not([disabled])', { timeout: 15000 });
  const t0 = Date.now();
  await page.click('.screen.idle .start-btn');
  await page.waitForSelector('.phase[data-phase="countin"], .phase[data-phase="playing"]', {
    timeout: 15000,
  });
  await page.waitForSelector('.phase[data-phase="done"]', {
    timeout: Math.ceil((expectedSec + 30) * 1000),
  });
  const elapsed = (Date.now() - t0) / 1000;
  const ratio = elapsed / expectedSec;
  console.log(
    `${label}: ${elapsed.toFixed(1)}s (expected ~${expectedSec.toFixed(1)}s, ratio ${ratio.toFixed(2)})`,
  );
  if (ratio < 0.85 || ratio > 1.6) {
    throw new Error(`${label} finished out of time bounds — scheduling is broken`);
  }
  // "Practice again" must return to a startable idle screen
  await page.$eval('.done-actions .start-btn', (el) =>
    el.scrollIntoView({ block: 'center' }),
  );
  await page.click('.done-actions .start-btn');
  await page.waitForSelector('.screen.idle', { timeout: 5000 });
}

await runOnce('run 1');
const oscStarts = await page.evaluate(() => window.__oscStarts);
console.log(`oscillator starts after run 1: ${oscStarts}`);
if (oscStarts < 100) {
  throw new Error(`suspiciously few oscillator starts (${oscStarts}) — sound engine not producing`);
}
await runOnce('run 2');

console.log('console errors:', logs.length ? logs.join('\n') : '(none)');
if (logs.length) {
  process.exitCode = 1;
} else {
  console.log('AUDIOTEST PASS');
}
await browser.close();
