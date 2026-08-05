import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

export class FistActivation {
  constructor({ side = HAND_SYSTEM_CONFIG.gesture.sideUsedForMenus } = {}) {
    this.side = side;
    this.armed = false;
    this.closed = false;
  }

  reset() {
    this.armed = false;
    this.closed = false;
  }

  update(frame) {
    const gesture = frame?.gestures?.[this.side];
    const state = gesture?.state ?? 'unknown';

    if (state === 'open') {
      this.armed = true;
      this.closed = false;
      return { activate: false, closed: false, armed: true, gesture };
    }

    if (state === 'fist') {
      const activate = this.armed && !this.closed;
      this.closed = true;
      if (activate) this.armed = false;
      return { activate, closed: true, armed: this.armed, gesture };
    }

    return {
      activate: false,
      closed: this.closed,
      armed: this.armed,
      gesture
    };
  }
}
