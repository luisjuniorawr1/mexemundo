const ROOM_KEY = 'mexemundo-room-v1';
const PROFILE_KEY = 'mexemundo-motion-profile-v2';

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

function shoulderCenter(sample) {
  return {
    x: (sample.leftShoulder.x + sample.rightShoulder.x) / 2,
    y: (sample.leftShoulder.y + sample.rightShoulder.y) / 2
  };
}

function viewportSize() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || innerHeight)
  };
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
      profile.version !== 2
      || profile.coordinateMode !== 'shoulder-relative'
      || !Number.isFinite(profile.centerX)
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

  const relative = valid.map((sample) => {
    const shoulders = shoulderCenter(sample);
    return {
      x: sample.right.x - shoulders.x,
      y: sample.right.y - shoulders.y
    };
  });
  const xs = relative.map((point) => point.x);
  const ys = relative.map((point) => point.y);
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
    coordinateMode: 'shoulder-relative',
    centerX,
    centerY,
    scaleX: clamp(shoulderWidth * 2.85, 0.30, 0.76),
    scaleY: clamp(shoulderWidth * 2.70, 0.30, 0.74),
    deadZone: clamp(jitter * 3.8, 0.0055, 0.022),
    jitter,
    createdAt: Date.now()
  });
}

export function calibratedDeadZone(fallback = 0.004) {
  const profile = getMotionProfile();
  return profile ? clamp(profile.deadZone, fallback, 0.022) : fallback;
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
    this.lastUpdateAt = 0;
    this.lastValidAt = 0;
    this.previousMapped = null;
    this.axisLock = null;
    this.axisLockUntil = 0;
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
    this.lastUpdateAt = 0;
    this.lastValidAt = 0;
    this.previousMapped = null;
    this.axisLock = null;
    this.axisLockUntil = 0;
    this.resetHover();
    this.render();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.hide();
  }

  hide() {
    this.visible = false;
    this.previousMapped = null;
    this.axisLock = null;
    this.element.classList.remove('active');
    this.resetHover();
  }

  resetHover() {
    this.hoverTarget?.classList.remove('motion-hover');
    this.hoverTarget = null;
    this.hoverStartedAt = 0;
    this.element.style.setProperty('--dwell', '0');
  }

  mapPose(pose) {
    const profile = this.profile ?? getMotionProfile();
    if (
      !profile
      || !pose?.right?.visible
      || !pose?.leftShoulder?.visible
      || !pose?.rightShoulder?.visible
    ) return null;

    const shoulders = shoulderCenter(pose);
    const relativeX = pose.right.x - shoulders.x;
    const relativeY = pose.right.y - shoulders.y;
    return {
      x: clamp(0.5 + (relativeX - profile.centerX) / profile.scaleX, 0.025, 0.975),
      y: clamp(0.5 + (relativeY - profile.centerY) / profile.scaleY, 0.035, 0.965)
    };
  }

  updatePose(pose, now = performance.now()) {
    if (!this.enabled) {
      this.hide();
      return;
    }

    const mapped = pose?.detected ? this.mapPose(pose) : null;
    if (!mapped) {
      if (this.visible && now - this.lastValidAt <= 180) {
        this.updateHover(now);
        return;
      }
      this.hide();
      return;
    }

    const dt = this.lastUpdateAt ? clamp((now - this.lastUpdateAt) / 1000, 1 / 120, 0.08) : 1 / 60;
    this.lastUpdateAt = now;
    this.lastValidAt = now;

    if (this.previousMapped) {
      const stepX = mapped.x - this.previousMapped.x;
      const stepY = mapped.y - this.previousMapped.y;
      const absX = Math.abs(stepX);
      const absY = Math.abs(stepY);
      const stepSpeed = Math.hypot(stepX, stepY) / dt;

      if (stepSpeed > 0.16) {
        if (absX > absY * 2.15) {
          this.axisLock = 'x';
          this.axisLockUntil = now + 115;
        } else if (absY > absX * 2.15) {
          this.axisLock = 'y';
          this.axisLockUntil = now + 115;
        } else if (now >= this.axisLockUntil) {
          this.axisLock = null;
        }
      } else if (now >= this.axisLockUntil) {
        this.axisLock = null;
      }
    }
    this.previousMapped = mapped;

    let dx = mapped.x - this.x;
    let dy = mapped.y - this.y;
    if (this.axisLock === 'x' && now < this.axisLockUntil) dy *= 0.16;
    if (this.axisLock === 'y' && now < this.axisLockUntil) dx *= 0.16;

    const distance = Math.hypot(dx, dy);
    const profileDeadZone = this.profile?.deadZone ?? 0.006;
    const profileScale = Math.max(0.20, Math.min(this.profile?.scaleX ?? 0.5, this.profile?.scaleY ?? 0.5));
    const screenDeadZone = clamp(profileDeadZone / profileScale, 0.008, 0.035);

    if (distance > screenDeadZone) {
      const speed = distance / dt;
      const alpha = clamp(0.34 + speed * 0.16, 0.34, 0.96);
      this.x += dx * alpha;
      this.y += dy * alpha;
    }

    this.visible = true;
    this.element.classList.add('active');
    this.render();
    this.updateHover(now);
  }

  render() {
    const viewport = viewportSize();
    this.element.style.transform = `translate3d(${this.x * viewport.width}px, ${this.y * viewport.height}px, 0) translate(-50%, -50%)`;
  }

  pointInsideTarget(target, x, y, margin = 38) {
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

    if (typeof this.onSelect === 'function') {
      this.onSelect(selectedTarget);
    } else {
      selectedTarget.click();
    }
  }
}
