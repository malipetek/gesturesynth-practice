import { useMemo, useState } from 'react';
import { songFromChordPro } from '../lib/chordpro';
import { saveCustomSong } from '../lib/customSongs';
import './Player.css';

const PLACEHOLDER = `{title: My Song}
{artist: Me}
{key: C}
{tempo: 100}
{time: 4/4}

[C] [C] [G] [G]
[Am] [Am] [F] [F]
[C] [C] [G] [G]
[C] [C] [F] [F]`;

/**
 * Song importer: paste ChordPro-ish notation, get live validation, save to
 * localStorage and play it with the full practice player.
 */
export default function ImportSong() {
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? songFromChordPro(text) : null), [text]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const song = result?.song ?? null;
  const errors = result?.errors ?? [];
  const bars = song ? song.events.reduce((max, e) => Math.max(max, e.bar), 0) : 0;

  const saveAndPlay = () => {
    if (!song) return;
    if (!saveCustomSong(song)) {
      setSaveError('Could not save — browser storage is unavailable or full.');
      return;
    }
    window.location.href = `/song/custom?slug=${encodeURIComponent(song.slug)}`;
  };

  return (
    <div className="import-form">
      <textarea
        className="import-text"
        rows={14}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <details className="import-help">
        <summary>Format help</summary>
        <ul>
          <li>
            Directives: <code>{'{title: …}'}</code> (required), <code>{'{artist: …}'}</code>,{' '}
            <code>{'{key: C}'}</code>, <code>{'{tempo: 100}'}</code>, <code>{'{time: 4/4}'}</code>
          </li>
          <li>
            Each <code>[Chord]</code> = one beat; beats wrap into bars automatically.
          </li>
          <li>
            Chord roots must be diatonic to the key (that is what makes every chord playable with
            the 7 degree gestures). 7ths and slash inversions are supported.
          </li>
          <li>Saved in this browser only — no account, no upload.</li>
        </ul>
      </details>

      {errors.length > 0 && (
        <ul className="import-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {song && (
        <div className="import-preview">
          <p className="import-preview-title">
            {song.title} <span className="muted">— {song.artist}</span>
          </p>
          <p className="muted">
            {song.key} · {song.bpm} BPM · {song.timeSignature[0]}/{song.timeSignature[1]} · {bars}{' '}
            bars · {song.events.length} chords · {Math.ceil(bars / 2)} guided sections
          </p>
          <p className="import-chords muted">
            {song.events
              .slice(0, 12)
              .map((e) => e.chordName)
              .join('  ')}
            {song.events.length > 12 ? '  …' : ''}
          </p>
          <button type="button" className="start-btn" onClick={saveAndPlay}>
            Save &amp; play
          </button>
          {saveError && <p className="import-errors">{saveError}</p>}
        </div>
      )}
    </div>
  );
}
