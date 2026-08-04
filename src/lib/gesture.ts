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

export function tiltWorld(lm: Landmark[]): World {
  return lm[9].x > lm[0].x ? 'minor' : 'major';
}

export function volumeFromWrist(lm: Landmark[]): number {
  const y = lm[0].y;
  const lo = 0.05;
  const hi = 0.95;
  const clamped = Math.max(lo, Math.min(hi, y));
  return 1 - (clamped - lo) / (hi - lo);
}

export function toneFromWrist(lm: Landmark[]): number {
  const wrist = lm[0].x;
  const a = Math.min(lm[9].x, lm[13].x);
  const b = Math.max(lm[9].x, lm[13].x);
  const scale = 0.12;
  let c = 0;
  if (wrist < a) c = (wrist - a) / scale;
  else if (wrist > b) c = (wrist - b) / scale;
  return Math.max(-1, Math.min(1, c));
}

export function classifyLeft(lm: Landmark[]): LeftHandState | null {
  if (lm.length < 21) return null;
  const index = isFingerUp(lm, 'index');
  const middle = isFingerUp(lm, 'middle');
  const ring = isFingerUp(lm, 'ring');
  const pinky = isFingerUp(lm, 'pinky');
  const thumb = isThumbExtended(lm, 'Left');
  const world = tiltWorld(lm);
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
  const thumbDown = !isThumbExtended(lm, 'Right');
  return {
    quality: quality >= 1 && quality <= 4 ? quality : null,
    thumbDown,
    octave: thumbDown ? -1 : 1,
    volume: volumeFromWrist(lm),
    tone: toneFromWrist(lm),
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
