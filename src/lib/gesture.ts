import type { LeftHandState, RightHandState, World } from './types';
import { THUMB_PROTOTYPES } from './thumb-prototypes';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

const FINGERS = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
} as const;

export type Finger = keyof typeof FINGERS;

export function isFingerUp(lm: Landmark[], finger: Finger): boolean {
  const { pip, tip } = FINGERS[finger];
  return lm[tip].y < lm[pip].y;
}

export function isThumbExtended(lm: Landmark[], side: 'Left' | 'Right'): boolean {
  const tip = lm[4];
  const base = lm[3];
  return side === 'Right' ? tip.x > base.x : tip.x < base.x;
}

/**
 * Wrist tilt in [-1, 1] — exact port of their wristTilt (src/music/gestures.ts):
 * wrist x relative to the middle/ring MCP span with a ±0.12 dead zone, and
 * the sign INVERTED for the right hand. Used for both the left hand's
 * major/minor world (tilt >= 0 ⇒ major) and the right hand's filter sweep.
 */
export function wristTilt(lm: Landmark[], side: 'Left' | 'Right'): number {
  if (!lm || lm.length < 18) return 0;
  const wrist = lm[0];
  const mid = lm[9];
  const ring = lm[13];
  if (!wrist || !mid || !ring) return 0;
  const left = Math.min(mid.x, ring.x);
  const right = Math.max(mid.x, ring.x);
  const dead = 0.12;
  let t = 0;
  if (wrist.x < left) t = (wrist.x - left) / dead;
  else if (wrist.x > right) t = (wrist.x - right) / dead;
  t = Math.max(-1, Math.min(1, t));
  if (side === 'Right') t = -t;
  return t;
}

export function volumeFromWrist(lm: Landmark[]): number {
  const y = lm[0].y;
  const lo = 0.05;
  const hi = 0.95;
  const clamped = Math.max(lo, Math.min(hi, y));
  return 1 - (clamped - lo) / (hi - lo);
}

/** Exponential pitch map for theremin mode (~65–1200 Hz) — theirs, verbatim. */
export function pitchFromHandY(lm: Landmark[]): number {
  const t = volumeFromWrist(lm);
  const minHz = 65;
  const maxHz = 1200;
  return minHz * Math.pow(maxHz / minHz, t);
}

export function classifyLeft(lm: Landmark[]): LeftHandState | null {
  if (lm.length < 21) return null;
  const index = isFingerUp(lm, 'index');
  const middle = isFingerUp(lm, 'middle');
  const ring = isFingerUp(lm, 'ring');
  const pinky = isFingerUp(lm, 'pinky');
  const thumb = isThumbExtended(lm, 'Left');
  // Their isMajorMode = wristTilt(left) >= 0 (dead zone included).
  const world: World = wristTilt(lm, 'Left') >= 0 ? 'major' : 'minor';
  let degree: number | null = null;
  if (index && pinky && !middle && !ring) {
    degree = thumb ? 7 : 6;
  } else {
    const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
    if (count >= 1 && count <= 5) degree = count;
  }
  return degree !== null ? { degree, world } : null;
}

export function classifyRight(lm: Landmark[]): RightHandState | null {
  if (lm.length < 21) return null;
  const quality = (['index', 'middle', 'ring', 'pinky'] as Finger[]).filter((f) =>
    isFingerUp(lm, f),
  ).length;
  // Their octave: thumb EXTENDED ⇒ notes ÷2 (octave down); folded ⇒ base.
  const extended = isThumbExtended(lm, 'Right');
  return {
    quality: quality >= 1 && quality <= 4 ? quality : null,
    thumbDown: extended,
    octave: extended ? -1 : 0,
    volume: volumeFromWrist(lm),
    tone: wristTilt(lm, 'Right'),
  };
}

/**
 * A deliberate 👍 (guided-mode navigation gesture).
 *
 * Nearest-prototype matching against 256 real hand poses captured with the
 * /thumb-lab page (80 thumbs-ups, 176 not-a-thumb: every fist type, open
 * palms, chord shapes, both hands, all wrist angles). Rule-based detectors
 * (thumb stretch + finger curl ratios) could not separate a wrapped-thumb
 * fist from a real 👍 — the classes overlap in every single feature — so
 * the thresholds here are learned from data instead of guessed.
 *
 * The descriptor is rotation/scale/translation-invariant by construction:
 * translate wrist→origin, scale by wrist→middle-MCP span, rotate the palm
 * axis to +y. Handedness is handled by scoring both x-mirror variants.
 *
 * Verified against the full capture: 100% leave-one-out accuracy (k=3),
 * with a wide safety gap — positives sit ≤0.41 from their nearest
 * prototype, negatives ≥0.56 — so a distance cap at 0.48 rejects any pose
 * that doesn't genuinely look like a captured thumbs-up.
 */
const THUMB_DIST_CAP = 0.48;
const THUMB_K = 3;

/** Rotation/scale/translation-invariant 42-dim hand pose descriptor. */
function poseDescriptor(lm: Landmark[]): number[] {
  const w = lm[0];
  const ax = lm[9].x - w.x;
  const ay = lm[9].y - w.y;
  const span = Math.hypot(ax, ay) || 1e-6;
  const th = -Math.atan2(ay, ax) + Math.PI / 2;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const v: number[] = [];
  for (const p of lm) {
    const x = (p.x - w.x) / span;
    const y = (p.y - w.y) / span;
    v.push(x * c - y * s, x * s + y * c);
  }
  return v;
}

function poseDist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export interface ThumbsUpDebug {
  /** Distance to the nearest captured prototype (lower = more 👍-like). */
  dist: number;
  /** How many of the 3 nearest prototypes are thumbs-ups. */
  votes: number;
  hit: boolean;
}

/** k-NN vote + geometry for the on-screen readout; null if no hand. */
export function thumbsUpDebug(lm: Landmark[] | null): ThumbsUpDebug | null {
  if (!lm || lm.length < 21) return null;
  const v = poseDescriptor(lm);
  // Mirror variant (x flipped) covers the opposite hand's chirality.
  const vm = v.map((n, i) => (i % 2 === 0 ? -n : n));
  const best: { d: number; up: boolean }[] = [];
  for (const p of THUMB_PROTOTYPES) {
    const d = Math.min(poseDist(v, p.v), poseDist(vm, p.v));
    if (best.length < THUMB_K) {
      best.push({ d, up: p.up });
      best.sort((a, b) => a.d - b.d);
    } else if (d < best[THUMB_K - 1].d) {
      best[THUMB_K - 1] = { d, up: p.up };
      best.sort((a, b) => a.d - b.d);
    }
  }
  const votes = best.filter((b) => b.up).length;
  const dist = best[0].d;
  return { dist, votes, hit: votes > THUMB_K / 2 && dist < THUMB_DIST_CAP };
}

export function isThumbsUp(lm: Landmark[]): boolean {
  return thumbsUpDebug(lm)?.hit ?? false;
}

/** Landmark indices of the five fingertips. */
export const FINGERTIPS: readonly number[] = [4, 8, 12, 16, 20];

/** MediaPipe 21-point hand topology, for skeleton rendering. */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // palm base
  [0, 17],
];

/** Smoothed per-hand landmark sets, for the camera overlay. */
export interface HandLandmarks {
  left: Landmark[] | null;
  right: Landmark[] | null;
}
