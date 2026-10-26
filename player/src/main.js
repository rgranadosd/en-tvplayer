import { getSettings, saveSettings, getActivePlaylist, getHiddenGroups, APP_VERSION } from './config.js';
import * as player from './player.js';
import * as ui from './ui.js';
import * as remote from './remote.js';
import * as settings from './settings.js';
import { checkForUpdate, sendUsagePing, consentAsked, hasConsented, setConsented } from './update.js';
import { fetchPlaylistEntry, fetchPlaylistWithRetry } from './utils.js';
import {
  filterDisplayChannels,
  findResumeIndex,
  findIntentIndex,
  findRequestedIndex,
  tuneSuperseded,
} from './logic.js';
import * as favorites from './favorites.js';
import { diag, diagEnabled } from './diag.js';

let currentIndex = 0;
let channels;
let selectedGroup = null;
let bufferingInterval = null;
let bufferingActive = false;
let cleanupListeners = [];

// Boot recovery: the boot tune uses cached (possibly stale-token) URLs while
// the background refresh fetches fresh ones. If nothing is playing once the
// refresh lands, re-tune the latest intent with its fresh URL.
let playbackStarted = false;
let tuneSucceeded = false;
let tuneInFlight = false; // a loadChannel() not answered yet: slow TVs take longer than the playlist refresh
let lastIntent = null;
// Fast-zap sequence: overlapping tune bodies from a burst of presses share
// one video element — only the latest press may touch the player.
let tuneSeq = 0;
// A channel on screen this long counts as watched (the "Recently watched" group); zapping past it doesn't.
const WATCHED_MS = 10000;
let watchedTimer = null;

/* Responsive TV scaling: detect screen size and set CSS variable */
function applyResponsiveScale() {
  const sw = screen.width || 1920;
  const sh = screen.height || 1080;
  const scale = Math.max(sw / 1920, sh / 1080, 1.35);
  document.documentElement.style.setProperty('--tv-scale', scale);
}
applyResponsiveScale();

function getDisplayChannels() {
  return filterDisplayChannels(channels, getHiddenGroups(), selectedGroup);
}

const BOOT_TITLE = 'RAFLIX IPTV';
const BOOT_TAGLINE = 'Forked from EN IPTV';
const BOOT_TITLE_DELAY = 500;
const BOOT_TITLE_CHAR = 90;
const BOOT_TAGLINE_GAP = 200;
const BOOT_TAGLINE_CHAR = 40;
let bootTypewriterTimer = null;
let bootShownAt = 0;
let bootTypewriterEnd = 0;
const BOOT_MIN_MS = 1500; // logo stays at least this long on every launch
const BOOT_ZOOM_MS = 700; // fly-into-the-logo exit
const BOOT_IDLE_HOLD_MS = 1500; // extra hold after tagline when no playlist fetch runs
const BOOT_READ_MS = 1800; // linger once all text is up so it can be read
// Opened by Raflix on a channel: no splash and no What's New (shown on the next normal launch), straight to the
// channel, so the two apps feel like one.
const quietBoot = !!favorites.requestedChannel();

// `always`: also when quietBoot (no channels cached yet: nothing else to show while the playlist downloads).
function hideLaunchSpinner() {
  const el = document.getElementById('launch-spinner');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function showBootSplash(statusText, always = false) {
  const el = document.getElementById('boot-splash');
  const statusEl = document.getElementById('boot-status');
  const typeEl = document.getElementById('boot-typewriter');
  const loadingEl = document.getElementById('boot-loading');
  const verEl = document.getElementById('boot-version');
  if (!el || (quietBoot && !always)) return;
  hideLaunchSpinner();
  if (statusEl && statusText) statusEl.textContent = statusText;
  if (verEl) verEl.textContent = 'v' + APP_VERSION + ' · ' + player.packageLabel().split(' · ')[0];
  // Reset animation state
  const titleEl = document.getElementById('boot-logo-text');
  if (titleEl) {
    titleEl.textContent = '';
    titleEl.classList.add('typing');
  }
  if (typeEl) {
    typeEl.textContent = '';
    typeEl.classList.remove('done');
  }
  if (loadingEl) {
    loadingEl.style.animation = 'none';
    loadingEl.offsetHeight;
    loadingEl.style.animation = '';
  }
  const logo = document.getElementById('boot-logo');
  if (logo) logo.classList.remove('zoom-in');
  el.classList.remove('hidden', 'fade-out', 'zooming');
  bootShownAt = Date.now();
  clearTimeout(bootTypewriterTimer);
  el.classList.toggle('static', !!player.LIGHT_BOOT);
  if (player.LIGHT_BOOT) {
    // Slow TVs: the text at once, no typing (each step costs them CPU while the playlist downloads).
    if (titleEl) {
      titleEl.innerHTML = 'RAFLIX <span>IPTV</span>';
      titleEl.classList.remove('typing');
    }
    if (typeEl) typeEl.textContent = BOOT_TAGLINE;
    bootTypewriterEnd = bootShownAt;
    return;
  }
  // Stage 1: icon is already visible — type the title, then the tagline.
  bootTypewriterEnd =
    bootShownAt +
    BOOT_TITLE_DELAY +
    BOOT_TITLE.length * BOOT_TITLE_CHAR +
    BOOT_TAGLINE_GAP +
    BOOT_TAGLINE.length * BOOT_TAGLINE_CHAR;
  startTypewriter(titleEl, BOOT_TITLE, BOOT_TITLE_CHAR, BOOT_TITLE_DELAY, () => {
    // Colorize "IPTV" once typing finishes, drop the caret.
    if (titleEl) {
      titleEl.innerHTML = 'RAFLIX <span>IPTV</span>';
      titleEl.classList.remove('typing');
    }
    startTypewriter(typeEl, BOOT_TAGLINE, BOOT_TAGLINE_CHAR, BOOT_TAGLINE_GAP);
  });
}

function startTypewriter(el, text, charDelay, startDelay, onDone) {
  if (!el) {
    if (onDone) onDone();
    return;
  }
  let i = 0;
  bootTypewriterTimer = setTimeout(function tick() {
    if (i < text.length) {
      el.textContent = text.slice(0, i + 1);
      i++;
      bootTypewriterTimer = setTimeout(tick, charDelay);
    } else {
      el.classList.add('done');
      if (onDone) onDone();
    }
  }, startDelay);
}

function hideBootSplash(holdAfterTypeMs = 0, onDone = null) {
  const el = document.getElementById('boot-splash');
  const finish = () => {
    if (typeof onDone === 'function') onDone();
  };
  if (!el || el.classList.contains('hidden')) {
    finish();
    return;
  }
  if (player.LIGHT_BOOT) {
    el.classList.add('hidden'); // slow TVs: no hold, zoom or fade
    finish();
    return;
  }
  // Hold the logo for a beat AND until the tagline finishes typing
  // (plus an optional extra hold for the idle/no-fetch path),
  // then fly into it before fading the overlay.
  const waitMin = Math.max(0, BOOT_MIN_MS - (Date.now() - bootShownAt));
  const waitType = Math.max(0, bootTypewriterEnd - Date.now()) + holdAfterTypeMs;
  const wait = Math.max(waitMin, waitType) + BOOT_READ_MS;
  setTimeout(() => {
    clearTimeout(bootTypewriterTimer);
    el.classList.add('zooming');
    const logo = document.getElementById('boot-logo');
    if (logo) logo.classList.add('zoom-in');
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('fade-out', 'zooming');
        if (logo) logo.classList.remove('zoom-in');
        finish();
      }, 500);
    }, BOOT_ZOOM_MS);
  }, wait);
}

