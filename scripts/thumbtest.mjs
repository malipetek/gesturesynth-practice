// Thumbs-up detector regression test — replays every real thumb-lab capture
// through the REAL module (Vite-transformed import of /src/lib/gesture.ts).
// The detector is k-NN (k=3, distance cap 0.48) over 411 captured poses, so
// the ground truth is the capture itself, not synthetic hands: every
// thumbs_up sample must be accepted, every not_thumb sample rejected.
//
// Usage: BASE_URL=http://localhost:4322 node scripts/thumbtest.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:4322';

const data = JSON.parse(
  fs.readFileSync(new URL('./thumb-data.json', import.meta.url), 'utf8'),
);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

const result = await page.evaluate(async (samples) => {
  const { thumbsUpDebug } = await import('/src/lib/gesture.ts');
  let fp = 0;
  let fn = 0;
  const fails = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const want = s.label === 'thumbs_up';
    const td = thumbsUpDebug(s.landmarks);
    const got = td?.hit ?? false;
    if (got !== want) {
      if (got) fp++;
      else fn++;
      if (fails.length < 10)
        fails.push(
          `#${i} ${s.label} ${s.hand}: got ${got} (dist ${td?.dist.toFixed(3)}, votes ${td?.votes}/3)`,
        );
    }
  }
  return { total: samples.length, fp, fn, fails };
}, data.samples);

await browser.close();

if (errors.length) console.log(errors.join('\n'));
console.log(
  `${result.total} real captures replayed — false positives: ${result.fp}, false negatives: ${result.fn}`,
);
if (result.fp || result.fn) {
  console.log(result.fails.join('\n'));
  console.log('THUMBTEST FAIL');
  process.exit(1);
}
console.log('THUMBTEST PASS');
