const ROOM_KEY = 'mexemundo-room-v1';
const PROFILE_KEY = 'mexemundo-motion-profile-v1';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function cleanRoom(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, mean = average(values)) {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function getPersistentRoom() {
  const queryRoom = cleanRoom(new URLSearchParams(location.search).get('sala'));
  const storedRoom = cleanRoom(sessionStorage.getItem(ROOM_KEY));
  const generatedRoom = Math.random().toString(36).slice(2, 6).toUpperCase();
  const room = queryRoom || storedRoom || generatedRoom;
  sessionStorage.setItem(ROOM_KEY, room);
  return room;
}

export function roomHref(path, room = getPersistentRoom()) {
  const url = new URL(path, location.origin);
  url.searchParams.set('sala', cleanRoom(room));
  return `${url.pathname}${url.search}`;
}

export function getMotionProfile() {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    if (
      !Number.isFinite(profile.centerX)
      || !Number.isFinite(profile.centerY)
      || !Number.isFinite(profile.scaleX)
      || !Number.isFinite(profile.scaleY)
      || !Number.isFinite(profile.deadZone)
    ) return null;
    return profile;
  } catch {
    return null;
  }
}

export function saveMotionProfile(profile) {
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

export function clearMotionProfile() {
  sessionStorage.removeItem(PROFILE_KEY);
}

export function buildMotionProfile(samples) {
  const valid = samples.filter((sample) => (
    sample?.right?.visible
    && sample?.leftShoulder?.visible
    && sample?.rightShoulder?.visible
  ));

  if (valid.length < 20) {
    throw new Error('Não houve amostras suficientes para calibrar.');
  }

  const xs = valid.map((sample) => sample.right.x);
  const ys = valid.map((sample) => sample.right.y);
  const widths = valid.map((sample) => Math.abs(sample.leftShoulder.x - sample.rightShoulder.x));
  const centerX = average(xs);
  const centerY = average(ys);
  const shoulderWidth = clamp(average(widths), 0.08, 0.35);
  const jitter = Math.hypot(
    standardDeviation(xs, centerX),
    standardDeviation(ys, centerY)
  );

  return saveMotionProfile({
    version: 2,
    centerX,
    centerY,
    scaleX: clamp(shoulderWidth * 2.75, 0.28, 0.72),
    scaleY: clamp(shoulderWidth * 2.35, 0.24, 0.62),
    deadZone: clamp(jitter * 3.2, 0.0045, 0.018),
    jitter,
    createdAt: Date.now()
  });
}

export function calibratedDeadZone(fallback = 0.004) {
  const profile = getMotionProfile();
  return profile ? clamp(profile.deadZone, fallback, 0.018) : fallback;
}

export class MotionCursor {
  constructor({
    element,
    dwellMs = 850,
    targetSelector = '[data-motion-target]',
    enabled = true,
    onSelect = null
  } = {}) {
    if (!element) throw new Error('Elemento do cursor não encontrado.');
    this.element = element;
    this.dwellMs = dwellMs;
    this.targetSelector = targetSelector;
    this.onSelect = onSelect;
    this.enabled = enabled;
    this.profile = getMotionProfile();
    this.x = 0.5;
    this.y = 0.5;
    this.hoverTarget = null;
    this.hoverStartedAt = 0;
    this.cooldownUntil = 0;
    this.visible = false;
    this.element.style.setProperty('--dwell', '0');
    this.render();
  }

  setProfile(profile) {
    this.profile = profile;
    this.x = 0.5;
    this.y = 0.5;
    this.resetHover();
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

  mapPoint(point) {
    const profile = this.profile ?? getMotionProfile();
    if (!profile) return null;
    return {
      x: clamp(0.5 + (point.x - profile.centerX) / profile.scaleX, 0.025, 0.975),
      y: clamp(0.5 + (point.y - profile.centerY) / profile.scaleY, 0.035, 0.965)
    };
  }

  updatePose(pose, now = performance.now()) {
    if (!this.enabled || !pose?.detected || !pose?.right?.visible) {
      this.hide();
      return;
    }

    const mapped = this.mapPoint(pose.right);
    if (!mapped) {
      this.hide();
      return;
    }

    // MotionEngine already supplies the profile-specific stabilized position.
    // The cursor only maps coordinates and renders; it must not add another filter.
    this.x = mapped.x;
    this.y = mapped.y;

    this.visible = true;
    this.element.classList.add('active');
    this.render();
    this.updateHover(now);
  }

  render() {
    this.element.style.transform = `translate3d(${this.x * innerWidth}px, ${this.y * innerHeight}px, 0) translate(-50%, -50%)`;
  }

  updateHover(now) {
    const element = document.elementFromPoint(this.x * innerWidth, this.y * innerHeight);
    const target = element?.closest?.(this.targetSelector) ?? null;

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

    if (typeof this.onSelect === 'function') {
      this.onSelect(selectedTarget);
    } else {
      selectedTarget.click();
    }
  }
}
