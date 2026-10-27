// The programme guide (XMLTV) for what this TV shares with Raflix: pure, like logic.js — inputs in, values out.

// The guide's address in a playlist's first line (#EXTM3U url-tvg="…", or x-tvg-url): the first of a list; '' if none.
export function guideAddress(m3uText) {
  const first = String(m3uText || '')
    .slice(0, 4000)
    .split('\n')[0];
  const m = /(?:url-tvg|x-tvg-url)="([^"]+)"/.exec(first);
  return m ? m[1].split(',')[0].trim() : '';
}

// "20261025091000 +0200" → epoch ms (no offset: UTC); NaN when it isn't one.
export function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(s || '');
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) : 0;
  return utc - offset * 60000;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
      if (e[0] === '#')
        return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return XML_ENTITIES[e] !== undefined ? XML_ENTITIES[e] : all;
    })
    .trim();
}

// An XMLTV guide's programmes that overlap from..until (epoch ms), by channel id: {id: [{s, e, t}]}, by start.
export function guideWindow(xml, from, until) {
  const out = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const attr = (a, k) => {
    const m = new RegExp('\\b' + k + '="([^"]*)"').exec(a);
    return m ? m[1] : '';
  };
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const id = attr(m[1], 'channel');
    const s = parseXmltvTime(attr(m[1], 'start'));
    const e = parseXmltvTime(attr(m[1], 'stop'));
    if (!id || isNaN(s) || isNaN(e) || e <= from || s >= until) continue;
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    (out[id] = out[id] || []).push({ s, e, t: title ? decodeXml(title[1]) : '' });
  }
  Object.keys(out).forEach((id) => out[id].sort((a, b) => a.s - b.s));
  return out;
}

// The guide of the channels with these names: the programmes of the first of their guide ids (tvg-id; a channel can
// come several times in a playlist and only some copies have one) that the window has. {name: [{s, e, t}]}
export function guideFor(names, channels, window) {
  const out = {};
  for (const name of names || []) {
    if (out[name]) continue;
    const id = (channels || [])
      .filter((c) => c && c.name === name && c.tvgId)
      .map((c) => c.tvgId)
      .find((i) => window && window[i] && window[i].length);
    if (id) out[name] = window[id];
  }
  return out;
}
