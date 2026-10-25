# Favorites API

EN-IPTV's favorites live here, not on the TV, so other apps can read them (a Samsung app can't read another app's
storage). Raflix's **Directos** tab shows them as cards and opens EN-IPTV on the channel.

- **On the TV:** the **Red** key adds the channel playing (or the one focused in the channel list) to the favorites,
  or removes it.
- **The file:** `favorites.yml` (in `data/` with Docker), plain YAML, safe to edit by hand.

## Run it

On an always-on machine on the same network, with Docker, from a clone of this repo (it's public):

```bash
git clone https://github.com/rgranadosd/en-tvplayer.git && cd en-tvplayer/favorites
echo 'EPG_URL=<the playlist url-tvg>' > .env      # optional: what's on now and next; the URL can carry a login
docker compose up -d
```

To update: `git pull && docker compose up -d --force-recreate`. The favorites stay in `data/favorites.yml` and the
guide address in `.env`, both out of git.

Without Docker (Node 18+, no dependencies): `EPG_URL=… node favorites/server.mjs [port] [file]` (port 5002 and
`favorites/favorites.yml` by default).

## What's on now (EPG)

With `EPG_URL` (an XMLTV guide: the `url-tvg` in the playlist's first line), the API downloads the guide at start
and every 30 minutes, and each favorite comes with `now` and `next` (`{title, start, stop}`, epoch ms). It finds them
by the favorite's `tvg` (its guide ids): the app sends every `tvg-id` the channel has in the playlist, since event
groups repeat channels under ids without a guide, and fills them in for favorites saved before.

## Point the apps at it

- **EN-IPTV:** `player/favorites.local.json` (not in git) with `{"url": "http://<machine-ip>:5002"}`, then build.
  Without it, the Red key says the server is missing.
- **Raflix:** `iptv_favorites_url=http://<machine-ip>:5002` in `free-my-tv/config.properties`, then build.

## API

| Method | Path | Body | |
|---|---|---|---|
| GET | `/favorites` | | `{"favorites": [{"name", "group", "logo", "tvg", "now", "next"}]}` |
| POST | `/favorites` | `{"name", "group", "logo", "tvg"}` | adds one (updates it when the name is there) |
| DELETE | `/favorites?name=…` | | removes one |

Channels are matched by name (stream URLs rotate); the group picks the right one when a name repeats.
