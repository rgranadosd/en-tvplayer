// Diagnostic beacon for TVs without a usable inspector (2016, Tizen 2.4). Sends one line per event to the address
// in player/diag.local.json ({"url": "http://<mac-ip>:8099/log"}, not in git; `node scripts/diag-server.mjs`
// prints them). Without the file, every call is a no-op and nothing ships. Stream tokens are scrubbed.
const URL_BASE = String(__DIAG_URL__ || '');

export function diag(message) {
  if (!URL_BASE) return;
  try {
    const safe = String(message).replace(/(https?:\/\/[^\s'"]+?)[?#][^\s'"]*/g, '$1');
    new Image().src = URL_BASE + '?' + encodeURIComponent(safe.slice(0, 1500)) + '&_=' + Date.now();
  } catch {}
}

export const diagEnabled = !!URL_BASE;
