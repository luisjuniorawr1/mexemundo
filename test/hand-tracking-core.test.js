import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTrackingCore } from '../public/js/hand-tracking-core.js';

function point(x, y, z = 0) {
  return { x, y, z };
}

function makeLandmarks(cx, cy, scale = 0.10) {
  const landmarks = Array.from({ length: 21 }, () => point(cx, cy));
  landmarks[0] = point(cx, cy + scale * 0.55);
  landmarks[5] = point(cx - scale * 0.45, cy);
  landmarks[9] = point(cx, cy - scale * 0.18);
  landmarks[13] = point(cx + scale * 0.22, cy);
  landmarks[17] = point(cx + scale * 0.45, cy);
  landmarks[2] = point(cx - scale * 0.32, cy + scale * 0.10);
  landmarks[4] = point(cx - scale * 0.60, cy - scale * 0.15);
  landmarks[8] = point(cx - scale * 0.35, cy - scale * 0.95);
  landmarks[12] = point(cx, cy - scale * 1.05);
  landmarks[16] = point(cx + scale * 0.30, cy - scale * 0.92);
  landmarks[20] = point(cx + scale * 0.55, cy - scale * 0.75);
  return landmarks;
}

function result(hands) {
  return {
    landmarks: hands.map((hand) => makeLandmarks(hand.x, hand.y, hand.scale)),
    handednesses: hands.map((hand) => [{ categoryName: hand.label, score: hand.score ?? 0.95 }])
  };
}

test('mantém a identidade quando a ordem das detecções muda', () => {
  const core = new HandTrackingCore({ mirrorX: false });
  let snapshot = core.ingest(result([
    { label: 'Right', x: 0.25, y: 0.55, scale: 0.10 },
    { label: 'Left', x: 0.75, y: 0.55, scale: 0.10 }
  ]), 1000);

  assert.equal(snapshot.hands[0].handedness, 'right');
  assert.equal(snapshot.hands[1].handedness, 'left');

  snapshot = core.ingest(result([
    { label: 'Left', x: 0.73, y: 0.55, scale: 0.10 },
    { label: 'Right', x: 0.27, y: 0.55, scale: 0.10 }
  ]), 1033);

  assert.equal(snapshot.hands[0].handedness, 'right');
  assert.equal(snapshot.hands[1].handedness, 'left');
  assert.ok(snapshot.hands[0].raw.x < snapshot.hands[1].raw.x);
});

test('não troca as mãos quando elas cruzam', () => {
  const core = new HandTrackingCore({ mirrorX: false });
  core.ingest(result([
    { label: 'Right', x: 0.30, y: 0.55, scale: 0.11 },
    { label: 'Left', x: 0.70, y: 0.55, scale: 0.11 }
  ]), 1000);

  core.ingest(result([
    { label: 'Left', x: 0.55, y: 0.55, scale: 0.11 },
    { label: 'Right', x: 0.45, y: 0.55, scale: 0.11 }
  ]), 1066);

  const snapshot = core.ingest(result([
    { label: 'Left', x: 0.42, y: 0.55, scale: 0.11 },
    { label: 'Right', x: 0.58, y: 0.55, scale: 0.11 }
  ]), 1099);

  assert.equal(snapshot.hands[0].handedness, 'right');
  assert.equal(snapshot.hands[1].handedness, 'left');
  assert.ok(snapshot.hands[0].raw.x > snapshot.hands[1].raw.x);
});

test('preserva a trilha durante uma oclusão curta e recupera sem trocar', () => {
  const core = new HandTrackingCore({ mirrorX: false });
  core.ingest(result([
    { label: 'Right', x: 0.28, y: 0.52, scale: 0.10 },
    { label: 'Left', x: 0.72, y: 0.52, scale: 0.10 }
  ]), 1000);

  let snapshot = core.ingest(result([
    { label: 'Right', x: 0.30, y: 0.52, scale: 0.10 }
  ]), 1080);

  assert.equal(snapshot.hands[0].handedness, 'right');
  assert.equal(snapshot.hands[1].handedness, 'left');
  assert.equal(snapshot.hands[1].visible, true);

  snapshot = core.ingest(result([
    { label: 'Left', x: 0.70, y: 0.52, scale: 0.10 },
    { label: 'Right', x: 0.32, y: 0.52, scale: 0.10 }
  ]), 1140);

  assert.equal(snapshot.hands[0].handedness, 'right');
  assert.equal(snapshot.hands[1].handedness, 'left');
  assert.ok(snapshot.hands[0].raw.x < snapshot.hands[1].raw.x);
});
