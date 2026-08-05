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
const calibrationProgress = document.querySelector('#calibrationProgress');
const calibrationMessage = document.querySelector('#calibrationMessage');
const calibrationTitle = document.querySelector('#calibrationTitle');
const calibrationDescription = document.querySelector('#calibrationDescription');
const connectionBadge = document.querySelector('#connectionBadge');
const cursorElement = document.querySelector('#motionCursor');
const recalibrateButton = document.querySelector('#recalibrateButton');
const fullscreenButton = document.querySelector('#fullscreenButton');
const gameLinks = [...document.querySelectorAll('[data-game-path]')];

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
let sensorStatus = {
  stage: 'right',
  progress: 0,
  ready: false,
  reason: 'show-right'
};

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel.classList.toggle('hidden', next !== 'calibrating');
  menuPanel.classList.toggle('hidden', next !== 'menu');
  cursor.setEnabled(next === 'menu' && phoneConnected);
}

function copyForSensorStatus(status) {
  if (status.ready) {
    return {
      title: 'Sensores configurados',
      description: 'Cada mão está presa ao sensor configurado para ela.',
      message: 'Tudo pronto!'
    };
  }

  const rightStage = status.stage !== 'left';
  const side = rightStage ? 'direita' : 'esquerda';
  let message = `Mostre somente a mão ${side} para a câmera.`;

  if (status.reason === 'lower-other-hand') {
    message = 'Abaixe completamente a outra mão para separar os sensores.';
  } else if (status.reason === 'hold-still') {
    message = `Mão ${side} encontrada. Mantenha-a parada até completar.`;
  }

  return {
    title: rightStage
      ? 'Primeiro: mão direita'
      : 'Agora: mão esquerda',
    description: rightStage
      ? 'Levante somente a mão direita e mantenha a esquerda abaixada.'
      : 'Abaixe a direita e levante somente a mão esquerda.',
    message
  };
}

function renderSensorStatus(status) {
  const copy = copyForSensorStatus(status);
  calibrationTitle.textContent = copy.title;
  calibrationDescription.textContent = copy.description;
  calibrationMessage.textContent = copy.message;
  calibrationProgress.style.width = `${Math.round(Math.max(0, Math.min(1, status.progress ?? 0)) * 100)}%`;
}

function startCalibration(status = sensorStatus) {
  sensorStatus = {
    stage: status.stage || 'right',
    progress: Number(status.progress || 0),
    ready: Boolean(status.ready),
    reason: status.reason || 'show-right'
  };
  renderSensorStatus(sensorStatus);
  setState('calibrating');
}

function showMenu() {
  calibrationProgress.style.width = '100%';
  setState('menu');
  if (lastVisualFrame) cursor.updateFrame(lastVisualFrame);
}

function handleSensorCalibration(payload = {}) {
  if (payload.command !== 'sensor-calibration') return;
  sensorStatus = {
    stage: payload.stage || 'right',
    progress: Number(payload.progress || 0),
    ready: Boolean(payload.ready),
    reason: payload.reason || 'show-right'
  };

  if (sensorStatus.ready) {
    renderSensorStatus(sensorStatus);
    showMenu();
  } else {
    startCalibration(sensorStatus);
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
    sensorStatus = {
      stage: 'right',
      progress: 0,
      ready: false,
      reason: 'show-right'
    };
    setState('pairing');
    return;
  }

  startCalibration(sensorStatus);
}

socket.on('room-status', updateConnection);
socket.on('disconnect', () => updateConnection({ phone: false }));
socket.on('game-command', handleSensorCalibration);
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
  sensorStatus = {
    stage: 'right',
    progress: 0,
    ready: false,
    reason: 'show-right'
  };
  startCalibration(sensorStatus);
  socket.emit('game-command', { command: 'recalibrate-sensors' });
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
