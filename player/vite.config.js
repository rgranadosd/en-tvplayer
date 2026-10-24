import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extra playlists for this build, from player/playlists.local.json (not in git: their URLs can carry logins):
// [{"name": "…", "url": "…"}]. Without the file, none.
function getExtraPlaylists() {
  const file = path.resolve(__dirname, 'playlists.local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
}

// The favorites API (favorites/server.mjs) for this build, from player/favorites.local.json (not in git):
// {"url": "http://192.168.1.200:5002"}. Without the file, the Red key has no favorites to keep.
function getFavoritesUrl() {
  const file = path.resolve(__dirname, 'favorites.local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')).url || '' : '';
}

function getAppVersion() {
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
  return rootPkg.version || '0.0.0';
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
    __EXTRA_PLAYLISTS__: JSON.stringify(getExtraPlaylists()),
    __FAVORITES_URL__: JSON.stringify(getFavoritesUrl()),
  },
  root: '.',
  base: '/enplayer/',
  // Vitest (node env, no jsdom): unit tests cover DOM-free logic only —
  // see AGENTS.md § Test Process. The __APP_VERSION__ define keeps
  // config.js importable under test.
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
  resolve: {
    alias: {
      '@root': path.resolve(__dirname, '..', '..'),
    },
  },
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    target: 'chrome56',
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
      },
    },
  },
  plugins: [
    {
      name: 'tizen-html-transform',
      closeBundle() {
        const html = fs.readFileSync(path.resolve(__dirname, 'dist/index.html'), 'utf-8');
        const fixed = html.replace(/\s+type="module"/g, '').replace(/\s+crossorigin/g, '');
        fs.writeFileSync(path.resolve(__dirname, 'dist/index.html'), fixed);
      },
    },
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
});
