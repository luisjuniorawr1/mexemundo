import { RealtimeClient } from './realtime.js';
import {
  MotionCursor,
  buildMotionProfile,
  clearMotionProfile,
  getMotionProfile,
  getPersistentRoom,
  roomHref
} from './motion-ui.js';

const socket = new RealtimeClient();
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

const CALIBRATION_MS = 4000;
const MIN_CALIBRATION_SAMPLES = 85;

roomCode.textContent = room;
for (const link of gameLinks) link.href = roomHref(link.dataset.gamePath, room);

const cursor = new MotionCursor({ element: cursorElement, dwellMs: 950, enabled: false });
let phoneConnected = false;
let transportMode = 'relay';
let state = 'pairing';
let samples = [];
let stableSince = 0;
let lastPose = null;

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel.classList.toggle('hidden', next !== 'calibrating');
  menuPanel.classList.toggle('hidden', next !== 'menu');
  cursor.setEnabled(next === 'menu' && phoneConnected);
}

function showMenu() {
  const profile = getMotionProfile();
  if (!profile) {
    startCalibration();
    return;
  }
  cursor.setProfile(profile);
  calibrationProgress.style.width = '0%';
  setState('menu');
}

function resetCalibration(message) {
  samples = [];
  stableSince = 0;
  calibrationProgress.style.width = '0%';
  calibrationMessage.textContent = message;
}

function startCalibration() {
  resetCalibration('Coloque as duas mãos nos círculos e mantenha os ombros parados.');
  setState('calibrating');
}

function updateCalibration(pose, now) {
  const ready = pose?.detected
    && pose?.left?.visible
    && pose?.right?.visible
    && pose?.leftShoulder?.visible
    && pose?.rightShoulder?.visible;

  if (!ready) {
    resetCalibration('Mostre as duas mãos e os dois ombros para a câmera.');
    return;
  }

  const shoulderCenterX = (pose.leftShoulder.x + pose.rightShoulder.x) / 2;
  const shoulderWidth = Math.max(0.08, Math.abs(pose.leftShoulder.x - pose.rightShoulder.x));
  const handSeparation = pose.right.x - pose.left.x;
  const handsLevel = Math.abs(pose.left.y - pose.right.y);
  const handsPositioned = pose.left.x < shoulderCenterX - shoulderWidth * 0.28
    && pose.right.x > shoulderCenterX + shoulderWidth * 0.28
    && handSeparation > shoulderWidth * 1.15
    && handsLevel < Math.max(0.15, shoulderWidth * 1.15);

  if (!handsPositioned) {
    resetCalibration('Abra as mãos para os lados e alinhe uma em cada círculo.');
    return;
  }

  const leftSpeed = Math.hypot(pose.left.vx ?? 0, pose.left.vy ?? 0);
  const rightSpeed = Math.hypot(pose.right.vx ?? 0, pose.right.vy ?? 0);
  const speed = Math.max(leftSpeed, rightSpeed);
  if (speed > 0.18) {
    resetCalibration('Quase! Mantenha as duas mãos paradas por alguns segundos.');
    return;
  }

  if (!stableSince) stableSince = now;
  samples.push({
    left: { ...pose.left },
    right: { ...pose.right },
    leftShoulder: { ...pose.leftShoulder },
    rightShoulder: { ...pose.rightShoulder }
  });
  if (samples.length > 180) samples.shift();

  const progress = Math.min(1, (now - stableSince) / CALIBRATION_MS);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.35
    ? 'Ótimo. Continue com as duas mãos paradas…'
    : progress < 0.75
      ? 'Medindo cada mão separadamente…'
      : 'Ajustando posição e estabilidade…';

  if (progress < 1 || samples.length < MIN_CALIBRATION_SAMPLES) return;

  try {
    const profile = buildMotionProfile(samples);
    cursor.setProfile(profile);
    calibrationMessage.textContent = 'As duas mãos foram calibradas!';
    setTimeout(showMenu, 420);
  } catch (error) {
    console.warn(error);
    startCalibration();
  }
}

socket.on('room-status', ({ phone }) => {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected
    ? (transportMode === 'direct' ? 'Conexão direta' : 'Celular conectado')
    : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    setState('pairing');
    return;
  }

  if (getMotionProfile()) showMenu();
  else startCalibration();
});

socket.on('transport', ({ mode }) => {
  transportMode = mode;
  if (!phoneConnected) return;
  connectionBadge.textContent = mode === 'direct' ? 'Conexão direta' : 'Modo servidor';
  connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

socket.on('pose', (pose) => {
  lastPose = pose;
  const now = performance.now();
  if (state === 'calibrating') updateCalibration(pose, now);
  if (state === 'menu') cursor.updatePose(pose, now);
});

socket.on('disconnect', () => {
  phoneConnected = false;
  connectionBadge.textContent = 'Servidor desconectado';
  connectionBadge.className = 'badge waiting';
  setState('pairing');
});

recalibrateButton.addEventListener('click', () => {
  clearMotionProfile();
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

await socket.connect();
const joined = await socket.request('join', { room, role: 'tv' });
phoneConnected = Boolean(joined?.status?.phone);
if (phoneConnected) {
  if (getMotionProfile()) showMenu();
  else startCalibration();
} else {
  setState('pairing');
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state === 'menu' && lastPose) cursor.updatePose(lastPose);
});
