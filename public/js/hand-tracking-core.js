const PALM_INDICES = [0, 5, 9, 13, 17];
const TIP_INDICES = [4, 8, 12, 16, 20];
const MCP_INDICES = [2, 5, 9, 13, 17];

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

  reset() {
    this.ready = false;
    this.value = 0;
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
  constructor({ minCutoff = 1.25, beta = 0.12, derivativeCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.valueFilter = new LowPass();
    this.derivativeFilter = new LowPass();
    this.lastRaw = null;
  }

  reset() {
    this.valueFilter.reset();
    this.derivativeFilter.reset();
    this.lastRaw = null;
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

function palmGeometry(landmarks, mirrorX) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
  const palmPoints = PALM_INDICES.map((index) => landmarks[index]).filter(Boolean);
  if (palmPoints.length !== PALM_INDICES.length) return null;

  const center = {
    x: mean(palmPoints.map((point) => mirrorX ? 1 - point.x : point.x)),
    y: mean(palmPoints.map((point) => point.y))
  };
  const point = (index) => {
    const source = landmarks[index];
    return source ? { x: mirrorX ? 1 - source.x : source.x, y: source.y } : null;
  };
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
      x: mirrorX ? 1 - landmark.x : landmark.x,
      y: landmark.y,
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
  constructor(id) {
    this.id = id;
    this.xFilter = new OneEuroAxis();
    this.yFilter = new OneEuroAxis();
    this.reset();
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
  }

  assignmentCost(detection, slotIndex) {
    let cost = 0;
    if (this.raw) {
      cost += distance(this.raw, detection.center) * 12;
    } else {
      cost += slotIndex === 0 ? detection.center.x : 1 - detection.center.x;
    }
    if (
      this.handedness
      && detection.handedness
      && this.handedness !== detection.handedness
      && Math.min(this.handednessScore, detection.handednessScore) > 0.65
    ) {
      cost += 0.55;
    }
    return cost;
  }

  update(detection, timestampMs) {
    const now = Number(timestampMs);
    const dt = this.lastUpdateAt
      ? clamp((now - this.lastUpdateAt) / 1000, 1 / 120, 0.12)
      : 1 / 60;
    this.lastUpdateAt = now;
    this.lastSeenAt = now;
    this.missingSince = 0;

    const previousRaw = this.raw ?? detection.center;
    const rawVelocity = {
      x: (detection.center.x - previousRaw.x) / dt,
      y: (detection.center.y - previousRaw.y) / dt
    };
    const velocityAlpha = 1 - Math.exp(-dt / 0.045);
    this.velocity.x += (rawVelocity.x - this.velocity.x) * velocityAlpha;
    this.velocity.y += (rawVelocity.y - this.velocity.y) * velocityAlpha;

    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const residual = this.raw ? distance(this.raw, detection.center) : 0;
    const restingSpeed = detection.scale * 2.4;
    if (speed < restingSpeed) {
      const noiseAlpha = 1 - Math.exp(-dt / 0.55);
      this.noise += (residual - this.noise) * noiseAlpha;
    }

    this.raw = { ...detection.center };
    this.scale += (detection.scale - this.scale) * (1 - Math.exp(-dt / 0.18));
    this.handedness = detection.handedness ?? this.handedness;
    this.handednessScore = Math.max(detection.handednessScore, this.handednessScore * 0.96);
    this.openness = detection.openness;
    this.landmarks = detection.landmarks;

    const filtered = {
      x: this.xFilter.update(detection.center.x, dt),
      y: this.yFilter.update(detection.center.y, dt)
    };

    if (!this.ready || !this.visual) {
      this.visual = { ...filtered };
      this.ready = true;
    } else {
      const restRadius = clamp(
        Math.max(this.noise * 2.8, this.scale * 0.012),
        0.0012,
        0.012
      );
      const visualDistance = distance(this.visual, filtered);
      const resting = speed < restingSpeed && visualDistance < restRadius;
      if (!resting) this.visual = filtered;
    }

    const predictionSeconds = speed > restingSpeed ? Math.min(0.018, dt * 0.65) : 0;
    this.collision = {
      x: clamp(detection.center.x + this.velocity.x * predictionSeconds),
      y: clamp(detection.center.y + this.velocity.y * predictionSeconds)
    };

    return this.snapshot(now);
  }

  markMissing(timestampMs) {
    const now = Number(timestampMs);
    if (!this.missingSince) this.missingSince = now;
    return this.snapshot(now);
  }

  snapshot(timestampMs) {
    const ageMs = this.lastSeenAt ? Math.max(0, Number(timestampMs) - this.lastSeenAt) : Infinity;
    return {
      id: this.id,
      visible: this.ready && ageMs <= 160,
      ageMs,
      raw: this.raw ? { ...this.raw } : null,
      visual: this.visual ? { ...this.visual } : null,
      collision: this.collision ? { ...this.collision } : null,
      velocity: { ...this.velocity },
      scale: this.scale,
      noise: this.noise,
      handedness: this.handedness,
      handednessScore: this.handednessScore,
      openness: this.openness,
      landmarks: this.landmarks
    };
  }
}

function assignDetections(tracks, detections) {
  if (!detections.length) return [null, null];
  if (detections.length === 1) {
    const detection = detections[0];
    const firstCost = tracks[0].assignmentCost(detection, 0);
    const secondCost = tracks[1].assignmentCost(detection, 1);
    return firstCost <= secondCost ? [detection, null] : [null, detection];
  }

  const first = detections[0];
  const second = detections[1];
  const directCost = tracks[0].assignmentCost(first, 0) + tracks[1].assignmentCost(second, 1);
  const swappedCost = tracks[0].assignmentCost(second, 0) + tracks[1].assignmentCost(first, 1);
  return directCost <= swappedCost ? [first, second] : [second, first];
}

export class HandTrackingCore {
  constructor({ mirrorX = true } = {}) {
    this.mirrorX = mirrorX;
    this.tracks = [new AdaptiveHandTrack('hand-a'), new AdaptiveHandTrack('hand-b')];
    this.lastTimestampMs = 0;
  }

  reset() {
    for (const track of this.tracks) track.reset();
    this.lastTimestampMs = 0;
  }

  ingest(result, timestampMs = performance.now()) {
    const timestamp = Math.max(this.lastTimestampMs + 0.001, Number(timestampMs));
    this.lastTimestampMs = timestamp;
    const detections = extractDetections(result, this.mirrorX);
    const assignments = assignDetections(this.tracks, detections.slice(0, 2));
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
