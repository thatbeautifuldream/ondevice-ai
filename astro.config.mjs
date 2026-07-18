// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://chat.milind.app',

  vite: {
      plugins: [tailwindcss()],
      // Pre-bundle the lazily-imported streamdown plugins up front so Vite
      // never re-optimizes mid-session (stale chunks 504 and code blocks
      // render empty/unhighlighted).
      optimizeDeps: {
        include: ['streamdown', '@streamdown/code', '@streamdown/cjk', '@streamdown/math', '@streamdown/mermaid', 'katex', 'mermaid'],
      },
	},

  integrations: [react(), sitemap()],
});