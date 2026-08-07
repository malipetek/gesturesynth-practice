import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * The nod-lab strip chart as a reusable component: scrolling flick-channel
 * traces (mint = left hand, coral = right), ±threshold lines, fire ticks
 * (forward/play at the top, backward/choke at the bottom).
 *
 * Imperative API — callers run their own rAF/detector loop and push values
 * per frame; drawing happens on push.
 */

export interface NodChartHandle {
  push(t: number, left: number | null, right: number | null): void;
  mark(t: number, hand: 'left' | 'right', dir: 'fwd' | 'back'): void;
}

const WINDOW_MS = 6000;

const NodChart = forwardRef<NodChartHandle, { threshold: number; className?: string }>(
  function NodChart({ threshold, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const traceRef = useRef<{ t: number; left: number | null; right: number | null }[]>([]);
    const marksRef = useRef<{ t: number; hand: 'left' | 'right'; dir: 'fwd' | 'back' }[]>([]);
    const thresholdRef = useRef(threshold);

    useEffect(() => {
      thresholdRef.current = threshold;
    }, [threshold]);

    useImperativeHandle(
      ref,
      () => ({
        push(t, left, right) {
          traceRef.current.push({ t, left, right });
          const cutoff = t - WINDOW_MS;
          while (traceRef.current.length && traceRef.current[0].t < cutoff) traceRef.current.shift();
          while (marksRef.current.length && marksRef.current[0].t < cutoff) marksRef.current.shift();
          draw(t);
        },
        mark(t, hand, dir) {
          marksRef.current.push({ t, hand, dir });
        },
      }),
      [],
    );

    function draw(now: number): void {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth * dpr;
      const H = canvas.clientHeight * dpr;
      if (W === 0 || H === 0) return;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, W, H);
      const y0 = H / 2;
      const yScale = H / 0.3; // ±0.15 fills the strip
      const x = (t: number) => W - ((now - t) / WINDOW_MS) * W;
      const thr = thresholdRef.current;

      // threshold lines
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
      // zero line
      g.strokeStyle = 'rgba(232,244,248,0.18)';
      g.beginPath();
      g.moveTo(0, y0);
      g.lineTo(W, y0);
      g.stroke();

      // traces
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
      for (const m of marksRef.current) {
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

    return <canvas ref={canvasRef} className={className ?? 'nod-chart'} />;
  },
);

export default NodChart;
