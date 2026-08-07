import { installRightHandMenu } from './right-hand-menu.js';

let menuOpened = false;
let gameSelected = false;
window.mexemundoSelectedGame = 'balloons';

const nativeSetInterval = window.setInterval.bind(window);
window.setInterval = (callback, delay, ...args) => {
  if (Number(delay) !== 650) return nativeSetInterval(callback, delay, ...args);
  return nativeSetInterval(() => {
    if (!menuOpened || gameSelected) callback(...args);
  }, delay);
};

function installHandNavigation() {
  const style = document.createElement('style');
  style.id = 'mexemundoGameMenuStyle';
  style.textContent = `
    .tv-page,
    .tv-layout {
      width: 100%;
      height: 100vh;
      min-height: 100vh;
    }
    .tv-layout { position: relative; }
    #calibrationPanel,
    #gameMenuPanel,
    #resultPanel {
      width: min(900px, 78vw);
      max-width: 900px;
      margin-inline: auto;
    }
    .preparation-actions {
      width: min(520px, 100%);
      margin: 16px auto 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
    }
    .preparation-actions .badge {
      min-height: 48px;
      padding: 13px 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: .9rem;
    }
    .fullscreen-action {
      min-width: 190px;
      min-height: 56px;
      font-size: 1rem;
      cursor: default;
    }
    #gameMenuPanel { padding: 34px; }
    #resultPanel .button,
    #resultPanel [data-hand-target] {
      min-width: 180px;
    }
    #resultPanel .actions,
    #resultPanel .button-row {
      justify-content: center;
      flex-wrap: wrap;
      max-width: 68vw;
      margin-inline: auto;
    }
    #gameMenuPanel h2 { margin-bottom: 8px; }
    .game-menu-lead { margin: 0 0 24px; }
    .game-menu-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }
    .game-menu-card {
      min-height: 230px;
      padding: 24px 18px;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 12px;
      border: 5px solid rgba(105,56,239,.13);
      border-radius: 28px;
      background: linear-gradient(160deg, #fff, #f3efff);
      color: #241b46;
      box-shadow: 0 18px 38px rgba(50,30,120,.14);
      cursor: default;
    }
    .game-menu-card.story-card {
      background: linear-gradient(160deg, #fffdf2, #e9f5df);
      border-color: rgba(70,126,74,.18);
    }
    .game-menu-card.hand-hover {
      border-color: #ffcf4a;
      outline: 8px solid rgba(255,207,74,.35) !important;
      transform: scale(1.045);
    }
    .game-menu-card:disabled {
      opacity: .48;
      cursor: default;
      box-shadow: none;
    }
    .game-menu-icon { font-size: 4.5rem; line-height: 1; }
    .game-menu-card strong { font-size: 1.35rem; text-align: center; }
    .game-menu-card small { color: #6b6380; font-weight: 800; text-align: center; }
    .game-menu-tip {
      margin: 22px 0 0;
      color: #5a4f73;
      font-size: .9rem;
      font-weight: 850;
    }
    .score-hud.car-ride-active {
      opacity: 0;
      pointer-events: none;
    }
    @media (max-width: 980px) {
      .game-menu-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .story-card { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      #calibrationPanel,
      #gameMenuPanel,
      #resultPanel { width: min(82vw, 620px); }
      #gameMenuPanel { padding: 25px 20px; }
      .preparation-actions { gap: 10px; }
      .preparation-actions .badge,
      .fullscreen-action { width: min(100%, 300px); }
      .game-menu-grid { grid-template-columns: 1fr; }
      .story-card { grid-column: auto; }
      .game-menu-card { min-height: 120px; grid-template-columns: auto 1fr; text-align: left; }
      .game-menu-icon { font-size: 3rem; grid-row: span 2; }
    }
  `;
  document.head.append(style);
}

