import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const CONFIG = HAND_SYSTEM_CONFIG.handAnchor;
const SCHEDULER = HAND_SYSTEM_CONFIG.scheduler;
const PALM_INDICES = Object.freeze([0, 5, 9, 13, 17]);
const PALM_WEIGHTS = Object.freeze([0.14, 0.20, 0.32, 0.20, 0.14]);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function distance(first, second) {
  return Math.hypot(
    Number(first?.x ?? 0) - Number(second?.x ?? 0),
    Number(first?.y ?? 0) - Number(second?.y ?? 0)
  );
}

function bestCategory(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  return [...categories].sort(
    (first, second) => Number(second?.score ?? 0) - Number(first?.score ?? 0)
  )[0] ?? null;
}

function readHandedness(result, index) {
  const groups = result?.handednesses ?? result?.handedness ?? [];
  const category = bestCategory(groups[index]);
  const label = String(
    category?.categoryName ?? category?.displayName ?? ''
  ).trim().toLowerCase();
  return {
    label: label === 'left' || label === 'right' ? label : null,
    score: clamp(Number(category?.score ?? 0))
  };
}

function palmGeometry(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null;

  let x = 0;
  let y = 0;
  let totalWeight = 0;
  for (let index = 0; index < PALM_INDICES.length; index += 1) {
    const source = landmarks[PALM_INDICES[index]];
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) {
      return null;
    }
    const weight = PALM_WEIGHTS[index];
    x += (1 - source.x) * weight;
    y += source.y * weight;
    totalWeight += weight;
  }

  const point = (index) => ({
    x: 1 - Number(landmarks[index]?.x ?? 0.5),
    y: Number(landmarks[index]?.y ?? 0.5)
  });
  const width = distance(point(5), point(17));
  const height = distance(point(0), point(9));

  return {
    center: {
      x: clamp(x / totalWeight),
      y: clamp(y / totalWeight)
    },
    scale: clamp((width + height) / 2, 0.025, 0.32)
  };
}

function extractDetections(result) {
  const groups = result?.landmarks ?? result?.handLandmarks ?? [];
  const detections = [];

  for (let index = 0; index < groups.length; index += 1) {
    const geometry = palmGeometry(groups[index]);
    if (!geometry) continue;
    const handedness = readHandedness(result, index);
    detections.push({
      ...geometry,
      handedness: handedness.label,
      handednessScore: handedness.score,
      sourceIndex: index
    });
  }

  return detections.slice(0, 2);
}

class PhysicalTrack {
  constructor(side, config) {
    this.side = side;
    this.config = config;
    this.reset();
  }

  reset() {
    this.ready = false;
    this.x = this.side === 'right' ? 0.30 : 0.70;
    this.y = 0.55;
    this.vx = 0;
    this.vy = 0;
    this.scale = 0.08;
    this.lastSeenAt = 0;
    this.lastUpdateAt = 0;
    this.pending = null;
    this.handedness = null;
    this.handednessScore = 0;
  }

  predict(now) {
    if (!this.ready) return { x: this.x, y: this.y };
    const seconds = clamp(
      (Number(now) - this.lastSeenAt) / 1000,
      0,
      this.config.maximumPredictionMs / 1000
    );
    return {
      x: clamp(this.x + this.vx * seconds),
      y: clamp(this.y + this.vy * seconds)
    };
  }

  assignmentCost(detection, now, labelMap) {
    const predicted = this.predict(now);
    const referenceScale = Math.max(0.045, this.scale, detection.scale);
    let cost = distance(predicted, detection.center) / referenceScale;

    if (!this.ready) {
      const expectedX = this.side === 'right' ? 0.30 : 0.70;
      cost += Math.abs(detection.center.x - expectedX) * 2.4;
    }

    const mappedSide = detection.handedness
      ? labelMap.get(detection.handedness)
      : null;
    if (mappedSide && detection.handednessScore >= this.config.minimumHandednessScore) {
      if (mappedSide === this.side) cost -= 1.2 * detection.handednessScore;
      else cost += this.config.handednessMismatchPenalty * detection.handednessScore;
    }

    return cost;
  }

