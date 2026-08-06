import { RealtimeClient } from './realtime.js';

const PATCHED = Symbol.for('mexemundo.twoHandShoulderStartGate');
const DEFAULT_TOLERANCE = 0.12;
const DEFAULT_HOLD_MS = 700;

function validVisiblePoint(point) {
  return Boolean(
    point?.visible
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

/**
 * Abertura tolerante dos jogos.
 *
 * Cada mão precisa estar visível e chegar perto do próprio ombro. A tolerância
 * evita exigir os braços acima da cabeça, posição em que o Pose costuma perder
 * os pulsos em celulares com enquadramento mais fechado.
 */
export function twoHandsAtShoulderHeight(
  pose,
  tolerance = DEFAULT_TOLERANCE
) {
  if (!pose?.detected) return false;
  if (!validVisiblePoint(pose.left) || !validVisiblePoint(pose.right)) return false;
  if (
    !validVisiblePoint(pose.leftShoulder)
    || !validVisiblePoint(pose.rightShoulder)
  ) return false;

  const margin = Math.max(0, Number(tolerance) || 0);
  return pose.left.y <= pose.leftShoulder.y + margin
    && pose.right.y <= pose.rightShoulder.y + margin;
}

export class TwoHandStartHold {
  constructor({ holdMs = DEFAULT_HOLD_MS } = {}) {
    this.holdMs = Math.max(250, Number(holdMs) || DEFAULT_HOLD_MS);
    this.startedAt = 0;
    this.activated = false;
  }

  reset() {
    this.startedAt = 0;
    this.activated = false;
  }

  update(ready, now = performance.now()) {
    if (!ready) {
      this.reset();
      return false;
    }

    if (this.activated) return false;
    if (!this.startedAt) {
      this.startedAt = now;
      return false;
    }

    if (now - this.startedAt < this.holdMs) return false;
    this.activated = true;
    return true;
  }
}

function calibrationVisible() {
  const panel = document.querySelector('#calibrationPanel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}

export function installTwoHandStartGate({
  tolerance = DEFAULT_TOLERANCE,
  holdMs = DEFAULT_HOLD_MS
} = {}) {
  const prototype = RealtimeClient.prototype;
  if (prototype[PATCHED]) return;

  const hold = new TwoHandStartHold({ holdMs });
  const originalOn = prototype.on;

  prototype.on = function onWithTwoHandStartGate(type, callback) {
    if (type !== 'pose') return originalOn.call(this, type, callback);

    return originalOn.call(this, type, (payload) => {
      callback(payload);

      if (!calibrationVisible()) {
        hold.reset();
        return;
      }

      const ready = twoHandsAtShoulderHeight(payload, tolerance);
      if (!hold.update(ready)) return;

      document.querySelector('#restartButton')?.click();
    });
  };

  Object.defineProperty(prototype, PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}
