/**
 * Shared causal motion pipeline for every MexeMundo surface.
 *
 * Tuning rules:
 * - `menu` favours a quiet cursor and requires more consistent motion evidence.
 * - `game` reacts within one accepted pose while retaining a calibrated rest radius.
 * - collision positions always follow the latest accepted measurement, independently
 *   from visual stabilization.
 *
 * All distances are expressed in normalized camera coordinates and all speeds in
 * normalized units per second. The engine never buffers a pose queue: `latest` and
 * `collisionTo` are single replaceable mailboxes.
 */

export const MOTION_POINT_NAMES = Object.freeze([
  'left',
  'right',
  'leftShoulder',
  'rightShoulder'
]);

const WRIST_NAMES = new Set(['left', 'right']);
const DEFAULT_POINT_POSITIONS = Object.freeze({
  left: Object.freeze({ x: 0.35, y: 0.55 }),
  right: Object.freeze({ x: 0.65, y: 0.55 }),
  leftShoulder: Object.freeze({ x: 0.44, y: 0.35 }),
  rightShoulder: Object.freeze({ x: 0.56, y: 0.35 })
});
const UINT16_RANGE = 0x10000;
const UINT16_HALF_RANGE = 0x8000;

export const MOTION_PROFILES = Object.freeze({
  menu: Object.freeze({
    jitterScale: 1.9,
    minRestRadius: 0.0038,
    maxRestRadius: 0.020,
    stepFraction: 0.34,
    consistentSamples: 2,
    confirmedSamples: 6,
    probeStepScale: 0.05,
    directionCosine: 0.20,
    startSpeed: 0.035,
    stopSpeed: 0.022,
    fastSpeed: 0.72,
    speedForFullResponse: 0.62,
    distanceForFullResponse: 0.040,
    movingAlpha: 0.52,
    onsetAlpha: 0.82,
    maxAlpha: 0.96,
    stopSamples: 3,
    anchorResponseScale: 0.72,
    collisionLeadMs: 8,
    maxPoseAgeMs: 240
  }),
  game: Object.freeze({
    jitterScale: 1.25,
    minRestRadius: 0.0022,
    maxRestRadius: 0.014,
    stepFraction: 0.28,
    consistentSamples: 2,
    confirmedSamples: 5,
    probeStepScale: 0.12,
    directionCosine: 0.05,
    startSpeed: 0.028,
    stopSpeed: 0.018,
    fastSpeed: 0.28,
    speedForFullResponse: 0.48,
    distanceForFullResponse: 0.026,
    movingAlpha: 0.64,
    onsetAlpha: 0.92,
    maxAlpha: 1,
    stopSamples: 3,
    anchorResponseScale: 0.68,
    collisionLeadMs: 10,
    maxPoseAgeMs: 240
  })
});

function defaultClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function compact(value) {
  return Math.round(value * 100000) / 100000;
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function forwardSequenceDelta(next, previous) {
  if (previous === null || !Number.isFinite(next)) return 1;
  return (next - previous + UINT16_RANGE) % UINT16_RANGE;
}

function isNewerSequence(next, previous) {
  const difference = forwardSequenceDelta(next, previous);
  return previous === null || (difference > 0 && difference < UINT16_HALF_RANGE);
}

function emptyPoint(x = 0.5, y = 0.5) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    displayVx: 0,
    displayVy: 0,
    displaySpeed: 0,
    visible: false
  };
}

export function createEmptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.35),
    rightShoulder: emptyPoint(0.56, 0.35),
    receivedAt: 0,
    sequence: 0,
    processingMs: 0,
    sourceIntervalMs: 0
  };
}

function copyPose(pose) {
  const output = { ...pose };
  for (const name of MOTION_POINT_NAMES) output[name] = { ...pose[name] };
  return output;
}

function hiddenPose(pose) {
  const output = copyPose(pose);
  output.detected = false;
  for (const name of MOTION_POINT_NAMES) output[name].visible = false;
  return output;
}

function normalizePoint(point, fallback) {
  return {
    x: clamp(finite(point?.x, fallback.x)),
    y: clamp(finite(point?.y, fallback.y)),
    vx: clamp(finite(point?.vx), -4, 4),
    vy: clamp(finite(point?.vy), -4, 4),
    visible: Boolean(point?.visible)
  };
}

