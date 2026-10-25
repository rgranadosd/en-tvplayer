import { diag } from './diag.js';
// Native playback via Samsung AVPlay (webapis.avplay).
// Fallback for (a) streams the browser decoder cannot render (e.g. interlaced
// MBAFF H264 — buffering completes, zero frames painted, no Shaka error) and
// (b) loads the browser stack cannot complete (e.g. CORS-blocked relays — the
// native pipeline ignores CORS, same as standalone players). The native path
// is tried once per URL; failures are recorded so it never loops.
// Absent outside Tizen (desktop dev) — every function guards and no-ops.

let avObject = null;
let bufferingCallback = null;
let errorCallback = null;
let readyResolve = null;
let readyTimer = null;
let firstFrameSeen = false;
// BUG-020 regression guard: never touch the native instance unless we
// actually opened it — a stray stop()/close() on every channel load hung
// all playback on some firmwares.
let active = false;
// Why the last play() resolved false: 'error' (AVPlay said so, or prepare failed) or 'timeout' (no frame yet — on
// a 2016 TV a live TS can take 20 s to start, and it's still coming). Callers decide whether to retry.
let failure = null;
let readyReport = null; // the zapping line for the diagnostics, sent once per play()

export function lastFailure() {
  return failure;
}

export function isAvailable() {
  try {
    return typeof window !== 'undefined' && !!window.webapis && !!window.webapis.avplay;
  } catch {
    return false;
  }
}

function el() {
  if (!avObject) avObject = document.getElementById('avplayer');
  return avObject;
}

function clearReadyTimer() {
  if (readyTimer) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
}

function resolveReady(ok) {
  clearReadyTimer();
  const cb = readyResolve;
  readyResolve = null;
  const report = readyReport;
  if (report) report(ok ? 'ok' : failure || 'fail');
  readyReport = !ok && failure === 'timeout' ? report : null; // a slow start: its frame is reported when it comes
  if (cb) cb(ok);
}

// The server and the file type of a stream, for the diagnostics: its path can carry the login (Xtream).
function streamLabel(url) {
  const s = String(url || '');
  const host = s.split('/').slice(0, 3).join('/');
  const path = s.split('?')[0].split('#')[0];
  const dot = path.lastIndexOf('.');
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  return host + '/…' + ext;
}

export function onBuffering(callback) {
  bufferingCallback = callback;
}

export function onError(callback) {
  errorCallback = callback;
}

// Opens url natively. Resolves true once the first frame plays, false on
// error/timeout. Rejects never — always resolves.
export function play(url, { userAgent, referer, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!isAvailable()) {
      resolve(false);
      return;
    }
    stop();
    const obj = el();
    if (!obj) {
      resolve(false);
      return;
    }
    obj.classList.remove('hidden');
    firstFrameSeen = false;
    failure = null;
    // Zapping timings for the diagnostic build (no-op without player/diag.local.json): only noted here, in ms since
    // the channel was asked; one line goes out after the first frame or the failure, never from AVPlay's callbacks.
    const t0 = Date.now();
    const marks = [];
    const at = (what) => marks.push(what + ' +' + (Date.now() - t0));
    let lastPct = -1;
    const report = (outcome) => {
      const line = 'zap ' + streamLabel(url) + ' ' + outcome + ' +' + (Date.now() - t0) + 'ms: ' + marks.join(', ');
      setTimeout(() => diag(line), 0);
    };
    readyReport = report;
    readyResolve = resolve;
    try {
      const avplay = window.webapis.avplay;
      try {
        if (userAgent) avplay.setStreamingProperty('USER_AGENT', userAgent);
        if (referer) avplay.setStreamingProperty('REFERRER', referer);
      } catch {}
      avplay.setListener({
        onbufferingstart: () => {
          if (bufferingCallback) bufferingCallback(true);
        },
        onbufferingprogress: (percent) => {
          if (percent >= lastPct + 25) {
            lastPct = percent;
            at(percent + '%');
          }
          if (bufferingCallback) bufferingCallback(true, percent);
        },
        onbufferingcomplete: () => {
          // Before the first frame, the full buffer is still ~1 s of black screen: the loading sign stays.
          if (firstFrameSeen && bufferingCallback) bufferingCallback(false);
        },
        oncurrentplaytime: () => {
          if (!firstFrameSeen) {
            firstFrameSeen = true;
            at('frame');
            if (!readyResolve && readyReport) {
              readyReport('late frame');
              readyReport = null;
            }
            if (bufferingCallback) bufferingCallback(false);
            resolveReady(true);
          }
        },
        onerror: (type) => {
          at('error ' + type);
          failure = 'error';
          if (errorCallback) errorCallback(type);
          resolveReady(false);
        },
        onstreamcompleted: () => {
          resolveReady(true);
        },
      });
      avplay.open(url);
      active = true;
      avplay.setDisplayRect(0, 0, 1920, 1080);
      // Start once 3 s are buffered (the default waits for far more on older TVs): faster zapping on live TS.
      try {
        avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3);
      } catch {}
      const fail = () => {
        failure = 'error';
        resolveReady(false);
      };
      avplay.prepareAsync(() => {
        at('prepared');
        try {
          avplay.play();
        } catch {
          fail();
        }
      }, fail);
      readyTimer = setTimeout(() => {
        if (!firstFrameSeen) failure = 'timeout';
        resolveReady(firstFrameSeen);
      }, timeoutMs);
    } catch {
      failure = 'error';
      resolveReady(false);
    }
  });
}

export function pause() {
  try {
    if (active && isAvailable()) window.webapis.avplay.pause();
  } catch {}
}

export function resume() {
  try {
    if (active && isAvailable()) window.webapis.avplay.play();
  } catch {}
}

export function stop() {
  clearReadyTimer();
  readyResolve = null;
  readyReport = null;
  firstFrameSeen = false;
  if (active) {
    active = false;
    try {
      if (isAvailable()) {
        window.webapis.avplay.stop();
        window.webapis.avplay.close();
      }
    } catch {}
  }
  const obj = avObject || document.getElementById('avplayer');
  if (obj) obj.classList.add('hidden');
}
