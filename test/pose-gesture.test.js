import test from 'node:test';
import assert from 'node:assert/strict';
import { PoseFistGestureTracker } from '../public/js/pose-gesture.js';
import { FistActivation } from '../public/js/fist-activation.js';

function poseWithHand(reach = 0.04) {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1
  }));

  pose[11] = { x: 0.40, y: 0.35, visibility: 1 };
  pose[12] = { x: 0.60, y: 0.35, visibility: 1 };

  pose[15] = { x: 0.34, y: 0.52, visibility: 1 };
  pose[17] = { x: 0.34 - reach * 0.35, y: 0.52 - reach, visibility: 1 };
  pose[19] = { x: 0.34, y: 0.52 - reach, visibility: 1 };
  pose[21] = { x: 0.34 + reach * 0.35, y: 0.52 - reach * 0.82, visibility: 1 };

  pose[16] = { x: 0.66, y: 0.52, visibility: 1 };
  pose[18] = { x: 0.66 + reach * 0.35, y: 0.52 - reach, visibility: 1 };
  pose[20] = { x: 0.66, y: 0.52 - reach, visibility: 1 };
  pose[22] = { x: 0.66 - reach * 0.35, y: 0.52 - reach * 0.82, visibility: 1 };
  return pose;
}

test('confirma mão aberta e depois punho fechado com histerese', () => {
  const tracker = new PoseFistGestureTracker();

  tracker.update(poseWithHand(0.045), 0);
  let result = tracker.update(poseWithHand(0.045), 110);
  assert.equal(result.right.state, 'open');

  tracker.update(poseWithHand(0.010), 160);
  result = tracker.update(poseWithHand(0.010), 300);
  assert.equal(result.right.state, 'fist');

  tracker.update(poseWithHand(0.045), 340);
  result = tracker.update(poseWithHand(0.045), 450);
  assert.equal(result.right.state, 'open');
});

test('gera apenas uma ativação por fechamento', () => {
  const activation = new FistActivation();

  assert.equal(activation.update({
    gestures: { right: { state: 'open' } }
  }).activate, false);

  assert.equal(activation.update({
    gestures: { right: { state: 'fist' } }
  }).activate, true);

  assert.equal(activation.update({
    gestures: { right: { state: 'fist' } }
  }).activate, false);

  activation.update({
    gestures: { right: { state: 'open' } }
  });

  assert.equal(activation.update({
    gestures: { right: { state: 'fist' } }
  }).activate, true);
});
