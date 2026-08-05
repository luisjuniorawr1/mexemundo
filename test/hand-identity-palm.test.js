import test from 'node:test';
import assert from 'node:assert/strict';

import { HandIdentityGuard } from '../public/js/hand-identity-guard.js';

function point(x, y = 0.52, visibility = 0.95) {
  return { x, y, z: 0, visibility, presence: visibility };
}

function hiddenPoint() {
  return point(0.5, 0.52, 0);
}

function makePose({
  leftScreenX = 0.30,
  rightScreenX = 0.70,
  leftWrist = 0.95,
  rightWrist = 0.95,
  leftTips = [0.95, 0.95, 0.95],
  rightTips = [0.95, 0.95, 0.95]
} = {}) {
  const pose = Array.from({ length: 33 }, hiddenPoint);
  const groups = {
    left: {
      indices: [15, 17, 19, 21],
      x: 1 - leftScreenX,
      wrist: leftWrist,
      tips: leftTips
    },
    right: {
      indices: [16, 18, 20, 22],
      x: 1 - rightScreenX,
      wrist: rightWrist,
      tips: rightTips
    }
  };

  for (const group of Object.values(groups)) {
    group.indices.forEach((landmark, index) => {
      const visibility = index === 0 ? group.wrist : group.tips[index - 1];
      pose[landmark] = point(group.x, 0.52 - index * 0.02, visibility);
    });
  }

  return pose;
}

function screenX(pointValue) {
  return 1 - pointValue.x;
}

test('mão direita isolada nunca vira esquerda', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose(), 100);

  const output = guard.stabilize(makePose({
    leftWrist: 0,
    leftTips: [0, 0, 0],
    rightScreenX: 0.31
  }), 140);

  assert.equal(output[15].visibility, 0);
  assert.ok(output[16].visibility > 0.2);
  assert.ok(Math.abs(screenX(output[16]) - 0.31) < 0.02);
});

test('cruzar as mãos não troca os índices anatômicos', () => {
  const guard = new HandIdentityGuard();
  const output = guard.stabilize(makePose({
    leftScreenX: 0.78,
    rightScreenX: 0.22
  }), 100);

  assert.ok(Math.abs(screenX(output[15]) - 0.78) < 0.02);
  assert.ok(Math.abs(screenX(output[16]) - 0.22) < 0.02);
});

test('desaparecer e reaparecer não altera o lado', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose(), 100);
  guard.stabilize(makePose({
    leftWrist: 0,
    leftTips: [0, 0, 0],
    rightScreenX: 0.42
  }), 140);

  const output = guard.stabilize(makePose({
    leftScreenX: 0.64,
    rightScreenX: 0.36
  }), 180);

  assert.ok(Math.abs(screenX(output[15]) - 0.64) < 0.02);
  assert.ok(Math.abs(screenX(output[16]) - 0.36) < 0.02);
});

test('palma com dois pontos de dedos mantém o pulso ativo', () => {
  const guard = new HandIdentityGuard();
  const output = guard.stabilize(makePose({
    leftWrist: 0.08,
    leftTips: [0.92, 0.88, 0.05]
  }), 100);

  assert.ok(output[15].visibility >= 0.25);
  assert.ok(Math.abs(screenX(output[15]) - 0.30) < 0.02);
});

test('um único ponto de dedo não cria uma mão fantasma', () => {
  const guard = new HandIdentityGuard();
  const output = guard.stabilize(makePose({
    leftWrist: 0.08,
    leftTips: [0.92, 0.05, 0.05]
  }), 100);

  assert.equal(output[15].visibility, 0);
  assert.ok(output[16].visibility > 0.2);
});
