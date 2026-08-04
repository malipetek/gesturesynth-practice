import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:4322';
const SLUG = process.env.SLUG ?? 'ode-to-joy';
const SLEEP = Number(process.env.SLEEP ?? 0);

const logs = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') {
    logs.push(`[${m.type()}] ${m.text()}`);
  }
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${BASE}/song/${SLUG}`, { waitUntil: 'networkidle2' });

const startBtn = await page.waitForSelector('.start-btn', { timeout: 15000 });
await startBtn.click();

// switch to Listen-only if the camera is unavailable so scheduling still runs
const listenBtn = await page.$('.mode-toggle:not(.flow-toggle) button:nth-child(2)');
if (listenBtn) {
  await listenBtn.click();
}
const startAgain = await page.$('.start-btn');
if (startAgain) await startAgain.click();

await page.waitForSelector('.phase[data-phase="countin"], .phase[data-phase="playing"]', {
  timeout: 15000,
});

const chartVisible = await page.$('.chart') !== null;
const chipsVisible = await page.$('.chips') !== null;

// wait for song to finish (ode-to-joy: 10 bars x 4 beats at 95bpm ≈ 27s + 4 count-in)
const t0 = Date.now();
await page.waitForSelector('.phase[data-phase="done"]', {
  timeout: 60000,
});
const elapsed = Date.now() - t0;

const doneText = await page.$eval('.screen.done', (el) => el.textContent);

// sanity: stop interaction back to a startable state
console.log(JSON.stringify({ chartVisible, chipsVisible, elapsedMs: elapsed, done: true }));
console.log('--- done screen ---');
console.log(doneText.replace(/\s+/g, ' ').trim());
console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n') || '(clean)');

await browser.close();
