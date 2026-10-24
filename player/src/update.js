// Update checker + opt-in usage ping. No network activity happens unless the
// user opted in (asked once on first launch, toggle in Settings → Playback).
// Version metadata comes from a static file on jsDelivr, so no server is
// required. See docs/TELEMETRY.md for the optional ping endpoint.
import { APP_VERSION, getSettings, saveSettings } from './config.js';
import { timedFetch } from './utils.js';

const VERSION_URL = 'https://cdn.jsdelivr.net/gh/rgranadosd/en-tvplayer@main/version.json';
// Deploy the worker in docs/TELEMETRY.md and paste its URL here to enable
// anonymous install counting. Empty = ping disabled, update check still works.
const PING_URL = '';
const CONSENT_KEY = 'en_update_consent';
const CACHE_KEY = 'en_update_cache';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function hasConsented() {
  try {
    return getSettings().updateCheck === true;
  } catch {
    return false;
  }
}

export function consentAsked() {
  try {
    return localStorage.getItem(CONSENT_KEY) !== null;
  } catch {
    return true;
  }
}

export function setConsented(allowed) {
  try {
    localStorage.setItem(CONSENT_KEY, allowed ? '1' : '0');
  } catch {}
  saveSettings({ updateCheck: !!allowed });
}

// x.y.z with an optional pre-release ("1.0.0-rc.1"): a pre-release comes before its release, and
// rc.2 after rc.1.
export function compareVersions(a, b) {
  const [ca, pa = ''] = String(a).split('-');
  const [cb, pb = ''] = String(b).split('-');
  const na = ca.split('.').map(Number);
  const nb = cb.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (na[i] || 0) - (nb[i] || 0);
    if (diff !== 0) return diff;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.localeCompare(pb, 'en', { numeric: true });
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.at > CHECK_INTERVAL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Returns { available, latest, url } or null. Never throws, never blocks
// startup — failures are silent by design.
export async function checkForUpdate() {
  if (!hasConsented()) return null;
  const cached = readCache();
  if (cached) {
    return compareVersions(cached.latest, APP_VERSION) > 0 ? cached : null;
  }
  try {
    const request = timedFetch(VERSION_URL + '?_t=' + Date.now(), { cache: 'no-store' }, 8000);
    const resp = await request.promise;
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || typeof data.version !== 'string') return null;
    const result = { available: true, latest: data.version, url: data.url || '' };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...result, at: Date.now() }));
    } catch {}
    return compareVersions(data.version, APP_VERSION) > 0 ? result : null;
  } catch {
    return null;
  }
}

// Anonymous install ping: version + coarse device class only. No-op unless a
// PING_URL is configured and the user consented. Fire-and-forget.
export function sendUsagePing() {
  if (!PING_URL || !hasConsented()) return;
  try {
    const params = new URLSearchParams({
      v: APP_VERSION,
      tv: typeof window !== 'undefined' && window.tizen ? 'tizen' : 'browser',
    });
    fetch(PING_URL + '?' + params.toString(), { mode: 'no-cors', keepalive: true }).catch(() => {});
  } catch {}
}
