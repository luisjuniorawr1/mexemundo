import { performance } from 'node:perf_hooks';

import {
  MOTION_POINT_NAMES,
  MotionEngine,
  MotionSource
} from '../public/js/motion-engine.js';
import { RealtimeClient } from '../public/js/realtime.js';

const SEED = 0x5eed1234;
const POSE_HZ = 30;
const RENDER_HZ = 60;
const POSE_MS = 1000 / POSE_HZ;
const RENDER_MS = 1000 / RENDER_HZ;
const BASE_TIME = 1000;
const STATIC_POSES = 180;
const STATIC_WARMUP_POSES = 30;
const BENCHMARK_FRAMES = 12000;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function compactLegacy(value) {
  return Math.round(value * 10000) / 10000;
}

function createRandom(seed = SEED) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createNoise(seed = SEED, amplitude = 0.0035) {
  const random = createRandom(seed);
  return () => (random() + random() + random() + random() - 2) * amplitude;
}

function rawPose({
  rightX = 0.65,
  rightY = 0.55,
  leftX = 0.35,
  leftY = 0.55
} = {}) {
  return {
    left: { x: leftX, y: leftY, confidence: 1 },
    right: { x: rightX, y: rightY, confidence: 1 },
    leftShoulder: { x: 0.44, y: 0.35, confidence: 1 },
    rightShoulder: { x: 0.56, y: 0.35, confidence: 1 }
  };
}

function radialRms(points) {
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return Math.sqrt(points.reduce((sum, point) => (
    sum + (point.x - centerX) ** 2 + (point.y - centerY) ** 2
  ), 0) / points.length);
}

class LegacyPointFilter {
  constructor({ wrist = false } = {}) {
    this.wrist = wrist;
    this.ready = false;
    this.rawX = 0.5;
    this.rawY = 0.5;
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.time = 0;
  }

  filter(rawX, rawY, now) {
    if (!this.ready) {
      this.ready = true;
      this.rawX = rawX;
      this.rawY = rawY;
      this.x = rawX;
      this.y = rawY;
      this.time = now;
      return this.output();
    }

    const dt = clamp((now - this.time) / 1000, 1 / 120, 0.09);
    const rawVx = (rawX - this.rawX) / dt;
    const rawVy = (rawY - this.rawY) / dt;
    const velocityBlend = this.wrist ? 0.38 : 0.24;
    this.vx += (rawVx - this.vx) * velocityBlend;
    this.vy += (rawVy - this.vy) * velocityBlend;

    const dx = rawX - this.x;
    const dy = rawY - this.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(this.vx, this.vy);
    let deadZone;
    let alpha;

    if (this.wrist) {
      const movement = clamp((speed - 0.09) / 0.90);
      const displacement = clamp(distance / 0.045);
      const responsiveness = Math.max(movement, displacement);
      deadZone = speed < 0.14 ? 0.0040 : speed < 0.38 ? 0.0019 : 0.0007;
      alpha = 0.16 + responsiveness * 0.78;
      if (distance > 0.07 || speed > 1.30) alpha = 1;
    } else {
      deadZone = 0.0016;
      alpha = clamp(0.20 + distance * 5, 0.20, 0.72);
    }

    if (distance > deadZone) {
      const previousX = this.x;
      const previousY = this.y;
      this.x += dx * alpha;
      this.y += dy * alpha;
      const filteredVx = (this.x - previousX) / dt;
      const filteredVy = (this.y - previousY) / dt;
      this.vx += (filteredVx - this.vx) * 0.35;
      this.vy += (filteredVy - this.vy) * 0.35;
    } else {
      this.vx *= 0.62;
      this.vy *= 0.62;
    }

    this.rawX = rawX;
    this.rawY = rawY;
    this.time = now;
    return this.output();
  }

  output() {
    return {
      x: compactLegacy(clamp(this.x)),
      y: compactLegacy(clamp(this.y)),
      vx: compactLegacy(clamp(this.vx, -4, 4)),
      vy: compactLegacy(clamp(this.vy, -4, 4)),
      visible: true
    };
  }
}

class LegacyPipeline {
  constructor({ sessionDeadZone = 0.0045 } = {}) {
    this.sessionDeadZone = sessionDeadZone;
    this.filters = new Map();
    this.target = null;
    this.motion = Object.fromEntries(MOTION_POINT_NAMES.map((name) => [name, {
      x: name === 'left' ? 0.35 : name === 'right' ? 0.65 : name === 'leftShoulder' ? 0.44 : 0.56,
      y: name.includes('Shoulder') ? 0.35 : 0.55,
      vx: 0,
      vy: 0,
      visible: false
    }]));
    this.detected = false;
  }

