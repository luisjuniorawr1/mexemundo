import { RealtimeClient } from './realtime.js';
import { installRightHandMenu } from './right-hand-menu.js';

let menuOpened = false;
let gameSelected = false;
let storyActive = false;
let storyLoaded = false;
let storyFrameCallback = null;
let primaryRealtimeClient = null;
let embeddingStoryClient = false;
let storyBridgeInstalled = false;
let storyRoom = '';
const embeddedRealtimeClients = new WeakSet();
window.mexemundoSelectedGame = 'balloons';

const captureOn = RealtimeClient.prototype.on;
RealtimeClient.prototype.on = function capturePrimaryRealtimeClient(type, callback) {
  if (!primaryRealtimeClient && !embeddingStoryClient) primaryRealtimeClient = this;
  return captureOn.call(this, type, callback);
};

const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => {
  if (!storyFrameCallback && storyActive) {
    try {
      const source = Function.prototype.toString.call(callback);
      if (
        source.includes('SPACE_STORY_FRAME')
        || (source.includes('updateSetup') && source.includes('drawScene') && source.includes('updateParticles'))
      ) {
        storyFrameCallback = callback;
      }
    } catch {}
  }

  if (callback === storyFrameCallback && !storyActive) return 0;
  return nativeRequestAnimationFrame(callback);
};

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
    #resultPanel [data-hand-target] { min-width: 180px; }
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
      background: linear-gradient(160deg, #f8fbff, #e8e8ff 55%, #f4e6ff);
      border-color: rgba(78,78,200,.19);
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
    .embedded-story-shell {
      position: fixed !important;
      inset: 0;
      z-index: 5000;
    }
    body.story-active #handInterfaceLayer { display: none; }
    body.story-active.story-ending #handInterfaceLayer { display: block; }
    #storyBackToMenu { background: #334c69; }
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

function ensureStoryStyles() {
  if (!document.querySelector('#mexemundoStoryStyles')) {
    const base = document.createElement('link');
    base.id = 'mexemundoStoryStyles';
    base.rel = 'stylesheet';
    base.href = '/story.css';
    document.head.append(base);
  }
  if (!document.querySelector('#mexemundoSpaceStoryStyles')) {
    const space = document.createElement('link');
    space.id = 'mexemundoSpaceStoryStyles';
    space.rel = 'stylesheet';
    space.href = '/space-story.css';
    document.head.append(space);
  }
}

function createEmbeddedStory() {
  const gameShell = document.querySelector('.game-shell');
  if (!gameShell) return null;
  const existing = document.querySelector('#storyExperience');
  if (existing) return existing;

  ensureStoryStyles();
  const story = document.createElement('section');
  story.id = 'storyExperience';
  story.className = 'story-shell embedded-story-shell hidden';
  story.setAttribute('aria-label', 'História Missão: Estrela Perdida');
  story.innerHTML = `
    <canvas id="storyCanvas" aria-label="Missão: Estrela Perdida"></canvas>

    <header class="story-topbar">
      <div>
        <span class="story-kicker">MEXEMUNDO • HISTÓRIA</span>
        <strong>Missão: Estrela Perdida</strong>
      </div>
      <div id="storyConnectionBadge" class="story-badge waiting">Celular conectado</div>
    </header>

    <section id="messageCard" class="message-card">
      <span id="messageEyebrow">PREPARANDO A MISSÃO</span>
      <h1 id="messageTitle">Mostre suas mãos</h1>
      <p id="messageText">Cada mão funciona separadamente para tocar os alvos.</p>
      <div class="meter"><span id="messageProgress"></span></div>
    </section>

    <div id="objective" class="objective hidden"></div>
    <div id="storyProgress" class="story-progress" aria-label="Progresso da missão"></div>

    <section id="endingCard" class="ending-card hidden">
      <div class="ending-stars">✦ ✦ ✦</div>
      <span>MISSÃO CONCLUÍDA</span>
      <h2>A estrela voltou para casa!</h2>
      <p>Você atravessou o espaço e completou a constelação.</p>
      <button id="storyRestartButton" type="button" data-hand-target="true">Jogar novamente</button>
      <button id="storyBackToMenu" type="button" data-hand-target="true">Voltar ao MexeMundo</button>
      <small>Use a mão para escolher.</small>
    </section>

    <div class="safe-hint">Mova apenas as mãos e mantenha espaço livre ao redor 👋</div>
  `;
  gameShell.append(story);

  const endingCard = story.querySelector('#endingCard');
  new MutationObserver(() => {
    document.body.classList.toggle(
      'story-ending',
      storyActive && !endingCard.classList.contains('hidden')
    );
  }).observe(endingCard, { attributes: true, attributeFilter: ['class'] });

  story.querySelector('#storyBackToMenu').addEventListener('click', closeEmbeddedStory);
  return story;
}

function installEmbeddedRealtimeBridge(sharedClient, room) {
  storyRoom = room;
  if (storyBridgeInstalled) return;
  storyBridgeInstalled = true;

  const prototype = RealtimeClient.prototype;
  const baseOn = prototype.on;
  const baseConnect = prototype.connect;
  const baseRequest = prototype.request;

  prototype.on = function onWithEmbeddedStory(type, callback) {
    if (embeddingStoryClient && this !== sharedClient) embeddedRealtimeClients.add(this);
    if (embeddedRealtimeClients.has(this)) return baseOn.call(sharedClient, type, callback);
    return baseOn.call(this, type, callback);
  };

  prototype.connect = function connectWithEmbeddedStory(...args) {
    if (embeddedRealtimeClients.has(this)) return Promise.resolve();
    return baseConnect.apply(this, args);
  };

  prototype.request = function requestWithEmbeddedStory(type, payload = {}, timeoutMs = 5000) {
    if (!embeddedRealtimeClients.has(this)) {
      return baseRequest.call(this, type, payload, timeoutMs);
    }

    if (type === 'join') {
      return Promise.resolve({
        ok: true,
        room: storyRoom,
        status: sharedClient.roomStatus ?? { tv: true, phone: true }
      });
    }

    return baseRequest.call(sharedClient, type, payload, timeoutMs);
  };
}

function prepareStoryIdsForImport(story) {
  const tvBadge = document.querySelector('#connectionBadge');
  const tvRestart = document.querySelector('#restartButton');
  const storyBadge = story.querySelector('#storyConnectionBadge');
  const storyRestart = story.querySelector('#storyRestartButton');

  if (tvBadge) tvBadge.id = 'tvConnectionBadge';
  if (tvRestart) tvRestart.id = 'tvRestartButton';
  if (storyBadge) storyBadge.id = 'connectionBadge';
  if (storyRestart) storyRestart.id = 'restartButton';

  return () => {
    if (storyBadge) storyBadge.id = 'storyConnectionBadge';
    if (storyRestart) storyRestart.id = 'storyRestartButton';
    if (tvBadge) tvBadge.id = 'connectionBadge';
    if (tvRestart) tvRestart.id = 'restartButton';
  };
}

async function loadEmbeddedStory(story) {
  if (storyLoaded) return;
  const room = document.querySelector('#roomCode')?.textContent?.trim() || '';
  const sharedClient = primaryRealtimeClient;

  if (!sharedClient || !room) {
    throw new Error('A conexão principal da TV ainda não está pronta.');
  }

  installEmbeddedRealtimeBridge(sharedClient, room);
  const restoreIds = prepareStoryIdsForImport(story);
  const previousUrl = `${location.pathname}${location.search}${location.hash}`;

  embeddingStoryClient = true;
  history.replaceState(history.state, '', `/tv?sala=${encodeURIComponent(room)}`);
  try {
    await import('./space-story.js');
    storyLoaded = true;
  } finally {
    embeddingStoryClient = false;
    restoreIds();
    history.replaceState(history.state, '', previousUrl || '/tv');
  }
}

async function openEmbeddedStory() {
  const menu = document.querySelector('#gameMenuPanel');
  const story = createEmbeddedStory();
  if (!story) return;

  menu?.classList.add('hidden');
  document.querySelector('#countdownPanel')?.classList.add('hidden');
  document.querySelector('#resultPanel')?.classList.add('hidden');
  document.body.classList.add('story-active');
  document.body.classList.remove('story-ending');
  story.classList.remove('hidden');
  storyActive = true;

  try {
    if (!storyLoaded) {
      await loadEmbeddedStory(story);
      return;
    }

    story.querySelector('#storyRestartButton')?.click();
    if (storyFrameCallback) nativeRequestAnimationFrame(storyFrameCallback);
  } catch (error) {
    console.error(error);
    story.classList.add('hidden');
    storyActive = false;
    document.body.classList.remove('story-active', 'story-ending');
    menu?.classList.remove('hidden');
    alert('Não foi possível abrir a missão. Tente novamente.');
  }
}

function closeEmbeddedStory() {
  const story = document.querySelector('#storyExperience');
  const menu = document.querySelector('#gameMenuPanel');

  storyActive = false;
  story?.classList.add('hidden');
  document.body.classList.remove('story-active', 'story-ending');
  document.querySelector('#countdownPanel')?.classList.add('hidden');
  document.querySelector('#resultPanel')?.classList.add('hidden');
  menuOpened = true;
  gameSelected = false;
  menu?.classList.remove('hidden');
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
    <h2>O que vamos fazer?</h2>
    <p class="game-menu-lead">Mova a mão direita até uma opção e mantenha-a parada para selecionar.</p>
    <div class="game-menu-grid">
      <button id="spaceStoryCard" class="game-menu-card story-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🚀</span>
        <strong>Missão: Estrela Perdida</strong>
        <small>Uma aventura de toques pelo espaço</small>
      </button>
      <button id="balloonGameCard" class="game-menu-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🎈</span>
        <strong>Estoura-Balões</strong>
        <small>Use as mãos para estourar</small>
      </button>
      <button id="carRideGameCard" class="game-menu-card" type="button" data-hand-target="true">
        <span class="game-menu-icon">🚗</span>
        <strong>Passeio de Carro</strong>
        <small>Gire um volante com as duas mãos</small>
      </button>
    </div>
    <p class="game-menu-tip">O celular continua parado durante todas as experiências.</p>
  `;
  gameShell.append(menu);

  const selectGame = (game) => {
    if (game === 'space-story') {
      openEmbeddedStory();
      return;
    }

    window.mexemundoSelectedGame = game;
    gameSelected = true;
    menu.classList.add('hidden');
    document.querySelector('#countdownPanel')?.classList.remove('hidden');
  };

  menu.querySelector('#spaceStoryCard').addEventListener('click', () => selectGame('space-story'));
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
    if (storyActive || gameSelected || menuOpened || countdownPanel.classList.contains('hidden')) return;
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

  returnButton.textContent = 'Escolher outra experiência';
  returnButton.setAttribute('href', '#gameMenuPanel');
  returnButton.setAttribute('aria-label', 'Escolher outra experiência sem desconectar o celular');

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