const LAST_SEEN_KEY = 'en_last_seen_version';

// RAFLIX IPTV's own history; EN IPTV's (what it was forked from) is in CHANGELOG.md.
const CHANGELOG = [
  {
    version: '1.0.0',
    sections: [
      {
        type: 'added',
        items: ['RAFLIX IPTV 1.0.0: the first stable version'],
      },
    ],
  },
  {
    version: '1.0.0-rc.3',
    sections: [
      {
        type: 'added',
        items: ["What's on now on your favorites, in Raflix's Directos tab (from the playlist's guide)"],
      },
    ],
  },
  {
    version: '1.0.0-rc.2',
    sections: [
      {
        type: 'changed',
        items: [
          'Opened from Raflix on a channel: no splash, straight to the channel',
          'A spinner shows while the app starts',
        ],
      },
    ],
  },
  {
    version: '1.0.0-rc.1',
    sections: [
      {
        type: 'added',
        items: [
          'RAFLIX IPTV: new name and logo (forked from EN IPTV 3.2.0)',
          'Favorites: Menu (→) › Add to Favorites, or the Red key',
          'Favorite channels show a ♥ in the channel list',
          'Favorites are shared with Raflix (Directos tab) through the favorites server',
          'Opened from Raflix, the app tunes the chosen channel',
        ],
      },
    ],
  },
];

function checkWhatsNew() {
  try {
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    if (lastSeen === APP_VERSION) return false;
    return true;
  } catch {
    return true;
  }
}

function markVersionSeen() {
  try {
    localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
  } catch {}
}

function showWhatsNew() {
  const modal = document.getElementById('whats-new-modal');
  const body = document.getElementById('whats-new-body');
  const verEl = document.getElementById('whats-new-version');
  const closeBtn = document.getElementById('whats-new-close');
  if (!modal || !body) return;

  if (verEl) verEl.textContent = 'v' + APP_VERSION;
  const iconMap = { added: ['\u2713', 'added'], fixed: ['\u26A0', 'fixed'], changed: ['\u2192', 'changed'] };
  let html = '';
  if (pendingUpdate) {
    html += '<div class="wn-section">';
    html += '<div class="wn-section-title">Update available: v' + pendingUpdate.latest + '</div>';
    html +=
      '<div class="wn-item"><span class="wn-icon added">\u2192</span><span>Reinstall via Apps2Samsung to update.</span></div>';
    html += '</div>';
  }
  for (const entry of CHANGELOG) {
    if (entry.version === '1.0.0') break;
    html += '<div class="wn-section">';
    html += '<div class="wn-section-title">v' + entry.version + '</div>';
    for (const sec of entry.sections) {
      const [icon, cls] = iconMap[sec.type] || ['\u2022', 'added'];
      for (const item of sec.items) {
        html +=
          '<div class="wn-item"><span class="wn-icon ' + cls + '">' + icon + '</span><span>' + item + '</span></div>';
      }
    }
    html += '</div>';
  }
  body.innerHTML = html;
  modal.classList.remove('hidden');
  // Focus the button for remote/keyboard navigation
  closeBtn.focus();
  // Also handle keyboard Enter/Escape for desktop
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      document.removeEventListener('keydown', onKey);
      closeWhatsNew();
    }
  };
  document.addEventListener('keydown', onKey);
}

function hideBootSplashAndMaybeWhatsNew(holdAfterTypeMs = 0, onDone = null) {
  // The modal waits for the splash to be fully gone — a fixed timer raced
  // the zoom/fade exit and popped it over the splash mid-load.
  hideBootSplash(holdAfterTypeMs, () => {
    if (typeof onDone === 'function') onDone();
    if (!quietBoot && checkWhatsNew()) {
      setTimeout(showWhatsNew, 300);
    }
  });
}

function isWhatsNewOpen() {
  const el = document.getElementById('whats-new-modal');
  return el && !el.classList.contains('hidden');
}

function closeWhatsNew() {
  const modal = document.getElementById('whats-new-modal');
  if (modal) modal.classList.add('hidden');
  markVersionSeen();
}

