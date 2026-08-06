import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TwoHandStartHold,
  twoHandsAtShoulderHeight
} from '../public/js/two-hand-start-gate.js';

function pose({
  leftY = 0.42,
  rightY = 0.43,
  leftShoulderY = 0.35,
  rightShoulderY = 0.36,
  leftVisible = true,
  rightVisible = true
} = {}) {
  return {
    detected: true,
    left: { x: 0.35, y: leftY, visible: leftVisible },
    right: { x: 0.65, y: rightY, visible: rightVisible },
    leftShoulder: { x: 0.43, y: leftShoulderY, visible: true },
    rightShoulder: { x: 0.57, y: rightShoulderY, visible: true }
  };
}

test('aceita as duas mãos próximas dos próprios ombros', () => {
  assert.equal(twoHandsAtShoulderHeight(pose()), true);
});

test('não exige as mãos acima do ombro mais alto', () => {
  assert.equal(twoHandsAtShoulderHeight(pose({
    leftY: 0.43,
    rightY: 0.44,
    leftShoulderY: 0.34,
    rightShoulderY: 0.38
  })), true);
});

test('não inicia quando uma mão está baixa', () => {
  assert.equal(twoHandsAtShoulderHeight(pose({ rightY: 0.58 })), false);
});

test('não inicia com apenas uma mão visível', () => {
  assert.equal(twoHandsAtShoulderHeight(pose({ leftVisible: false })), false);
});

test('exige permanência contínua antes de ativar', () => {
  const hold = new TwoHandStartHold({ holdMs: 700 });
  assert.equal(hold.update(true, 1000), false);
  assert.equal(hold.update(true, 1600), false);
  assert.equal(hold.update(true, 1700), true);
  assert.equal(hold.update(true, 1800), false);
});

test('uma perda reinicia a permanência', () => {
  const hold = new TwoHandStartHold({ holdMs: 700 });
  hold.update(true, 1000);
  assert.equal(hold.update(false, 1400), false);
  assert.equal(hold.update(true, 1800), false);
  assert.equal(hold.update(true, 2500), true);
});
