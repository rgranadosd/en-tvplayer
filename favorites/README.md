# Favorites API

EN-IPTV's favorites live here, not on the TV, so other apps can read them (a Samsung app can't read another app's
storage). Raflix's **Directos** tab shows them as cards and opens EN-IPTV on the channel.

- **On the TV:** the **Red** key adds the channel playing (or the one focused in the channel list) to the favorites,
  or removes it.
- **The file:** `favorites.yml` (in `data/` with Docker), plain YAML, safe to edit by hand.

## Run it

On an always-on machine on the same network, with Docker: copy `server.mjs` and `docker-compose.yml` to a folder
there, then `docker compose up -d`. The favorites stay in `data/favorites.yml` next to them. To update, copy the new
`server.mjs` and run `docker compose restart`.

Without Docker (Node 18+, no dependencies): `node favorites/server.mjs [port] [file]` (port 5002 and
`favorites/favorites.yml` by default).

## Point the apps at it

- **EN-IPTV:** `player/favorites.local.json` (not in git) with `{"url": "http://<machine-ip>:5002"}`, then build.
  Without it, the Red key says the server is missing.
- **Raflix:** `iptv_favorites_url=http://<machine-ip>:5002` in `free-my-tv/config.properties`, then build.

## API

| Method | Path | Body | |
|---|---|---|---|
| GET | `/favorites` | | `{"favorites": [{"name", "group", "logo"}]}` |
| POST | `/favorites` | `{"name", "group", "logo"}` | adds one (updates it when the name is there) |
| DELETE | `/favorites?name=…` | | removes one |

Channels are matched by name (stream URLs rotate); the group picks the right one when a name repeats.