function normalizePose(pose, receivedAt) {
  const normalized = createEmptyPose();
  for (const name of MOTION_POINT_NAMES) {
    normalized[name] = normalizePoint(pose?.[name], normalized[name]);
  }
  normalized.detected = Boolean(pose?.detected);
  normalized.receivedAt = receivedAt;
  normalized.sequence = finite(pose?.sequence) & 0xffff;
  normalized.processingMs = Math.max(0, finite(pose?.processingMs));
  normalized.sourceIntervalMs = Math.max(0, finite(pose?.sourceIntervalMs));
  normalized.captureAgeMs = Number.isFinite(pose?.captureAgeMs)
    ? Math.max(0, pose.captureAgeMs)
    : null;
  return normalized;
}

function createFilterState(point) {
  return {
    ready: false,
    x: point.x,
    y: point.y,
    restX: point.x,
    restY: point.y,
    lastRawX: point.x,
    lastRawY: point.y,
    lastRawDx: 0,
    lastRawDy: 0,
    displayVx: 0,
    displayVy: 0,
    moving: false,
    consistent: 0,
    quiet: 0,
    jitterReady: false,
    rawJitterCenterX: point.x,
    rawJitterCenterY: point.y,
    visualJitterCenterX: point.x,
    visualJitterCenterY: point.y,
    rawJitterSq: 0,
    visualJitterSq: 0
  };
}

/**
 * Phone-side source adapter. It preserves raw x/y (so calibration sees real
 * measurement noise), adds visibility hysteresis and derives a bounded velocity.
 */
export class MotionSource {
  constructor({
    clock = defaultClock,
    visibilityOn = 0.34,
    visibilityOff = 0.24,
    velocityResponse = 0.42
  } = {}) {
    this.clock = clock;
    this.visibilityOn = visibilityOn;
    this.visibilityOff = visibilityOff;
    this.velocityResponse = velocityResponse;
    this.states = new Map();
    this.lastFrameAt = 0;
    this.lastPresentedFrames = null;
    this.metrics = {
      framesObserved: 0,
      cameraFramesDropped: 0,
      poseFrequencyHz: 0,
      intervalMs: 0,
      processingMs: 0
    };
  }

  reset() {
    this.states.clear();
    this.lastFrameAt = 0;
  }

  noteVideoFrame(metadata = {}) {
    const presentedFrames = Number(metadata.presentedFrames);
    if (Number.isFinite(presentedFrames)) {
      if (this.lastPresentedFrames !== null) {
        this.metrics.cameraFramesDropped += Math.max(0, presentedFrames - this.lastPresentedFrames - 1);
      }
      this.lastPresentedFrames = presentedFrames;
    }
    this.metrics.framesObserved += 1;
  }

