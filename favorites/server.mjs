// Favorites API for EN-IPTV: the TV app marks channels with the Red key, and other apps (Raflix's "Directos" tab)
// read them. Plain HTTP, no dependencies; the list lives in a small YAML file next to this script.
//
//   node favorites/server.mjs [port] [file]          (defaults: 5002, favorites/favorites.yml)
//
//   GET    /favorites                       → {"favorites": [{name, group, logo}, …]}
//   POST   /favorites  {name, group, logo}  → adds one (or updates it, by name)
//   DELETE /favorites?name=…                → removes one
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = ['name', 'group', 'logo'];

// A small fixed shape; values are JSON strings, which YAML reads as double-quoted scalars.
export function toYaml(list) {
  const lines = ['# EN-IPTV favorites (the Red key on the TV edits them; safe to edit by hand)'];
  if (!list.length) lines.push('favorites: []');
  else lines.push('favorites:');
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
    if (body && typeof body[k] === 'string' && body[k].trim()) fav[k] = body[k].trim().slice(0, 500);
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

function save(file, list) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, toYaml(list));
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

export function createServer(file) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname !== '/favorites') return send(res, 404, { error: 'not found' });
    if (req.method === 'GET') return send(res, 200, { favorites: load(file) });
    if (req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!name) return send(res, 400, { error: 'name is required' });
      const list = load(file).filter((f) => f.name !== name);
      save(file, list);
      return send(res, 200, { favorites: list });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
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
      if (!fav) return send(res, 400, { error: 'a JSON body with a name is required' });
      const list = load(file);
      const at = list.findIndex((f) => f.name === fav.name);
      if (at >= 0) list[at] = fav;
      else list.push(fav);
      save(file, list);
      send(res, 200, { favorites: list });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = parseInt(process.argv[2], 10) || 5002;
  const file = path.resolve(process.argv[3] || path.join(HERE, 'favorites.yml'));
  createServer(file).listen(port, () => console.log(`EN-IPTV favorites on http://0.0.0.0:${port}/favorites (${file})`));
}