async function init() {
  window.__appStarted = true; // index.html's launch-failed message waits for this
  diag('app init v' + APP_VERSION + (quietBoot ? ' (quiet boot)' : '') + ' engine=' + player.engineName());
  window.addEventListener('unhandledrejection', (e) => diag('UNHANDLED ' + (e.reason && (e.reason.stack || e.reason))));
  const videoEl = document.getElementById('video');
  if (!player.initPlayer(videoEl)) {
    document.body.innerHTML =
      '<div style="text-align:center;padding:40px;color:#fff;">' +
      '<h2>App cannot start</h2>' +
      '<p>Your device does not support the video playback needed for this app. Please try restarting the app or updating your TV software.</p>' +
      '</div>';
    return;
  }

  remote.init(handleRemoteAction);
  document.addEventListener('keydown', ui.flashNowPlaying, true);
  // Hidden (Exit, Home): stop the stream. AVPlay keeps painting its video under a hidden app, so Exit looked like
  // it did nothing and took a second press; and the channel server serves one stream at a time. Back: the same
  // channel again, unless something was tuned meanwhile (Raflix asking for another one through appcontrol).
  let hiddenAtSeq = -1;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAtSeq = tuneSeq;
      clearTimeout(watchedTimer);
      player.stop();
      return;
    }
    const seq = hiddenAtSeq;
    hiddenAtSeq = -1;
    setTimeout(() => {
      if (seq >= 0 && tuneSeq === seq && ui.getCurrentChannel()) player.reloadChannel();
    }, 500);
  });
  if (diagEnabled) {
    // Exit on 2016 TVs needs two presses: what the app sees of each.
    document.addEventListener('visibilitychange', () => diag('visible=' + !document.hidden));
    document.addEventListener('keydown', (e) => diag('key ' + e.keyCode + ' ' + (e.key || '')), true);
  }

  registerTizenKeys();

  // Update checker (from feature/update-check): opt-in prompt + background
  // version check. Was defined but never invoked — wire it at boot.
  scheduleUpdateCheck();

  // Opened again while running, by an app asking for a channel (Raflix's "Directos" tab).
  window.addEventListener('appcontrol', async () => {
    const request = favorites.requestedChannel();
    const playing = ui.getCurrentChannel();
    if (!request || !channels || !channels.length) return;
    if (playing && playing.name === request.name) return;
    if (settings.isVisible()) {
      settings.hide();
      refreshProxyMenu();
      showPlayer();
    }
    ui.closeAllOverlays();
    ui.resetTuneStatus(request.name); // the name and "Connecting…" while the fresh list downloads
    const fresh = await freshChannels();
    if (fresh) applyFreshChannels(fresh);
    openRequestedChannel(request);
  });

  document.addEventListener('tizenhwkey', (e) => {
    if (e.keyName === 'back') {
      e.preventDefault();
      handleRemoteAction('back');
    }
  });

  const s = getSettings();
  const activePlaylist = getActivePlaylist();

  const autoRefresh = s.autoRefreshPlaylist !== false;

  if (quietBoot && s.channels && s.channels.length > 0) {
    // Opened by Raflix on a channel: the fresh list first (stream URLs rotate, event groups change), then the
    // tune; the cache only if the download fails. The start-up spinner covers the wait.
    channels = (await freshChannels()) || s.channels;
    startPlayer();
  } else if (autoRefresh && activePlaylist && activePlaylist.url) {
    // Auto-refresh: always fetch fresh playlist on boot.
    if (s.channels && s.channels.length > 0) {
      // Cached channels available — show instantly, refresh in background.
      channels = s.channels;
      startPlayer();
      showBootSplash('Updating playlist...');
      refreshChannelsInBackground().then((ok) => {
        hideBootSplashAndMaybeWhatsNew(0, () => {
          if (ok === false) showStaleCacheNotice();
        });
      });
    } else {
      // No cached channels — show splash while fetching (with retries).
      showBootSplash('Downloading playlist...', true);
      try {
        const newChannels = await fetchPlaylistWithRetry(activePlaylist);
        saveSettings({ channels: newChannels, channelsFetched: new Date().toISOString() });
        channels = newChannels;
        hideBootSplashAndMaybeWhatsNew();
        startPlayer();
      } catch (e) {
        console.warn('Failed to fetch playlist:', e.message);
        diag('playlist download failed: ' + e.message + ' (' + (activePlaylist.name || activePlaylist.url) + ')');
        hideBootSplashAndMaybeWhatsNew();
        showFirstRun();
      }
    }
  } else if (s.channels && s.channels.length > 0) {
    // Auto-refresh OFF: load from localStorage only, no network fetch —
    // hold the splash 1.5s past the tagline so it doesn't flash by.
    channels = s.channels;
    startPlayer();
    showBootSplash('Loading...');
    hideBootSplashAndMaybeWhatsNew(BOOT_IDLE_HOLD_MS);
  } else if (activePlaylist && activePlaylist.url) {
    // No cached channels but has playlist URL — fetch once to bootstrap.
    showBootSplash('Loading playlist...', true);
    try {
      const newChannels = await fetchPlaylistWithRetry(activePlaylist);
      saveSettings({ channels: newChannels, channelsFetched: new Date().toISOString() });
      channels = newChannels;
      hideBootSplashAndMaybeWhatsNew();
      startPlayer();
    } catch (e) {
      console.warn('Failed to fetch playlist:', e.message);
      diag('playlist download failed: ' + e.message + ' (' + (activePlaylist.name || activePlaylist.url) + ')');
      hideBootSplashAndMaybeWhatsNew();
      showFirstRun();
    }
  } else {
    showFirstRun();
  }
}

function cleanupEventListeners() {
  cleanupListeners.forEach(({ element, event, handler }) => {
    if (element && element.removeEventListener) {
      element.removeEventListener(event, handler);
    }
  });
  cleanupListeners = [];
  if (bufferingInterval) {
    clearInterval(bufferingInterval);
    bufferingInterval = null;
  }
}

function addCleanupListener(element, event, handler) {
  if (element && element.addEventListener) {
    element.addEventListener(event, handler);
    cleanupListeners.push({ element, event, handler });
  }
}

// Desktop test relay sidebar entry: hidden unless on a local test host with
// Settings → Playback → Proxy menu enabled. Called on boot and every time
// Settings closes (settings.hide() never fires the onClose callback).
function refreshProxyMenu() {
  const host = (typeof window !== 'undefined' && window.location.hostname) || '';
  const isLocalhost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
  const show = isLocalhost && getSettings().showProxyMenu === true;
  const btn = document.getElementById('proxy-toggle-btn');
  if (btn) btn.classList.toggle('hidden', !show);
  const label = document.getElementById('proxy-testing-label');
  if (label) label.classList.toggle('hidden', !show);
}

