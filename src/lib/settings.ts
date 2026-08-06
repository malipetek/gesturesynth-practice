import type { MetronomeSound, SynthTone } from './gsVoice';

/**
 * Practice sound settings, persisted to localStorage (same idea as Gesture
 * Synth's own 'music-synth-gesture-settings'). Defaults mirror their
 * initial settings, which are the ones the instrument ships with — the
 * tone default is 'warm' (triangle), the default on
 * gesture-synth-weld.vercel.app's toneSelect.
 */
export interface PracticeSettings {
  metroSound: MetronomeSound;
  /** 0..1, their default is 0.25 */
  metroVolume: number;
  tone: SynthTone;
}

const STORAGE_KEY = 'gs-practice-settings';

export const DEFAULT_SETTINGS: PracticeSettings = {
  metroSound: 'click',
  metroVolume: 0.25,
  tone: 'warm',
};

const SOUNDS: MetronomeSound[] = ['click', 'wood', 'beep', 'hihat'];
const TONES: SynthTone[] = ['warm', 'bright', 'retro'];

export function loadSettings(): PracticeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PracticeSettings>;
    return {
      metroSound: SOUNDS.includes(parsed.metroSound as MetronomeSound)
        ? (parsed.metroSound as MetronomeSound)
        : 'click',
      metroVolume:
        typeof parsed.metroVolume === 'number'
          ? Math.max(0, Math.min(1, parsed.metroVolume))
          : DEFAULT_SETTINGS.metroVolume,
      tone: TONES.includes(parsed.tone as SynthTone)
        ? (parsed.tone as SynthTone)
        : 'warm',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: PracticeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — settings just don't persist
  }
}