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
 * Two parallel channels — either one can fire, whichever crosses first:
 *
 *  A. DEPTH channel (above): fingertip z relative to wrist. Precise, but
 *     needs a visible forward swing at a cooperative hand angle.
 *  B. SCALE channel: palm size — mean wrist→knuckle (MCP 5/9/13/17)
 *     distance, in log units. The palm bones are rigid (finger curl and
 *     fist/open shapes barely move it), but moving the hand toward the
 *     camera grows the projected palm fast at ANY angle — so this channel
 *     fires on small, natural pushes that the depth channel misses.
 *     Forward = palm grows quickly, backward = shrinks quickly.
 *
 * Three gates, each killing a distinct false-fire class (all verified by
 * synthetic-signal tests in scripts/nodtest.mjs):
 *
 *  1. RATE gate — a nod is FAST (hp swings ≈ 1 unit/s); posture drift is
 *     slow but parks hp beyond the threshold for whole seconds, which
 *     would otherwise machine-gun events every refractory window.
 *  2. REFRACTORY (180ms) — every flick has a fast return swing; it lands
 *     inside this window and is ignored, so one nod = one event.
 *  3. PEAK-RELATIVE RE-ARM — after firing, the detector stays disarmed
 *     until hp returns at least halfway from the fired extreme (hysteresis),
 *     so a signal hovering just past the threshold can't stutter.
 *
 * The exposed `hp` is the stronger of the two channels, normalized so that
 * ±threshold on the strip chart is always the exact fire line.
 *
 * Depth threshold 0.01 was tuned by hand in /nod-lab; scale threshold 0.03
 * (≈3% fast palm-size change) from synthetic motion profiles.
 */

export type NodEvent = 'forward' | 'backward';

export const NOD_THRESHOLD = 0.01;
// 130 ms caps articulation at ~7 nods/sec — 16th notes at ≈160 BPM.
export const NOD_REFRACTORY_MS = 130;
export const NOD_RATE_MIN = 0.25; // depth channel |dhp/dt| in z-units/sec
export const NOD_SCALE_THRESHOLD = 0.03; // log palm-size units (≈3% fast change)
export const NOD_SCALE_RATE_MIN = 0.3; // scale channel |dhp/dt| in log-units/sec
export const NOD_FAST_TAU_S = 0.06; // snappier tracking for fast songs
export const NOD_SLOW_TAU_S = 1.5;
const FAST_TAU_S = NOD_FAST_TAU_S;
const SLOW_TAU_S = NOD_SLOW_TAU_S;

const MCPS = [5, 9, 13, 17] as const;

interface ZPoint {
  x: number;
  y: number;
  z?: number;
}

export class NodDetector {
  private fast: number | null = null;
  private slow = 0;
  private sFast: number | null = null; // scale channel fast EMA (log palm size)
  private sSlow = 0; // scale channel slow EMA
  private lastEventAt = -Infinity;
  private prevHp: number | null = null;
  private prevSHp: number | null = null;
  private armed = true;
  private peak = 0; // signed extreme hp that caused the current disarm
  /**
   * Settle tracking: a backward event may only fire after the signal has
   * been near zero since the last event. This kills the classic false
   * choke — the fast RETURN swing of a forward nod crosses +threshold with
   * high rate, but it never passed through the settled zone first.
   */
  private settled = true;
  private prevSig: number | null = null;
  /**
   * Momentary push state (gate mode): true while the hand is pushed
   * forward past the threshold. Released by coming back near zero OR by
   * any clear return motion — no deliberate "back nod" needed.
   * Sign convention: forward = negative.
   */
  pushed = false;
  /**
   * The stronger of the two flick channels from the latest update,
   * normalized into depth-threshold units (so ±threshold is the fire line
   * on the strip chart). Forward = negative, backward = positive.
   * Null before seed.
   */
  hp: number | null = null;

  /** Fast EMA (current depth signal value) — for debug readouts. */
  get current(): number | null {
    return this.fast;
  }

