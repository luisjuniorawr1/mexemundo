import { RealtimeClient } from './realtime.js';
import { createUniversalHandInput } from './game-hand-input.js';
import {
  MotionCursor,
  getPersistentRoom,
  roomHref
} from './motion-ui.js';

const socket = new RealtimeClient();
const handInput = createUniversalHandInput();
const room = getPersistentRoom();
const roomCode = document.querySelector('#roomCode');
const pairPanel = document.querySelector('#pairPanel');
const calibrationPanel = document.querySelector('#calibrationPanel');
const calibrationProgress = document.querySelector('#calibrationProgress');
const calibrationMessage = document.querySelector('#calibrationMessage');
const countdownPanel = document.querySelector('#countdownPanel');
const countdownValue = document.querySelector('#countdownValue');
const resultPanel = document.querySelector('#resultPanel');
const resultTitle = document.querySelector('#resultTitle');
const resultMessage = document.querySelector('#resultMessage');
const finalSaveValue = document.querySelector('#finalSaveValue');
const finalGoalValue = document.querySelector('#finalGoalValue');
const restartButton = document.querySelector('#restartButton');
const connectionBadge = document.querySelector('#connectionBadge');
const scoreHud = document.querySelector('#scoreHud');
const saveValue = document.querySelector('#saveValue');
const timeValue = document.querySelector('#timeValue');
const streakValue = document.querySelector('#streakValue');
const goalValue = document.querySelector('#goalValue');
const saveCallout = document.querySelector('#saveCallout');
const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const fpsValue = document.querySelector('#fpsValue');
const networkValue = document.querySelector('#networkValue');
const poseValue = document.querySelector('#poseValue');
const motionCursorElement = document.querySelector('#motionCursor');
const backButton = document.querySelector('#backButton');

const GAME_SECONDS = 45;
const GOAL_AREA = Object.freeze({ left: 0.14, right: 0.86, top: 0.30, bottom: 0.91 });
const SHOT_TARGET = Object.freeze({ left: 0.20, right: 0.80, top: 0.43, bottom: 0.82 });
const backgroundCanvas = document.createElement('canvas');
const backgroundCtx = backgroundCanvas.getContext('2d', { alpha: false });
const motionCursor = new MotionCursor({ element: motionCursorElement, dwellMs: 950, enabled: false });
backButton.href = roomHref('/', room);

roomCode.textContent = room;
await socket.connect();
await socket.request('join', { room, role: 'tv' });

let phoneConnected = false;
let transportMode = 'relay';
let transportRtt = 0;
let state = 'pairing';
let handFrames = handInput.sample();
let motion = handFrames.visual;
let collision = handFrames.collision;
let previousCollision = {
  left: { ...collision.left },
  right: { ...collision.right }
};
let calibrationStartedAt = 0;
let raisedHandsStartedAt = 0;
let countdownTimer = null;
let gameStartedAt = 0;
let saves = 0;
let goals = 0;
let streak = 0;
let bestStreak = 0;
let shots = [];
let particles = [];
let floatingTexts = [];
let lastShotAt = 0;
let nextShotDelay = 900;
let lastFrame = performance.now();
let fpsAccumulator = 0;
let fpsFrames = 0;
let audioContext = null;
let posePackets = 0;
let poseRate = 0;
let poseRateWindow = performance.now();
let goalFlashUntil = 0;
let calloutTimer = null;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeInCubic(value) {
  return value * value * value;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function refreshHands(now) {
  previousCollision = {
    left: { ...collision.left },
    right: { ...collision.right }
  };
  handFrames = handInput.sample(now);
  motion = handFrames.visual;
  collision = handFrames.collision;
}

function resize() {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  rebuildBackground(width, height);
}
window.addEventListener('resize', resize, { passive: true });
resize();

function rebuildBackground(width, height) {
  backgroundCanvas.width = width;
  backgroundCanvas.height = height;

  const sky = backgroundCtx.createLinearGradient(0, 0, 0, height * 0.48);
  sky.addColorStop(0, '#75d8ff');
  sky.addColorStop(1, '#dff8ff');
  backgroundCtx.fillStyle = sky;
  backgroundCtx.fillRect(0, 0, width, height * 0.48);

  backgroundCtx.fillStyle = '#2b9b5f';
  backgroundCtx.fillRect(0, height * 0.48, width, height * 0.52);

  const stripeHeight = height * 0.075;
  for (let y = height * 0.48, index = 0; y < height; y += stripeHeight, index += 1) {
    backgroundCtx.fillStyle = index % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,60,25,.035)';
    backgroundCtx.fillRect(0, y, width, stripeHeight);
  }

  backgroundCtx.fillStyle = 'rgba(20,39,66,.24)';
  backgroundCtx.fillRect(0, height * 0.37, width, height * 0.12);
  backgroundCtx.fillStyle = 'rgba(255,255,255,.34)';
  const crowdSize = Math.max(4, width / 180);
  for (let x = 0; x < width; x += crowdSize * 2.2) {
    const crowdY = height * (0.39 + ((x * 13) % 17) / 1000);
    backgroundCtx.beginPath();
    backgroundCtx.arc(x, crowdY, crowdSize, 0, Math.PI * 2);
    backgroundCtx.fill();
  }

  drawGoal(backgroundCtx, width, height);
}

