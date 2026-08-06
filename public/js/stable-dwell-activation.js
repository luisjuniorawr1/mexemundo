import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const DEFAULT_CONFIG = Object.freeze({
  ...HAND_SYSTEM_CONFIG.menu,
  dwellMs: 4000
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Seleção por permanência estável usada pela plataforma MexeMundo.
 *
 * Pequenos movimentos humanos continuam contando. Um movimento moderado faz
 * o progresso recuar suavemente; uma saída clara do alvo reinicia a seleção.
 */
export class StableDwellActivation {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.target = null;
    this.elapsedMs = 0;
    this.lastAt = 0;
    this.lastX = null;
    this.lastY = null;
    this.cooldownUntil = 0;
  }

  clearTarget() {
    this.target = null;
    this.elapsedMs = 0;
    this.lastX = null;
    this.lastY = null;
  }

  update({ target = null, x = 0.5, y = 0.5, visible = false } = {}, now = performance.now()) {
    const dtMs = this.lastAt
      ? clamp(now - this.lastAt, 0, this.config.maximumFrameDeltaMs)
      : 0;
    this.lastAt = now;

    if (!visible || !target) {
      this.clearTarget();
      return { progress: 0, activate: false, target: null, stable: false };
    }

    if (target !== this.target) {
      this.target = target;
      this.elapsedMs = 0;
      this.lastX = x;
      this.lastY = y;
      return { progress: 0, activate: false, target, stable: true };
    }

    const movement = this.lastX === null || this.lastY === null
      ? 0
      : Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x;
    this.lastY = y;

    let stable = false;
    if (movement <= this.config.stableStepDistance) {
      stable = true;
      this.elapsedMs += dtMs;
    } else if (movement <= this.config.maximumRecoverableStepDistance) {
      this.elapsedMs = Math.max(
        0,
        this.elapsedMs - dtMs * this.config.unstableDecayMultiplier
      );
    } else {
      this.elapsedMs = 0;
    }

    const progress = clamp(this.elapsedMs / this.config.dwellMs);
    if (progress < 1 || now < this.cooldownUntil) {
      return { progress, activate: false, target, stable };
    }

    this.cooldownUntil = now + this.config.cooldownMs;
    const selectedTarget = target;
    this.clearTarget();
    return { progress: 1, activate: true, target: selectedTarget, stable: true };
  }
}
