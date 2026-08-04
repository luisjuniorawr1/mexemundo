import { RealtimeClient } from './realtime.js';
import { createUniversalHandInput } from './game-hand-input.js';
import { UniversalMenuCursor } from './universal-menu-cursor.js';
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
const connectionBadge = document.querySelector('#connectionBadge');
const cursorElement = document.querySelector('#motionCursor');
const fullscreenButton = document.querySelector('#fullscreenButton');
const gameLinks = [...document.querySelectorAll('[data-game-path]')];

roomCode.textContent = room;
for (const link of gameLinks) link.href = roomHref(link.dataset.gamePath, room);

const cursor = new UniversalMenuCursor({
  element: cursorElement,
  dwellMs: 950,
  enabled: false
});

let phoneConnected = false;
let transportMode = 'relay';
let state = 'pairing';
let lastVisualFrame = null;

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel?.classList.add('hidden');
  menuPanel.classList.toggle('hidden', next !== 'menu');
  cursor.setEnabled(next === 'menu' && phoneConnected);
}

function showMenu() {
  setState('menu');
  if (lastVisualFrame) cursor.updateFrame(lastVisualFrame);
}

function updateConnection({ phone } = {}) {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected
    ? (transportMode === 'direct' ? 'Mãos universais • direto' : 'Celular conectado')
    : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    handInput.reset();
    lastVisualFrame = null;
    setState('pairing');
    return;
  }

  // O menu não cria nem espera uma segunda calibração. O perfil universal é
  // responsabilidade do sistema de mãos no celular e vale para todos os jogos.
  showMenu();
}

socket.on('room-status', updateConnection);
socket.on('disconnect', () => {
  phoneConnected = false;
  connectionBadge.textContent = 'Servidor desconectado';
  connectionBadge.className = 'badge waiting';
  handInput.reset();
  lastVisualFrame = null;
  setState('pairing');
});

socket.on('transport', ({ mode }) => {
  transportMode = mode;
  if (!phoneConnected) return;
  connectionBadge.textContent = mode === 'direct' ? 'Mãos universais • direto' : 'Modo servidor';
  connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

socket.on('pose', (pose) => {
  const frames = handInput.ingest(pose);
  lastVisualFrame = frames.visual;
  if (state === 'menu') cursor.updateFrame(frames.visual);
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch (error) {
    console.warn('Tela cheia indisponível.', error);
  }
});

await socket.connect();
const joined = await socket.request('join', { room, role: 'tv' });
updateConnection(joined?.status);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state === 'menu' && lastVisualFrame) {
    cursor.updateFrame(lastVisualFrame);
  }
});