function startPlayer() {
  // BUG-018: must also initialize the shell with zero channels. Otherwise a
  // fresh install that backs out of Settings lands on a dead player page
  // (no UI wiring, Settings unreachable).
  channels = channels || [];

  cleanupEventListeners();
  sortChannels(channels);

  const tStart = Date.now();
  settings.init(document.getElementById('settings-page'), {
    onPlaylistFetched: (newChannels) => {
      sortChannels(newChannels);
      channels = newChannels;
      ui.refreshChannelList(channels);
      settings.hide();
      ui.stopInactivityTimer();
      refreshProxyMenu();
      showPlayer();
    },
    onClose: () => {
      settings.hide();
      ui.stopInactivityTimer();
      refreshProxyMenu();
      ui.refreshGroupVisibility();
      selectedGroup = ui.getSelectedGroup();
      showPlayer();
    },
  });

  const tUi = Date.now();
  ui.init(channels, handleChannelSelect);
  diag(
    'start: settings ' +
      (tUi - tStart) +
      'ms, channel list ' +
      (Date.now() - tUi) +
      'ms, ' +
      channels.length +
      ' channels',
  );

  const overlaySettings = getSettings();
  ui.setOverlayVisibility({
    watermark: overlaySettings.showWatermark !== false,
    badge: overlaySettings.showResolutionBadge !== false,
  });

  ui.setAutoCloseCallback(() => {
    if (settings.isVisible()) {
      settings.hide();
      refreshProxyMenu();
      ui.refreshGroupVisibility();
      selectedGroup = ui.getSelectedGroup();
      showPlayer();
      ui.stopInactivityTimer();
    }
  });
  ui.setResolutionCallback((height) => {
    player.selectResolution(height);
    updateResolutionBadge(height || player.getActiveHeight());
  });

  ui.setAudioCallback((id) => {
    player.selectAudioTrackById(id);
    ui.setSelectedAudio(id);
  });

  let playPauseButton = document.getElementById('playpause-button');
  if (playPauseButton) {
    addCleanupListener(playPauseButton, 'click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });
  }

  let refreshStreamBtn = document.getElementById('refresh-stream-btn');
  if (refreshStreamBtn) {
    addCleanupListener(refreshStreamBtn, 'click', () => {
      showProgress('Reloading');
      player.reloadChannel();
    });
  }
  let refreshChannelsBtn = document.getElementById('refresh-channels-btn');
  if (refreshChannelsBtn) {
    addCleanupListener(refreshChannelsBtn, 'click', async () => {
      showProgress('Refreshing');
      await refreshChannels();
      hideProgress();
    });
  }

  let settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    addCleanupListener(settingsBtn, 'click', () => {
      showSettingsPage();
    });
  }

  const onboardM3u = document.getElementById('onboard-m3u');
  if (onboardM3u) {
    addCleanupListener(onboardM3u, 'click', () => {
      onboardFocus = 0;
      selectOnboarding();
    });
  }
  const onboardXtream = document.getElementById('onboard-xtream');
  if (onboardXtream) {
    addCleanupListener(onboardXtream, 'click', () => {
      onboardFocus = 1;
      selectOnboarding();
    });
  }

  // Desktop test relay toggle: visible only on local test hosts (localhost,
  // loopback, .local, LAN IPs — never in the TV build, which runs from
  // file:// with an empty hostname) AND when enabled in Settings → Playback.
  // Off by default, so release users never see it.
  refreshProxyMenu();

  const favoriteBtn = document.getElementById('favorite-btn');
  if (favoriteBtn) {
    addCleanupListener(favoriteBtn, 'click', () => toggleFavoriteFor(ui.getCurrentChannel()));
  }

  let proxyToggleBtn = document.getElementById('proxy-toggle-btn');
  if (proxyToggleBtn) {
    addCleanupListener(proxyToggleBtn, 'click', () => {
      const ch = ui.getCurrentChannel();
      if (!ch) return;
      const s = getSettings();
      const map = { ...(s.proxyChannels || {}) };
      const on = !map[ch.url];
      if (on) map[ch.url] = true;
      else delete map[ch.url];
      saveSettings({ proxyChannels: map });
      ch.useProxy = on;
      ui.setProxyToggleLabel(on);
      player.reloadChannel();
    });
  }

  let videoEl = document.getElementById('video');
  addCleanupListener(videoEl, 'playing', () => {
    playbackStarted = true;
    videoEl.style.visibility = '';
    hideProgress();
    ui.hideBuffering();
    ui.hideEmptyLogo();
  });
  addCleanupListener(videoEl, 'click', () => player.togglePlay());

  addCleanupListener(videoEl, 'play', () => {
    let btn = document.getElementById('playpause-button');
    if (btn) btn.innerHTML = '&#10073;&#10073;';
  });
  addCleanupListener(videoEl, 'pause', () => {
    let btn = document.getElementById('playpause-button');
    if (btn) btn.innerHTML = '&#9654;';
  });

  addCleanupListener(document, 'fullscreenchange', () => {
    if (!document.fullscreenElement && ui.isFullscreenMode()) {
      ui.exitFullscreenMode();
    }
  });

  player.onBuffering((buffering, percent) => {
    bufferingActive = buffering;
    if (buffering) {
      const p = percent != null ? percent : player.getBufferingPercent();
      ui.showBuffering(p);
      updateProgressPercent(p);
    } else {
      ui.hideBuffering();
    }
  });
  // Silent-retry counter for the single-narrative status line.
  player.onTuneAttempt((n) => {
    ui.setTuneAttempt(n);
  });
  bufferingInterval = setInterval(() => {
    if (bufferingActive) {
      ui.updateBuffering(player.getBufferingPercent());
    }
  }, 500);

  player.onTrackChange(({ height, bandwidth }) => {
    updateResolutionBadge(height, bandwidth);
    ui.setSelectedAudio(player.getActiveAudioId());
  });

  player.onChannelAdvance(() => {
    const next = (currentIndex + 1) % channels.length;
    ui.selectChannel(next);
  });

  player.onTokenExpired((deadChannel) => {
    handleStaleToken(deadChannel);
  });
  player.onEngineChange((engine) => ui.setEngineTag(engine));

  if (channels.length === 0) {
    showEmptyState();
    return;
  }
  diag('start: ready to resume ' + (Date.now() - tStart) + 'ms after settings');
  restoreLastSession();
}

