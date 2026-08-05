import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversalHandInput } from '../public/js/game-hand-input.js';

function payload(x, vx = 0) {
  return {
    detected: true,
    sequence: 1,
    left: { x: 0.35, y: 0.55, vx: 0, vy: 0, visible: true },
    right: { x, y: 0.50, vx, vy: 0, visible: true },
    leftShoulder: { x: 0.44, y: 0.35, vx: 0, vy: 0, visible: true },
    rightShoulder: { x: 0.56, y: 0.35, vx: 0, vy: 0, visible: true },
    gestures: {
      left: { state: 'open', confidence: 1 },
      right: { state: 'open', confidence: 1 }
    }
  };
}

test('segura tremor pequeno apenas na saída visual', () => {
  const input = new UniversalHandInput();
  input.ingest(payload(0.500), 0);
  input.sample(16);

  input.ingest(payload(0.504, 0.02), 32);
  const frames = input.sample(48);

  assert.equal(frames.visual.right.x, 0.5);
  assert.equal(frames.collision.right.x, 0.504);
});

test('movimento rápido continua responsivo e gesto é preservado', () => {
  const input = new UniversalHandInput();
  input.ingest(payload(0.50), 0);
  input.sample(16);

  const next = payload(0.72, 1.2);
  next.gestures.right.state = 'fist';
  input.ingest(next, 32);
  const frames = input.sample(48);

  assert.ok(frames.visual.right.x >= 0.68);
  assert.ok(frames.collision.right.x >= 0.72);
  assert.equal(frames.visual.gestures.right.state, 'fist');
});
