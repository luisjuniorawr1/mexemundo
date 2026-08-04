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
 * Não cria perfil, filtro, zona morta ou calibração próprios.
 */
export class UniversalMenuCursor {
  constructor({
    element,
    dwellMs = 950,
    targetSelector = '[data-motion-target]',
    enabled = true,
    onSelect = null
  } = {}) {
    if (!element) throw new Error('Elemento do cursor não encontrado.');
    this.element = element;
    this.dwellMs = dwellMs;
    this.targetSelector = targetSelector;
    this.onSelect = onSelect;
    this.enabled = Boolean(enabled);
    this.x = 0.5;
    this.y = 0.5;
    this.visible = false;
    this.hoverTarget = null;
    this.hoverStartedAt = 0;
    this.cooldownUntil = 0;
    this.lastValidAt = 0;
    this.element.style.setProperty('--dwell', '0');
    this.render();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide();
  }

  hide() {
    this.visible = false;
    this.element.classList.remove('active');
    this.resetHover();
  }

  resetHover() {
    this.hoverTarget?.classList.remove('motion-hover');
    this.hoverTarget = null;
    this.hoverStartedAt = 0;
    this.element.style.setProperty('--dwell', '0');
  }

  mapHand(point) {
    if (!point?.visible) return null;

    // Expande a área útil da câmera para alcançar toda a TV. A posição já
    // chega estabilizada pelo sistema universal; não há nova suavização aqui.
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
        this.updateHover(now);
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
    this.updateHover(now);
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

  updateHover(now) {
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
      this.hoverStartedAt = now;
      target.classList.add('motion-hover');
    }

    const progress = clamp((now - this.hoverStartedAt) / this.dwellMs);
    this.element.style.setProperty('--dwell', String(progress));
    if (progress < 1 || now < this.cooldownUntil) return;

    this.cooldownUntil = now + 1100;
    this.element.classList.add('selecting');
    setTimeout(() => this.element.classList.remove('selecting'), 220);
    const selectedTarget = this.hoverTarget;
    this.resetHover();

    if (typeof this.onSelect === 'function') this.onSelect(selectedTarget);
    else selectedTarget?.click();
  }
}
