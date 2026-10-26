// Raflix's server (the favorites API: favorites and recent channels, read by Raflix's "Directos" tab) and this TV's
// name there, as set in Settings > Channel Source. Until they're changed, the build's: player/favorites.local.json
// and RAFLIX_TV.
import { getSettings, saveSettings } from './config.js';
import { escapeHtml } from './utils.js';
import { serverFieldsError } from './logic.js';

export const SERVER_INPUTS = ['raflix-server', 'raflix-tv'];

export function serverUrl() {
  return String(getSettings().raflixServer || __FAVORITES_URL__ || '').replace(/\/+$/, '');
}

export function tvName() {
  return String(getSettings().raflixTv || __RAFLIX_TV__ || '');
}

function field(id, label, value, placeholder) {
  return (
    '<div class="input-group"><label for="' +
    id +
    '">' +
    label +
    '</label><input id="' +
    id +
    '" class="input-field" type="text" placeholder="' +
    placeholder +
    '" value="' +
    escapeHtml(value) +
    '" /></div>'
  );
}

export function renderServerCard() {
  let html = '<div class="setting-card">';
  html += '<div class="card-header"><h3><span class="card-icon">★</span> Raflix</h3></div>';
  html += '<div class="card-body">';
  html += field('raflix-server', 'Favorites server', serverUrl(), 'http://host:5002');
  html += field('raflix-tv', 'TV name', tvName(), 'dormitorio');
  html +=
    '<div id="raflix-status" class="toggle-desc">This TV\'s favorites and recent channels, for Raflix\'s Directos tab</div>';
  html += '</div></div>';
  return html;
}

// OK in either field saves both; false (and why, on screen) when one isn't valid. Emptied: back to the build's value.
export function saveServerFields() {
  const url = document.getElementById('raflix-server').value.trim().replace(/\/+$/, '');
  const tv = document.getElementById('raflix-tv').value.trim();
  const status = document.getElementById('raflix-status');
  const error = serverFieldsError(url, tv);
  if (error) {
    status.textContent = error;
    return false;
  }
  saveSettings({ raflixServer: url, raflixTv: tv });
  status.textContent = 'Saved';
  return true;
}
