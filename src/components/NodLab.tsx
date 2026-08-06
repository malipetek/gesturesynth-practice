import { useCallback, useEffect, useRef, useState } from 'react';
import type { GestureTarget, MatchReport } from '../lib/types';
import type { TrackingStatus } from '../lib/useHandTracking';
import { Tracker, type TrackerBridge } from './Tracker';
import { NodDetector, NOD_THRESHOLD, NOD_FAST_TAU_S, NOD_SLOW_TAU_S } from '../lib/nod';
import './Player.css';
import './ThumbLab.css';
import './NodLab.css';

/**
 * Nod Lab — a feel-it-first workbench for the forward-tilt articulation
 * gesture ("drop the note with a slight forward flick of the hand").
 *
 * A nod is a MOTION, not a pose — so instead of static captures this page
 * shows the live signal and can record labeled time series:
 *
 *   signal  = mean fingertip z relative to wrist z (depth toward camera)
 *   fast    = EMA(τ≈80ms) of signal      — where the hand is right now
 *   slow    = EMA(τ≈1.5s) of signal      — the auto-recalibrating baseline
 *   hp      = fast − slow                — the flick channel we would gate on
 *
 * The strip chart scrolls the hp channel for both hands (mint = left,
 * coral = right) with ±threshold lines and a tick whenever it would fire,
 * so you can literally see a nod's spike shape vs. posture drift — and set
 * the threshold slider while watching. Record nods / not-nods and download
 * the JSON; offline analysis picks the real threshold + time constants.
 */

type Label = 'nod' | 'not_nod';

interface TraceSample {
  t: number;
  hand: 'left' | 'right';
  raw: number;
  fast: number;
  slow: number;
  hp: number;
  label: Label;
}

const WINDOW_MS = 6000;
const MAX_SAMPLES = 60000;

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for camera…',
  requesting: 'Requesting camera…',
  'loading-model': 'Loading hand model…',
  ready: 'Camera ready',
  error: 'Camera error',
  'no-camera': 'No camera found',
};

interface Pt {
  x: number;
  y: number;
  z?: number;
}

interface HandFilter {
  detector: NodDetector;
}

