import type { Song } from './types';

/**
 * User-imported songs live in localStorage (no backend). Each entry is a
 * full Song JSON identical in shape to the built-in songbook entries.
 */

const STORAGE_KEY = 'gs-custom-songs';

function readAll(): Record<string, Song> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Song>) : {};
  } catch {
    return {};
  }
}

function writeAll(songs: Record<string, Song>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    return true;
  } catch {
    return false;
  }
}

export function listCustomSongs(): Song[] {
  return Object.values(readAll()).sort((a, b) => a.title.localeCompare(b.title));
}

export function getCustomSong(slug: string): Song | null {
  return readAll()[slug] ?? null;
}

/** Upsert by slug. Returns false if storage is unavailable/full. */
export function saveCustomSong(song: Song): boolean {
  const all = readAll();
  all[song.slug] = song;
  return writeAll(all);
}

export function deleteCustomSong(slug: string): void {
  const all = readAll();
  delete all[slug];
  writeAll(all);
}