// Boot resume: replay the last channel + group view instead of channel 0.
// Falls back to channel 0 when nothing was saved, the channel is gone, or
// its group is now hidden. Identity is the channel URL (stable across
// playlist refresh and re-sort); a raw index would rot on every fetch.
function restoreLastSession() {
  if (openRequestedChannel(favorites.requestedChannel())) return;
  let idx = 0;
  let view = null;
  try {
    const s = getSettings();
    const at = findResumeIndex(channels, s && s.lastChannelUrl, getHiddenGroups());
    if (at >= 0) {
      const ch = channels[at];
      const g = (ch && ch.group) || 'Ungrouped';
      idx = at;
      const groups = ui.getGroups().map((x) => x.name);
      const savedView = s.lastGroup === 'all' ? 'All Channels' : s.lastGroup;
      if (savedView && groups.includes(savedView) && (savedView === 'All Channels' || savedView === g)) {
        view = savedView;
      } else if (groups.includes(g)) {
        view = g;
      } else {
        view = 'All Channels';
      }
    }
  } catch {}
  // The stream first, the channel list after: drawing the group view and the list takes ~3 s on 2016 TVs and blocks
  // the app — before the tune it delayed asking for the stream, during it the start of playback (AVPlay waits for
  // the app's play() once prepared). Drawn once the picture is up; the list marks the channel without a second tune.
  handleChannelSelect(channels[idx], () => {
    const t0 = Date.now();
    if (view) ui.showGroupChannels(view);
    ui.selectChannel(idx, true, true);
    selectedGroup = ui.getSelectedGroup();
    try {
      saveSettings({ lastGroup: selectedGroup });
    } catch {}
    diag('resume: group view and list drawn after the picture, ' + (Date.now() - t0) + 'ms');
  });
}

// A channel another app asked for (by name; URLs rotate), in its group's view.
function openRequestedChannel(request) {
  const at = findRequestedIndex(channels, request, getHiddenGroups());
  if (at < 0) return false;
  const g = channels[at].group || 'Ungrouped';
  ui.showGroupChannels(ui.getGroups().some((x) => x.name === g) ? g : 'All Channels');
  selectedGroup = ui.getSelectedGroup();
  ui.selectChannel(at, true);
  return true;
}

// Red key: the channel joins or leaves this TV's favorites.
function toggleFavoriteFor(channel) {
  if (!channel) return;
  const on = favorites.toggleFavorite(channel);
  ui.showTransientNotice((on ? '♥ Added to favorites: ' : 'Removed from favorites: ') + channel.name, 2500);
  ui.updateTvLists();
  if (ui.getSidebarMode() === 'channels') ui.renderChannelList();
  ui.setFavoriteLabel(on);
}

function showEmptyState() {
  hideLaunchSpinner();
  showPlayer();
  const active = getActivePlaylist();
  ui.showEmptyLogo(
    !active || !active.url
      ? 'No playlist yet — open Settings to add one and start watching'
      : 'This playlist has no channels — check the URL or try another',
  );
  const nameEl = document.getElementById('channel-name');
  if (nameEl) nameEl.textContent = 'No channels';
  const infoEl = document.getElementById('channel-info');
  if (infoEl) infoEl.textContent = 'Open Settings to add a playlist';
}

let pendingUpdate = null;

function runUpdateCheck() {
  sendUsagePing();
  checkForUpdate().then((info) => {
    if (info) {
      pendingUpdate = info;
      ui.setUpdateBadge(true);
    }
  });
}

// Gentle, non-blocking: ask once, otherwise check silently in background.
function scheduleUpdateCheck() {
  setTimeout(() => {
    if (!consentAsked()) {
      ui.showConfirmDialog(
        'Check for app updates on launch? Anonymous version check only — no personal data.',
        (ok) => {
          setConsented(ok === true);
          if (ok === true) runUpdateCheck();
        },
      );
    } else if (hasConsented()) {
      runUpdateCheck();
    }
  }, 1500);
}

function showFirstRun() {
  // First launch (or fetch failure with nothing cached): land on the player
  // shell with its empty state — never strand the user on Settings. The
  // menu opens showing the Settings button, and a hint names the Blue key.
  channels = channels || [];
  hideLaunchSpinner();
  startPlayer();
  ui.toggleRightSidebar();
  showBootSplash('Loading...');
  const s = getSettings();
  const fresh = (s.playlists || []).length === 0 && (s.channels || []).length === 0;
  if (fresh) {
    // True first install: offer the source choice directly, no hint toast.
    // Skip if the user already opened Settings meanwhile.
    hideBootSplash(BOOT_IDLE_HOLD_MS, () => {
      if (!settings.isVisible()) showOnboarding();
    });
    return;
  }
  hideBootSplashAndMaybeWhatsNew(BOOT_IDLE_HOLD_MS, () => {
    setTimeout(() => {
      if (!isWhatsNewOpen()) ui.showFirstRunHint();
    }, 1200);
  });
}

/* First-run source picker: M3U playlist or Xtream login, straight into the
   matching Settings add form. Shown only on true first installs. */
let onboardFocus = 0;

function isOnboardingOpen() {
  const el = document.getElementById('onboarding-modal');
  return el && !el.classList.contains('hidden');
}

function showOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  // Fresh installs have no changelog to catch up on — don't stack What's New.
  markVersionSeen();
  onboardFocus = 0;
  modal.classList.remove('hidden');
  updateOnboardFocus();
}

function hideOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.classList.add('hidden');
}

function updateOnboardFocus() {
  const m3uBtn = document.getElementById('onboard-m3u');
  const xtBtn = document.getElementById('onboard-xtream');
  if (m3uBtn) {
    if (onboardFocus === 0) m3uBtn.setAttribute('data-focused', '');
    else m3uBtn.removeAttribute('data-focused');
  }
  if (xtBtn) {
    if (onboardFocus === 1) xtBtn.setAttribute('data-focused', '');
    else xtBtn.removeAttribute('data-focused');
  }
}

function selectOnboarding() {
  const type = onboardFocus === 1 ? 'xtream' : 'm3u';
  hideOnboarding();
  showSettingsPage();
  settings.openAddForm(type);
}

function showPlayer() {
  document.body.style.overflow = '';
  const playerContainer = document.getElementById('player-container');
  const nowPlaying = document.getElementById('now-playing');
  if (playerContainer) playerContainer.classList.remove('hidden');
  if (nowPlaying) nowPlaying.classList.remove('hidden');
  const videoEl = document.getElementById('video');
  if (videoEl) videoEl.style.visibility = '';
  ui.showSidebarWithContent();
}

