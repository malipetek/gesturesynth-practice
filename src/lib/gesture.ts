import type { LeftHandState, RightHandState, World } from './types';

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
 * A deliberate 👍 (guided-mode navigation gesture). Much stricter than
 * "thumb extended + no fingers up", which a sideways hand satisfies:
 *
 *  - the thumb must point UP in the image (tip clearly above its base joints),
 *  - the hand must be roughly upright (wrist→middle-MCP axis more vertical
 *    than horizontal — rejects sideways hands),
 *  - all four fingers must be genuinely curled: fingertip nearer the wrist
 *    than its own PIP joint — a rotation-invariant fold test, unlike the
 *    tip-vs-PIP height check which horizontal fingers fool.
 */
export function isThumbsUp(lm: Landmark[]): boolean {
  if (lm.length < 21) return false;
  const wrist = lm[0];
  const tip = lm[4];
  if (!(tip.y < lm[3].y - 0.02 && tip.y < lm[2].y - 0.02)) return false;
  if (!(lm[9].y < wrist.y)) return false;
  if (Math.abs(lm[9].y - wrist.y) <= Math.abs(lm[9].x - wrist.x)) return false;
  const curled = (f: Finger) => {
    const { pip, tip: t } = FINGERS[f];
    const dTip = Math.hypot(lm[t].x - wrist.x, lm[t].y - wrist.y);
    const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
    return dTip < dPip;
  };
  return (['index', 'middle', 'ring', 'pinky'] as Finger[]).every(curled);
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
