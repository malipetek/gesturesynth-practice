/**
 * Faithful port of the Gesture Synth (gesturesynth.com) sound engine,
 * reverse-engineered from the deployed bundle:
 *
 *   one sawtooth osc per chord note → lowpass 1200 Hz / Q 0.7 → master gain → out
 *
 * Their WaveShaper runs with curve = null (a passthrough), so it is omitted
 * here. The chord is a sustained organ-like voice held while the gesture is
 * held: volume follows right-wrist height, and the lowpass cutoff/resonance
 * follows right-wrist lateral lean:
 *
 *   tilt < 0: freq = 1200 − |tilt|·950, Q = 0.7 + |tilt|·1.5
 *   tilt > 0: freq = 1200 + tilt·3800, Q = 0.7 + tilt·4.5
 *
 * Metronome: all four of their sounds, 'click' at volume 0.25 by default:
 *   click — sine 1000/800 Hz, 60 ms decay
 *   wood  — triangle 1800/1400 → 200 Hz in 20 ms, 35 ms decay
 *   beep  — square 880/660 Hz, gain × 0.4, 50 ms decay
 *   hihat — squares [4000,6500,9000] / [5000,7500], gain × 0.35, 80/40 ms decay
 * All scaled by volume × (accent ? 1 : 0.7).
 */

const FILTER_BASE_HZ = 1200;
const FILTER_BASE_Q = 0.7;
const FILTER_SMOOTH_S = 0.04;
const VOLUME_RAMP_S = 0.05;
const CLICK_LEVEL = 0.25;
const STAB_ATTACK_S = 0.006;

export type MetronomeSound = 'click' | 'wood' | 'beep' | 'hihat';

/**
 * The GSVoice is raw Web Audio but must share Tone's context so scheduled
 * times line up with the Transport.
 */
export function audioContextFromTone(getContext: () => unknown): AudioContext {
  return (getContext() as { rawContext: AudioContext }).rawContext;
}

export class GSVoice {
  private readonly sweepFilter: BiquadFilterNode;
  private readonly fixedFilter: BiquadFilterNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private oscs: OscillatorNode[] = [];
  private currentKey: string | null = null;
  private metroSound: MetronomeSound = 'click';
  private metroVolume = CLICK_LEVEL;

  constructor(private readonly ctx: AudioContext) {
    // Four summed sawtooths can exceed 0 dBFS (worst with bright octave-up
    // voicings) — a fast limiter keeps the top end from cracking.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.limiter.connect(ctx.destination);

    // Live path: oscillators → swept filter → master (wrist volume) → out
    this.sweepFilter = ctx.createBiquadFilter();
    this.sweepFilter.type = 'lowpass';
    this.sweepFilter.frequency.value = FILTER_BASE_HZ;
    this.sweepFilter.Q.value = FILTER_BASE_Q;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.sweepFilter.connect(this.master);
    this.master.connect(this.limiter);

    // Scheduled path (listen-mode demo + backing pad): per-stab gain →
    // fixed 1200/0.7 filter → out
    this.fixedFilter = ctx.createBiquadFilter();
    this.fixedFilter.type = 'lowpass';
    this.fixedFilter.frequency.value = FILTER_BASE_HZ;
    this.fixedFilter.Q.value = FILTER_BASE_Q;
    this.fixedFilter.connect(this.limiter);
  }

