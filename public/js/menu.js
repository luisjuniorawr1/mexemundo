import { RealtimeClient } from './realtime.js';
import { createUniversalHandInput } from './game-hand-input.js';
import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';
import { UniversalMenuCursor } from './universal-menu-cursor.js';
import { evaluateTwoHandStartup } from './two-hand-startup-check.js';
import {
  getPersistentRoom,
  roomHref
} from './motion-ui.js';

const socket = new RealtimeClient();
const handInput = createUniversalHandInput();
const room = getPersistentRoom();
const roomCode = document.querySelector('#roomCode');
const pairPanel = document.querySelector('#pairPanel');
const calibrationPanel = document.querySelector('#calibrationPanel');
const menuPanel = document.querySelector('#menuPanel');
const calibrationProgress = document.querySelector('#calibrationProgress');
const calibrationMessage = document.querySelector('#calibrationMessage');
const connectionBadge = document.querySelector('#connectionBadge');
const cursorElement = document.querySelector('#motionCursor');
const recalibrateButton = document.querySelector('#recalibrateButton');
const fullscreenButton = document.querySelector('#fullscreenButton');
const gameLinks = [...document.querySelectorAll('[data-game-path]')];

const SESSION_KEY = `mexemundo-hand-session-ready-v6:${room}`;
const STARTUP = HAND_SYSTEM_CONFIG.startupCheck;

roomCode.textContent = room;
for (const link of gameLinks) link.href = roomHref(link.dataset.gamePath, room);

const cursor = new UniversalMenuCursor({
  element: cursorElement,
  enabled: false
});

let phoneConnected = false;
let transportMode = 'relay';
let state = 'pairing';
let lastVisualFrame = null;
let stableSince = 0;
let openingMenu = false;

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel.classList.toggle('hidden', next !== 'calibrating');
  menuPanel.classList.toggle('hidden', next !== 'menu');
  cursor.setEnabled(next === 'menu' && phoneConnected);
}

function resetCalibration(message = 'Mostre as duas palmas para a câmera.') {
  stableSince = 0;
  openingMenu = false;
  calibrationProgress.style.width = '0%';
  calibrationMessage.textContent = message;
}

function startCalibration() {
  resetCalibration('Mostre as duas palmas, uma de cada lado do corpo.');
  setState('calibrating');
}

function showMenu() {
  openingMenu = false;
  sessionStorage.setItem(SESSION_KEY, '1');
  calibrationProgress.style.width = '100%';
  setState('menu');
  if (lastVisualFrame) cursor.updateFrame(lastVisualFrame);
}

function messageForStartup(result) {
  switch (result.reason) {
    case 'missing-frame':
      return 'Afaste-se até aparecer a parte superior do corpo.';
    case 'missing-hands':
      return 'Mostre as duas palmas ao mesmo tempo.';
    case 'missing-shoulders':
      return 'Mantenha os ombros e as duas mãos dentro da câmera.';
    case 'hands-too-close':
      return 'Separe um pouco mais as mãos, uma de cada lado.';
    case 'moving':
      return 'Duas mãos encontradas. Mantenha-as paradas por um instante.';
    default:
      return 'Mostre as duas palmas para a câmera.';
  }
}

function updateCalibration(frame, now) {
  const result = evaluateTwoHandStartup(frame, STARTUP);
  if (!result.ready) {
    resetCalibration(messageForStartup(result));
    return;
  }

  if (!stableSince) stableSince = now;
  const progress = Math.min(1, (now - stableSince) / STARTUP.holdMs);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.45
    ? 'Duas palmas reconhecidas…'
    : progress < 0.85
      ? 'Fixando a identidade das mãos…'
      : 'Tudo pronto!';

  if (progress >= 1 && !openingMenu) {
    openingMenu = true;
    setTimeout(showMenu, 160);
  }
}

function updateConnection({ phone } = {}) {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected
    ? (transportMode === 'direct' ? 'Rastreamento rápido • direto' : 'Celular conectado')
    : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    handInput.reset();
    lastVisualFrame = null;
    sessionStorage.removeItem(SESSION_KEY);
    setState('pairing');
    return;
  }

  if (sessionStorage.getItem(SESSION_KEY) === '1') showMenu();
  else startCalibration();
}

socket.on('room-status', updateConnection);
socket.on('disconnect', () => updateConnection({ phone: false }));
socket.on('transport', ({ mode }) => {
  transportMode = mode;
  if (!phoneConnected) return;
  connectionBadge.textContent = mode === 'direct'
    ? 'Rastreamento rápido • direto'
    : 'Modo servidor';
  connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

socket.on('pose', (pose) => {
  handInput.ingest(pose);
});

recalibrateButton?.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  socket.emit('game-command', { command: 'recalibrate-sensors' });
  startCalibration();
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch (error) {
    console.warn('Tela cheia indisponível.', error);
  }
});

function frame(now) {
  const frames = handInput.sample(now);
  lastVisualFrame = frames.visual;
  if (state === 'calibrating') updateCalibration(frames.visual, now);
  if (state === 'menu') cursor.updateFrame(frames.visual, now);
  requestAnimationFrame(frame);
}

await socket.connect();
const joined = await socket.request('join', { room, role: 'tv' });
updateConnection(joined?.status);
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state === 'menu' && lastVisualFrame) {
    cursor.updateFrame(lastVisualFrame);
  }
});
