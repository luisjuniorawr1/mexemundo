import test from 'node:test';
import assert from 'node:assert/strict';

import { HandDropoutBridge } from '../public/js/hand-dropout-bridge.js';
import { HandIdentityGuard } from '../public/js/hand-identity-guard.js';

function point(x, y = 0.52, visibility = 0.95) {
  return { x, y, z: 0, visibility, presence: visibility };
}

function hidden() {
  return point(0.5, 0.52, 0);
}

function makePose({
  leftX = 0.30,
  rightX = 0.70,
  leftVisible = true,
  rightVisible = true,
  leftVisibility = 0.95,
  rightVisibility = 0.95
} = {}) {
  const pose = Array.from({ length: 33 }, hidden);
  const rawLeftX = 1 - leftX;
  const rawRightX = 1 - rightX;

  const leftPoints = [15, 17, 19, 21];
  const rightPoints = [16, 18, 20, 22];
  for (const [index, landmark] of leftPoints.entries()) {
    pose[landmark] = point(
      rawLeftX,
      0.52 - index * 0.02,
      leftVisible ? leftVisibility : 0
    );
  }
  for (const [index, landmark] of rightPoints.entries()) {
    pose[landmark] = point(
      rawRightX,
      0.52 - index * 0.02,
      rightVisible ? rightVisibility : 0
    );
  }
  return pose;
}

function screenX(pose, landmark) {
  return 1 - pose[landmark].x;
}

test('mão esquerda isolada conserva o lado anatômico', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose({ leftX: 0.40, rightX: 0.60 }), 100);
  guard.stabilize(makePose({ leftX: 0.42, rightX: 0.58 }), 120);

  const output = guard.stabilize(makePose({
    leftX: 0.52,
    leftVisible: true,
    rightVisible: false
  }), 140);

  assert.ok(output[15].visibility >= 0.30);
  assert.equal(output[16].visibility, 0);
  assert.ok(Math.abs(screenX(output, 15) - 0.52) < 0.03);
});

test('salto impossível é delegado à ponte com tempos separados', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose({ leftX: 0.30, rightX: 0.70 }), 100);

  const rejected = guard.stabilize(makePose({
    leftX: 0.82,
    rightX: 0.68
  }), 116);
  assert.equal(rejected[15].visibility, 0);

  const bridge = new HandDropoutBridge();
  bridge.ingest({ x: 0.30, y: 0.52, vx: 0, vy: 0, visible: true }, 100);
  const visual = bridge.sample(
    { x: 0.82, y: 0.52, vx: 0, vy: 0, visible: false },
    216,
    220
  );
  const collision = bridge.sample(
    { x: 0.82, y: 0.52, vx: 0, vy: 0, visible: false },
    216,
    80
  );

  assert.equal(visual.visible, true);
  assert.equal(visual.x, 0.30);
  assert.equal(collision.visible, false);
});

test('pulso aceito com confiança intermediária chega visível ao filtro final', () => {
  const guard = new HandIdentityGuard();
  const output = guard.stabilize(makePose({
    leftVisibility: 0.22,
    rightVisibility: 0.95
  }), 100);

  assert.ok(output[15].visibility >= 0.32);
  assert.equal(output[17].visibility, 0.22);
});

test('troca do detector precisa persistir antes de alterar a associação', () => {
  const guard = new HandIdentityGuard();
  guard.stabilize(makePose({ leftX: 0.30, rightX: 0.70 }), 100);

  const transient = guard.stabilize(makePose({
    leftX: 0.70,
    rightX: 0.30
  }), 140);
  assert.equal(transient[15].visibility, 0);
  assert.equal(transient[16].visibility, 0);

  guard.stabilize(makePose({ leftX: 0.70, rightX: 0.30 }), 240);
  const persistent = guard.stabilize(makePose({
    leftX: 0.70,
    rightX: 0.30
  }), 330);
  assert.ok(Math.abs(screenX(persistent, 15) - 0.30) < 0.03);
  assert.ok(Math.abs(screenX(persistent, 16) - 0.70) < 0.03);
});

test('cruzamento anatômico contínuo conserva cada mão', () => {
  const guard = new HandIdentityGuard();
  const frames = [
    [0.30, 0.70],
    [0.40, 0.60],
    [0.49, 0.51],
    [0.58, 0.42],
    [0.68, 0.32]
  ];

  frames.forEach(([leftX, rightX], index) => {
    const output = guard.stabilize(
      makePose({ leftX, rightX }),
      100 + index * 40
    );
    assert.ok(Math.abs(screenX(output, 15) - leftX) < 0.04);
    assert.ok(Math.abs(screenX(output, 16) - rightX) < 0.04);
  });
});