  process(points, timestampMs = this.clock(), { detected = true, processingMs = 0 } = {}) {
    const sourceIntervalMs = this.lastFrameAt ? Math.max(0, timestampMs - this.lastFrameAt) : 0;
    this.lastFrameAt = timestampMs;
    if (sourceIntervalMs > 0) {
      this.metrics.intervalMs = this.metrics.intervalMs
        ? this.metrics.intervalMs * 0.82 + sourceIntervalMs * 0.18
        : sourceIntervalMs;
      this.metrics.poseFrequencyHz = 1000 / this.metrics.intervalMs;
    }
    this.metrics.processingMs = processingMs;

    const output = {
      detected: Boolean(detected),
      processingMs,
      sourceIntervalMs
    };

    for (const name of MOTION_POINT_NAMES) {
      const fallback = DEFAULT_POINT_POSITIONS[name];
      const input = points?.[name];
      let state = this.states.get(name);
      if (!state) {
        state = {
          ready: false,
          x: fallback.x,
          y: fallback.y,
          vx: 0,
          vy: 0,
          visible: false,
          time: timestampMs
        };
        this.states.set(name, state);
      }

      const confidence = clamp(finite(input?.confidence, input?.visible ? 1 : 0));
      const visible = Boolean(detected && (
        state.visible ? confidence >= this.visibilityOff : confidence >= this.visibilityOn
      ));

      if (!visible || !Number.isFinite(input?.x) || !Number.isFinite(input?.y)) {
        state.visible = false;
        state.vx *= 0.45;
        state.vy *= 0.45;
        output[name] = {
          x: compact(state.x),
          y: compact(state.y),
          vx: 0,
          vy: 0,
          visible: false
        };
        continue;
      }

      const x = clamp(input.x);
      const y = clamp(input.y);
      const dt = clamp((timestampMs - state.time) / 1000, 1 / 120, 0.10);
      if (!state.ready || !state.visible) {
        state.ready = true;
        state.vx = 0;
        state.vy = 0;
      } else {
        const instantVx = clamp((x - state.x) / dt, -4, 4);
        const instantVy = clamp((y - state.y) / dt, -4, 4);
        const instantSpeed = Math.hypot(instantVx, instantVy);
        const alpha = clamp(this.velocityResponse + instantSpeed * 0.16, this.velocityResponse, 0.78);
        state.vx += (instantVx - state.vx) * alpha;
        state.vy += (instantVy - state.vy) * alpha;
      }

      state.x = x;
      state.y = y;
      state.time = timestampMs;
      state.visible = true;
      output[name] = {
        x: compact(x),
        y: compact(y),
        vx: compact(clamp(state.vx, -4, 4)),
        vy: compact(clamp(state.vy, -4, 4)),
        visible: true
      };
    }

    return output;
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

export class MotionEngine {
  constructor({
    profile = 'game',
    calibration = null,
    clock = defaultClock,
    dateClock = Date.now
  } = {}) {
    this.clock = clock;
    this.dateClock = dateClock;
    this.profileName = MOTION_PROFILES[profile] ? profile : 'game';
    this.calibration = calibration;
    this.states = new Map();
    this.latest = createEmptyPose();
    this.visual = createEmptyPose();
    this.collisionFrom = createEmptyPose();
    this.collisionTo = createEmptyPose();
    this.lastSequence = null;
    this.lastAcceptedAt = 0;
    this.lastDisplayAt = 0;
    this.replayActive = false;
    this.replayController = null;
    this.transport = {
      mode: 'relay',
      rtt: 0,
      sequenceGaps: 0,
      staleOrOutOfOrder: 0,
      outgoingCoalesced: 0,
      expired: 0,
      bufferedAmount: 0
    };
    this.metricState = {
      posesAccepted: 0,
      sequenceGaps: 0,
      staleOrOutOfOrder: 0,
      staleByAge: 0,
      intervalMs: 0,
      receivedDisplayedDistance: 0,
      receivedDisplayedMax: 0,
      rawJitterSq: 0,
      visualJitterSq: 0,
      latencyMs: 0
    };
    this.recorder = new PoseRecorder({ clock });
  }

  get profile() {
    return MOTION_PROFILES[this.profileName];
  }

  setProfile(profile) {
    if (!MOTION_PROFILES[profile]) throw new Error(`Perfil de movimento desconhecido: ${profile}`);
    this.profileName = profile;
  }

  setCalibration(calibration) {
    this.calibration = calibration;
  }

  setTransportMetrics(metrics = {}) {
    const normalized = {
      ...this.transport,
      ...Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value) || typeof value === 'string'))
    };
    if (Number.isFinite(metrics.coalesced)) normalized.outgoingCoalesced = metrics.coalesced;
    if (Number.isFinite(metrics.outOfOrderOrDuplicate)) {
      normalized.staleOrOutOfOrder = metrics.outOfOrderOrDuplicate;
    }
    this.transport = normalized;
  }

  reset({ preserveMetrics = false } = {}) {
    this.replayController?.stop();
    const profileName = this.profileName;
    const calibration = this.calibration;
    const transport = this.transport;
    const recorder = this.recorder;
    const clock = this.clock;
    const dateClock = this.dateClock;
    const metricState = this.metricState;
    Object.assign(this, new MotionEngine({ profile: profileName, calibration, clock, dateClock }));
    this.transport = transport;
    this.recorder = recorder;
    if (preserveMetrics) this.metricState = metricState;
  }

  ingest(pose, receivedAt = this.clock(), { ignoreSequence = false } = {}) {
    const sequenceValue = Number(pose?.sequence);
    const sequence = Number.isFinite(sequenceValue) ? sequenceValue & 0xffff : null;
    if (!ignoreSequence && sequence !== null && !isNewerSequence(sequence, this.lastSequence)) {
      this.metricState.staleOrOutOfOrder += 1;
      return false;
    }

    const captureAgeMs = Number(pose?.captureAgeMs);
    if (Number.isFinite(captureAgeMs) && captureAgeMs > this.profile.maxPoseAgeMs) {
      this.metricState.staleByAge += 1;
      return false;
    }

    if (!ignoreSequence && sequence !== null && this.lastSequence !== null) {
      const difference = forwardSequenceDelta(sequence, this.lastSequence);
      if (difference > 1 && difference < UINT16_HALF_RANGE) {
        this.metricState.sequenceGaps += difference - 1;
      }
    }

    const normalized = normalizePose(pose, receivedAt);
    const intervalMs = this.lastAcceptedAt ? Math.max(0, receivedAt - this.lastAcceptedAt) : 0;
    if (intervalMs > 0) {
      this.metricState.intervalMs = this.metricState.intervalMs
        ? this.metricState.intervalMs * 0.82 + intervalMs * 0.18
        : intervalMs;
    }
    const trajectoryExpired = !this.lastAcceptedAt
      || receivedAt - this.lastAcceptedAt > this.profile.maxPoseAgeMs;
    this.lastAcceptedAt = receivedAt;
    if (!ignoreSequence) this.lastSequence = sequence ?? this.lastSequence;
    this.metricState.posesAccepted += 1;
    this.latest = normalized;

    const visual = createEmptyPose();
    const collision = createEmptyPose();
    for (const name of MOTION_POINT_NAMES) {
      // Velocidade corporal usa a cadência da câmera. O intervalo de chegada pode
      // encolher em uma rajada da rede e não deve transformar ruído em gesto rápido.
      const motionIntervalMs = normalized.sourceIntervalMs || intervalMs || 1000 / 30;
      const result = this.#filterPoint(name, normalized[name], motionIntervalMs);
      visual[name] = result.visual;
      collision[name] = result.collision;
    }

    for (const output of [visual, collision]) {
      output.detected = normalized.detected;
      output.receivedAt = receivedAt;
      output.sequence = normalized.sequence;
      output.processingMs = normalized.processingMs;
      output.sourceIntervalMs = normalized.sourceIntervalMs;
    }

    this.visual = visual;
    if (trajectoryExpired) {
      this.collisionFrom = copyPose(collision);
    } else {
      // Reaparecer não cria um segmento desde a última coordenada invisível.
      for (const name of MOTION_POINT_NAMES) {
        if (collision[name].visible && !this.collisionTo[name].visible) {
          this.collisionFrom[name] = { ...collision[name] };
        }
      }
    }
    this.collisionTo = collision;
    this.#updateMetrics(normalized, visual);
    this.recorder.capture(pose, receivedAt);
    return true;
  }

  #restRadius(name) {
    const measuredJitter = Math.max(0, finite(this.calibration?.jitter));
    const measuredDeadZone = Math.max(0, finite(this.calibration?.deadZone));
    const measuredRadius = measuredJitter > 0
      ? measuredJitter * this.profile.jitterScale
      : measuredDeadZone > 0
        ? measuredDeadZone * 0.55
        : this.profile.minRestRadius;
    const pointScale = WRIST_NAMES.has(name) ? 1 : this.profile.anchorResponseScale;
    return clamp(
      measuredRadius * pointScale,
      this.profile.minRestRadius * pointScale,
      this.profile.maxRestRadius * pointScale
    );
  }

  #filterPoint(name, raw, intervalMs) {
    let state = this.states.get(name);
    if (!state) {
      state = createFilterState(raw);
      this.states.set(name, state);
    }

    if (!raw.visible) {
      state.moving = false;
      state.consistent = 0;
      state.quiet = 0;
      state.displayVx *= 0.35;
      state.displayVy *= 0.35;
      const point = {
        ...emptyPoint(state.x, state.y),
        displayVx: state.displayVx,
        displayVy: state.displayVy,
        displaySpeed: Math.hypot(state.displayVx, state.displayVy)
      };
      return { visual: point, collision: { ...point, vx: 0, vy: 0 } };
    }

    const dt = clamp(intervalMs / 1000, 1 / 120, 0.10);
    if (!state.ready) {
      state.ready = true;
      state.x = raw.x;
      state.y = raw.y;
      state.restX = raw.x;
      state.restY = raw.y;
      state.lastRawX = raw.x;
      state.lastRawY = raw.y;
      state.rawJitterCenterX = raw.x;
      state.rawJitterCenterY = raw.y;
      state.visualJitterCenterX = raw.x;
      state.visualJitterCenterY = raw.y;
    }

    const rawDx = raw.x - state.lastRawX;
    const rawDy = raw.y - state.lastRawY;
    const rawStep = Math.hypot(rawDx, rawDy);
    const previousStep = Math.hypot(state.lastRawDx, state.lastRawDy);
    const direction = rawStep > 0.000001 && previousStep > 0.000001
      ? (rawDx * state.lastRawDx + rawDy * state.lastRawDy) / (rawStep * previousStep)
      : -1;
    const sourceSpeed = Math.max(Math.hypot(raw.vx, raw.vy), rawStep / dt);
    const distance = Math.hypot(raw.x - state.x, raw.y - state.y);
    const restRadius = this.#restRadius(name);
    const meaningfulStep = rawStep >= restRadius * this.profile.stepFraction;
    state.consistent = meaningfulStep && direction >= this.profile.directionCosine
      ? state.consistent + 1
      : meaningfulStep
        ? 1
        : 0;

    const fastOnset = sourceSpeed >= this.profile.fastSpeed || distance >= this.profile.distanceForFullResponse;
    const slowOnset = sourceSpeed >= this.profile.startSpeed
      && state.consistent >= this.profile.consistentSamples;
    const confirmedOnset = sourceSpeed >= this.profile.startSpeed
      && state.consistent >= this.profile.confirmedSamples;
    const displacedOnset = distance > restRadius * 3.5
      || (distance > restRadius && state.consistent >= this.profile.confirmedSamples);
    const quietEvidence = state.consistent < this.profile.consistentSamples
      && distance <= restRadius * 1.35
      && rawStep <= restRadius * 2.75;
    state.quiet = quietEvidence ? state.quiet + 1 : 0;
    const wasMoving = state.moving;
    const stopping = wasMoving && state.quiet >= this.profile.stopSamples;
    const movingNow = !stopping && (wasMoving || fastOnset || confirmedOnset || displacedOnset);
    const probingOnset = !movingNow && slowOnset;

    if (!wasMoving && movingNow) {
      state.restX = state.x;
      state.restY = state.y;
    } else if (stopping) {
      const movedFromRest = Math.hypot(state.x - state.restX, state.y - state.restY);
      if (movedFromRest < restRadius) {
        state.x = state.restX;
        state.y = state.restY;
      } else {
        state.restX = state.x;
        state.restY = state.y;
      }
    } else if (!movingNow && !probingOnset) {
      const driftFromRest = Math.hypot(state.x - state.restX, state.y - state.restY);
      if (driftFromRest < restRadius) {
        state.x = state.restX;
        state.y = state.restY;
      } else {
        state.restX = state.x;
        state.restY = state.y;
      }
    }

    const previousX = state.x;
    const previousY = state.y;
    if ((movingNow && (!quietEvidence || fastOnset || displacedOnset)) || probingOnset) {
      const speedScore = clamp((sourceSpeed - this.profile.stopSpeed) /
        Math.max(0.0001, this.profile.speedForFullResponse - this.profile.stopSpeed));
      const distanceScore = clamp((distance - restRadius * 0.25) /
        Math.max(0.0001, this.profile.distanceForFullResponse - restRadius * 0.25));
      const response = Math.max(speedScore, distanceScore);
      let alpha = this.profile.movingAlpha
        + (this.profile.maxAlpha - this.profile.movingAlpha) * response;
      if (!wasMoving) alpha = Math.max(alpha, this.profile.onsetAlpha);
      if (fastOnset) alpha = this.profile.maxAlpha;
      let stepX = (raw.x - state.x) * alpha;
      let stepY = (raw.y - state.y) * alpha;
      const visualStep = Math.hypot(stepX, stepY);
      if (!wasMoving && !fastOnset && (probingOnset || distance < restRadius)) {
        const maxQuietOnsetStep = restRadius * (probingOnset ? this.profile.probeStepScale : 0.16);
        if (visualStep > maxQuietOnsetStep) {
          const scale = maxQuietOnsetStep / visualStep;
          stepX *= scale;
          stepY *= scale;
        }
      }
      state.x += stepX;
      state.y += stepY;
    }

    state.moving = movingNow;
    if (!state.moving && !probingOnset && distance <= restRadius) {
      state.x = previousX;
      state.y = previousY;
    }

    const visualVx = (state.x - previousX) / dt;
    const visualVy = (state.y - previousY) / dt;
    const displayVelocityAlpha = state.moving ? 0.44 : 0.24;
    state.displayVx += (visualVx - state.displayVx) * displayVelocityAlpha;
    state.displayVy += (visualVy - state.displayVy) * displayVelocityAlpha;
    if (!state.moving) {
      state.displayVx *= 0.55;
      state.displayVy *= 0.55;
    }

    state.lastRawX = raw.x;
    state.lastRawY = raw.y;
    state.lastRawDx = rawDx;
    state.lastRawDy = rawDy;

    const leadSeconds = WRIST_NAMES.has(name) && sourceSpeed >= this.profile.startSpeed
      ? this.profile.collisionLeadMs / 1000
      : 0;
    const visual = {
      x: compact(clamp(state.x)),
      y: compact(clamp(state.y)),
      vx: compact(clamp(state.displayVx, -4, 4)),
      vy: compact(clamp(state.displayVy, -4, 4)),
      displayVx: compact(clamp(state.displayVx, -4, 4)),
      displayVy: compact(clamp(state.displayVy, -4, 4)),
      displaySpeed: compact(clamp(Math.hypot(state.displayVx, state.displayVy), 0, 4)),
      visible: true
    };
    const collision = {
      x: compact(clamp(raw.x + raw.vx * leadSeconds)),
      y: compact(clamp(raw.y + raw.vy * leadSeconds)),
      vx: raw.vx,
      vy: raw.vy,
      displayVx: visual.displayVx,
      displayVy: visual.displayVy,
      displaySpeed: visual.displaySpeed,
      visible: true
    };
    return { visual, collision };
  }

  #updateMetrics(rawPose, visualPose) {
    let distance = 0;
    let rawJitterSq = 0;
    let visualJitterSq = 0;
    let measuredHands = 0;

    for (const name of ['left', 'right']) {
      const raw = rawPose[name];
      const visual = visualPose[name];
      const state = this.states.get(name);
      if (!raw.visible || !visual.visible || !state) continue;
      distance += Math.hypot(raw.x - visual.x, raw.y - visual.y);
      measuredHands += 1;

      const rawStep = Math.hypot(state.lastRawDx, state.lastRawDy);
      const restRadius = this.#restRadius(name);
      const jitterEligible = rawStep <= restRadius * 2.75
        && state.consistent < this.profile.consistentSamples;
      if (jitterEligible) {
        if (!state.jitterReady) {
          state.jitterReady = true;
          state.rawJitterCenterX = raw.x;
          state.rawJitterCenterY = raw.y;
          state.visualJitterCenterX = visual.x;
          state.visualJitterCenterY = visual.y;
          state.rawJitterSq = 0;
          state.visualJitterSq = 0;
        }
        state.rawJitterCenterX += (raw.x - state.rawJitterCenterX) * 0.045;
        state.rawJitterCenterY += (raw.y - state.rawJitterCenterY) * 0.045;
        state.visualJitterCenterX += (visual.x - state.visualJitterCenterX) * 0.045;
        state.visualJitterCenterY += (visual.y - state.visualJitterCenterY) * 0.045;
        const rawResidualSq = (raw.x - state.rawJitterCenterX) ** 2
          + (raw.y - state.rawJitterCenterY) ** 2;
        const visualResidualSq = (visual.x - state.visualJitterCenterX) ** 2
          + (visual.y - state.visualJitterCenterY) ** 2;
        state.rawJitterSq += (rawResidualSq - state.rawJitterSq) * 0.075;
        state.visualJitterSq += (visualResidualSq - state.visualJitterSq) * 0.075;
      } else if (state.moving) {
        // A próxima parada começa uma janela nova; não misture o deslocamento do
        // gesto com a dispersão estacionária ao redor do novo centro.
        state.jitterReady = false;
      }
      rawJitterSq += state.rawJitterSq;
      visualJitterSq += state.visualJitterSq;
    }

    if (measuredHands) {
      distance /= measuredHands;
      this.metricState.receivedDisplayedDistance +=
        (distance - this.metricState.receivedDisplayedDistance) * 0.10;
      this.metricState.receivedDisplayedMax = Math.max(this.metricState.receivedDisplayedMax, distance);
      this.metricState.rawJitterSq = rawJitterSq / measuredHands;
      this.metricState.visualJitterSq = visualJitterSq / measuredHands;
    }
  }

  sample(now = this.clock(), { consumeCollision = true } = {}) {
    const ageMs = this.latest.receivedAt ? Math.max(0, now - this.latest.receivedAt) : Infinity;
    const fresh = ageMs <= this.profile.maxPoseAgeMs;
    const visual = fresh ? copyPose(this.visual) : hiddenPose(this.visual);
    const collision = fresh ? copyPose(this.collisionTo) : hiddenPose(this.collisionTo);
    const collisionFrom = fresh ? copyPose(this.collisionFrom) : hiddenPose(this.collisionFrom);
    if (consumeCollision && fresh) this.collisionFrom = copyPose(this.collisionTo);
    this.lastDisplayAt = now;

    const fallbackLatency = this.latest.processingMs
      + Math.max(0, finite(this.transport.rtt)) / 2
      + (Number.isFinite(ageMs) ? ageMs : 0);
    const captureLatency = Number.isFinite(this.latest.captureAgeMs)
      ? this.latest.captureAgeMs + (Number.isFinite(ageMs) ? ageMs : 0)
      : null;
    this.metricState.latencyMs = captureLatency ?? fallbackLatency;

    return {
      visual,
      collision,
      collisionFrom,
      received: copyPose(this.latest),
      metrics: this.getMetrics(now)
    };
  }

  getMetrics(now = this.clock()) {
    const acceptedAgeMs = this.latest.receivedAt ? Math.max(0, now - this.latest.receivedAt) : 0;
    const transportGaps = Math.max(0, finite(this.transport.sequenceGaps));
    const transportStale = Math.max(0, finite(this.transport.staleOrOutOfOrder));
    const transportDropped = Math.max(0, finite(this.transport.dropped));
    return {
      profile: this.profileName,
      stationaryJitterRaw: Math.sqrt(Math.max(0, this.metricState.rawJitterSq)),
      stationaryJitterVisual: Math.sqrt(Math.max(0, this.metricState.visualJitterSq)),
      estimatedLatencyMs: this.metricState.latencyMs || (
        this.latest.processingMs + Math.max(0, finite(this.transport.rtt)) / 2 + acceptedAgeMs
      ),
      poseFrequencyHz: this.metricState.intervalMs ? 1000 / this.metricState.intervalMs : 0,
      sourcePoseFrequencyHz: this.latest.sourceIntervalMs ? 1000 / this.latest.sourceIntervalMs : 0,
      posesAccepted: this.metricState.posesAccepted,
      droppedFrames: Math.max(this.metricState.sequenceGaps, transportGaps, transportDropped),
      sequenceGaps: Math.max(this.metricState.sequenceGaps, transportGaps),
      staleOrOutOfOrder: this.metricState.staleOrOutOfOrder + transportStale,
      staleByAge: this.metricState.staleByAge,
      outgoingCoalesced: Math.max(0, finite(this.transport.outgoingCoalesced)),
      expired: Math.max(0, finite(this.transport.expired)),
      receivedDisplayedDistance: this.metricState.receivedDisplayedDistance,
      receivedDisplayedMax: this.metricState.receivedDisplayedMax,
      bufferedAmount: Math.max(0, finite(this.transport.bufferedAmount)),
      transportMode: this.transport.mode,
      transportRttMs: Math.max(0, finite(this.transport.rtt))
    };
  }

  startRecording() {
    this.recorder.start();
  }

  stopRecording() {
    return this.recorder.stop();
  }
}

