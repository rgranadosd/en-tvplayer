// Checks the legacy build (npm run build:legacy → player/dist-legacy) for 2016-2017 TVs: Tizen 2.4's WebKit r152340
// runs ES5 only, has no CSS custom properties and no KeyboardEvent.key, and Shaka can't play there.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'player/dist-legacy');

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function fail(message) {
  console.error('Tizen 2.4 compatibility check failed: ' + message);
  process.exitCode = 1;
}

if (!existsSync(dist)) {
  fail('player/dist-legacy is missing: run npm run build:legacy first');
  process.exit();
}

const packager = read('tizen/package.mjs');
if (!packager.includes("LEGACY ? '2.4' : '4.0'")) fail('the legacy manifest does not target Tizen 2.4');
if (!packager.includes("LEGACY ? '_tizen24' : ''"))
  fail('the legacy package name lacks _tizen24 (install.py needs it)');
if (!packager.includes("LEGACY ? '' : '/'")) fail('the legacy package does not use relative paths');
if (!read('player/vite.config.js').includes("'src/player-legacy.js'"))
  fail('the legacy build does not use player-legacy.js');

const scripts = [
  'compat.js',
  ...readdirSync(join(dist, 'assets'))
    .filter((n) => n.endsWith('.js'))
    .map((n) => 'assets/' + n),
];
for (const file of scripts) {
  const src = readFileSync(join(dist, file), 'utf8');
  try {
    parse(src, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) {
    fail(`${file} is not ES5 (${e.message})`);
  }
  if (file.startsWith('assets/index-') && src.includes('var(--')) fail(`${file}: CSS custom properties remain`);
  if (/shaka\.(Player|polyfill)|shaka-player/.test(src)) fail(`${file}: Shaka is in the legacy bundle`);
}

const compat = readFileSync(join(dist, 'compat.js'), 'utf8');
for (const name of ['E.closest', 'E.prepend', 'NodeList.prototype.forEach']) {
  if (!compat.includes(name)) fail('compat.js lacks the ' + name + ' polyfill');
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/type="module"|nomodule/.test(html)) fail('index.html still has module scripts');
const at = (s) => html.indexOf(s);
if (!(
  at('compat.js') >= 0 &&
  at('compat.js') < at('polyfills-legacy') &&
  at('polyfills-legacy') < at('index-legacy')
)) {
  fail('index.html must load compat.js, then the polyfills, then the app');
}
if (!read('player/src/remote.js').includes('SAMSUNG_KEY_CODES[e.keyCode]')) {
  fail('remote.js has no key-code fallback for color/media keys (no KeyboardEvent.key on 2016 TVs)');
}

if (!process.exitCode) console.log('Tizen 2.4 compatibility checks passed.');
