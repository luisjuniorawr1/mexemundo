const PALM_INDICES = [0, 5, 9, 13, 17];
const PALM_WEIGHTS = [0.14, 0.20, 0.32, 0.20, 0.14];
const TIP_INDICES = [4, 8, 12, 16, 20];
const MCP_INDICES = [2, 5, 9, 13, 17];
const MAX_MISSING_MS = 180;
const REACQUIRE_RESET_MS = 260;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function smoothingAlpha(cutoff, dt) {
  const safeCutoff = Math.max(0.001, cutoff);
  const tau = 1 / (2 * Math.PI * safeCutoff);
  return 1 / (1 + tau / Math.max(1 / 240, dt));
}

class LowPass {
  constructor() {
    this.ready = false;
    this.value = 0;
  }

  reset(value = 0) {
    this.ready = false;
    this.value = value;
  }

  update(value, alpha) {
    if (!this.ready) {
      this.ready = true;
      this.value = value;
      return value;
    }
    this.value += (value - this.value) * alpha;
    return this.value;
  }
}

class OneEuroAxis {
  constructor({ minCutoff = 1.15, beta = 0.16, derivativeCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.valueFilter = new LowPass();
    this.derivativeFilter = new LowPass();
    this.lastRaw = null;
  }

  configure({ minCutoff, beta, derivativeCutoff } = {}) {
    if (Number.isFinite(minCutoff)) this.minCutoff = clamp(minCutoff, 0.55, 4);
    if (Number.isFinite(beta)) this.beta = clamp(beta, 0, 1);
    if (Number.isFinite(derivativeCutoff)) this.derivativeCutoff = clamp(derivativeCutoff, 0.2, 8);
  }

  reset(value = null) {
    this.valueFilter.reset(Number(value ?? 0));
    this.derivativeFilter.reset(0);
    this.lastRaw = Number.isFinite(value) ? Number(value) : null;
    if (Number.isFinite(value)) this.valueFilter.ready = true;
  }

  update(value, dt) {
    const derivative = this.lastRaw === null ? 0 : (value - this.lastRaw) / Math.max(1 / 240, dt);
    this.lastRaw = value;
    const filteredDerivative = this.derivativeFilter.update(
      derivative,
      smoothingAlpha(this.derivativeCutoff, dt)
    );
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    return this.valueFilter.update(value, smoothingAlpha(cutoff, dt));
  }
}

function bestCategory(categories) {
  if (!Array.isArray(categories) || !categories.length) return null;
  return [...categories].sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))[0] ?? null;
}

function readHandedness(result, index) {
  const groups = result?.handednesses ?? result?.handedness ?? [];
  const category = bestCategory(groups[index]);
  const name = String(category?.categoryName ?? category?.displayName ?? '').trim().toLowerCase();
  return {
    label: name === 'left' || name === 'right' ? name : null,
    score: clamp(Number(category?.score ?? 0), 0, 1)
  };
}

function weightedPalmCenter(points) {
  let x = 0;
  let y = 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const weight = PALM_WEIGHTS[index] ?? 1;
    x += point.x * weight;
    y += point.y * weight;
    total += weight;
  }
  return { x: x / total, y: y / total };
}

