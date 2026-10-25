import globals from 'globals';
import compat from 'eslint-plugin-compat';

// Minimal on purpose (AGENTS.md: minimum, not maximum): Prettier owns
// style; ESLint owns dead code + undefined references.
export default [
  {
    files: ['player/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
        __EXTRA_PLAYLISTS__: 'readonly',
        __FAVORITES_URL__: 'readonly',
        __DIAG_URL__: 'readonly',
        __DIAG_URL__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
      'no-undef': 'error',
    },
  },
  {
    // The legacy build (2016 TVs, Tizen 2.4: WebKit of Safari 7's era) runs everything but player.js. Browser APIs
    // it lacks are flagged here; the ones the legacy build polyfills (@vitejs/plugin-legacy + whatwg-fetch, and
    // public/compat.js) are listed as such.
    files: ['player/src/**/*.js'],
    ignores: ['player/src/player.js', 'player/src/**/*.test.js'],
    plugins: { compat },
    settings: {
      browsers: ['safari >= 7'],
      polyfills: [
        'Promise',
        'fetch',
        'Symbol',
        'Map',
        'Set',
        'Array.from',
        'Array.prototype.includes',
        'Array.prototype.find',
        'Array.prototype.findIndex',
        'Object.assign',
        'Object.entries',
        'Object.values',
        'String.prototype.includes',
        'String.prototype.startsWith',
        'String.prototype.endsWith',
        'String.prototype.padStart',
        'String.prototype.trimStart',
        'Number.isNaN',
        'Number.parseInt',
        'URL',
        'URLSearchParams',
        'Element.prototype.closest',
        'Element.prototype.prepend',
        'NodeList.prototype.forEach',
      ],
    },
    rules: { 'compat/compat': 'error' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
      'no-undef': 'error',
    },
  },
];
