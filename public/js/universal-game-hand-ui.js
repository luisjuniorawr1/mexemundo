import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';
import { createUniversalHandInput } from './game-hand-input.js';
import { MotionCursor } from './motion-ui.js';
import { RealtimeClient } from './realtime.js';

const PATCHED = Symbol.for('mexemundo.universalGameHandUI');
const TARGET_SELECTOR = [
  '[data-motion-target]',
  'button:not([disabled])',
  'a[href]',
  'summary'
].join(', ');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function viewportSize() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || innerHeight)
  };
}

function panelVisible(documentRef, selector) {
  const panel = documentRef?.querySelector?.(selector);
  return Boolean(panel && !panel.classList.contains('hidden'));
}

export function resolveGameDwellMs(target, documentRef = document) {
  const explicit = Number(target?.dataset?.motionDwellMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit, 1200, 8000);
  }

  if (panelVisible(documentRef, '#resultPanel')) return 2200;
  if (panelVisible(documentRef, '#scoreHud')) return 4200;
  return 2800;
}

class UniversalGameHandCursor {
  constructor(element) {
    if (!element) throw new Error('Elemento do cursor das mãos não encontrado.');
    this.element = element;
    this.icon = element.querySelector('span');
    this.x = 0.5;
    this.y = 0.5;
    this.visible = false;
    this.lastValidAt = 0;
    this.lastAt = 0;
    this.lastX = null;
    this.lastY = null;
    this.hoverTarget = null;
    this.elapsedMs = 0;
    this.cooldownUntil = 0;
    this.activeHand = null;
    this.element.style.setProperty('--dwell', '0');
    if (this.icon) this.icon.textContent = '✋';
    this.render();
  }

  selectHand(frame) {
    const preferred = frame?.[HAND_SYSTEM_CONFIG.menu.preferredHand];
    if (preferred?.visible) {
      return {
        side: HAND_SYSTEM_CONFIG.menu.preferredHand,
        point: preferred
      };
    }

    const fallback = frame?.[HAND_SYSTEM_CONFIG.menu.fallbackHand];
    if (fallback?.visible) {
      return {
        side: HAND_SYSTEM_CONFIG.menu.fallbackHand,
        point: fallback
      };
    }

    return null;
  }

  mapPoint(point) {
    if (!point?.visible) return null;
    return {
      x: clamp((Number(point.x) - 0.08) / 0.84, 0.025, 0.975),
      y: clamp((Number(point.y) - 0.08) / 0.84, 0.035, 0.965)
    };
  }

  resetHover() {
    this.hoverTarget?.classList.remove('motion-hover', 'motion-pressing');
    this.hoverTarget = null;
    this.elapsedMs = 0;
    this.lastX = null;
    this.lastY = null;
    this.element.style.setProperty('--dwell', '0');
  }

  hide() {
    this.visible = false;
    this.activeHand = null;
    this.element.classList.remove('active');
    this.resetHover();
  }

  render() {
    const viewport = viewportSize();
    this.element.style.transform = `translate3d(${this.x * viewport.width}px, ${this.y * viewport.height}px, 0) translate(-50%, -50%)`;
  }

  pointInsideTarget(target, clientX, clientY) {
    if (!target?.isConnected) return false;
    const rect = target.getBoundingClientRect();
    const margin = HAND_SYSTEM_CONFIG.menu.targetExitMarginPx;
    return clientX >= rect.left - margin
      && clientX <= rect.right + margin
      && clientY >= rect.top - margin
      && clientY <= rect.bottom + margin;
  }

  findTarget() {
    const viewport = viewportSize();
    const clientX = this.x * viewport.width;
    const clientY = this.y * viewport.height;
    const element = document.elementFromPoint(clientX, clientY);
    let target = element?.closest?.(TARGET_SELECTOR) ?? null;

    if (
      this.hoverTarget
      && target !== this.hoverTarget
      && this.pointInsideTarget(this.hoverTarget, clientX, clientY)
    ) {
      target = this.hoverTarget;
    }

    if (
      !target
      || target.matches('[disabled], [aria-disabled="true"]')
      || target.closest('.hidden')
    ) {
      return null;
    }

    return target;
  }