function palmGeometry(landmarks, mirrorX) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;

  const point = (index) => {
    const source = landmarks[index];
    return source ? {
      x: mirrorX ? 1 - Number(source.x ?? 0) : Number(source.x ?? 0),
      y: Number(source.y ?? 0),
      z: Number(source.z ?? 0)
    } : null;
  };

  const palmPoints = PALM_INDICES.map(point).filter(Boolean);
  if (palmPoints.length !== PALM_INDICES.length) return null;

  const center = weightedPalmCenter(palmPoints);
  const palmWidth = distance(point(5), point(17));
  const palmHeight = distance(point(0), point(9));
  const scale = clamp((palmWidth + palmHeight) / 2, 0.025, 0.32);

  const extensionRatios = TIP_INDICES.map((tipIndex, index) => {
    const tip = point(tipIndex);
    const mcp = point(MCP_INDICES[index]);
    const wrist = point(0);
    if (!tip || !mcp || !wrist) return 1;
    return distance(tip, wrist) / Math.max(0.0001, distance(mcp, wrist));
  });

  return {
    center,
    scale,
    openness: clamp((mean(extensionRatios) - 0.85) / 1.05),
    landmarks: landmarks.map((landmark) => ({
      x: mirrorX ? 1 - Number(landmark.x ?? 0) : Number(landmark.x ?? 0),
      y: Number(landmark.y ?? 0),
      z: Number(landmark.z ?? 0)
    }))
  };
}

function extractDetections(result, mirrorX) {
  const landmarks = result?.landmarks ?? result?.handLandmarks ?? [];
  const detections = [];
  for (let index = 0; index < landmarks.length; index += 1) {
    const geometry = palmGeometry(landmarks[index], mirrorX);
    if (!geometry) continue;
    const handedness = readHandedness(result, index);
    detections.push({
      ...geometry,
      handedness: handedness.label,
      handednessScore: handedness.score,
      sourceIndex: index
    });
  }
  return detections;
}

class AdaptiveHandTrack {
  constructor(id, preferredHandedness = null) {
    this.id = id;
    this.preferredHandedness = preferredHandedness;
    this.xFilter = new OneEuroAxis();
    this.yFilter = new OneEuroAxis();
    this.calibration = null;
    this.reset();
  }