  /** Slow EMA (auto-recalibrating depth baseline) — for debug readouts. */
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
      this.sFast = null;
      this.hp = null;
      this.pushed = false;
      return null;
    }
    // Channel A: fingertip depth relative to wrist.
    const raw =
      ((lm[8].z ?? 0) + (lm[12].z ?? 0) + (lm[16].z ?? 0) + (lm[20].z ?? 0)) / 4 -
      (lm[0].z ?? 0);
    // Channel B: palm size (rigid bones) in log units — grows toward camera.
    let palm = 0;
    for (const i of MCPS) {
      palm += Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y);
    }
    // Guard against degenerate frames (all points coincident → log(0)).
    const rawScale = Math.log(Math.max(palm / MCPS.length, 1e-4));
    if (this.fast === null || this.sFast === null) {
      this.fast = raw;
      this.slow = raw;
      this.sFast = rawScale;
      this.sSlow = rawScale;
      this.hp = 0;
      return null;
    }
    const aF = 1 - Math.exp(-dtS / FAST_TAU_S);
    // While pushed (gate mode holds a note), the baseline adapts ~5x slower —
    // otherwise a held push decays back to zero in ~2s and the note would
    // auto-release. At rest, the normal 1.5s recalibration applies.
    const slowTau = this.pushed ? 8.0 : SLOW_TAU_S;
    const aS = 1 - Math.exp(-dtS / slowTau);
    this.fast += (raw - this.fast) * aF;
    this.slow += (raw - this.slow) * aS;
    this.sFast += (rawScale - this.sFast) * aF;
    this.sSlow += (rawScale - this.sSlow) * aS;
    const hp = this.fast - this.slow;
    const sHp = this.sFast - this.sSlow;
    const rate = this.prevHp !== null && dtS > 0 ? (hp - this.prevHp) / dtS : 0;
    const sRate = this.prevSHp !== null && dtS > 0 ? (sHp - this.prevSHp) / dtS : 0;
    this.prevHp = hp;
    this.prevSHp = sHp;
    // Expose the stronger channel, normalized so ±threshold is the fire line.
    // Forward = negative on both channels (scale is negated to match depth).
    const sNorm = (-sHp / NOD_SCALE_THRESHOLD) * this.threshold;
    this.hp = Math.abs(sNorm) > Math.abs(hp) ? sNorm : hp;
    const sig = this.hp;

    // Settle tracking: has the signal been near zero since the last event?
    if (Math.abs(sig) <= this.threshold * 0.5) this.settled = true;

    // Momentary push state. Enter: sig < −threshold. Exit: either the hand
    // is back near rest (sig > −0.5·threshold) OR it is clearly moving back
    // (negative-going rate, i.e. sig rising toward zero) — so relaxing the
    // push releases the note without any deliberate "back nod".
    const sigRate = this.prevSig !== null && dtS > 0 ? (sig - this.prevSig) / dtS : 0;
    this.prevSig = sig;
    if (!this.pushed && sig < -this.threshold) {
      this.pushed = true;
    } else if (
      this.pushed &&
      (sig > -this.threshold * 0.5 || sigRate > this.threshold * 15)
    ) {
      this.pushed = false;
    }

    // Disarmed: track the extreme, re-arm once the signal has returned at
    // least halfway from it (and the refractory has passed).
    if (!this.armed) {
      this.peak = this.peak < 0 ? Math.min(this.peak, sig) : Math.max(this.peak, sig);
      const halfway = this.peak * 0.5;
      const level =
        this.peak < 0 ? Math.min(-this.threshold * 0.5, halfway) : Math.max(this.threshold * 0.5, halfway);
      const returned = this.peak < 0 ? sig >= level : sig <= level;
      if (returned && nowMs - this.lastEventAt >= this.refractoryMs) this.armed = true;
      return null;
    }

    if (nowMs - this.lastEventAt < this.refractoryMs) return null;
    // Forward = toward camera: negative on both channels.
    const fwdDepth = hp < -this.threshold && rate <= -NOD_RATE_MIN;
    const fwdScale = sHp > NOD_SCALE_THRESHOLD && sRate >= NOD_SCALE_RATE_MIN;
    if (fwdDepth || fwdScale) {
      this.lastEventAt = nowMs;
      this.armed = false;
      this.settled = false;
      this.peak = fwdDepth ? hp : sNorm;
      return 'forward';
    }
    // Backward requires the signal to have SETTLED near zero since the last
    // event — otherwise the return swing of a forward nod would "choke".
    const backDepth = hp > this.threshold && rate >= NOD_RATE_MIN;
    const backScale = sHp < -NOD_SCALE_THRESHOLD && sRate <= -NOD_SCALE_RATE_MIN;
    if ((backDepth || backScale) && this.settled) {
      this.lastEventAt = nowMs;
      this.armed = false;
      this.settled = false;
      this.peak = backDepth ? hp : sNorm;
      return 'backward';
    }
    return null;
  }
}
