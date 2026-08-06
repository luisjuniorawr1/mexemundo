import {
  HAND_SYSTEM_CONFIG,
  MEDIAPIPE_TASKS_VERSION
} from './hand-system-config.js';

const CONFIG = HAND_SYSTEM_CONFIG.handAnchor;
const SCHEDULER = HAND_SYSTEM_CONFIG.scheduler;
const DETECTOR = HAND_SYSTEM_CONFIG.detector;
const TASKS_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
const PALM_INDICES = Object.freeze([0, 5, 9, 13, 17]);
const PALM_WEIGHTS = Object.freeze([0.14, 0.20, 0.32, 0.20, 0.14]);

let visionModulePromise = null;

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

  return {
    center: {
      x: clamp(x / totalWeight),
      y: clamp(y / totalWeight)
    },
    scale: clamp(
      (distance(point(5), point(17)) + distance(point(0), point(9))) / 2,
      0.025,
      0.32
    )
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

    if (
      mappedSide
      && detection.handednessScore >= this.config.minimumHandednessScore
    ) {
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
    const velocityAlpha = 1 - Math.exp(
      -dt / this.config.velocityTimeConstantSeconds
    );

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

    const key = `${screenLeft.handedness}:${screenRight.handedness}`;
    if (key !== this.labelCandidate) {
      this.labelCandidate = key;
      this.labelCandidateSince = Number(now);
      return;
    }

    if (Number(now) - this.labelCandidateSince < this.config.labelConfirmMs) {
      return;
    }

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
      const cost = this.tracks[mapped].assignmentCost(
        detection,
        now,
        this.labelMap
      );
      if (
        !this.tracks[mapped].ready
        || cost <= this.config.maximumSingleAssignmentCost
      ) {
        return { [mapped]: detection };
      }
      return {};
    }

    const leftCost = this.tracks.left.assignmentCost(
      detection,
      now,
      this.labelMap
    );
    const rightCost = this.tracks.right.assignmentCost(
      detection,
      now,
      this.labelMap
    );
    const best = Math.min(leftCost, rightCost);
    const advantage = Math.abs(leftCost - rightCost);

    if (
      best > this.config.maximumSingleAssignmentCost
      || advantage < this.config.minimumSingleAssignmentAdvantage
    ) {
      return {};
    }

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

async function loadVisionModule() {
  visionModulePromise ??= import(TASKS_MODULE);
  return visionModulePromise;
}

async function createMainThreadTask(delegate) {
  const { FilesetResolver, HandLandmarker } = await loadVisionModule();
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: DETECTOR.handModel,
      delegate
    },
    runningMode: 'VIDEO',
    numHands: DETECTOR.numberOfHands,
    minHandDetectionConfidence: DETECTOR.minimumDetectionConfidence,
    minHandPresenceConfidence: DETECTOR.minimumPresenceConfidence,
    minTrackingConfidence: DETECTOR.minimumTrackingConfidence
  });
}

export class ProductionHandAnchor {
  constructor(config = CONFIG) {
    this.config = config;
    this.core = new StrictPhysicalHandCore(config);
    this.worker = null;
    this.fallbackTask = null;
    this.mode = 'initializing';
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

  async initWorker() {
    if (typeof Worker !== 'function') {
      throw new Error('Web Worker indisponível.');
    }

    const worker = new Worker('/js/hand-landmarker-worker.js', {
      type: 'module'
    });
    this.worker = worker;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Tempo esgotado ao carregar o worker de mãos.'));
      }, SCHEDULER.workerInitializationTimeoutMs);

