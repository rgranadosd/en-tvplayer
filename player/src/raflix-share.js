// This TV's favorites and recently watched, with what's on them for the next hours, for Raflix's "Directos" tab: a
// file both apps read (Documents/raflix-iptv.json; a Tizen app can't read another's storage). Only when Raflix is
// installed on this TV: without it, no file is touched and no guide is downloaded.
import { shareContent } from './logic.js';
import { guideAddress, guideWindow } from './guide.js';
import { getActivePlaylist } from './config.js';
import { timedFetch } from './utils.js';

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

// The guide the playlist names (its first line's url-tvg; ~3 MB, 6 s on a 2018 TV): its next hours kept, then the file
// written again. Called once a channel is up, so it never slows the first one.
export async function refreshGuide(favorites, recent, channels) {
  if (!raflixInstalled()) return;
  try {
    const playlist = getActivePlaylist();
    if (!playlist || !playlist.url) return;
    const res = await timedFetch(playlist.url, {}, 20000).promise;
    const address = guideAddress(await res.text());
    if (!address) return;
    const xml = await (await timedFetch(address, {}, 60000).promise).text();
    const now = Date.now();
    guide = guideWindow(xml, now, now + GUIDE_HOURS * 3600000);
  } catch {
    return; // no guide this time: the file keeps the last one
  }
  shareLists(favorites, recent, channels);
}
