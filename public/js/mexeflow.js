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
 * MexeFlow v2 anti-pull: resposta visual universal do MexeMundo.
 *
 * - reduz tremor com repouso suave, sem congelar a mão;
 * - usa histerese para evitar alternância entre parado e movimento;
 * - acelera progressivamente conforme velocidade e distância aumentam;
 * - limita a correção por quadro para impedir puxadas e teletransportes;
 * - não altera a saída rápida usada pelas colisões.
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

    const missingGapMs = this.lastVisibleAt
      ? Math.max(0, now - this.lastVisibleAt)
      : 0;
    this.lastVisibleAt = now;

    if (!this.ready || missingGapMs > this.config.reacquireResetMs) {
      this.ready = true;
      this.x = source.x;
      this.y = source.y;
      this.lastAt = now;
      this.restCandidateSince = 0;
      this.resting = false;
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

    const speedAmount = clamp(speed / this.config.fastResponseSpeed);
    const distanceAmount = clamp(
      distance / this.config.fastResponseDistance
    );
    const urgency = smoothstep(Math.max(speedAmount, distanceAmount));
    const halfLifeMs = this.config.slowHalfLifeMs
      + (this.config.fastHalfLifeMs - this.config.slowHalfLifeMs) * urgency;
    const alpha = halfLifeAlpha(dtMs, halfLifeMs);

    const previousX = this.x;
    const previousY = this.y;
    let desiredX = this.x + (source.x - this.x) * alpha;
    let desiredY = this.y + (source.y - this.y) * alpha;

    // Quando a mão visual fica atrás, recupera o excesso de forma gradual.
    // A versão anterior eliminava todo o excesso no mesmo quadro, causando a
    // puxada brusca percebida durante alguns arrastos.
    dx = source.x - desiredX;
    dy = source.y - desiredY;
    distance = Math.hypot(dx, dy);
    if (distance > this.config.maximumLagDistance) {
      const catchUpAlpha = halfLifeAlpha(
        dtMs,
        this.config.lagCatchUpHalfLifeMs
      );
      const excess = (distance - this.config.maximumLagDistance) / distance;
      desiredX += dx * excess * catchUpAlpha;
      desiredY += dy * excess * catchUpAlpha;
    }

    let stepX = desiredX - previousX;
    let stepY = desiredY - previousY;
    const stepDistance = Math.hypot(stepX, stepY);
    const maximumStep = Math.min(
      this.config.maximumStepDistance,
      this.config.maximumStepBase
        + speed * (dtMs / 1000) * this.config.maximumStepSpeedGain
    );

    if (stepDistance > maximumStep && stepDistance > 0) {
      const scale = maximumStep / stepDistance;
      stepX *= scale;
      stepY *= scale;
    }

    this.x = clamp(previousX + stepX);
    this.y = clamp(previousY + stepY);

    return {
      ...source,
      x: this.x,
      y: this.y
    };
  }
}
