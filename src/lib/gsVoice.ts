/**
 * Faithful port of the Gesture Synth sound engine — verified against the
 * open-source repo (github.com/Ekmand/music-synth, src/audio/SynthEngine.ts):
 *
 *   one osc per chord note → lowpass 1200 Hz / Q 0.7 → master gain → out
 *
 * The oscillator type is their toneSelect: triangle ("Warm Synth", the
 * default on gesture-synth-weld.vercel.app — and ours), sawtooth ("Bright"),
 * square ("Retro").
 *
 * Their WaveShaper runs with curve = null (a passthrough), so it is omitted
 * here. There is NO compressor/limiter anywhere in their chain — the raw
 * sawtooth sum is part of the sound. The chord is a sustained organ-like
 * voice held while the gesture is held: volume = right-wrist height
 * (absolute, clamped 0..1, 50 ms ramp), and the lowpass cutoff/resonance
 * follows right-wrist tilt (their wristTilt, sign-inverted for right hand):
 *
 *   tilt < 0: freq = 1200 − |tilt|·950, Q = 0.7 + |tilt|·1.5
 *   tilt > 0: freq = 1200 + tilt·3800, Q = 0.7 + tilt·4.5
 *
 * Scheduled stabs (demo/backing — a practice-app addition, they don't exist
 * upstream) share the SAME swept filter through a per-stab envelope, so
 * listed notes and hand-played notes are the same instrument.
 *
 * Theremin mode (their second instrument): sine through the same filter,
 * pitch = right-hand height (exp 65–1200 Hz), volume = left-hand height
 * × 0.55.
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
 * Their toneSelect (verified in the gesture-synth-weld.vercel.app deployment,
 * where "Warm Synth" is the default):
 *   warm   → triangle (their default — the mellow one)
 *   bright → sawtooth (what gesturesynth.com ships with)
 *   retro  → square
 */
export type SynthTone = 'warm' | 'bright' | 'retro';

export const TONE_OSC_TYPE: Record<SynthTone, OscillatorType> = {
  warm: 'triangle',
  bright: 'sawtooth',
  retro: 'square',
};

/**
 * The GSVoice is raw Web Audio but must share Tone's context so scheduled
 * times line up with the Transport.
 */
export function audioContextFromTone(getContext: () => unknown): AudioContext {
  return (getContext() as { rawContext: AudioContext }).rawContext;
}

export class GSVoice {
  private readonly sweepFilter: BiquadFilterNode;
  private readonly liveGain: GainNode;
  private oscs: OscillatorNode[] = [];
  private currentKey: string | null = null;
  private thereminOsc: OscillatorNode | null = null;
  private thereminGain: GainNode | null = null;
  private metroSound: MetronomeSound = 'click';
  private metroVolume = CLICK_LEVEL;
  private tone: SynthTone = 'warm';

  constructor(private readonly ctx: AudioContext) {
    // Their chain: sawtooth oscs → swept lowpass → master gain → destination.
    // No compressor/limiter — the raw sum is part of the sound. Our stabs
    // (practice-app addition) tap the same filter through their own envelope
    // so listed notes and hand-played notes are the same instrument:
    //
    //   live oscs → liveGain (wrist volume) ┐
    //   stab oscs → per-stab envelope      ─┴→ sweepFilter → destination
    this.sweepFilter = ctx.createBiquadFilter();
    this.sweepFilter.type = 'lowpass';
    this.sweepFilter.frequency.value = FILTER_BASE_HZ;
    this.sweepFilter.Q.value = FILTER_BASE_Q;
    this.sweepFilter.connect(ctx.destination);
    this.liveGain = ctx.createGain();
    this.liveGain.gain.value = 0;
    this.liveGain.connect(this.sweepFilter);
  }

  /** Sustained chord: one sawtooth per note, swapped only when notes change. */
  playNotes(freqs: number[]): void {
    if (freqs.length === 0) return;
    this.stopTheremin();
    const key = freqs.map((f) => f.toFixed(1)).join(',');
    if (key === this.currentKey) return;
    this.stopChordOscillators();
    this.oscs = freqs.map((f) => {
      const osc = this.ctx.createOscillator();
      osc.type = TONE_OSC_TYPE[this.tone];
      osc.frequency.value = f;
      osc.connect(this.liveGain);
      osc.start();
      return osc;
    });
    this.currentKey = key;
  }

  /** Right-wrist height → chord volume (absolute 0..1, 50 ms ramp — theirs). */
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.liveGain.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + VOLUME_RAMP_S);
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
    gain.connect(this.sweepFilter);
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = TONE_OSC_TYPE[this.tone];
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

  /** Their toneSelect behavior: force re-voice so the next chord uses it. */
  setTone(tone: SynthTone): void {
    if (this.tone === tone) return;
    this.tone = tone;
    this.currentKey = null;
    this.stopChordOscillators();
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

  /** Theremin mode (their second instrument): sine through the shared filter. */
  playTheremin(freq: number, volume: number): void {
    this.stopChordOscillators();
    if (!this.thereminOsc) {
      this.thereminGain = this.ctx.createGain();
      this.thereminGain.gain.value = 0;
      this.thereminOsc = this.ctx.createOscillator();
      this.thereminOsc.type = 'sine';
      this.thereminOsc.connect(this.thereminGain);
      this.thereminGain.connect(this.sweepFilter);
      this.thereminOsc.start();
    }
    const now = this.ctx.currentTime;
    this.thereminOsc.frequency.setTargetAtTime(Math.max(20, freq), now, 0.03);
    this.thereminGain!.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), now, 0.04);
  }

  stopThereminAudio(): void {
    this.thereminGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
  }

  private stopTheremin(): void {
    if (this.thereminOsc) {
      try {
        this.thereminOsc.stop();
      } catch {
        // already stopped
      }
      this.thereminOsc.disconnect();
      this.thereminOsc = null;
    }
    if (this.thereminGain) {
      this.thereminGain.disconnect();
      this.thereminGain = null;
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
    this.stopTheremin();
  }

  dispose(): void {
    this.stopAll();
    this.liveGain.disconnect();
    this.sweepFilter.disconnect();
  }

  /** Run a callback after an AudioContext-time deadline (node cleanup). */
  private after(ctxTime: number, fn: () => void): void {
    const ms = Math.max(0, (ctxTime - this.ctx.currentTime) * 1000);
    setTimeout(fn, ms);
  }
}
