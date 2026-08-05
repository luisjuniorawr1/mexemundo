import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const rooms = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendFile(res, filePath) {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      version: '0.10.7',
      games: ['balloons', 'goalkeeper'],
      handSystem: 'universal-two-hand-v1.2.1',
      handInput: 'stable-visual-and-fast-collision',
      gamePostProcessing: 'none',
      menu: 'two-hand-startup-check-and-fist-click',
      startupGate: 'two-hands-shoulders-stability-no-gesture',
      training: 'once-per-session-not-per-game',
      profile: 'universal-runtime-configuration',
      tracking: 'pose-landmarker-lite-single-pass-reference-0.6.0',
      gesture: 'pose-fist-hysteresis-menu-only',
      shoulders: 'same-pose-inference',
      interaction: 'dual-hand-stable-turbo',
      session: 'seamless-role-handoff',
      transport: 'webrtc-dual-channel-adaptive'
    }));
    return;
  }

  const routeFiles = {
    '/': 'index.html',
    '/tv': 'tv.html',
    '/goleiro': 'goalkeeper.html',
    '/celular': 'phone.html',
    '/laboratorio-maos': 'hand-lab.html'
  };

  const routeFile = routeFiles[requestUrl.pathname];
  if (routeFile) {
    sendFile(res, path.join(publicDir, routeFile));
    return;
  }

  const safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }
  sendFile(res, filePath);
});

function cleanRoom(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function roomStatus(room) {
  const members = rooms.get(room) ?? new Set();
  let tv = false;
  let phone = false;

  for (const client of members) {
    if (client.role === 'tv') tv = true;
    if (client.role === 'phone') phone = true;
  }

  return { tv, phone };
}

function sendJson(client, message) {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(message));
}

function broadcast(room, message, except = null) {
  const members = rooms.get(room);
  if (!members) return;

  const serialized = JSON.stringify(message);
  for (const client of members) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

function broadcastRoomStatus(room) {
  if (!room) return;
  broadcast(room, { type: 'room-status', payload: roomStatus(room) });
}

function sendRoomStatus(client, room) {
  if (!room || client.room !== room) return;
  sendJson(client, { type: 'room-status', payload: roomStatus(room) });
}

function removeFromRoom(client) {
  if (!client.room) return;

  const oldRoom = client.room;
  const members = rooms.get(oldRoom);
  if (members) {
    members.delete(client);
    if (members.size === 0) rooms.delete(oldRoom);
  }

  client.room = '';
  client.role = '';
  broadcastRoomStatus(oldRoom);
}

function addToRoom(client, room, role) {
  removeFromRoom(client);

  const members = rooms.get(room) ?? new Set();
  const replaced = [];

  for (const member of [...members]) {
    if (member !== client && member.role === role) {
      members.delete(member);
      member.room = '';
      member.role = '';
      replaced.push(member);
    }
  }

  client.room = room;
  client.role = role;
  members.add(client);
  rooms.set(room, members);
  broadcastRoomStatus(room);

  for (const member of replaced) {
    sendJson(member, {
      type: 'session-replaced',
      payload: { room, role }
    });

    setTimeout(() => {
      if (member.readyState === WebSocket.OPEN) {
        member.close(4001, 'Sessão substituída por uma nova tela.');
      }
    }, 30);
  }
}

function handleMessage(client, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    return;
  }

  const { type, payload = {}, id } = message;

  if (type === 'join') {
    const room = cleanRoom(payload.room);
    const role = payload.role;

    if (room.length < 4 || !['tv', 'phone'].includes(role)) {
      sendJson(client, {
        type: 'response',
        replyTo: id,
        payload: { ok: false, error: 'Sala ou dispositivo inválido.' }
      });
      return;
    }

    addToRoom(client, room, role);
    sendJson(client, {
      type: 'response',
      replyTo: id,
      payload: { ok: true, room, status: roomStatus(room) }
    });

    setTimeout(() => sendRoomStatus(client, room), 120);
    return;
  }

  if (type === 'rtc-signal') {
    if (!client.room) return;
    broadcast(client.room, { type: 'rtc-signal', payload }, client);
    return;
  }

  if (type === 'pose') {
    if (!client.room || client.role !== 'phone') return;
    broadcast(client.room, { type: 'pose', payload }, client);
    return;
  }

  if (type === 'game-command') {
    if (!client.room) return;
    broadcast(client.room, { type: 'game-command', payload }, client);
    return;
  }

  if (type === 'ping-latency') {
    sendJson(client, {
      type: 'response',
      replyTo: id,
      payload: { sentAt: payload.sentAt, serverAt: Date.now() }
    });
  }
}

const webSocketServer = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false,
  maxPayload: 64 * 1024
});

webSocketServer.on('connection', (client, request) => {
  request.socket.setNoDelay(true);
  client.room = '';
  client.role = '';

  client.on('message', (message) => handleMessage(client, message));
  client.on('close', () => removeFromRoom(client));
  client.on('error', () => removeFromRoom(client));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`MexeMundo em http://localhost:${port}`);
});
