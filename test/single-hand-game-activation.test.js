import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptPoseForSingleHandActivation } from '../public/js/single-hand-game-activation.js';

function point(x, y, visible = true) {
  return { x, y, vx: 0, vy: 0, visible };
}

function pose({ leftY = 0.55, rightVisible = false } = {}) {
  return {
    detected: true,
    sequence: 1,
    leftShoulder: point(0.43, 0.42),
    rightShoulder: point(0.57, 0.42),
    left: point(0.35, leftY),
    right: point(0.65, 0.55, rightVisible)
  };
}

test('uma mão levantada libera o sinal de início esperado pelos jogos', () => {
  const original = pose({ leftY: 0.30 });
  const adapted = adaptPoseForSingleHandActivation(original);

  assert.notEqual(adapted, original);
  assert.equal(adapted.left.visible, true);
  assert.equal(adapted.right.visible, true);
  assert.ok(adapted.left.y < adapted.leftShoulder.y);
  assert.ok(adapted.right.y < adapted.rightShoulder.y);
});

test('o pacote original não é modificado', () => {
  const original = pose({ leftY: 0.30 });
  adaptPoseForSingleHandActivation(original);

  assert.equal(original.right.visible, false);
  assert.equal(original.right.y, 0.55);
});

test('mão abaixo do ombro não ativa o início', () => {
  const original = pose({ leftY: 0.56 });
  const adapted = adaptPoseForSingleHandActivation(original);

  assert.equal(adapted, original);
});

test('sem ombros visíveis o pacote permanece intacto', () => {
  const original = pose({ leftY: 0.30 });
  original.rightShoulder.visible = false;
  const adapted = adaptPoseForSingleHandActivation(original);

  assert.equal(adapted, original);
});
