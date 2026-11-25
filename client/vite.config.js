import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev-Server: /api und /photos gehen an den Node-Server (Standard-Port 3000).
// Für HTTP im Dev-Betrieb am Server COOKIE_SECURE=false setzen.
const target = process.env.API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Neue Version wird sofort aktiv (Einzelnutzer); registriert wird in src/main.jsx
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Eat – Ernährung und Training',
        short_name: 'Eat',
        description: 'Essen, Training und Gewicht tracken',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f6f8',
        theme_color: '#2f7d4f',
        categories: ['health', 'fitness', 'food'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Nur die App-Hülle wird vorab geladen. Daten (/api) und Fotos (/photos) kommen immer vom Server:
        // sie hängen an der Anmeldung und werden nicht im Service Worker gespeichert.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/photos\//],
        cleanupOutdatedCaches: true,
        // Ausdrücklich setzen: Das Plugin tut das für autoUpdate nur bei injectRegister 'auto'. Ohne diese beiden
        // Optionen bliebe eine neue Version "wartend", bis alle Tabs geschlossen sind.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    proxy: {
      '/api': target,
      '/photos': target,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
