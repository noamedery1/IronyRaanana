import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png', 'men_logo.png', 'women_logo.png'],
      manifest: {
        name: 'עירוני רעננה — לו"ז',
        short_name: 'רעננה לו"ז',
        description: 'לו"ז אימונים, משחקים ועדכונים של מחלקת הכדורסל',
        lang: 'he',
        dir: 'rtl',
        theme_color: '#ff7a18',
        background_color: '#070b16',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,webmanifest}'],
        // Pull our Web Push handlers into the generated service worker.
        importScripts: ['push-sw.js'],
        navigateFallbackDenylist: [/^\/calendar\.ics/, /^\/sales-landing/],
        runtimeCaching: [
          {
            // Live schedule data (Google Sheets CSV) + Apps Script — always try network first
            urlPattern: ({ url }) =>
              url.hostname.includes('docs.google.com') ||
              url.hostname.includes('script.google.com') ||
              url.hostname.includes('googleusercontent.com'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'schedule-data',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('fonts.googleapis.com') ||
              url.hostname.includes('fonts.gstatic.com') ||
              url.hostname.includes('images.unsplash.com'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'assets-cdn',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return id.toString().split('node_modules/')[1].split('/')[0].toString();
          }
        }
      }
    }
  }
})
