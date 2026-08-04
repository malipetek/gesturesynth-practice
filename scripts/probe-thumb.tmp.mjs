// Synthetic-geometry truth table for isThumbsUp. Landmark sets built from
// realistic hand proportions (normalized coords, y down = "above" is smaller y).
// Replicates the detector (distance-only curl; see note) to iterate thresholds.

function makeHand({ curledRatios, thumb }) {
  const lm = new Array(21).fill(null).map(() => ({ x: 0, y: 0 }));
  const wrist = { x: 0.5, y: 0.85 };
  lm[0] = wrist;
  const mcpX = { index: 0.42, middle: 0.5, ring: 0.58, pinky: 0.66 };
  const mcpIdx = { index: 5, middle: 9, ring: 13, pinky: 17 };
  let i = 0;
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const base = mcpIdx[f];
    const pip = { x: mcpX[f], y: 0.44 };
    const r = curledRatios[i];
    const dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    const dTip = dPip * r;
    const ang = Math.atan2(pip.y - wrist.y, pip.x - wrist.x);
    const tip = { x: wrist.x + Math.cos(ang) * dTip, y: wrist.y + Math.sin(ang) * dTip };
    lm[base] = { x: mcpX[f], y: 0.55 };
    lm[base + 1] = pip;
    lm[base + 3] = tip;
    i++;
  }
  lm[2] = { x: 0.40, y: 0.72 };
  if (thumb === 'up') { lm[3] = { x: 0.36, y: 0.64 }; lm[4] = { x: 0.33, y: 0.52 }; }
  else if (thumb === 'side') { lm[3] = { x: 0.30, y: 0.70 }; lm[4] = { x: 0.20, y: 0.70 }; }
  else if (thumb === 'tucked') { lm[3] = { x: 0.36, y: 0.68 }; lm[4] = { x: 0.40, y: 0.62 }; }
  else if (thumb === 'down') { lm[3] = { x: 0.36, y: 0.78 }; lm[4] = { x: 0.34, y: 0.86 }; }
  else if (thumb === 'diag') { lm[3] = { x: 0.33, y: 0.66 }; lm[4] = { x: 0.28, y: 0.60 }; }
  return lm;
}

const FINGERS = { index: { pip: 6, tip: 8 }, middle: { pip: 10, tip: 12 }, ring: { pip: 14, tip: 16 }, pinky: { pip: 18, tip: 20 } };
// NOTE: synthetic tips lie ON the wrist->pip ray (tip.y<pip.y always), so the
// lm[t].y > lm[pip].y clause can't be exercised here; we test the distance
// margin, which is the fist-rejection lever. The knuckle-line clause is
// exercised live via the temp console logging.
function isThumbsUp(lm) {
  const wrist = lm[0];
  if (!(lm[9].y < wrist.y)) return false;
  if (Math.abs(lm[9].y - wrist.y) <= Math.abs(lm[9].x - wrist.x)) return false;
  const thumbDx = Math.abs(lm[4].x - lm[3].x);
  const thumbDy = Math.abs(lm[4].y - lm[3].y);
  const tipToMcp = Math.hypot(lm[4].x - lm[2].x, lm[4].y - lm[2].y);
  const handSize = Math.hypot(lm[9].x - wrist.x, lm[9].y - wrist.y) || 1e-6;
  if (!(lm[4].y < lm[3].y && thumbDy > thumbDx * 1.5 && tipToMcp > handSize * 0.35)) return false;
  const curled = (f) => {
    const { pip, tip: t } = FINGERS[f];
    const dTip = Math.hypot(lm[t].x - wrist.x, lm[t].y - wrist.y);
    const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
    return dTip < dPip * 1.02;
  };
  return ['index', 'middle', 'ring', 'pinky'].every(curled);
}

const cases = [
  ['thumbs up (tight fist r=0.9)', makeHand({ curledRatios: [0.9, 0.9, 0.9, 0.9], thumb: 'up' }), true],
  ['thumbs up (fist r=1.0)', makeHand({ curledRatios: [1.0, 1.0, 1.0, 1.0], thumb: 'up' }), true],
  ['FIST r=1.05 relaxed', makeHand({ curledRatios: [1.05, 1.05, 1.05, 1.05], thumb: 'tucked' }), false],
  ['FIST r=1.15', makeHand({ curledRatios: [1.15, 1.15, 1.15, 1.15], thumb: 'tucked' }), false],
  ['FIST r=1.2 (was passing)', makeHand({ curledRatios: [1.2, 1.2, 1.2, 1.2], thumb: 'tucked' }), false],
  ['FIST + thumb side', makeHand({ curledRatios: [0.9, 0.9, 0.9, 0.9], thumb: 'side' }), false],
  ['FIST + thumb diag', makeHand({ curledRatios: [0.9, 0.9, 0.9, 0.9], thumb: 'diag' }), false],
  ['FIST + thumb down', makeHand({ curledRatios: [0.9, 0.9, 0.9, 0.9], thumb: 'down' }), false],
  ['open palm', makeHand({ curledRatios: [1.7, 1.7, 1.7, 1.7], thumb: 'side' }), false],
  ['chord: index up', makeHand({ curledRatios: [1.7, 0.9, 0.9, 0.9], thumb: 'tucked' }), false],
  ['two fingers up', makeHand({ curledRatios: [1.7, 1.7, 0.9, 0.9], thumb: 'up' }), false],
];

let pass = 0, fail = 0;
for (const [name, lm, want] of cases) {
  const got = isThumbsUp(lm);
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  -> ${got} (want ${want})`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