  pendingMatches(detection) {
    return this.pending
      && distance(this.pending, detection.center) <= this.config.pendingMatchDistance;
  }

  update(detection, now) {
    const timestamp = Number(now);
    const age = this.lastSeenAt ? timestamp - this.lastSeenAt : Infinity;
    const jump = this.ready ? distance(this, detection.center) : 0;

    if (
      this.ready
      && age < this.config.reacquireResetMs
      && jump > this.config.maximumAcceptedJump
    ) {
      if (this.pendingMatches(detection)) {
        this.pending.x = detection.center.x;
        this.pending.y = detection.center.y;
        this.pending.count += 1;
      } else {
        this.pending = {
          x: detection.center.x,
          y: detection.center.y,
          since: timestamp,
          count: 1
        };
      }

      const confirmed = this.pending.count >= this.config.minimumReacquireFrames
        && timestamp - this.pending.since >= this.config.reacquireConfirmMs;
      if (!confirmed) return false;
    }

    const previousX = this.x;
    const previousY = this.y;
    const dt = this.lastUpdateAt
      ? clamp((timestamp - this.lastUpdateAt) / 1000, 1 / 120, 0.12)
      : 1 / 60;

    this.x = clamp(detection.center.x);
    this.y = clamp(detection.center.y);
    const rawVx = (this.x - previousX) / dt;
    const rawVy = (this.y - previousY) / dt;
    const velocityAlpha = 1 - Math.exp(-dt / this.config.velocityTimeConstantSeconds);
    this.vx += (rawVx - this.vx) * velocityAlpha;
    this.vy += (rawVy - this.vy) * velocityAlpha;
    this.scale += (detection.scale - this.scale) * (1 - Math.exp(-dt / 0.20));
    this.lastSeenAt = timestamp;
    this.lastUpdateAt = timestamp;
    this.ready = true;
    this.pending = null;
    this.handedness = detection.handedness ?? this.handedness;
    this.handednessScore = Math.max(
      detection.handednessScore,
      this.handednessScore * 0.97
    );
    return true;
  }

  snapshot(now) {
    const ageMs = this.lastSeenAt
      ? Math.max(0, Number(now) - this.lastSeenAt)
      : Infinity;
    return {
      side: this.side,
      visible: this.ready && ageMs <= this.config.missingGraceMs,
      ageMs,
      raw: this.ready ? { x: this.x, y: this.y } : null,
      predicted: this.ready ? this.predict(now) : null,
      velocity: { x: this.vx, y: this.vy },
      scale: this.scale,
      lastSeenAt: this.lastSeenAt,
      handedness: this.handedness,
      handednessScore: this.handednessScore
    };
  }
}

/**
 * Núcleo de identidade física baseado no Hand Landmarker.
 *
 * A associação usa a classificação de lateralidade do detector de mãos e a
 * continuidade da palma. Quadros ambíguos são descartados; uma detecção nunca
 * é entregue automaticamente à outra mão só porque ficou mais próxima dela.
 */
export class StrictPhysicalHandCore {
  constructor(config = CONFIG) {
    this.config = config;
    this.tracks = {
      left: new PhysicalTrack('left', config),
      right: new PhysicalTrack('right', config)
    };
    this.reset();
  }

  reset() {
    this.tracks.left.reset();
    this.tracks.right.reset();
    this.labelMap = new Map();
    this.labelCandidate = null;
    this.labelCandidateSince = 0;
    this.lastTimestamp = 0;
    this.detectionCount = 0;
  }

  labelCandidateKey(leftDetection, rightDetection) {
    return `${leftDetection.handedness ?? '?'}:${rightDetection.handedness ?? '?'}`;
  }

