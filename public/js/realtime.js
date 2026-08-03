const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  iceCandidatePoolSize: 1
};

const POSE_MAGIC = 0x4d;
const POSE_VERSION = 1;
const POSE_POINTS = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const POSE_PACKET_BYTES = 8 + POSE_POINTS.length * 8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function encodePose(payload) {
  const buffer = new ArrayBuffer(POSE_PACKET_BYTES);
  const view = new DataView(buffer);
  let flags = payload.detected ? 1 : 0;
  POSE_POINTS.forEach((name, index) => {
    if (payload[name]?.visible) flags |= 1 << (index + 1);
  });

  view.setUint8(0, POSE_MAGIC);
  view.setUint8(1, POSE_VERSION);
  view.setUint8(2, flags);
  view.setUint8(3, 0);
  view.setUint16(4, Number(payload.sequence || 0) & 0xffff, true);
  view.setUint8(6, clamp(Math.round(payload.processingMs || 0), 0, 255));
  view.setUint8(7, clamp(Math.round(payload.sourceIntervalMs || 0), 0, 255));

  let offset = 8;
  for (const name of POSE_POINTS) {
    const point = payload[name] ?? {};
    view.setUint16(offset, clamp(Math.round((point.x ?? 0.5) * 65535), 0, 65535), true);
    view.setUint16(offset + 2, clamp(Math.round((point.y ?? 0.5) * 65535), 0, 65535), true);
    view.setInt16(offset + 4, clamp(Math.round((point.vx ?? 0) * 8191), -32767, 32767), true);
    view.setInt16(offset + 6, clamp(Math.round((point.vy ?? 0) * 8191), -32767, 32767), true);
    offset += 8;
  }
  return buffer;
}

function decodePose(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== POSE_PACKET_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== POSE_MAGIC || view.getUint8(1) !== POSE_VERSION) return null;

  const flags = view.getUint8(2);
  const payload = {
    detected: Boolean(flags & 1),
    sequence: view.getUint16(4, true),
    processingMs: view.getUint8(6),
    sourceIntervalMs: view.getUint8(7)
  };

  let offset = 8;
  POSE_POINTS.forEach((name, index) => {
    payload[name] = {
      x: view.getUint16(offset, true) / 65535,
      y: view.getUint16(offset + 2, true) / 65535,
      vx: view.getInt16(offset + 4, true) / 8191,
      vy: view.getInt16(offset + 6, true) / 8191,
      visible: Boolean(flags & (1 << (index + 1)))
    };
    offset += 8;
  });
  return payload;
}

