const ROOM_KEY = 'mexemundo-room-v1';
const PROFILE_KEY = 'mexemundo-motion-profile-v3';

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

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, amount) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(amount) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const blend = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * blend;
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

function validHandProfile(hand) {
  return hand
    && Number.isFinite(hand.centerX)
    && Number.isFinite(hand.centerY)
    && Number.isFinite(hand.deadZone)
    && Number.isFinite(hand.jitter);
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
      profile.version !== 3
      || profile.coordinateMode !== 'dual-hand-shoulder-relative'
      || !Number.isFinite(profile.scaleX)
      || !Number.isFinite(profile.scaleY)
      || !Number.isFinite(profile.deadZone)
      || !validHandProfile(profile.hands?.left)
      || !validHandProfile(profile.hands?.right)
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

function buildHandProfile(relativePoints) {
  const xs = relativePoints.map((point) => point.x);
  const ys = relativePoints.map((point) => point.y);
  const centerX = median(xs);
  const centerY = median(ys);
  const distances = relativePoints.map((point) => Math.hypot(
    point.x - centerX,
    point.y - centerY
  ));
  const jitter = Math.hypot(
    standardDeviation(xs, centerX),
    standardDeviation(ys, centerY)
  );
  const restRadius = Math.max(jitter * 4.2, percentile(distances, 0.90) * 1.65);

  return {
    centerX,
    centerY,
    jitter,
    deadZone: clamp(restRadius, 0.0065, 0.028)
  };
}

export function buildMotionProfile(samples) {
  const valid = samples.filter((sample) => (
    sample?.left?.visible
    && sample?.right?.visible
    && sample?.leftShoulder?.visible
    && sample?.rightShoulder?.visible
  ));

  if (valid.length < 60) {
    throw new Error('Não houve amostras suficientes para calibrar as duas mãos.');
  }

  const leftPoints = [];
  const rightPoints = [];
  const widths = [];

  for (const sample of valid) {
    const shoulders = shoulderCenter(sample);
    leftPoints.push({
      x: sample.left.x - shoulders.x,
      y: sample.left.y - shoulders.y
    });
    rightPoints.push({
      x: sample.right.x - shoulders.x,
      y: sample.right.y - shoulders.y
    });
    widths.push(Math.abs(sample.leftShoulder.x - sample.rightShoulder.x));
  }

  const left = buildHandProfile(leftPoints);
  const right = buildHandProfile(rightPoints);
  const shoulderWidth = clamp(median(widths), 0.08, 0.35);

  return saveMotionProfile({
    version: 3,
    coordinateMode: 'dual-hand-shoulder-relative',
    hands: { left, right },
    scaleX: clamp(shoulderWidth * 3.0, 0.32, 0.80),
    scaleY: clamp(shoulderWidth * 2.9, 0.32, 0.78),
    deadZone: Math.max(left.deadZone, right.deadZone),
    jitter: Math.max(left.jitter, right.jitter),
    shoulderWidth,
    createdAt: Date.now()
  });
}

export function calibratedDeadZone(fallback = 0.004) {
  const profile = getMotionProfile();
  return profile ? clamp(profile.deadZone, fallback, 0.028) : fallback;
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
    this.bodyX = null;
    this.bodyY = null;
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
    this.bodyX = null;
    this.bodyY = null;
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
    const rightProfile = profile?.hands?.right;
    if (
      !profile
      || !rightProfile
      || !pose?.right?.visible
      || !pose?.leftShoulder?.visible
      || !pose?.rightShoulder?.visible
    ) return null;

    const shoulders = shoulderCenter(pose);
    if (this.bodyX === null || this.bodyY === null) {
      this.bodyX = shoulders.x;
      this.bodyY = shoulders.y;
    } else {
      const bodyDistance = Math.hypot(shoulders.x - this.bodyX, shoulders.y - this.bodyY);
      const bodyAlpha = bodyDistance > 0.045 ? 0.32 : bodyDistance > 0.012 ? 0.16 : 0.055;
      this.bodyX += (shoulders.x - this.bodyX) * bodyAlpha;
      this.bodyY += (shoulders.y - this.bodyY) * bodyAlpha;
    }

    const relativeX = pose.right.x - this.bodyX;
    const relativeY = pose.right.y - this.bodyY;
    return {
      x: clamp(0.5 + (relativeX - rightProfile.centerX) / profile.scaleX, 0.025, 0.975),
      y: clamp(0.5 + (relativeY - rightProfile.centerY) / profile.scaleY, 0.035, 0.965)
    };
  }

  updatePose(pose, now = performance.now()) {
    if (!this.enabled) {
      this.hide();
      return;
    }

    const mapped = pose?.detected ? this.mapPose(pose) : null;
    if (!mapped) {
      if (this.visible && now - this.lastValidAt <= 260) {
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

      if (stepSpeed > 0.14) {
        if (absX > absY * 1.9) {
          this.axisLock = 'x';
          this.axisLockUntil = now + 150;
        } else if (absY > absX * 1.9) {
          this.axisLock = 'y';
          this.axisLockUntil = now + 150;
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
    if (this.axisLock === 'x' && now < this.axisLockUntil) dy *= 0.08;
    if (this.axisLock === 'y' && now < this.axisLockUntil) dx *= 0.08;

    const distance = Math.hypot(dx, dy);
    const rightDeadZone = this.profile?.hands?.right?.deadZone ?? 0.008;
    const profileScale = Math.max(0.20, Math.min(this.profile?.scaleX ?? 0.5, this.profile?.scaleY ?? 0.5));
    const screenDeadZone = clamp(rightDeadZone / profileScale, 0.012, 0.050);

    if (distance > screenDeadZone) {
      const speed = distance / dt;
      const alpha = clamp(0.30 + speed * 0.15, 0.30, 0.94);
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

    if (typeof this.onSelect === 'function') {
      this.onSelect(selectedTarget);
    } else {
      selectedTarget.click();
    }
  }
}
