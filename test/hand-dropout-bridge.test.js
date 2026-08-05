import test from 'node:test';
import assert from 'node:assert/strict';

import { HandDropoutBridge } from '../public/js/hand-dropout-bridge.js';

const visible = {
  x: 0.3,
  y: 0.4,
  vx: 0.8,
  vy: -0.2,
  visible: true
};
const missing = {
  x: 0.5,
  y: 0.5,
  vx: 0,
  vy: 0,
  visible: false
};

test('perda curta preserva a última posição e zera a velocidade', () => {
  const bridge = new HandDropoutBridge();
  bridge.ingest(visible, 100);
  const output = bridge.sample(missing, 250, 220);

  assert.equal(output.visible, true);
  assert.equal(output.bridged, true);
  assert.equal(output.x, visible.x);
  assert.equal(output.vx, 0);
});

test('perda longa não cria mão fantasma', () => {
  const bridge = new HandDropoutBridge();
  bridge.ingest(visible, 100);
  const output = bridge.sample(missing, 400, 220);

  assert.equal(output.visible, false);
  assert.equal(output.bridged, undefined);
});

test('nova posição visível substitui imediatamente a posição antiga', () => {
  const bridge = new HandDropoutBridge();
  bridge.ingest(visible, 100);
  const next = {
    x: 0.55,
    y: 0.42,
    vx: 0.2,
    vy: 0,
    visible: true
  };
  bridge.ingest(next, 180);

  assert.deepEqual(bridge.sample(next, 180, 220), next);
});

test('reset remove qualquer retenção anterior', () => {
  const bridge = new HandDropoutBridge();
  bridge.ingest(visible, 100);
  bridge.reset();

  assert.equal(bridge.sample(missing, 150, 220).visible, false);
});
