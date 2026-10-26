import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import autoprefixer from 'autoprefixer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extra playlists for this build, from player/playlists.local.json (not in git: their URLs carry logins). Either one
// list for every TV, [{"name": "…", "url": "…"}], or one per TV, each with its own IPTV service user:
// {"tvs": {"comedor": [...], "dormitorio": [...]}}, picked with RAFLIX_TV=<name>. A build (not tests or dev) stops
// rather than ship another TV's login or an unfilled one. Without the file, none.
function getExtraPlaylists(building) {
  const file = path.resolve(__dirname, 'playlists.local.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (Array.isArray(data)) return data;
  const tvs = Object.keys(data.tvs || {});
  const list = (data.tvs || {})[process.env.RAFLIX_TV];
  if (!building) return list || [];
  if (!list) throw new Error('playlists.local.json has a list per TV: build with RAFLIX_TV=' + tvs.join('|'));
  if (list.some((p) => /[<>]/.test(p.url || ''))) {
    throw new Error('playlists.local.json: fill in the ' + process.env.RAFLIX_TV + " TV's login");
  }
  return list;
}

// Diagnostic beacon address (src/diag.js) from player/diag.local.json (not in git): {"url": "http://<mac>:8099/log"}.
// Without the file, nothing is sent and the HTML hook isn't added.
function getDiagUrl() {
  const file = path.resolve(__dirname, 'diag.local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')).url || '' : '';
}

// With a diag URL: a <script> first in <head> that reports page errors and the legacy loader's failure — the app's
// own diag.js only runs once the bundle has loaded, which is what failed on the 2016 TV.
function diagHtmlHook(url) {
  if (!url) return (html) => html;
  const base = JSON.stringify(url);
  const hook =
    '<script>window.__diag=function(m){try{new Image().src=' +
    base +
    "+'?'+encodeURIComponent(String(m).slice(0,1500))+'&_='+Date.now();}catch(e){}};" +
    "window.onerror=function(m,u,l,c){__diag('ERROR '+m+' @'+(u||'').split('/').pop()+':'+l+':'+c);};" +
    "__diag('html start '+navigator.userAgent);</script>";
  return (html) =>
    html
      .replace('<head>', '<head>\n  ' + hook)
      .replace(
        /System\.import\((document\.getElementById\('vite-legacy-entry'\)\.getAttribute\('data-src'\))\)/,
        "System.import($1).then(function(){__diag('bundle loaded')},function(e){__diag('BUNDLE FAILED '+e+' '+((e&&e.stack)||'').slice(0,500))})",
      );
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

// The legacy build's stylesheet, as a file: Vite inlines CSS into SystemJS chunks, and then a JavaScript failure
// leaves the page unstyled (2016 TV, first try). Linked from index.html instead, so the layout survives.
async function writeLegacyStylesheet(outDir, plugins) {
  const postcss = (await import('postcss')).default;
  const cssnano = (await import('cssnano')).default;
  const src = path.resolve(__dirname, 'src/styles.css');
  const result = await postcss([...plugins, cssnano({ preset: 'default' })]).process(fs.readFileSync(src, 'utf-8'), {
    from: src,
    to: path.resolve(__dirname, outDir, 'styles.css'),
  });
  fs.writeFileSync(path.resolve(__dirname, outDir, 'styles.css'), result.css);
}

// `vite build --mode legacy`: 2016-2017 TVs (Tizen 2.4/3, WebKit r152340 / Chromium 47). Native AVPlay instead of
// Shaka (player-legacy.js), ES5 with polyfills (fetch, Promise…), static CSS with -webkit- prefixes, in dist-legacy/.
const LEGACY_BROWSERS = ['safari >= 7', 'chrome >= 30'];

export default defineConfig(({ command, mode }) => {
  const isLegacy = mode === 'legacy';
  const outDir = isLegacy ? 'dist-legacy' : 'dist';
  const legacyCss = [staticCssVars({ '--tv-scale': '1.35' }), autoprefixer({ overrideBrowserslist: LEGACY_BROWSERS })];
  return {
    define: {
      __APP_VERSION__: JSON.stringify(getAppVersion()),
      __EXTRA_PLAYLISTS__: JSON.stringify(getExtraPlaylists(command === 'build')),
      __DIAG_URL__: JSON.stringify(getDiagUrl()),
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
    css: isLegacy ? { postcss: { plugins: legacyCss } } : undefined,
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
      ...(isLegacy
        ? [
            {
              name: 'legacy-stylesheet',
              // The stylesheet leaves the bundle (so Vite doesn't inline it) and comes back as a plain <link>,
              // before Vite sees the HTML (order: 'pre'), else it bundles it.
              transformIndexHtml: {
                order: 'pre',
                handler: (html) =>
                  html.replace(
                    '<link rel="stylesheet" href="/src/styles.css">',
                    '<link rel="stylesheet" href="/enplayer/styles.css">',
                  ),
              },
              closeBundle: () => writeLegacyStylesheet(outDir, legacyCss),
            },
          ]
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
          fs.writeFileSync(file, diagHtmlHook(getDiagUrl())(fixed));
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
