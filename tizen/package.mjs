import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// --legacy: the 2016-2017 TVs' package (Tizen 2.4/3), from `npm run build:legacy` (player/dist-legacy): native
// AVPlay, ES5. Its name carries `_tizen24`, which tizen/install.py uses to pick it for those TVs.
const LEGACY = process.argv.includes('--legacy');
const REQUIRED_VERSION = LEGACY ? '2.4' : '4.0';
const DIST = join(ROOT, 'player', LEGACY ? 'dist-legacy' : 'dist');
const TIZEN = __dirname;

const PKG = 'IPTVPlayer'; // Must be EXACTLY 10 chars!

// Read app version from player package.json
const playerPkg = JSON.parse(readFileSync(join(ROOT, 'player', 'package.json'), 'utf-8'));
const APP_VERSION = playerPkg.version;

// Get git info for build naming
const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
const versionType = branch === 'main' ? 'stable' : 'beta';
// The TV the build is for (RAFLIX_TV, player/playlists.local.json: its own IPTV service user), in the name.
const TV_NAME = process.env.RAFLIX_TV ? `_${process.env.RAFLIX_TV}` : '';
const WGT_NAME = `EN-IPTV_Player_v${APP_VERSION}${LEGACY ? '_tizen24' : ''}${TV_NAME}_${commitHash}.wgt`;
const OUTPUT_DIR = join(ROOT, versionType);
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function findOpenSSL() {
  const candidates = [
    'openssl',
    '"C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe"',
    '"C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe"',
    '"C:\\Program Files\\Git\\usr\\bin\\openssl.exe"',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} version`, { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
  return null;
}

function findTizenCLI() {
  const candidates = [
    process.env.TIZEN_CLI,
    join(homedir(), 'tizen-studio', 'tools', 'ide', 'bin', 'tizen'),
    'tizen',
  ].filter(Boolean);
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" version`, { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
  return null;
}

function findSDB() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    'TizenSdb_v1.1.0.exe',
    '"C:\\Program Files\\TizenSDB\\TizenSdb_v1.1.0.exe"',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} 2>nul`, { stdio: 'pipe' });
      return cmd;
    } catch {
      try {
        execSync(`${cmd} 2>&1`, { stdio: 'pipe' });
        return cmd;
      } catch {}
    }
  }
  return null;
}

function findPython() {
  const candidates = ['python3', 'python', 'py -3'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
  return null;
}

// ─── Step 1: Verify prerequisites ────────────────────────────────────────

const PYTHON = findPython();
if (!PYTHON) {
  console.log('\n Python 3 not found. Install Python 3 and try again.\n');
  process.exit(1);
}

const SDB = findSDB();
if (!SDB) {
  console.log('\n TizenSdb not found — skipping SDB check (packaging only)\n');
}

const SIGNING_PROFILE = process.env.TIZEN_CERT_PROFILE;
const TIZEN_CLI = SIGNING_PROFILE && findTizenCLI();
const OPENSSL = TIZEN_CLI ? null : findOpenSSL();
if (!TIZEN_CLI && !OPENSSL) {
  console.log('\n Neither the Tizen CLI nor OpenSSL was found.\n');
  process.exit(1);
}

console.log(` Signer: ${TIZEN_CLI ? `Tizen profile "${SIGNING_PROFILE}"` : OPENSSL}`);
console.log(` Python: ${PYTHON}`);
console.log(` SDB: ${SDB}`);

// ─── Step 2: Ensure dist/ exists ─────────────────────────────────────────

if (!existsSync(DIST)) {
  console.log(`\n ${LEGACY ? 'dist-legacy/ not found. Run: npm run build:legacy' : 'dist/ not found. Run: npm run build'}\n`);
  process.exit(1);
}

// ─── Step 3: Certificates ────────────────────────────────────────────────

const KEY_FILE = join(TIZEN, 'author-key.pem');
const CERT_FILE = join(TIZEN, 'author-cert.pem');

if (!TIZEN_CLI && (!existsSync(KEY_FILE) || !existsSync(CERT_FILE))) {
  console.log('\n Generating developer certificate...');
  execSync(`${OPENSSL} genrsa -out "${KEY_FILE}" 2048`, { stdio: 'inherit' });
  execSync(
    `${OPENSSL} req -new -x509 -key "${KEY_FILE}" -out "${CERT_FILE}" ` +
    `-days 36500 -subj "/CN=IPTVPlayer/O=Self/OU=Personal"`,
    { stdio: 'inherit' }
  );
} else if (!TIZEN_CLI) {
  console.log(' Certificate found');
}

// ─── Step 4: Build and sign the WGT ──────────────────────────────────────

const TEMP = join(TIZEN, 'temp-wgt');
const OUTPUT = join(OUTPUT_DIR, WGT_NAME);
const UNSIGNED = join(TIZEN, 'unsigned.wgt');

for (const p of [TEMP, OUTPUT]) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

console.log('\n Building .wgt...');

// Create temp dir with package structure
mkdirSync(TEMP, { recursive: true });

// The icon's name in the package. The 2016 Smart Hub kept the old icon in its home bar through an update and a
// reinstall (only Apps showed the new one): another file name there makes it a new icon.
const ICON = LEGACY ? 'raflix-bar.png' : 'icon.png';

// Config with 10-char package name
const configXml = `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets"
        xmlns="http://www.w3.org/ns/widgets"
        id="https://iptvplayer"
        version="${APP_VERSION.split('-')[0]}"
        viewmodes="maximized">
  <access origin="*" subdomains="true"/>
  <tizen:application id="${PKG}.IPTV" package="${PKG}" required_version="${REQUIRED_VERSION}"/>
  <author href="http://iptvplayer">EN-IPTV Player</author>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <icon src="${ICON}"/>
  <name>RAFLIX IPTV v${APP_VERSION}</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape"
                 context-menu="enable"
                 background-support="disable"
                 encryption="disable"
                 install-location="auto"
                 hwkey-event="enable"/>
