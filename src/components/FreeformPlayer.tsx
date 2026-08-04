import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import type { GestureTarget, MatchReport, Song } from '../lib/types';
import { DEGREE_LABELS } from '../lib/types';
import type { TrackingStatus } from '../lib/useHandTracking';
import { degreeRootHz, qualityLabel, voicingNotes } from '../lib/match';
import { pitchFromHandY, volumeFromWrist } from '../lib/gesture';
import { audioContextFromTone, GSVoice } from '../lib/gsVoice';
import { Tracker, type TrackerBridge } from './Tracker';
import './Player.css';

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for camera…',
  requesting: 'Requesting camera…',
  'loading-model': 'Loading hand model…',
  ready: 'Camera ready',
  error: 'Camera error',
  'no-camera': 'No camera found',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

interface Hud {
  chord: string;
  quality: string;
  octave: number;
  degree: number | null;
  volume: number;
  tone: number;
  pitchHz: number;
}

const IDLE_HUD: Hud = {
  chord: '—',
  quality: '—',
  octave: 0,
  degree: null,
  volume: 0,
  tone: 0,
  pitchHz: 0,
};

/**
 * Freeform play — the gesturesynth.com instrument itself, inside the
 * practice shell: no chart, no scoring. Gesture mode voices whatever the
 * hands form in the song's key; theremin mode is their second instrument
 * (left hand = volume, right hand = pitch).
 */
