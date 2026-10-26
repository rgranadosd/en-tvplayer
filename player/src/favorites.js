// Favorites (Red key) and the last watched channels, kept on this TV (localStorage): each TV its own lists, shown as
// the "★ Favorites" and "Recently watched" groups. Channels are kept by name, the same channel's identity the playlist
// refresh keeps (URLs can rotate).
import { rememberRecent } from './logic.js';

const FAVORITES_KEY = 'en_favorites'; // earlier builds kept a copy of the favorites API's list here: still read
const RECENT_KEY = 'en_recent';

let favorites = read(FAVORITES_KEY);
let recent = read(RECENT_KEY);

// Names; an earlier build's [{name, group, logo, …}] read as their names.
function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v.map((f) => (typeof f === 'string' ? f : f && f.name)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(key, names) {
  try {
    localStorage.setItem(key, JSON.stringify(names));
  } catch {}
}

export function isFavorite(channel) {
  return !!channel && favorites.includes(channel.name);
}

export function favoriteNames() {
  return favorites;
}

export function recentNames() {
  return recent;
}

// Adds or removes the channel; its new state.
export function toggleFavorite(channel) {
  const adding = !isFavorite(channel);
  favorites = adding ? [...favorites, channel.name] : favorites.filter((n) => n !== channel.name);
  write(FAVORITES_KEY, favorites);
  return adding;
}

// The channel was watched: first in the recent list.
export function noteWatched(channel) {
  if (!channel || !channel.name) return;
  recent = rememberRecent(recent, channel.name);
  write(RECENT_KEY, recent);
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
