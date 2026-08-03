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

roomCode.textContent = room;
for (const link of gameLinks) link.href = roomHref(link.dataset.gamePath, room);

const cursor = new MotionCursor({ element: cursorElement, dwellMs: 850, enabled: false });
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

function startCalibration() {
  samples = [];
  stableSince = 0;
  calibrationProgress.style.width = '0%';
  calibrationMessage.textContent = 'Segure a mão direita no centro e fique parado.';
  setState('calibrating');
}

function updateCalibration(pose, now) {
  const ready = pose?.detected
    && pose?.right?.visible
    && pose?.leftShoulder?.visible
    && pose?.rightShoulder?.visible;

  if (!ready) {
    samples = [];
    stableSince = 0;
    calibrationProgress.style.width = '0%';
    calibrationMessage.textContent = 'Mostre a mão direita e os dois ombros.';
    return;
  }

  const speed = Math.hypot(pose.right.vx ?? 0, pose.right.vy ?? 0);
  if (speed > 0.22) {
    samples = [];
    stableSince = 0;
    calibrationProgress.style.width = '0%';
    calibrationMessage.textContent = 'Quase! Agora mantenha a mão parada.';
    return;
  }

  if (!stableSince) stableSince = now;
  samples.push({
    right: { ...pose.right },
    leftShoulder: { ...pose.leftShoulder },
    rightShoulder: { ...pose.rightShoulder }
  });
  if (samples.length > 75) samples.shift();

  const progress = Math.min(1, (now - stableSince) / 1500);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.55 ? 'Ótimo, continue parado…' : 'Medindo estabilidade…';

  if (progress < 1 || samples.length < 30) return;

  try {
    const profile = buildMotionProfile(samples);
    cursor.setProfile(profile);
    calibrationMessage.textContent = 'Calibração pronta!';
    setTimeout(showMenu, 260);
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
