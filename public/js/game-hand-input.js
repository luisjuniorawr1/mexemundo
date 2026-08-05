import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const POINT_NAMES = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const HAND_NAMES = new Set(['left', 'right']);
const VISUAL = HAND_SYSTEM_CONFIG.visual;

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
    reference: 0
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
    reference: Math.max(0, Number(gesture?.reference || 0))
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

class VisualPointState {
  constructor(fallback) {
    this.fallback = fallback;
    this.ready = false;
    this.x = fallback.x;
    this.y = fallback.y;
    this.lastVisibleAt = 0;
  }

  reset() {
    this.ready = false;
    this.x = this.fallback.x;
    this.y = this.fallback.y;
    this.lastVisibleAt = 0;
  }

  update(source, now) {
    if (!source.visible) {
      const withinGrace = this.ready
        && this.lastVisibleAt
        && now - this.lastVisibleAt <= VISUAL.missingGraceMs;
      return {
        ...source,
        x: this.x,
        y: this.y,
        vx: 0,
        vy: 0,
        visible: Boolean(withinGrace)
      };
    }

    this.lastVisibleAt = now;
    if (!this.ready) {
      this.ready = true;
      this.x = source.x;
      this.y = source.y;
      return { ...source };
    }

    const dx = source.x - this.x;
    const dy = source.y - this.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(source.vx, source.vy);

    if (distance <= VISUAL.restDeadZone && speed <= VISUAL.restSpeed) {
      return {
        ...source,
        x: this.x,
        y: this.y
      };
    }

    const speedAmount = clamp(
      (speed - VISUAL.restSpeed) / VISUAL.movementSpeedRange
    );
    const distanceAmount = clamp(
      (distance - VISUAL.restDeadZone) / VISUAL.movementDistanceRange
    );
    const responsiveness = Math.max(speedAmount, distanceAmount);
    const alpha = distance >= VISUAL.snapDistance
      ? 1
      : VISUAL.minimumAlpha
        + responsiveness * (VISUAL.maximumAlpha - VISUAL.minimumAlpha);

    this.x += dx * alpha;
    this.y += dy * alpha;

    return {
      ...source,
      x: clamp(this.x),
      y: clamp(this.y)
    };
  }
}

/**
 * Entrada universal para todos os jogos do MexeMundo.
 *
 * O celular entrega posições filtradas e gestos. Esta classe normaliza o
 * protocolo, controla validade temporal e oferece duas saídas:
 * - visual: estabilizada a cada frame da TV;
 * - collision: rápida, sem a suavização visual.
 */
export class UniversalHandInput {
  constructor() {
    this.frame = emptyFrame();
    this.visualStates = {
      left: new VisualPointState(this.frame.left),
      right: new VisualPointState(this.frame.right)
    };
  }

  reset() {
    this.frame = emptyFrame();
    this.visualStates.left.reset();
    this.visualStates.right.reset();
  }

  ingest(payload, receivedAt = performance.now()) {
    const next = emptyFrame();
    for (const name of POINT_NAMES) {
      next[name] = normalizePoint(payload?.[name], next[name]);
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
      const speed = Math.hypot(source.vx, source.vy);
      const predictionSeconds = HAND_NAMES.has(name)
        && source.visible
        && speed >= HAND_SYSTEM_CONFIG.output.velocityMinimumForPrediction
        ? Math.min(
            HAND_SYSTEM_CONFIG.output.maximumCollisionPredictionMs / 1000,
            packetAgeSeconds
          )
        : 0;

      collision[name] = predictedPoint(source, predictionSeconds);
      visual[name] = HAND_NAMES.has(name)
        ? this.visualStates[name].update(source, Number(now))
        : { ...source };
    }

    return { visual, collision };
  }
}

export function createUniversalHandInput() {
  return new UniversalHandInput();
}
