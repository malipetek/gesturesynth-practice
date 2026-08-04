import { useState } from 'react';
import FreeformPlayer from './FreeformPlayer';

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];

/**
 * Freeform landing: pick a key, then play the raw gesturesynth.com
 * instrument (gesture + theremin). Lives on the homepage, not per song.
 */
export default function FreeformPage() {
  const [songKey, setSongKey] = useState('C');
  const [started, setStarted] = useState(false);

  if (started) {
    return <FreeformPlayer songKey={songKey} onExit={() => setStarted(false)} />;
  }

  return (
    <div className="player">
      <section className="screen idle">
        <h2>Freeform instrument</h2>
        <p className="lede">
          The gesturesynth.com instrument itself — play anything, no chart, no score. Left hand
          picks the chord, right hand shapes it. Pick a key:
        </p>
        <div className="key-picker" role="group" aria-label="Key">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={k === songKey ? 'on' : ''}
              onClick={() => setSongKey(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <button type="button" className="start-btn" onClick={() => setStarted(true)}>
          Start freeform
        </button>
      </section>
    </div>
  );
}
