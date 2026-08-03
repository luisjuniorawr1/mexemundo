import { RealtimeClient } from './realtime.js';
import { MotionEngine, installMotionDebug } from './motion-engine.js';
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
const motionEngine = new MotionEngine({ profile: 'menu', calibration: getMotionProfile() });
let phoneConnected = false;
let transportMode = 'relay';
let transportRtt = 0;
let state = 'pairing';
let samples = [];
let stableSince = 0;
let lastCalibrationSequence = null;

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
  motionEngine.setCalibration(profile);
  calibrationProgress.style.width = '0%';
  setState('menu');
}

function startCalibration() {
  samples = [];
  stableSince = 0;
  lastCalibrationSequence = null;
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
    motionEngine.setCalibration(profile);
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
    motionEngine.reset();
    setState('pairing');
    return;
  }

  if (getMotionProfile()) showMenu();
  else startCalibration();
});

socket.on('transport', ({ mode, rtt = 0 }) => {
  transportMode = mode;
  transportRtt = Number(rtt) || 0;
  motionEngine.setTransportMetrics({ mode, rtt: transportRtt });
  if (!phoneConnected) return;
  connectionBadge.textContent = mode === 'direct' ? 'Conexão direta' : 'Modo servidor';
  connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

socket.on('pose', (pose) => {
  if (!motionEngine.replayActive) motionEngine.ingest(pose);
});

socket.on('pose-stream-reset', () => motionEngine.reset());

socket.on('quality', (quality) => motionEngine.setTransportMetrics(quality));

setInterval(async () => {
  try {
    const startedAt = performance.now();
    await socket.request('ping-latency', { sentAt: Date.now() }, 1800);
    transportRtt = Math.round(performance.now() - startedAt);
    motionEngine.setTransportMetrics({ mode: transportMode, rtt: transportRtt });
  } catch {
    // O diagnóstico não deve interferir no menu.
  }
}, 1500);

socket.on('disconnect', () => {
  phoneConnected = false;
  motionEngine.reset();
  connectionBadge.textContent = 'Servidor desconectado';
  connectionBadge.className = 'badge waiting';
  setState('pairing');
});

recalibrateButton.addEventListener('click', () => {
  clearMotionProfile();
  motionEngine.setCalibration(null);
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

installMotionDebug(motionEngine);

function frame(now) {
  const snapshot = motionEngine.sample(now);
  if (state === 'calibrating' && snapshot.received.sequence !== lastCalibrationSequence) {
    lastCalibrationSequence = snapshot.received.sequence;
    updateCalibration(snapshot.received, now);
  }
  if (state === 'menu') cursor.updatePose(snapshot.visual, now);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