</widget>`;
writeFileSync(join(TEMP, 'config.xml'), configXml);

// Copy app files
cpSync(DIST, TEMP, { recursive: true });

// Fix paths: strip /enplayer/ base prefix (WGT serves from root). Legacy: "./" relative paths, which every engine
// resolves against the app's folder (2016's runtime isn't known to map "/" there); SystemJS, which loads the legacy
// app, takes a path without "./" for a package name (its error #8).
const htmlPath = join(TEMP, 'index.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\/enplayer\//g, LEGACY ? './' : '/');
writeFileSync(htmlPath, html);

// Copy app icon (spec-size 512x423 launcher art — not the small test icon). The 2016-2017 Smart Hub stretches it to
// fill its ~1.83:1 bar tile (the R came out squashed): the legacy package takes a 512x280 one drawn for that tile
// (icons/raflix-iptv-icon-legacy-512x280.svg).
cpSync(join(TIZEN, LEGACY ? 'icon-legacy.png' : 'icon.png'), join(TEMP, ICON));

// Create unsigned ZIP via Python helper
const ZIP_HELPER = join(TIZEN, 'ziphelper.py');
execSync(`${PYTHON} "${ZIP_HELPER}" unsigned "${TEMP}" "${UNSIGNED}"`, { stdio: 'inherit' });

if (!existsSync(UNSIGNED)) {
  console.log(' Failed to create unsigned package');
  process.exit(1);
}

// Sign
console.log(' Signing...');
if (TIZEN_CLI) {
  execSync(
  `"${TIZEN_CLI}" package -t wgt -s "${SIGNING_PROFILE}" -o "${OUTPUT_DIR}" -- "${UNSIGNED}"`,
  { stdio: 'inherit' }
  );
  renameSync(join(OUTPUT_DIR, 'unsigned.wgt'), OUTPUT);
} else {
  const SIG_FILE = join(TEMP, 'signature.xml');
  execSync(
  `${OPENSSL} smime -sign -signer "${CERT_FILE}" -inkey "${KEY_FILE}" ` +
    `-outform DER -binary -in "${UNSIGNED}" -out "${SIG_FILE}"`,
  { stdio: 'inherit' }
  );

  // Create signed ZIP with signature.xml LAST
  execSync(`${PYTHON} "${ZIP_HELPER}" signed "${TEMP}" "${OUTPUT}" "${SIG_FILE}"`, {
  stdio: 'inherit',
  });
}

rmSync(TEMP, { recursive: true, force: true });
rmSync(UNSIGNED, { force: true });

const size = (readFileSync(OUTPUT).length / 1024).toFixed(1);
console.log(`\n Done!  ${WGT_NAME}  (${size} KB)`);
console.log(`   ${OUTPUT}\n`);
