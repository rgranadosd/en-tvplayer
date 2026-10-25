// What both players show and log: the loading veil, the error line and the console event log.

// App event log (console only; the dev log endpoint was removed with the proxy).
// Stream tokens (?token=…) are scrubbed: users paste inspector logs publicly.
export function logEvent(level, message) {
  try {
    if (typeof console !== 'undefined' && console.debug) {
      const safe = typeof message === 'string' ? message.replace(/(https?:\/\/[^\s'"]+?)[?#][^\s'"]*/g, '$1') : message;
      console.debug('[app][' + level + ']', safe);
    }
  } catch {}
}

// Loading veil (spinner + channel name, centered): showLoading(false) drops
// only the spinner — the name stays put through the buffering phase until
// the first frame (hideLoading) or an error clears the stage.
export function showLoading(show) {
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('hidden', !show);
  const spinner = el ? el.querySelector('.spinner') : null;
  if (spinner) spinner.classList.toggle('hidden', !show);
}

export function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
}

export function showError(message) {
  hideLoading();
  const el = document.getElementById('error');
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

export function hideError() {
  const el = document.getElementById('error');
  if (el) {
    el.classList.add('hidden');
  }
}