export class PoseRecorder {
  constructor({ clock = defaultClock } = {}) {
    this.clock = clock;
    this.active = false;
    this.startedAt = 0;
    this.frames = [];
  }

  start(now = this.clock()) {
    this.active = true;
    this.startedAt = now;
    this.frames = [];
  }

  capture(pose, now = this.clock()) {
    if (!this.active) return;
    this.frames.push({
      tMs: Math.max(0, Math.round((now - this.startedAt) * 1000) / 1000),
      pose: clone(pose)
    });
  }

  stop() {
    this.active = false;
    return {
      schema: 'mexemundo.pose-sequence',
      version: 1,
      coordinateSpace: 'normalized-mirrored',
      frames: clone(this.frames)
    };
  }
}

export function validatePoseRecording(recording) {
  if (recording?.schema !== 'mexemundo.pose-sequence' || recording?.version !== 1) {
    throw new Error('Gravação de poses incompatível.');
  }
  if (!Array.isArray(recording.frames)) throw new Error('Gravação sem quadros.');
  let previousTime = -1;
  for (const frame of recording.frames) {
    if (!Number.isFinite(frame?.tMs) || frame.tMs < previousTime || !frame?.pose) {
      throw new Error('Quadros de replay inválidos ou fora de ordem.');
    }
    previousTime = frame.tMs;
  }
  return recording;
}

