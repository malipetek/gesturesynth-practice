import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { RefObject, MutableRefObject } from 'react';
import type { HandFrame, LeftHandState, RightHandState } from './types';
import {
  classifyLeft,
  classifyRight,
  type HandLandmarks,
  type Landmark,
} from './gesture';

export type TrackingStatus =
  | 'idle'
  | 'requesting'
  | 'loading-model'
  | 'ready'
  | 'error'
  | 'no-camera';

export interface UseHandTrackingResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: TrackingStatus;
  error: string | null;
  frameRef: MutableRefObject<HandFrame | null>;
  /** Smoothed raw landmarks per hand, updated every detected frame (pre-debounce). */
  landmarksRef: MutableRefObject<HandLandmarks>;
}

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';
const EMA_ALPHA = 0.4;
const STABLE_MS = 50;
const HOLD_MS = 100;

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
};

type Side = 'left' | 'right';

function toLandmark(lm: { x: number; y: number; z: number }): Landmark {
  return { x: lm.x, y: lm.y, z: lm.z };
}

function emaSmooth(
  prev: Landmark[] | null,
  raw: Landmark[],
): Landmark[] {
  if (!prev) return raw;
  return prev.map((p, i) => {
    const n = raw[i];
    return {
      x: EMA_ALPHA * n.x + (1 - EMA_ALPHA) * p.x,
      y: EMA_ALPHA * n.y + (1 - EMA_ALPHA) * p.y,
      z:
        n.z !== undefined && p.z !== undefined
          ? EMA_ALPHA * n.z + (1 - EMA_ALPHA) * p.z
          : n.z,
    };
  });
}

function landmarkForSide(
  result: HandLandmarkerResult,
  side: 'Left' | 'Right',
): Landmark[] | null {
  for (let i = 0; i < result.landmarks.length; i++) {
    const name = result.handedness[i]?.[0]?.categoryName;
    if (name === side) {
      return result.landmarks[i].map(toLandmark);
    }
  }
  return null;
}

function signature(
  left: LeftHandState | null,
  right: RightHandState | null,
): string {
  return `${left?.degree ?? ''}|${left?.world ?? ''}|${
    right?.quality ?? ''
  }|${right?.octave ?? ''}`;
}

export function useHandTracking(): UseHandTrackingResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HandFrame | null>(null);
  const landmarksRef = useRef<HandLandmarks>({ left: null, right: null });
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;

    const smoothed = { left: null as Landmark[] | null, right: null as Landmark[] | null };
    let pending: { sig: string; since: number } | null = null;
    let publishedSig: string | null = null;
    let publishUntil = 0;

    function stopStream() {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject = null;
      }
    }

    async function init() {
      setStatus('requesting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS,
        });
      } catch {
        if (!cancelled) {
          setError('Could not access the webcam.');
          setStatus('no-camera');
        }
        return;
      }
      if (cancelled || !videoRef.current) {
        stopStream();
        return;
      }
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch {
        if (!cancelled) {
          setError('Could not start video playback.');
          setStatus('error');
        }
        stopStream();
        return;
      }
      if (cancelled) {
        stopStream();
        return;
      }

      setStatus('loading-model');
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      } catch {
        if (!cancelled) {
          setError('Failed to load the hand tracking model.');
          setStatus('error');
        }
        stopStream();
        return;
      }
      if (cancelled) {
        landmarker?.close();
        stopStream();
        return;
      }

      setStatus('ready');
      setError(null);

      function processFrame(result: HandLandmarkerResult) {
        const now = performance.now();
        const rawLeft = landmarkForSide(result, 'Left');
        const rawRight = landmarkForSide(result, 'Right');

        let left: LeftHandState | null = null;
        if (rawLeft) {
          smoothed.left = emaSmooth(smoothed.left, rawLeft);
          left = classifyLeft(smoothed.left);
        } else {
          smoothed.left = null;
        }
        let right: RightHandState | null = null;
        if (rawRight) {
          smoothed.right = emaSmooth(smoothed.right, rawRight);
          right = classifyRight(smoothed.right);
        } else {
          smoothed.right = null;
        }

        landmarksRef.current = { left: smoothed.left, right: smoothed.right };

        const sig = signature(left, right);

        if (sig !== publishedSig) {
          if (pending?.sig === sig) {
            if (now - pending.since >= STABLE_MS && now >= publishUntil) {
              frameRef.current = { left, right, timestamp: now };
              publishedSig = sig;
              publishUntil = now + HOLD_MS;
              pending = null;
            }
          } else {
            pending = { sig, since: now };
          }
        } else {
          pending = null;
          if (now >= publishUntil) {
            frameRef.current = { left, right, timestamp: now };
          }
        }
      }

      const loop = () => {
        if (cancelled) return;
        const video = videoRef.current;
        if (landmarker && video && video.readyState >= 2) {
          try {
            const result = landmarker.detectForVideo(video, performance.now());
            processFrame(result);
          } catch {
            // single frame failure should not stop the loop
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    void init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      stopStream();
    };
  }, []);

  return { videoRef, status, error, frameRef, landmarksRef };
}