function showSettingsPage() {
  const playerContainer = document.getElementById('player-container');
  const nowPlaying = document.getElementById('now-playing');
  if (playerContainer) playerContainer.classList.add('hidden');
  if (nowPlaying) nowPlaying.classList.add('hidden');
  if (ui.isFullscreenMode()) {
    ui.exitFullscreenMode();
  }
  ui.closeAllOverlays();
  ui.stopCursorAutoHide();
  ui.stopInactivityTimer();
  document.body.style.overflow = 'hidden';
  settings.show();
}

// Readback forces style/layout (and with it, a composite) synchronously,
// so the tune veil is on screen before heavy teardown below.
function forcePaint() {
  try {
    void document.body.offsetHeight;
  } catch {}
}

// afterStart: called once the tune is answered — picture up, or given up (the boot draws the channel list then).
async function handleChannelSelect(channel, afterStart) {
  // Record the tune intent FIRST (before the paint-delay await below): the
  // background refresh may land while this tune is still yielding, and it
  // needs the latest intent to decide on a fresh-URL re-tune.
  const mySeq = ++tuneSeq;
  clearTimeout(watchedTimer);
  hideLaunchSpinner();
  diag('tune ' + channel.name);
  ui.flashNowPlaying();
  currentIndex = channels.indexOf(channel);
  // Latest tune intent (name+group survive token rotation; URLs don't).
  lastIntent = { name: channel.name, group: channel.group || 'Ungrouped' };
  // Hard visual reset FIRST: one clean narrative (name + Connecting…),
  // every stale pill/error/progress from the previous tune hidden at once.
  ui.resetTuneStatus(channel && channel.name);
  hideProgress();
  ui.setAudioTracks([]);
  // Force the veil + name through layout before the teardown/load below
  // runs — on Tizen the first paint can otherwise stall until load
  // resolves, leaving a bare logo with no indication of what's happening.
  forcePaint();
  // Drop the video plane at once: on Tizen it renders above the web layer,
  // so without this the old/black frame covers the loading veil.
  const tuneVideo = document.getElementById('video');
  if (tuneVideo) tuneVideo.style.visibility = 'hidden';
  // Let the veil paint before the teardown/load below blocks the main thread.
  // On TV the first paint can otherwise only happen after load resolves,
  // so users see black instead of the spinner + name.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    try {
      requestAnimationFrame(() => setTimeout(finish, 30));
    } catch {
      finish();
    }
    setTimeout(finish, 350); // safety: never stall tuning
  });
  // Fast-zap burst: a newer press arrived while the veil was painting — the
  // player belongs to it now, so bail before touching anything. The UI above
  // already shows the latest channel; only the load is skipped.
  if (tuneSuperseded(mySeq, tuneSeq)) {
    if (afterStart) afterStart();
    return;
  }
  // Stamp the active playlist so Channel Source cards can show "last played".
  try {
    const s = getSettings();
    const idx = s.activePlaylistIndex;
    if (s.playlists[idx]) {
      s.playlists[idx].lastPlayedAt = new Date().toISOString();
      saveSettings({ playlists: s.playlists });
    }
  } catch {}
  // Resume: remember what was playing (URL is stable across refresh/sort).
  try {
    selectedGroup = ui.getSelectedGroup();
    saveSettings({ lastChannelUrl: channel.url, lastGroup: selectedGroup });
  } catch {}
  ui.setProxyToggleLabel(!!(getSettings().proxyChannels || {})[channel.url]);
  ui.setFavoriteLabel(favorites.isFavorite(channel));
  tuneInFlight = true;
  const ok = await player.loadChannel(channel);
  if (afterStart) afterStart();
  tuneInFlight = false;
  tuneSucceeded = ok === true;
  if (ok && mySeq === tuneSeq) {
    watchedTimer = setTimeout(() => {
      favorites.noteWatched(channel);
      ui.updateTvLists();
    }, WATCHED_MS);
  }
  if (ok && player.LIGHT_BOOT) hideBootSplash(); // slow TVs: off as soon as the channel is up, not after the refresh
  if (mySeq === tuneSeq) ui.setEngineTag(ok ? player.engineInUse() : null);
  if (!ok) {
    hideProgress();
    ui.hideBuffering();
    ui.showEmptyLogo('');
  } else if (!bufferingActive) {
    // Fast channel: loaded with nothing left to buffer — drop the name toast.
    ui.hideBuffering();
  } else {
    // Still buffering after load: veil is gone, first frame not up yet.
    // Keep the center brand with the channel name under it until playback.
    ui.showEmptyLogo(channel.name);
  }
  ui.setSelectedResolution('auto');
  const p = player.getPlayer();
  if (p) {
    ui.setResolutions(player.getResolutions());
    ui.setAudioTracks(player.getAudioTracks());
    const height = player.getActiveHeight();
    if (height) updateResolutionBadge(height);
  }
}

const labelMap = [
  [480, 'SD'],
  [720, 'HD'],
  [1080, 'FHD'],
  [1440, '2K'],
  [2160, '4K'],
];

function getResolutionLabel(height) {
  if (!height) return 'Auto';
  for (const [max, label] of labelMap) {
    if (height <= max) return label;
  }
  return '8K';
}

function formatBandwidth(bps) {
  if (!bps || bps <= 0) return '';
  const mbps = (bps / 1000000).toFixed(1);
  return ' \u2022 ' + mbps + ' Mbps';
}

function channelTypeTag(channel) {
  if (!channel || !channel.url) return '';
  const ext = channel.url.split('?')[0].split('.').pop().trim().toUpperCase();
  if (!ext || ext.length > 5 || ext.includes('/')) return '';
  return ' \u2022 ' + ext;
}

function updateResolutionBadge(height, bandwidth) {
  const el = document.getElementById('resolution-badge');
  if (!el) return;
  if (getSettings().showResolutionBadge === false) {
    el.classList.add('hidden');
    return;
  }
  const label = getResolutionLabel(height);
  const bw = bandwidth || player.getActiveBandwidth();
  const type = channelTypeTag(channels[currentIndex]);
  el.textContent = label + formatBandwidth(bw) + type;
  el.classList.remove('hidden');
}

let progressActive = false;

