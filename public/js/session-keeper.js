export class SessionKeeper {
  constructor({
    client,
    room,
    role,
    onStatus = null,
    onReconnect = null,
    onWaiting = null,
    intervalMs = 900
  } = {}) {
    if (!client) throw new Error('Cliente realtime obrigatório.');

    this.client = client;
    this.room = room;
    this.role = role;
    this.onStatus = onStatus;
    this.onReconnect = onReconnect;
    this.onWaiting = onWaiting;
    this.intervalMs = intervalMs;
    this.active = false;
    this.busy = false;
    this.timer = null;
    this.retryTimer = null;
    this.attempts = 0;

    this.handleWake = () => this.ensure();
    this.handleVisibility = () => {
      if (!document.hidden) this.ensure();
    };

    this.client.on('disconnect', () => {
      if (!this.active) return;
      this.onWaiting?.();
      this.schedule(180);
    });

    this.client.on('session-replaced', () => {
      this.stop();
    });
  }

  start() {
    if (this.active) return;
    this.active = true;
    window.addEventListener('online', this.handleWake);
    window.addEventListener('pageshow', this.handleWake);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.timer = setInterval(() => this.ensure(), this.intervalMs);
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    window.removeEventListener('online', this.handleWake);
    window.removeEventListener('pageshow', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  socketOpen() {
    return this.client.socket?.readyState === WebSocket.OPEN;
  }

  schedule(delay = null) {
    if (!this.active || this.retryTimer) return;
    const wait = delay ?? Math.min(4000, 320 * (2 ** Math.min(this.attempts, 4)));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensure(true);
    }, wait);
  }

  async ensure(force = false) {
    if (!this.active || this.busy) return null;
    if (!force && this.socketOpen()) return null;

    this.busy = true;
    try {
      await this.client.connect();
      const joined = await this.client.request('join', {
        room: this.room,
        role: this.role
      }, 2800);

      if (!joined?.ok) {
        throw new Error(joined?.error || 'Falha ao retomar a sala.');
      }

      this.attempts = 0;
      this.onStatus?.(joined.status ?? {});
      this.onReconnect?.(joined);
      return joined;
    } catch {
      this.attempts += 1;
      this.schedule();
      return null;
    } finally {
      this.busy = false;
    }
  }
}
