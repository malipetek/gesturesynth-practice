import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as Tone from 'tone';
import { Chord, Note } from 'tonal';
// @ts-ignore - provided by the parallel hand-tracking workstream; contract declared below
import { useHandTracking } from '../lib/useHandTracking';
import { FINGERTIPS, HAND_CONNECTIONS } from '../lib/gesture';
import type { HandLandmarks, Landmark } from '../lib/gesture';
import { GSVoice } from '../lib/gsVoice';
import type {
  GestureTarget,
  HandFrame,
  MatchReport,
  Song,
  SongEvent,
  World,
} from '../lib/types';
import { DEGREE_LABELS, QUALITY_LABELS } from '../lib/types';
import './Player.css';

type TrackingStatus =
  | 'idle'
  | 'requesting'
  | 'loading-model'
  | 'ready'
  | 'error'
  | 'no-camera';

interface HandTrackingResult {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  status: TrackingStatus;
  error: string | null;
  frameRef: MutableRefObject<HandFrame | null>;
  landmarksRef: MutableRefObject<HandLandmarks>;
}

const COUNTIN_BEATS = 4;

type Phase = 'idle' | 'countin' | 'playing' | 'done';
type Mode = 'track' | 'listen';

interface PerDim {
  degree: number;
  world: number;
  quality: number;
  octave: number;
}

interface PlayerState {
  phase: Phase;
  mode: Mode;
  beat: number;
  activeIndex: number;
  currentReport: MatchReport | null;
  volume: number | null;
  results: (MatchReport | null)[];
  hits: number;
  perDim: PerDim;
  combo: number;
  bestCombo: number;
}

type Action =
  | { type: 'TOGGLE_MODE' }
  | { type: 'START' }
  | { type: 'BEAT'; beat: number; report: MatchReport | null; volume: number | null }
  | { type: 'RESULT'; index: number; report: MatchReport | null }
  | { type: 'PLAYING' }
  | { type: 'FINISH' }
  | { type: 'STOP' };

const ZERO_PER_DIM: PerDim = { degree: 0, world: 0, quality: 0, octave: 0 };

const makeInitial = (): PlayerState => ({
  phase: 'idle',
  mode: 'track',
  beat: 0,
  activeIndex: -1,
  currentReport: null,
  volume: null,
  results: [],
  hits: 0,
  perDim: { ...ZERO_PER_DIM },
  combo: 0,
  bestCombo: 0,
});

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  countin: 'Count-in',
  playing: 'Playing',
  done: 'Done',
};

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for camera…',
  requesting: 'Requesting camera…',
  'loading-model': 'Loading hand model…',
  ready: 'Camera ready',
  error: 'Camera error',
  'no-camera': 'No camera found',
};

