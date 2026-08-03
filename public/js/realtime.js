const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  iceCandidatePoolSize: 1
};

const POSE_MAGIC = 0x4d;
const POSE_VERSION = 1;
const POSE_POINTS = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const POSE_PACKET_BYTES = 8 + POSE_POINTS.length * 8;
const UINT16_RANGE = 0x10000;
const UINT16_HALF_RANGE = 0x8000;
// Uma pose que esperou mais que isto em qualquer mailbox local perdeu valor
// interativo e deve ser descartada, mesmo que o transporte volte a drenar.
const PENDING_POSE_MAX_AGE_MS = 220;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isNewerSequence(next, previous) {
  if (previous === null) return true;
  const difference = (next - previous + UINT16_RANGE) % UINT16_RANGE;
  return difference > 0 && difference < UINT16_HALF_RANGE;
}

export function encodePose(payload) {
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

export function decodePose(buffer) {
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
    this.poseChannel = null;
    this.reliableChannel = null;
    this.pendingCandidates = [];
    this.pendingPosePacket = null;
    this.pendingPosePacketAt = 0;
    this.pendingRelayPose = null;
    this.pendingRelayPoseAt = 0;
    this.relayPoseFlushTimer = null;
    this.peerStarting = false;
    this.retryTimer = null;

    this.transportMode = 'relay';
    this.directRtt = 0;
    this.lastPoseSequence = null;
    this.lastPoseAt = 0;
    this.poseIntervalMs = 0;
    this.poseReceived = 0;
    this.poseSequenceGaps = 0;
    this.poseOutOfOrderOrDuplicate = 0;
    this.poseCoalesced = 0;
    this.poseExpired = 0;
    this.lastQualityDispatchAt = 0;
    this.qualityDispatchTimer = null;
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
      this.clearPendingRelayPose();
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('A conexão foi encerrada.'));
      }
      this.pending.clear();
      this.dispatch('disconnect');
    });
  }

  resetPoseStream() {
    clearTimeout(this.qualityDispatchTimer);
    this.qualityDispatchTimer = null;
    this.lastPoseSequence = null;
    this.lastPoseAt = 0;
    this.poseIntervalMs = 0;
    this.poseReceived = 0;
    this.poseSequenceGaps = 0;
    this.poseOutOfOrderOrDuplicate = 0;
    this.poseCoalesced = 0;
    this.poseExpired = 0;
    this.lastQualityDispatchAt = 0;
  }

  acceptPose(payload) {
    const sequence = Number(payload?.sequence);
    if (Number.isFinite(sequence)) {
      const normalizedSequence = sequence & 0xffff;
      if (!isNewerSequence(normalizedSequence, this.lastPoseSequence)) {
        this.poseOutOfOrderOrDuplicate += 1;
        this.dispatchQuality();
        return;
      }

      if (this.lastPoseSequence !== null) {
        const difference = (normalizedSequence - this.lastPoseSequence + UINT16_RANGE) % UINT16_RANGE;
        this.poseSequenceGaps += Math.max(0, difference - 1);
      }
      this.lastPoseSequence = normalizedSequence;
    }

    const now = performance.now();
    if (this.lastPoseAt) {
      const interval = now - this.lastPoseAt;
      this.poseIntervalMs = this.poseIntervalMs
        ? this.poseIntervalMs * 0.82 + interval * 0.18
        : interval;
    }

    this.lastPoseAt = now;
    this.poseReceived += 1;
    this.dispatch('pose', payload);
    this.dispatchQuality(now);
  }

  dispatchQuality(now = performance.now()) {
    if (this.lastQualityDispatchAt && now - this.lastQualityDispatchAt < 750) {
      if (!this.qualityDispatchTimer) {
        const remaining = 750 - (now - this.lastQualityDispatchAt);
        this.qualityDispatchTimer = setTimeout(() => {
          this.qualityDispatchTimer = null;
          this.dispatchQuality();
        }, remaining);
        this.qualityDispatchTimer.unref?.();
      }
      return;
    }
    clearTimeout(this.qualityDispatchTimer);
    this.qualityDispatchTimer = null;
    this.lastQualityDispatchAt = now;

    const dropped = this.poseSequenceGaps
      + this.poseOutOfOrderOrDuplicate
      + this.poseCoalesced
      + this.poseExpired;
    const total = this.poseReceived + dropped;
    const directOpen = this.transportMode === 'direct'
      && this.poseChannel?.readyState === 'open';
    this.dispatch('quality', {
      mode: this.transportMode,
      rtt: directOpen ? this.directRtt : undefined,
      packetIntervalMs: Math.round(this.poseIntervalMs || 0),
      received: this.poseReceived,
      dropped,
      sequenceGaps: this.poseSequenceGaps,
      outOfOrderOrDuplicate: this.poseOutOfOrderOrDuplicate,
      coalesced: this.poseCoalesced,
      expired: this.poseExpired,
      dropRate: total ? dropped / total : 0,
      bufferedAmount: directOpen
        ? this.poseChannel.bufferedAmount
        : (this.socket?.bufferedAmount ?? 0)
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

    if (message.type === 'pose') {
      this.acceptPose(message.payload);
      return;
    }

    if (message.type === 'pose-stream-reset') {
      if (this.role === 'tv') {
        // Encerra imediatamente o DataChannel da origem anterior. Listeners de
        // canais substituídos também verificam identidade antes de aceitar pose.
        this.closePeer();
      }
      this.resetPoseStream();
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
    if (type === 'pose') return this.emitPose(payload);
    return this.emitReliable(type, payload);
  }

  countCoalescedPose() {
    this.poseCoalesced += 1;
    this.dispatchQuality();
  }

  countExpiredPose() {
    this.poseExpired += 1;
    this.dispatchQuality();
  }

  emitPose(payload) {
    if (this.transportMode === 'direct' && this.poseChannel?.readyState === 'open') {
      const packet = encodePose(payload);

      // Canal sempre trabalha com o quadro mais recente. Se houver algo no
      // buffer, substitui a pose pendente em vez de criar uma fila atrasada.
      if (this.pendingPosePacket || this.poseChannel.bufferedAmount > 0) {
        if (this.pendingPosePacket) this.countCoalescedPose();
        this.pendingPosePacket = packet;
        this.pendingPosePacketAt = performance.now();
        return true;
      }

      try {
        this.poseChannel.send(packet);
        return true;
      } catch {
        this.fallbackToRelay();
      }
    }

    return this.emitRelayPose(payload);
  }

  emitRelayPose(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;

    const serialized = JSON.stringify({ type: 'pose', payload });
    if (this.pendingRelayPose || this.socket.bufferedAmount > 0) {
      if (this.pendingRelayPose) this.countCoalescedPose();
      this.pendingRelayPose = serialized;
      this.pendingRelayPoseAt = performance.now();
      this.scheduleRelayPoseFlush();
      return true;
    }

    try {
      this.socket.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  scheduleRelayPoseFlush() {
    if (!this.pendingRelayPose || this.relayPoseFlushTimer) return;
    this.relayPoseFlushTimer = setTimeout(() => {
      this.relayPoseFlushTimer = null;
      this.flushRelayPose();
    }, 8);
  }

  flushRelayPose() {
    if (!this.pendingRelayPose) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.clearPendingRelayPose();
      return;
    }
    if (performance.now() - this.pendingRelayPoseAt > PENDING_POSE_MAX_AGE_MS) {
      this.clearPendingRelayPose();
      this.countExpiredPose();
      return;
    }
    if (this.socket.bufferedAmount > 0) {
      this.scheduleRelayPoseFlush();
      return;
    }

    const serialized = this.pendingRelayPose;
    this.pendingRelayPose = null;
    this.pendingRelayPoseAt = 0;
    try {
      this.socket.send(serialized);
    } catch {
      // O fechamento do socket descarta a pose, que já perdeu valor temporal.
    }
  }

  clearPendingRelayPose() {
    clearTimeout(this.relayPoseFlushTimer);
    this.relayPoseFlushTimer = null;
    this.pendingRelayPose = null;
    this.pendingRelayPoseAt = 0;
  }

  emitReliable(type, payload = {}) {
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type, payload }));
        return true;
      } catch {
        // Usa o WebSocket como fallback confiável.
      }
    }

    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  async request(type, payload = {}, timeoutMs = 5000) {
    if (type === 'ping-latency' && this.poseChannel?.readyState === 'open') {
      // Não mistura o timeout do ping direto com um segundo RTT via servidor.
      // O chamador registra a falha e a próxima amostra usa o estado de
      // transporte que estiver ativo naquele momento.
      return this.directRequest(type, payload, Math.min(timeoutMs, 700));
    }

    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Servidor desconectado.');
    }

    if (type === 'join') {
      this.pendingPosePacket = null;
      this.pendingPosePacketAt = 0;
      this.clearPendingRelayPose();
      this.room = String(payload.room ?? '').toUpperCase();
      this.role = payload.role ?? '';
      this.resetPoseStream();
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
        this.poseChannel.send(JSON.stringify({ type: 'direct-request', requestType, payload, id }));
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
      if (this.peer === peer && candidate) this.sendSignal({ candidate });
    });

    peer.addEventListener('datachannel', ({ channel }) => {
      if (this.peer === peer) this.attachChannel(channel);
    });

    peer.addEventListener('connectionstatechange', () => {
      if (this.peer !== peer) return;
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
    if (channel.label === 'mexemundo-events') {
      this.attachReliableChannel(channel);
      return;
    }

    this.attachPoseChannel(channel);
  }

  attachPoseChannel(channel) {
    this.poseChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 0;

    channel.addEventListener('open', () => {
      if (this.poseChannel !== channel) return;
      this.transportMode = 'direct';
      this.pendingPosePacket = null;
      this.pendingPosePacketAt = 0;
      this.clearPendingRelayPose();
      this.dispatch('transport', { mode: 'direct', rtt: this.directRtt });
    });

    channel.addEventListener('bufferedamountlow', () => {
      if (this.poseChannel !== channel) return;
      this.flushDirectPose(channel);
    });

    channel.addEventListener('close', () => {
      if (this.poseChannel !== channel) return;
      this.fallbackToRelay();
      this.scheduleRetry();
    });

    channel.addEventListener('error', () => {
      if (this.poseChannel === channel) this.fallbackToRelay();
    });

    channel.addEventListener('message', (event) => {
      if (this.poseChannel !== channel) return;
      if (event.data instanceof ArrayBuffer) {
        const pose = decodePose(event.data);
        if (pose) this.acceptPose(pose);
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

  attachReliableChannel(channel) {
    this.reliableChannel = channel;

    channel.addEventListener('open', () => {
      this.dispatch('reliable-ready', { mode: 'direct' });
    });

    channel.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleIncoming(message);
    });

    channel.addEventListener('error', () => {
      this.reliableChannel = null;
    });

    channel.addEventListener('close', () => {
      if (this.reliableChannel === channel) this.reliableChannel = null;
    });
  }

  flushDirectPose(channel = this.poseChannel) {
    if (!this.pendingPosePacket || channel?.readyState !== 'open') return;

    const packet = this.pendingPosePacket;
    const queuedAt = this.pendingPosePacketAt;
    this.pendingPosePacket = null;
    this.pendingPosePacketAt = 0;

    if (performance.now() - queuedAt > PENDING_POSE_MAX_AGE_MS) {
      this.countExpiredPose();
      return;
    }

    try {
      channel.send(packet);
    } catch {
      this.fallbackToRelay();
    }
  }

  async startDirectConnection() {
    if (this.role !== 'tv' || !this.roomStatus.phone) return;
    if (this.poseChannel?.readyState === 'open' || this.peerStarting) return;

    this.peerStarting = true;
    let peer = null;
    try {
      peer = this.createPeer();
      // createPeer fecha o peer anterior; reafirma o lock antes do primeiro await.
      this.peerStarting = true;

      const poseChannel = peer.createDataChannel('mexemundo-pose', {
        ordered: false,
        maxRetransmits: 0
      });
      this.attachPoseChannel(poseChannel);

      const reliableChannel = peer.createDataChannel('mexemundo-events', {
        ordered: true
      });
      this.attachReliableChannel(reliableChannel);

      const offer = await peer.createOffer();
      if (this.peer !== peer) return;
      await peer.setLocalDescription(offer);
      if (this.peer !== peer) return;
      this.sendSignal({ description: peer.localDescription });
    } finally {
      if (!this.peer || this.peer === peer) this.peerStarting = false;
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
      if (this.peer?.remoteDescription) {
        await this.peer.addIceCandidate(signal.candidate);
      } else {
        this.pendingCandidates.push(signal.candidate);
      }
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
    this.pendingPosePacket = null;
    this.pendingPosePacketAt = 0;
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

    const poseChannel = this.poseChannel;
    const reliableChannel = this.reliableChannel;
    const peer = this.peer;
    this.poseChannel = null;
    this.reliableChannel = null;
    this.peer = null;

    try { poseChannel?.close(); } catch {}
    try { reliableChannel?.close(); } catch {}
    try { peer?.close(); } catch {}

    this.pendingCandidates = [];
    this.pendingPosePacket = null;
    this.pendingPosePacketAt = 0;
    this.peerStarting = false;

    if (resetTransport) this.fallbackToRelay();
  }
}
