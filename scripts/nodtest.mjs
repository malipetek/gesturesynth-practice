// NodDetector unit test against the REAL module (Vite-transformed import).
// Feeds synthetic landmark sequences at 60 fps and checks the event stream:
//  1. forward flick (depth channel) fires 'forward', return swing must NOT choke
//  2. deliberate backward flick (depth) fires 'backward'
//  3. slow 3s posture drift beyond the threshold fires NOTHING (rate gate)
//  4. a flick FROM the drifted pose still fires immediately (stays armed)
//  5. SCALE channel: a fast palm-size jump (hand pushed toward camera) fires
//     'forward' even with zero depth-channel motion
//  6. slow palm-size drift (leaning in gradually) fires NOTHING
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
  // Depth-only hand: all points coincident (scale channel flat via guard).
  const mk = (z) => Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5, z: i === 0 ? 0 : z }));
  // Hand with a real palm: wrist at center, MCPs on a ring of radius s.
  const mkPalm = (s) =>
    Array.from({ length: 21 }, (_, i) => {
      if (i === 0) return { x: 0.5, y: 0.5, z: 0 };
      const a = (i / 20) * Math.PI * 2;
      return { x: 0.5 + Math.cos(a) * s, y: 0.5 + Math.sin(a) * s, z: 0 };
    });

  // Part 1: depth channel (original four checks)
  const d = new NodDetector();
  const out = [];
  let t = 1000;
  const step = (lm, frames) => {
    for (let i = 0; i < frames; i++) {
      t += 1000 / 60;
      const ev = d.update(lm, t, 1 / 60);
      if (ev) out.push({ t: Math.round(t), ev });
    }
  };
  const stepZ = (z, frames) => step(mk(z), frames);
  stepZ(0, 120);          // 2s rest — seed + settle
  stepZ(-0.06, 4);        // 1. forward flick
  stepZ(0, 40);           //    return swing + settle — no choke
  stepZ(0.06, 4);         // 2. deliberate backward flick
  stepZ(0, 60);           //    settle
  for (let f = 0; f < 180; f++) stepZ(-0.1 * (f / 180), 1); // 3. slow drift
  stepZ(-0.1, 60);        //    hold drifted pose
  stepZ(-0.16, 4);        // 4. flick forward from drifted pose
  stepZ(-0.1, 40);        //    return

  // Part 2: scale channel on a fresh detector (palm radius jumps fast)
  const d2 = new NodDetector();
  const out2 = [];
  let t2 = 1000;
  const step2 = (lm, frames) => {
    for (let i = 0; i < frames; i++) {
      t2 += 1000 / 60;
      const ev = d2.update(lm, t2, 1 / 60);
      if (ev) out2.push({ t: Math.round(t2), ev });
    }
  };
  step2(mkPalm(0.10), 120);       // rest
  step2(mkPalm(0.115), 4);        // 5. fast +15% palm (push toward camera)
  step2(mkPalm(0.10), 60);        //    return + settle — no choke
  for (let f = 0; f < 180; f++) step2(mkPalm(0.10 * (1 + 0.3 * (f / 180))), 1); // 6. slow lean-in
  step2(mkPalm(0.13), 60);        //    hold bigger size — nothing
  return { out, out2 };
});
await browser.close();
console.log(JSON.stringify(events));
const ok1 =
  events.out.length === 3 &&
  events.out[0].ev === 'forward' &&
  events.out[1].ev === 'backward' &&
  events.out[2].ev === 'forward';
const ok2 = events.out2.length === 1 && events.out2[0].ev === 'forward';
console.log(ok1 && ok2 ? 'NODTEST PASS' : `NODTEST FAIL (depth:${ok1} scale:${ok2})`);
process.exit(ok1 && ok2 ? 0 : 1);
