import type { Song } from './types';

export function getSongs(): Song[] {
	return Object.values(
		import.meta.glob('../data/songs/*.json', { eager: true, import: 'default' }),
	) as Song[];
}
