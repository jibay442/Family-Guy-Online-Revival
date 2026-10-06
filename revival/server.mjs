// Game server: serves the web client and the extracted assets over HTTP, and
// relays player state between clients over a WebSocket (/ws) for co-op play.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// URL prefix -> directory on disk. Only these folders are ever exposed.
const MOUNTS = {
  '/vendor/three/': path.join(HERE, 'node_modules/three'),
  '/assets/Mesh/': path.join(REPO, 'Mesh'),
  '/assets/Texture2D/': path.join(REPO, 'Texture2D'),
  '/assets/AudioClip/': path.join(REPO, 'AudioClip'),
  '/assets/TextAsset/': path.join(REPO, 'TextAsset'),
  '/': path.join(HERE, 'public'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.obj': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function resolveFile(urlPath) {
  for (const [prefix, dir] of Object.entries(MOUNTS)) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length) || 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolveFile(urlPath);
  fs.stat(file ?? '', (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      // Assets never change between runs; the client and manifest may.
      'cache-control': urlPath.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// --- Co-op relay -----------------------------------------------------------

const MAX_PLAYERS = 16;
const players = new Map(); // id -> { ws, name, character, map, state }
let nextId = 1;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(map, msg, exceptId) {
  for (const [id, p] of players) if (p.map === map && id !== exceptId) send(p.ws, msg);
}

function publicInfo(id, p) {
  return { id, name: p.name, character: p.character, state: p.state };
}

function attachCoop(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    let id = null;
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (id === null) {
        if (msg.t !== 'hello') return;
        if (players.size >= MAX_PLAYERS) {
          send(ws, { t: 'error', message: 'Server is full' });
          ws.close();
          return;
        }
        id = nextId++;
        const p = {
          ws,
          name: clean(msg.name, 20) || `Player${id}`,
          character: clean(msg.character, 64),
          map: clean(msg.map, 32),
          state: null,
        };
        players.set(id, p);
        const others = [...players].filter(([oid, o]) => oid !== id && o.map === p.map);
        send(ws, { t: 'welcome', id, players: others.map(([oid, o]) => publicInfo(oid, o)) });
        broadcast(p.map, { t: 'join', ...publicInfo(id, p) }, id);
        console.log(`[coop] + ${p.name} (#${id}) on ${p.map} — ${players.size} player(s)`);
        return;
      }
      const p = players.get(id);
      if (msg.t === 'state' && Array.isArray(msg.s) && msg.s.length === 5 && msg.s.every(Number.isFinite)) {
        p.state = msg.s; // [x, y, z, yaw, speed]
        broadcast(p.map, { t: 'state', id, s: msg.s }, id);
      } else if (msg.t === 'chat') {
        const text = clean(msg.text, 200);
        if (text) broadcast(p.map, { t: 'chat', id, name: p.name, text });
      } else if (msg.t === 'emote') {
        broadcast(p.map, { t: 'emote', id, sound: clean(msg.sound, 96) }, id);
      }
    });
    ws.on('close', () => {
      if (id === null) return;
      const p = players.get(id);
      players.delete(id);
      broadcast(p.map, { t: 'leave', id });
      console.log(`[coop] - ${p.name} (#${id}) — ${players.size} player(s)`);
    });
  });
}

export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export function startServer({ port = 8642, host = '0.0.0.0' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStatic);
    server.once('error', reject);
    // Attach the WebSocket only once listening: it re-emits listen errors otherwise.
    server.listen(port, host, () => {
      attachCoop(server);
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8642;
  await startServer({ port });
  console.log(`Server ready at http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  local network: http://${ip}:${port}`);
}
