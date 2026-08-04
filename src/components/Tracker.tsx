import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
// @ts-ignore - provided by the parallel hand-tracking workstream; contract declared below
import { useHandTracking } from '../lib/useHandTracking';
import { FINGERTIPS, HAND_CONNECTIONS } from '../lib/gesture';
import type { HandLandmarks, Landmark } from '../lib/gesture';
import type { GestureTarget, HandFrame, MatchReport } from '../lib/types';
import type { TrackingStatus } from '../lib/useHandTracking';

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

interface HandTrackingResult {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  status: TrackingStatus;
  error: string | null;
  frameRef: MutableRefObject<HandFrame | null>;
  landmarksRef: MutableRefObject<HandLandmarks>;
}

export interface TrackerBridge {
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

export function Tracker({ bridge, onStatus, onError, reportRef, targetRef }: TrackerProps) {
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