  ingest(points, now) {
    this.target = Object.fromEntries(MOTION_POINT_NAMES.map((name) => {
      let filter = this.filters.get(name);
      if (!filter) {
        filter = new LegacyPointFilter({ wrist: name === 'left' || name === 'right' });
        this.filters.set(name, filter);
      }
      const point = points[name];
      return [name, filter.filter(point.x, point.y, now)];
    }));
    this.target.receivedAt = now;
  }

  sample(now, dtMs = RENDER_MS) {
    if (!this.target) return this.motion;
    for (const name of MOTION_POINT_NAMES) {
      const source = this.target[name];
      const current = this.motion[name];
      const wrist = name === 'left' || name === 'right';
      const speed = Math.hypot(source.vx, source.vy);
      const packetAge = Math.min((now - this.target.receivedAt) / 1000, 0.025);
      const lead = wrist && speed > 0.35 ? Math.min(0.024, 0.006 + packetAge) : 0;
      const desiredX = clamp(source.x + source.vx * lead * 0.45);
      const desiredY = clamp(source.y + source.vy * lead * 0.45);
      const distance = Math.hypot(desiredX - current.x, desiredY - current.y);

      if (wrist) {
        const threshold = speed < 0.14
          ? Math.max(0.0032, this.sessionDeadZone)
          : speed < 0.38
            ? Math.max(0.0018, this.sessionDeadZone * 0.45)
            : 0.0008;
        if (!this.detected || distance > threshold) {
          current.x = desiredX;
          current.y = desiredY;
        }
      } else {
        const seconds = Math.max(1 / 120, dtMs / 1000);
        const alpha = 1 - Math.exp(-seconds / 0.04);
        current.x += (desiredX - current.x) * alpha;
        current.y += (desiredY - current.y) * alpha;
      }
      current.vx = source.vx;
      current.vy = source.vy;
      current.visible = true;
    }
    this.detected = true;
    return this.motion;
  }

  received() {
    return this.target;
  }
}

class CurrentPipeline {
  constructor(calibration) {
    this.source = new MotionSource();
    this.engine = new MotionEngine({ profile: 'game', calibration });
    this.sequence = 0;
  }

  ingest(points, now) {
    const next = this.source.process(points, now, { detected: true, processingMs: 0 });
    next.sequence = ++this.sequence;
    this.engine.ingest(next, now);
  }

  sample(now) {
    return this.engine.sample(now, { consumeCollision: false }).visual;
  }

  received() {
    return this.engine.latest;
  }
}

function stationaryFixture() {
  const noise = createNoise();
  return Array.from({ length: STATIC_POSES }, (_, index) => ({
    tMs: index * POSE_MS,
    points: rawPose({
      rightX: 0.65 + noise(),
      rightY: 0.55 + noise(),
      leftX: 0.35 + noise(),
      leftY: 0.55 + noise()
    })
  }));
}

function measureStationary(factory, fixture) {
  const pipeline = factory();
  const output = [];
  let poseIndex = 0;
  const renderFrames = (fixture.length - 1) * RENDER_HZ / POSE_HZ;

  for (let renderIndex = 0; renderIndex <= renderFrames; renderIndex += 1) {
    const elapsed = renderIndex * RENDER_MS;
    while (poseIndex < fixture.length && fixture[poseIndex].tMs <= elapsed + 1e-7) {
      pipeline.ingest(fixture[poseIndex].points, BASE_TIME + fixture[poseIndex].tMs);
      poseIndex += 1;
    }
    const pose = pipeline.sample(BASE_TIME + elapsed, RENDER_MS);
    if (elapsed >= STATIC_WARMUP_POSES * POSE_MS) output.push({ ...pose.right });
  }
  return radialRms(output);
}

