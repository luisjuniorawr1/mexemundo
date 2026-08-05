import test from 'node:test';
import assert from 'node:assert/strict';

import { StableDwellActivation } from '../public/js/stable-dwell-activation.js';

function advance(dwell, target, startAt, durationMs, movement = 0.001) {
  let state = null;
  for (let elapsed = 0; elapsed <= durationMs; elapsed += 50) {
    const direction = Math.floor(elapsed / 50) % 2 ? 1 : -1;
    state = dwell.update({
      target,
      x: 0.5 + movement * direction,
      y: 0.5 - movement * direction,
      visible: true
    }, startAt + elapsed);
  }
  return state;
}

test('permanência estável ativa depois de cinco segundos', () => {
  const dwell = new StableDwellActivation();
  const target = { id: 'balloons' };
  const state = advance(dwell, target, 100, 5200);

  assert.equal(state.activate, true);
  assert.equal(state.target, target);
});

test('trocar de item reinicia o progresso', () => {
  const dwell = new StableDwellActivation();
  const first = { id: 'balloons' };
  const second = { id: 'goalkeeper' };

  const before = advance(dwell, first, 100, 2500);
  assert.ok(before.progress > 0.4);

  const changed = dwell.update({
    target: second,
    x: 0.6,
    y: 0.5,
    visible: true
  }, 2650);
  assert.equal(changed.progress, 0);
  assert.equal(changed.activate, false);
});

test('tremor leve não zera continuamente a permanência', () => {
  const dwell = new StableDwellActivation();
  const target = { id: 'balloons' };

  let state = advance(dwell, target, 100, 1800, 0.0025);
  const accumulated = state.progress;
  assert.ok(accumulated > 0.25);

  state = dwell.update({
    target,
    x: 0.515,
    y: 0.5,
    visible: true
  }, 1950);
  assert.ok(state.progress > 0);
  assert.ok(state.progress < accumulated);
});

test('saindo do item cancela a seleção', () => {
  const dwell = new StableDwellActivation();
  const target = { id: 'balloons' };
  advance(dwell, target, 100, 2000);

  const state = dwell.update({
    target: null,
    x: 0.8,
    y: 0.8,
    visible: true
  }, 2200);
  assert.equal(state.progress, 0);
  assert.equal(state.activate, false);
});