function drawGoal(context, width, height) {
  const left = width * GOAL_AREA.left;
  const right = width * GOAL_AREA.right;
  const top = height * GOAL_AREA.top;
  const bottom = height * GOAL_AREA.bottom;
  const depth = Math.min(width, height) * 0.075;

  context.save();
  context.strokeStyle = 'rgba(255,255,255,.36)';
  context.lineWidth = 1.5;

  for (let index = 0; index <= 12; index += 1) {
    const x = lerp(left, right, index / 12);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }
  for (let index = 0; index <= 7; index += 1) {
    const y = lerp(top, bottom, index / 7);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  }

  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(8, Math.min(width, height) * 0.012);
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(left, bottom);
  context.lineTo(left, top);
  context.lineTo(right, top);
  context.lineTo(right, bottom);
  context.stroke();

  context.strokeStyle = 'rgba(255,255,255,.75)';
  context.lineWidth = Math.max(3, Math.min(width, height) * 0.005);
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left + depth, top - depth * 0.35);
  context.lineTo(right - depth, top - depth * 0.35);
  context.lineTo(right, top);
  context.stroke();
  context.restore();
}

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel.classList.toggle('hidden', next !== 'calibrating');
  countdownPanel.classList.toggle('hidden', next !== 'countdown');
  resultPanel.classList.toggle('hidden', next !== 'result');
  scoreHud.classList.toggle('hidden', next !== 'playing');
  motionCursor.setEnabled(phoneConnected && (next === 'calibrating' || next === 'result'));

  if (next !== 'calibrating') {
    calibrationStartedAt = 0;
    calibrationProgress.style.width = '0%';
  }
  if (next !== 'result') raisedHandsStartedAt = 0;
}

function updateConnection(status) {
  phoneConnected = Boolean(status.phone);
  connectionBadge.textContent = phoneConnected
    ? (transportMode === 'direct' ? 'Mãos universais • direto' : 'Celular conectado')
    : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    handInput.reset();
    handFrames = handInput.sample();
    motion = handFrames.visual;
    collision = handFrames.collision;
    previousCollision = {
      left: { ...collision.left },
      right: { ...collision.right }
    };
    shots = [];
    setState('pairing');
    return;
  }

  if (state === 'pairing') setState('calibrating');
}

