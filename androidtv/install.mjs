#!/usr/bin/env node
// Installs the Android TV app on a TV over the network, with adb:
//   npm run android:install -- <tv-ip> [--launch] [--uninstall]
// On the TV, once: Settings › Device Preferences › About › press "Build" 7 times, then Developer options › Network
// debugging (ADB) on. The first connection asks on the TV to allow this computer.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APK = join(HERE, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP_ID = 'com.raflix.iptv';
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/homebrew/share/android-commandlinetools';
const ADB = join(SDK, 'platform-tools', 'adb');

const args = process.argv.slice(2);
const ip = args.find((a) => !a.startsWith('--'));
if (!ip) {
  console.error('Usage: npm run android:install -- <tv-ip> [--launch] [--uninstall]');
  process.exit(1);
}
if (!existsSync(ADB)) {
  console.error(`adb not found at ${ADB}: set ANDROID_HOME`);
  process.exit(1);
}

const adb = (...a) => execFileSync(ADB, a, { stdio: 'inherit' });
const target = ip.includes(':') ? ip : `${ip}:5555`;

adb('connect', target);
if (args.includes('--uninstall')) {
  adb('-s', target, 'uninstall', APP_ID);
} else {
  if (!existsSync(APK)) {
    console.error(`No APK at ${APK}: run RAFLIX_TV=<tv> npm run android first`);
    process.exit(1);
  }
  adb('-s', target, 'install', '-r', APK);
  if (args.includes('--launch')) {
    adb('-s', target, 'shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  }
}