/** Synchronous deterministic replay used by tests and offline comparisons. */
export function replayPoseRecording(recording, onPose) {
  validatePoseRecording(recording);
  for (const frame of recording.frames) onPose(clone(frame.pose), frame.tMs);
}

/**
 * Real-time replay keeps only one timer and skips superseded frames if the event
 * loop falls behind, preserving the same latest-only semantics as live motion.
 */
export function playPoseRecording(recording, onPose, {
  speed = 1,
  clock = defaultClock,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onFinish = null
} = {}) {
  validatePoseRecording(recording);
  if (typeof onPose !== 'function') throw new Error('Replay precisa de um consumidor de poses.');
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('A velocidade do replay deve ser um número positivo.');
  }
  const frames = recording.frames;
  const startedAt = clock();
  let index = 0;
  let timer = null;
  let stopped = false;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimer(timer);
    if (typeof onFinish === 'function') onFinish();
  };

  const tick = () => {
    if (stopped) return;
    if (index >= frames.length) {
      finish();
      return;
    }
    const elapsed = (clock() - startedAt) * speed;
    let latestDue = index;
    while (latestDue + 1 < frames.length && frames[latestDue + 1].tMs <= elapsed) latestDue += 1;
    if (frames[latestDue].tMs <= elapsed) {
      onPose(clone(frames[latestDue].pose), frames[latestDue].tMs);
      index = latestDue + 1;
    }
    if (index >= frames.length) {
      finish();
      return;
    }
    const waitMs = Math.max(0, (frames[index].tMs - elapsed) / speed);
    timer = setTimer(tick, waitMs);
  };

  timer = setTimer(tick, (frames[0]?.tMs ?? 0) / speed);
  return {
    stop() {
      finish();
    }
  };
}

