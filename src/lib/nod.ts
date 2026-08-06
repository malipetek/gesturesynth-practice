/**
 * Nod articulation — the manual note gate that neither reference site has.
 *
 * A forward wrist-flick (fingertips swing toward the camera) RE-ARTICULATES
 * the held chord; a backward flick CHOKES it. This lets fast passages be
 * played by holding the shape and nodding the rhythm, instead of re-forming
 * gestures at impossible speed.
 *
 * Detection is a high-pass on the depth channel (MediaPipe z, unused by
 * every other mapping), so it needs no calibration and never goes stale:
 *
 *   signal  = mean fingertip z − wrist z
 *   fast    = EMA(τ 80ms)   — where the hand is right now
 *   slow    = EMA(τ 1.5s)   — auto-recalibrating posture baseline
 *   hp      = fast − slow   — only fast motion registers
 *
 * forward = hp < −threshold (toward camera), backward = hp > +threshold.
 *
 * Three gates, each killing a distinct false-fire class (all verified by
 * synthetic-signal tests in scripts/nodtest.mjs):
 *
 *  1. RATE gate — a nod is FAST (hp swings ≈ 1 unit/s); posture drift is
 *     slow (≤0.03/s) but parks hp beyond the threshold for whole seconds,
 *     which would otherwise machine-gun events every refractory window.
 *     Requiring |dhp/dt| ≥ 0.25/s makes sustained drift inert.
 *  2. REFRACTORY (180ms) — every flick has a fast return swing; it lands
 *     inside this window and is ignored, so one nod = one event.
 *  3. PEAK-RELATIVE RE-ARM — after firing, the detector stays disarmed
 *     until hp returns at least halfway from the fired extreme (hysteresis),
 *     so a signal hovering just past the threshold can't stutter.
 *
 * Threshold 0.01 was tuned by hand in /nod-lab (live strip chart + labeled
 * time-series captures).
 */

export type NodEvent = 'forward' | 'backward';

export const NOD_THRESHOLD = 0.01;
export const NOD_REFRACTORY_MS = 180;
export const NOD_RATE_MIN = 0.25; // |dhp/dt| in z-units/sec
export const NOD_FAST_TAU_S = 0.08;
export const NOD_SLOW_TAU_S = 1.5;
const FAST_TAU_S = NOD_FAST_TAU_S;
const SLOW_TAU_S = NOD_SLOW_TAU_S;

interface ZPoint {
  z?: number;
}

export class NodDetector {
  private fast: number | null = null;
  private slow = 0;
  private lastEventAt = -Infinity;
  private prevHp: number | null = null;
  private armed = true;
  private peak = 0; // signed extreme hp that caused the current disarm
  /** High-passed flick channel from the latest update (null before seed). */
  hp: number | null = null;

  /** Fast EMA (current signal value) — for debug readouts. */
  get current(): number | null {
    return this.fast;
  }

  /** Slow EMA (auto-recalibrating baseline) — for debug readouts. */
  get baseline(): number {
    return this.slow;
  }

  constructor(
    public threshold = NOD_THRESHOLD,
    private readonly refractoryMs = NOD_REFRACTORY_MS,
  ) {}

  /**
   * Feed one frame. `lm` = the hand's 21 smoothed landmarks (or null when
   * the hand is absent — re-seeds the filter so re-entry never fires).
   * Returns the nod event for this frame, or null.
   */
  update(lm: ZPoint[] | null | undefined, nowMs: number, dtS: number): NodEvent | null {
    if (!lm || lm.length < 21) {
      this.fast = null;
      this.hp = null;
      return null;
    }
    const raw =
      ((lm[8].z ?? 0) + (lm[12].z ?? 0) + (lm[16].z ?? 0) + (lm[20].z ?? 0)) / 4 -
      (lm[0].z ?? 0);
    if (this.fast === null) {
      this.fast = raw;
      this.slow = raw;
      this.hp = 0;
      return null;
    }
    this.fast += (raw - this.fast) * (1 - Math.exp(-dtS / FAST_TAU_S));
    this.slow += (raw - this.slow) * (1 - Math.exp(-dtS / SLOW_TAU_S));
    const hp = this.fast - this.slow;
    const rate = this.prevHp !== null && dtS > 0 ? (hp - this.prevHp) / dtS : 0;
    this.prevHp = hp;
    this.hp = hp;

    // Disarmed: track the extreme, re-arm once the signal has returned at
    // least halfway from it (and the refractory has passed).
    if (!this.armed) {
      this.peak = this.peak < 0 ? Math.min(this.peak, hp) : Math.max(this.peak, hp);
      const halfway = this.peak * 0.5;
      const level =
        this.peak < 0 ? Math.min(-this.threshold * 0.5, halfway) : Math.max(this.threshold * 0.5, halfway);
      const returned = this.peak < 0 ? hp >= level : hp <= level;
      if (returned && nowMs - this.lastEventAt >= this.refractoryMs) this.armed = true;
      return null;
    }

    if (nowMs - this.lastEventAt < this.refractoryMs) return null;
    if (hp < -this.threshold && rate <= -NOD_RATE_MIN) {
      this.lastEventAt = nowMs;
      this.armed = false;
      this.peak = hp;
      return 'forward';
    }
    if (hp > this.threshold && rate >= NOD_RATE_MIN) {
      this.lastEventAt = nowMs;
      this.armed = false;
      this.peak = hp;
      return 'backward';
    }
    return null;
  }
}
