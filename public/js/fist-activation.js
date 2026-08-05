import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const GESTURE = HAND_SYSTEM_CONFIG.gesture;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export class FistActivation {
  constructor({ side = GESTURE.sideUsedForMenus } = {}) {
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
    const openness = Number(gesture?.openness || 0);
    const confidence = Number(gesture?.confidence || 0);
    const visibleTips = Number(gesture?.visibleTips || 0);
    const usable = confidence >= GESTURE.minimumActivationConfidence
      || visibleTips >= GESTURE.minimumVisibleTips;

    const openEnough = state === 'open'
      || (usable && openness >= GESTURE.armOpenness);
    if (openEnough) {
      this.armed = true;
      this.closed = false;
      return {
        activate: false,
        closed: false,
        armed: true,
        closure: clamp(1 - openness),
        gesture
      };
    }

    if (state === 'fist' && usable) {
      const activate = this.armed && !this.closed;
      this.closed = true;
      if (activate) this.armed = false;
      return {
        activate,
        closed: true,
        armed: this.armed,
        closure: clamp(1 - openness),
        gesture
      };
    }

    return {
      activate: false,
      closed: this.closed,
      armed: this.armed,
      closure: clamp(1 - openness),
      gesture
    };
  }
}
