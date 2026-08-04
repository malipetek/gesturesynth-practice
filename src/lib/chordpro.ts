import { Chord, Note } from 'tonal';
import type { GestureTarget, Song, World } from './types';

/**
 * Client-side ChordPro-ish song importer. Same parsing/mapping semantics as
 * scripts/transpile.mjs (Node-only): {title}/{artist}/{key}/{tempo}/{time}
 * directives, and each [Chord] token occupies one beat, advancing
 * beats → bars automatically.
 */

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-song'
  );
}

/** Chord symbol + song key → gesture target (port of transpile.mjs mapTarget). */
export function mapTarget(chordName: string, key: string): GestureTarget {
  const [chordPart, bassRaw] = chordName.split('/');
  const bassPart = bassRaw?.trim() ?? null;
  const parsed = Chord.get(chordPart.trim());
  const root = parsed.tonic;
  if (!root) {
    throw new Error(`Could not parse chord "${chordName}"`);
  }
  const intervals = parsed.intervals;
  const world: World = intervals.includes('3M')
    ? 'major'
    : intervals.includes('3m')
      ? 'minor'
      : 'major';
  const inverted = bassPart !== null && bassPart !== root;
  let quality: number;
  if (intervals.includes('7M')) quality = 3;
  else if (intervals.includes('7m')) quality = 4;
  else if (inverted) quality = 2;
  else quality = 1;

  const keyRoot = key.match(/^([A-G][#b]?)/)?.[1] ?? key;
  const tonic = Note.chroma(keyRoot);
  const rootChroma = Note.chroma(root);
  const semis = (rootChroma - tonic + 12) % 12;
  let degree = MAJOR_SCALE.indexOf(semis) + 1;
  if (degree === 0) degree = MINOR_SCALE.indexOf(semis) + 1;
  if (degree === 0) {
    throw new Error(`Chord "${chordName}" root is not diatonic to key ${key}`);
  }
  // Octave 0 = thumb folded (base register) — their engine: thumb EXTENDED = −1.
  return { degree, world, quality, octave: 0 };
}

export interface ImportResult {
  song: Song | null;
  errors: string[];
}

/** Parse ChordPro-ish text into a playable Song, collecting human errors. */
export function songFromChordPro(text: string): ImportResult {
  const errors: string[] = [];
  const meta = {
    title: null as string | null,
    artist: 'Unknown',
    key: 'C',
    tempo: 100,
    time: [4, 4] as [number, number],
  };
  const rawEvents: { bar: number; beat: number; chordName: string }[] = [];
  let bar = 1;
  let beat = 1;

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (!line) return;
    const directive = line.match(/^\{(title|artist|key|tempo|time):\s*(.+)\}$/i);
    if (directive) {
      const [, k, value] = directive;
      const v = value.trim();
      switch (k.toLowerCase()) {
        case 'title':
          meta.title = v;
          break;
        case 'artist':
          meta.artist = v;
          break;
        case 'key':
          meta.key = v;
          break;
        case 'tempo': {
          const bpm = Number.parseInt(v, 10);
          if (!Number.isFinite(bpm) || bpm < 30 || bpm > 240) {
            errors.push(`Line ${lineNo}: tempo "${v}" — use 30–240 BPM.`);
          } else {
            meta.tempo = bpm;
          }
          break;
        }
        case 'time': {
          const [n, d] = v.split('/').map((s) => Number.parseInt(s, 10));
          if (!Number.isFinite(n) || !Number.isFinite(d) || n < 1 || n > 12) {
            errors.push(`Line ${lineNo}: time "${v}" — use e.g. 4/4, 3/4, 6/8.`);
          } else {
            meta.time = [n, d];
          }
          break;
        }
      }
      return;
    }
    if (line.startsWith('{')) return; // unknown directives ignored
    const chordRe = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = chordRe.exec(line)) !== null) {
      const chordName = m[1].trim();
      if (!chordName) continue;
      rawEvents.push({ bar, beat, chordName });
      beat += 1;
      if (beat > meta.time[0]) {
        beat = 1;
        bar += 1;
      }
    }
  });

  if (!meta.title) errors.push('Missing {title: …} directive.');
  if (rawEvents.length === 0) {
    errors.push('No chords found — wrap chords in brackets, e.g. [C] [G] [Am] [F].');
  }
  if (Note.chroma(meta.key.match(/^([A-G][#b]?)/)?.[1] ?? '') === undefined) {
    errors.push(`Key "${meta.key}" not understood — use e.g. C, G, Am, Em, Bb.`);
  }
  if (errors.length > 0) return { song: null, errors };

  const events: Song['events'] = [];
  for (const ev of rawEvents) {
    try {
      events.push({ ...ev, target: mapTarget(ev.chordName, meta.key) });
    } catch (e) {
      errors.push(`Bar ${ev.bar} beat ${ev.beat}: ${(e as Error).message}`);
    }
  }
  if (errors.length > 0) return { song: null, errors };

  return {
    song: {
      slug: slugify(meta.title!),
      title: meta.title!,
      artist: meta.artist,
      key: meta.key,
      bpm: meta.tempo,
      timeSignature: meta.time,
      events,
    },
    errors: [],
  };
}
