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

export function qualityLabel(world: World, quality: number): string {
  return QUALITY_LABELS[world][quality as QualityKey];
}
