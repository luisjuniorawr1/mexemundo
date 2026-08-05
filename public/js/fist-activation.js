import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const GESTURE = HAND_SYSTEM_CONFIG.gesture;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converte o gesto universal em um clique único por ciclo aberto-fechado.
 * Além do estado `fist`, aceita uma compressão clara e sustentada, porque o
 * Pose Lite pode enxergar o fechamento sem conseguir classificá-lo por nome.
 */
export class FistActivation {
  constructor({ side = GESTURE.sideUsedForMenus } = {}) {
    this.side = side;
    this.reset();
  }

  reset() {
    this.armed = false;
    this.closed = false;
    this.closeCandidateSince = 0;
  }

  update(frame, now = performance.now()) {
    const gesture = frame?.gestures?.[this.side];
    const state = gesture?.state ?? 'unknown';
    const openness = Number(gesture?.openness || 0);
    const confidence = Number(gesture?.confidence || 0);
    const visibleTips = Number(gesture?.visibleTips || 0);
    const usable = confidence >= GESTURE.minimumActivationConfidence
      || visibleTips >= GESTURE.minimumVisibleTips;

    const thresholdSpan = Math.max(
      0.02,
      GESTURE.releaseOpenness - GESTURE.activationOpenness
    );
    const closure = usable
      ? clamp((GESTURE.releaseOpenness - openness) / thresholdSpan)
      : 0;

    const wantsClose = usable && (
      state === 'fist'
      || (openness > 0 && openness <= GESTURE.activationOpenness)
    );
    const openEnough = usable
      && !wantsClose
      && (
        openness >= GESTURE.releaseOpenness
        || state === 'open'
      );

    if (openEnough) {
      this.armed = true;
      this.closed = false;
      this.closeCandidateSince = 0;
      return {
        activate: false,
        closed: false,
        armed: true,
        pressing: false,
        closure,
        gesture
      };
    }

    if (wantsClose) {
      if (!this.closeCandidateSince) this.closeCandidateSince = now;
      const confirmed = state === 'fist'
        || now - this.closeCandidateSince >= GESTURE.compressionConfirmationMs;

      if (confirmed) {
        const activate = this.armed && !this.closed;
        this.closed = true;
        if (activate) this.armed = false;
        return {
          activate,
          closed: true,
          armed: this.armed,
          pressing: true,
          closure: Math.max(closure, 1),
          gesture
        };
      }

      return {
        activate: false,
        closed: false,
        armed: this.armed,
        pressing: true,
        closure,
        gesture
      };
    }

    this.closeCandidateSince = 0;
    return {
      activate: false,
      closed: this.closed,
      armed: this.armed,
      pressing: false,
      closure,
      gesture
    };
  }
}
