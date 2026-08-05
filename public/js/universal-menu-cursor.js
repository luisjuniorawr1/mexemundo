import { FistActivation } from './fist-activation.js';
import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function viewportSize() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || innerHeight)
  };
}

/**
 * Cursor do menu alimentado exclusivamente pela saída visual universal.
 * A seleção ocorre pela transição mão aberta -> punho fechado.
 */
export class UniversalMenuCursor {
  constructor({
    element,
    targetSelector = '[data-motion-target]',
    enabled = true,
    onSelect = null
  } = {}) {
    if (!element) throw new Error('Elemento do cursor não encontrado.');
    this.element = element;
    this.icon = element.querySelector('span');
    this.targetSelector = targetSelector;
    this.onSelect = onSelect;
    this.enabled = Boolean(enabled);
    this.x = 0.5;
    this.y = 0.5;
    this.visible = false;
    this.hoverTarget = null;
    this.cooldownUntil = 0;
    this.lastValidAt = 0;
    this.activation = new FistActivation({
      side: HAND_SYSTEM_CONFIG.gesture.sideUsedForMenus
    });
    this.element.classList.add('fist-mode');
    this.element.style.setProperty('--dwell', '0');
    this.render();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide();
  }

  hide() {
    this.visible = false;
    this.element.classList.remove('active', 'fist-closed');
    if (this.icon) this.icon.textContent = '✋';
    this.activation.reset();
    this.resetHover();
  }

  resetHover() {
    this.hoverTarget?.classList.remove('motion-hover');
    this.hoverTarget = null;
    this.element.style.setProperty('--dwell', '0');
  }

  mapHand(point) {
    if (!point?.visible) return null;
    return {
      x: clamp((Number(point.x) - 0.08) / 0.84, 0.025, 0.975),
      y: clamp((Number(point.y) - 0.08) / 0.84, 0.035, 0.965)
    };
  }

  updateFrame(frame, now = performance.now()) {
    if (!this.enabled) {
      this.hide();
      return;
    }

    const mapped = frame?.fresh && frame?.detected
      ? this.mapHand(frame.right)
      : null;

    if (!mapped) {
      if (this.visible && now - this.lastValidAt <= 220) {
        this.updateHover();
        this.updateGesture(frame, now);
        return;
      }
      this.hide();
      return;
    }

    this.x = mapped.x;
    this.y = mapped.y;
    this.lastValidAt = now;
    this.visible = true;
    this.element.classList.add('active');
    this.render();
    this.updateHover();
    this.updateGesture(frame, now);
  }

  render() {
    const viewport = viewportSize();
    this.element.style.transform = `translate3d(${this.x * viewport.width}px, ${this.y * viewport.height}px, 0) translate(-50%, -50%)`;
  }

  pointInsideTarget(target, x, y, margin = 52) {
    if (!target?.isConnected) return false;
    const rect = target.getBoundingClientRect();
    return x >= rect.left - margin
      && x <= rect.right + margin
      && y >= rect.top - margin
      && y <= rect.bottom + margin;
  }

  updateHover() {
    const viewport = viewportSize();
    const clientX = this.x * viewport.width;
    const clientY = this.y * viewport.height;
    const element = document.elementFromPoint(clientX, clientY);
    let target = element?.closest?.(this.targetSelector) ?? null;

    if (
      this.hoverTarget
      && target !== this.hoverTarget
      && this.pointInsideTarget(this.hoverTarget, clientX, clientY)
    ) {
      target = this.hoverTarget;
    }

    if (!target || target.matches('[disabled], [aria-disabled="true"]')) {
      this.resetHover();
      return;
    }

    if (target !== this.hoverTarget) {
      this.resetHover();
      this.hoverTarget = target;
      target.classList.add('motion-hover');
    }
  }

  updateGesture(frame, now) {
    const state = this.activation.update(frame);
    this.element.classList.toggle('fist-closed', state.closed);
    if (this.icon) this.icon.textContent = state.closed ? '✊' : '✋';

    if (!state.activate || now < this.cooldownUntil) return;

    const selectedTarget = this.hoverTarget;
    if (!selectedTarget) return;

    this.cooldownUntil = now + HAND_SYSTEM_CONFIG.gesture.clickCooldownMs;
    this.element.classList.add('selecting');
    setTimeout(() => this.element.classList.remove('selecting'), 220);
    this.resetHover();

    if (typeof this.onSelect === 'function') this.onSelect(selectedTarget);
    else selectedTarget.click();
  }
}
