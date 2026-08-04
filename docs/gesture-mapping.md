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

## Open assumptions (verify against the real site when possible)

- Thumb-up octave sign (+1) and whether base octave is 0 or +1.
- Non-diatonic chords (sus, aug, 9ths) fall back to nearest quality / world by third.
