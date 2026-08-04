import { useEffect, useState } from 'react';
import type { Song } from '../lib/types';
import { getCustomSong } from '../lib/customSongs';
import Player from './Player';

/**
 * Loader for user-imported songs: reads ?slug=… from the URL and pulls the
 * song from localStorage, then hands it to the full practice Player.
 */
export default function CustomSong() {
  const [song, setSong] = useState<Song | null | undefined>(undefined);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('slug') ?? '';
    setSong(slug ? getCustomSong(slug) : null);
  }, []);

  if (song === undefined) {
    return (
      <div className="player">
        <p className="empty">Loading…</p>
      </div>
    );
  }
  if (!song) {
    return (
      <div className="player">
        <section className="screen idle">
          <h2>Song not found</h2>
          <p className="lede">
            Custom songs live in this browser's local storage — import it again on this device.
          </p>
          <a className="start-btn" href="/import">
            Import a song
          </a>
        </section>
      </div>
    );
  }
  return <Player song={song} />;
}