socket.on('room-status', updateConnection);
socket.on('disconnect', () => updateConnection({ phone: false }));
socket.on('transport', ({ mode, rtt = 0 }) => {
  transportMode = mode;
  if (rtt) transportRtt = rtt;
  if (phoneConnected) {
    connectionBadge.textContent = mode === 'direct' ? 'Mãos universais • direto' : 'Modo servidor';
    connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
  }
});
socket.on('pose', (data) => {
  const frames = handInput.ingest(data);
  posePackets += 1;
  if (state !== 'playing' && state !== 'countdown') motionCursor.updatePose(frames.visual);
});

setInterval(async () => {
  try {
    const startedAt = performance.now();
    await socket.request('ping-latency', { sentAt: Date.now() }, 1800);
    transportRtt = Math.round(performance.now() - startedAt);
  } catch {
    // O diagnóstico não interfere na partida.
  }
}, 1500);

document.querySelector('#fullscreenButton').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch (error) {
    console.warn('Tela cheia indisponível.', error);
  }
});
restartButton.addEventListener('click', startCountdown);

function bodyReady() {
  return motion.fresh && motion.detected && motion.left.visible && motion.right.visible;
}

function handsRaised(pose) {
  if (!pose.left.visible || !pose.right.visible) return false;
  const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
  return pose.left.y < shoulderY && pose.right.y < shoulderY;
}

function handleCalibration(now) {
  const ready = bodyReady();
  const raised = ready && handsRaised(motion);
  if (!raised) {
    calibrationStartedAt = 0;
    calibrationProgress.style.width = '0%';
    calibrationMessage.textContent = !motion.detected
      ? 'Procurando o goleiro…'
      : !ready
        ? 'Mostre as duas mãos…'
        : 'Agora levante as mãos!';
    return;
  }

  if (!calibrationStartedAt) calibrationStartedAt = now;
  const progress = Math.min(1, (now - calibrationStartedAt) / 1050);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.55 ? 'Perfil universal reconhecido!' : 'Luvas prontas!';
  if (progress >= 1) startCountdown();
}

function startCountdown() {
  if (!phoneConnected || countdownTimer) return;
  setState('countdown');
  let count = 3;
  countdownValue.textContent = String(count);
  playTone(440, 0.08);

  countdownTimer = setInterval(() => {
    count -= 1;
    if (count > 0) {
      countdownValue.textContent = String(count);
      playTone(440 + (3 - count) * 90, 0.08);
      return;
    }

    clearInterval(countdownTimer);
    countdownTimer = null;
    countdownValue.textContent = 'DEFENDA!';
    playTone(760, 0.14);
    setTimeout(beginGame, 380);
  }, 650);
}

function beginGame() {
  saves = 0;
  goals = 0;
  streak = 0;
  bestStreak = 0;
  shots = [];
  particles = [];
  floatingTexts = [];
  gameStartedAt = performance.now();
  lastShotAt = gameStartedAt - 800;
  nextShotDelay = 650;
  goalFlashUntil = 0;
  updateHud(GAME_SECONDS);
  setState('playing');
}

function endGame() {
  setState('result');
  finalSaveValue.textContent = String(saves);
  finalGoalValue.textContent = String(goals);

  const efficiency = saves + goals > 0 ? saves / (saves + goals) : 0;
  if (efficiency >= 0.86 && saves >= 10) {
    resultTitle.textContent = 'Muralha do gol!';
    resultMessage.textContent = `Sua melhor sequência foi de ${bestStreak} defesas. Quase nada passou!`;
  } else if (efficiency >= 0.65) {
    resultTitle.textContent = 'Que goleiro!';
    resultMessage.textContent = `Você fez ${saves} defesas e chegou a uma sequência de ${bestStreak}.`;
  } else {
    resultTitle.textContent = 'Boa partida!';
    resultMessage.textContent = 'Observe a trajetória e espere a bola se aproximar antes de defender.';
  }

  playCelebration();
}

function updateHud(remaining) {
  saveValue.textContent = String(saves);
  timeValue.textContent = String(Math.max(0, Math.ceil(remaining)));
  streakValue.textContent = `x${streak}`;
  goalValue.textContent = String(goals);
}

