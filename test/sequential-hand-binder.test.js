import test from 'node:test';
import assert from 'node:assert/strict';

import { SequentialHandBinder } from '../public/js/sequential-hand-binder.js';

const CONFIG = {
  supportVisibility: 0.18,
  wristVisibility: 0.24,
  armVisibility: 0.18,
  minimumSupportPoints: 2,
  raiseShoulderTolerance: 0.08,
  minimumEvidence: 0.42,
  minimumEvidenceAdvantage: 0.10,
  maximumStillStep: 0.030,
  holdMs: 100,
  minimumCalibrationSamples: 3,
  maximumCalibrationSamples: 60,
  maximumWristPalmDisagreement: 0.11,
  maximumSensorJump: 0.24,
  dropoutHoldMs: 180,
  reacquireAfterMs: 350,
  trustedOutputVisibility: 0.25,
  statusBroadcastIntervalMs: 300
};

function point(x = 0.5, y = 0.5, visibility = 0) {
  return { x, y, z: 0, visibility, presence: visibility };
}

function makePose({
  leftRaised = false,
  rightRaised = false,
  leftX = 0.30,
  rightX = 0.70,
  leftVisibility = 0.95,
  rightVisibility = 0.95,
  leftWristVisibility = leftVisibility,
  rightWristVisibility = rightVisibility
} = {}) {
  const pose = Array.from({ length: 33 }, () => point());
  pose[11] = point(0.42, 0.35, 0.95);
  pose[12] = point(0.58, 0.35, 0.95);
  pose[13] = point(0.38, leftRaised ? 0.34 : 0.50, 0.95);
  pose[14] = point(0.62, rightRaised ? 0.34 : 0.50, 0.95);

  const leftY = leftRaised ? 0.25 : 0.65;
  const rightY = rightRaised ? 0.25 : 0.65;
  pose[15] = point(leftX, leftY, leftWristVisibility);
  pose[16] = point(rightX, rightY, rightWristVisibility);

  for (const index of [17, 19, 21]) {
    pose[index] = point(leftX + (index - 19) * 0.005, leftY - 0.03, leftVisibility);
  }
  for (const index of [18, 20, 22]) {
    pose[index] = point(rightX + (index - 20) * 0.005, rightY - 0.03, rightVisibility);
  }
  return pose;
}

function holdStage(binder, poseFactory, startAt) {
  for (const offset of [0, 45, 105]) {
    binder.update(poseFactory(), startAt + offset);
  }
}

function configuredBinder({ reversed = false } = {}) {
  const binder = new SequentialHandBinder(CONFIG);
  holdStage(
    binder,
    () => makePose(reversed ? { leftRaised: true } : { rightRaised: true }),
    0
  );
  holdStage(
    binder,
    () => makePose(reversed ? { rightRaised: true } : { leftRaised: true }),
    220
  );
  assert.equal(binder.ready, true);
  return binder;
}

test('configura primeiro a direita e depois a esquerda', () => {
  const binder = configuredBinder();
  assert.equal(binder.bindings.right, 'right');
  assert.equal(binder.bindings.left, 'left');
});

test('cada saída usa o grupo capturado na própria etapa', () => {
  const binder = configuredBinder({ reversed: true });
  assert.equal(binder.bindings.right, 'left');
  assert.equal(binder.bindings.left, 'right');

  const output = binder.update(makePose({
    leftRaised: true,
    rightRaised: true,
    leftX: 0.28,
    rightX: 0.74
  }), 500).pose;

  assert.ok(Math.abs(output[16].x - 0.28) < 0.002);
  assert.ok(Math.abs(output[15].x - 0.74) < 0.002);
});

test('cruzamento gradual não troca os sensores configurados', () => {
  const binder = configuredBinder();
  let output;
  let now = 500;

  for (const [leftX, rightX] of [
    [0.42, 0.58],
    [0.54, 0.46],
    [0.66, 0.34],
    [0.78, 0.22]
  ]) {
    output = binder.update(makePose({
      leftRaised: true,
      rightRaised: true,
      leftX,
      rightX
    }), now).pose;
    now += 50;
  }

  assert.ok(Math.abs(output[15].x - 0.78) < 0.002);
  assert.ok(Math.abs(output[16].x - 0.22) < 0.002);
});

test('perda curta segura o próprio sensor sem usar a outra mão', () => {
  const binder = configuredBinder();
  binder.update(makePose({ leftRaised: true, rightRaised: true }), 500);

  const output = binder.update(makePose({
    leftRaised: true,
    rightRaised: false,
    rightVisibility: 0,
    rightWristVisibility: 0,
    leftX: 0.36
  }), 560).pose;

  assert.ok(output[16].visibility >= 0.25);
  assert.ok(Math.abs(output[16].x - 0.70) < 0.002);
  assert.ok(Math.abs(output[15].x - 0.36) < 0.002);
});

test('salto do pulso é substituído pela palma configurada', () => {
  const binder = configuredBinder();
  binder.update(makePose({ leftRaised: true, rightRaised: true }), 500);

  const raw = makePose({
    leftRaised: true,
    rightRaised: true,
    rightX: 0.65
  });
  raw[16] = point(0.98, 0.02, 0.95);
  raw[18] = point(0.64, 0.22, 0.95);
  raw[20] = point(0.65, 0.22, 0.95);
  raw[22] = point(0.66, 0.22, 0.95);

  const output = binder.update(raw, 550).pose;
  assert.ok(output[16].x < 0.80);
  assert.ok(output[16].y > 0.15);
});
