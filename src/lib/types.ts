export type World = 'major' | 'minor';

export const QUALITY_LABELS: Record<
  World,
  Record<1 | 2 | 3 | 4, string>
> = {
  major: {
    1: 'Major',
    2: 'Major 1st inv.',
    3: 'Major 7th',
    4: 'Dominant 7th',
  },
  minor: {
    1: 'Minor',
    2: 'Minor 1st inv.',
    3: 'Minor 7th',
    4: 'Diminished 7th',
  },
};

export const DEGREE_LABELS: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
};

export interface GestureTarget {
  /** Left hand finger count / combo. 1..5 finger count, 6 = index+pinky, 7 = index+pinky+thumb */
  degree: number;
  /** Left hand tilt world */
  world: World;
  /** Right hand finger count 1..4 → chord quality */
  quality: number;
  /** Right hand thumb octave shift: -1 (down) | 1 (up) */
  octave: number;
}

export interface SongEvent {
  /** 1-based bar number */
  bar: number;
  /** 1-based beat within bar */
  beat: number;
  /** Original chord symbol, e.g. "C", "Am7" */
  chordName: string;
  target: GestureTarget;
}

export interface Song {
  slug: string;
  title: string;
  artist: string;
  /** Tonal-parseable key, e.g. "C", "G" */
  key: string;
  bpm: number;
  timeSignature: [number, number];
  /** Editorial position in the songbook (lower = higher up); unset sorts last, by title */
  order?: number;
  /** Sorted by (bar, beat) */
  events: SongEvent[];
}

/** Observed left-hand state from the webcam classifier. */
export interface LeftHandState {
  /** 1..7, or null when no chord shape detected */
  degree: number | null;
  world: World | null;
}

/** Observed right-hand state from the webcam classifier. */
export interface RightHandState {
  /** 1..4, or null when no fingers up */
  quality: number | null;
  /** thumb up = false, thumb down = true */
  thumbDown: boolean;
  octave: number;
  /** 0..1 from wrist height */
  volume: number;
  /** -1..1 lateral wrist lean */
  tone: number;
}

export interface HandFrame {
  left: LeftHandState | null;
  right: RightHandState | null;
  /** Milliseconds since practice started (used for stable-state debounce) */
  timestamp: number;
}

/** Which dimensions currently match the target. */
export interface MatchReport {
  degree: boolean;
  world: boolean;
  quality: boolean;
  octave: boolean;
  /** sum of matched dimensions / 4 */
  score: number;
}
