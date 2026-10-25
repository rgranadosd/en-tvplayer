// Now and next from an XMLTV guide (the playlist's url-tvg), for the favorites API. No dependencies.
// The guide is downloaded at start and every 30 minutes; a failed download keeps the last good one.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e] !== undefined ? ENTITIES[e] : all;
    })
    .trim();
}

// "20261025091000 +0000" → epoch ms (no offset: UTC).
export function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(s || '');
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) : 0;
  return utc - offset * 60000;
}

// {channel id: [{title, start, stop}] sorted by start}
export function parseXmltv(xml) {
  const guide = new Map();
  const re = /<programme\s([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => (attrs[k] = v));
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
    const start = parseXmltvTime(attrs.start);
    const stop = parseXmltvTime(attrs.stop);
    if (!attrs.channel || !title || isNaN(start) || isNaN(stop)) continue;
    if (!guide.has(attrs.channel)) guide.set(attrs.channel, []);
    guide.get(attrs.channel).push({ title: decode(title[1]), start, stop });
  }
  for (const list of guide.values()) list.sort((a, b) => a.start - b.start);
  return guide;
}

// What's on now and next on the first of `ids` the guide knows; {} when none.
export function nowNext(guide, ids, at = Date.now()) {
  for (const id of ids || []) {
    const list = guide.get(id);
    if (!list) continue;
    const now = list.find((p) => p.start <= at && at < p.stop) || null;
    const next = list.find((p) => p.start >= (now ? now.stop : at)) || null;
    if (now || next) return { now, next };
  }
  return {};
}

export function createGuide(url, { every = 30 * 60000, log = console.log } = {}) {
  let guide = new Map();
  async function refresh() {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      guide = parseXmltv(await res.text());
      log(`EPG: ${guide.size} channels`);
    } catch (e) {
      log('EPG: download failed (' + e.message + '), keeping the last guide');
    }
  }
  if (url) {
    refresh();
    setInterval(refresh, every).unref();
  }
  return { nowNext: (ids, at) => nowNext(guide, ids, at) };
}
