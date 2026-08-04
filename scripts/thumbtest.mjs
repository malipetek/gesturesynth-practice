// Thumb-up detector unit test, run against the REAL module through the dev
// server (Vite-transformed import of /src/lib/gesture.ts).
//
// Property under test: ROTATION INVARIANCE. A 👍 is a finger configuration
// (thumb extended + four fingers curled), never a wrist orientation — the
// same synthetic hand must be accepted at every rotation, and non-thumbs-up
// hands (fist, open palm, playing shapes) must be rejected at every
// rotation. Synthetic landmarks are built in local hand coordinates and
// rotated rigidly, so every angle is an identical hand.
//
// Usage: BASE_URL=http://localhost:4321 node scripts/thumbtest.mjs
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:4322';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });

const failures = await page.evaluate(async () => {
  const { isThumbsUp } = await import('/src/lib/gesture.ts');

  // Local hand model, wrist at origin, hand span (wrist→middle MCP) = 0.2.
  // Distances chosen so: thumb stretch = 0.447 (extended) / 0.212 (tucked);
  // curl ratios ≈ 0.77–0.80 (curled) / ≈ 1.9–2.0 (extended). These mirror
  // real-hand measurements (👍 stretch ≈ 0.63, curl ≈ 0.75–0.79).
  const THUMBS_UP = [
    [0, 0], // 0 wrist
    [0.03, 0.03], // 1 thumb CMC
    [0.05, 0.05], // 2 thumb MCP
    [0.09, 0.07], // 3 thumb IP
    [0.13, 0.09], // 4 thumb tip (extended: tip→MCP = 0.0894 → stretch 0.447)
    [0.01, 0.19], // 5 index MCP
    [0.005, 0.14], // 6 index PIP
    [0.01, 0.12], // 7 index DIP
    [0.02, 0.11], // 8 index tip (curled: 0.798)
    [0, 0.2], // 9 middle MCP (handSize = 0.2)
    [0, 0.15], // 10 middle PIP
    [0.005, 0.125], // 11 middle DIP
    [0.015, 0.115], // 12 middle tip (curled: 0.773)
    [-0.01, 0.185], // 13 ring MCP
    [-0.005, 0.14], // 14 ring PIP
    [0, 0.12], // 15 ring DIP
    [0.01, 0.11], // 16 ring tip (curled: 0.788)
    [-0.02, 0.17], // 17 pinky MCP
    [-0.015, 0.125], // 18 pinky PIP
    [-0.005, 0.105], // 19 pinky DIP
    [0.005, 0.1], // 20 pinky tip (curled: 0.795)
  ];
  const withPoints = (base, overrides) => {
    const pts = base.map((p) => [...p]);
    for (const [i, xy] of Object.entries(overrides)) pts[Number(i)] = xy;
    return pts;
  };
  const HANDS = {
    thumbsUp: THUMBS_UP,
    // Fist with the thumb tucked across it (the historical false positive).
    fistTuckedThumb: withPoints(THUMBS_UP, { 4: [0.02, 0.08] }),
    // Thumb out but all four fingers open (high-five-ish).
    openPalmThumbOut: withPoints(THUMBS_UP, {
      8: [0.005, 0.28],
      12: [0.01, 0.3],
      16: [0, 0.28],
      20: [-0.01, 0.24],
    }),
    // Playing shape closest to a collision: octave down (thumb out) +
    // quality 2 (index+middle raised, ring+pinky curled).
    chordShapeOctaveDown: withPoints(THUMBS_UP, {
      8: [0.005, 0.28],
      12: [0.01, 0.3],
    }),
  };
  const EXPECT = {
    thumbsUp: true,
    fistTuckedThumb: false,
    openPalmThumbOut: false,
    chordShapeOctaveDown: false,
  };

  const ANGLES = [0, 30, 60, 90, 120, 150, 180, -30, -60, -90, -120, -150];
  const rotate = (pts, deg) => {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return pts.map(([x, y]) => ({ x: 0.5 + x * c - y * s, y: 0.5 + x * s + y * c, z: 0 }));
  };

  const fails = [];
  for (const [name, pts] of Object.entries(HANDS)) {
    for (const deg of ANGLES) {
      const got = isThumbsUp(rotate(pts, deg));
      if (got !== EXPECT[name]) {
        fails.push(`${name} @ ${deg}°: got ${got}, want ${EXPECT[name]}`);
      }
    }
  }
  return fails;
});

await browser.close();

if (errors.length) console.log(errors.join('\n'));
if (failures.length) {
  console.log('FAILURES:\n' + failures.join('\n'));
  console.log('THUMBTEST FAIL');
  process.exit(1);
}
console.log('48 checks (4 hand shapes × 12 rotations) — all as expected');
console.log('THUMBTEST PASS');