  /** Sustained chord: one sawtooth per note, swapped only when notes change. */
  playNotes(freqs: number[]): void {
    if (freqs.length === 0) return;
    const key = freqs.map((f) => f.toFixed(1)).join(',');
    if (key === this.currentKey) return;
    this.stopChordOscillators();
    this.oscs = freqs.map((f) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(this.sweepFilter);
      osc.start();
      return osc;
    });
    this.currentKey = key;
  }

  /** Master volume 0..1 (right-wrist height), 50 ms linear ramp. */
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.master.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + VOLUME_RAMP_S);
  }

  /** Lowpass sweep from right-wrist lateral lean, −1..1. */
  updateFilterSweep(tilt: number): void {
    let freq = FILTER_BASE_HZ;
    let q = FILTER_BASE_Q;
    if (tilt < 0) {
      const amount = Math.abs(tilt);
      freq = FILTER_BASE_HZ - amount * 950;
      q = FILTER_BASE_Q + amount * 1.5;
    } else if (tilt > 0) {
      freq = FILTER_BASE_HZ + tilt * 3800;
      q = FILTER_BASE_Q + tilt * 4.5;
    }
    const now = this.ctx.currentTime;
    this.sweepFilter.frequency.setTargetAtTime(freq, now, FILTER_SMOOTH_S);
    this.sweepFilter.Q.setTargetAtTime(q, now, FILTER_SMOOTH_S);
  }

  /** One-shot scheduled chord (listen-mode demo stabs, backing pad). */
  stab(freqs: number[], time: number, duration: number, peak: number): void {
    const end = time + duration;
    // Normalize by note count so 4-note voicings don't stack into clipping.
    const level = peak / Math.max(1, freqs.length / 2);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level, time + STAB_ATTACK_S);
    gain.gain.setValueAtTime(level, Math.max(time + STAB_ATTACK_S, end - STAB_ATTACK_S));
    gain.gain.linearRampToValueAtTime(0, end);
    gain.connect(this.fixedFilter);
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(time);
      osc.stop(end + 0.01);
    }
    this.after(end + 0.1, () => gain.disconnect());
  }

  /** Metronome settings (their defaults: 'click', 0.25). */
  setMetronome(sound: MetronomeSound, volume: number): void {
    this.metroSound = sound;
    this.metroVolume = Math.max(0, Math.min(1, volume));
  }

  /** Metronome tick — their four sounds, ported 1:1. */
  click(time: number, accent: boolean): void {
    const level = this.metroVolume * (accent ? 1 : 0.7);
    const gain = this.ctx.createGain();
    gain.connect(this.ctx.destination);
    const cleanup = () => gain.disconnect();
    switch (this.metroSound) {
      case 'wood': {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(accent ? 1800 : 1400, time);
        osc.frequency.exponentialRampToValueAtTime(200, time + 0.02);
        gain.gain.setValueAtTime(level, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.04);
        this.after(time + 0.2, cleanup);
        break;
      }
      case 'beep': {
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = accent ? 880 : 660;
        gain.gain.setValueAtTime(level * 0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.06);
        this.after(time + 0.2, cleanup);
        break;
      }
      case 'hihat': {
        const freqs = accent ? [4000, 6500, 9000] : [5000, 7500];
        gain.gain.setValueAtTime(level * 0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + (accent ? 0.08 : 0.04));
        for (const f of freqs) {
          const osc = this.ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = f;
          osc.connect(gain);
          osc.start(time);
          osc.stop(time + 0.09);
        }
        this.after(time + 0.25, cleanup);
        break;
      }
      default: {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = accent ? 1000 : 800;
        gain.gain.setValueAtTime(level, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.07);
        this.after(time + 0.2, cleanup);
      }
    }
  }

  stopChordOscillators(): void {
    for (const osc of this.oscs) {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
    }
    this.oscs = [];
    this.currentKey = null;
  }

  stopAll(): void {
    this.setVolume(0);
    this.stopChordOscillators();
  }

  dispose(): void {
    this.stopAll();
    this.master.disconnect();
    this.sweepFilter.disconnect();
    this.fixedFilter.disconnect();
    this.limiter.disconnect();
  }

  /** Run a callback after an AudioContext-time deadline (node cleanup). */
  private after(ctxTime: number, fn: () => void): void {
    const ms = Math.max(0, (ctxTime - this.ctx.currentTime) * 1000);
    setTimeout(fn, ms);
  }
}
