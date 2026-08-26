import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// TTD — Tank Tower Defense. Static output (dist/) so it deploys to any static
// host. `base` is '/' in dev and is set (e.g. '/TTD/') for a GitHub Pages
// sub-path build via DEPLOY_BASE. vite-plugin-pwa respects base for SW+manifest.
export default defineConfig({
  base: process.env.DEPLOY_BASE || '/',
  plugins: [
    {
      // Bump the cache-bust token on every production build. Vite content-hashes
      // its own bundle, but the badge + hand-authored asset refs ride on ?v=.
      name: 'cb-bust',
      apply: 'build',
      buildStart() {
        if (existsSync('./scripts/bust.sh')) {
          execSync('./scripts/bust.sh --quiet', { stdio: 'inherit' });
        }
      },
    },
    {
      // GitHub Pages has no SPA fallback, so a hard-load of a deep link 404s.
      // Publish the built index.html as 404.html too.
      name: 'spa-404-fallback',
      apply: 'build',
      closeBundle() {
        const out = resolve(__dirname, 'dist');
        copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TTD — Tank Tower Defense',
        short_name: 'TTD',
        description: 'Tower defense and tank combat on a Stalberg quad-grid sphere.',
        start_url: './?src=pwa',
        scope: './',
        display: 'standalone',
        background_color: '#05070c',
        theme_color: '#05070c',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
