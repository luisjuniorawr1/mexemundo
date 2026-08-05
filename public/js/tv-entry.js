import { installHandOnlyGameInterface } from './hand-only-game-interface.js';
import { installSingleHandGameActivation } from './single-hand-game-activation.js';

// A interface recebe o pacote real. Depois, o adaptador de início com uma mão
// pode ajustar somente a tela de preparação sem interferir nos controles.
installHandOnlyGameInterface();
installSingleHandGameActivation();
await import('./tv.js');