  learnLabelMap(detections, now) {
    if (detections.length !== 2) return;
    const ordered = [...detections].sort(
      (first, second) => first.center.x - second.center.x
    );
    const screenLeft = ordered[0];
    const screenRight = ordered[1];
    const separated = screenLeft.center.x <= 0.5 - this.config.labelLearningMargin
      && screenRight.center.x >= 0.5 + this.config.labelLearningMargin;
    const labelsValid = screenLeft.handedness
      && screenRight.handedness
      && screenLeft.handedness !== screenRight.handedness
      && screenLeft.handednessScore >= this.config.minimumHandednessScore
      && screenRight.handednessScore >= this.config.minimumHandednessScore;
    if (!separated || !labelsValid) {
      this.labelCandidate = null;
      this.labelCandidateSince = 0;
      return;
    }

    const key = this.labelCandidateKey(screenLeft, screenRight);
    if (key !== this.labelCandidate) {
      this.labelCandidate = key;
      this.labelCandidateSince = Number(now);
      return;
    }

    if (Number(now) - this.labelCandidateSince < this.config.labelConfirmMs) return;

    this.labelMap.set(screenLeft.handedness, 'right');
    this.labelMap.set(screenRight.handedness, 'left');
  }

  mappedSide(detection) {
    if (!detection?.handedness) return null;
    if (detection.handednessScore < this.config.minimumHandednessScore) return null;
    return this.labelMap.get(detection.handedness) ?? null;
  }

  assignTwo(detections, now) {
    const [first, second] = detections;
    const firstMapped = this.mappedSide(first);
    const secondMapped = this.mappedSide(second);

    if (firstMapped && secondMapped && firstMapped !== secondMapped) {
      return {
        [firstMapped]: first,
        [secondMapped]: second
      };
    }

    const directCost = this.tracks.left.assignmentCost(first, now, this.labelMap)
      + this.tracks.right.assignmentCost(second, now, this.labelMap);
    const swappedCost = this.tracks.left.assignmentCost(second, now, this.labelMap)
      + this.tracks.right.assignmentCost(first, now, this.labelMap);

    return directCost <= swappedCost
      ? { left: first, right: second }
      : { left: second, right: first };
  }

  assignOne(detection, now) {
    const mapped = this.mappedSide(detection);
    if (mapped) {
      const mappedCost = this.tracks[mapped].assignmentCost(
        detection,
        now,
        this.labelMap
      );
      if (
        !this.tracks[mapped].ready
        || mappedCost <= this.config.maximumSingleAssignmentCost
      ) return { [mapped]: detection };
      return {};
    }

    const leftCost = this.tracks.left.assignmentCost(detection, now, this.labelMap);
    const rightCost = this.tracks.right.assignmentCost(detection, now, this.labelMap);
    const best = Math.min(leftCost, rightCost);
    const advantage = Math.abs(leftCost - rightCost);
    if (
      best > this.config.maximumSingleAssignmentCost
      || advantage < this.config.minimumSingleAssignmentAdvantage
    ) return {};

    return leftCost < rightCost
      ? { left: detection }
      : { right: detection };
  }

  ingest(result, timestamp = performance.now()) {
    const now = Math.max(
      this.lastTimestamp + 0.001,
      Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0
    );
    this.lastTimestamp = now;
    const detections = extractDetections(result);
    this.detectionCount = detections.length;
    this.learnLabelMap(detections, now);

    const assignments = detections.length >= 2
      ? this.assignTwo(detections, now)
      : detections.length === 1
        ? this.assignOne(detections[0], now)
        : {};

    if (assignments.left) this.tracks.left.update(assignments.left, now);
    if (assignments.right) this.tracks.right.update(assignments.right, now);
    return this.sample(now);
  }

  sample(timestamp = performance.now()) {
    const now = Number(timestamp);
    return {
      timestampMs: now,
      detectionCount: this.detectionCount,
      labelMapReady: this.labelMap.size === 2,
      left: this.tracks.left.snapshot(now),
      right: this.tracks.right.snapshot(now)
    };
  }
}

