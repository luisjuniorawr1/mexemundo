import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const POINT_NAMES = ['left', 'right', 'leftShoulder', 'rightShoulder'];

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function emptyPoint(x = 0.5, y = 0.5) {
  return { x, y, vx: 0, vy: 0, visible: false };
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

function emptyFrame() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.35),
    rightShoulder: emptyPoint(0.56, 0.35),
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
 * O celular já entrega posições filtradas pelo núcleo de mãos. Esta classe
 * apenas normaliza o protocolo, controla validade temporal e oferece duas
 * saídas padronizadas: visual e colisão. Jogos não devem criar filtros,
 * zonas mortas, perfis ou predições alternativas.
 */
export class UniversalHandInput {
  constructor() {
    this.frame = emptyFrame();
  }

  reset() {
    this.frame = emptyFrame();
  }

  ingest(payload, receivedAt = performance.now()) {
    const next = emptyFrame();
    for (const name of POINT_NAMES) {
      next[name] = normalizePoint(payload?.[name], next[name]);
    }
    next.detected = Boolean(payload?.detected);
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
      fresh
    };

    const packetAgeSeconds = Math.min(
      ageMs,
      HAND_SYSTEM_CONFIG.output.maximumPacketAgePredictionMs
    ) / 1000;

    const makeOutput = (predictionLimitMs) => {
      const output = { ...base };
      for (const name of POINT_NAMES) {
        const source = base[name];
        const isHand = name === 'left' || name === 'right';
        const speed = Math.hypot(source.vx, source.vy);
        const predictionSeconds = isHand
          && source.visible
          && speed >= HAND_SYSTEM_CONFIG.output.velocityMinimumForPrediction
          ? Math.min(predictionLimitMs / 1000, packetAgeSeconds)
          : 0;
        output[name] = predictedPoint({
          ...source,
          visible: Boolean(fresh && base.detected && source.visible)
        }, predictionSeconds);
      }
      return output;
    };

    return {
      visual: makeOutput(HAND_SYSTEM_CONFIG.output.maximumVisualPredictionMs),
      collision: makeOutput(HAND_SYSTEM_CONFIG.output.maximumCollisionPredictionMs)
    };
  }
}

export function createUniversalHandInput() {
  return new UniversalHandInput();
}
