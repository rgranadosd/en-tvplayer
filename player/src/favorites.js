// Favorites, kept by the favorites API (favorites/server.mjs, on an always-on machine) so other apps on the TV
// (Raflix's "Directos" tab) can read them: a Tizen app can't read another's storage. A copy stays in localStorage
// for when the server doesn't answer. The server's address: Settings > Channel Source, or the build's
// (player/favorites.local.json).
import { timedFetch } from './utils.js';
import { guideIds } from './logic.js';
import { serverUrl, tvName } from './raflix-server.js';

const CACHE_KEY = 'en_favorites';
// The server and this TV's name there (Settings, or the build's): the server keeps each TV's favorites and recent.
const tvParam = (sep) => (tvName() ? sep + 'tv=' + encodeURIComponent(tvName()) : '');

let list = readCache();

function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function keep(next) {
  if (!Array.isArray(next)) return;
  list = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {}
}

export function isConfigured() {
  return !!serverUrl();
}

export function isFavorite(channel) {
  return !!channel && list.some((f) => f.name === channel.name);
}

export async function refreshFavorites() {
  if (!serverUrl()) return list;
  try {
    const res = await timedFetch(serverUrl() + '/favorites' + tvParam('?'), {}, 5000).promise;
    if (res.ok) keep((await res.json()).favorites);
  } catch {}
  return list;
}

function post(fav) {
  return timedFetch(
    serverUrl() + '/favorites' + tvParam('?'),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fav) },
    5000,
  ).promise;
}

// Adds or removes the channel; resolves to its new state, or null when the server couldn't save it. `channels`
// (the playlist) gives the favorite its guide ids, for what's on now in Raflix.
export async function toggleFavorite(channel, channels) {
  if (!serverUrl() || !channel) return null;
  const adding = !isFavorite(channel);
  try {
    const res = adding
      ? await post({
          name: channel.name,
          group: channel.group || '',
          logo: channel.logo || '',
          tvg: guideIds(channels, channel.name),
        })
      : await timedFetch(
          serverUrl() + '/favorites?name=' + encodeURIComponent(channel.name) + tvParam('&'),
          { method: 'DELETE' },
          5000,
        ).promise;
    if (!res.ok) return null;
    keep((await res.json()).favorites);
    return adding;
  } catch {
    return null;
  }
}

// The channel was watched: first in the server's "recent", which Raflix's "Directos" tab shows before the favorites.
export function noteWatched(channel, channels) {
  if (!serverUrl() || !channel) return;
  timedFetch(
    serverUrl() + '/recent' + tvParam('?'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: channel.name,
        group: channel.group || '',
        logo: channel.logo || '',
        tvg: guideIds(channels, channel.name),
      }),
    },
    5000,
  ).promise.catch(() => {});
}

// Favorites saved without guide ids (before the EPG) get them from the playlist, once.
export async function completeGuideIds(channels) {
  for (const fav of list.filter((f) => !f.tvg)) {
    const tvg = guideIds(channels, fav.name);
    if (!tvg.length) continue;
    try {
      const res = await post({ ...fav, tvg });
      if (res.ok) keep((await res.json()).favorites);
    } catch {}
  }
}

// The channel another app asked for when it opened this one (Raflix: Tizen app control data "channel" and "group").
export function requestedChannel() {
  try {
    const req = window.tizen.application.getCurrentApplication().getRequestedAppControl();
    const data = (req && req.appControl && req.appControl.data) || [];
    const get = (key) => {
      const d = data.find((x) => x.key === key);
      return d && d.value && d.value[0] ? String(d.value[0]) : '';
    };
    const name = get('channel');
    return name ? { name, group: get('group') } : null;
  } catch {
    return null;
  }
}
