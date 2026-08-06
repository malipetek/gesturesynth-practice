// Nod articulation AUDIO verification — renders the GSVoice envelope through
// an OfflineAudioContext (real DSP, not a mock) and measures RMS around a
// forward flick (articulate @ 0.6s) and a backward flick (choke @ 1.4s):
//   sounding → articulate → ~100ms silent gap → sounding → choke → silence
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
const rms = await page.evaluate(async () => {
  const { GSVoice } = await import('/src/lib/gsVoice.ts');
  const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
  const voice = new GSVoice(ctx);
  voice.playNotes([220, 277.18, 329.63]); // sustained A major-ish chord
  voice.setVolume(0.8);
  // suspend/resume must be registered BEFORE startRendering
  ctx.suspend(0.6).then(() => { voice.articulate(); ctx.resume(); }); // forward flick
  ctx.suspend(1.4).then(() => { voice.choke(); ctx.resume(); });      // backward flick
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  const win = (a, b) => {
    let s = 0;
    for (let i = Math.floor(a * 44100); i < Math.floor(b * 44100); i++) s += data[i] * data[i];
    return Math.sqrt(s / Math.max(1, Math.floor((b - a) * 44100)));
  };
  return {
    before: win(0.3, 0.55),
    gap: win(0.63, 0.68),
    restored: win(0.85, 1.1),
    choked: win(1.5, 1.9),
  };
});
await browser.close();
console.log(JSON.stringify(rms, null, 1));
const ok =
  rms.before > 0.05 &&
  rms.gap < rms.before * 0.15 &&
  rms.restored > rms.before * 0.5 &&
  rms.choked < rms.before * 0.05;
console.log(
  `before=${rms.before.toFixed(3)} gap=${rms.gap.toFixed(4)} restored=${rms.restored.toFixed(3)} choked=${rms.choked.toFixed(4)}`,
);
console.log(ok ? 'NODAUDIO PASS' : 'NODAUDIO FAIL');
process.exit(ok ? 0 : 1);