function createGameMenu() {
  const gameShell = document.querySelector('.game-shell');
  if (!gameShell || document.querySelector('#gameMenuPanel')) return;

  const menu = document.createElement('section');
  menu.id = 'gameMenuPanel';
  menu.className = 'modal-card hidden';
  menu.setAttribute('aria-label', 'Menu de jogos e histórias');
  menu.innerHTML = `
    <span class="eyebrow">ESCOLHA UMA EXPERIÊNCIA</span>
    <h2>Para onde vamos agora?</h2>
    <p class="game-menu-lead">Mova a mão direita até uma opção e mantenha-a parada para selecionar.</p>
    <div class="game-menu-grid">
      <button id="forestStoryCard" class="game-menu-card story-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🌲</span>
        <strong>O Filhote Perdido</strong>
        <small>História interativa na floresta</small>
      </button>
      <button id="balloonGameCard" class="game-menu-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🎈</span>
        <strong>Estoura-Balões</strong>
        <small>Use as duas mãos para estourar</small>
      </button>
      <button id="carRideGameCard" class="game-menu-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🚗</span>
        <strong>Passeio de Carro</strong>
        <small>Gire um volante com as duas mãos</small>
      </button>
    </div>
    <p class="game-menu-tip">A mão direita é o cursor. O celular continua parado durante todas as experiências.</p>
  `;
  gameShell.append(menu);

  const selectGame = (game) => {
    if (game === 'forest-story') {
      gameSelected = true;
      const room = document.querySelector('#roomCode')?.textContent?.trim() || '';
      location.href = `/story.html?sala=${encodeURIComponent(room)}`;
      return;
    }

    window.mexemundoSelectedGame = game;
    gameSelected = true;
    menu.classList.add('hidden');
    document.querySelector('#countdownPanel')?.classList.remove('hidden');
  };

  menu.querySelector('#forestStoryCard').addEventListener('click', () => selectGame('forest-story'));
  menu.querySelector('#balloonGameCard').addEventListener('click', () => selectGame('balloons'));
  menu.querySelector('#carRideGameCard').addEventListener('click', () => selectGame('car-ride'));
}

function keepCalibrationAsInitialScreen() {
  const pairPanel = document.querySelector('#pairPanel');
  const calibrationPanel = document.querySelector('#calibrationPanel');
  const calibrationProgress = document.querySelector('#calibrationProgress');
  const calibrationMessage = document.querySelector('#calibrationMessage');
  const connectionBadge = document.querySelector('#connectionBadge');

  if (!pairPanel || !calibrationPanel || !connectionBadge) return;

  const syncInitialScreen = () => {
    const waitingForPhone = connectionBadge.textContent?.trim() === 'Aguardando celular';
    if (!waitingForPhone) return;

    pairPanel.classList.add('hidden');
    pairPanel.setAttribute('aria-hidden', 'true');
    calibrationPanel.classList.remove('hidden');
    calibrationPanel.removeAttribute('aria-hidden');
    if (calibrationProgress) calibrationProgress.style.width = '0%';
    if (calibrationMessage) calibrationMessage.textContent = 'Aguardando o celular conectar…';
  };

  const observer = new MutationObserver(syncInitialScreen);
  observer.observe(connectionBadge, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    characterData: true,
    subtree: true
  });

  syncInitialScreen();
}

function openMenuAfterCalibration() {
  const countdownPanel = document.querySelector('#countdownPanel');
  const menu = document.querySelector('#gameMenuPanel');
  if (!countdownPanel || !menu) return;

  const syncMenu = () => {
    if (gameSelected || menuOpened || countdownPanel.classList.contains('hidden')) return;
    menuOpened = true;
    countdownPanel.classList.add('hidden');
    menu.classList.remove('hidden');
  };

  const observer = new MutationObserver(syncMenu);
  observer.observe(countdownPanel, { attributes: true, attributeFilter: ['class'] });
  syncMenu();
}

function installReturnToGameMenu() {
  const returnButton = document.querySelector('.hand-home-result');
  const restartButton = document.querySelector('#restartButton');
  const resultPanel = document.querySelector('#resultPanel');
  const countdownPanel = document.querySelector('#countdownPanel');
  const menu = document.querySelector('#gameMenuPanel');
  if (!returnButton || !restartButton || !resultPanel || !countdownPanel || !menu) return;

  returnButton.textContent = 'Escolher outro jogo';
  returnButton.setAttribute('href', '#gameMenuPanel');
  returnButton.setAttribute('aria-label', 'Escolher outro jogo sem desconectar o celular');

  returnButton.addEventListener('click', (event) => {
    event.preventDefault();
    gameSelected = false;
    menuOpened = true;

    restartButton.click();
    resultPanel.classList.add('hidden');
    countdownPanel.classList.add('hidden');
    menu.classList.remove('hidden');
  });
}

installHandNavigation();
createGameMenu();
installRightHandMenu();
await import('./tv.js');
keepCalibrationAsInitialScreen();
openMenuAfterCalibration();
installReturnToGameMenu();
