// Guided practice flow test: sections, guide overlay, skip, repeat, next, done.
// Uses the fake camera (no real hands), so progression is driven via the
// "Skip this chord" button — which also exercises the skip path itself.
//
// Usage: BASE_URL=http://localhost:4322 SLUG=twinkle node scripts/guidedtest.mjs
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:4322';
const SLUG = process.env.SLUG ?? 'twinkle';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('[err] ' + m.text());
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

await page.goto(`${BASE}/song/${SLUG}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.start-btn', { timeout: 15000 });

// Guided is the default flow in track mode; wait for the camera, then start.
await page.waitForFunction(
  () => document.querySelector('.status')?.textContent.includes('Camera ready'),
  { timeout: 25000 },
);
const flowLabel = await page.$eval('.flow-toggle button.on', (el) => el.textContent.trim());
await page.click('.screen.idle .start-btn');
await page.waitForSelector('.guide', { timeout: 15000 });

const handShapes = await page.$$eval('.hand-shape', (els) => els.length);
const pillCount = await page.$$eval('.section-pill', (els) => els.length);
console.log(JSON.stringify({ flowLabel, handShapes, sectionPills: pillCount }));
if (flowLabel !== 'Guided' || handShapes !== 2 || pillCount < 2) {
  throw new Error('guided UI did not render as expected');
}

let skips = 0;
let sectionScreens = 0;
let repeats = 0;
for (let guard = 0; guard < 300; guard++) {
  if (await page.$('.screen.done')) break;
  if (await page.$('.guided-screen')) {
    sectionScreens++;
    if (repeats === 0) {
      // exercise "Repeat this section" once, then continue normally
      await page.click('.section-repeat');
      repeats++;
    } else {
      await page.click('.section-next');
    }
    await page.waitForSelector('.guide', { timeout: 5000 });
    continue;
  }
  const skipBtn = await page.$('.guide-skip');
  if (skipBtn) {
    await skipBtn.click();
    skips++;
  } else {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const done = await page.$('.screen.done');
const doneText = done
  ? await page.$eval('.screen.done', (el) => el.textContent.replace(/\s+/g, ' ').trim())
  : null;
console.log(JSON.stringify({ skips, sectionScreens, repeats, done: !!done }));
console.log('done screen:', doneText);
console.log('console errors:', logs.length ? logs.join('\n') : '(none)');
if (!done || skips < 32 || logs.length) {
  process.exitCode = 1;
} else {
  console.log('GUIDEDTEST PASS');
}
await browser.close();
