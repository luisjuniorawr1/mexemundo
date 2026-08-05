import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';
import { StableDwellActivation } from './stable-dwell-activation.js';

const MENU = HAND_SYSTEM_CONFIG.menu;

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
 * Cursor universal do menu alimentado pela saída visual MexeFlow.
 *
 * A seleção acontece mantendo uma das mãos sobre o mesmo item por cinco
 * segundos. O progresso tolera tremor humano e não depende dos dedos.
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
    this.lastValidAt = 0;
    this.activeHand = null;
    this.dwell = new StableDwellActivation();
    this.element.classList.remove('fist-mode');
    this.element.style.setProperty('--dwell', '0');
    this.element.style.setProperty('--close', '0');
    if (this.icon) this.icon.textContent = '✋';
    this.render();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide();
  }

  hide() {
    this.visible = false;
    this.activeHand = null;
    this.element.classList.remove(
      'active',
      'fist-closed',
      'fist-armed',
      'fist-pressing'
    );
    this.dwell.reset();
    this.resetHover();
    if (this.icon) this.icon.textContent = '✋';
  }

  resetHover() {
    this.hoverTarget?.classList.remove('motion-hover', 'motion-pressing');
    this.hoverTarget = null;
    this.element.style.setProperty('--dwell', '0');
  }

  selectHand(frame) {
    const preferred = frame?.[MENU.preferredHand];
    if (preferred?.visible) {
      return { side: MENU.preferredHand, point: preferred };
    }

    const fallback = frame?.[MENU.fallbackHand];
    if (fallback?.visible) {
      return { side: MENU.fallbackHand, point: fallback };
    }

    return null;
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

    const selectedHand = frame?.fresh && frame?.detected
      ? this.selectHand(frame)
      : null;
    const mapped = selectedHand ? this.mapHand(selectedHand.point) : null;

    if (!mapped) {
      if (this.visible && now - this.lastValidAt <= MENU.missingGraceMs) return;
      this.hide();
      return;
    }

    if (this.activeHand && selectedHand.side !== this.activeHand) {
      this.dwell.reset();
      this.resetHover();
    }
    this.activeHand = selectedHand.side;
    this.x = mapped.x;
    this.y = mapped.y;
    this.lastValidAt = now;
    this.visible = true;
    this.element.classList.add('active');
    this.render();

    const target = this.updateHover();
    const dwellState = this.dwell.update({
      target,
      x: this.x,
      y: this.y,
      visible: true
    }, now);
    this.element.style.setProperty('--dwell', String(dwellState.progress));

    if (!dwellState.activate) return;
    const selectedTarget = dwellState.target;
    if (!selectedTarget?.isConnected) return;

    this.element.classList.add('selecting');
    setTimeout(() => this.element.classList.remove('selecting'), 220);
    this.resetHover();

    if (typeof this.onSelect === 'function') this.onSelect(selectedTarget);
    else selectedTarget.click();
  }

  render() {
    const viewport = viewportSize();
    this.element.style.transform = `translate3d(${this.x * viewport.width}px, ${this.y * viewport.height}px, 0) translate(-50%, -50%)`;
  }

  pointInsideTarget(target, x, y, margin = MENU.targetExitMarginPx) {
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
      return null;
    }

    if (target !== this.hoverTarget) {
      this.hoverTarget?.classList.remove('motion-hover', 'motion-pressing');
      this.hoverTarget = target;
      target.classList.add('motion-hover');
    }

    return target;
  }
}
