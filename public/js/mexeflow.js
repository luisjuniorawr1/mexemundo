import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const DEFAULT_CONFIG = HAND_SYSTEM_CONFIG.visual;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function halfLifeAlpha(dtMs, halfLifeMs) {
  if (halfLifeMs <= 0) return 1;
  return 1 - (2 ** (-dtMs / halfLifeMs));
}

/**
 * MexeFlow: resposta visual universal do MexeMundo.
 *
 * - trava ruído pequeno depois de um curto repouso;
 * - usa histerese para não alternar entre parado/movendo;
 * - acelera a resposta conforme velocidade e distância aumentam;
 * - limita o atraso visual sem tocar na saída de colisão.
 */
export class MexeFlowPoint {
  constructor(fallback, config = DEFAULT_CONFIG) {
    this.fallback = { x: fallback.x, y: fallback.y };
    this.config = config;
    this.reset();
  }

  reset() {
    this.ready = false;
    this.x = this.fallback.x;
    this.y = this.fallback.y;
    this.lastAt = 0;
    this.lastVisibleAt = 0;
    this.restCandidateSince = 0;
    this.resting = false;
  }

  missing(source, now) {
    const visible = this.ready
      && this.lastVisibleAt
      && now - this.lastVisibleAt <= this.config.missingGraceMs;
    return {
      ...source,
      x: this.x,
      y: this.y,
      vx: 0,
      vy: 0,
      visible: Boolean(visible)
    };
  }

  update(source, now) {
    if (!source.visible) return this.missing(source, now);

    this.lastVisibleAt = now;
    if (!this.ready) {
      this.ready = true;
      this.x = source.x;
      this.y = source.y;
      this.lastAt = now;
      return { ...source, x: this.x, y: this.y };
    }

    const dtMs = clamp(
      this.lastAt ? now - this.lastAt : 1000 / 60,
      this.config.minimumDeltaMs,
      this.config.maximumDeltaMs
    );
    this.lastAt = now;

    let dx = source.x - this.x;
    let dy = source.y - this.y;
    let distance = Math.hypot(dx, dy);
    const speed = Math.hypot(source.vx, source.vy);

    if (this.resting) {
      const leaveRest = speed >= this.config.restExitSpeed
        || distance >= this.config.restExitDistance;
      if (!leaveRest) {
        return { ...source, x: this.x, y: this.y };
      }
      this.resting = false;
      this.restCandidateSince = 0;
    } else {
      const canRest = speed <= this.config.restEnterSpeed
        && distance <= this.config.restEnterDistance;
      if (canRest) {
        if (!this.restCandidateSince) this.restCandidateSince = now;
        if (now - this.restCandidateSince >= this.config.restHoldMs) {
          this.resting = true;
          return { ...source, x: this.x, y: this.y };
        }
      } else {
        this.restCandidateSince = 0;
      }
    }

    if (distance >= this.config.snapDistance) {
      this.x = source.x;
      this.y = source.y;
      return { ...source, x: this.x, y: this.y };
    }

    const speedAmount = clamp(speed / this.config.fastResponseSpeed);
    const distanceAmount = clamp(distance / this.config.fastResponseDistance);
    const urgency = Math.max(speedAmount, distanceAmount);
    const halfLifeMs = this.config.slowHalfLifeMs
      + (this.config.fastHalfLifeMs - this.config.slowHalfLifeMs) * urgency;

    let targetX = source.x;
    let targetY = source.y;
    if (speed >= this.config.lookaheadMinimumSpeed) {
      const lookaheadSeconds = this.config.lookaheadMs / 1000;
      const lookaheadX = clamp(
        source.vx * lookaheadSeconds,
        -this.config.maximumLookaheadDistance,
        this.config.maximumLookaheadDistance
      );
      const lookaheadY = clamp(
        source.vy * lookaheadSeconds,
        -this.config.maximumLookaheadDistance,
        this.config.maximumLookaheadDistance
      );
      targetX = clamp(source.x + lookaheadX);
      targetY = clamp(source.y + lookaheadY);
    }

    const alpha = halfLifeAlpha(dtMs, halfLifeMs);
    this.x += (targetX - this.x) * alpha;
    this.y += (targetY - this.y) * alpha;

    // Não deixa a mão desenhada ficar muito atrás da mão real.
    dx = source.x - this.x;
    dy = source.y - this.y;
    distance = Math.hypot(dx, dy);
    if (distance > this.config.maximumLagDistance) {
      const amount = (distance - this.config.maximumLagDistance) / distance;
      this.x += dx * amount;
      this.y += dy * amount;
    }

    return {
      ...source,
      x: clamp(this.x),
      y: clamp(this.y)
    };
  }
}
