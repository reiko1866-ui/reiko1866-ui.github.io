'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { createStore } = require('./rooms.js');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.KETTEN_DATA_FILE || path.join(__dirname, 'data', 'pairs.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function tryStatic(url, res) {
  let reqPath = decodeURIComponent(url.pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!abs.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return false;
  const body = fs.readFileSync(abs);
  res.writeHead(200, {
    'Content-Type': contentType(abs),
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
  return true;
}

const store = createStore();
/** @type {Map<string, { ws: import('ws').WebSocket, pairCode: string | null, deviceId: string | null }>} */
const sockets = new Map();
let socketSeq = 1;

function loadPersisted() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    store.restore(JSON.parse(raw));
    console.log(`[ketten-relay] restored ${store.serialize().length} pair(s)`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[ketten-relay] restore failed', err);
  }
}

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(store.serialize(), null, 2));
    } catch (err) {
      console.warn('[ketten-relay] persist failed', err);
    }
  }, 250);
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastPair(code) {
  for (const session of sockets.values()) {
    if (session.pairCode !== code || !session.deviceId) continue;
    try {
      const state = store.getState({ code, deviceId: session.deviceId });
      send(session.ws, { type: 'state', ...state });
    } catch {
      // The member may have left.
    }
  }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function errorStatus(err) {
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'FULL' || err.code === 'FORBIDDEN') return 403;
  if (err.code === 'BAD_REQUEST') return 400;
  return 500;
}

loadPersisted();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, service: 'ketten-relay' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/pairs') {
      const body = await readBody(req);
      const result = store.createPair(body);
      persistSoon();
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/pairs/join') {
      const body = await readBody(req);
      const result = store.joinPair(body);
      persistSoon();
      broadcastPair(result.pairCode);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/pairs/leave') {
      const body = await readBody(req);
      const result = store.leavePair(body);
      persistSoon();
      if (body.code) broadcastPair(body.code);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/location') {
      const body = await readBody(req);
      const code = body.pairCode || body.code;
      const result = store.setLocation({
        code,
        deviceId: body.deviceId,
        location: body.location || body,
      });
      persistSoon();
      broadcastPair(code);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/sharing') {
      const body = await readBody(req);
      const code = body.pairCode || body.code;
      const result = store.setSharing({
        code,
        deviceId: body.deviceId,
        sharing: body.sharing,
      });
      persistSoon();
      broadcastPair(code);
      json(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/pairs/')) {
      const code = url.pathname.split('/')[3];
      const result = store.getState({
        code,
        deviceId: url.searchParams.get('deviceId') || undefined,
      });
      json(res, 200, result);
      return;
    }

    if (req.method === 'GET' && tryStatic(url, res)) return;

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, errorStatus(err), { error: err.message || 'Hiba' });
  }
});

const wss = new WebSocketServer({ server, path: '/v1/ws' });

wss.on('connection', (ws) => {
  const socketId = `s${socketSeq++}`;
  const session = { ws, pairCode: null, deviceId: null };
  sockets.set(socketId, session);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: 'error', message: 'Érvénytelen JSON.' });
      return;
    }

    try {
      if (msg.type === 'hello') {
        const joined = store.joinPair({
          code: msg.pairCode || msg.code,
          deviceId: msg.deviceId,
          name: msg.name,
        });
        store.setSocket({
          code: joined.pairCode,
          deviceId: msg.deviceId,
          socketId,
        });
        session.pairCode = joined.pairCode;
        session.deviceId = msg.deviceId;
        persistSoon();
        broadcastPair(joined.pairCode);
        return;
      }

      if (msg.type === 'location') {
        if (!session.pairCode || !session.deviceId) {
          throw Object.assign(new Error('Előbb csatlakozz.'), { code: 'FORBIDDEN' });
        }
        store.setLocation({
          code: session.pairCode,
          deviceId: session.deviceId,
          location: msg,
        });
        persistSoon();
        broadcastPair(session.pairCode);
        return;
      }

      if (msg.type === 'sharing') {
        if (!session.pairCode || !session.deviceId) {
          throw Object.assign(new Error('Előbb csatlakozz.'), { code: 'FORBIDDEN' });
        }
        store.setSharing({
          code: session.pairCode,
          deviceId: session.deviceId,
          sharing: msg.sharing,
        });
        persistSoon();
        broadcastPair(session.pairCode);
        return;
      }

      if (msg.type === 'ping') {
        send(ws, { type: 'pong', t: Date.now() });
      }
    } catch (err) {
      send(ws, { type: 'error', message: err.message || 'Hiba' });
    }
  });

  ws.on('close', () => {
    sockets.delete(socketId);
    if (session.pairCode && session.deviceId) {
      try {
        store.setSocket({
          code: session.pairCode,
          deviceId: session.deviceId,
          socketId: null,
        });
        broadcastPair(session.pairCode);
      } catch {
        // pair may already be gone
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[ketten-relay] http://${HOST}:${PORT}  ws://${HOST}:${PORT}/v1/ws`);
});