export function installMotionDebug(engine, {
  globalName = 'mexeMundoMotion',
  onReplayPose = (pose) => engine.ingest(pose, undefined, { ignoreSequence: true }),
  sourceMetrics = null
} = {}) {
  let activePlayback = null;
  const api = {
    metrics: () => ({
      ...engine.getMetrics(),
      ...(typeof sourceMetrics === 'function' ? { source: sourceMetrics() } : {})
    }),
    startRecording: () => engine.startRecording(),
    stopRecording: () => engine.stopRecording(),
    play(recording, options = {}) {
      activePlayback?.stop();
      if (options.reset !== false) engine.reset();
      validatePoseRecording(recording);
      if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0)) {
        throw new Error('A velocidade do replay deve ser um número positivo.');
      }
      engine.replayActive = true;
      const finish = () => {
        engine.replayActive = false;
        engine.replayController = null;
        activePlayback = null;
        if (typeof options.onFinish === 'function') options.onFinish();
      };
      let playback;
      try {
        playback = playPoseRecording(recording, onReplayPose, {
          ...options,
          onFinish: finish
        });
      } catch (error) {
        engine.replayActive = false;
        throw error;
      }
      activePlayback = {
        stop: () => playback.stop()
      };
      engine.replayController = activePlayback;
      return activePlayback;
    },
    download(recording, filename = `mexemundo-poses-${Date.now()}.json`) {
      if (!globalThis.document || !globalThis.URL || !globalThis.Blob) {
        throw new Error('Download disponível somente no navegador.');
      }
      const blob = new Blob([JSON.stringify(validatePoseRecording(recording), null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };
  globalThis[globalName] = api;
  return api;
}