  updateProgress(target, now) {
    const dtMs = this.lastAt
      ? clamp(now - this.lastAt, 0, HAND_SYSTEM_CONFIG.menu.maximumFrameDeltaMs)
      : 0;
    this.lastAt = now;

    if (!target) {
      this.resetHover();
      return;
    }

    if (target !== this.hoverTarget) {
      this.resetHover();
      this.hoverTarget = target;
      this.hoverTarget.classList.add('motion-hover');
      this.lastX = this.x;
      this.lastY = this.y;
      return;
    }

    const movement = this.lastX === null || this.lastY === null
      ? 0
      : Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;

    if (movement <= HAND_SYSTEM_CONFIG.menu.stableStepDistance) {
      this.elapsedMs += dtMs;
    } else if (movement <= HAND_SYSTEM_CONFIG.menu.maximumRecoverableStepDistance) {
      this.elapsedMs = Math.max(
        0,
        this.elapsedMs
          - dtMs * HAND_SYSTEM_CONFIG.menu.unstableDecayMultiplier
      );
    } else {
      this.elapsedMs = 0;
    }

    const dwellMs = resolveGameDwellMs(target);
    const progress = clamp(this.elapsedMs / dwellMs);
    this.element.style.setProperty('--dwell', String(progress));

    if (progress < 1 || now < this.cooldownUntil) return;

    const selectedTarget = target;
    this.cooldownUntil = now + HAND_SYSTEM_CONFIG.menu.cooldownMs;
    this.element.classList.add('selecting');
    setTimeout(() => this.element.classList.remove('selecting'), 220);
    this.resetHover();
    selectedTarget.click();
  }

  updateFrame(frame, now = performance.now()) {
    const selected = frame?.fresh && frame?.detected
      ? this.selectHand(frame)
      : null;
    const mapped = selected ? this.mapPoint(selected.point) : null;

    if (!mapped) {
      if (
        this.visible
        && now - this.lastValidAt <= HAND_SYSTEM_CONFIG.menu.missingGraceMs
      ) {
        this.updateProgress(this.hoverTarget, now);
        return;
      }
      this.hide();
      return;
    }

    if (this.activeHand && selected.side !== this.activeHand) {
      this.resetHover();
    }

    this.activeHand = selected.side;
    this.x = mapped.x;
    this.y = mapped.y;
    this.lastValidAt = now;
    this.visible = true;
    this.element.classList.add('active');
    this.render();
    this.updateProgress(this.findTarget(), now);
  }
}

const interfaceInput = createUniversalHandInput();
let controller = null;
let latestPayload = null;
let animationFrame = 0;

function disableLegacyGameCursor() {
  MotionCursor.prototype.setEnabled = function setLegacyCursorDisabled() {
    this.enabled = false;
  };
  MotionCursor.prototype.updatePose = function ignoreLegacyPose() {};
}

export function installUniversalGameHandUI() {
  const prototype = RealtimeClient.prototype;
  if (prototype[PATCHED]) return;

  disableLegacyGameCursor();
  const originalOn = prototype.on;
  prototype.on = function onWithUniversalGameUI(type, callback) {
    if (type !== 'pose') return originalOn.call(this, type, callback);

    return originalOn.call(this, type, (payload) => {
      latestPayload = payload;
      interfaceInput.ingest(payload);
      callback(payload);
    });
  };

  Object.defineProperty(prototype, PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export function startUniversalGameHandUI() {
  if (controller) return controller;

  const element = document.querySelector('#motionCursor');
  controller = new UniversalGameHandCursor(element);
  if (latestPayload) interfaceInput.ingest(latestPayload);

  const frame = (now) => {
    controller.updateFrame(interfaceInput.sample(now).visual, now);
    animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(animationFrame);
  }, { once: true });

  return controller;
}
