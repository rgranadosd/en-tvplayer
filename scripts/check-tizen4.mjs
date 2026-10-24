import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function fail(message) {
  console.error('Tizen 4 compatibility check failed: ' + message);
  process.exitCode = 1;
}

const configXml = read('tizen/config.xml');
const packager = read('tizen/package.mjs');
const vite = read('player/vite.config.js');
const styles = read('player/src/styles.css');
const builtHtml = read('player/dist/index.html');
const compat = read('player/dist/compat.js');

if (!configXml.includes('required_version="4.0"')) fail('tizen/config.xml does not target Tizen 4.0');
if (!packager.includes('required_version="4.0"')) fail('the generated manifest does not target Tizen 4.0');
if (!vite.includes("target: 'chrome56'")) fail('Vite does not target Chromium 56');
if (styles.includes('display: grid') || styles.includes('grid-gap:')) fail('CSS Grid remains in styles.css');
if (styles.includes('height: 100vh')) fail('100vh remains in styles.css');
if (!compat.includes('String.prototype.trimStart')) fail('the trimStart compatibility bootstrap is missing');

const compatAt = builtHtml.indexOf('compat.js');
const assetsAt = builtHtml.indexOf('/assets/');
if (compatAt < 0 || assetsAt < 0 || compatAt > assetsAt) {
  fail('compat.js is not loaded before the application bundle');
}

const sourceDir = join(root, 'player/src');
for (const file of readdirSync(sourceDir).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))) {
  if (read('player/src/' + file).includes('new AbortController')) {
    fail('unguarded AbortController remains in player/src/' + file);
  }
}

if (!process.exitCode) console.log('Tizen 4 compatibility checks passed.');
