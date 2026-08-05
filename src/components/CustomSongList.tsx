import { useEffect, useState } from 'react';
import type { Song } from '../lib/types';
import { deleteCustomSong, listCustomSongs } from '../lib/customSongs';

/**
 * "Your songs" on the homepage: user-imported songs from localStorage with
 * delete. Client-only — storage doesn't exist at build time.
 */
export default function CustomSongList() {
  const [songs, setSongs] = useState<Song[]>([]);

  useEffect(() => {
    setSongs(listCustomSongs());
  }, []);

  if (songs.length === 0) return null;

  const barCount = (song: Song) => song.events.reduce((max, e) => Math.max(max, e.bar), 0);

  return (
    <section className="songbook container custom-songs">
      <div className="songbook-head">
        <h2>Your songs</h2>
        <span className="song-count">
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
        </span>
      </div>
      <div className="grid grid-auto">
        {songs.map((song) => (
          <div className="card song-card custom-card" key={song.slug}>
            <a className="custom-link" href={`/song/custom?slug=${encodeURIComponent(song.slug)}`}>
              <div className="song-card-head">
                <p className="song-title">{song.title}</p>
                <span className="key-chip">{song.key}</span>
              </div>
              <p className="song-artist">{song.artist}</p>
              <p className="song-meta-line">
                {song.bpm} BPM · {barCount(song)} bars · {song.events.length} chords
              </p>
            </a>
            <button
              type="button"
              className="custom-del"
              title={`Delete ${song.title}`}
              onClick={() => {
                deleteCustomSong(song.slug);
                setSongs(listCustomSongs());
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
