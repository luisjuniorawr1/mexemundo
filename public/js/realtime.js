export class RealtimeClient {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.pending = new Map();
    this.sequence = 0;
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

      if (message.replyTo && this.pending.has(message.replyTo)) {
        const pending = this.pending.get(message.replyTo);
        clearTimeout(pending.timeout);
        this.pending.delete(message.replyTo);
        pending.resolve(message.payload);
        return;
      }

      const callbacks = this.handlers.get(message.type) ?? [];
      for (const callback of callbacks) callback(message.payload);
    });

    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('A conexão foi encerrada.'));
      }
      this.pending.clear();
      const callbacks = this.handlers.get('disconnect') ?? [];
      for (const callback of callbacks) callback();
    });
  }

  on(type, callback) {
    const callbacks = this.handlers.get(type) ?? [];
    callbacks.push(callback);
    this.handlers.set(type, callbacks);
  }

  emit(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, payload }));
    return true;
  }

  request(type, payload = {}, timeoutMs = 5000) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Servidor desconectado.'));
    }

    const id = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('O servidor não respondeu.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ type, payload, id }));
    });
  }
}
