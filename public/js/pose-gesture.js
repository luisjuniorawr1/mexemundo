import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const GESTURE = HAND_SYSTEM_CONFIG.gesture;
const HAND_LANDMARKS = Object.freeze({
  left: Object.freeze({ wrist: 15, pinky: 17, index: 19, thumb: 21 }),
  right: Object.freeze({ wrist: 16, pinky: 18, index: 20, thumb: 22 })
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function pointVisible(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && (point.visibility ?? 0) >= GESTURE.minimumVisibility;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function maximumPairDistance(points) {
  let maximum = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      maximum = Math.max(maximum, distance(points[first], points[second]));
    }
  }
  return maximum;
}

function emptyGesture() {
  return {
    state: 'unknown',
    confidence: 0,
    openness: 0,
    reach: 0,
    reference: GESTURE.initialOpenReferenceRatio,
    visibleTips: 0
  };
}

class HandGestureState {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'unknown';
    this.candidate = 'unknown';
    this.candidateSince = 0;
    this.lastValidAt = 0;
    this.bootstrapStartedAt = null;
    this.bootstrapMaximum = 0;
    this.bootstrapped = false;
    this.openReference = GESTURE.initialOpenReferenceRatio;
    this.lastOutput = emptyGesture();
  }

  missing(now) {
    if (this.lastValidAt && now - this.lastValidAt <= GESTURE.unknownAfterMs) {
      return { ...this.lastOutput };
    }

    this.state = 'unknown';
    this.candidate = 'unknown';
    this.candidateSince = 0;
    this.lastOutput = {
      ...this.lastOutput,
      state: 'unknown',
      confidence: 0,
      visibleTips: 0
    };
    return { ...this.lastOutput };
  }

  bootstrap(reach, visibility, visibleTips, now) {
    if (this.bootstrapStartedAt === null) this.bootstrapStartedAt = now;
    this.bootstrapMaximum = Math.max(this.bootstrapMaximum, reach);
    this.openReference = clamp(
      Math.max(reach, this.bootstrapMaximum),
      GESTURE.minimumOpenReferenceRatio,
      GESTURE.maximumOpenReferenceRatio
    );

    // O primeiro estado válido é tratado como mão disponível/aberta. Isso
    // evita o bloqueio em que uma referência inicial alta classificava a mão
    // como punho antes que o usuário pudesse armar o clique.
    this.state = 'open';
    this.candidate = 'open';
    this.candidateSince = now;
    this.bootstrapped = now - this.bootstrapStartedAt >= GESTURE.bootstrapMs;

    this.lastOutput = {
      state: 'open',
      confidence: clamp(visibility * (this.bootstrapped ? 1 : 0.65)),
      openness: 1,
      reach,
      reference: this.openReference,
      visibleTips
    };
    return { ...this.lastOutput };
  }

  update(reach, visibility, visibleTips, now) {
    this.lastValidAt = now;
    if (!this.bootstrapped) {
      return this.bootstrap(reach, visibility, visibleTips, now);
    }

    if (reach > this.openReference) {
      this.openReference += (reach - this.openReference) * GESTURE.openReferenceRiseAlpha;
    } else if (this.state !== 'fist' && reach >= this.openReference * 0.82) {
      this.openReference += (reach - this.openReference) * GESTURE.openReferenceFallAlpha;
    }

    this.openReference = clamp(
      this.openReference,
      GESTURE.minimumOpenReferenceRatio,
      GESTURE.maximumOpenReferenceRatio
    );

    const fistEnter = Math.max(
      GESTURE.minimumFistRatio,
      this.openReference * GESTURE.fistEnterFraction
    );
    const fistExit = Math.max(
      fistEnter + GESTURE.minimumThresholdGap,
      this.openReference * GESTURE.fistExitFraction
    );

    const desired = this.state === 'fist'
      ? (reach >= fistExit ? 'open' : 'fist')
      : (reach <= fistEnter ? 'fist' : 'open');

    if (desired !== this.candidate) {
      this.candidate = desired;
      this.candidateSince = now;
    }

    const requiredMs = desired === 'fist'
      ? GESTURE.confirmationMs
      : GESTURE.releaseMs;

    if (desired !== this.state && now - this.candidateSince >= requiredMs) {
      this.state = desired;
    }

    const gap = Math.max(0.001, fistExit - fistEnter);
    const confidence = this.state === 'fist'
      ? clamp((fistExit - reach) / gap)
      : clamp((reach - fistEnter) / gap);

    this.lastOutput = {
      state: this.state,
      confidence: clamp((0.35 + confidence * 0.65) * visibility),
      openness: clamp(reach / Math.max(0.001, this.openReference), 0, 1.5),
      reach,
      reference: this.openReference,
      visibleTips
    };
    return { ...this.lastOutput };
  }
}

export class PoseFistGestureTracker {
  constructor() {
    this.hands = {
      left: new HandGestureState(),
      right: new HandGestureState()
    };
  }

  reset() {
    this.hands.left.reset();
    this.hands.right.reset();
  }

  missing(now = performance.now()) {
    return {
      left: this.hands.left.missing(now),
      right: this.hands.right.missing(now)
    };
  }

  update(pose, now = performance.now()) {
    const leftShoulder = pose?.[11];
    const rightShoulder = pose?.[12];
    if (!pointVisible(leftShoulder) || !pointVisible(rightShoulder)) {
      return this.missing(now);
    }

    const shoulderWidth = Math.max(0.06, distance(leftShoulder, rightShoulder));
    const result = {};

    for (const side of ['left', 'right']) {
      const ids = HAND_LANDMARKS[side];
      const wrist = pose?.[ids.wrist];
      const tips = [pose?.[ids.pinky], pose?.[ids.index], pose?.[ids.thumb]]
        .filter(pointVisible);

      if (!pointVisible(wrist) || tips.length < GESTURE.minimumVisibleTips) {
        result[side] = this.hands[side].missing(now);
        continue;
      }

      const normalizedReaches = tips.map((tip) => distance(wrist, tip) / shoulderWidth);
      const normalizedSpread = maximumPairDistance(tips) / shoulderWidth;
      const reach = median(normalizedReaches) + normalizedSpread * 0.12;
      const visibility = clamp(
        [wrist, ...tips].reduce(
          (sum, point) => sum + clamp(point.visibility ?? 0),
          0
        ) / (tips.length + 1)
      );

      result[side] = this.hands[side].update(
        reach,
        visibility,
        tips.length,
        now
      );
    }

    return result;
  }
}

export function createPoseFistGestureTracker() {
  return new PoseFistGestureTracker();
}
