import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';
import { HandDropoutBridge } from './hand-dropout-bridge.js';
import { MexeFlowPoint } from './mexeflow.js';

const POINT_NAMES = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const HAND_NAMES = new Set(['left', 'right']);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function emptyPoint(x = 0.5, y = 0.5) {
  return { x, y, vx: 0, vy: 0, visible: false };
}

function emptyGesture() {
  return {
    state: 'unknown',
    confidence: 0,
    openness: 0,
    reach: 0,
    reference: 0,
    visibleTips: 0
  };
}

function normalizePoint(point, fallback) {
  return {
    x: clamp(Number.isFinite(point?.x) ? Number(point.x) : fallback.x),
    y: clamp(Number.isFinite(point?.y) ? Number(point.y) : fallback.y),
    vx: clamp(Number.isFinite(point?.vx) ? Number(point.vx) : 0, -4, 4),
    vy: clamp(Number.isFinite(point?.vy) ? Number(point.vy) : 0, -4, 4),
    visible: Boolean(point?.visible)
  };
}

function normalizeGesture(gesture) {
  const state = ['open', 'fist', 'unknown'].includes(gesture?.state)
    ? gesture.state
    : 'unknown';
  return {
    state,
    confidence: clamp(Number(gesture?.confidence || 0)),
    openness: clamp(Number(gesture?.openness || 0), 0, 1.5),
    reach: Math.max(0, Number(gesture?.reach || 0)),
    reference: Math.max(0, Number(gesture?.reference || 0)),
    visibleTips: clamp(Math.round(Number(gesture?.visibleTips || 0)), 0, 3)
  };
}

function emptyFrame() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.35),
    rightShoulder: emptyPoint(0.56, 0.35),
    gestures: {
      left: emptyGesture(),
      right: emptyGesture()
    },
    receivedAt: 0,
    sequence: 0,
    processingMs: 0,
    sourceIntervalMs: 0
  };
}

function predictedPoint(point, predictionSeconds) {
  if (!point.visible || predictionSeconds <= 0) return { ...point };
  return {
    ...point,
    x: clamp(point.x + point.vx * predictionSeconds),
    y: clamp(point.y + point.vy * predictionSeconds)
  };
}

/**
 * Entrada universal para todos os jogos do MexeMundo.
 *
 * O celular entrega posições filtradas e gestos. Esta classe normaliza o
 * protocolo, controla validade temporal e oferece duas saídas:
 * - visual: MexeFlow, suave em repouso e rápido em movimento;
 * - collision: rápida, sem a suavização visual.
 *
 * Uma ponte curta preserva a última posição válida quando apenas uma mão
 * desaparece por poucos quadros. A ponte visual é maior que a de colisão para
 * evitar piscadas sem criar acertos fantasmas.
 */
export class UniversalHandInput {
  constructor() {
    this.frame = emptyFrame();
    this.visualStates = {
      left: new MexeFlowPoint(this.frame.left),
      right: new MexeFlowPoint(this.frame.right)
    };
    this.dropoutStates = {
      left: new HandDropoutBridge(),
      right: new HandDropoutBridge()
    };
  }

  reset() {
    this.frame = emptyFrame();
    this.visualStates.left.reset();
    this.visualStates.right.reset();
    this.dropoutStates.left.reset();
    this.dropoutStates.right.reset();
  }

  ingest(payload, receivedAt = performance.now()) {
    const next = emptyFrame();
    for (const name of POINT_NAMES) {
      next[name] = normalizePoint(payload?.[name], next[name]);
      if (HAND_NAMES.has(name)) {
        this.dropoutStates[name].ingest(next[name], receivedAt);
      }
    }
    next.detected = Boolean(payload?.detected);
    next.gestures = {
      left: normalizeGesture(payload?.gestures?.left),
      right: normalizeGesture(payload?.gestures?.right)
    };
    next.receivedAt = Number(receivedAt);
    next.sequence = Number(payload?.sequence || 0);
    next.processingMs = Number(payload?.processingMs || 0);
    next.sourceIntervalMs = Number(payload?.sourceIntervalMs || 0);
    this.frame = next;
    return this.sample(receivedAt);
  }

  sample(now = performance.now()) {
    const ageMs = Math.max(0, Number(now) - this.frame.receivedAt);
    const fresh = ageMs <= HAND_SYSTEM_CONFIG.scheduler.poseFreshnessMs;
    const base = {
      ...this.frame,
      detected: Boolean(fresh && this.frame.detected),
      ageMs,
      fresh,
      gestures: {
        left: { ...this.frame.gestures.left },
        right: { ...this.frame.gestures.right }
      }
    };

    const packetAgeSeconds = Math.min(
      ageMs,
      HAND_SYSTEM_CONFIG.output.maximumPacketAgePredictionMs
    ) / 1000;

    const collision = { ...base };
    const visual = { ...base };

    for (const name of POINT_NAMES) {
      const source = {
        ...base[name],
        visible: Boolean(fresh && base.detected && base[name].visible)
      };

      if (!HAND_NAMES.has(name)) {
        collision[name] = { ...source };
        visual[name] = { ...source };
        continue;
      }

      const collisionSource = this.dropoutStates[name].sample(
        source,
        Number(now),
        HAND_SYSTEM_CONFIG.presence.collisionGraceMs
      );
      const visualSource = this.dropoutStates[name].sample(
        source,
        Number(now),
        HAND_SYSTEM_CONFIG.presence.visualGraceMs
      );
      const speed = Math.hypot(collisionSource.vx, collisionSource.vy);
      const predictionSeconds = collisionSource.visible
        && speed >= HAND_SYSTEM_CONFIG.output.velocityMinimumForPrediction
        ? Math.min(
            HAND_SYSTEM_CONFIG.output.maximumCollisionPredictionMs / 1000,
            packetAgeSeconds
          )
        : 0;

      collision[name] = predictedPoint(collisionSource, predictionSeconds);
      visual[name] = this.visualStates[name].update(visualSource, Number(now));
    }

    return { visual, collision };
  }
}

export function createUniversalHandInput() {
  return new UniversalHandInput();
}
