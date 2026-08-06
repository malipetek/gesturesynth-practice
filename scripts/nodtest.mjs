// NodDetector unit test against the REAL module (Vite-transformed import).
// Feeds synthetic z-signal sequences at 60 fps and checks the event stream:
//  1. forward flick fires 'forward' and its return swing must NOT choke
//  2. deliberate backward flick fires 'backward'
//  3. slow 3s posture drift beyond the threshold fires NOTHING (rate gate)
//  4. a flick FROM the drifted pose still fires immediately (stays armed)
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4322/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const events = await page.evaluate(async () => {
  const { NodDetector } = await import('/src/lib/nod.ts');
  const mk = (z) => Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5, z: i === 0 ? 0 : z }));
  const d = new NodDetector();
  const out = [];
  let t = 1000;
  const step = (z, frames) => {
    for (let i = 0; i < frames; i++) {
      t += 1000 / 60;
      const ev = d.update(mk(z), t, 1 / 60);
      if (ev) out.push({ t: Math.round(t), ev });
    }
  };
  step(0, 120);           // 2s rest — seed + settle
  step(-0.06, 4);         // 1. forward flick
  step(0, 40);            //    return swing + settle — no choke
  step(0.06, 4);          // 2. deliberate backward flick
  step(0, 60);            //    settle
  for (let f = 0; f < 180; f++) step(-0.1 * (f / 180), 1); // 3. slow drift
  step(-0.1, 60);         //    hold drifted pose
  step(-0.16, 4);         // 4. flick forward from drifted pose
  step(-0.1, 40);         //    return
  return out;
});
await browser.close();
console.log(JSON.stringify(events));
const ok =
  events.length === 3 &&
  events[0].ev === 'forward' &&
  events[1].ev === 'backward' &&
  events[2].ev === 'forward';
console.log(ok ? 'NODTEST PASS' : 'NODTEST FAIL');
process.exit(ok ? 0 : 1);
