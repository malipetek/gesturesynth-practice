import { useCallback, useEffect, useRef, useState } from 'react';
import type { GestureTarget, MatchReport } from '../lib/types';
import type { TrackingStatus } from '../lib/useHandTracking';
import { Tracker, type TrackerBridge } from './Tracker';
import './Player.css';
import './ThumbLab.css';

/**
 * Thumb Lab — a data-collection workbench for the 👍 skip gesture. Detector
 * margins were previously estimated from synthetic hand geometry and kept
 * missing real poses; this page captures REAL labeled samples instead.
 *
 * Arm a label, then hold poses with one or both hands, slowly rotating and
 * moving them through the whole frame — samples stream in at ~8 Hz per
 * visible hand. Download the JSON; analysis derives the actual separating
 * features/margins from it.
 */

type Label = 'thumbs_up' | 'not_thumb';

interface LabSample {
  label: Label;
  hand: 'left' | 'right';
  landmarks: { x: number; y: number; z: number }[];
}

const SAMPLE_MS = 125;
const MAX_SAMPLES = 20000;

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for camera…',
  requesting: 'Requesting camera…',
  'loading-model': 'Loading hand model…',
  ready: 'Camera ready',
  error: 'Camera error',
  'no-camera': 'No camera found',
};

/** Live per-hand feature readout — same candidate features the analysis uses. */
function liveFeatures(lm: { x: number; y: number }[]): string {
  const w = lm[0];
  const span = Math.hypot(lm[9].x - w.x, lm[9].y - w.y) || 1e-6;
  const stretch = Math.hypot(lm[4].x - lm[2].x, lm[4].y - lm[2].y) / span;
  const curl = (pip: number, tip: number) =>
    Math.hypot(lm[tip].x - w.x, lm[tip].y - w.y) /
    (Math.hypot(lm[pip].x - w.x, lm[pip].y - w.y) || 1e-6);
  const tipToIndex = Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y) / span;
  return `stretch ${stretch.toFixed(2)} · curl ${[curl(6, 8), curl(10, 12), curl(14, 16), curl(18, 20)]
    .map((c) => c.toFixed(2))
    .join('/')} · tip→idx ${tipToIndex.toFixed(2)}`;
}

export default function ThumbLab() {
  const bridge = useRef<TrackerBridge>({ frameRef: null, videoRef: null, landmarksRef: null });
  const reportRef = useRef<MatchReport | null>(null);
  const targetRef = useRef<GestureTarget | null>(null);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<Label | null>(null);
  const armedRef = useRef<Label | null>(null);
  const samplesRef = useRef<LabSample[]>([]);
  const [counts, setCounts] = useState<Record<Label, number>>({ thumbs_up: 0, not_thumb: 0 });
  const [live, setLive] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });

  const arm = useCallback((label: Label | null) => {
    armedRef.current = label;
    setArmed(label);
  }, []);

  // Sampling loop: while armed, snapshot every visible hand at ~8 Hz.
  useEffect(() => {
    if (!armed) return;
    const id = window.setInterval(() => {
      const label = armedRef.current;
      if (!label) return;
      const lmk = bridge.current.landmarksRef?.current;
      if (!lmk) return;
      let added = 0;
      for (const hand of ['left', 'right'] as const) {
        const lm = lmk[hand];
        if (!lm || lm.length < 21) continue;
        samplesRef.current.push({
          label,
          hand,
          landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: (p as { z?: number }).z ?? 0 })),
        });
        added++;
      }
      if (added > 0) setCounts((c) => ({ ...c, [label]: c[label] + added }));
      if (samplesRef.current.length >= MAX_SAMPLES) arm(null);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [armed, arm]);

  // Live feature readout (~10 Hz) so poses can be sanity-checked on screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      const lmk = bridge.current.landmarksRef?.current;
      setLive({
        left: lmk?.left && lmk.left.length >= 21 ? liveFeatures(lmk.left) : null,
        right: lmk?.right && lmk.right.length >= 21 ? liveFeatures(lmk.right) : null,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  // Keyboard: 1 = record 👍, 2 = record ✊, 0/Esc = stop — hands stay free.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') arm(armedRef.current === 'thumbs_up' ? null : 'thumbs_up');
      else if (e.key === '2') arm(armedRef.current === 'not_thumb' ? null : 'not_thumb');
      else if (e.key === '0' || e.key === 'Escape') arm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arm]);

  const download = useCallback(() => {
    const payload = {
      app: 'gesturesynth-practice thumb-lab',
      version: 1,
      capturedAt: new Date().toISOString(),
      samples: samplesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `thumb-data-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clear = useCallback(() => {
    samplesRef.current = [];
    setCounts({ thumbs_up: 0, not_thumb: 0 });
  }, []);

  const total = counts.thumbs_up + counts.not_thumb;

  return (
    <div className="lab">
      <Tracker
        bridge={bridge}
        onStatus={setStatus}
        onError={setError}
        reportRef={reportRef}
        targetRef={targetRef}
      />
      <div className="lab-panel">
        <h1>👍 Thumb Lab</h1>
        <p className="lab-status">
          {STATUS_LABEL[status]}
          {error ? ` — ${error}` : ''}
        </p>
        <ol className="lab-steps">
          <li>
            Arm <strong>👍 Thumbs up</strong> and hold thumbs-ups — one hand or both, every wrist
            angle, all over the frame.
          </li>
          <li>
            Arm <strong>✊ Not a thumb</strong> and cycle through every kind of fist, open palms,
            chord shapes, sideways hands.
          </li>
          <li>
            <strong>Download JSON</strong> and drop it in the project folder.
          </li>
        </ol>
        <div className="lab-arm">
          <button
            type="button"
            className={`lab-btn lab-btn-up${armed === 'thumbs_up' ? ' armed' : ''}`}
            onClick={() => arm(armed === 'thumbs_up' ? null : 'thumbs_up')}
          >
            <span>{armed === 'thumbs_up' ? '● Recording 👍 — stop' : '👍 Record thumbs up'}</span>
            <kbd>1</kbd>
          </button>
          <button
            type="button"
            className={`lab-btn lab-btn-down${armed === 'not_thumb' ? ' armed' : ''}`}
            onClick={() => arm(armed === 'not_thumb' ? null : 'not_thumb')}
          >
            <span>{armed === 'not_thumb' ? '● Recording ✊ — stop' : '✊ Record not-a-thumb'}</span>
            <kbd>2</kbd>
          </button>
        </div>
        <p className="lab-counts">
          👍 {counts.thumbs_up} · ✊ {counts.not_thumb} · total {total}
        </p>
        <div className="lab-actions">
          <button
            type="button"
            className="lab-btn lab-btn-save"
            onClick={download}
            disabled={total === 0}
          >
            Download JSON
          </button>
          <button type="button" className="lab-btn lab-btn-clear" onClick={clear} disabled={total === 0}>
            Clear
          </button>
        </div>
      </div>
      <div className="lab-live" aria-hidden="true">
        <div>L {live.left ?? '—'}</div>
        <div>R {live.right ?? '—'}</div>
      </div>
    </div>
  );
}
