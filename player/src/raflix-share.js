// This TV's favorites and recently watched, with what's on them for the next hours, for Raflix's "Directos" tab: a
// file both apps read (Documents/raflix-iptv.json; a Tizen app can't read another's storage). Only when Raflix is
// installed on this TV: without it, no file is touched (the guide is still downloaded, for the channel list).
import { shareContent } from './logic.js';
import { guideAddress, guideJsonAddress, guideFromJson, guideWindow } from './guide.js';
import { getActivePlaylist } from './config.js';
import { timedFetch } from './utils.js';
import { diag } from './diag.js';

const RAFLIX = 'FreeMyTVio.FreeMyTV';
const FILE = 'raflix-iptv.json';
const GUIDE_HOURS = 12; // Raflix picks what's on by the clock: still right hours after this app was last opened

let guide = {}; // the next GUIDE_HOURS of every channel in the guide, by guide id (a new favorite has its guide at once)

function raflixInstalled() {
  try {
    return !!window.tizen.application.getAppInfo(RAFLIX);
  } catch {
    return false; // not installed (NotFoundError), or not a Tizen TV
  }
}

export function shareLists(favorites, recent, channels) {
  if (!raflixInstalled()) return;
  const text = JSON.stringify(shareContent(favorites, recent, channels, Date.now(), guide));
  try {
    window.tizen.filesystem.resolve(
      'documents',
      (dir) => {
        let file;
        try {
          file = dir.resolve(FILE);
        } catch {
          file = dir.createFile(FILE);
        }
        file.openStream(
          'w',
          (stream) => {
            stream.write(text);
            stream.close();
          },
          () => {},
        );
      },
      () => {},
      'rw',
    );
  } catch {}
}

// The guide the playlist names: its light one when it has one (x-raflix-epg: a JSON window, ~50 KB the TV reads
// natively), else, or when that fails, the XMLTV (url-tvg: ~3 MB, 6 s to read on a 2016 TV, on the app's only
// thread). Its next hours kept, then the file written again. Called once a channel is up, so it never slows the first
// one; the channel list shows it too, so it is downloaded without Raflix as well. Resolves to the guide (the last one
// on a failure). The diag log says which one was read and what it cost.
export async function refreshGuide(favorites, recent, channels) {
  try {
    const playlist = getActivePlaylist();
    if (!playlist || !playlist.url) return guide;
    const m3u = await (await timedFetch(playlist.url, {}, 20000).promise).text();
    const next = (await lightGuide(guideJsonAddress(m3u))) || (await xmltvGuide(guideAddress(m3u)));
    if (!next) return guide;
    guide = next;
  } catch {
    return guide; // no guide this time: the file and the list keep the last one
  }
  shareLists(favorites, recent, channels);
  return guide;
}

function report(kind, size, downloadMs, readMs) {
  const line =
    'guide (' +
    kind +
    '): ' +
    Math.round(size / 1024) +
    ' KB downloaded in ' +
    downloadMs +
    ' ms, read in ' +
    readMs +
    ' ms';
  setTimeout(() => diag(line), 0);
}

// null without an address, or when it fails (the XMLTV is read then).
async function lightGuide(address) {
  if (!address) return null;
  try {
    const t0 = Date.now();
    const text = await (await timedFetch(address, {}, 20000).promise).text();
    const now = Date.now();
    const out = guideFromJson(JSON.parse(text), now, now + GUIDE_HOURS * 3600000);
    report('json', text.length, now - t0, Date.now() - now);
    return out;
  } catch (e) {
    const line = 'guide (json) failed, reading the XMLTV: ' + (e && e.message);
    setTimeout(() => diag(line), 0);
    return null;
  }
}

// null without an address; a failed download throws (refreshGuide keeps the last guide).
async function xmltvGuide(address) {
  if (!address) return null;
  const t0 = Date.now();
  const xml = await (await timedFetch(address, {}, 60000).promise).text();
  const now = Date.now();
  const out = guideWindow(xml, now, now + GUIDE_HOURS * 3600000);
  report('xmltv', xml.length, now - t0, Date.now() - now);
  return out;
}
