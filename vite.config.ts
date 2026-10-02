import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the built site works from any folder or sub-path.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Newcastle Audio Ranking test',
        short_name: 'NeAR',
        description: 'Sort and rank audio clips by repeated comparison. Works offline; audio never leaves your device.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f5f8',
        theme_color: '#1f3b73',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Opening the manual or the examples zip is a navigation; don't answer it with the app shell.
        navigateFallbackDenylist: [/\/manual\//, /\/examples\//, /\.pdf$/i],
        // Example study files are fetched on demand, then kept for offline demos.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/examples/'),
            handler: 'NetworkFirst', // fresh after an update, cached for offline use
            options: { cacheName: 'near-examples' },
          },
        ],
      },
    }),
  ],
});
