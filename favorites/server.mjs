// Favorites API for EN-IPTV: the TV app marks channels with the Red key, and other apps (Raflix's "Directos" tab)
// read them. Plain HTTP, no dependencies; the list lives in a small YAML file next to this script.
//
//   node favorites/server.mjs [port] [file]          (defaults: 5002, favorites/favorites.yml)
//   EPG_URL=<the playlist's url-tvg>                 (optional: adds what's on now and next)
//
//   GET    /favorites                              → {"favorites": [{name, group, logo, tvg, now, next}, …],
//                                                     "recent": [the same, the last watched first]}
//   POST   /favorites  {name, group, logo, tvg}    → adds one (or updates it, by name)
//   DELETE /favorites?name=…                       → removes one
//   POST   /recent     {name, group, logo, tvg}    → the TV app watched it: first in "recent" (up to 20)
//
// tvg: the channel's guide ids (tvg-id), comma separated: the same channel can come several times in a playlist,
// and only some of its copies have a guide. now/next: {title, start, stop} (epoch ms), from the guide.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGuide } from './epg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = ['name', 'group', 'logo', 'tvg'];
const RECENT = 20;

// A small fixed shape; values are JSON strings, which YAML reads as double-quoted scalars.
export function toYaml(list, key = 'favorites') {
  const lines = ['# EN-IPTV ' + key + ' (the TV app keeps them; safe to edit by hand)'];
  if (!list.length) lines.push(key + ': []');
  else lines.push(key + ':');
  for (const fav of list) {
    FIELDS.filter((k) => fav[k] != null).forEach((k, i) => {
      lines.push((i === 0 ? '  - ' : '    ') + k + ': ' + JSON.stringify(String(fav[k])));
    });
  }
  return lines.join('\n') + '\n';
}

export function fromYaml(text) {
  const list = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*(-\s+)?(\w+):\s*(.*?)\s*$/);
    if (!m || !FIELDS.includes(m[2])) continue;
    if (m[1] || !list.length) list.push({});
    list[list.length - 1][m[2]] = parseScalar(m[3]);
  }
  return list.filter((f) => f.name);
}

function parseScalar(v) {
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

export function clean(body) {
  const fav = {};
  for (const k of FIELDS) {
    const v = body && Array.isArray(body[k]) ? body[k].join(',') : body && body[k];
    if (typeof v === 'string' && v.trim()) fav[k] = v.trim().slice(0, 500);
  }
  return fav.name ? fav : null;
}

function load(file) {
  try {
    return fromYaml(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function save(file, list, key) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, toYaml(list, key));
  fs.renameSync(tmp, file);
}

function send(res, status, json) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(json === undefined ? '' : JSON.stringify(json));
}

function withGuide(list, guide) {
  if (!guide) return list;
  return list.map((f) => ({ ...f, ...guide.nowNext(f.tvg ? f.tvg.split(',') : []) }));
}

// The channel just watched first, without its earlier place, and the oldest out past RECENT.
export function remember(recent, fav) {
  return [fav, ...recent.filter((f) => f.name !== fav.name)].slice(0, RECENT);
}

function readBody(req, done) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10000) req.destroy();
  });
  req.on('end', () => {
    let fav = null;
    try {
      fav = clean(JSON.parse(body));
    } catch {}
    done(fav);
  });
}

export function createServer(file, guide = null) {
  const recentFile = path.join(path.dirname(file), 'recent.yml');
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/recent' && req.method === 'POST') {
      return readBody(req, (fav) => {
        if (!fav) return send(res, 400, { error: 'a JSON body with a name is required' });
        const recent = remember(load(recentFile), fav);
        save(recentFile, recent, 'recent');
        send(res, 200, { recent: withGuide(recent, guide) });
      });
    }
    if (url.pathname !== '/favorites') return send(res, 404, { error: 'not found' });
    if (req.method === 'GET') {
      return send(res, 200, { favorites: withGuide(load(file), guide), recent: withGuide(load(recentFile), guide) });
    }
    if (req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!name) return send(res, 400, { error: 'name is required' });
      const list = load(file).filter((f) => f.name !== name);
      save(file, list);
      return send(res, 200, { favorites: withGuide(list, guide) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    readBody(req, (fav) => {
      if (!fav) return send(res, 400, { error: 'a JSON body with a name is required' });
      const list = load(file);
      const at = list.findIndex((f) => f.name === fav.name);
      if (at >= 0) list[at] = fav;
      else list.push(fav);
      save(file, list);
      send(res, 200, { favorites: withGuide(list, guide) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = parseInt(process.argv[2], 10) || 5002;
  const file = path.resolve(process.argv[3] || path.join(HERE, 'favorites.yml'));
  const guide = process.env.EPG_URL ? createGuide(process.env.EPG_URL) : null;
  createServer(file, guide).listen(port, () =>
    console.log(`EN-IPTV favorites on http://0.0.0.0:${port}/favorites (${file})${guide ? ', with EPG' : ''}`),
  );
}
