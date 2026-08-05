import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const DEFAULT_CONFIG = HAND_SYSTEM_CONFIG.visual;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function halfLifeAlpha(dtMs, halfLifeMs) {
  if (halfLifeMs <= 0) return 1;
  return 1 - (2 ** (-dtMs / halfLifeMs));
}

function smoothstep(value) {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
}

/**
 * MexeFlow v2: resposta visual universal do MexeMundo.
 *
 * - reduz tremor com repouso suave, sem congelar a mão;
 * - usa histerese para evitar alternância entre parado e movimento;
 * - acelera progressivamente conforme velocidade e distância aumentam;
 * - limita o atraso visual sem alterar a saída rápida de colisão.
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

      if (leaveRest) {
        this.resting = false;
        this.restCandidateSince = 0;
      } else {
        // Em repouso, ruído microscópico não move a mão. Variações um pouco
        // maiores são acompanhadas lentamente para evitar sensação de trava.
        if (distance > this.config.restMicroDeadZone) {
          const alpha = halfLifeAlpha(
            dtMs,
            this.config.restFollowHalfLifeMs
          );
          this.x += dx * alpha;
          this.y += dy * alpha;
        }
        return {
          ...source,
          x: clamp(this.x),
          y: clamp(this.y)
        };
      }
    }

    const canRest = speed <= this.config.restEnterSpeed
      && distance <= this.config.restEnterDistance;
    if (canRest) {
      if (!this.restCandidateSince) this.restCandidateSince = now;
      if (now - this.restCandidateSince >= this.config.restHoldMs) {
        this.resting = true;
        return {
          ...source,
          x: clamp(this.x),
          y: clamp(this.y)
        };
      }
    } else {
      this.restCandidateSince = 0;
    }

    if (distance >= this.config.snapDistance) {
      this.x = source.x;
      this.y = source.y;
      return { ...source, x: this.x, y: this.y };
    }

    const speedAmount = clamp(speed / this.config.fastResponseSpeed);
    const distanceAmount = clamp(
      distance / this.config.fastResponseDistance
    );
    const urgency = smoothstep(Math.max(speedAmount, distanceAmount));
    const halfLifeMs = this.config.slowHalfLifeMs
      + (this.config.fastHalfLifeMs - this.config.slowHalfLifeMs) * urgency;
    const alpha = halfLifeAlpha(dtMs, halfLifeMs);

    this.x += (source.x - this.x) * alpha;
    this.y += (source.y - this.y) * alpha;

    // A mão desenhada nunca fica excessivamente atrás da posição detectada.
    dx = source.x - this.x;
    dy = source.y - this.y;
    distance = Math.hypot(dx, dy);
    if (distance > this.config.maximumLagDistance) {
      const amount = (
        distance - this.config.maximumLagDistance
      ) / distance;
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
