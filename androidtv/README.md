# RAFLIX IPTV for Android TV

A native Android TV app (Kotlin, Media3/ExoPlayer, no WebView) that does what the Samsung package does, for the Sony
BRAVIA 4K (ATV3, Android 9) and any other Android TV. Nothing here touches the Tizen packages: `npm run build` /
`npm run tizen` are as they were.

## What it does

The same behavior as the Tizen player, from the same playlist:

- The channel list (groups, "All Channels", this TV's ★ Favorites and Recently watched first when they have
  something), the OSD on a channel change, what's on now in the list and now/next when a channel starts (the
  playlist's `x-raflix-epg` light guide, else its `url-tvg` XMLTV, read as a stream).
- The same remote: Up/Down and CH± zap within the group on screen, Left/OK open the list, Right/Menu the menu, Back
  asks before leaving, numbers tune by channel number, Red = favorite, Green = groups, Yellow = picture format,
  Blue = reload, Play/Pause, Stop.
- Playback with ExoPlayer: HLS, DASH, MPEG-TS, per-channel User-Agent and headers (`#KODIPROP stream_headers`,
  `#EXTVLCOPT`, `#EXTHTTP`, Kodi `|` suffix), ClearKey from inline keys (`license_key`, `drmLicense=`). A failure
  retries with a growing pause, five times, then says why.
- The channel it was on comes back at the next start; the playlist is downloaded first, the copy on disk is used when
  that fails (with a notice).
- Hardware video decoding, a `SurfaceView`, small buffers for a quick start: made for an old TV.

Branding uses the current RAFLIX IPTV wordmark, not the old R icon: the launcher icons and TV banner come from
`tizen/icon.png` and `tizen/icon-legacy.png`; the native watermark is a vector converted from
`tizen/icons/raflix-iptv-wordmark-night.svg`.

Not there (yet): the settings page, playlist editing on the TV (the playlist is built in, per TV), channel search,
logos in the list, the Raflix share file.

The native interface is in Spanish, including menus, loading notices, playback errors and built-in group labels,
regardless of the TV's language. Channel names, playlist-provided groups and programme titles stay as supplied.
Group identifiers and saved preferences are unchanged.

RAFLIX opens only when selected; it does not register for boot. Exit, Home/switching to another app and screen-off
end the session: player/retries, guide and playlist jobs and UI timers are stopped, the task is removed, and only
RAFLIX's own process is terminated (including any blocking network reads). Screen-off returns to the TV launcher
so waking the TV does not resume RAFLIX. Favorites, recent channels and the last channel remain saved for the next
manual launch. No background playback or resumable task is kept.

## Requirements (this Mac)

- JDK 21 (`java` on the PATH, or `JAVA_HOME`).
- Android SDK command-line tools: `brew install --cask android-commandlinetools`, then
  `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` and `sdkmanager --licenses`.
  `androidtv/local.properties` (not in git) points at it: `sdk.dir=/opt/homebrew/share/android-commandlinetools`.

## Build

```bash
RAFLIX_TV=papa npm run android     # → androidtv/app/build/outputs/apk/debug/app-debug.apk
```

`RAFLIX_TV` picks this TV's playlist in `player/playlists.local.json`, as the Tizen builds do: the build stops without
it, with an unknown TV or an unfilled `<…>` login. `versionCode`/`versionName` come from the root `package.json`.
Unit tests (the M3U reader, the guide, the groups — the cases of the player's Vitest suites):
`cd androidtv && ./gradlew testDebugUnitTest`.

## Install on the TV

On the TV, once: Settings › Device Preferences › About › press *Build* seven times, then Developer options ›
*Network debugging* (ADB) on. Then, from the Mac on the same network:

```bash
npm run android:install -- <tv-ip> --launch     # adb connect + install -r (+ start it)
npm run android:install -- <tv-ip> --uninstall
```

The first connection asks on the TV to allow this computer. The debug APK is signed with the local debug keystore
(`~/.android/debug.keystore`): keep building on the same Mac, or the TV treats a new build as a different app (its
favorites and recent channels are lost).

`adb logcat -s RaflixIPTV ExoPlayerImpl AndroidRuntime` shows the app's side when something is off.

## Layout

```
androidtv/
├── install.mjs                  adb installer (npm run android:install)
├── app/build.gradle.kts         versions from package.json, the playlist from playlists.local.json (RAFLIX_TV)
└── app/src/main/java/com/raflix/iptv/
    ├── MainActivity.kt          the app: playlist, the channel playing, the remote (main.js)
    ├── PlayerEngine.kt          ExoPlayer: headers, ClearKey, retries, picture format (player.js)
    ├── Sidebar.kt, RowAdapter.kt  groups / channels / menu list (ui.js)
    ├── Osd.kt                   channel OSD, now/next, notices, spinner, error line
    ├── Remote.kt                Android TV key codes → actions (remote.js)
    ├── Playlist.kt, M3uParser.kt  download + cache, the M3U reader (utils.js parseM3u)
    ├── Guide.kt                 x-raflix-epg JSON / XMLTV, now/next (guide.js)
    ├── Groups.kt, TvLists.kt    groups (ui.js extractGroups), favorites/recent/last channel (favorites.js)
    └── Channel.kt               the data
```
