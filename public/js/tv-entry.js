import {
  installRightHandGameUI,
  startRightHandGameUI
} from './right-hand-game-ui.js';

installRightHandGameUI();
await import('./tv.js');
startRightHandGameUI();
