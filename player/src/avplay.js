import { diag } from './diag.js';
import { bufferStalled } from './logic.js';
import { getSettings } from './config.js';

const STALL_MS = 8000; // a buffer that stops moving this long before the first frame: retried at once
const FREEZE_MS = 10000; // playing, but the picture hasn't moved this long: reconnected (what leaving and coming back did)
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
let frozenCallback = null;
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
let stallTimer = null;
let freezeTimer = null;
let userPaused = false;
let readyReport = null; // the zapping line for the diagnostics, sent once per play()
// Each play() is a session; stop() ends it. A 2016 TV still delivers the closed channel's events after the next one is
// opened ("playing" 60 ms in, from the old stream): the new channel looked up, with no picture and no retry. Every
// AVPlay callback checks it is still the current session.
let session = 0;

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

// Settings > Playback > Fill the screen: every picture stretched to 16:9 (FULL_SCREEN). Off, each channel keeps its own
// shape: by default AVPlay stretches every picture to the full rect, so 4:3 channels came out squashed;
// AUTO_ASPECT_RATIO also follows anamorphic SD on the 2018 TVs (the 2016 one takes it but shows that SD narrow with
// bars), and TVs without it get LETTER_BOX. Returns the mode the TV took.
function setPictureFormat(avplay) {
  const modes = getSettings().pictureFill ? ['FULL_SCREEN'] : ['AUTO_ASPECT_RATIO', 'LETTER_BOX'];
  for (const mode of modes) {
    try {
      avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_' + mode);
      return mode.toLowerCase();
    } catch {}
  }
  return 'default';
}

// The setting changed: the channel on screen follows at once.
export function applyPictureFormat() {
  if (!active || !isAvailable()) return;
  try {
    setPictureFormat(window.webapis.avplay);
  } catch {}
}

