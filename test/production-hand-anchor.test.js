import test from 'node:test';
import assert from 'node:assert/strict';

import { StrictPhysicalHandCore } from '../public/js/production-hand-anchor.js';

function hand(screenX, screenY, label, score = 0.95) {
  const rawX = 1 - screenX;
  const landmarks = Array.from({ length: 21 }, (_, index) => ({
    x: rawX + ((index % 3) - 1) * 0.004,
    y: screenY + (Math.floor(index / 3) - 3) * 0.003,
    z: 0
  }));
  for (const index of [0, 5, 9, 13, 17]) {
    landmarks[index] = { x: rawX, y: screenY, z: 0 };
  }
  return {
    landmarks,
    handedness: [{ categoryName: label, score }]
  };
}

function result(...hands) {
  return {
    landmarks: hands.map((item) => item.landmarks),
    handednesses: hands.map((item) => item.handedness)
  };
}

function initialize(core) {
  const right = hand(0.30, 0.55, 'Right');
  const left = hand(0.70, 0.55, 'Left');
  core.ingest(result(right, left), 0);
  return core.ingest(result(right, left), 250);
}

test('aprende a relação entre lateralidade do detector e mãos físicas', () => {
  const core = new StrictPhysicalHandCore();
  const snapshot = initialize(core);
  assert.equal(snapshot.labelMapReady, true);
  assert.ok(Math.abs(snapshot.right.raw.x - 0.30) < 0.02);
  assert.ok(Math.abs(snapshot.left.raw.x - 0.70) < 0.02);
});

test('cruzamento mantém direita e esquerda pelos rótulos das palmas', () => {
  const core = new StrictPhysicalHandCore();
  initialize(core);

  let snapshot;
  let now = 300;
  for (const [rightX, leftX] of [
    [0.42, 0.58],
    [0.54, 0.46],
    [0.66, 0.34],
    [0.76, 0.24]
  ]) {
    snapshot = core.ingest(result(
      hand(rightX, 0.50, 'Right'),
      hand(leftX, 0.50, 'Left')
    ), now);
    now += 45;
  }

  assert.ok(Math.abs(snapshot.right.raw.x - 0.76) < 0.02);
  assert.ok(Math.abs(snapshot.left.raw.x - 0.24) < 0.02);
});

test('uma única palma com lateralidade forte não rouba a outra mão', () => {
  const core = new StrictPhysicalHandCore();
  initialize(core);

  const snapshot = core.ingest(result(
    hand(0.48, 0.52, 'Right')
  ), 300);

  assert.ok(Math.abs(snapshot.right.raw.x - 0.48) < 0.02);
  assert.ok(Math.abs(snapshot.left.raw.x - 0.70) < 0.02);
});

test('salto isolado é rejeitado sem puxar o sensor', () => {
  const core = new StrictPhysicalHandCore();
  initialize(core);

  const snapshot = core.ingest(result(
    hand(0.96, 0.08, 'Right'),
    hand(0.70, 0.55, 'Left')
  ), 300);

  assert.ok(Math.abs(snapshot.right.raw.x - 0.30) < 0.02);
  assert.equal(snapshot.right.visible, true);
});

test('mão ausente deixa de ser visível após a tolerância', () => {
  const core = new StrictPhysicalHandCore();
  initialize(core);
  core.ingest(result(hand(0.30, 0.55, 'Right')), 300);
  const snapshot = core.sample(600);
  assert.equal(snapshot.left.visible, false);
});
