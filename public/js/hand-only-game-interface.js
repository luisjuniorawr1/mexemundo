import { createUniversalHandInput } from './game-hand-input.js';
import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';
import { MotionCursor, getPersistentRoom, roomHref } from './motion-ui.js';
import { RealtimeClient } from './realtime.js';
import { StableDwellActivation } from './stable-dwell-activation.js';

const INSTALL_MARK = Symbol.for('mexemundo.handOnlyGameInterface');
const LEGACY_CURSOR_MARK = Symbol.for('mexemundo.legacyMotionCursorDisabled');
const TARGET_SELECTOR = '[data-motion-target], [data-hand-action], a[href], button:not([disabled]), summary';
let controller = null;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function viewportSize() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || innerHeight)
  };
}

function panelVisible(selector) {
  const panel = document.querySelector(selector);
  return Boolean(panel && !panel.classList.contains('hidden'));
}

function elementUsable(target) {
  if (!target?.isConnected) return false;
  if (target.matches('[disabled], [aria-disabled="true"]')) return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function resolveActionDwellMs(
  { playing = false, result = false } = {},
  config = HAND_SYSTEM_CONFIG.interface
) {
  if (result) return config.resultDwellMs;
  if (playing) return config.playingDwellMs;
  return config.defaultDwellMs;
}

export function selectInterfaceHand(
  frame,
  config = HAND_SYSTEM_CONFIG.interface
) {
  const preferred = frame?.[config.preferredHand];
  if (preferred?.visible) {
    return { side: config.preferredHand, point: preferred };
  }

  const fallback = frame?.[config.fallbackHand];
  if (fallback?.visible) {
    return { side: config.fallbackHand, point: fallback };
  }

  return null;
}

function disableLegacyMotionCursor() {
  const prototype = MotionCursor.prototype;
  if (prototype[LEGACY_CURSOR_MARK]) return;

  prototype.setEnabled = function disableLegacyCursor() {
    this.enabled = false;
    this.hide?.();
  };
  prototype.updatePose = function ignoreLegacyPose() {
    this.enabled = false;
    this.hide?.();
  };

  Object.defineProperty(prototype, LEGACY_CURSOR_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

class HandOnlyGameInterface {
  constructor() {
    this.config = HAND_SYSTEM_CONFIG.interface;
    this.handInput = createUniversalHandInput();
    this.hoverTarget = null;
    this.activeHand = null;
    this.x = 0.5;
    this.y = 0.5;
    this.lastValidAt = 0;
    this.enabled = false;

    this.dwellConfig = {
      dwellMs: this.config.defaultDwellMs,
      stableStepDistance: this.config.stableStepDistance,
      maximumRecoverableStepDistance: this.config.maximumRecoverableStepDistance,
      unstableDecayMultiplier: this.config.unstableDecayMultiplier,
      maximumFrameDeltaMs: this.config.maximumFrameDeltaMs,
      cooldownMs: this.config.cooldownMs
    };
    this.dwell = new StableDwellActivation(this.dwellConfig);

    this.installStyles();
    this.disableLegacyElement();
    this.cursor = this.createCursor();
    this.prepareActions();

    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  installStyles() {
    if (document.querySelector('link[data-hand-only-interface]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/hand-interface.css';
    link.dataset.handOnlyInterface = '1';
    document.head.append(link);
  }

  disableLegacyElement() {
    const legacyCursor = document.querySelector('#motionCursor');
    if (legacyCursor) legacyCursor.hidden = true;
  }

  createCursor() {
    const existing = document.querySelector('#handActionCursor');
    if (existing) return existing;

    const element = document.createElement('div');
    element.id = 'handActionCursor';
    element.className = 'motion-cursor hand-action-cursor';
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('--dwell', '0');
    element.innerHTML = '<span>✋</span>';
    document.body.append(element);
    return element;
  }

  prepareActions() {
    document.querySelectorAll('a[href], button:not([disabled]), summary').forEach((target) => {
      if (!target.matches('[data-hand-ignore]')) target.dataset.handAction = '1';
    });

    const resultPanel = document.querySelector('#resultPanel');
    const restartButton = document.querySelector('#restartButton');
    if (!resultPanel || !restartButton) return;

    let actionRow = resultPanel.querySelector('.hand-result-actions');
    if (!actionRow) {
      actionRow = document.createElement('div');
      actionRow.className = 'hand-result-actions';
      restartButton.parentNode.insertBefore(actionRow, restartButton);
      actionRow.append(restartButton);
    }

    if (!actionRow.querySelector('[data-other-games]')) {
      const otherGames = document.createElement('a');
      otherGames.className = 'button secondary motion-action';
      otherGames.dataset.motionTarget = '';
      otherGames.dataset.handAction = '1';
      otherGames.dataset.otherGames = '1';
      otherGames.href = roomHref('/', getPersistentRoom());
      otherGames.textContent = 'Escolher outro jogo';
      actionRow.append(otherGames);
    }

    if (!resultPanel.querySelector('.hand-action-hint')) {
      const hint = document.createElement('p');
      hint.className = 'hand-action-hint';
      hint.textContent = 'Aponte para uma opção e mantenha a mão parada até o círculo completar.';
      actionRow.insertAdjacentElement('afterend', hint);
    }
  }

  ingest(payload) {
    this.handInput.ingest(payload);
  }

  currentUiState() {
    const pairing = panelVisible('#pairPanel');
    const countdown = panelVisible('#countdownPanel');
    const result = panelVisible('#resultPanel');
    const scoreHud = document.querySelector('#scoreHud');
    const playing = Boolean(scoreHud && !scoreHud.classList.contains('hidden'));
    return {
      pairing,
      countdown,
      result,
      playing,
      enabled: !pairing && !countdown
    };
  }

  mapHand(point) {
    if (!point?.visible) return null;
    return {
      x: clamp((Number(point.x) - 0.08) / 0.84, 0.025, 0.975),
      y: clamp((Number(point.y) - 0.08) / 0.84, 0.035, 0.965)
    };
  }

  pointInsideTarget(target, clientX, clientY) {
    if (!elementUsable(target)) return false;
    const rect = target.getBoundingClientRect();
    const margin = this.config.targetExitMarginPx;
    return clientX >= rect.left - margin
      && clientX <= rect.right + margin
      && clientY >= rect.top - margin
      && clientY <= rect.bottom + margin;
  }

  findTarget(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    let target = element?.closest?.(TARGET_SELECTOR) ?? null;

    if (
      this.hoverTarget
      && target !== this.hoverTarget
      && this.pointInsideTarget(this.hoverTarget, clientX, clientY)
    ) {
      target = this.hoverTarget;
    }

    if (!elementUsable(target) || target.matches('[data-hand-ignore]')) return null;
    return target;
  }

  clearHover() {
    this.hoverTarget?.classList.remove('motion-hover', 'motion-pressing');
    this.hoverTarget = null;
    this.cursor.style.setProperty('--dwell', '0');
  }

  hide() {
    this.enabled = false;
    this.activeHand = null;
    this.cursor.classList.remove('active', 'selecting');
    this.dwell.reset();
    this.clearHover();
  }

  render() {
    const viewport = viewportSize();
    this.cursor.style.transform = `translate3d(${this.x * viewport.width}px, ${this.y * viewport.height}px, 0) translate(-50%, -50%)`;
  }

  update(frame, now, uiState) {
    if (!uiState.enabled) {
      this.hide();
      return;
    }

    const selectedHand = frame?.fresh && frame?.detected
      ? selectInterfaceHand(frame, this.config)
      : null;
    const mapped = selectedHand ? this.mapHand(selectedHand.point) : null;

    if (!mapped) {
      if (this.enabled && now - this.lastValidAt <= this.config.missingGraceMs) return;
      this.hide();
      return;
    }

    if (this.activeHand && selectedHand.side !== this.activeHand) {
      this.dwell.reset();
      this.clearHover();
    }

    this.enabled = true;
    this.activeHand = selectedHand.side;
    this.x = mapped.x;
    this.y = mapped.y;
    this.lastValidAt = now;
    this.render();

    const viewport = viewportSize();
    const clientX = this.x * viewport.width;
    const clientY = this.y * viewport.height;
    const target = this.findTarget(clientX, clientY);

    if (target !== this.hoverTarget) {
      this.hoverTarget?.classList.remove('motion-hover', 'motion-pressing');
      this.hoverTarget = target;
      target?.classList.add('motion-hover');
    }

    this.dwellConfig.dwellMs = resolveActionDwellMs(uiState, this.config);
    const dwellState = this.dwell.update({
      target,
      x: this.x,
      y: this.y,
      visible: true
    }, now);

    this.cursor.style.setProperty('--dwell', String(dwellState.progress));
    this.hoverTarget?.classList.toggle('motion-pressing', dwellState.progress >= 0.18);

    const showEverywhere = uiState.result || !uiState.playing;
    this.cursor.classList.toggle('active', Boolean(showEverywhere || target));

    if (!dwellState.activate) return;
    const selectedTarget = dwellState.target;
    if (!elementUsable(selectedTarget)) return;

    this.cursor.classList.add('selecting');
    setTimeout(() => this.cursor.classList.remove('selecting'), 220);
    this.clearHover();
    selectedTarget.click();
  }

  frame(now) {
    const frames = this.handInput.sample(now);
    this.update(frames.visual, now, this.currentUiState());
    requestAnimationFrame(this.frame);
  }
}

function tapRawPoseStream(activeController) {
  const prototype = RealtimeClient.prototype;
  if (prototype[INSTALL_MARK]) return;

  const originalOn = prototype.on;
  prototype.on = function onWithHandOnlyInterface(type, callback) {
    if (type !== 'pose') return originalOn.call(this, type, callback);

    return originalOn.call(this, type, (payload) => {
      activeController.ingest(payload);
      callback(payload);
    });
  };

  Object.defineProperty(prototype, INSTALL_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export function installHandOnlyGameInterface() {
  if (controller) return controller;
  disableLegacyMotionCursor();
  controller = new HandOnlyGameInterface();
  tapRawPoseStream(controller);
  return controller;
}
