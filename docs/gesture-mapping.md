# Gesture Mapping — reverse-engineered from gesturesynth.com

Ground truth extracted from the deployed bundle (`/assets/index-5EUKPq8d.js`) so the
practice app's classifier matches the real instrument. If Gesture Synth changes its
mapping, this is the file to update (plus `src/lib/gesture.ts`).

## Finger extension (same for both hands)

A finger counts as "up" when its tip is above its pip joint (screen y):

| Finger | pip | tip |
| ------ | --- | --- |
| index  | 6   | 8   |
| middle | 10  | 12  |
| ring   | 14  | 16  |
| pinky  | 18  | 20  |

Thumb "extended" is lateral: `tip.x > base.x` on the right hand, `tip.x < base.x` on
the left (landmarks 4 and 3).

## Left hand — scale degree + world

- Degree: count of raised fingers → I (1) … V (5). Special combos:
  - **VI** = index + pinky raised, middle + ring down, thumb down
  - **VII** = index + pinky raised, middle + ring down, thumb up
- World (major/minor): wrist tilt — `middleMCP.x > wrist.x` ⇒ minor, else major.
  In the mirrored selfie view this reads as: left-hand fingers leaning **right** ⇒
  minor, leaning **left** ⇒ major (verified with real-hands testing).

On-screen help text: *"Raise fingers to pick a scale degree (I–V). Index + pinky makes
VI; add the thumb for VII. By default, tilt flips major ↔ minor."*

## Right hand — quality + octave + dynamics

- Quality: raised finger count 1–4 →
  1. Major triad / Minor triad
  2. Major 1st inv. / Minor 1st inv.
  3. Major 7th / Minor 7th
  4. Dominant 7th / Diminished 7th
- Octave: thumb. Thumb down ⇒ one octave down. (Assumption: thumb up = +1, down = −1.)
- Volume: right wrist height, clamped 0.05–0.95 (top = 1).
- Tone: right wrist lateral lean relative to middle/ring MCP span (±0.12 x), −1..1.

## Chord → gesture target (song transpile step)

Given a chord symbol and the song key (Tonal.js):

- Root interval from tonic → scale degree (1–7) in the key's major/minor scale.
- World from the chord's own third: major third ⇒ `major`, minor/diminished ⇒ `minor`.
- Quality index:
  - major world: triad=1, first inversion (bass ≠ root)=2, maj7=3, dominant7=4
  - minor world: minor triad=1, first inversion=2, minor7=3, diminished7=4
- Octave: default +1 (thumb up). Inversions handled via quality, not octave.

## Sound engine (verified against the deployed bundle)

The instrument is raw Web Audio — one sawtooth osc per chord note → lowpass
1200 Hz / Q 0.7 → master gain (WaveShaper present but `curve = null`, a
passthrough). Chords sustain organ-style while the gesture holds; volume
follows right-wrist height (50 ms ramp); the filter follows wrist lean:

- lean < 0: cutoff = 1200 − |t|·950, Q = 0.7 + |t|·1.5
- lean > 0: cutoff = 1200 + t·3800, Q = 0.7 + t·4.5

### Voicings (their exact note tables)

Root = key table (C4 = 261.63 …), third = root·2^((major?4:3)/12), fifth = +7:

- Q1 triad: `[root, fifth, root·2, third·2]` (open voicing)
- Q2 1st inv: `[third, fifth, root·2, third·2]`
- Q3: major `[root, third, fifth, +11]` (maj7) · minor `[root, third, fifth, +10]` (m7)
- Q4: major `[root, third, fifth, +10]` (dom7) · minor `[root, third, +6, +9]` (dim7)

Degree roots within the key: `{1:0, 2:2, 3:4, 4:5, 5:7, 6:9, 7:-1}` semitones
(VII sits a semitone *below* the tonic). Octave down = all freqs ÷ 2.

### Metronome (4 sounds, default `click` @ 0.25)

- click: sine 1000/800 Hz, 60 ms decay
- wood: triangle 1800/1400 → 200 Hz in 20 ms, 35 ms decay
- beep: square 880/660, gain ×0.4, 50 ms decay
- hihat: squares [4000,6500,9000] / [5000,7500], gain ×0.35, 80/40 ms decay

### Their app settings (defaults = what we adopt)

`localStorage['music-synth-gesture-settings']`:
`{ modeControl: 'tilt', fixedMode: 'major', qualityControl: 'fingers', fixedQuality: 1 }`.
Left hand: tilt vs lock mode (lock = fingers pick degree only, major/minor set
in UI). Right hand: finger count vs locked chord style. These locks conflict
with per-chord practice targets, so the practice app exposes only the
metronome sound/volume (`localStorage['gs-practice-settings']`).

## Open assumptions (verify against the real site when possible)

- Thumb-up octave sign (+1) and whether base octave is 0 or +1.
- Non-diatonic chords (sus, aug, 9ths) fall back to nearest quality / world by third.