function showProgress(text) {
  const el = document.getElementById('progress-toast');
  if (!el) return;
  progressActive = true;
  el.classList.remove('hidden');
  document.getElementById('progress-text').textContent = text;
}

function updateProgressPercent(percent) {
  if (!progressActive) return;
  const el = document.getElementById('progress-text');
  if (el && typeof percent === 'number') {
    el.textContent = 'Reloading ' + percent + '%';
  }
}

function hideProgress() {
  progressActive = false;
  const el = document.getElementById('progress-toast');
  if (el) el.classList.add('hidden');
}

let lastBackTime = 0;

async function refreshChannelsInBackground() {
  const active = getActivePlaylist();
  if (!active || !active.url) return true;
  try {
    const newChannels = await fetchPlaylistWithRetry(active);
    applyFreshChannels(newChannels);
    // The boot tune ran on pre-refresh (possibly stale-token) URLs. If it
    // never got anywhere, re-tune the same channel with its fresh URL
    // instead of stranding the user on the brand screen. Working playback
    // is never touched.
    if (!playbackStarted && !tuneSucceeded && !tuneInFlight && lastIntent) {
      const at = findIntentIndex(channels, lastIntent);
      if (at >= 0) ui.selectChannel(at, true);
    }
    return true;
  } catch (e) {
    console.warn('Background playlist refresh failed:', e.message);
    return false;
  }
}

// The active playlist, downloaded now and saved; null when it can't be (the caller keeps the cached list). For a
// channel Raflix asks for: its cached URL may have rotated since the last refresh.
async function freshChannels() {
  const active = getActivePlaylist();
  if (!active || !active.url) return null;
  try {
    const list = await fetchPlaylistWithRetry(active, 1);
    saveSettings({ channels: list, channelsFetched: new Date().toISOString() });
    diag('fresh playlist: ' + list.length + ' channels');
    return list;
  } catch (e) {
    diag('fresh playlist failed, using cache: ' + e.message);
    return null;
  }
}

// Swap in a freshly fetched channel list (persist + sort + repaint).
function applyFreshChannels(newChannels) {
  saveSettings({ channels: newChannels, channelsFetched: new Date().toISOString() });
  sortChannels(newChannels);
  channels = newChannels;
  ui.refreshChannelList(channels);
}

// Expired-token recovery: the player retried the frozen channel URL and the
// server still says 403/401, so mint a fresh link via the playlist instead.
// Re-tunes by name+group (URLs rotate); falls back to one last same-URL
// load (no budget reset) so the normal advance path ends it if the link is
// truly dead. Never yanks the user back if they already moved on.
async function handleStaleToken(deadChannel) {
  try {
    if (!deadChannel || !lastIntent) return;
    const deadGroup = deadChannel.group || 'Ungrouped';
    if (deadChannel.name !== lastIntent.name || deadGroup !== lastIntent.group) return;
    let fresh = null;
    try {
      const active = getActivePlaylist();
      if (active && active.url) fresh = await fetchPlaylistWithRetry(active);
    } catch (e) {
      console.warn('Stale-token playlist refetch failed:', e.message);
    }
    if (fresh) {
      applyFreshChannels(fresh);
      const at = findIntentIndex(channels, lastIntent);
      if (at >= 0 && channels[at].url !== deadChannel.url) {
        ui.selectChannel(at, true);
        return;
      }
    }
    player.loadChannel(deadChannel);
  } catch (e) {
    console.warn('Stale-token recovery failed:', e.message);
  }
}

// Background refresh failed after retries: the cached list is still on
// screen — say so (with its date) instead of failing silently.
function showStaleCacheNotice() {
  let when = '';
  try {
    const iso = getSettings().channelsFetched;
    if (iso) when = ' from ' + new Date(iso).toLocaleDateString();
  } catch {}
  ui.showTransientNotice('Playlist update failed — using saved list' + when);
  diag('playlist refresh failed, using cache');
}

function registerTizenKeys() {
  if (!window.tizen || !window.tizen.tvinputdevice) return;
  const keys = [
    'ColorF0Red',
    'ColorF1Green',
    'ColorF2Yellow',
    'ColorF3Blue',
    'MediaPlayPause',
    'MediaPlay',
    'MediaPause',
    'MediaStop',
    'MediaFastForward',
    'MediaRewind',
    'MediaTrackNext',
    'MediaTrackPrevious',
    'ChannelUp',
    'ChannelDown',
  ];
  for (const key of keys) {
    try {
      window.tizen.tvinputdevice.registerKey(key);
    } catch {
      console.warn('Failed to register Tizen key:', key);
    }
  }
}

// CH Up/Down (and Prev/Next keys): retune to the adjacent channel in the
// current group view, wrapping around.
function zapChannel(step) {
  const displayChannels = getDisplayChannels();
  if (displayChannels.length === 0) return;
  const currentDisplayIdx = displayChannels.indexOf(channels[currentIndex]);
  const idx = currentDisplayIdx >= 0 ? currentDisplayIdx : 0;
  const target = (idx + step + displayChannels.length) % displayChannels.length;
  currentIndex = channels.indexOf(displayChannels[target]);
  ui.selectChannel(currentIndex, true);
}

