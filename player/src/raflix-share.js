// This TV's favorites and recently watched, for Raflix's "Directos" tab: a file both apps read (Documents/
// raflix-iptv.json; a Tizen app can't read another's storage). Only when Raflix is installed on this TV: without it,
// no file is touched.
import { shareContent } from './logic.js';

const RAFLIX = 'FreeMyTVio.FreeMyTV';
const FILE = 'raflix-iptv.json';

function raflixInstalled() {
  try {
    return !!window.tizen.application.getAppInfo(RAFLIX);
  } catch {
    return false; // not installed (NotFoundError), or not a Tizen TV
  }
}

export function shareLists(favorites, recent, channels) {
  if (!raflixInstalled()) return;
  const text = JSON.stringify(shareContent(favorites, recent, channels, Date.now()));
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