  applyCalibration(profile) {
    this.calibration = profile && typeof profile === 'object' ? profile : null;
    const settings = {
      minCutoff: this.calibration?.minCutoff ?? 1.15,
      beta: this.calibration?.beta ?? 0.16,
      derivativeCutoff: this.calibration?.derivativeCutoff ?? 1.0
    };
    this.xFilter.configure(settings);
    this.yFilter.configure(settings);
  }

  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
    this.ready = false;
    this.raw = null;
    this.visual = null;
    this.collision = null;
    this.velocity = { x: 0, y: 0 };
    this.scale = 0.08;
    this.noise = 0.0015;
    this.handedness = null;
    this.handednessScore = 0;
    this.openness = 0;
    this.landmarks = [];
    this.lastSeenAt = 0;
    this.lastUpdateAt = 0;
    this.missingSince = 0;
    this.reacquisitions = 0;
  }

  predictedPosition(timestampMs) {
    if (!this.raw || !this.lastSeenAt) return this.raw;
    const ageSeconds = clamp((Number(timestampMs) - this.lastSeenAt) / 1000, 0, 0.12);
    return {
      x: clamp(this.raw.x + this.velocity.x * ageSeconds),
      y: clamp(this.raw.y + this.velocity.y * ageSeconds)
    };
  }

  assignmentCost(detection, timestampMs, slotIndex) {
    const predicted = this.predictedPosition(timestampMs);
    const referenceScale = Math.max(0.035, this.scale, detection.scale);
    let cost = 0;

    if (predicted) {
      const normalizedDistance = distance(predicted, detection.center) / referenceScale;
      cost += normalizedDistance;
      if (normalizedDistance > 6.5) cost += 8;
    } else {
      cost += slotIndex === 0 ? detection.center.x : 1 - detection.center.x;
    }

    const scaleRatio = Math.max(this.scale, detection.scale) / Math.max(0.001, Math.min(this.scale, detection.scale));
    cost += Math.abs(Math.log(scaleRatio)) * 0.35;

    const expected = this.handedness ?? this.preferredHandedness;
    if (expected && detection.handedness) {
      const confidence = Math.min(this.handednessScore || 0.72, detection.handednessScore || 0.72);
      if (expected !== detection.handedness && confidence > 0.58) cost += 3.2 * confidence;
      if (expected === detection.handedness) cost -= 0.45 * confidence;
    }

    return cost;
  }

  hardResetToDetection(detection, now) {
    this.xFilter.reset(detection.center.x);
    this.yFilter.reset(detection.center.y);
    this.raw = { ...detection.center };
    this.visual = { ...detection.center };
    this.collision = { ...detection.center };
    this.velocity = { x: 0, y: 0 };
    this.scale = detection.scale;
    this.noise = Math.max(0.001, detection.scale * 0.008);
    this.ready = true;
    this.lastSeenAt = now;
    this.lastUpdateAt = now;
    this.missingSince = 0;
    this.reacquisitions += 1;
  }

  update(detection, timestampMs) {
    const now = Number(timestampMs);
    const previousSeenAt = this.lastSeenAt;
    const missingAge = previousSeenAt ? now - previousSeenAt : Infinity;
    const dt = this.lastUpdateAt ? clamp((now - this.lastUpdateAt) / 1000, 1 / 120, 0.12) : 1 / 60;

    if (!this.ready || missingAge > REACQUIRE_RESET_MS) {
      this.hardResetToDetection(detection, now);
    } else {
      this.lastUpdateAt = now;
      this.lastSeenAt = now;
      this.missingSince = 0;

      const previousRaw = this.raw ?? detection.center;
      const rawVelocity = {
        x: (detection.center.x - previousRaw.x) / dt,
        y: (detection.center.y - previousRaw.y) / dt
      };
      const velocityAlpha = 1 - Math.exp(-dt / 0.05);
      this.velocity.x += (rawVelocity.x - this.velocity.x) * velocityAlpha;
      this.velocity.y += (rawVelocity.y - this.velocity.y) * velocityAlpha;

      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      const residual = this.raw ? distance(this.raw, detection.center) : 0;
      const restingSpeed = Math.max(0.035, detection.scale) * 2.2;
      if (speed < restingSpeed) {
        const noiseAlpha = 1 - Math.exp(-dt / 0.65);
        this.noise += (residual - this.noise) * noiseAlpha;
      }

      this.raw = { ...detection.center };
      this.scale += (detection.scale - this.scale) * (1 - Math.exp(-dt / 0.2));

      const filtered = {
        x: this.xFilter.update(detection.center.x, dt),
        y: this.yFilter.update(detection.center.y, dt)
      };

      if (!this.visual) {
        this.visual = { ...filtered };
      } else {
        const calibratedRestRadius = Number(this.calibration?.restRadius ?? 0);
        const restRadius = clamp(
          Math.max(this.noise * 2.6, this.scale * 0.010, calibratedRestRadius),
          0.0010,
          0.016
        );
        const visualDistance = distance(this.visual, filtered);
        const resting = speed < restingSpeed && visualDistance < restRadius * 1.35;

        if (resting) {
          const driftAlpha = 1 - Math.exp(-dt / 0.55);
          this.visual.x += (filtered.x - this.visual.x) * driftAlpha;
          this.visual.y += (filtered.y - this.visual.y) * driftAlpha;
        } else {
          const release = clamp((visualDistance - restRadius * 0.30) / Math.max(0.001, restRadius * 1.7));
          const response = 0.58 + release * 0.42;
          this.visual.x += (filtered.x - this.visual.x) * response;
          this.visual.y += (filtered.y - this.visual.y) * response;
        }
      }

      const predictionSeconds = speed > restingSpeed ? Math.min(0.016, dt * 0.65) : 0;
      const maxLead = Math.max(0.008, this.scale * 0.45);
      const leadX = clamp(this.velocity.x * predictionSeconds, -maxLead, maxLead);
      const leadY = clamp(this.velocity.y * predictionSeconds, -maxLead, maxLead);
      this.collision = {
        x: clamp(detection.center.x + leadX),
        y: clamp(detection.center.y + leadY)
      };
    }

    this.handedness = detection.handedness ?? this.handedness ?? this.preferredHandedness;
    this.handednessScore = Math.max(detection.handednessScore, this.handednessScore * 0.97);
    this.openness = detection.openness;
    this.landmarks = detection.landmarks;
    return this.snapshot(now);
  }

  markMissing(timestampMs) {
    const now = Number(timestampMs);
    if (!this.missingSince) this.missingSince = now;
    return this.snapshot(now);
  }

  snapshot(timestampMs) {
    const ageMs = this.lastSeenAt ? Math.max(0, Number(timestampMs) - this.lastSeenAt) : Infinity;
    const predicted = this.predictedPosition(timestampMs);
    return {
      id: this.id,
      visible: this.ready && ageMs <= MAX_MISSING_MS,
      ageMs,
      raw: this.raw ? { ...this.raw } : null,
      visual: this.visual ? { ...this.visual } : null,
      collision: this.collision ? { ...this.collision } : null,
      predicted: predicted ? { ...predicted } : null,
      velocity: { ...this.velocity },
      scale: this.scale,
      noise: this.noise,
      handedness: this.handedness,
      handednessScore: this.handednessScore,
      openness: this.openness,
      landmarks: this.landmarks,
      reacquisitions: this.reacquisitions
    };
  }
}