function handleRemoteAction(action, value) {
  if (action === 'back') {
    const now = Date.now();
    if (now - lastBackTime < 600) return;
    lastBackTime = now;
  }
  if (isOnboardingOpen()) {
    switch (action) {
      case 'left':
      case 'right':
      case 'up':
      case 'down':
        onboardFocus = onboardFocus === 0 ? 1 : 0;
        updateOnboardFocus();
        break;
      case 'select':
        selectOnboarding();
        break;
      case 'back':
        hideOnboarding();
        break;
      default:
        break;
    }
    return;
  }
  if (isWhatsNewOpen()) {
    switch (action) {
      case 'select':
      case 'back':
        closeWhatsNew();
        break;
    }
    return;
  }
  if (ui.isDialogOpen()) {
    switch (action) {
      case 'left':
      case 'right':
        ui.dialogNavigate(action === 'right' ? 1 : -1);
        break;
      case 'up':
      case 'down':
        ui.dialogNavigate(action === 'down' ? 1 : -1);
        break;
      case 'select':
        ui.dialogSelect();
        break;
      case 'back':
        ui.hideConfirmDialog();
        break;
      default:
        break;
    }
    return;
  }

  if (settings.isVisible()) {
    switch (action) {
      case 'up':
        settings.navigate(-1);
        break;
      case 'down':
        settings.navigate(1);
        break;
      case 'left':
        settings.navigateNav(-1);
        break;
      case 'right':
        settings.navigateNav(1);
        break;
      case 'select':
        settings.selectFocused();
        break;
      case 'back':
        settings.hide();
        refreshProxyMenu();
        ui.refreshGroupVisibility();
        selectedGroup = ui.getSelectedGroup();
        // BUG-018: with no playlist yet, initialize the empty shell so the
        // sidebars and Settings stay reachable.
        if (channels && channels.length > 0) {
          showPlayer();
        } else {
          startPlayer();
        }
        ui.stopInactivityTimer();
        break;
    }
    return;
  }

  if (ui.isRightSidebarOpen()) {
    switch (action) {
      case 'up':
        ui.rightSidebarNavigateUp();
        break;
      case 'down':
        ui.rightSidebarNavigateDown();
        break;
      case 'select':
        ui.rightSidebarSelect();
        break;
      case 'back':
        ui.toggleRightSidebar();
        return;
      case 'left':
        ui.toggleRightSidebar();
        ui.toggleSidebar();
        break;
      case 'right':
        break;
      case 'channelUp':
        ui.toggleRightSidebar();
        zapChannel(1);
        break;
      case 'channelDown':
        ui.toggleRightSidebar();
        zapChannel(-1);
        break;
      default:
        break;
    }
    return;
  }

  if (ui.isSidebarOpen()) {
    const mode = ui.getSidebarMode();
    if (mode === 'search') {
      switch (action) {
        case 'up':
          ui.searchNavigate(-1);
          break;
        case 'down':
          ui.searchNavigate(1);
          break;
        case 'select':
          ui.searchSelect();
          break;
        case 'back':
          ui.exitSearch();
          break;
        case 'number':
          break; // typed into the search box natively
        default:
          break;
      }
      return;
    }
    if (mode === 'groups') {
      switch (action) {
        case 'up':
          ui.navigateGroupUp();
          break;
        case 'down':
          ui.navigateGroupDown();
          break;
        case 'channelUp':
          ui.navigateGroupDown();
          break;
        case 'channelDown':
          ui.navigateGroupUp();
          break;
        case 'select':
          ui.selectFocusedGroup();
          break;
        case 'left':
          break;
        case 'right':
          ui.toggleSidebar();
          ui.toggleRightSidebar();
          break;
        case 'back':
          ui.toggleSidebar();
          break;
        case 'number':
          ui.jumpToNumber(value);
          break;
        default:
          break;
      }
    } else {
      switch (action) {
        case 'up':
          ui.navigateUp();
          break;
        case 'down':
          ui.navigateDown();
          break;
        case 'channelUp':
          ui.navigateDown();
          break;
        case 'channelDown':
          ui.navigateUp();
          break;
        case 'select':
          ui.selectFocused();
          break;
        case 'left':
          if (ui.getGroups().length > 0) {
            ui.showGroupList();
          } else {
            ui.toggleSidebar();
          }
          break;
        case 'right':
          ui.toggleSidebar();
          ui.toggleRightSidebar();
          break;
        case 'back':
          ui.toggleSidebar();
          break;
        case 'playpause':
          player.togglePlay();
          break;
        case 'number':
          ui.jumpToNumber(value);
          break;
        case 'reload':
          player.reloadChannel();
          break;
        case 'red':
          toggleFavoriteFor(ui.getFocusedChannel());
          break;
        default:
          break;
      }
    }
    selectedGroup = ui.getSelectedGroup();
    currentIndex = ui.getCurrentIndex();
    return;
  }

  switch (action) {
    case 'up':
    case 'prev':
      zapChannel(-1);
      break;
    case 'down':
    case 'next':
    case 'channelUp':
      zapChannel(1);
      break;
    case 'channelDown':
      zapChannel(-1);
      break;
    case 'left':
      ui.toggleSidebar();
      break;
    case 'right':
      ui.toggleRightSidebar();
      break;
    case 'select':
      ui.toggleSidebar();
      break;
    case 'back':
      ui.showConfirmDialog('Exit the app?', (confirmed) => {
        if (confirmed) {
          if (window.tizen && window.tizen.application) {
            try {
              window.tizen.application.getCurrentApplication().exit();
            } catch {}
          } else {
            window.close();
          }
        }
      });
      break;
    case 'playpause':
    case 'play':
    case 'pause':
      player.togglePlay();
      break;
    case 'stop':
      player.stop();
      ui.showEmptyLogo('Playback stopped — pick a channel to watch');
      ui.toggleSidebar();
      break;
    case 'red':
      toggleFavoriteFor(ui.getCurrentChannel());
      break;
    case 'green':
      if (!ui.isSidebarOpen()) {
        ui.toggleSidebar();
      } else if (ui.getSidebarMode() !== 'groups' && ui.getGroups().length > 0) {
        ui.showGroupList();
      }
      break;
    case 'yellow':
      // Reserved for future use
      break;
    case 'blue':
      showSettingsPage();
      break;
    case 'number':
      ui.jumpToNumber(value, true);
      break;
    case 'reload':
      player.reloadChannel();
      break;
    default:
      break;
  }
}

function sortChannels(ch) {
  if (!ch || !ch.length) return;
  // Provider order (default): keep playlist file order. A–Z is opt-in.
  if (getSettings().channelSort !== 'name') return;
  ch.sort((a, b) => {
    if (!a || !b) return 0;
    // Sort by group first, then alphabetically by name within group
    const aGroup = (a.group || 'Ungrouped').toLowerCase();
    const bGroup = (b.group || 'Ungrouped').toLowerCase();
    if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
    return (a.name || '').localeCompare(b.name || '');
  });
}

export async function refreshChannels() {
  const active = getActivePlaylist();
  if (active && active.url) {
    try {
      const newChannels = await fetchPlaylistEntry(active);
      saveSettings({ channels: newChannels, channelsFetched: new Date().toISOString() });
      sortChannels(newChannels);
      channels = newChannels;
      ui.refreshChannelList(channels);
    } catch (e) {
      console.warn('Failed to refresh from playlist:', e.message);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
