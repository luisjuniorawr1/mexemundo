import { UniversalMenuCursor } from './universal-menu-cursor.js';

UniversalMenuCursor.prototype.selectHand = function selectRightHandOnly(frame) {
  const right = frame?.right;
  if (
    !right?.visible
    || !Number.isFinite(right.x)
    || !Number.isFinite(right.y)
  ) return null;

  return { side: 'right', point: right };
};

await import('./menu.js');
