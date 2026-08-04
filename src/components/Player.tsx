import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as Tone from 'tone';
import { audioContextFromTone, GSVoice, type MetronomeSound } from '../lib/gsVoice';
import {
  compareFrame,
  degreeRootHz,
  qualityLabel,
  symbolTriadNotes,
  targetNotes,
  voicingNotes,
} from '../lib/match';
import { loadSettings, saveSettings, type PracticeSettings } from '../lib/settings';
import { Tracker, type TrackerBridge } from './Tracker';
import GuidedPlayer from './GuidedPlayer';
import { DEGREE_FINGERS, HandShape, qualityFingers } from './HandShape';
import type { MatchReport, Song, SongEvent } from '../lib/types';
import { DEGREE_LABELS } from '../lib/types';
import './Player.css';

type TrackingStatus =
  | 'idle'
  | 'requesting'
  | 'loading-model'
  | 'ready'
  | 'error'
  | 'no-camera';

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
  tuneOn: () => boolean,
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

  // Backing pad, one chord per bar (Gesture Synth open-voicing triad). One
  // bar only — longer pads bleed into the next bar's chord and smear pitch.
  // Gated at fire time so switching to 'hands only' mode mid-run silences
  // the tune from the next bar on.
  const barChords = computeBarChords(song);
  const barDur = spb * beatsPerBar;
  for (let bar = 1; bar <= maxBar; bar++) {
    const notes = symbolTriadNotes(barChords[bar - 1]);
    tp.schedule((time) => {
      if (listenOnly || tuneOn()) voice.stab(notes, time, barDur * 0.98, 0.12);
    }, barBeatTime(bar, 1));
  }

  // Chord events: the correct-chord stab (the tune) plays in listen-only
  // and in the 'auto'/'both' voice modes — never in 'hands only'. Checked
  // at fire time so mode toggles apply on the very next chord. Scoring
  // happens here regardless. Stabs last one beat — overlapping same-pitch
  // stabs phase against each other (and clip), and track mode keeps them
  // quieter so they sit under the live hands.
  song.events.forEach((ev, i) => {
    const t = barBeatTime(ev.bar, ev.beat);
    tp.schedule((time) => {
      if (listenOnly || tuneOn()) {
        voice.stab(targetNotes(ev.target, ev.chordName), time, spb * 0.92, listenOnly ? 0.5 : 0.35);
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
  // Sound settings (Gesture Synth defaults: click metronome at 25%).
  const [settings, setSettings] = useState<PracticeSettings>(loadSettings);
  const [soundOpen, setSoundOpen] = useState(false);
  // Voice behavior in timed track mode (three modes):
  //   'auto'  — just play: the app plays the correct chords; hands make no sound.
  //   'both'  — free with play: hands voice whatever they form AND the tune plays.
  //   'hands' — do not play: only your gestures sound; the app never plays
  //             the correct notes (no stabs, no backing pad).
  const [voiceMode, setVoiceMode] = useState<'auto' | 'both' | 'hands'>('both');
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    voiceRef.current?.setMetronome(settings.metroSound, settings.metroVolume);
    saveSettings(settings);
  }, [settings]);
  // Practice flow: guided = step through short sections at your own pace
  // (default, easiest); timed = full song with the backing track.
  // (Freeform play lives on the homepage's /freeform page, not per song.)
  const [flow, setFlow] = useState<'guided' | 'timed'>('guided');
  const [guidedActive, setGuidedActive] = useState(false);
  const flowRef = useRef(flow);
  const guidedActiveRef = useRef(guidedActive);
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  useEffect(() => {
    guidedActiveRef.current = guidedActive;
  }, [guidedActive]);

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

  // Live Gesture Synth behavior: in the free-voicing modes ('both', 'hands')
  // the instrument voices whatever the hands form — sawtooth through the
  // swept lowpass, volume follows right-wrist height, filter follows
  // right-wrist lean — exactly like the real instrument, right or wrong.
  // In 'auto' mode the hands are silent and the scheduled stabs/pad carry
  // the tune.
  useEffect(() => {
    if (state.phase !== 'playing' || state.mode !== 'track') return;
    let raf = 0;
    const loop = () => {
      const voice = voiceRef.current;
      if (voice) {
        const frame = frameBridge.current.frameRef?.current ?? null;
        if (frame?.right) voice.updateFilterSweep(frame.right.tone);
        if (voiceModeRef.current === 'auto') {
          voice.setVolume(0);
        } else {
          // Free play: voice whatever the hands form, right or wrong.
          // Scoring is unaffected.
          const deg = frame?.left?.degree ?? null;
          const world = frame?.left?.world ?? null;
          const qual = frame?.right?.quality ?? null;
          const root = deg !== null ? degreeRootHz(song.key, deg) : null;
          if (root && world && qual) {
            voice.playNotes(voicingNotes(root, world, qual, frame?.right?.octave ?? 0));
            voice.setVolume(frame?.right?.volume ?? 0.5);
          } else {
            voice.setVolume(0);
          }
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
        const voice = (voiceRef.current ??= new GSVoice(audioContextFromTone(() => Tone.getContext())));
        voice.setMetronome(settingsRef.current.metroSound, settingsRef.current.metroVolume);
        dispatch({ type: 'START' });
        schedulePlayback(song, listenOnly, voice, dispatch, frameBridge, activeIndexAtBeat, () =>
          voiceModeRef.current !== 'hands',
        );
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
        if (guidedActiveRef.current) return;
        if (stateRef.current.mode === 'track' && statusRef.current !== 'ready') return;
        if (stateRef.current.mode === 'track' && flowRef.current === 'guided') {
          setGuidedActive(true);
        } else {
          start();
        }
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

  const activeEv = state.activeIndex >= 0 ? song.events[state.activeIndex] : null;
  const activeTarget = activeEv ? activeEv.target : null;
  // Next chord to prepare for (during count-in this is the first chord).
  const nextEv = song.events[state.activeIndex + 1] ?? null;

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
      target: activeTarget ? (activeTarget.octave === 0 ? 'base' : '−1') : '—',
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

  if (guidedActive && state.mode === 'track') {
    return (
      <GuidedPlayer
        song={song}
        onExit={() => setGuidedActive(false)}
        onStartTimed={() => {
          setGuidedActive(false);
          setFlow('timed');
          start();
        }}
      />
    );
  }

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

      {state.mode === 'track' && !guidedActive && (
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
          <p className="lede">
            {state.mode === 'track' && flow === 'guided'
              ? 'Learn the song in short sections — each chord waits for you.'
              : 'Match both hands to each chord target as the song plays.'}
          </p>
          {state.mode === 'track' && (
            <div className="mode-toggle flow-toggle" role="group" aria-label="Practice flow">
              <button
                type="button"
                className={flow === 'guided' ? 'on' : ''}
                onClick={() => setFlow('guided')}
              >
                Guided
              </button>
              <button
                type="button"
                className={flow === 'timed' ? 'on' : ''}
                onClick={() => setFlow('timed')}
              >
                Timed run
              </button>
            </div>
          )}
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
          <button
            type="button"
            className="start-btn"
            disabled={!canStart}
            onClick={state.mode === 'track' && flow === 'guided' ? () => setGuidedActive(true) : start}
          >
            {state.mode === 'listen'
              ? 'Start listening'
              : flow === 'guided'
                ? 'Start guided practice'
                : 'Start practicing'}
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

          <div className="rail">
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
                        <span className="oct">{ev.target.octave === 0 ? '·' : '−1'}</span>
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

          {state.mode === 'track' && (activeEv || nextEv) && (
            <div className="timed-hands">
              {activeEv && activeTarget && (
                <div className="timed-group">
                  <span className="timed-label">Now · {activeEv.chordName}</span>
                  <div className="timed-pair">
                    <HandShape
                      side="left"
                      fingers={DEGREE_FINGERS[activeTarget.degree]}
                      tiltDeg={activeTarget.world === 'minor' ? 18 : -18}
                      color={`var(--deg-${activeTarget.degree})`}
                    />
                    <HandShape
                      side="right"
                      fingers={qualityFingers(activeTarget.quality, activeTarget.octave !== 0)}
                      color="rgb(255, 107, 90)"
                    />
                  </div>
                </div>
              )}
              {nextEv && (
                <div className="timed-group next">
                  <span className="timed-label">
                    {activeEv ? 'Next' : 'First'} · {nextEv.chordName}
                  </span>
                  <div className="timed-pair">
                    <HandShape
                      side="left"
                      fingers={DEGREE_FINGERS[nextEv.target.degree]}
                      tiltDeg={nextEv.target.world === 'minor' ? 18 : -18}
                      color={`var(--deg-${nextEv.target.degree})`}
                    />
                    <HandShape
                      side="right"
                      fingers={qualityFingers(nextEv.target.quality, nextEv.target.octave !== 0)}
                      color="rgb(255, 107, 90)"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="playbar">
            <button type="button" className="stop-btn" onClick={stop}>
              Stop
            </button>
            <span className="position">{positionLabel}</span>
            <span className="stats">
              {state.hits}/{total} hits · combo {state.combo} (best {state.bestCombo})
            </span>
            {state.mode === 'track' && (
              <div className="voice-toggle" role="group" aria-label="Chord voicing behavior">
                <button
                  type="button"
                  className={voiceMode === 'auto' ? 'on' : ''}
                  title="Just play — the app plays the correct chords; your hands make no sound"
                  onClick={() => setVoiceMode('auto')}
                >
                  Just play
                </button>
                <button
                  type="button"
                  className={voiceMode === 'both' ? 'on' : ''}
                  title="Free with play — your hands voice whatever they form AND the tune plays along"
                  onClick={() => setVoiceMode('both')}
                >
                  Free + tune
                </button>
                <button
                  type="button"
                  className={voiceMode === 'hands' ? 'on' : ''}
                  title="Do not play — only your gestures sound; the app never plays the correct notes"
                  onClick={() => setVoiceMode('hands')}
                >
                  Hands only
                </button>
              </div>
            )}
            <div className="sound-settings">
              <button
                type="button"
                className={`sound-btn${soundOpen ? ' open' : ''}`}
                onClick={() => setSoundOpen((o) => !o)}
                aria-expanded={soundOpen}
              >
                Sound
              </button>
              {soundOpen && (
                <div className="sound-pop">
                  <label className="sound-row">
                    <span>Metronome</span>
                    <select
                      value={settings.metroSound}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          metroSound: e.target.value as MetronomeSound,
                        }))
                      }
                    >
                      <option value="click">Click</option>
                      <option value="wood">Wood</option>
                      <option value="beep">Beep</option>
                      <option value="hihat">Hi-hat</option>
                    </select>
                  </label>
                  <label className="sound-row">
                    <span>Volume</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(settings.metroVolume * 100)}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, metroVolume: Number(e.target.value) / 100 }))
                      }
                    />
                    <span className="sound-val">{Math.round(settings.metroVolume * 100)}%</span>
                  </label>
                </div>
              )}
            </div>
          </div>
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