export class ProductionHandAnchor {
  constructor(config = CONFIG) {
    this.config = config;
    this.core = new StrictPhysicalHandCore(config);
    this.worker = null;
    this.ready = false;
    this.failed = false;
    this.busy = false;
    this.capturePending = false;
    this.lastSubmittedAt = 0;
    this.frameId = 0;
    this.targetRate = SCHEDULER.defaultHandRate;
    this.inferenceMs = 0;
    this.delegate = '—';
    this.lastError = '';
  }

  async init() {
    if (this.ready) return;
    if (typeof Worker !== 'function') {
      throw new Error('Este navegador não oferece detector de mãos em segundo plano.');
    }

    this.worker = new Worker('/js/hand-landmarker-worker.js', { type: 'module' });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Tempo esgotado ao carregar o detector de mãos.'));
      }, SCHEDULER.workerInitializationTimeoutMs);

      const initialMessage = (event) => {
        const message = event.data ?? {};
        if (message.type === 'ready') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', initialMessage);
          this.delegate = message.delegate ?? '—';
          this.ready = true;
          resolve();
        } else if (message.type === 'fatal') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', initialMessage);
          reject(new Error(message.message || 'Falha ao carregar o detector de mãos.'));
        }
      };

      this.worker.addEventListener('message', initialMessage);
      this.worker.addEventListener('error', (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message || 'Falha no detector de mãos.'));
      }, { once: true });
      this.worker.postMessage({ type: 'init' });
    });

    this.worker.addEventListener('message', (event) => {
      const message = event.data ?? {};
      if (message.type === 'result') {
        this.busy = false;
        this.inferenceMs = this.inferenceMs
          ? this.inferenceMs * 0.82 + Number(message.inferenceMs || 0) * 0.18
          : Number(message.inferenceMs || 0);
        this.adjustRate();
        this.core.ingest(message.result, message.timestampMs);
      } else if (message.type === 'frame-error') {
        this.busy = false;
        this.lastError = message.message || 'Quadro de mãos descartado.';
      }
    });
  }

  adjustRate() {
    const thresholds = SCHEDULER.inferenceThresholdsMs;
    const rates = SCHEDULER.handRates;
    if (this.inferenceMs <= thresholds[0]) this.targetRate = rates[0];
    else if (this.inferenceMs <= thresholds[1]) this.targetRate = rates[1];
    else if (this.inferenceMs <= thresholds[2]) this.targetRate = rates[2];
    else this.targetRate = rates[3];
  }

  async maybeSubmit(video, now = performance.now()) {
    if (
      !this.ready
      || this.failed
      || this.busy
      || this.capturePending
      || !video
      || video.readyState < 2
      || Number(now) - this.lastSubmittedAt < 1000 / this.targetRate
    ) return false;

    this.capturePending = true;
    try {
      const bitmap = await createImageBitmap(video);
      if (!this.ready || this.busy) {
        bitmap.close?.();
        return false;
      }
      this.busy = true;
      this.lastSubmittedAt = Number(now);
      this.frameId += 1;
      this.worker.postMessage({
        type: 'frame',
        frameId: this.frameId,
        timestampMs: Math.round(now),
        bitmap
      }, [bitmap]);
      return true;
    } catch (error) {
      this.lastError = error?.message || 'Não foi possível capturar o quadro das mãos.';
      return false;
    } finally {
      this.capturePending = false;
    }
  }

  sample(now = performance.now()) {
    return this.core.sample(now);
  }

  status() {
    const snapshot = this.sample(performance.now());
    return {
      ready: this.ready,
      failed: this.failed,
      delegate: this.delegate,
      targetRate: this.targetRate,
      inferenceMs: this.inferenceMs,
      detectionCount: snapshot.detectionCount,
      labelMapReady: snapshot.labelMapReady,
      lastError: this.lastError
    };
  }

  reset() {
    this.core.reset();
  }

  close() {
    this.ready = false;
    this.worker?.postMessage?.({ type: 'close' });
    this.worker?.terminate?.();
    this.worker = null;
  }
}

export function createProductionHandAnchor(config) {
  return new ProductionHandAnchor(config);
}
