import {
  installUniversalGameHandUI,
  startUniversalGameHandUI
} from './universal-game-hand-ui.js';

installUniversalGameHandUI();
await import('./tv.js');
startUniversalGameHandUI();
