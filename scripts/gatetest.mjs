// ChordGate + crossfade verification against the REAL modules.
// Part 1 (gate logic): synthetic key streams — a 1-frame glitch between two
//   stable shapes must NEVER commit; note-off is gated the same way.
// Part 2 (audio): OfflineAudioContext render of a chord swap — both chords
//   must sound, and the max sample-to-sample jump at the swap must be small
//   (no click).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4322/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const result = await page.evaluate(async () => {
  const { ChordGate } = await import('/src/lib/chordGate.ts');
  const { GSVoice } = await import('/src/lib/gsVoice.ts');

  // Part 1: gate logic
  const g = new ChordGate(2);
  const seq = [
    null, null,
    'A', 'A',        // A commits at frame 2
    'A', 'B', 'A',   // 1-frame B glitch — must not commit
    'A',
    'B', 'B',        // B commits
    null,            // 1-frame null — must not release yet
    'B',
    null, null,      // null commits (note off)
  ];
  const commits = [];
  for (const k of seq) {
    const r = g.update(k, k);
    if (r.changed) commits.push(r.payload);
  }
  const gateOk =
    commits.length === 3 && commits[0] === 'A' && commits[1] === 'B' && commits[2] === null;

  // Part 2: crossfade render — C major → F major swap mid-render
  const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
  const voice = new GSVoice(ctx);
  voice.playNotes([261.63, 329.63, 392.0]); // C E G
  voice.setVolume(0.8);
  ctx.suspend(1.0).then(() => {
    voice.playNotes([174.61, 220.0, 261.63]); // F A C — swap
    ctx.resume();
  });
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  const rms = (a, b) => {
    let s = 0;
    for (let i = Math.floor(a * 44100); i < Math.floor(b * 44100); i++) s += data[i] * data[i];
    return Math.sqrt(s / Math.max(1, Math.floor((b - a) * 44100)));
  };
  // max sample-to-sample jump (click detector) around the swap region
  let maxJump = 0;
  for (let i = Math.floor(1.0 * 44100); i < Math.floor(1.2 * 44100); i++) {
    const j = Math.abs(data[i] - data[i - 1]);
    if (j > maxJump) maxJump = j;
  }
  const before = rms(0.6, 0.95);   // C chord sounding (after 60ms lookahead + fade)
  const during = rms(1.07, 1.12);  // crossfade region — should not be silent
  const after = rms(1.35, 1.8);    // F chord sounding
  return { gateOk, commits, before, during, after, maxJump };
});
await browser.close();
console.log(JSON.stringify(result, null, 1));
const audioOk =
  result.before > 0.03 &&
  result.after > 0.03 &&
  result.during > result.before * 0.05 &&
  result.maxJump < 0.25; // a click would be a near-full-scale jump
console.log(
  `before=${result.before.toFixed(3)} during=${result.during.toFixed(3)} after=${result.after.toFixed(3)} maxJump=${result.maxJump.toFixed(3)}`,
);
console.log(result.gateOk && audioOk ? 'GATETEST PASS' : 'GATETEST FAIL');
process.exit(result.gateOk && audioOk ? 0 : 1);