export default function NodLab() {
  const bridge = useRef<TrackerBridge>({ frameRef: null, videoRef: null, landmarksRef: null });
  const reportRef = useRef<MatchReport | null>(null);
  const targetRef = useRef<GestureTarget | null>(null);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<Label | null>(null);
  const armedRef = useRef<Label | null>(null);
  const samplesRef = useRef<TraceSample[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [threshold, setThreshold] = useState(NOD_THRESHOLD);
  const thresholdRef = useRef(NOD_THRESHOLD);
  const [fires, setFires] = useState({ left: 0, right: 0 });
  const [backFires, setBackFires] = useState({ left: 0, right: 0 });
  const [readout, setReadout] = useState<{ left: string; right: string }>({
    left: '—',
    right: '—',
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Ring buffer of chart points: t, hp per hand (null when hand absent).
  const traceRef = useRef<{ t: number; left: number | null; right: number | null }[]>([]);
  const filtersRef = useRef<Record<'left' | 'right', HandFilter>>({
    left: { detector: new NodDetector() },
    right: { detector: new NodDetector() },
  });
  const fireMarksRef = useRef<{ t: number; hand: 'left' | 'right'; dir: 'fwd' | 'back' }[]>([]);
  const lastReadoutRef = useRef(0);

  const arm = useCallback((label: Label | null) => {
    armedRef.current = label;
    setArmed(label);
  }, []);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);


  // Signal + chart loop.
  useEffect(() => {
    let raf = 0;
    let lastT = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;

      const lmk = bridge.current.landmarksRef?.current;
      const thr = thresholdRef.current;
      const hpOut: { left: number | null; right: number | null } = { left: null, right: null };

      for (const hand of ['left', 'right'] as const) {
        const lm = lmk?.[hand] as Pt[] | null | undefined;
        const f = filtersRef.current[hand];
        f.detector.threshold = thr;
        const ev = f.detector.update(lm, now, dt);
        const hp = f.detector.hp;
        if (hp === null) continue;
        hpOut[hand] = hp;

        if (ev) {
          fireMarksRef.current.push({ t: now, hand, dir: ev === 'forward' ? 'fwd' : 'back' });
          if (ev === 'forward') setFires((p) => ({ ...p, [hand]: p[hand] + 1 }));
          else setBackFires((p) => ({ ...p, [hand]: p[hand] + 1 }));
        }

        const label = armedRef.current;
        if (label && samplesRef.current.length < MAX_SAMPLES) {
          samplesRef.current.push({
            t: now,
            hand,
            raw: f.detector.current ?? 0,
            fast: f.detector.current ?? 0,
            slow: f.detector.baseline,
            hp,
            label,
          });
        }
      }

      traceRef.current.push({ t: now, left: hpOut.left, right: hpOut.right });
      const cutoff = now - WINDOW_MS;
      while (traceRef.current.length && traceRef.current[0].t < cutoff) traceRef.current.shift();
      while (fireMarksRef.current.length && fireMarksRef.current[0].t < cutoff)
        fireMarksRef.current.shift();

      // --- chart ---
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth * dpr;
        const H = canvas.clientHeight * dpr;
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        const g = canvas.getContext('2d');
        if (g) {
          g.clearRect(0, 0, W, H);
          const y0 = H / 2;
          const yScale = H / 0.3; // ±0.15 fills the strip
          const x = (t: number) => W - ((now - t) / WINDOW_MS) * W;

          g.strokeStyle = 'rgba(240,198,90,0.55)';
          g.lineWidth = 1 * dpr;
          g.setLineDash([4 * dpr, 4 * dpr]);
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(0, y0 - s * thr * yScale);
            g.lineTo(W, y0 - s * thr * yScale);
            g.stroke();
          }
          g.setLineDash([]);
          g.strokeStyle = 'rgba(232,244,248,0.18)';
          g.beginPath();
          g.moveTo(0, y0);
          g.lineTo(W, y0);
          g.stroke();

          const colors = { left: '#3dffe0', right: '#ff6b5a' } as const;
          for (const hand of ['left', 'right'] as const) {
            g.strokeStyle = colors[hand];
            g.lineWidth = 1.5 * dpr;
            g.beginPath();
            let pen = false;
            for (const p of traceRef.current) {
              const v = p[hand];
              if (v === null) {
                pen = false;
                continue;
              }
              const px = x(p.t);
              const py = y0 - v * yScale;
              if (!pen) {
                g.moveTo(px, py);
                pen = true;
              } else g.lineTo(px, py);
            }
            g.stroke();
          }

          // fire ticks: forward (play) at the top, backward (choke) at the bottom
          for (const m of fireMarksRef.current) {
            g.strokeStyle = colors[m.hand];
            g.lineWidth = 2 * dpr;
            g.beginPath();
            if (m.dir === 'fwd') {
              g.moveTo(x(m.t), 4 * dpr);
              g.lineTo(x(m.t), 16 * dpr);
            } else {
              g.moveTo(x(m.t), H - 4 * dpr);
              g.lineTo(x(m.t), H - 16 * dpr);
            }
            g.stroke();
          }
        }
      }

      // throttled numeric readout (~8 Hz)
      if (now - lastReadoutRef.current > 125) {
        lastReadoutRef.current = now;
        const fmt = (hand: 'left' | 'right') => {
          const d = filtersRef.current[hand].detector;
          if (d.current === null) return '—';
          const hp = hpOut[hand] ?? 0;
          return `raw ${d.current.toFixed(3)} · base ${d.baseline.toFixed(3)} · hp ${hp >= 0 ? '+' : ''}${hp.toFixed(3)}`;
        };
        setReadout({ left: fmt('left'), right: fmt('right') });
        setSampleCount(samplesRef.current.length);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard: 1 = record nod, 2 = record not-nod, 0/Esc = stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') arm(armedRef.current === 'nod' ? null : 'nod');
      else if (e.key === '2') arm(armedRef.current === 'not_nod' ? null : 'not_nod');
      else if (e.key === '0' || e.key === 'Escape') arm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arm]);

  const download = useCallback(() => {
    const payload = {
      app: 'gesturesynth-practice nod-lab',
      version: 1,
      capturedAt: new Date().toISOString(),
      fastTauS: NOD_FAST_TAU_S,
      slowTauS: NOD_SLOW_TAU_S,
      samples: samplesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `nod-data-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const clear = useCallback(() => {
    samplesRef.current = [];
    setSampleCount(0);
    setFires({ left: 0, right: 0 });
    setBackFires({ left: 0, right: 0 });
  }, []);

  return (
    <div className="lab">
      <Tracker
        bridge={bridge}
        onStatus={setStatus}
        onError={setError}
        reportRef={reportRef}
        targetRef={targetRef}
      />
      <div className="lab-panel nod-panel">
        <h1>🫳 Nod Lab</h1>
        <p className="lab-status">
          {STATUS_LABEL[status]}
          {error ? ` — ${error}` : ''}
        </p>
        <p className="nod-explainer">
          The strip shows the <em>flick channel</em> (fast − slow baseline) of each hand's
          depth signal. <strong>Flick forward</strong> (toward the camera) = <em>play</em>,
          tick at the top; <strong>flick backward</strong> = <em>silence</em>, tick at the
          bottom. Slow posture drift stays flat — the baseline auto-follows it.
        </p>
        <div className="nod-chart-wrap">
          <canvas ref={canvasRef} className="nod-chart" />
        </div>
        <div className="nod-readout" aria-hidden="true">
          <div className="l">L {readout.left}</div>
          <div className="r">R {readout.right}</div>
        </div>
        <label className="nod-threshold">
          <span>
            threshold <strong>{threshold.toFixed(3)}</strong> (play below −thr · choke above +thr)
          </span>
          <input
            type="range"
            min={0.005}
            max={0.1}
            step={0.005}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </label>
        <p className="lab-counts">
          play — L {fires.left} · R {fires.right} · choke — L {backFires.left} · R{' '}
          {backFires.right} · recorded samples {sampleCount}
        </p>
        <div className="lab-arm">
          <button
            type="button"
            className={`lab-btn lab-btn-up${armed === 'nod' ? ' armed' : ''}`}
            onClick={() => arm(armed === 'nod' ? null : 'nod')}
          >
            <span>{armed === 'nod' ? '● Recording NOD — stop' : '🫳 Record nods'}</span>
            <kbd>1</kbd>
          </button>
          <button
            type="button"
            className={`lab-btn lab-btn-down${armed === 'not_nod' ? ' armed' : ''}`}
            onClick={() => arm(armed === 'not_nod' ? null : 'not_nod')}
          >
            <span>{armed === 'not_nod' ? '● Recording NOT — stop' : '✋ Record not-nods'}</span>
            <kbd>2</kbd>
          </button>
        </div>
        <p className="nod-explainer dim">
          For "not-nods": play air chords, change shapes, raise/lower hands for volume,
          lean for tilt — everything you do while actually playing.
        </p>
        <div className="lab-actions">
          <button
            type="button"
            className="lab-btn lab-btn-save"
            onClick={download}
            disabled={sampleCount === 0}
          >
            Download JSON
          </button>
          <button
            type="button"
            className="lab-btn lab-btn-clear"
            onClick={clear}
            disabled={sampleCount === 0}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
