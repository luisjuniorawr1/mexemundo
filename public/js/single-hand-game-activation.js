import { RealtimeClient } from './realtime.js';

const PATCHED = Symbol.for('mexemundo.singleHandGameActivation');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function visible(point) {
  return Boolean(
    point?.visible
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  );
}

function raisedPoint(point, fallbackX, y) {
  return {
    ...(point ?? {}),
    x: clamp(Number.isFinite(point?.x) ? point.x : fallbackX),
    y: clamp(y),
    vx: 0,
    vy: 0,
    visible: true
  };
}

/**
 * Durante a tela de preparação, transforma uma mão levantada em um sinal de
 * início compatível com os jogos antigos que esperavam as duas mãos. Essa
 * adaptação nunca é usada durante a partida.
 */
export function adaptPoseForSingleHandActivation(payload, tolerance = 0.015) {
  if (!payload?.detected) return payload;
  if (!visible(payload.leftShoulder) || !visible(payload.rightShoulder)) {
    return payload;
  }

  const leftRaised = visible(payload.left)
    && payload.left.y < payload.leftShoulder.y - tolerance;
  const rightRaised = visible(payload.right)
    && payload.right.y < payload.rightShoulder.y - tolerance;
  if (!leftRaised && !rightRaised) return payload;

  const source = leftRaised && rightRaised
    ? (payload.left.y <= payload.right.y ? payload.left : payload.right)
    : leftRaised
      ? payload.left
      : payload.right;
  const shoulderY = Math.min(
    payload.leftShoulder.y,
    payload.rightShoulder.y
  );
  const raisedY = Math.min(source.y, shoulderY - 0.035);

  return {
    ...payload,
    left: raisedPoint(payload.left, 0.35, raisedY),
    right: raisedPoint(payload.right, 0.65, raisedY)
  };
}

function panelVisible(selector) {
  const panel = document.querySelector(selector);
  return Boolean(panel && !panel.classList.contains('hidden'));
}

/**
 * Intercepta poses somente nas telas de preparação e resultado. Assim que a
 * contagem começa, o pacote original volta a ser entregue sem alterações.
 */
export function installSingleHandGameActivation() {
  const prototype = RealtimeClient.prototype;
  if (prototype[PATCHED]) return;

  const originalOn = prototype.on;
  prototype.on = function onWithSingleHandActivation(type, callback) {
    if (type !== 'pose') return originalOn.call(this, type, callback);

    return originalOn.call(this, type, (payload) => {
      const activationScreen = panelVisible('#calibrationPanel')
        || panelVisible('#resultPanel');
      callback(
        activationScreen
          ? adaptPoseForSingleHandActivation(payload)
          : payload
      );
    });
  };

  Object.defineProperty(prototype, PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}