      const onMessage = (event) => {
        const message = event.data ?? {};
        if (message.type === 'ready') {
          clearTimeout(timeout);
          cleanup();
          this.delegate = message.delegate ?? '—';
          resolve();
        } else if (message.type === 'fatal') {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(
            message.message || 'Falha ao carregar o worker de mãos.'
          ));
        }
      };

      const onError = (event) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(event.message || 'Falha no worker de mãos.'));
      };

      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'init' });
    });

    worker.addEventListener('message', (event) => {
      const message = event.data ?? {};
      if (message.type === 'result') {
        this.busy = false;
        this.handleResult(
          message.result,
          message.timestampMs,
          Number(message.inferenceMs || 0)
        );
      } else if (message.type === 'frame-error') {
        this.busy = false;
        this.lastError = message.message || 'Quadro de mãos descartado.';
      }
    });

    this.mode = 'worker';
    this.ready = true;
  }

  async initFallback(workerError) {
    this.worker?.terminate?.();
    this.worker = null;

    let gpuError = null;
    try {
      this.fallbackTask = await createMainThreadTask('GPU');
      this.delegate = 'GPU • compatível';
    } catch (error) {
      gpuError = error;
      this.fallbackTask = await createMainThreadTask('CPU');
      this.delegate = 'CPU • compatível';
    }

    this.mode = 'main-thread';
    this.ready = true;
    this.lastError = workerError
      ? `Worker incompatível; modo compatível ativo. ${workerError.message}`
      : '';

    if (!this.fallbackTask) {
      throw gpuError ?? new Error('Não foi possível criar o detector compatível.');
    }
  }

  async init() {
    if (this.ready) return;

    this.failed = false;
    this.lastError = '';

    try {
      await this.initWorker();
    } catch (workerError) {
      console.warn(
        'Worker do Hand Landmarker incompatível; usando modo compatível.',
        workerError
      );

      try {
        await this.initFallback(workerError);
      } catch (fallbackError) {
        this.failed = true;
        this.ready = false;
        throw new Error(
          `Não foi possível carregar o detector de mãos. ${fallbackError.message}`
        );
      }
    }
  }

  handleResult(result, timestamp, inferenceMs) {
    this.inferenceMs = this.inferenceMs
      ? this.inferenceMs * 0.82 + Number(inferenceMs || 0) * 0.18
      : Number(inferenceMs || 0);
    this.adjustRate();
    this.core.ingest(result, timestamp);
  }

  adjustRate() {
    const thresholds = SCHEDULER.inferenceThresholdsMs;
    const rates = SCHEDULER.handRates;

    if (this.inferenceMs <= thresholds[0]) this.targetRate = rates[0];
    else if (this.inferenceMs <= thresholds[1]) this.targetRate = rates[1];
    else if (this.inferenceMs <= thresholds[2]) this.targetRate = rates[2];
    else this.targetRate = rates[3];
  }

  async submitWorkerFrame(video, now) {
    this.capturePending = true;

    try {
      const bitmap = await createImageBitmap(video);
      if (!this.ready || this.busy || this.mode !== 'worker') {
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
      this.lastError = error?.message
        || 'Não foi possível capturar o quadro das mãos.';
      return false;
    } finally {
      this.capturePending = false;
    }
  }

  submitFallbackFrame(video, now) {
    if (!this.fallbackTask) return false;

    this.busy = true;
    this.lastSubmittedAt = Number(now);
    const startedAt = performance.now();

    try {
      const result = this.fallbackTask.detectForVideo(
        video,
        Math.round(Number(now))
      );
      this.handleResult(
        result,
        now,
        performance.now() - startedAt
      );
      return true;
    } catch (error) {
      this.lastError = error?.message || 'Quadro de mãos descartado.';
      return false;
    } finally {
      this.busy = false;
    }
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
    ) {
      return false;
    }

    if (this.mode === 'worker') {
      return this.submitWorkerFrame(video, now);
    }

    return this.submitFallbackFrame(video, now);
  }

  sample(now = performance.now()) {
    return this.core.sample(now);
  }

  status() {
    const snapshot = this.sample(performance.now());

    return {
      ready: this.ready,
      failed: this.failed,
      mode: this.mode,
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
    this.busy = false;
    this.worker?.postMessage?.({ type: 'close' });
    this.worker?.terminate?.();
    this.worker = null;
    this.fallbackTask?.close?.();
    this.fallbackTask = null;
    this.mode = 'closed';
  }
}

export function createProductionHandAnchor(config) {
  return new ProductionHandAnchor(config);
}
