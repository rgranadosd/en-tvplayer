// Pure, DOM-free logic for unit testing (Vitest, node env).
// Everything here must stay side-effect free: no localStorage, no
// document, no timers — inputs in, values out. Callers in main.js,
// ui.js and player.js own the module state and the DOM.

// The two lists kept on this TV (favorites.js), shown as groups before the playlist's ones.
export const FAVORITES_GROUP = '★ Favorites';
export const RECENT_GROUP = 'Recently watched';
export const RECENT_MAX = 20;

// lists: {favorites, recent}, channel names; the two groups above show them in their order.
export function filterDisplayChannels(allChannels, hiddenGroups, selectedGroup, lists) {
  const hidden = hiddenGroups || [];
  const visible = (allChannels || []).filter((ch) => !hidden.includes((ch && ch.group) || 'Ungrouped'));
  if (selectedGroup === FAVORITES_GROUP) return channelsByName(visible, lists && lists.favorites);
  if (selectedGroup === RECENT_GROUP) return channelsByName(visible, lists && lists.recent);
  if (selectedGroup === 'all' || !selectedGroup) return visible;
  return visible.filter((ch) => ((ch && ch.group) || 'Ungrouped') === selectedGroup);
}

// Boot resume: identity is the channel URL (stable across playlist
// refresh and re-sort); a raw index would rot on every fetch. Returns
// the index, or -1 when nothing was saved, the channel is gone, or its
// group is now hidden.
export function findResumeIndex(channels, lastChannelUrl, hiddenGroups) {
  if (!lastChannelUrl) return -1;
  const at = (channels || []).findIndex((ch) => ch && ch.url === lastChannelUrl);
  if (at < 0) return -1;
  const group = (channels[at] && channels[at].group) || 'Ungrouped';
  if ((hiddenGroups || []).includes(group)) return -1;
  return at;
}

// Background-refresh re-tune: names + groups survive token rotation,
// URLs don't. Returns the index of the same channel, or -1.
export function findIntentIndex(channels, intent) {
  if (!intent) return -1;
  return (channels || []).findIndex(
    (ch) => ch && ch.name === intent.name && ((ch && ch.group) || 'Ungrouped') === intent.group,
  );
}

// A channel asked for by name (a favorite opened from another app): the same
// name in the same group first, else the first with that name. Channels in
// hidden groups don't count. Returns the index, or -1.
export function findRequestedIndex(channels, request, hiddenGroups) {
  if (!request || !request.name) return -1;
  const hidden = hiddenGroups || [];
  const groupOf = (ch) => (ch && ch.group) || 'Ungrouped';
  const usable = (ch) => ch && ch.name === request.name && !hidden.includes(groupOf(ch));
  const list = channels || [];
  const exact = list.findIndex((ch) => usable(ch) && groupOf(ch) === (request.group || 'Ungrouped'));
  return exact >= 0 ? exact : list.findIndex(usable);
}

// The channels with these names, in the names' order: the first copy of each in the playlist (one can come several
// times, in event groups); names no longer in it are skipped.
export function channelsByName(channels, names) {
  const out = [];
  for (const name of names || []) {
    const ch = (channels || []).find((c) => c && c.name === name);
    if (ch) out.push(ch);
  }
  return out;
}

// The channel just watched first in the recent list, without its earlier place; the oldest out past RECENT_MAX.
export function rememberRecent(names, name) {
  return [name, ...(names || []).filter((n) => n !== name)].slice(0, RECENT_MAX);
}

// Live-segment-404 reload budget: 3 edge re-syncs per URL inside a
// 5-minute window, then the link is condemned. Pure version of the
// player.js segment404* state machine — pass the stored state in, get
// the decision plus the next state back.
export function segment404Decision(prevState, url, now = Date.now()) {
  let attempts = 0;
  if (prevState && prevState.url === url && now - prevState.lastAt <= 5 * 60 * 1000) {
    attempts = prevState.attempts;
  }
  if (attempts >= 3) {
    return { retry: false, state: { url, attempts, lastAt: now } };
  }
  return { retry: true, state: { url, attempts: attempts + 1, lastAt: now } };
}

// 401/403 mid-playback budget: `attempts` is the count AFTER
// incrementing. Three fresh-token retries, then advance channels.
export function lastResortDecision(attempts) {
  return attempts <= 3 ? 'retry' : 'advance';
}

// Expired-token recovery policy: the dead token URL is frozen into the
// channel object, so same-URL reloads only win inside the server grace
// window. Two fast reloads, then ONE playlist refetch for a fresh token
// (the caller owns the refetch), then give up the channel.
export function tokenRecoveryDecision(attempts) {
  if (attempts <= 2) return 'reload';
  if (attempts === 3) return 'refresh';
  return 'advance';
}

// 403 retry cool-down: exponential backoff, capped — a fixed short delay
// hammers rate-limiting relays into banning the IP (BUG-021).
export function forbiddenRetryDelay(attempts) {
  return Math.min(4000 * 2 ** (attempts - 1), 16000);
}

// Channel-switch counter hygiene (#16): a dead channel's error/retry
// counters must not poison the next tune — reset them when the URL changes,
// keep them on same-URL reloads (mid-playback token refresh owns that path).
export function tuneCountersReset(prevUrl, nextUrl) {
  return prevUrl !== nextUrl;
}

