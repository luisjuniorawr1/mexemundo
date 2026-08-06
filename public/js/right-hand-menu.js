import { RealtimeClient } from './realtime.js';

const PATCHED = Symbol.for('mexemundo.v060.rightHandMenu');
const TARGET_SELECTOR = '[data-hand-target], button:not([disabled]), a[href], summary';
const DWELL_MS = 1700;
const RESULT_DWELL_MS = 1300;
const MISSING_GRACE_MS = 180;
const STABLE_DISTANCE = 0.012;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function visible(element) {
  return Boolean(element && !element.classList.contains('hidden'));
}

function playing() {
  return visible(document.querySelector('#scoreHud'));
}

function validHand(hand, payload) {
  return Boolean(
    payload?.detected
    && hand?.visible
    && Number.isFinite(hand.x)
    && Number.isFinite(hand.y)
  );
}

class VisualHandFilter {
  constructor(x) {
    this.x = x;
    this.y = 0.55;
    this.ready = false;
  }

  update(hand, dt) {
    if (!validHand(hand, { detected: true })) return null;
    const targetX = clamp((hand.x - 0.06) / 0.88, 0.02, 0.98);
    const targetY = clamp((hand.y - 0.06) / 0.88, 0.03, 0.97);

    if (!this.ready) {
      this.x = targetX;
      this.y = targetY;
      this.ready = true;
      return { x: this.x, y: this.y };
    }

    const distance = Math.hypot(targetX - this.x, targetY - this.y);
    const speed = Math.hypot(Number(hand.vx) || 0, Number(hand.vy) || 0);
    const moving = speed > 0.11 || distance > 0.018;
    const timeConstant = moving ? 0.028 : 0.085;
    const alpha = 1 - Math.exp(-Math.max(1 / 120, dt / 1000) / timeConstant);

    if (!moving && distance < 0.0024) return { x: this.x, y: this.y };

    this.x += (targetX - this.x) * alpha;
    this.y += (targetY - this.y) * alpha;
    return { x: this.x, y: this.y };
  }

  reset() {
    this.ready = false;
  }
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

  if (!document.querySelector('#handInterfaceLayer')) {
    const layer = document.createElement('div');
    layer.id = 'handInterfaceLayer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <div id="leftInterfaceHand" class="interface-hand left"><span>✋</span></div>
      <div id="rightInterfaceHand" class="interface-hand right"><span>✋</span></div>
    `;
    document.body.append(layer);
  }

  if (!document.querySelector('#rightHandMenuStyle')) {
    const style = document.createElement('style');
    style.id = 'rightHandMenuStyle';
    style.textContent = `
      #handInterfaceLayer {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }
      .interface-hand {
        --progress: 0;
        position: absolute;
        left: 0;
        top: 0;
        width: 72px;
        height: 72px;
        display: grid;
        place-items: center;
        opacity: 0;
        transform: translate3d(-100px,-100px,0) translate(-50%,-50%);
        filter: drop-shadow(0 8px 12px rgba(20,18,70,.35));
        transition: opacity .12s ease;
      }
      .interface-hand span {
        position: relative;
        z-index: 2;
        font-size: 54px;
        line-height: 1;
      }
      .interface-hand.left span { transform: rotate(8deg) scaleX(-1); }
      .interface-hand.right span { transform: rotate(-8deg); }
      .interface-hand.right::after {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 50%;
        border: 6px solid rgba(255,224,102,.95);
        clip-path: inset(0 calc((1 - var(--progress)) * 100%) 0 0);
        opacity: calc(var(--progress) * .9);
      }
      .interface-hand.active { opacity: 1; }
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
    this.leftHand = document.querySelector('#leftInterfaceHand');
    this.rightHand = document.querySelector('#rightInterfaceHand');
    this.latest = null;
    this.lastValidAt = 0;
    this.lastFrameAt = performance.now();
    this.leftFilter = new VisualHandFilter(0.35);
    this.rightFilter = new VisualHandFilter(0.65);
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
    this.rightHand.style.setProperty('--progress', '0');
  }

  hide() {
    this.leftHand.classList.remove('active');
    this.rightHand.classList.remove('active');
    this.leftFilter.reset();
    this.rightFilter.reset();
    this.clearTarget();
  }

  place(element, point) {
    if (!point) {
      element.classList.remove('active');
      return;
    }
    element.classList.add('active');
    element.style.transform = `translate3d(${point.x * innerWidth}px, ${point.y * innerHeight}px, 0) translate(-50%,-50%)`;
  }

  findTarget() {
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
    const dt = clamp(now - this.lastFrameAt, 0, 50);
    this.lastFrameAt = now;

    if (playing()) {
      this.hide();
      return;
    }

    const leftValid = validHand(this.latest?.left, this.latest);
    const rightValid = validHand(this.latest?.right, this.latest);
    if (leftValid || rightValid) this.lastValidAt = now;

    if (!leftValid && !rightValid && now - this.lastValidAt > MISSING_GRACE_MS) {
      this.hide();
      return;
    }

    const leftPoint = leftValid ? this.leftFilter.update(this.latest.left, dt) : null;
    const rightPoint = rightValid ? this.rightFilter.update(this.latest.right, dt) : null;
    this.place(this.leftHand, leftPoint);
    this.place(this.rightHand, rightPoint);

    if (!rightPoint) {
      this.clearTarget();
      return;
    }

    this.x = rightPoint.x;
    this.y = rightPoint.y;
    const nextTarget = this.findTarget();
    if (nextTarget !== this.target) {
      this.clearTarget();
      this.target = nextTarget;
      this.target?.classList.add('hand-hover');
      this.previousX = this.x;
      this.previousY = this.y;
      return;
    }

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
    this.rightHand.style.setProperty('--progress', String(progress));

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
