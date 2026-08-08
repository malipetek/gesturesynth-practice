// Momentary nod AUDIO verification — renders the GSVoice envelope through an
// OfflineAudioContext (real DSP, not a mock) and measures RMS around a choke
// (release @ 0.6s) and an articulate (push @ 1.4s):
//   sounding → choke → SMOOTH fade to silence → articulate → SMOOTH swell back
// Asserts: fade is gradual (partial level right after choke, not instant cut),
// silence is reached, swell restores, and there are no clicks (maxJump).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:4322/', { waitUntil: 'domcontentloaded', timeout: 30000 });
const r = await page.evaluate(async () => {
  const { GSVoice } = await import('/src/lib/gsVoice.ts');
  const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
  const voice = new GSVoice(ctx);
  voice.playNotes([220, 277.18, 329.63]); // sustained chord
  voice.setVolume(0.8);
  // suspend/resume must be registered BEFORE startRendering
  ctx.suspend(0.6).then(() => { voice.choke(); ctx.resume(); });      // release (fade out)
  ctx.suspend(1.4).then(() => { voice.articulate(); ctx.resume(); }); // push (swell in)
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  const win = (a, b) => {
    let s = 0;
    for (let i = Math.floor(a * 44100); i < Math.floor(b * 44100); i++) s += data[i] * data[i];
    return Math.sqrt(s / Math.max(1, Math.floor((b - a) * 44100)));
  };
  let maxJump = 0;
  for (let i = 1; i < data.length; i++) {
    const j = Math.abs(data[i] - data[i - 1]);
    if (j > maxJump) maxJump = j;
  }
  return {
    before: win(0.3, 0.55),     // sounding
    fading: win(0.62, 0.68),    // just after choke — should be PARTIAL (smooth)
    silent: win(0.8, 1.3),      // well after choke — silent
    swelling: win(1.42, 1.48),  // just after articulate — partial swell
    restored: win(1.6, 1.9),    // back to full
    maxJump,
  };
});
await browser.close();
console.log(JSON.stringify(r, null, 1));
const ok =
  r.before > 0.05 &&
  r.fading < r.before * 0.95 &&
  r.fading > r.before * 0.1 &&   // gradual fade, not instant cut
  r.silent < r.before * 0.05 &&
  r.swelling > r.silent * 2 &&   // swell has begun
  r.restored > r.before * 0.5 &&
  r.maxJump < 0.25;              // no clicks anywhere
console.log(
  `before=${r.before.toFixed(3)} fading=${r.fading.toFixed(3)} silent=${r.silent.toFixed(4)} swelling=${r.swelling.toFixed(3)} restored=${r.restored.toFixed(3)} maxJump=${r.maxJump.toFixed(3)}`,
);
console.log(ok ? 'NODAUDIO PASS' : 'NODAUDIO FAIL');
process.exit(ok ? 0 : 1);