function spawnShot(now, elapsed) {
  const difficulty = clamp(elapsed / GAME_SECONDS);
  const golden = Math.random() < 0.14;
  const duration = randomBetween(1500, 1950) - difficulty * 520;
  const targetX = randomBetween(SHOT_TARGET.left, SHOT_TARGET.right);
  const targetY = randomBetween(SHOT_TARGET.top, SHOT_TARGET.bottom);
  const sourceX = randomBetween(0.37, 0.63);
  const sourceY = randomBetween(0.40, 0.47);

  shots.push({
    id: `${now}-${Math.random()}`,
    createdAt: now,
    duration: Math.max(900, duration),
    sourceX,
    sourceY,
    targetX,
    targetY,
    curve: randomBetween(-0.10, 0.10) * (0.45 + difficulty * 0.8),
    spin: randomBetween(-5, 5),
    golden,
    state: 'flying',
    progress: 0,
    x: sourceX,
    y: sourceY,
    radius: 0.018,
    vx: 0,
    vy: 0,
    savedAt: 0,
    opacity: 1
  });

  const baseDelay = 1180 - difficulty * 430;
  nextShotDelay = randomBetween(baseDelay * 0.86, baseDelay * 1.15);
}

function updateShotPosition(shot, now) {
  if (shot.state === 'saved') {
    const elapsed = (now - shot.savedAt) / 1000;
    const step = Math.min(0.035, elapsed + 0.012);
    shot.x += shot.vx * step;
    shot.y += shot.vy * step;
    shot.vy += 0.85 * step;
    shot.opacity = Math.max(0, 1 - elapsed * 2.2);
    return;
  }

  shot.progress = clamp((now - shot.createdAt) / shot.duration);
  const travel = easeInCubic(shot.progress);
  const curveOffset = Math.sin(shot.progress * Math.PI) * shot.curve;
  shot.x = lerp(shot.sourceX, shot.targetX, travel) + curveOffset;
  shot.y = lerp(shot.sourceY, shot.targetY, travel);
  shot.radius = lerp(0.015, shot.golden ? 0.058 : 0.052, travel);
}

function distanceToSegmentSquared(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 0.0000001) return (px - ax) ** 2 + (py - ay) ** 2;
  const amount = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared);
  const closestX = ax + abx * amount;
  const closestY = ay + aby * amount;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
}

function handBlocksShot(shot, previous, current, width, height) {
  if (!current.visible || shot.progress < 0.58 || shot.state !== 'flying') return false;

  const ballX = shot.x * width;
  const ballY = shot.y * height;
  const previousX = (previous.visible ? previous.x : current.x) * width;
  const previousY = (previous.visible ? previous.y : current.y) * height;
  const currentX = current.x * width;
  const currentY = current.y * height;
  const ballRadius = shot.radius * Math.min(width, height);
  const gloveRadius = Math.max(31, Math.min(width, height) * 0.048);
  const radius = ballRadius + gloveRadius;

  return distanceToSegmentSquared(
    ballX,
    ballY,
    previousX,
    previousY,
    currentX,
    currentY
  ) <= radius * radius;
}

function saveShot(shot, hand, now, width, height) {
  shot.state = 'saved';
  shot.savedAt = now;
  shot.vx = clamp(hand.vx * 0.18, -0.7, 0.7);
  shot.vy = clamp(hand.vy * 0.12 - 0.45, -0.9, -0.25);

  saves += 1;
  streak += 1;
  bestStreak = Math.max(bestStreak, streak);
  const points = shot.golden ? 20 : 10;
  floatingTexts.push({
    x: shot.x * width,
    y: shot.y * height,
    text: shot.golden ? `DEFESA DOURADA +${points}` : `DEFESA +${points}`,
    life: 1
  });
  createSaveParticles(shot.x * width, shot.y * height, shot.golden ? '#ffd43b' : '#ffffff');
  showCallout(shot.golden ? 'DEFESA DOURADA!' : streak >= 3 ? `${streak} SEGUIDAS!` : 'DEFESA!');
  playTone(shot.golden ? 900 : 690, shot.golden ? 0.16 : 0.09);
}

