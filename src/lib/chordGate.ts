/**
 * Chord-commit gate — the deliberate-latency half of the smooth-playing
 * trade (see gsVoice.ts for the audio half).
 *
 * Raw per-frame chord classification is jittery: while the hand travels
 * between two shapes, MediaPipe + the classifier can land on a THIRD,
 * unintended shape for a single frame — and if every frame goes straight
 * to the audio engine, that misread plays as a wrong-chord blip.
 *
 * The gate requires a candidate shape to be stable for `confirmFrames`
 * consecutive frames (~40–70 ms at 30–60 fps) before the audio follows
 * it. One-frame glitches die as candidates and never make sound; note-off
 * is gated the same way so a single dropped tracking frame doesn't chop
 * the chord.
 *
 * Total added latency: confirm window + gsVoice's 60 ms look-ahead
 * ≈ 100–130 ms from shape to sound — the trade the user opted into for
 * glitch-free fast playing. Visual HUD feedback should stay INSTANT
 * (driven from the raw frame, not the gate) so the player still feels
 * directly connected.
 */

export class ChordGate<T> {
  private candidateKey: string | null = null;
  private candidatePayload: T | null = null;
  private candidateFrames = 0;
  private committedKey: string | null = null;
  private committedPayload: T | null = null;

  constructor(private readonly confirmFrames = 2) {}

  /** Whether a chord (not silence) is currently committed. */
  get sounding(): boolean {
    return this.committedKey !== null;
  }

  /**
   * Feed one frame. `key` identifies the shape (null = no chord);
   * `payload` is what the audio engine needs when it commits.
   * Returns the committed payload and whether it changed this frame.
   */
  update(key: string | null, payload: T | null): { changed: boolean; payload: T | null } {
    if (key === this.committedKey) {
      this.candidateKey = null;
      this.candidateFrames = 0;
      return { changed: false, payload: this.committedPayload };
    }
    if (key !== this.candidateKey) {
      this.candidateKey = key;
      this.candidatePayload = payload;
      this.candidateFrames = 1;
      return { changed: false, payload: this.committedPayload };
    }
    this.candidateFrames++;
    this.candidatePayload = payload; // freshest payload for the pending shape
    if (this.candidateFrames >= this.confirmFrames) {
      this.committedKey = key;
      this.committedPayload = this.candidatePayload;
      this.candidateKey = null;
      this.candidateFrames = 0;
      return { changed: true, payload: this.committedPayload };
    }
    return { changed: false, payload: this.committedPayload };
  }

  reset(): void {
    this.candidateKey = null;
    this.candidatePayload = null;
    this.candidateFrames = 0;
    this.committedKey = null;
    this.committedPayload = null;
  }
}
