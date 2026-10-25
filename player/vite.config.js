import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import autoprefixer from 'autoprefixer';
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

// The legacy build's browsers (2016 WebKit) have no CSS custom properties: each var() becomes its :root value.
// --tv-scale is set at start by applyResponsiveScale(), never below 1.35, so it's fixed at that.
function staticCssVars(overrides) {
  return {
    postcssPlugin: 'static-css-vars',
    Once(root) {
      const vars = {};
      root.walkRules((rule) => {
        if (rule.selector.trim() === ':root') rule.walkDecls(/^--/, (d) => (vars[d.prop] = d.value));
      });
      Object.assign(vars, overrides);
      const resolve = (value, depth) =>
        value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (all, name, fallback) => {
          const v = vars[name] !== undefined ? vars[name] : fallback;
          if (v === undefined) return all;
          return depth < 5 ? resolve(String(v).trim(), depth + 1) : String(v).trim();
        });
      root.walkDecls((d) => {
        if (d.prop.startsWith('--')) d.remove();
        else if (d.value.includes('var(')) d.value = resolve(d.value, 0);
      });
    },
  };
}
staticCssVars.postcss = true;

// `vite build --mode legacy`: 2016-2017 TVs (Tizen 2.4/3, WebKit r152340 / Chromium 47). Native AVPlay instead of
// Shaka (player-legacy.js), ES5 with polyfills (fetch, Promise…), static CSS with -webkit- prefixes, in dist-legacy/.
const LEGACY_BROWSERS = ['safari >= 7', 'chrome >= 30'];

export default defineConfig(({ mode }) => {
  const isLegacy = mode === 'legacy';
  const outDir = isLegacy ? 'dist-legacy' : 'dist';
  return {
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
      alias: [
        { find: '@root', replacement: path.resolve(__dirname, '..', '..') },
        ...(isLegacy
          ? [{ find: /^\.\/player\.js$/, replacement: path.resolve(__dirname, 'src/player-legacy.js') }]
          : []),
      ],
    },
    css: isLegacy
      ? {
          postcss: {
            plugins: [staticCssVars({ '--tv-scale': '1.35' }), autoprefixer({ overrideBrowserslist: LEGACY_BROWSERS })],
          },
        }
      : undefined,
    build: isLegacy
      ? { outDir, minify: 'terser', modulePreload: false }
      : {
          outDir,
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
      ...(isLegacy
        ? [legacy({ targets: LEGACY_BROWSERS, renderModernChunks: false, additionalLegacyPolyfills: ['whatwg-fetch'] })]
        : []),
      {
        name: 'tizen-html-transform',
        closeBundle() {
          const file = path.resolve(__dirname, outDir, 'index.html');
          const html = fs.readFileSync(file, 'utf-8');
          const fixed = html
            .replace(/\s+type="module"/g, '')
            .replace(/\s+crossorigin/g, '')
            .replace(/\s+nomodule/g, '');
          fs.writeFileSync(file, fixed);
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
  };
});