function concedeGoal(shot, now, width, height) {
  shot.state = 'goal';
  goals += 1;
  streak = 0;
  goalFlashUntil = now + 230;
  floatingTexts.push({
    x: shot.x * width,
    y: shot.y * height,
    text: 'GOL!',
    life: 1,
    danger: true
  });
  playTone(180, 0.22);
}

function createSaveParticles(x, y, color) {
  for (let index = 0; index < 12; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(90, 240);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randomBetween(3, 8),
      color,
      life: 1
    });
  }
}

function showCallout(text) {
  clearTimeout(calloutTimer);
  saveCallout.textContent = text;
  saveCallout.classList.remove('hidden');
  saveCallout.classList.remove('goalkeeper-callout-pop');
  void saveCallout.offsetWidth;
  saveCallout.classList.add('goalkeeper-callout-pop');
  calloutTimer = setTimeout(() => saveCallout.classList.add('hidden'), 620);
}

function updateGame(now, dt, width, height) {
  const elapsed = (now - gameStartedAt) / 1000;
  const remaining = GAME_SECONDS - elapsed;
  if (remaining <= 0) {
    updateHud(0);
    endGame();
    return;
  }

  if (now - lastShotAt >= nextShotDelay && shots.filter((shot) => shot.state === 'flying').length < 2) {
    spawnShot(now, elapsed);
    lastShotAt = now;
  }

  for (const shot of shots) {
    updateShotPosition(shot, now);
    if (shot.state !== 'flying') continue;

    if (handBlocksShot(shot, previousCollision.left, collision.left, width, height)) {
      saveShot(shot, collision.left, now, width, height);
      continue;
    }
    if (handBlocksShot(shot, previousCollision.right, collision.right, width, height)) {
      saveShot(shot, collision.right, now, width, height);
      continue;
    }
    if (shot.progress >= 1) concedeGoal(shot, now, width, height);
  }

  shots = shots.filter((shot) => {
    if (shot.state === 'goal') return false;
    if (shot.state === 'saved' && shot.opacity <= 0) return false;
    return true;
  });

  updateHud(remaining);
  updateEffects(dt);
}

function updateEffects(dt) {
  const seconds = dt / 1000;
  for (const particle of particles) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vy += 300 * seconds;
    particle.life -= seconds * 2.5;
  }
  particles = particles.filter((particle) => particle.life > 0);

  for (const text of floatingTexts) {
    text.y -= 55 * seconds;
    text.life -= seconds * 1.65;
  }
  floatingTexts = floatingTexts.filter((text) => text.life > 0);
}

function handleRestartGesture(now) {
  if (state !== 'result') return;
  if (!handsRaised(motion)) {
    raisedHandsStartedAt = 0;
    return;
  }
  if (!raisedHandsStartedAt) raisedHandsStartedAt = now;
  if (now - raisedHandsStartedAt >= 1500) {
    raisedHandsStartedAt = 0;
    startCountdown();
  }
}

function drawBackground(width, height, now) {
  ctx.drawImage(backgroundCanvas, 0, 0, width, height);
  if (goalFlashUntil > now) {
    ctx.fillStyle = 'rgba(255,60,80,.22)';
    ctx.fillRect(0, 0, width, height);
  }
}

