import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chord, Note } from 'tonal';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'songs');
const OUT_DIR = join(ROOT, 'src', 'data', 'songs');

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function parseChordSymbol(name) {
  const slash = name.split('/');
  const chordPart = slash[0].trim();
  const bassPart = slash[1]?.trim() ?? null;
  return { chordPart, bassPart };
}

function mapTarget(chordName, key) {
  const { chordPart, bassPart } = parseChordSymbol(chordName);
  const parsed = Chord.get(chordPart);
  const root = parsed.tonic;
  if (!root) {
    throw new Error(`Could not parse chord "${chordName}"`);
  }

  const intervals = parsed.intervals;
  const hasMajorThird = intervals.includes('3M');
  const hasMinorThird = intervals.includes('3m');
  const world = hasMajorThird ? 'major' : hasMinorThird ? 'minor' : 'major';

  const inverted = bassPart !== null && bassPart !== root;
  let quality;
  if (intervals.includes('7M')) quality = 3;
  else if (intervals.includes('7m')) quality = 4;
  else if (inverted) quality = 2;
  else quality = 1;

  // Keys may carry a minor suffix ("Em", "Bbm") — chroma wants the bare root.
  const keyRoot = key.match(/^([A-G][#b]?)/)?.[1] ?? key;
  const tonic = Note.chroma(keyRoot);
  const rootChroma = Note.chroma(root);
  const semis = (rootChroma - tonic + 12) % 12;
  let degree = MAJOR_SCALE.indexOf(semis) + 1;
  if (degree === 0) {
    degree = MINOR_SCALE.indexOf(semis) + 1;
  }
  if (degree === 0) {
    throw new Error(
      `Chord "${chordName}" root is not diatonic to key ${key}`,
    );
  }

  return { degree, world, quality, octave: 1 };
}

function parseSong(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const meta = { title: null, artist: null, key: 'C', tempo: 100, time: [4, 4] };
  const events = [];
  let bar = 1;
  let beat = 1;
  const beatsPerBar = meta.time[0];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const directive = line.match(/^\{(title|artist|key|tempo|time|order):\s*(.+)\}$/i);
    if (directive) {
      const [, key, value] = directive;
      const v = value.trim();
      switch (key.toLowerCase()) {
        case 'title':
          meta.title = v;
          break;
        case 'artist':
          meta.artist = v;
          break;
        case 'key':
          meta.key = v;
          break;
        case 'tempo':
          meta.tempo = Number.parseInt(v, 10);
          break;
        case 'order':
          meta.order = Number.parseInt(v, 10);
          break;
        case 'time': {
          const [n, d] = v.split('/').map((s) => Number.parseInt(s, 10));
          meta.time = [n, d];
          break;
        }
      }
      continue;
    }
    if (line.startsWith('{')) continue;

    const chordRe = /\[([^\]]+)\]/g;
    let m;
    while ((m = chordRe.exec(line)) !== null) {
      const chordName = m[1].trim();
      if (!chordName) continue;
      events.push({ bar, beat, chordName });
      beat += 1;
      if (beat > meta.time[0]) {
        beat = 1;
        bar += 1;
      }
    }
  }

  if (!meta.title) throw new Error(`Missing {title} in ${filePath}`);
  return meta;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const old of readdirSync(OUT_DIR).filter((f) => f.endsWith('.json'))) {
    unlinkSync(join(OUT_DIR, old));
  }
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.cho'));
  if (files.length === 0) {
    console.error('No .cho files found in songs/');
    process.exit(1);
  }

  for (const file of files) {
    const meta = parseSong(join(SOURCE_DIR, file));
    const beatsPerBar = meta.time[0];
    const events = [];
    const rawEvents = [];
    let bar = 1;
    let beat = 1;

    const lines = readFileSync(join(SOURCE_DIR, file), 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('{')) continue;
      const chordRe = /\[([^\]]+)\]/g;
      let m;
      while ((m = chordRe.exec(line)) !== null) {
        const chordName = m[1].trim();
        if (!chordName) continue;
        rawEvents.push({ bar, beat, chordName });
        beat += 1;
        if (beat > beatsPerBar) {
          beat = 1;
          bar += 1;
        }
      }
    }

    for (const ev of rawEvents) {
      const target = mapTarget(ev.chordName, meta.key);
      events.push({ bar: ev.bar, beat: ev.beat, chordName: ev.chordName, target });
    }

    const song = {
      slug: file.replace(/\.cho$/, ''),
      title: meta.title,
      artist: meta.artist ?? 'Unknown',
      key: meta.key,
      bpm: meta.tempo,
      timeSignature: meta.time,
      ...(Number.isFinite(meta.order) ? { order: meta.order } : {}),
      events,
    };

    writeFileSync(
      join(OUT_DIR, `${song.slug}.json`),
      JSON.stringify(song, null, 2),
    );

    const unique = [...new Map(events.map((e) => [e.chordName, e])).values()].slice(
      0,
      4,
    );
    const sample = unique
      .map(
        (e) =>
          `${e.chordName} → deg ${e.target.degree} ${e.target.world} q${e.target.quality}`,
      )
      .join(', ');
    console.log(
      `✓ ${song.title} (${song.key}, ${song.bpm} BPM, ${song.timeSignature.join('/')}) — ${events.length} events · ${sample}${events.length > 4 ? '…' : ''}`,
    );
  }
  console.log(`\nWrote ${files.length} song(s) to ${OUT_DIR}`);
}

main();
