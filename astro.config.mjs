// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://chat.milind.app',

  vite: {
      plugins: [tailwindcss()],
      // Pre-bundle the lazily-imported streamdown plugins up front so Vite
      // never re-reoptimizes mid-session (stale chunks 504 and code blocks
      // render empty/unhighlighted).
      optimizeDeps: {
        include: ['streamdown', '@streamdown/code', '@streamdown/cjk', '@streamdown/math', '@streamdown/mermaid', 'katex', 'mermaid'],
      },
	},

  integrations: [
    react(),
    sitemap(),
    // WebLLM already persists its multi-GB model weights in its own Cache API
    // store, so the SW owns only the app shell — runtime-caching those URLs
    // here would duplicate storage and contend for eviction.
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
        // MPA, not SPA: each route has its own precached HTML. precacheAndRoute
        // (registered first) already serves /translate, /writing-tools, etc.
        // directly from the precache. Setting navigateFallback would register
        // a NavigationRoute that forces every unknown navigation onto a single
        // shell (index.html), masking 404s and serving the chat page under the
        // wrong URL. Null disables that route entirely.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Anything larger is a WebLLM artifact fetched on demand, not precached.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // Safety net for same-origin document/navigations: try the network
            // (so deep links to fresh routes still work online), then keep a
            // copy so the route is offline-capable on the next visit. The
            // precache already handles every built page; this only fills in
            // anything that ships between builds.
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigate-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: /^https:\/\/rsms\.me\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'inter-font-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\//i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'jsdelivr-cache',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      experimental: {
        // Align SW routing with Astro's clean-URL / trailing-slash handling.
        directoryAndTrailingSlashHandler: true,
      },
    }),
  ],
});