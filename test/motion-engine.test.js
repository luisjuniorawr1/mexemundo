import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTION_PROFILES,
  MotionEngine,
  MotionSource,
  installMotionDebug,
  playPoseRecording,
  replayPoseRecording,
  validatePoseRecording
} from '../public/js/motion-engine.js';

const FRAME_MS = 1000 / 30;
const BASE_TIME = 1000;
const EPSILON = 1e-9;

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, received ${actual}`
  );
}

function point(x, y, vx = 0, vy = 0, visible = true) {
  return { x, y, vx, vy, visible };
}

function pose({
  sequence = 1,
  rightX = 0.65,
  rightY = 0.55,
  leftX = 0.35,
  leftY = 0.55,
  rightVx = 0,
  rightVy = 0,
  leftVx = 0,
  leftVy = 0,
  detected = true,
  visible = true,
  processingMs = 8,
  sourceIntervalMs = FRAME_MS,
  captureAgeMs
} = {}) {
  const value = {
    detected,
    sequence,
    processingMs,
    sourceIntervalMs,
    left: point(leftX, leftY, leftVx, leftVy, visible),
    right: point(rightX, rightY, rightVx, rightVy, visible),
    leftShoulder: point(0.44, 0.35, 0, 0, visible),
    rightShoulder: point(0.56, 0.35, 0, 0, visible)
  };
  if (captureAgeMs !== undefined) value.captureAgeMs = captureAgeMs;
  return value;
}

function sourcePoints({
  rightX = 0.65,
  rightY = 0.55,
  leftX = 0.35,
  leftY = 0.55,
  confidence = 1
} = {}) {
  return {
    left: { x: leftX, y: leftY, confidence },
    right: { x: rightX, y: rightY, confidence },
    leftShoulder: { x: 0.44, y: 0.35, confidence },
    rightShoulder: { x: 0.56, y: 0.35, confidence }
  };
}

function seededNoise(seed = 0x5eed1234, amplitude = 0.0035) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return () => (random() + random() + random() + random() - 2) * amplitude;
}

function radialRms(points) {
  const centerX = points.reduce((sum, value) => sum + value.x, 0) / points.length;
  const centerY = points.reduce((sum, value) => sum + value.y, 0) / points.length;
  const meanSquaredRadius = points.reduce((sum, value) => (
    sum + (value.x - centerX) ** 2 + (value.y - centerY) ** 2
  ), 0) / points.length;
  return Math.sqrt(meanSquaredRadius);
}

function stationaryTrace(profile) {
  const noise = seededNoise();
  const source = new MotionSource();
  const engine = new MotionEngine({
    profile,
    calibration: { jitter: 0.003, deadZone: 0.0096 }
  });
  const raw = [];
  const visual = [];

  for (let index = 0; index < 180; index += 1) {
    const now = BASE_TIME + index * FRAME_MS;
    const rightX = 0.65 + noise();
    const rightY = 0.55 + noise();
    const leftX = 0.35 + noise();
    const leftY = 0.55 + noise();
    const next = source.process(sourcePoints({ rightX, rightY, leftX, leftY }), now);
    next.sequence = index + 1;
    engine.ingest(next, now);
    const snapshot = engine.sample(now, { consumeCollision: false });

    if (index >= 30) {
      raw.push({ x: next.right.x, y: next.right.y });
      visual.push({ x: snapshot.visual.right.x, y: snapshot.visual.right.y });
    }
  }

  return {
    engine,
    rawJitter: radialRms(raw),
    visualJitter: radialRms(visual)
  };
}

function slowOnsetDelay(speed) {
  const engine = new MotionEngine({
    profile: 'game',
    calibration: { jitter: 0.003, deadZone: 0.0096 }
  });
  engine.ingest(pose({ sequence: 1 }), BASE_TIME);
  engine.sample(BASE_TIME);

  let inputOnset = null;
  let visualOnset = null;
  for (let index = 1; index <= 20; index += 1) {
    const now = BASE_TIME + index * FRAME_MS;
    const rightX = 0.65 + (speed * index) / 30;
    engine.ingest(pose({
      sequence: index + 1,
      rightX,
      rightVx: speed
    }), now);
    const snapshot = engine.sample(now);
    if (inputOnset === null && rightX > 0.65) inputOnset = now;
    if (visualOnset === null && snapshot.visual.right.x > 0.650001) visualOnset = now;
  }

  assert.notEqual(inputOnset, null);
  assert.notEqual(visualOnset, null);
  return visualOnset - inputOnset;
}

test('stationary jitter is reduced without a fixed per-game filter', () => {
  const result = stationaryTrace('game');
  const metrics = result.engine.getMetrics(BASE_TIME + 179 * FRAME_MS);

  assert.ok(result.rawJitter > 0.001, 'fixture must contain measurable noise');
  assert.ok(
    result.visualJitter < result.rawJitter * 0.9,
    `visual jitter ${result.visualJitter} should be below raw jitter ${result.rawJitter}`
  );
  assert.ok(metrics.stationaryJitterRaw > metrics.stationaryJitterVisual);
  assertClose(metrics.poseFrequencyHz, 30, 1e-6);
});

test('stationary jitter metric starts a new center after a real movement', () => {
  const engine = new MotionEngine({ profile: 'game' });
  let sequence = 1;
  let now = BASE_TIME;

  const ingest = (rightX, rightVx = 0) => {
    engine.ingest(pose({ sequence: sequence++, rightX, rightVx }), now);
    engine.sample(now);
    now += FRAME_MS;
  };

  for (let index = 0; index < 15; index += 1) ingest(0.30);
  for (let index = 1; index <= 8; index += 1) ingest(0.30 + index * 0.05, 1.5);
  for (let index = 0; index < 120; index += 1) ingest(0.70);

  assert.ok(
    engine.getMetrics(now).stationaryJitterRaw < 0.00001,
    'the displacement itself must not contaminate stationary jitter'
  );
});

for (const speed of [0.04, 0.08]) {
  test(`game profile reacts to slow onset ${speed.toFixed(2)} within one pose interval`, () => {
    const delay = slowOnsetDelay(speed);
    assert.ok(
      delay <= FRAME_MS + EPSILON,
      `slow onset added ${delay} ms, expected at most ${FRAME_MS} ms`
    );
  });
}

test('network bursts do not turn camera jitter into fast motion', () => {
  const run = (arrivalGapMs) => {
    const engine = new MotionEngine({
      profile: 'game',
      calibration: { jitter: 0.003, deadZone: 0.0096 }
    });
    engine.ingest(pose({ sequence: 1, sourceIntervalMs: FRAME_MS }), BASE_TIME);
    engine.sample(BASE_TIME);
    const arrivedAt = BASE_TIME + arrivalGapMs;
    engine.ingest(pose({
      sequence: 2,
      rightX: 0.653,
      rightVx: 0.09,
      sourceIntervalMs: FRAME_MS
    }), arrivedAt);
    return engine.sample(arrivedAt).visual.right.x;
  };

  const regular = run(FRAME_MS);
  const burst = run(1);
  assertClose(burst, regular);
  assert.ok(burst < 0.653, 'camera jitter must not receive fast-onset response');
});

test('collision trajectory follows a fast measurement in the first accepted packet', () => {
  const engine = new MotionEngine({ profile: 'game' });
  engine.ingest(pose({ sequence: 10, rightX: 0.30 }), BASE_TIME);
  engine.sample(BASE_TIME);

  const movedAt = BASE_TIME + FRAME_MS;
  assert.equal(engine.ingest(pose({
    sequence: 11,
    rightX: 0.75,
    rightVx: 3
  }), movedAt), true);

  const snapshot = engine.sample(movedAt);
  const expectedLead = 0.75 + 3 * MOTION_PROFILES.game.collisionLeadMs / 1000;
  assertClose(snapshot.collision.right.x, expectedLead, 1e-5);
  assertClose(snapshot.collisionFrom.right.x, 0.30, 1e-5);
  assert.equal(snapshot.collision.sequence, 11);
  assert.ok(snapshot.collision.right.x >= snapshot.received.right.x);
});

test('menu is quieter while game gives more immediate movement response', () => {
  const menuTrace = stationaryTrace('menu');
  const gameTrace = stationaryTrace('game');

  assert.ok(MOTION_PROFILES.menu.minRestRadius > MOTION_PROFILES.game.minRestRadius);
  assert.ok(menuTrace.visualJitter <= gameTrace.visualJitter);

  const responses = {};
  for (const profile of ['menu', 'game']) {
    const engine = new MotionEngine({
      profile,
      calibration: { jitter: 0.003, deadZone: 0.0096 }
    });
    engine.ingest(pose({ sequence: 1 }), BASE_TIME);
    engine.ingest(pose({
      sequence: 2,
      rightX: 0.66,
      rightVx: 0.30
    }), BASE_TIME + FRAME_MS);
    const snapshot = engine.sample(BASE_TIME + FRAME_MS);
    responses[profile] = Math.abs(snapshot.received.right.x - snapshot.visual.right.x);
  }

  assert.ok(
    responses.game < responses.menu,
    `game error ${responses.game} should be below menu error ${responses.menu}`
  );
});

test('sequence handling accepts uint16 wrap and counts gaps, stale and duplicates', () => {
  const engine = new MotionEngine();
  assert.equal(engine.ingest(pose({ sequence: 65534 }), BASE_TIME), true);
  assert.equal(engine.ingest(pose({ sequence: 65535 }), BASE_TIME + FRAME_MS), true);
  assert.equal(engine.ingest(pose({ sequence: 0 }), BASE_TIME + 2 * FRAME_MS), true);
  assert.equal(engine.ingest(pose({ sequence: 3 }), BASE_TIME + 3 * FRAME_MS), true);
  assert.equal(engine.ingest(pose({ sequence: 3 }), BASE_TIME + 4 * FRAME_MS), false);
  assert.equal(engine.ingest(pose({ sequence: 2 }), BASE_TIME + 5 * FRAME_MS), false);

  const snapshot = engine.sample(BASE_TIME + 3 * FRAME_MS);
  assert.equal(snapshot.received.sequence, 3);
  assert.equal(snapshot.metrics.posesAccepted, 4);
  assert.equal(snapshot.metrics.sequenceGaps, 2);
  assert.equal(snapshot.metrics.droppedFrames, 2);
  assert.equal(snapshot.metrics.staleOrOutOfOrder, 2);
});

test('sample hides timed-out motion and rejects poses already stale at ingestion', () => {
  const engine = new MotionEngine({ profile: 'game' });
  engine.ingest(pose({ sequence: 1 }), BASE_TIME);

  const timeout = MOTION_PROFILES.game.maxPoseAgeMs;
  assert.equal(engine.sample(BASE_TIME + timeout).visual.right.visible, true);

  const staleSnapshot = engine.sample(BASE_TIME + timeout + 0.001);
  assert.equal(staleSnapshot.visual.right.visible, false);
  assert.equal(staleSnapshot.collision.right.visible, false);
  assert.equal(staleSnapshot.received.right.visible, true);

  assert.equal(engine.ingest(pose({
    sequence: 2,
    captureAgeMs: timeout + 1
  }), BASE_TIME + timeout + 1), false);
  assert.equal(engine.getMetrics().staleByAge, 1);
});

test('collision trajectory restarts after timeout or wrist reacquisition', () => {
  const engine = new MotionEngine({ profile: 'game' });
  engine.ingest(pose({ sequence: 1, rightX: 0.25 }), BASE_TIME);
  engine.sample(BASE_TIME);

  const resumedAt = BASE_TIME + MOTION_PROFILES.game.maxPoseAgeMs + FRAME_MS;
  engine.ingest(pose({ sequence: 2, rightX: 0.85 }), resumedAt);
  let snapshot = engine.sample(resumedAt);
  assertClose(snapshot.collisionFrom.right.x, snapshot.collision.right.x);

  engine.ingest(pose({ sequence: 3, rightX: 0.85, visible: false }), resumedAt + FRAME_MS);
  engine.ingest(pose({ sequence: 4, rightX: 0.20 }), resumedAt + 2 * FRAME_MS);
  snapshot = engine.sample(resumedAt + 2 * FRAME_MS);
  assertClose(snapshot.collisionFrom.right.x, snapshot.collision.right.x);
});

test('MotionSource preserves x/y and applies confidence hysteresis', () => {
  const source = new MotionSource({ visibilityOn: 0.34, visibilityOff: 0.24 });

  let output = source.process(sourcePoints({ rightX: 0.20, confidence: 0.33 }), BASE_TIME);
  assert.equal(output.right.visible, false);

  output = source.process(sourcePoints({ rightX: 0.21, confidence: 0.35 }), BASE_TIME + FRAME_MS);
  assert.equal(output.right.visible, true);
  assert.equal(output.right.x, 0.21);

  output = source.process(sourcePoints({ rightX: 0.82, rightY: 0.27, confidence: 0.30 }), BASE_TIME + 2 * FRAME_MS);
  assert.equal(output.right.visible, true);
  assert.equal(output.right.x, 0.82, 'source must not smooth position x');
  assert.equal(output.right.y, 0.27, 'source must not smooth position y');

  output = source.process(sourcePoints({ rightX: 0.83, confidence: 0.23 }), BASE_TIME + 3 * FRAME_MS);
  assert.equal(output.right.visible, false);

  output = source.process(sourcePoints({ rightX: 0.84, confidence: 0.30 }), BASE_TIME + 4 * FRAME_MS);
  assert.equal(output.right.visible, false, 'confidence between thresholds stays off after loss');

  output = source.process(sourcePoints({ rightX: 0.91, confidence: 0.35 }), BASE_TIME + 5 * FRAME_MS);
  assert.equal(output.right.visible, true);
  assert.equal(output.right.x, 0.91);

  source.noteVideoFrame({ presentedFrames: 10 });
  source.noteVideoFrame({ presentedFrames: 13 });
  const metrics = source.getMetrics();
  assert.equal(metrics.framesObserved, 2);
  assert.equal(metrics.cameraFramesDropped, 2);
  assertClose(metrics.poseFrequencyHz, 30, 0.05);
});

test('recorder and synchronous replay are immutable and deterministic', () => {
  let now = 5000;
  const recordedEngine = new MotionEngine({ profile: 'game', clock: () => now });
  recordedEngine.startRecording();

  const originals = [
    pose({ sequence: 1, rightX: 0.65 }),
    pose({ sequence: 2, rightX: 0.655, rightVx: 0.15 }),
    pose({ sequence: 3, rightX: 0.68, rightVx: 0.75 })
  ];
  originals.forEach((value, index) => {
    now = 5000 + index * FRAME_MS;
    recordedEngine.ingest(value, now);
  });
  const recording = recordedEngine.stopRecording();

  originals[0].right.x = 0;
  assert.equal(recording.schema, 'mexemundo.pose-sequence');
  assert.equal(recording.version, 1);
  assert.equal(recording.frames.length, 3);
  assert.equal(recording.frames[0].tMs, 0);
  assert.equal(recording.frames[0].pose.right.x, 0.65);
  assert.equal(validatePoseRecording(recording), recording);

  const runReplay = () => {
    const engine = new MotionEngine({
      profile: 'game',
      calibration: { jitter: 0.003, deadZone: 0.0096 }
    });
    const snapshots = [];
    replayPoseRecording(recording, (value, tMs) => {
      const receivedAt = BASE_TIME + tMs;
      engine.ingest(value, receivedAt);
      snapshots.push(engine.sample(receivedAt, { consumeCollision: false }));
    });
    return snapshots;
  };

  assert.deepEqual(runReplay(), runReplay());
  assert.throws(() => validatePoseRecording({
    ...recording,
    frames: [recording.frames[1], recording.frames[0]]
  }), /fora de ordem/);
});

test('real-time replay scales the first frame delay and rejects invalid speed', () => {
  const recording = {
    schema: 'mexemundo.pose-sequence',
    version: 1,
    coordinateSpace: 'normalized-mirrored',
    frames: [{ tMs: 100, pose: pose({ sequence: 1 }) }]
  };
  const delays = [];
  const playback = playPoseRecording(recording, () => {}, {
    speed: 2,
    clock: () => 0,
    setTimer: (_callback, delay) => {
      delays.push(delay);
      return 1;
    },
    clearTimer: () => {}
  });

  assert.deepEqual(delays, [50]);
  playback.stop();
  assert.throws(() => playPoseRecording(recording, () => {}, { speed: Number.NaN }), /positivo/);
  assert.throws(() => playPoseRecording(recording, () => {}, { speed: 0 }), /positivo/);
});

test('debug replay blocks live ingestion and reset cancels its timer safely', () => {
  const engine = new MotionEngine({ profile: 'game' });
  const globalName = '__motionReplayTest';
  const recording = {
    schema: 'mexemundo.pose-sequence',
    version: 1,
    coordinateSpace: 'normalized-mirrored',
    frames: [{ tMs: 100, pose: pose({ sequence: 500 }) }]
  };
  const scheduled = new Map();
  let timerId = 0;
  const api = installMotionDebug(engine, { globalName });

  assert.throws(() => api.play(recording, { speed: Number.NaN }), /positivo/);
  assert.equal(engine.replayActive, false);

  api.play(recording, {
    setTimer: (callback) => {
      const id = ++timerId;
      scheduled.set(id, callback);
      return id;
    },
    clearTimer: (id) => scheduled.delete(id)
  });
  assert.equal(engine.replayActive, true);
  assert.equal(scheduled.size, 1);

  engine.reset();
  assert.equal(engine.replayActive, false);
  assert.equal(scheduled.size, 0);
  assert.equal(engine.ingest(pose({ sequence: 1 }), BASE_TIME), true);
  delete globalThis[globalName];
});

test('metrics report frequency, latency, display distance and transport drops', () => {
  const engine = new MotionEngine({
    profile: 'game',
    calibration: { jitter: 0.003, deadZone: 0.0096 }
  });
  engine.setTransportMetrics({
    mode: 'direct',
    rtt: 40,
    sequenceGaps: 5,
    outOfOrderOrDuplicate: 3,
    coalesced: 4,
    dropped: 9,
    expired: 2,
    bufferedAmount: 17
  });

  engine.ingest(pose({ sequence: 10, processingMs: 12 }), BASE_TIME);
  engine.ingest(pose({
    sequence: 13,
    rightX: 0.656,
    rightVx: 0.18,
    processingMs: 12
  }), BASE_TIME + FRAME_MS);
  assert.equal(engine.ingest(pose({ sequence: 12 }), BASE_TIME + 2 * FRAME_MS), false);

  const snapshot = engine.sample(BASE_TIME + FRAME_MS + 10);
  const metrics = snapshot.metrics;
  assertClose(metrics.poseFrequencyHz, 30, 1e-6);
  assertClose(metrics.sourcePoseFrequencyHz, 30, 1e-6);
  assertClose(metrics.estimatedLatencyMs, 42, 1e-6);
  assert.equal(metrics.posesAccepted, 2);
  assert.equal(metrics.sequenceGaps, 5);
  assert.equal(metrics.staleOrOutOfOrder, 4);
  assert.equal(metrics.droppedFrames, 9);
  assert.equal(metrics.outgoingCoalesced, 4);
  assert.equal(metrics.expired, 2);
  assert.equal(metrics.bufferedAmount, 17);
  assert.equal(metrics.transportMode, 'direct');
  assert.ok(metrics.receivedDisplayedDistance > 0);
  assert.ok(metrics.receivedDisplayedMax >= metrics.receivedDisplayedDistance);

  const captureAgeEngine = new MotionEngine({ profile: 'game' });
  captureAgeEngine.setTransportMetrics({ rtt: 100 });
  captureAgeEngine.ingest(pose({ sequence: 1, captureAgeMs: 27 }), BASE_TIME);
  assertClose(
    captureAgeEngine.sample(BASE_TIME + 5).metrics.estimatedLatencyMs,
    32,
    1e-6
  );
});
