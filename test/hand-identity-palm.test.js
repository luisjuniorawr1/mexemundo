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
    left: { indices: [15, 17, 19, 21], x: 1 - leftScreenX, wrist: leftWrist, tips: leftTips },
    right: { indices: [16, 18, 20, 22], x: 1 - rightScreenX, wrist: rightWrist, tips: rightTips }
  };

  for (const group of Object.values(groups)) {
    group.indices.forEach((landmark, index) => {
      const visibility = index === 0 ? group.wrist : group.tips[index - 1];
      pose[landmark] = point(group.x, 0.52 - index * 0.02, visibility);
    });
  }
  return pose;
}

test('mão direita isolada nunca vira esquerda por proximidade', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose({ leftScreenX: 0.30, rightScreenX: 0.70 }), 100);

  const output = guard.stabilize(makePose({
    leftWrist: 0,
    leftTips: [0, 0, 0],
    rightScreenX: 0.49
  }), 140);

  assert.equal(output[15].visibility, 0);
  assert.ok(output[16].visibility > 0.2);
  assert.ok(Math.abs((1 - output[16].x) - 0.49) < 0.02);
});

test('palma com dois pontos de dedos mantém o pulso ativo', () => {
  const guard = new HandIdentityGuard();
  const output = guard.stabilize(makePose({
    leftWrist: 0.08,
    leftTips: [0.92, 0.88, 0.05]
  }), 100);

  assert.ok(output[15].visibility >= 0.25);
  assert.ok(Math.abs((1 - output[15].x) - 0.30) < 0.02);
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