export class RealtimeClient {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.pending = new Map();
    this.sequence = 0;
    this.room = '';
    this.role = '';
    this.roomStatus = { tv: false, phone: false };
    this.peer = null;
    this.channel = null;
    this.pendingCandidates = [];
    this.peerStarting = false;
    this.retryTimer = null;
    this.transportMode = 'relay';
    this.directRtt = 0;
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/ws`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao conectar ao servidor.')), 7000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Não foi possível conectar ao servidor.'));
      }, { once: true });
    });

    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'rtc-signal') {
        this.handleSignal(message.payload).catch((error) => {
          console.warn('Falha na conexão direta.', error);
          this.fallbackToRelay();
        });
        return;
      }

      if (message.type === 'room-status') {
        this.roomStatus = message.payload ?? { tv: false, phone: false };
        if (this.role === 'tv' && this.roomStatus.phone) {
          this.startDirectConnection().catch(() => this.fallbackToRelay());
        }
      }
      this.handleIncoming(message);
    });

    this.socket.addEventListener('close', () => {
      this.closePeer();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('A conexão foi encerrada.'));
      }
      this.pending.clear();
      this.dispatch('disconnect');
    });
  }

  handleIncoming(message) {
    if (message.replyTo && this.pending.has(message.replyTo)) {
      const pending = this.pending.get(message.replyTo);
      clearTimeout(pending.timeout);
      this.pending.delete(message.replyTo);
      pending.resolve(message.payload);
      return;
    }
    this.dispatch(message.type, message.payload);
  }

  dispatch(type, payload) {
    const callbacks = this.handlers.get(type) ?? [];
    for (const callback of callbacks) callback(payload);
  }

  on(type, callback) {
    const callbacks = this.handlers.get(type) ?? [];
    callbacks.push(callback);
    this.handlers.set(type, callbacks);
  }

  emit(type, payload = {}) {
    if (type === 'pose' && this.channel?.readyState === 'open') {
      if (this.channel.bufferedAmount > 128) return true;
      try {
        this.channel.send(encodePose(payload));
        return true;
      } catch {
        this.fallbackToRelay();
      }
    }

    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  async request(type, payload = {}, timeoutMs = 5000) {
    if (type === 'ping-latency' && this.channel?.readyState === 'open') {
      try {
        return await this.directRequest(type, payload, Math.min(timeoutMs, 700));
      } catch {
        // O canal direto é não confiável de propósito; mede pelo servidor quando o ping cair.
      }
    }

    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Servidor desconectado.');

    if (type === 'join') {
      this.room = String(payload.room ?? '').toUpperCase();
      this.role = payload.role ?? '';
    }

    const id = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('O servidor não respondeu.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ type, payload, id }));
    }).then((response) => {
      if (type === 'join') {
        if (!response?.ok) {
          this.room = '';
          this.role = '';
          return response;
        }
        this.room = response.room;
        this.role = payload.role;
        this.roomStatus = response.status ?? this.roomStatus;
        if (this.role === 'tv' && this.roomStatus.phone) {
          queueMicrotask(() => this.startDirectConnection().catch(() => this.fallbackToRelay()));
        }
      }
      return response;
    });
  }

  directRequest(requestType, payload, timeoutMs) {
    const id = `d-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Canal direto não respondeu.'));
      }, timeoutMs);
      this.pending.set(id, {
        timeout,
        reject,
        resolve: (response) => {
          this.directRtt = Math.round(performance.now() - startedAt);
          this.dispatch('transport', { mode: 'direct', rtt: this.directRtt });
          resolve(response);
        }
      });
      try {
        this.channel.send(JSON.stringify({ type: 'direct-request', requestType, payload, id }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  sendSignal(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.room) return;
    this.socket.send(JSON.stringify({ type: 'rtc-signal', payload }));
  }

  createPeer() {
    this.closePeer(false);
    const peer = new RTCPeerConnection(RTC_CONFIG);
    this.peer = peer;
    this.pendingCandidates = [];

    peer.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate });
    });
    peer.addEventListener('datachannel', ({ channel }) => this.attachChannel(channel));
    peer.addEventListener('connectionstatechange', () => {
      const state = peer.connectionState;
      if (state === 'failed' || state === 'closed') {
        this.fallbackToRelay();
        this.scheduleRetry();
      } else if (state === 'disconnected') {
        this.scheduleRetry(900);
      }
    });
    return peer;
  }

  attachChannel(channel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 64;

    channel.addEventListener('open', () => {
      this.transportMode = 'direct';
      this.dispatch('transport', { mode: 'direct', rtt: this.directRtt });
    });
    channel.addEventListener('close', () => {
      this.fallbackToRelay();
      this.scheduleRetry();
    });
    channel.addEventListener('error', () => this.fallbackToRelay());
    channel.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        const pose = decodePose(event.data);
        if (pose) this.dispatch('pose', pose);
        return;
      }

      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'direct-request') {
        if (message.requestType === 'ping-latency' && channel.readyState === 'open') {
          channel.send(JSON.stringify({
            type: 'direct-response',
            replyTo: message.id,
            payload: { sentAt: message.payload?.sentAt, direct: true }
          }));
        }
        return;
      }
      this.handleIncoming(message);
    });
  }

  async startDirectConnection() {
    if (this.role !== 'tv' || !this.roomStatus.phone) return;
    if (this.channel?.readyState === 'open' || this.peerStarting) return;
    this.peerStarting = true;
    try {
      const peer = this.createPeer();
      const channel = peer.createDataChannel('mexemundo-pose', {
        ordered: false,
        maxRetransmits: 0
      });
      this.attachChannel(channel);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.sendSignal({ description: peer.localDescription });
    } finally {
      this.peerStarting = false;
    }
  }

  async handleSignal(signal) {
    if (!this.room || !signal) return;
    if (signal.description) {
      const description = signal.description;
      let peer = this.peer;
      if (description.type === 'offer') {
        peer = this.createPeer();
        await peer.setRemoteDescription(description);
        await this.flushCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.sendSignal({ description: peer.localDescription });
        return;
      }
      if (description.type === 'answer' && peer) {
        await peer.setRemoteDescription(description);
        await this.flushCandidates();
        return;
      }
    }

    if (signal.candidate) {
      if (this.peer?.remoteDescription) await this.peer.addIceCandidate(signal.candidate);
      else this.pendingCandidates.push(signal.candidate);
    }
  }

  async flushCandidates() {
    if (!this.peer?.remoteDescription || this.pendingCandidates.length === 0) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await this.peer.addIceCandidate(candidate);
      } catch (error) {
        console.warn('Candidato ICE ignorado.', error);
      }
    }
  }

  fallbackToRelay() {
    if (this.transportMode !== 'relay') {
      this.transportMode = 'relay';
      this.dispatch('transport', { mode: 'relay', rtt: 0 });
    }
  }

  scheduleRetry(delay = 1400) {
    if (this.role !== 'tv' || !this.roomStatus.phone || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startDirectConnection().catch(() => this.fallbackToRelay());
    }, delay);
  }

  closePeer(resetTransport = true) {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try { this.channel?.close(); } catch {}
    try { this.peer?.close(); } catch {}
    this.channel = null;
    this.peer = null;
    this.pendingCandidates = [];
    this.peerStarting = false;
    if (resetTransport) this.fallbackToRelay();
  }
}