export default function FreeformPlayer({ song, onExit }: { song: Song; onExit: () => void }) {
  const [mode, setMode] = useState<'gesture' | 'theremin'>('gesture');
  const [hud, setHud] = useState<Hud>(IDLE_HUD);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle');
  const [trackingError, setTrackingError] = useState<string | null>(null);

  const frameBridge = useRef<TrackerBridge>({ frameRef: null, videoRef: null, landmarksRef: null });
  const voiceRef = useRef<GSVoice | null>(null);
  // No target/report: the overlay draws neutral hand skeletons.
  const reportRef = useRef<MatchReport | null>(null);
  const targetRef = useRef<GestureTarget | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hudKeyRef = useRef('');

  // Scale guide for the song's key (their ScaleGuide: I–VII with note names).
  const scale = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].map((d) => {
        const hz = degreeRootHz(song.key, d);
        return { d, roman: DEGREE_LABELS[d], note: hz ? noteName(hz) : '?' };
      }),
    [song.key],
  );

  // Voice lifecycle (same pattern as GuidedPlayer).
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await Tone.start();
      } catch {
        // audio stays muted
      }
      if (mounted) {
        voiceRef.current = new GSVoice(audioContextFromTone(() => Tone.getContext()));
      }
    })();
    return () => {
      mounted = false;
      voiceRef.current?.dispose();
      voiceRef.current = null;
    };
  }, []);

  // Live instrument loop — mirrors their App.tsx frame loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const voice = voiceRef.current;
      if (!voice) return;

      if (modeRef.current === 'gesture') {
        const frame = frameBridge.current.frameRef?.current ?? null;
        const deg = frame?.left?.degree ?? null;
        const world = frame?.left?.world ?? null;
        const qual = frame?.right?.quality ?? null;
        const oct = frame?.right?.octave ?? 0;
        const vol = frame?.right?.volume ?? 0;
        const tone = frame?.right?.tone ?? 0;
        if (frame?.right) voice.updateFilterSweep(tone);
        const root = deg !== null ? degreeRootHz(song.key, deg) : null;
        if (root && world && qual) {
          voice.playNotes(voicingNotes(root, world, qual, oct));
          voice.setVolume(vol);
        } else {
          voice.setVolume(0);
        }
        const chord = root && world ? noteName(root) + (world === 'minor' ? 'm' : '') : '—';
        const quality = world && qual ? qualityLabel(world, qual) : '—';
        const key = `${chord}|${quality}|${oct}|${deg}|${Math.round(vol * 20)}|${Math.round(tone * 20)}`;
        if (key !== hudKeyRef.current) {
          hudKeyRef.current = key;
          setHud({ chord, quality, octave: oct, degree: deg, volume: vol, tone, pitchHz: 0 });
        }
      } else {
        // Theremin: raw landmarks (their loop uses unstabilized hands here).
        const lm = frameBridge.current.landmarksRef?.current;
        const vol = lm?.left ? volumeFromWrist(lm.left) : 0;
        const pitch = lm?.right ? pitchFromHandY(lm.right) : 0;
        if (lm?.left && lm?.right && vol > 0.02) {
          voice.playTheremin(pitch, vol * 0.55);
        } else {
          voice.stopThereminAudio();
        }
        const key = `th|${Math.round(pitch)}|${Math.round(vol * 20)}`;
        if (key !== hudKeyRef.current) {
          hudKeyRef.current = key;
          setHud({ ...IDLE_HUD, volume: vol, pitchHz: pitch });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      voiceRef.current?.stopAll();
    };
  }, [song]);

  // Escape exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="player has-camera freeform">
      <Tracker
        bridge={frameBridge}
        onStatus={setTrackingStatus}
        onError={setTrackingError}
        reportRef={reportRef}
        targetRef={targetRef}
      />

      <header className="player-header glass">
        <div>
          <h1 className="title">Freeform · {song.key}</h1>
          <p className="meta">{song.title} — play anything; no chart, no score</p>
        </div>
        <div className="voice-toggle" role="group" aria-label="Instrument mode">
          <button
            type="button"
            className={mode === 'gesture' ? 'on' : ''}
            onClick={() => {
              voiceRef.current?.stopAll();
              setMode('gesture');
            }}
          >
            Gesture
          </button>
          <button
            type="button"
            className={mode === 'theremin' ? 'on' : ''}
            onClick={() => {
              voiceRef.current?.stopAll();
              setMode('theremin');
            }}
          >
            Theremin
          </button>
        </div>
      </header>

      <div className={`status ${trackingStatus}`}>{trackingError ?? STATUS_LABEL[trackingStatus]}</div>

      {mode === 'gesture' ? (
        <>
          <div className="free-hud glass">
            <span className={`free-chord${hud.degree ? ` deg deg-${hud.degree}` : ''}`}>
              {hud.chord}
            </span>
            <span className="free-quality">
              {hud.quality}
              {hud.octave === -1 ? ' (−8ve)' : ''}
            </span>
            <div className="free-meters">
              <label>
                Vol
                <span className="free-meter">
                  <i style={{ width: `${Math.round(hud.volume * 100)}%` }} />
                </span>
              </label>
              <label>
                Tone
                <span className="free-meter tone">
                  <i style={{ left: `${50 + Math.round(hud.tone * 50)}%` }} />
                </span>
              </label>
            </div>
          </div>
          <div className="free-scale glass">
            {scale.map((s) => (
              <span
                key={s.d}
                className={`free-deg deg-${s.d}${hud.degree === s.d ? ' active' : ''}`}
              >
                <b>{s.roman}</b>
                {s.note}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="free-hud glass">
          <span className="free-chord">
            {hud.pitchHz > 0 ? `${Math.round(hud.pitchHz)} Hz` : '—'}
          </span>
          <span className="free-quality">left = volume · right = pitch</span>
          <div className="free-meters">
            <label>
              Vol
              <span className="free-meter">
                <i style={{ width: `${Math.round(hud.volume * 100)}%` }} />
              </span>
            </label>
          </div>
        </div>
      )}

      <div className="playbar free-playbar">
        <button type="button" className="stop-btn" onClick={onExit}>
          Exit
        </button>
        <span className="stats">
          {mode === 'gesture'
            ? 'left hand = chord · right hand = style, volume, tone'
            : 'sine voice through the same filter'}
        </span>
      </div>
    </div>
  );
}
