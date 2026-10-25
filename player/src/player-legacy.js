// The player for 2016-2017 TVs (Tizen 2.4/3, `vite build --mode legacy`): their browser can't run Shaka (no modern
// MSE/EME, ES5 only), so every channel plays through Samsung's native AVPlay. Same exports as player.js, which the
// legacy build swaps for this one; what only Shaka has (qualities, audio tracks, DRM) is empty here.
import * as avplay from './avplay.js';
import { withAuthQuery } from './utils.js';
import { tuneCountersReset } from './logic.js';
import { logEvent, showLoading, showError, hideError } from './stage.js';
import { diag } from './diag.js';

const RETRIES = 2; // a cut stream is reopened this many times before giving up
const RETRY_DELAY_MS = 2000;

let videoElement = null;
let currentChannel = null;
let loadToken = 0;
let tuneAttempt = 1;
let retries = 0;
let refreshAsked = false; // the playlist refresh is asked once per channel: the app reloads it after
let retryTimer = null;
let paused = false;
let bufferPercent = 0;
let bufferingCallback = null;
let tuneAttemptCallback = null;
let tokenExpiredCallback = null;

export function initPlayer(videoEl) {
  videoElement = videoEl;
  if (videoElement) videoElement.classList.add('hidden');
  return true;
}

export function onBuffering(callback) {
  bufferingCallback = callback;
}

export function onTuneAttempt(callback) {
  tuneAttemptCallback = callback;
}

export function onTokenExpired(callback) {
  tokenExpiredCallback = callback;
}

// Shaka-only events: nothing to report natively.
export function onTrackChange() {}
export function onChannelAdvance() {}

function referer(channel) {
  for (const k of Object.keys(channel.customHeaders || {})) {
    if (k.toLowerCase() === 'referer') return channel.customHeaders[k];
  }
  return null;
}

// A cut or failed stream: reopen it a couple of times, then let the app refresh the playlist once (tokens rotate).
function retryOrFail(channel, myToken, why) {
  if (myToken !== loadToken) return;
  logEvent('WARN', 'Native playback failed (' + why + '): ' + (channel.name || ''));
  diag('avplay failed (' + why + ') retries=' + retries + ' ' + channel.name);
  if (retries < RETRIES) {
    retries++;
    retryTimer = setTimeout(() => {
      if (myToken === loadToken) loadChannel(channel);
    }, RETRY_DELAY_MS);
    return;
  }
  showError('This channel could not play on your TV. Try another channel.');
  if (tokenExpiredCallback && !refreshAsked) {
    refreshAsked = true;
    retries = 0;
    tokenExpiredCallback(channel);
  }
}

export async function loadChannel(channel) {
  const myToken = ++loadToken;
  const prevUrl = currentChannel ? currentChannel.url : null;
  currentChannel = channel;
  clearTimeout(retryTimer);
  if (tuneCountersReset(prevUrl, channel.url)) {
    tuneAttempt = 1;
    retries = 0;
    refreshAsked = false;
  } else {
    tuneAttempt++;
  }
  try {
    if (tuneAttemptCallback) tuneAttemptCallback(tuneAttempt);
  } catch {}
  paused = false;
  bufferPercent = 0;
  hideError();
  showLoading(true);
  if (!avplay.isAvailable()) {
    diag('avplay unavailable: webapis=' + typeof window.webapis);
    showError('This TV has no native player for channels.');
    return false;
  }
  let started = false;
  avplay.onBuffering((buffering, percent) => {
    if (myToken !== loadToken) return;
    showLoading(false);
    if (typeof percent === 'number') bufferPercent = percent;
    if (bufferingCallback) bufferingCallback(buffering, percent);
  });
  // Before the first frame, play() resolving false reports the failure; after it, a cut stream lands here.
  avplay.onError((type) => {
    if (started) retryOrFail(channel, myToken, type);
  });
  const ok = await avplay.play(withAuthQuery(channel.url, channel.authQuery), {
    userAgent: channel.userAgent || null,
    referer: referer(channel),
  });
  if (myToken !== loadToken) return false;
  showLoading(false);
  if (!ok) {
    retryOrFail(channel, myToken, 'no picture');
    return false;
  }
  started = true;
  retries = 0;
  hideError();
  logEvent('INFO', 'Playing natively: ' + (channel.name || ''));
  diag('avplay playing ' + channel.name);
  return true;
}

export function reloadChannel() {
  if (!currentChannel) return;
  retries = 0;
  refreshAsked = false;
  tuneAttempt = 0; // loadChannel++ makes this a fresh first try
  loadChannel(currentChannel);
}

export function stop() {
  loadToken++;
  clearTimeout(retryTimer);
  avplay.stop();
  showLoading(false);
  hideError();
}

export function togglePlay() {
  paused = !paused;
  if (paused) avplay.pause();
  else avplay.resume();
}

export function getBufferingPercent() {
  return bufferPercent;
}

export function engineName() {
  return 'Samsung AVPlay';
}

export function isNativeAvailable() {
  return avplay.isAvailable();
}

export function isEmeSupported() {
  return false;
}

export function getVideoElement() {
  return videoElement;
}

// Shaka-only: no player object, qualities or audio tracks natively.
export function getPlayer() {
  return null;
}
export function getActiveTrack() {
  return null;
}
export function getActiveHeight() {
  return null;
}
export function getActiveBandwidth() {
  return null;
}
export function getResolutions() {
  return [];
}
export function getAudioTracks() {
  return [];
}
export function getActiveAudioId() {
  return null;
}
export function selectResolution() {}
export function selectAudioTrackById() {}
export function setAutoQuality() {}
