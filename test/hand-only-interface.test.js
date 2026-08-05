import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveActionDwellMs,
  selectInterfaceHand
} from '../public/js/hand-only-game-interface.js';

test('interface usa permanência adequada para cada contexto', () => {
  assert.equal(resolveActionDwellMs({ result: true }), 2200);
  assert.equal(resolveActionDwellMs({ playing: true }), 4200);
  assert.equal(resolveActionDwellMs({}), 2600);
});

test('interface prefere a mão direita e aceita a esquerda como alternativa', () => {
  const right = { visible: true, x: 0.7, y: 0.5 };
  const left = { visible: true, x: 0.3, y: 0.5 };

  assert.deepEqual(
    selectInterfaceHand({ right, left }),
    { side: 'right', point: right }
  );
  assert.deepEqual(
    selectInterfaceHand({ right: { visible: false }, left }),
    { side: 'left', point: left }
  );
  assert.equal(
    selectInterfaceHand({
      right: { visible: false },
      left: { visible: false }
    }),
    null
  );
});
