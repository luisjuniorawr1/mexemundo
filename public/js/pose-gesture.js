import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const GESTURE = HAND_SYSTEM_CONFIG.gesture;
const HAND_LANDMARKS = Object.freeze({
  left: Object.freeze({
    wrist: 15,
    pinky: 17,
    index: 19,
    thumb: 21
  }),
  right: Object.freeze({
    wrist: 16,
    pinky: 18,
    index: 20,
    thumb: 22
  })
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

function emptyGesture() {
  return {
    state: 'unknown',
    confidence: 0,
    openness: 0,
    reach: 0,
    reference: GESTURE.initialOpenReferenceRatio
  };
}

class HandGestureState {
  constructor() {
    this.state = 'unknown';
    this.candidate = 'unknown';
    this.candidateSince = 0;
    this.lastValidAt = 0;
    this.openReference = GESTURE.initialOpenReferenceRatio;
    this.lastOutput = emptyGesture();
  }

  reset() {
    this.state = 'unknown';
    this.candidate = 'unknown';
    this.candidateSince = 0;
    this.lastValidAt = 0;
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
      confidence: 0
    };
    return { ...this.lastOutput };
  }

  update(reach, visibility, now) {
    this.lastValidAt = now;

    if (reach > this.openReference) {
      this.openReference += (reach - this.openReference) * GESTURE.openReferenceRiseAlpha;
    } else if (this.state === 'open' && reach > this.openReference * 0.78) {
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

    const boundary = this.state === 'fist' ? fistExit : fistEnter;
    const gap = Math.max(0.01, fistExit - fistEnter);
    const confidence = this.state === 'fist'
      ? clamp((boundary - reach) / gap + 0.5)
      : clamp((reach - boundary) / gap + 0.5);

    this.lastOutput = {
      state: this.state,
      confidence: clamp(confidence * visibility),
      openness: clamp(reach / Math.max(0.001, this.openReference), 0, 1.5),
      reach,
      reference: this.openReference
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
      const tips = [pose?.[ids.pinky], pose?.[ids.index], pose?.[ids.thumb]];
      if (!pointVisible(wrist) || !tips.every(pointVisible)) {
        result[side] = this.hands[side].missing(now);
        continue;
      }

      const meanReach = tips.reduce(
        (sum, tip) => sum + distance(wrist, tip),
        0
      ) / tips.length;
      const visibility = clamp(
        [wrist, ...tips].reduce(
          (sum, point) => sum + clamp(point.visibility ?? 0),
          0
        ) / 4
      );
      result[side] = this.hands[side].update(
        meanReach / shoulderWidth,
        visibility,
        now
      );
    }

    return result;
  }
}

export function createPoseFistGestureTracker() {
  return new PoseFistGestureTracker();
}