// Player-generation guard (#16): a previous Shaka instance whose destroy()
// hung can still fire error/buffering/adaptation events after the switch —
// events from any older generation must be ignored.
export function isStalePlayerEvent(eventGen, currentGen) {
  return eventGen !== currentGen;
}

// Teardown-src filter (#16): our own teardown (video.src='' + load())
// fires a code-4 "Empty src" video error — not a real channel failure.
export function shouldIgnoreVideoError({ code, message, srcEmpty } = {}) {
  if (code !== 4 || !srcEmpty) return false;
  return /empty src/i.test(message || '');
}

// Per-tune hard-reload budget (freeze/crash report): `reloads` counts hard
// reloads already done for this tune (stall-watchdog + consecutive-error).
// Three full destroy/create cycles, then give up with a terminal message —
// an endless loop piles hung players and MSE buffers until the TV kills us.
export function hardReloadDecision(reloads) {
  return reloads < 3 ? 'reload' : 'giveup';
}

// Fast-zap guard (tune race): every remote press runs a full tune body, so a
// burst of presses overlaps N destroy/create cycles on one shared video
// element — a late stale destroy wipes the winner's fresh load (silent
// black). Each tune takes a sequence number; anything superseded by a newer
// press must return before touching the player.
export function tuneSuperseded(mySeq, latestSeq) {
  return mySeq !== latestSeq;
}

// Unexpected-pause resume (fast-zap stuck state): load resolved and the pill
// went away, yet nothing plays — a late stale teardown paused (or wiped) the
// shared video element. Resume unless the pause is the user's own intent or
// playback actually ended. A wiped src fails play() and falls through to the
// normal stall → reload path instead of sitting stuck forever.
export function shouldResumePlayback({ paused, ended, userPaused } = {}) {
  return !!paused && !ended && !userPaused;
}

// Stall-watchdog patience (flaky-relay report): a frozen clock alone is not
// proof of stuck — segments may still be flowing while the decoder waits
// (slow relay, transmux backlog) or Shaka may be mid-retry-cycle. Escalate
// only when the network is idle too; otherwise re-baseline and keep waiting
// instead of trampling a recovery that was already in flight.
export function isNetworkActive(lastActivityAt, now = Date.now(), quietMs = 10000) {
  return now - lastActivityAt < quietMs;
}

// Bounded patience: a frozen picture with a live network gets a few extra
// windows (chatty playlist, starved segments) — then we restart the tune
// anyway instead of waiting forever on a stream that never becomes playable.
export function stallPatienceExceeded(deferrals, maxDeferrals = 4) {
  return deferrals >= maxDeferrals;
}

// Single-narrative tune UX: one bottom line owns "taking too long"
// messaging (thresholds kept: whisper at 4s, plain talk at 9s).
const SLOW_HINTS = [
  [4000, 'Slow server — holding on…'],
  [9000, 'Taking longer than usual — you can wait or try another channel'],
];

export function slowHintFor(elapsedMs) {
  let hint = '';
  for (const [after, text] of SLOW_HINTS) {
    if (elapsedMs >= after) hint = text;
  }
  return hint;
}

// Light attempt indicator for the status line: silent on the first try,
// " • try N" once silent retries begin (user asked to see it, subtly).
export function attemptSuffix(attempt) {
  return attempt > 1 ? ' • try ' + attempt : '';
}

// Build-time playlists (player/playlists.local.json) to add to the saved ones:
// those not saved yet (by URL), and never one added before — deleted on the TV,
// it stays deleted.
export function playlistsToAdd(saved, extra, alreadyAdded) {
  const urls = (saved || []).map((p) => p && p.url);
  const added = alreadyAdded || [];
  return (extra || []).filter((p) => p && p.url && !urls.includes(p.url) && !added.includes(p.url));
}

// Before the first frame: the buffer started filling and has not moved for stallMs — the server stopped sending
// (a channel server that serves one stream at a time does this when another connection takes it). Nothing
// buffered yet is a slow start (some channels take 20-30 s to begin), not a stall. progressAt is 0 until then.
export function bufferStalled(progressAt, now, stallMs) {
  return progressAt > 0 && now - progressAt >= stallMs;
}

// Build-time playlists that replace a saved one: same name, a different URL, and the saved one came from an earlier
// build (its URL is in alreadyAdded) — a TV moving to its own login keeps one "Raflix", not two. A same-name playlist
// the user added by hand is left alone. [{index, playlist}]
export function playlistsToReplace(saved, extra, alreadyAdded) {
  const added = alreadyAdded || [];
  const out = [];
  (extra || []).forEach((p) => {
    if (!p || !p.url) return;
    const index = (saved || []).findIndex((s) => s && s.name === p.name && s.url !== p.url && added.includes(s.url));
    if (index >= 0) out.push({ index, playlist: p });
  });
  return out;
}

// What this TV shares with Raflix's "Directos" tab: the recent channels and the favorites, with the group and logo of
// their first copy in the playlist (just the name when it's no longer there).
export function shareContent(favorites, recent, channels, now) {
  const card = (name) => {
    const ch = channelsByName(channels, [name])[0];
    return ch ? { name, group: ch.group || '', logo: ch.logo || '' } : { name };
  };
  return { updated: now, recent: (recent || []).map(card), favorites: (favorites || []).map(card) };
}