function assignDetections(tracks, detections, timestampMs) {
  if (!detections.length) return [null, null];

  if (detections.length === 1) {
    const detection = detections[0];
    const firstCost = tracks[0].assignmentCost(detection, timestampMs, 0);
    const secondCost = tracks[1].assignmentCost(detection, timestampMs, 1);
    const bestCost = Math.min(firstCost, secondCost);
    if (bestCost > 11) return [null, null];
    return firstCost <= secondCost ? [detection, null] : [null, detection];
  }

  const first = detections[0];
  const second = detections[1];
  const directCost = tracks[0].assignmentCost(first, timestampMs, 0)
    + tracks[1].assignmentCost(second, timestampMs, 1);
  const swappedCost = tracks[0].assignmentCost(second, timestampMs, 0)
    + tracks[1].assignmentCost(first, timestampMs, 1);

  return directCost <= swappedCost ? [first, second] : [second, first];
}

export class HandTrackingCore {
  constructor({ mirrorX = true, calibration = null } = {}) {
    this.mirrorX = mirrorX;
    this.tracks = [
      new AdaptiveHandTrack('left-track', 'right'),
      new AdaptiveHandTrack('right-track', 'left')
    ];
    this.lastTimestampMs = 0;
    this.calibration = null;
    if (calibration) this.applyCalibration(calibration);
  }

  applyCalibration(profile) {
    this.calibration = profile && typeof profile === 'object' ? profile : null;
    const handProfiles = Array.isArray(this.calibration?.hands) ? this.calibration.hands : [];
    this.tracks.forEach((track, index) => track.applyCalibration(handProfiles[index] ?? null));
  }

  reset() {
    for (const track of this.tracks) track.reset();
    this.lastTimestampMs = 0;
    if (this.calibration) this.applyCalibration(this.calibration);
  }

  ingest(result, timestampMs = performance.now()) {
    const requestedTimestamp = Number(timestampMs);
    const timestamp = Math.max(this.lastTimestampMs + 0.001, Number.isFinite(requestedTimestamp) ? requestedTimestamp : 0);
    this.lastTimestampMs = timestamp;
    const detections = extractDetections(result, this.mirrorX).slice(0, 2);
    const assignments = assignDetections(this.tracks, detections, timestamp);
    const hands = this.tracks.map((track, index) => (
      assignments[index] ? track.update(assignments[index], timestamp) : track.markMissing(timestamp)
    ));

    return {
      timestampMs: timestamp,
      hands,
      detectionCount: detections.length
    };
  }

  sample(timestampMs = performance.now()) {
    return {
      timestampMs: Number(timestampMs),
      hands: this.tracks.map((track) => track.snapshot(timestampMs))
    };
  }
}
