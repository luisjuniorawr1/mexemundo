import test from 'node:test';
import assert from 'node:assert/strict';

import { MexeFlowPoint } from '../public/js/mexeflow.js';
import { PoseFistGestureTracker } from '../public/js/pose-gesture.js';
import { FistActivation } from '../public/js/fist-activation.js';

function point(x, y, visibility = 0.95) {
  return { x, y, visibility };
}

function makePose({ closed = false, hideThumb = false } = {}) {
  const pose = Array.from({ length: 33 }, () => point(0.5, 0.5, 0));
  pose[11] = point(0.4, 0.4);
  pose[12] = point(0.6, 0.4);

  pose[15] = point(0.35, 0.52);
  pose[16] = point(0.65, 0.52);

  const leftTips = closed
    ? [point(0.348, 0.505), point(0.355, 0.507), point(0.343, 0.510)]
    : [point(0.29, 0.47), point(0.31, 0.44), point(0.34, 0.43)];
  const rightTips = closed
    ? [point(0.652, 0.505), point(0.645, 0.507), point(0.657, 0.510)]
    : [point(0.71, 0.47), point(0.69, 0.44), point(0.66, 0.43)];

  [pose[17], pose[19], pose[21]] = leftTips;
  [pose[18], pose[20], pose[22]] = rightTips;
  if (hideThumb) pose[22] = point(0.66, 0.43, 0.02);
  return pose;
}

test('MexeFlow segura tremor pequeno depois do repouso', () => {
  const flow = new MexeFlowPoint({ x: 0.5, y: 0.5 });
  let now = 100;
  flow.update({ x: 0.5, y: 0.5, vx: 0, vy: 0, visible: true }, now);

  const outputs = [];
  for (let index = 0; index < 20; index += 1) {
    now += 16.67;
    const jitter = index % 2 ? 0.003 : -0.003;
    outputs.push(flow.update({
      x: 0.5 + jitter,
      y: 0.5 - jitter,
      vx: 0.05,
      vy: -0.04,
      visible: true
    }, now));
  }

  const xs = outputs.slice(-8).map((output) => output.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.0025);
});

test('MexeFlow limita atraso em movimento rápido', () => {
  const flow = new MexeFlowPoint({ x: 0.5, y: 0.5 });
  flow.update({ x: 0.5, y: 0.5, vx: 0, vy: 0, visible: true }, 100);
  const output = flow.update({
    x: 0.72,
    y: 0.5,
    vx: 1.4,
    vy: 0,
    visible: true
  }, 116.67);

  assert.ok(output.x >= 0.68, `posição visual ficou atrás demais: ${output.x}`);
});

test('gesto começa armado como aberto e reconhece fechamento', () => {
  const tracker = new PoseFistGestureTracker();
  let result;
  for (const now of [100, 180, 280, 360]) {
    result = tracker.update(makePose(), now);
  }
  assert.equal(result.right.state, 'open');

  for (const now of [400, 460, 530, 590]) {
    result = tracker.update(makePose({ closed: true }), now);
  }
  assert.equal(result.right.state, 'fist');
});

test('gesto funciona com dois dedos visíveis', () => {
  const tracker = new PoseFistGestureTracker();
  let result;
  for (const now of [100, 190, 290, 380]) {
    result = tracker.update(makePose({ hideThumb: true }), now);
  }
  assert.equal(result.right.state, 'open');
  assert.equal(result.right.visibleTips, 2);
});

test('fechamento dispara um clique por ciclo aberto-fechado', () => {
  const activation = new FistActivation({ side: 'right' });
  const frame = (state, openness = state === 'fist' ? 0.55 : 1) => ({
    gestures: {
      right: {
        state,
        openness,
        confidence: 0.8,
        visibleTips: 2
      }
    }
  });

  assert.equal(activation.update(frame('open')).activate, false);
  assert.equal(activation.update(frame('fist')).activate, true);
  assert.equal(activation.update(frame('fist')).activate, false);
  assert.equal(activation.update(frame('open')).activate, false);
  assert.equal(activation.update(frame('fist')).activate, true);
});