function measureOnset(factory, speed) {
  const pipeline = factory();
  let inputOnset = null;
  let outputOnset = null;
  let poseSequence = 0;

  for (let renderIndex = 0; renderIndex <= RENDER_HZ * 3; renderIndex += 1) {
    const elapsed = renderIndex * RENDER_MS;
    if (renderIndex % (RENDER_HZ / POSE_HZ) === 0) {
      const poseTime = poseSequence * POSE_MS;
      const movementFrames = Math.max(0, poseSequence - POSE_HZ);
      const movement = speed * movementFrames / POSE_HZ;
      pipeline.ingest(rawPose({ rightX: 0.65 + movement }), BASE_TIME + elapsed);
      if (movement > 0 && inputOnset === null) inputOnset = elapsed;
      poseSequence += 1;
    }
    const output = pipeline.sample(BASE_TIME + elapsed, RENDER_MS);
    if (elapsed > 1000 && output.right.x > 0.650001 && outputOnset === null) {
      outputOnset = elapsed;
    }
  }

  return outputOnset - inputOnset;
}

function measureTrackingDistances(factory) {
  const pipeline = factory();
  let receivedDisplayed = 0;
  let inputDisplayed = 0;
  let samples = 0;
  for (let index = 0; index < 240; index += 1) {
    const phase = index * 0.055;
    const now = BASE_TIME + index * POSE_MS;
    const input = rawPose({
      rightX: 0.65 + Math.sin(phase) * 0.14,
      rightY: 0.55 + Math.cos(phase * 0.71) * 0.10
    });
    pipeline.ingest(input, now);
    const visual = pipeline.sample(now, POSE_MS);
    const received = pipeline.received();
    if (index >= 30 && received?.right && visual?.right) {
      receivedDisplayed += Math.hypot(
        received.right.x - visual.right.x,
        received.right.y - visual.right.y
      );
      inputDisplayed += Math.hypot(
        input.right.x - visual.right.x,
        input.right.y - visual.right.y
      );
      samples += 1;
    }
  }
  return {
    receivedDisplayed: receivedDisplayed / samples,
    inputDisplayed: inputDisplayed / samples
  };
}

function measureCurrentTelemetry() {
  const engine = new MotionEngine({ profile: 'game', calibration });
  engine.setTransportMetrics({ mode: 'direct', rtt: 40 });
  const source = new MotionSource();
  for (let index = 0; index < 3; index += 1) {
    const now = BASE_TIME + index * POSE_MS;
    const next = source.process(rawPose(), now, { detected: true, processingMs: 10 });
    next.sequence = index + 1;
    engine.ingest(next, now);
  }
  const metrics = engine.sample(BASE_TIME + 2 * POSE_MS + 5).metrics;

  const transport = new RealtimeClient();
  let quality = null;
  transport.on('quality', (value) => { quality = value; });
  transport.acceptPose({ sequence: 10 });
  transport.acceptPose({ sequence: 12 });
  transport.acceptPose({ sequence: 12 });
  transport.lastQualityDispatchAt = 0;
  transport.dispatchQuality();
  clearTimeout(transport.qualityDispatchTimer);

  return {
    estimatedLatencyMs: metrics.estimatedLatencyMs,
    poseFrequencyHz: metrics.poseFrequencyHz,
    droppedFrames: quality.dropped
  };
}

function benchmarkFixture() {
  const noise = createNoise(SEED ^ 0xa5a5a5a5, 0.0012);
  return Array.from({ length: BENCHMARK_FRAMES }, (_, index) => {
    const phase = index * 0.037;
    return rawPose({
      rightX: 0.65 + Math.sin(phase) * 0.18 + noise(),
      rightY: 0.55 + Math.cos(phase * 0.71) * 0.16 + noise(),
      leftX: 0.35 + Math.sin(phase * 0.83 + 1.7) * 0.17 + noise(),
      leftY: 0.55 + Math.cos(phase * 0.67 + 0.9) * 0.15 + noise()
    });
  });
}

