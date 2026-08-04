import { Chord, Note } from 'tonal';
import type { GestureTarget, HandFrame, MatchReport, World } from './types';
import { QUALITY_LABELS } from './types';

type QualityKey = 1 | 2 | 3 | 4;

/** Per-dimension comparison of an observed hand frame against a target. */
export function compareFrame(frame: HandFrame | null, target: GestureTarget): MatchReport | null {
  if (!frame || !frame.left || !frame.right) return null;
  const l = frame.left;
  const r = frame.right;
  const degree = l.degree !== null && l.degree === target.degree;
  const world = l.world !== null && l.world === target.world;
  const quality = r.quality !== null && r.quality === target.quality;
  const octave = r.octave === target.octave;
  return {
    degree,
    world,
    quality,
    octave,
    score: (Number(degree) + Number(world) + Number(quality) + Number(octave)) / 4,
  };
}

/** Numeric oscillator frequencies for a chord symbol, with ±1 octave shift. */
export function chordNotes(chordName: string, octaveShift = 0): number[] {
  const mul = Math.pow(2, octaveShift);
  return (Chord.get(chordName).notes as string[])
    .map((n) => {
      const midi = 60 + Note.chroma(n);
      return Number.isFinite(midi) ? 440 * Math.pow(2, (midi - 69) / 12) * mul : 0;
    })
    .filter((f) => f > 0);
}

const SEMI = Math.pow(2, 1 / 12);

/**
 * Root frequency of a chord symbol in Gesture Synth's register (C4 = 261.63
 * for "C"), matching their key table.
 */
export function chordRootHz(chordName: string): number | null {
  const tonic = Chord.get(chordName).tonic;
  if (!tonic) return null;
  const chroma = Note.chroma(tonic);
  if (!Number.isFinite(chroma)) return null;
  return 440 * Math.pow(2, (60 + chroma - 69) / 12);
}

/**
 * Chord voicings exactly as the Gesture Synth engine builds them
 * (reverse-engineered from the deployed bundle):
 *
 *   third = root · 2^((major ? 4 : 3)/12)     fifth = root · 2^(7/12)
 *
 *   quality 1 (triad):      [root, fifth, root·2, third·2]   (open voicing)
 *   quality 2 (1st inv):    [third, fifth, root·2, third·2]
 *   quality 3: major        [root, third, fifth, +11]        (major 7th)
 *              minor        [root, third, fifth, +10]        (minor 7th)
 *   quality 4: major        [root, third, fifth, +10]        (dominant 7th)
 *              minor        [root, third, +6, +9]            (diminished 7th)
 *
 * Octave shift multiplies every note by 2^shift (their octave down = ÷2).
 */
export function targetNotes(target: GestureTarget, chordName: string): number[] {
  const root = chordRootHz(chordName);
  if (!root) return chordNotes(chordName, target.octave);
  const major = target.world === 'major';
  const third = root * Math.pow(SEMI, major ? 4 : 3);
  const fifth = root * Math.pow(SEMI, 7);
  let notes: number[];
  switch (target.quality) {
    case 2:
      notes = [third, fifth, root * 2, third * 2];
      break;
    case 3:
      notes = [root, third, fifth, root * Math.pow(SEMI, major ? 11 : 10)];
      break;
    case 4:
      notes = major
        ? [root, third, fifth, root * Math.pow(SEMI, 10)]
        : [root, third, root * Math.pow(SEMI, 6), root * Math.pow(SEMI, 9)];
      break;
    default:
      notes = [root, fifth, root * 2, third * 2];
  }
  const mul = Math.pow(2, target.octave);
  return notes.map((f) => f * mul);
}

/** Open-voicing triad for the backing pad (quality 1, world from the symbol). */
export function symbolTriadNotes(chordName: string): number[] {
  const root = chordRootHz(chordName);
  if (!root) return chordNotes(chordName, 0);
  const q = Chord.get(chordName).quality;
  const minor = q === 'Minor' || q === 'Diminished';
  const third = root * Math.pow(SEMI, minor ? 3 : 4);
  return [root, root * Math.pow(SEMI, 7), root * 2, third * 2];
}

export function qualityLabel(world: World, quality: number): string {
  return QUALITY_LABELS[world][quality as QualityKey];
}
