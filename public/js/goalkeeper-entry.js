import {
  installUniversalGameHandUI,
  startUniversalGameHandUI
} from './universal-game-hand-ui.js';

installUniversalGameHandUI();
await import('./goalkeeper.js');
startUniversalGameHandUI();
