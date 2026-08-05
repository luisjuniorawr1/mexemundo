import test from 'node:test';
import assert from 'node:assert/strict';

import { HAND_SYSTEM_CONFIG } from '../public/js/hand-system-config.js';
import { evaluateTwoHandStartup } from '../public/js/two-hand-startup-check.js';

const CONFIG = HAND_SYSTEM_CONFIG.startupCheck;

function point(x, y, visible = true, vx = 0, vy = 0) {
  return { x, y, visible, vx, vy };
}

function frame({
  left = point(0.30, 0.55),
  right = point(0.70, 0.55),
  shoulders = true
} = {}) {
  return {
    fresh: true,
    detected: true,
    left,
    right,
    leftShoulder: point(0.43, 0.35, shoulders),
    rightShoulder: point(0.57, 0.35, shoulders)
  };
}

test('uma mão não conclui a verificação inicial', () => {
  const result = evaluateTwoHandStartup(frame({
    right: point(0.70, 0.55, false)
  }), CONFIG);

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'missing-hands');
});

test('duas mãos muito próximas não concluem a verificação', () => {
  const result = evaluateTwoHandStartup(frame({
    left: point(0.48, 0.55),
    right: point(0.54, 0.55)
  }), CONFIG);

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'hands-too-close');
});

test('duas mãos separadas e estáveis concluem a verificação', () => {
  const result = evaluateTwoHandStartup(frame(), CONFIG);

  assert.equal(result.ready, true);
  assert.equal(result.reason, 'ready');
  assert.ok(result.separation >= CONFIG.minimumHandSeparation);
});

test('movimento excessivo reinicia a verificação', () => {
  const result = evaluateTwoHandStartup(frame({
    left: point(0.30, 0.55, true, CONFIG.maximumStillSpeed + 0.1, 0)
  }), CONFIG);

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'moving');
});
