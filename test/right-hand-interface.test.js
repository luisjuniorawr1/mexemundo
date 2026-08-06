import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectRightControlHand,
  shouldShowRightHandCursor
} from '../public/js/right-hand-game-ui.js';

test('a mão direita controla a interface quando está visível', () => {
  const right = { x: 0.7, y: 0.4, visible: true };
  const selected = selectRightControlHand({
    left: { x: 0.3, y: 0.4, visible: true },
    right
  });

  assert.equal(selected?.side, 'right');
  assert.equal(selected?.point, right);
});

test('a mão esquerda nunca assume a interface', () => {
  const selected = selectRightControlHand({
    left: { x: 0.3, y: 0.4, visible: true },
    right: { x: 0.7, y: 0.4, visible: false }
  });

  assert.equal(selected, null);
});

test('durante a partida o cursor some fora dos controles', () => {
  assert.equal(
    shouldShowRightHandCursor({ targetOnly: true, target: null }),
    false
  );
});

test('durante a partida o cursor aparece sobre um controle', () => {
  assert.equal(
    shouldShowRightHandCursor({ targetOnly: true, target: {} }),
    true
  );
});
