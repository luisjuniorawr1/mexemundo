const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  iceCandidatePoolSize: 1
};

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
      // Pacotes de movimento antigos não têm valor. Em congestionamento,
      // descarta o quadro atual em vez de criar uma fila perceptível.
      if (this.channel.bufferedAmount > 16 * 1024) return true;
      try {
        this.channel.send(JSON.stringify({ type, payload }));
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
        return await this.directRequest(type, payload, Math.min(timeoutMs, 900));
      } catch {
        // O canal de poses é propositalmente não confiável. Se um ping cair,
        // mede pelo WebSocket sem derrubar a partida nem acusar desconexão.
      }
    }

    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Servidor desconectado.');
    }

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

    peer.addEventListener('datachannel', ({ channel }) => {
      this.attachChannel(channel);
    });

    peer.addEventListener('connectionstatechange', () => {
      const state = peer.connectionState;
      if (state === 'failed' || state === 'closed') {
        this.fallbackToRelay();
        this.scheduleRetry();
      } else if (state === 'disconnected') {
        this.scheduleRetry(1200);
      }
    });

    return peer;
  }

  attachChannel(channel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 4 * 1024;

    channel.addEventListener('open', () => {
      this.transportMode = 'direct';
      this.dispatch('transport', { mode: 'direct', rtt: this.directRtt });
    });

    channel.addEventListener('close', () => {
      this.fallbackToRelay();
      this.scheduleRetry();
    });

    channel.addEventListener('error', () => {
      this.fallbackToRelay();
    });

    channel.addEventListener('message', (event) => {
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

      if (message.type === 'direct-response') {
        this.handleIncoming(message);
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
    if (this.transportMode !== 'relay') {
      this.transportMode = 'relay';
      this.dispatch('transport', { mode: 'relay', rtt: 0 });
    }
  }

  scheduleRetry(delay = 1800) {
    if (this.role !== 'tv' || !this.roomStatus.phone || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startDirectConnection().catch(() => this.fallbackToRelay());
    }, delay);
  }

  closePeer(resetTransport = true) {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;

    try {
      this.channel?.close();
    } catch {}
    try {
      this.peer?.close();
    } catch {}

    this.channel = null;
    this.peer = null;
    this.pendingCandidates = [];
    this.peerStarting = false;

    if (resetTransport) this.fallbackToRelay();
  }
}