function compareFrame(frame: HandFrame | null, target: GestureTarget): MatchReport | null {
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

function chordNotes(chordName: string, octaveShift = 0): number[] {
  const mul = Math.pow(2, octaveShift);
  return (Chord.get(chordName).notes as string[])
    .map((n) => {
      const midi = 60 + Note.chroma(n);
      return Number.isFinite(midi) ? 440 * Math.pow(2, (midi - 69) / 12) * mul : 0;
    })
    .filter((f) => f > 0);
}

type QualityKey = 1 | 2 | 3 | 4;

/** Per-degree chord colors, mirroring gesturesynth.com's --chord-I…VII palette. */
const DEGREE_RGB: Record<number, string> = {
  1: '61, 255, 224',
  2: '255, 107, 90',
  3: '240, 198, 90',
  4: '120, 210, 255',
  5: '255, 150, 70',
  6: '255, 90, 140',
  7: '160, 200, 255',
};
const RIGHT_HAND_RGB = '255, 107, 90';

function qualityLabel(world: World, quality: number): string {
  return QUALITY_LABELS[world][quality as QualityKey];
}

function audioContextFromTone(): AudioContext {
  // The GSVoice is raw Web Audio but must share Tone's context so scheduled
  // times line up with the Transport.
  return (Tone.getContext() as unknown as { rawContext: AudioContext }).rawContext;
}

function computeBarChords(song: Song): string[] {
  const maxBar = song.events[song.events.length - 1].bar;
  const chords: string[] = [];
  let last: string | null = null;
  for (let bar = 1; bar <= maxBar; bar++) {
    const ev = song.events.find((e) => e.bar === bar);
    if (ev) last = ev.chordName;
    else if (!last) last = song.key;
    chords.push(last);
  }
  return chords;
}

function computeActiveIndexes(song: Song, countinBeats: number, beatsPerBar: number): number[] {
  if (song.events.length === 0) return [];
  const maxBar = song.events[song.events.length - 1].bar;
  const total = countinBeats + maxBar * beatsPerBar;
  const abs = song.events.map((e) => countinBeats + (e.bar - 1) * beatsPerBar + (e.beat - 1));
  const arr = new Array<number>(total).fill(-1);
  let cur = -1;
  let ei = 0;
  for (let beat = 0; beat < total; beat++) {
    while (ei < abs.length && abs[ei] <= beat) {
      cur = ei;
      ei++;
    }
    arr[beat] = cur;
  }
  return arr;
}

function schedulePlayback(
  song: Song,
  listenOnly: boolean,
  voice: GSVoice,
  dispatch: (a: Action) => void,
  frameBridge: MutableRefObject<TrackerBridge>,
  activeIndexAtBeat: number[],
): void {
  const tp = Tone.getTransport();
  const beatsPerBar = song.timeSignature[0];
  const spb = 60 / song.bpm;
  const maxBar = song.events[song.events.length - 1].bar;
  const totalBeats = COUNTIN_BEATS + maxBar * beatsPerBar;
  const barBeatTime = (bar: number, beat: number) =>
    (COUNTIN_BEATS + (bar - 1) * beatsPerBar + (beat - 1)) * spb;

  // Everything is scheduled through the Transport. Audio is triggered inside
  // Transport callbacks with the precise AudioContext `time`, and visuals are
  // deferred with Tone.Draw at that same time. Scheduling raw relative
  // seconds straight against the AudioContext clock only lines up with the
  // Transport on the first run after the context is created — on replays
  // every time is already in the past and fires at once.
  tp.bpm.value = song.bpm;
  tp.timeSignature = song.timeSignature;
  tp.cancel(0);
  Tone.getDraw().cancel(0);

  const draw = Tone.getDraw();

  // Metronome + per-beat UI updates.
  for (let b = 0; b < totalBeats; b++) {
    tp.schedule((time) => {
      const accent = b % beatsPerBar === 0;
      voice.click(time, accent);
      draw.schedule(() => {
        const activeIdx = activeIndexAtBeat[b];
        const target = activeIdx >= 0 ? song.events[activeIdx].target : null;
        const frame = listenOnly ? null : frameBridge.current.frameRef?.current ?? null;
        const report = target && frame ? compareFrame(frame, target) : null;
        const volume = frame?.right?.volume ?? null;
        dispatch({ type: 'BEAT', beat: b, report, volume });
      }, time);
    }, b * spb);
  }

  // Backing pad, one chord per bar.
  const barChords = computeBarChords(song);
  for (let bar = 1; bar <= maxBar; bar++) {
    const notes = chordNotes(barChords[bar - 1]);
    const duration = spb * beatsPerBar * 2.2;
    tp.schedule((time) => {
      voice.stab(notes, time, duration, 0.12);
    }, barBeatTime(bar, 1));
  }

  // Chord events: in listen-only mode every stab plays so you can hear the
  // song; when tracking, scoring happens here and the audible stab comes
  // from the live full-match trigger in the Player.
  song.events.forEach((ev, i) => {
    const t = barBeatTime(ev.bar, ev.beat);
    tp.schedule((time) => {
      if (listenOnly) {
        voice.stab(chordNotes(ev.chordName, ev.target.octave), time, spb * beatsPerBar, 0.35);
      }
      const frame = listenOnly ? null : frameBridge.current.frameRef?.current ?? null;
      const report = compareFrame(frame, ev.target);
      dispatch({ type: 'RESULT', index: i, report });
    }, t);
  });

  tp.schedule((time) => {
    draw.schedule(() => dispatch({ type: 'PLAYING' }), time);
  }, COUNTIN_BEATS * spb);
  tp.schedule((time) => {
    draw.schedule(() => dispatch({ type: 'FINISH' }), time);
  }, totalBeats * spb);
  tp.schedule((time) => tp.stop(time + 0.3), totalBeats * spb);

  tp.start();
}

interface TrackerBridge {
  frameRef: MutableRefObject<HandFrame | null> | null;
  videoRef: MutableRefObject<HTMLVideoElement | null> | null;
  landmarksRef: MutableRefObject<HandLandmarks> | null;
}

interface TrackerProps {
  bridge: MutableRefObject<TrackerBridge>;
  onStatus: (s: TrackingStatus) => void;
  onError: (e: string | null) => void;
  reportRef: MutableRefObject<MatchReport | null>;
  targetRef: MutableRefObject<GestureTarget | null>;
}

function Tracker({ bridge, onStatus, onError, reportRef, targetRef }: TrackerProps) {
  const { videoRef, status, error, frameRef, landmarksRef } =
    useHandTracking() as HandTrackingResult;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    bridge.current.frameRef = frameRef;
    bridge.current.videoRef = videoRef;
    bridge.current.landmarksRef = landmarksRef;
  }, [bridge, frameRef, videoRef, landmarksRef]);
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  useEffect(() => {
    onError(error);
  }, [error, onError]);

  // Full-page hand-skeleton overlay, drawn straight from the smoothed
  // landmarks every animation frame (bypasses React rendering entirely).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;

    // Each hand keeps its hue (left = current target's degree color, right =
    // coral); a full match on that hand's dimensions brightens it + adds glow.
    const drawHand = (pts: { x: number; y: number }[], rgb: string, matched: boolean) => {
      const alpha = matched ? 0.95 : 0.5;
      ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
      ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgba(${rgb}, ${matched ? 0.85 : 0.4})`;
      ctx.shadowBlur = matched ? 18 : 6;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, FINGERTIPS.includes(i) ? 4 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const video = videoRef.current;
      const vw = video?.videoWidth ?? 0;
      const vh = video?.videoHeight ?? 0;
      if (!vw || !vh) return;
      // Project normalized landmarks into mirrored, object-fit: cover video space.
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const ox = (w - dw) / 2;
      const oy = (h - dh) / 2;
      const project = (lm: Landmark) => ({ x: ox + (1 - lm.x) * dw, y: oy + lm.y * dh });
      const report = reportRef.current;
      const degreeRgb = DEGREE_RGB[targetRef.current?.degree ?? 1];
      const { left, right } = landmarksRef.current;
      if (left) {
        drawHand(left.map(project), degreeRgb, !!report && report.degree && report.world);
      }
      if (right) {
        drawHand(right.map(project), RIGHT_HAND_RGB, !!report && report.quality && report.octave);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, landmarksRef, reportRef, targetRef]);

  return (
    <div className="camera" aria-hidden="true">
      <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
      <div className="camera-scrim" />
      <canvas ref={canvasRef} className="camera-canvas" />
    </div>
  );
}

interface ChipDef {
  id: string;
  label: string;
  target: string;
  match: boolean | undefined;
}

interface RowDef {
  ev: SongEvent;
  index: number;
}

export default function Player({ song }: { song: Song }) {
  const beatsPerBar = song.timeSignature[0];
  const activeIndexAtBeat = useMemo(
    () => computeActiveIndexes(song, COUNTIN_BEATS, beatsPerBar),
    [song, beatsPerBar],
  );

  const reducer = (state: PlayerState, action: Action): PlayerState => {
    switch (action.type) {
      case 'TOGGLE_MODE':
        return { ...state, mode: state.mode === 'track' ? 'listen' : 'track' };
      case 'START':
        return {
          ...makeInitial(),
          mode: state.mode,
          results: Array<MatchReport | null>(song.events.length).fill(null),
          phase: 'countin',
        };
      case 'BEAT':
        return {
          ...state,
          beat: action.beat,
          activeIndex: activeIndexAtBeat[action.beat] ?? -1,
          currentReport: action.report,
          volume: action.volume,
        };
      case 'RESULT': {
        const results = state.results.slice();
        results[action.index] = action.report;
        if (!action.report) {
          return { ...state, results, combo: 0, currentReport: null };
        }
        const report = action.report;
        const hit = report.score >= 1;
        const combo = hit ? state.combo + 1 : 0;
        return {
          ...state,
          results,
          hits: state.hits + (hit ? 1 : 0),
          combo,
          bestCombo: Math.max(state.bestCombo, combo),
          perDim: {
            degree: state.perDim.degree + (report.degree ? 1 : 0),
            world: state.perDim.world + (report.world ? 1 : 0),
            quality: state.perDim.quality + (report.quality ? 1 : 0),
            octave: state.perDim.octave + (report.octave ? 1 : 0),
          },
          currentReport: report,
        };
      }
      case 'PLAYING':
        return { ...state, phase: 'playing' };
      case 'FINISH':
        return { ...state, phase: 'done' };
      case 'STOP':
        return { ...makeInitial(), mode: state.mode };
    }
  };

  const [state, dispatch] = useReducer(reducer, undefined, makeInitial);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle');
  const [trackingError, setTrackingError] = useState<string | null>(null);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const statusRef = useRef(trackingStatus);
  useEffect(() => {
    statusRef.current = trackingStatus;
  }, [trackingStatus]);

  const frameBridge = useRef<TrackerBridge>({ frameRef: null, videoRef: null, landmarksRef: null });
  const voiceRef = useRef<GSVoice | null>(null);
  const audioUnlockedRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const isStartingRef = useRef(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      try {
        const tp = Tone.getTransport();
        tp.stop();
        tp.cancel(0);
        Tone.getDraw().cancel(0);
      } catch {
        // ignore Tone teardown errors on unmount
      }
      voiceRef.current?.dispose();
      voiceRef.current = null;
    },
    [],
  );

  // Latest match report + active target for the canvas overlay (refs, so
  // drawing stays out of the React render cycle).
  const reportRef = useRef<MatchReport | null>(null);
  const targetRef = useRef<GestureTarget | null>(null);
  useEffect(() => {
    reportRef.current = state.currentReport;
    targetRef.current =
      state.activeIndex >= 0 ? song.events[state.activeIndex].target : null;
  }, [state.currentReport, state.activeIndex, song]);

  // Live Gesture Synth behavior: while both hands fully match the active
  // target the chord sustains (sawtooth through the swept lowpass), volume
  // follows right-wrist height, and the filter follows right-wrist lean —
  // exactly like the real instrument. Anything less than a full match is
  // silent.
  useEffect(() => {
    if (state.phase !== 'playing' || state.mode !== 'track') return;
    let raf = 0;
    const loop = () => {
      const voice = voiceRef.current;
      if (voice) {
        const idx = stateRef.current.activeIndex;
        const frame = frameBridge.current.frameRef?.current ?? null;
        if (frame?.right) voice.updateFilterSweep(frame.right.tone);
        if (idx >= 0) {
          const ev = song.events[idx];
          const report = compareFrame(frame, ev.target);
          if (report && report.score >= 1) {
            voice.playNotes(chordNotes(ev.chordName, ev.target.octave));
            voice.setVolume(frame?.right?.volume ?? 0.5);
          } else {
            voice.setVolume(0);
          }
        } else {
          voice.setVolume(0);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      voiceRef.current?.stopAll();
    };
  }, [state.phase, state.mode, song]);

  const start = useCallback(() => {
    if (isStartingRef.current || sessionActiveRef.current) return;
    isStartingRef.current = true;
    sessionActiveRef.current = true;
    const listenOnly = stateRef.current.mode === 'listen';
    void (async () => {
      try {
        await Tone.start();
      } catch {
        // audio stays muted; play-by-ear continues silently
      }
      audioUnlockedRef.current = true;
      try {
        const voice = (voiceRef.current ??= new GSVoice(audioContextFromTone()));
        dispatch({ type: 'START' });
        schedulePlayback(song, listenOnly, voice, dispatch, frameBridge, activeIndexAtBeat);
      } catch {
        sessionActiveRef.current = false;
      } finally {
        isStartingRef.current = false;
      }
    })();
  }, [song, activeIndexAtBeat, dispatch]);

  const stop = useCallback(() => {
    // No early return on the session flag: after a song finishes on its own
    // the flag is already false, but "Practice again" must still reset to idle.
    sessionActiveRef.current = false;
    voiceRef.current?.stopAll();
    try {
      const tp = Tone.getTransport();
      tp.stop();
      tp.cancel(0);
      Tone.getDraw().cancel(0);
    } catch {
      // Tone's state can be inconsistent after an audio-scheduling error;
      // the UI must still reset.
    }
    dispatch({ type: 'STOP' });
  }, [dispatch]);

  useEffect(() => {
    if (state.phase === 'done') sessionActiveRef.current = false;
  }, [state.phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!audioUnlockedRef.current) return;
      const ph = stateRef.current.phase;
      if (ph === 'idle' || ph === 'done') {
        if (stateRef.current.mode === 'track' && statusRef.current !== 'ready') return;
        start();
      } else {
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, stop]);

  useEffect(() => {
    const el = chartRef.current?.querySelector(`[data-ev="${state.activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [state.activeIndex]);

  if (song.events.length === 0) {
    return (
      <div className="player">
        <p className="empty">This song has no events yet.</p>
      </div>
    );
  }

  const activeTarget =
    state.activeIndex >= 0 ? song.events[state.activeIndex].target : null;

  const canStart = state.mode === 'listen' || trackingStatus === 'ready';

  const chips: ChipDef[] = [
    {
      id: 'degree',
      label: 'DEG',
      target: activeTarget ? DEGREE_LABELS[activeTarget.degree] : '—',
      match: state.currentReport?.degree,
    },
    {
      id: 'world',
      label: 'WORLD',
      target: activeTarget ? activeTarget.world : '—',
      match: state.currentReport?.world,
    },
    {
      id: 'quality',
      label: 'QUAL',
      target: activeTarget ? qualityLabel(activeTarget.world, activeTarget.quality) : '—',
      match: state.currentReport?.quality,
    },
    {
      id: 'octave',
      label: 'OCT',
      target: activeTarget ? (activeTarget.octave > 0 ? '+1' : '−1') : '—',
      match: state.currentReport?.octave,
    },
  ];

  const bars = useMemo(() => {
    const out: { bar: number; events: RowDef[] }[] = [];
    let cur: { bar: number; events: RowDef[] } | null = null;
    song.events.forEach((ev, index) => {
      if (!cur || cur.bar !== ev.bar) {
        cur = { bar: ev.bar, events: [] };
        out.push(cur);
      }
      cur.events.push({ ev, index });
    });
    return out;
  }, [song]);

  const total = song.events.length;
  const accuracy = total > 0 ? Math.round((state.hits / total) * 100) : 0;
  const volumePct = Math.round((state.volume ?? 0) * 100);
  const barBeat = state.beat - COUNTIN_BEATS;
  const positionLabel =
    barBeat < 0
      ? 'Count-in'
      : `Bar ${Math.floor(barBeat / beatsPerBar) + 1} · beat ${(barBeat % beatsPerBar) + 1}`;

  return (
    <div className={`player${state.mode === 'track' ? ' has-camera' : ''}`}>
      <header className="player-header">
        <div>
          <h1 className="title">{song.title}</h1>
          <p className="meta">
            {song.artist} — {song.key} · {song.bpm} BPM · {song.timeSignature[0]}/
            {song.timeSignature[1]}
          </p>
        </div>
        <span className="phase" data-phase={state.phase}>
          {PHASE_LABEL[state.phase]}
        </span>
      </header>

      {state.mode === 'track' && (
        <Tracker
          bridge={frameBridge}
          onStatus={setTrackingStatus}
          onError={setTrackingError}
          reportRef={reportRef}
          targetRef={targetRef}
        />
      )}

      {state.phase === 'idle' && (
        <section className="screen idle">
          <h2>Ready to practice?</h2>
          <p className="lede">Match both hands to each chord target as the song plays.</p>
          <div className="mode-toggle" role="group" aria-label="Practice mode">
            <button
              type="button"
              className={state.mode === 'track' ? 'on' : ''}
              onClick={() => dispatch({ type: 'TOGGLE_MODE' })}
            >
              Hand tracking
            </button>
            <button
              type="button"
              className={state.mode === 'listen' ? 'on' : ''}
              onClick={() => dispatch({ type: 'TOGGLE_MODE' })}
            >
              Listen only
            </button>
          </div>
          {state.mode === 'track' ? (
            <p className={`status ${trackingStatus}`}>
              {trackingStatus === 'no-camera'
                ? 'No camera found — switch to Listen only to skip hand tracking.'
                : trackingStatus === 'error'
                  ? `Camera error${trackingError ? `: ${trackingError}` : ''}`
                  : STATUS_LABEL[trackingStatus]}
            </p>
          ) : (
            <p className="status listen">Listen-only mode — hear the song, no scoring.</p>
          )}
          <button type="button" className="start-btn" disabled={!canStart} onClick={start}>
            {state.mode === 'listen' ? 'Start listening' : 'Start practicing'}
          </button>
          <p className="hint">
            Press <kbd>Space</kbd> to start / stop
          </p>
        </section>
      )}

      {(state.phase === 'countin' || state.phase === 'playing') && (
        <div className="stage">
          <section className="feedback">
            <div className="chips">
              {chips.map((c) => (
                <div
                  key={c.id}
                  className={`chip ${c.match === undefined ? 'gray' : c.match ? 'ok' : 'no'}`}
                >
                  <span className="chip-label">{c.label}</span>
                  <span className="chip-target">{c.target}</span>
                </div>
              ))}
            </div>
            <div
              className="volume"
              role="meter"
              aria-label="Right hand volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volumePct}
            >
              <div className="volume-fill" style={{ height: `${volumePct}%` }} />
            </div>
          </section>

          <div className="chart" ref={chartRef}>
            {bars.map((grp) => (
              <div className="bar" key={grp.bar}>
                <div className="bar-label">Bar {grp.bar}</div>
                <div className="bar-events">
                  {grp.events.map(({ ev, index }) => {
                    const result = state.results[index];
                    const cls = [
                      'row',
                      index === state.activeIndex ? 'active' : index < state.activeIndex ? 'past' : 'future',
                    ].join(' ');
                    return (
                      <div className={cls} data-ev={index} key={index}>
                        <span className="beat">
                          {ev.bar}.{ev.beat}
                        </span>
                        <span className="chord">{ev.chordName}</span>
                        <span className={`deg deg-${ev.target.degree}`}>
                          {DEGREE_LABELS[ev.target.degree]}
                        </span>
                        <span className={`world ${ev.target.world}`}>{ev.target.world}</span>
                        <span className="qual">{qualityLabel(ev.target.world, ev.target.quality)}</span>
                        <span className="oct">{ev.target.octave > 0 ? '+1' : '−1'}</span>
                        <span
                          className={`dot ${result ? (result.score >= 1 ? 'hit' : 'miss') : ''}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="playbar">
            <button type="button" className="stop-btn" onClick={stop}>
              Stop
            </button>
            <span className="position">{positionLabel}</span>
            <span className="stats">
              {state.hits}/{total} hits · combo {state.combo} (best {state.bestCombo})
            </span>
          </div>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="screen done">
          <h2>Practice complete</h2>
          <p className="lede">{state.mode === 'listen' ? 'Listen-only session — not scored.' : `${song.title} — nice work.`}</p>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-value">{accuracy}%</span>
              <span className="stat-label">accuracy</span>
            </div>
            <div className="stat">
              <span className="stat-value">
                {state.hits}/{total}
              </span>
              <span className="stat-label">full hits</span>
            </div>
            <div className="stat">
              <span className="stat-value">{state.bestCombo}</span>
              <span className="stat-label">best combo</span>
            </div>
          </div>
          <div className="dim-stats">
            {(
              [
                ['Degree', state.perDim.degree],
                ['World', state.perDim.world],
                ['Quality', state.perDim.quality],
                ['Octave', state.perDim.octave],
              ] as [string, number][]
            ).map(([label, count]) => (
              <div className="dim" key={label}>
                <span className="dim-label">{label}</span>
                <div className="dim-track">
                  <div
                    className="dim-fill"
                    style={{ width: `${total > 0 ? Math.round((count / total) * 100) : 0}%` }}
                  />
                </div>
                <span className="dim-count">
                  {count}/{total}
                </span>
              </div>
            ))}
          </div>
          <div className="done-actions">
            <button type="button" className="start-btn" onClick={stop}>
              Practice again
            </button>
            <a className="back" href="/">
              Back to songs
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
