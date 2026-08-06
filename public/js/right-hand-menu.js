import { RealtimeClient } from './realtime.js';

const PATCHED = Symbol.for('mexemundo.v060.rightHandMenu');
const TARGET_SELECTOR = '[data-hand-target], button:not([disabled]), a[href], summary';
const DWELL_MS = 1700;
const RESULT_DWELL_MS = 1300;
const MISSING_GRACE_MS = 180;
const STABLE_DISTANCE = 0.016;
const INTERACTION_MIN_X = 0.15;
const INTERACTION_MAX_X = 0.85;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function visible(element) {
  return Boolean(element && !element.classList.contains('hidden'));
}

function playing() {
  return visible(document.querySelector('#scoreHud'));
}

function validRightHand(payload) {
  const hand = payload?.right;
  return Boolean(
    payload?.detected
    && hand?.visible
    && Number.isFinite(hand.x)
    && Number.isFinite(hand.y)
  );
}

function installInterfaceElements() {
  const topActions = document.querySelector('.top-actions');
  if (topActions && !document.querySelector('#handHomeButton')) {
    const home = document.createElement('a');
    home.id = 'handHomeButton';
    home.className = 'icon-button';
    home.href = '/';
    home.setAttribute('aria-label', 'Voltar ao menu');
    home.dataset.handTarget = 'true';
    home.textContent = '⌂';
    topActions.prepend(home);
  }

  const fullscreen = document.querySelector('#fullscreenButton');
  if (fullscreen) fullscreen.dataset.handTarget = 'true';

  const restart = document.querySelector('#restartButton');
  if (restart) restart.dataset.handTarget = 'true';

  const result = document.querySelector('#resultPanel');
  if (result && !result.querySelector('.hand-home-result')) {
    const home = document.createElement('a');
    home.className = 'button secondary hand-home-result';
    home.href = '/';
    home.dataset.handTarget = 'true';
    home.textContent = 'Voltar ao menu';
    restart?.insertAdjacentElement('afterend', home);
  }

  document.querySelectorAll('summary').forEach((summary) => {
    summary.dataset.handTarget = 'true';
  });

  if (!document.querySelector('#rightHandMenuCursor')) {
    const cursor = document.createElement('div');
    cursor.id = 'rightHandMenuCursor';
    cursor.innerHTML = '<span>✋</span>';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);
  }

  if (!document.querySelector('#rightHandMenuStyle')) {
    const style = document.createElement('style');
    style.id = 'rightHandMenuStyle';
    style.textContent = `
      #rightHandMenuCursor {
        --progress: 0;
        position: fixed;
        z-index: 100000;
        left: 0;
        top: 0;
        width: 72px;
        height: 72px;
        display: grid;
        place-items: center;
        pointer-events: none;
        opacity: 0;
        transform: translate3d(-100px,-100px,0) translate(-50%,-50%);
        filter: drop-shadow(0 8px 12px rgba(20,18,70,.35));
        transition: opacity .12s ease;
      }
      #rightHandMenuCursor span {
        position: relative;
        z-index: 2;
        font-size: 54px;
        line-height: 1;
        transform: rotate(-8deg);
      }
      #rightHandMenuCursor.active { opacity: 1; }
      [data-hand-target].hand-hover,
      button.hand-hover,
      a.hand-hover,
      summary.hand-hover {
        outline: 5px solid rgba(255,224,102,.9);
        outline-offset: 5px;
        transform: scale(1.035);
      }
      .hand-home-result { margin-left: 10px; }
    `;
    document.head.append(style);
  }
}

class RightHandMenuController {
  constructor() {
    installInterfaceElements();
    this.cursor = document.querySelector('#rightHandMenuCursor');
    this.latest = null;
    this.lastValidAt = 0;
    this.lastFrameAt = 0;
    this.x = 0.5;
    this.y = 0.5;
    this.previousX = null;
    this.previousY = null;
    this.target = null;
    this.elapsed = 0;
    this.cooldownUntil = 0;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  ingest(payload) {
    this.latest = payload;
  }

  clearTarget() {
    this.target?.classList.remove('hand-hover');
    this.target = null;
    this.elapsed = 0;
    this.previousX = null;
    this.previousY = null;
    this.cursor.style.setProperty('--progress', '0');
  }

  hide() {
    this.cursor.classList.remove('active');
    this.clearTarget();
  }

  findTarget() {
    if (this.x < INTERACTION_MIN_X || this.x > INTERACTION_MAX_X) return null;

    const clientX = this.x * window.innerWidth;
    const clientY = this.y * window.innerHeight;
    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest?.(TARGET_SELECTOR) ?? null;
    if (!target || target.matches('[disabled], [aria-disabled="true"]')) return null;
    if (target.closest('.hidden')) return null;
    return target;
  }

  frame(now) {
    requestAnimationFrame(this.frame);

    if (playing()) {
      this.hide();
      this.lastFrameAt = now;
      return;
    }

    if (validRightHand(this.latest)) {
      this.lastValidAt = now;
      this.x = clamp((this.latest.right.x - 0.06) / 0.88, 0.02, 0.98);
      this.y = clamp((this.latest.right.y - 0.06) / 0.88, 0.03, 0.97);
    } else if (now - this.lastValidAt > MISSING_GRACE_MS) {
      this.hide();
      this.lastFrameAt = now;
      return;
    }

    this.cursor.classList.add('active');
    this.cursor.style.transform = `translate3d(${this.x * innerWidth}px, ${this.y * innerHeight}px, 0) translate(-50%,-50%)`;

    const nextTarget = this.findTarget();
    if (nextTarget !== this.target) {
      this.clearTarget();
      this.target = nextTarget;
      this.target?.classList.add('hand-hover');
      this.previousX = this.x;
      this.previousY = this.y;
      this.lastFrameAt = now;
      return;
    }

    const dt = this.lastFrameAt ? clamp(now - this.lastFrameAt, 0, 50) : 0;
    this.lastFrameAt = now;
    if (!this.target) return;

    const movement = this.previousX === null
      ? 0
      : Math.hypot(this.x - this.previousX, this.y - this.previousY);
    this.previousX = this.x;
    this.previousY = this.y;

    if (movement <= STABLE_DISTANCE) this.elapsed += dt;
    else this.elapsed = Math.max(0, this.elapsed - dt * 1.7);

    const dwell = visible(document.querySelector('#resultPanel'))
      ? RESULT_DWELL_MS
      : DWELL_MS;
    const progress = clamp(this.elapsed / dwell);
    this.cursor.style.setProperty('--progress', String(progress));

    if (progress < 1 || now < this.cooldownUntil) return;
    const selected = this.target;
    this.cooldownUntil = now + 900;
    this.clearTarget();
    selected.click();
  }
}

let controller = null;

export function installRightHandMenu() {
  if (controller) return controller;
  const prototype = RealtimeClient.prototype;

  if (!prototype[PATCHED]) {
    const originalOn = prototype.on;
    prototype.on = function onWithRightHandMenu(type, callback) {
      if (type !== 'pose') return originalOn.call(this, type, callback);
      return originalOn.call(this, type, (payload) => {
        controller?.ingest(payload);
        callback(payload);
      });
    };
    Object.defineProperty(prototype, PATCHED, { value: true });
  }

  controller = new RightHandMenuController();
  return controller;
}