function benchmark(factory, fixture) {
  const run = () => {
    const pipeline = factory();
    const startedAt = performance.now();
    for (let index = 0; index < fixture.length; index += 1) {
      const now = BASE_TIME + index * POSE_MS;
      pipeline.ingest(fixture[index], now);
      pipeline.sample(now, POSE_MS);
    }
    return (performance.now() - startedAt) / fixture.length;
  };

  run();
  const samples = [run(), run(), run(), run(), run()].sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

function format(value, digits = 6) {
  return Number(value.toFixed(digits));
}

const stationary = stationaryFixture();
const calibrationSamples = stationary.slice(STATIC_WARMUP_POSES).map((frame) => frame.points.right);
const calibratedJitter = radialRms(calibrationSamples);
const calibration = {
  jitter: calibratedJitter,
  deadZone: clamp(calibratedJitter * 3.2, 0.0045, 0.018)
};
const legacyFactory = () => new LegacyPipeline({ sessionDeadZone: 0.0045 });
const currentFactory = () => new CurrentPipeline(calibration);
const benchmarkFrames = benchmarkFixture();

const comparison = [
  {
    metric: 'stationary jitter (normalized RMS)',
    before: measureStationary(legacyFactory, stationary),
    after: measureStationary(currentFactory, stationary),
    unit: 'normalized'
  },
  {
    metric: 'slow onset 0.04',
    before: measureOnset(legacyFactory, 0.04),
    after: measureOnset(currentFactory, 0.04),
    unit: 'ms'
  },
  {
    metric: 'slow onset 0.08',
    before: measureOnset(legacyFactory, 0.08),
    after: measureOnset(currentFactory, 0.08),
    unit: 'ms'
  },
  {
    metric: 'CPU cost per pose frame',
    before: benchmark(legacyFactory, benchmarkFrames),
    after: benchmark(currentFactory, benchmarkFrames),
    unit: 'ms/frame'
  }
].map((row) => ({
  metric: row.metric,
  before: format(row.before),
  after: format(row.after),
  delta: format(row.after - row.before),
  unit: row.unit
}));

console.log('MexeMundo motion comparison');
console.log(`Deterministic fixture: seed=0x${SEED.toString(16)}, poses=${POSE_HZ} Hz, render=${RENDER_HZ} Hz`);
console.log(`Calibration: jitter=${format(calibration.jitter)}, deadZone=${format(calibration.deadZone)}`);
console.table(comparison);
const currentTelemetry = measureCurrentTelemetry();
const legacyTracking = measureTrackingDistances(legacyFactory);
const currentTracking = measureTrackingDistances(currentFactory);
console.table([
  {
    metric: 'estimated latency metric (processing=10, RTT=40, display age=5)',
    before: 'not exposed',
    after: format(currentTelemetry.estimatedLatencyMs),
    expected: 35,
    unit: 'ms'
  },
  {
    metric: 'accepted pose frequency',
    before: 30,
    after: format(currentTelemetry.poseFrequencyHz),
    expected: 30,
    unit: 'Hz'
  },
  {
    metric: 'reported drops (1 gap + 1 duplicate)',
    before: 1,
    after: currentTelemetry.droppedFrames,
    expected: 2,
    unit: 'frames'
  },
  {
    metric: 'received-to-displayed mean distance',
    before: format(legacyTracking.receivedDisplayed),
    after: format(currentTracking.receivedDisplayed),
    expected: '< 0.003 (different received signals)',
    unit: 'normalized'
  },
  {
    metric: 'raw-input-to-displayed mean distance (common reference)',
    before: format(legacyTracking.inputDisplayed),
    after: format(currentTracking.inputDisplayed),
    expected: 'descriptive',
    unit: 'normalized'
  }
]);

const currentRows = Object.fromEntries(comparison.map((row) => [row.metric, row]));
const assertions = [
  [currentRows['stationary jitter (normalized RMS)'].after <= calibration.jitter * 0.10,
    'stationary visual jitter exceeded 10% of raw fixture jitter'],
  [currentRows['slow onset 0.04'].after <= POSE_MS + 0.000001,
    'slow onset 0.04 exceeded one pose interval'],
  [currentRows['slow onset 0.08'].after <= POSE_MS + 0.000001,
    'slow onset 0.08 exceeded one pose interval'],
  [currentRows['CPU cost per pose frame'].after < 0.05,
    'MotionEngine CPU cost exceeded 0.05 ms per pose on this fixture'],
  [Math.abs(currentTelemetry.estimatedLatencyMs - 35) < 0.000001,
    'estimated latency calculation changed'],
  [Math.abs(currentTelemetry.poseFrequencyHz - 30) < 0.000001,
    'accepted pose frequency calculation changed'],
  [currentTelemetry.droppedFrames === 2,
    'drop accounting no longer reports both the gap and duplicate'],
  [currentTracking.receivedDisplayed < 0.003,
    'received-to-displayed distance exceeded the deterministic bound']
];
for (const [passed, message] of assertions) {
  if (!passed) throw new Error(message);
}
console.log('CPU timing uses deterministic input and median-of-five runs; wall-clock values vary by machine.');
