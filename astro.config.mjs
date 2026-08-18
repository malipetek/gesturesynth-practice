// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://gesturesynthschool.com',
	integrations: [
		react(),
		sitemap({
			filter: (page) =>
				!['/freeform/', '/import/', '/thumb-lab/', '/song/custom/'].some(
					(noindex) => page.endsWith(noindex),
				),
		}),
	],
});