function drawShot(shot, now, width, height) {
  const x = shot.x * width;
  const y = shot.y * height;
  const radius = shot.radius * Math.min(width, height);
  if (radius < 2 || shot.opacity <= 0) return;

  ctx.save();
  ctx.globalAlpha = shot.opacity;
  ctx.translate(x, y);
  ctx.rotate((now / 1000) * shot.spin);

  ctx.fillStyle = 'rgba(10,30,20,.18)';
  ctx.beginPath();
  ctx.ellipse(radius * 0.18, radius * 0.38, radius * 0.92, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = shot.golden ? '#ffd43b' : '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shot.golden ? '#fff0a6' : '#d9e1e8';
  ctx.lineWidth = Math.max(2, radius * 0.08);
  ctx.stroke();

  ctx.fillStyle = shot.golden ? '#8a6100' : '#1f2937';
  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius * 0.48, Math.sin(angle) * radius * 0.48, radius * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlove(hand, side, width, height) {
  if (!hand.visible) return;
  const x = hand.x * width;
  const y = hand.y * height;
  const radius = Math.max(31, Math.min(width, height) * 0.048);

  ctx.save();
  ctx.translate(x, y);
  const rawSpeed = Math.hypot(hand.vx, hand.vy);
  const displaySpeed = rawSpeed >= 0.24 ? rawSpeed : 0;
  const displayVx = Math.abs(hand.vx) >= 0.22 ? hand.vx : 0;
  ctx.rotate(clamp(displayVx * 0.08, -0.25, 0.25));
  ctx.fillStyle = side === 'left' ? '#ff6b6b' : '#23c483';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(4, radius * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, radius * (1 + Math.min(0.12, displaySpeed * 0.03)), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = `900 ${Math.round(radius * 1.05)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('🧤', 0, 2);
  ctx.restore();
}

function drawEffects() {
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const text of floatingTexts) {
    ctx.globalAlpha = Math.max(0, text.life);
    ctx.font = '950 27px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = text.danger ? '#ff6b6b' : '#ffffff';
    ctx.strokeStyle = text.danger ? '#6b1020' : '#087f5b';
    ctx.lineWidth = 5;
    ctx.strokeText(text.text, text.x, text.y);
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}

function playTone(frequency, duration = 0.08) {
  try {
    ensureAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.075, audioContext.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.02);
  } catch {
    // O navegador pode bloquear áudio até a primeira interação.
  }
}

function playCelebration() {
  [523, 659, 784, 1047].forEach((frequency, index) => {
    setTimeout(() => playTone(frequency, 0.16), index * 105);
  });
}

window.addEventListener('pointerdown', ensureAudio, { once: true });
window.addEventListener('keydown', ensureAudio, { once: true });

function frame(now) {
  resize();
  const width = canvas.width;
  const height = canvas.height;
  const dt = Math.min(40, now - lastFrame);
  lastFrame = now;

  refreshHands(now);
  drawBackground(width, height, now);

  if (state === 'calibrating') handleCalibration(now);
  if (state === 'playing') updateGame(now, dt, width, height);
  else updateEffects(dt);
  handleRestartGesture(now);

  for (const shot of shots) drawShot(shot, now, width, height);
  drawEffects();
  if (phoneConnected && state !== 'pairing') {
    drawGlove(motion.left, 'left', width, height);
    drawGlove(motion.right, 'right', width, height);
  }

  fpsAccumulator += dt;
  fpsFrames += 1;
  if (fpsAccumulator >= 500) {
    fpsValue.textContent = String(Math.round((fpsFrames * 1000) / fpsAccumulator));
    fpsAccumulator = 0;
    fpsFrames = 0;
  }

  if (now - poseRateWindow >= 1000) {
    poseRate = posePackets;
    posePackets = 0;
    poseRateWindow = now;
    poseValue.textContent = motion.detected
      ? `mãos universais • ${poseRate}/s • IA ${motion.processingMs} ms`
      : 'mãos não detectadas';
    networkValue.textContent = `${transportMode === 'direct' ? 'Direto' : 'Servidor'} • ${transportRtt || '--'} ms • ${poseRate}/s`;
  }

  requestAnimationFrame(frame);
}

setState('pairing');
requestAnimationFrame(frame);