// The video AVPlay is showing, for the diagnostics: its stream info (size, codec…), as the TV reports it.
function pictureInfo(avplay) {
  try {
    const video = (avplay.getCurrentStreamInfo() || []).filter((s) => s && s.type === 'VIDEO')[0];
    return video ? String(video.extra_info).slice(0, 300) : 'no video info';
  } catch (e) {
    return 'unavailable: ' + (e && e.message);
  }
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

// Called once when a playing channel freezes (no progress for FREEZE_MS, not paused, app on screen).
export function onFrozen(callback) {
  frozenCallback = callback;
}

export function onBuffering(callback) {
  bufferingCallback = callback;
}

export function onError(callback) {
  errorCallback = callback;
}

// Opens url natively. Resolves true once the first frame plays, false on
// error/timeout. Rejects never — always resolves. 30 s: the channel server takes up to ~13 s to start some channels
// on a slow day, and 15 s gave up on them right at the edge.
export function play(url, { userAgent, referer, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    if (!isAvailable()) {
      resolve(false);
      return;
    }
    // The diag lines here and in stop() go out before AVPlay's synchronous calls (an image request leaves even if the
    // next call hangs the app): the last of them in the log says which call a 2016 TV got stuck in.
    const tStop = Date.now();
    stop();
    const mySession = ++session;
    const live = () => mySession === session;
    const obj = el();
    if (!obj) {
      resolve(false);
      return;
    }
    obj.classList.remove('hidden');
    firstFrameSeen = false;
    failure = null;
    userPaused = false;
    // Zapping timings for the diagnostic build (no-op without player/diag.local.json): only noted here, in ms since
    // the channel was asked; one line goes out after the first frame or the failure, never from AVPlay's callbacks.
    const t0 = Date.now();
    const marks = [];
    const at = (what) => marks.push(what + ' +' + (Date.now() - t0));
    let lastPct = -1;
    let progressAt = 0;
    let playedAt = 0;
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
          if (!live()) return;
          if (bufferingCallback) bufferingCallback(true);
        },
        onbufferingprogress: (percent) => {
          if (!live()) return;
          progressAt = Date.now();
          if (percent >= lastPct + 25) {
            lastPct = percent;
            at(percent + '%');
          }
          if (bufferingCallback) bufferingCallback(true, percent);
        },
        onbufferingcomplete: () => {
          if (!live()) return;
          // Before the first frame, the full buffer is still ~1 s of black screen: the loading sign stays.
          if (firstFrameSeen && bufferingCallback) bufferingCallback(false);
        },
        oncurrentplaytime: () => {
          if (!live()) return;
          playedAt = Date.now();
          if (!firstFrameSeen) {
            firstFrameSeen = true;
            clearInterval(stallTimer);
            at('frame');
            setTimeout(() => diag('avplay: picture ' + pictureInfo(avplay) + ', display ' + displayMode), 0);
            if (!readyResolve && readyReport) {
              readyReport('late frame');
              readyReport = null;
            }
            if (bufferingCallback) bufferingCallback(false);
            resolveReady(true);
          }
        },
        onerror: (type) => {
          if (!live()) return;
          at('error ' + type);
          failure = 'error';
          if (errorCallback) errorCallback(type);
          resolveReady(false);
        },
        onstreamcompleted: () => {
          if (!live()) return;
          // Before the first frame: the server ended the stream without a picture. A failure the caller retries, not a
          // channel that started.
          if (!firstFrameSeen) {
            at('ended');
            failure = 'ended';
            resolveReady(false);
            return;
          }
          resolveReady(true);
        },
      });
      const tOpen = Date.now();
      diag('avplay: closed in ' + (tOpen - tStop) + ' ms, opening ' + streamLabel(url));
      avplay.open(url);
      active = true;
      diag('avplay: opened in ' + (Date.now() - tOpen) + ' ms');
      avplay.setDisplayRect(0, 0, 1920, 1080);
      const displayMode = setPictureFormat(avplay); // which one the TV took goes to the diag log with the first frame
      // Start once 3 s are buffered (the default waits for far more on older TVs): faster zapping on live TS.
      try {
        avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3);
      } catch {}
      const fail = () => {
        if (!live()) return;
        failure = 'error';
        resolveReady(false);
      };
      diag('avplay: preparing');
      avplay.prepareAsync(() => {
        if (!live()) return;
        at('prepared');
        try {
          avplay.play();
        } catch {
          fail();
        }
      }, fail);
      // The server stopped sending before the first frame: fail now (the caller retries) instead of waiting the
      // ~90 s AVPlay takes to give up. Past play()'s own timeout (a slow start) it goes through onerror's callback.
      clearInterval(stallTimer);
      stallTimer = setInterval(() => {
        if (firstFrameSeen || !bufferStalled(progressAt, Date.now(), STALL_MS)) return;
        clearInterval(stallTimer);
        at('stall');
        failure = 'stall';
        if (readyResolve) resolveReady(false);
        else if (errorCallback) errorCallback('STALLED');
      }, 1000);
      // After the first frame: a picture that stops moving and doesn't come back (the server's stream stalled; AVPlay
      // stays stuck on it) is reconnected, once per play() — the new play() watches again.
      clearInterval(freezeTimer);
      let position = -1;
      // Only where someone reconnects (the Tizen 4+ package): it asks AVPlay its position every second.
      if (frozenCallback) {
        freezeTimer = setInterval(() => {
          if (!firstFrameSeen || userPaused || document.hidden) return;
          try {
            const now = avplay.getCurrentTime(); // also asked, in case a firmware calls oncurrentplaytime seldom
            if (now !== position) {
              position = now;
              playedAt = Date.now();
            }
          } catch {}
          if (!bufferStalled(playedAt, Date.now(), FREEZE_MS)) return;
          clearInterval(freezeTimer);
          const line = 'frozen ' + streamLabel(url) + ' after ' + Math.round((Date.now() - t0) / 1000) + ' s';
          setTimeout(() => diag(line), 0);
          frozenCallback();
        }, 1000);
      }
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
  userPaused = true;
  try {
    if (active && isAvailable()) window.webapis.avplay.pause();
  } catch {}
}

export function resume() {
  userPaused = false;
  try {
    if (active && isAvailable()) window.webapis.avplay.play();
  } catch {}
}

export function stop() {
  session++;
  clearReadyTimer();
  clearInterval(stallTimer);
  clearInterval(freezeTimer);
  readyResolve = null;
  readyReport = null;
  firstFrameSeen = false;
  if (active) {
    active = false;
    try {
      if (isAvailable()) {
        let state = '?';
        try {
          state = window.webapis.avplay.getState();
        } catch {}
        diag('avplay: stop (state ' + state + ')');
        window.webapis.avplay.stop();
        diag('avplay: close');
        window.webapis.avplay.close();
        diag('avplay: closed');
      }
    } catch {}
  }
  const obj = avObject || document.getElementById('avplayer');
  if (obj) obj.classList.add('hidden');
}
