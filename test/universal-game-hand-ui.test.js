import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveGameDwellMs } from '../public/js/universal-game-hand-ui.js';

function documentWith({ result = false, playing = false } = {}) {
  const nodes = {
    '#resultPanel': {
      classList: { contains: (name) => name === 'hidden' ? !result : false }
    },
    '#scoreHud': {
      classList: { contains: (name) => name === 'hidden' ? !playing : false }
    }
  };
  return { querySelector: (selector) => nodes[selector] ?? null };
}

test('usa tempo curto na tela final', () => {
  assert.equal(resolveGameDwellMs(null, documentWith({ result: true })), 2200);
});

test('usa tempo longo durante a partida', () => {
  assert.equal(resolveGameDwellMs(null, documentWith({ playing: true })), 4200);
});

test('usa tempo intermediário nas outras telas', () => {
  assert.equal(resolveGameDwellMs(null, documentWith()), 2800);
});

test('respeita tempo explícito do alvo', () => {
  const target = { dataset: { motionDwellMs: '3100' } };
  assert.equal(resolveGameDwellMs(target, documentWith({ result: true })), 3100);
});
