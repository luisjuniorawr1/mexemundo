import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const rooms = new Map();
// Mailboxes de pose são efêmeras: depois de 220 ms, enviar a posição
// atrasada é pior que esperar a próxima amostra latest-only.
const PENDING_POSE_MAX_AGE_MS = 220;

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
      version: '0.8.1',
      games: ['balloons', 'goalkeeper'],
      interaction: 'calibrated-hand-cursor',
      session: 'seamless-role-handoff',
      transport: 'webrtc-dual-channel-adaptive'
    }));
    return;
  }

  const routeFiles = {
    '/': 'index.html',
    '/tv': 'tv.html',
    '/goleiro': 'goalkeeper.html',
    '/celular': 'phone.html'
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

function clearPendingPose(client) {
  clearTimeout(client.poseFlushTimer);
  client.poseFlushTimer = null;
  client.pendingPoseMessage = null;
  client.pendingPoseMessageAt = 0;
}

function schedulePendingPose(client) {
  if (!client.pendingPoseMessage || client.poseFlushTimer || client.poseSendInFlight) return;
  client.poseFlushTimer = setTimeout(() => {
    client.poseFlushTimer = null;
    flushPendingPose(client);
  }, 8);
  client.poseFlushTimer.unref?.();
}

function sendPoseNow(client, serialized) {
  if (client.readyState !== WebSocket.OPEN) {
    clearPendingPose(client);
    return;
  }

  client.poseSendInFlight = true;
  try {
    client.send(serialized, (error) => {
      client.poseSendInFlight = false;
      if (error || client.readyState !== WebSocket.OPEN) {
        clearPendingPose(client);
        return;
      }
      flushPendingPose(client);
    });
  } catch {
    client.poseSendInFlight = false;
    clearPendingPose(client);
  }
}

function flushPendingPose(client) {
  if (!client.pendingPoseMessage) return;
  if (client.readyState !== WebSocket.OPEN) {
    clearPendingPose(client);
    return;
  }
  if (performance.now() - client.pendingPoseMessageAt > PENDING_POSE_MAX_AGE_MS) {
    client.poseExpired += 1;
    clearPendingPose(client);
    return;
  }
  if (client.poseSendInFlight || client.bufferedAmount > 0) {
    schedulePendingPose(client);
    return;
  }

  const serialized = client.pendingPoseMessage;
  client.pendingPoseMessage = null;
  client.pendingPoseMessageAt = 0;
  sendPoseNow(client, serialized);
}

function queueLatestPose(client, serialized) {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.poseSendInFlight || client.pendingPoseMessage || client.bufferedAmount > 0) {
    if (client.pendingPoseMessage) client.poseCoalesced += 1;
    client.pendingPoseMessage = serialized;
    client.pendingPoseMessageAt = performance.now();
    schedulePendingPose(client);
    return;
  }

  sendPoseNow(client, serialized);
}

function broadcastLatestPose(room, payload, except = null) {
  const members = rooms.get(room);
  if (!members) return;

  const serialized = JSON.stringify({ type: 'pose', payload });
  for (const client of members) {
    if (client !== except) queueLatestPose(client, serialized);
  }
}

function broadcastRoomStatus(room) {
  if (!room) return;
  broadcast(room, { type: 'room-status', payload: roomStatus(room) });
}

function removeFromRoom(client) {
  clearPendingPose(client);
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

  if (role === 'phone') {
    for (const member of members) {
      if (member.role === 'tv') clearPendingPose(member);
    }
    // A sequência uint16 pertence à instância da página do celular. Avise a TV
    // antes das novas poses para que seq=1 não seja comparada à origem anterior.
    // Limpar a mailbox impede que uma pose antiga pendente ultrapasse o reset.
    broadcast(room, {
      type: 'pose-stream-reset',
      payload: { reason: 'phone-joined' }
    }, client);
  }

  // O reset deve chegar antes do status que inicia a negociação com a nova origem.
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
    return;
  }

  if (type === 'rtc-signal') {
    if (!client.room) return;
    broadcast(client.room, { type: 'rtc-signal', payload }, client);
    return;
  }

  if (type === 'pose') {
    if (!client.room || client.role !== 'phone') return;
    broadcastLatestPose(client.room, payload, client);
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
  client.poseSendInFlight = false;
  client.pendingPoseMessage = null;
  client.pendingPoseMessageAt = 0;
  client.poseFlushTimer = null;
  client.poseCoalesced = 0;
  client.poseExpired = 0;

  client.on('message', (message) => handleMessage(client, message));
  client.on('close', () => removeFromRoom(client));
  client.on('error', () => removeFromRoom(client));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`MexeMundo em http://localhost:${port}`);
});
