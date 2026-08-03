import { RealtimeClient } from './realtime.js';

const socket = new RealtimeClient();
const room = Math.random().toString(36).slice(2, 6).toUpperCase();
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
const finalScoreValue = document.querySelector('#finalScoreValue');
const restartButton = document.querySelector('#restartButton');
const connectionBadge = document.querySelector('#connectionBadge');
const scoreHud = document.querySelector('#scoreHud');
const scoreValue = document.querySelector('#scoreValue');
const timeValue = document.querySelector('#timeValue');
const comboValue = document.querySelector('#comboValue');
const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const fpsValue = document.querySelector('#fpsValue');
const networkValue = document.querySelector('#networkValue');
const poseValue = document.querySelector('#poseValue');

const GAME_SECONDS = 45;
const POSE_TIMEOUT_MS = 240;
const POINT_NAMES = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const WRIST_NAMES = new Set(['left', 'right']);
const BALLOON_COLORS = ['#ff5d8f', '#ff9f1c', '#2ec4b6', '#4d96ff', '#9b5de5', '#fee440'];
const BALLOON_SYMBOLS = ['★', '♥', '●', '✦', '♪'];
const backgroundCanvas = document.createElement('canvas');
const backgroundCtx = backgroundCanvas.getContext('2d', { alpha: false });

roomCode.textContent = room;
await socket.connect();
await socket.request('join', { room, role: 'tv' });

let phoneConnected = false;
let transportMode = 'relay';
let transportRtt = 0;
let state = 'pairing';
let target = emptyPose();
let motion = emptyPose();
let previousHands = { left: emptyPoint(0.35, 0.55), right: emptyPoint(0.65, 0.55) };
let calibrationStartedAt = 0;
let raisedHandsStartedAt = 0;
let countdownTimer = null;
let gameStartedAt = 0;
let score = 0;
let combo = 1;
let consecutiveHits = 0;
let balloons = [];
let particles = [];
let popTexts = [];
let lastSpawnAt = 0;
let lastFrame = performance.now();
let fpsAccumulator = 0;
let fpsFrames = 0;
let audioContext = null;
let posePackets = 0;
let poseRate = 0;
let poseRateWindow = performance.now();

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function emptyPoint(x = 0.5, y = 0.5) {
  return { x, y, vx: 0, vy: 0, visible: false };
}

function emptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.35),
    rightShoulder: emptyPoint(0.56, 0.35),
    receivedAt: 0,
    sequence: 0,
    processingMs: 0,
    sourceIntervalMs: 0
  };
}

function normalizePoint(point, fallback) {
  return {
    x: clamp(Number.isFinite(point?.x) ? point.x : fallback.x),
    y: clamp(Number.isFinite(point?.y) ? point.y : fallback.y),
    vx: clamp(Number.isFinite(point?.vx) ? point.vx : 0, -4, 4),
    vy: clamp(Number.isFinite(point?.vy) ? point.vy : 0, -4, 4),
    visible: Boolean(point?.visible)
  };
}

function normalizePose(data) {
  const pose = emptyPose();
  for (const name of POINT_NAMES) pose[name] = normalizePoint(data?.[name], pose[name]);
  pose.detected = Boolean(data?.detected);
  pose.receivedAt = performance.now();
  pose.sequence = Number(data?.sequence || 0);
  pose.processingMs = Number(data?.processingMs || 0);
  pose.sourceIntervalMs = Number(data?.sourceIntervalMs || 0);
  return pose;
}

function rebuildBackground(width, height) {
  backgroundCanvas.width = Math.max(1, Math.round(width));
  backgroundCanvas.height = Math.max(1, Math.round(height));
  const gradient = backgroundCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#6a4cff');
  gradient.addColorStop(0.55, '#7c5cff');
  gradient.addColorStop(1, '#45c8ff');
  backgroundCtx.fillStyle = gradient;
  backgroundCtx.fillRect(0, 0, width, height);

  backgroundCtx.fillStyle = 'rgba(255,255,255,.09)';
  for (let i = 0; i < 12; i += 1) {
    const x = (i * 137) % Math.max(1, width);
    const y = (i * 91) % Math.max(1, height);
    backgroundCtx.beginPath();
    backgroundCtx.arc(x, y, 16 + (i % 4) * 7, 0, Math.PI * 2);
    backgroundCtx.fill();
  }

  backgroundCtx.fillStyle = '#5dd39e';
  backgroundCtx.beginPath();
  backgroundCtx.moveTo(0, height * 0.88);
  backgroundCtx.quadraticCurveTo(width * 0.25, height * 0.79, width * 0.5, height * 0.89);
  backgroundCtx.quadraticCurveTo(width * 0.76, height * 0.98, width, height * 0.84);
  backgroundCtx.lineTo(width, height);
  backgroundCtx.lineTo(0, height);
  backgroundCtx.closePath();
  backgroundCtx.fill();
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

function setState(next) {
  state = next;
  pairPanel.classList.toggle('hidden', next !== 'pairing');
  calibrationPanel.classList.toggle('hidden', next !== 'calibrating');
  countdownPanel.classList.toggle('hidden', next !== 'countdown');
  resultPanel.classList.toggle('hidden', next !== 'result');
  scoreHud.classList.toggle('hidden', next !== 'playing');

  if (next !== 'calibrating') {
    calibrationStartedAt = 0;
    calibrationProgress.style.width = '0%';
  }
  if (next !== 'result') raisedHandsStartedAt = 0;
}

function updateConnection(status) {
  phoneConnected = Boolean(status.phone);
  connectionBadge.textContent = phoneConnected
    ? (transportMode === 'direct' ? 'SUPER TURBO direto' : 'Celular conectado')
    : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    setState('pairing');
    target = emptyPose();
    motion = emptyPose();
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
    connectionBadge.textContent = mode === 'direct' ? 'SUPER TURBO direto' : 'Modo servidor';
    connectionBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
  }
});
socket.on('pose', (data) => {
  target = normalizePose(data);
  posePackets += 1;
});

setInterval(async () => {
  try {
    const startedAt = performance.now();
    await socket.request('ping-latency', { sentAt: Date.now() }, 1800);
    transportRtt = Math.round(performance.now() - startedAt);
  } catch {
    // O diagnóstico não deve interferir na partida.
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

function bodyReady(now) {
  const fresh = now - target.receivedAt < POSE_TIMEOUT_MS;
  return fresh && target.detected && target.left.visible && target.right.visible;
}

function handsRaised(pose) {
  if (!pose.left.visible || !pose.right.visible) return false;
  const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
  return pose.left.y < shoulderY && pose.right.y < shoulderY;
}

function handleCalibration(now) {
  const ready = bodyReady(now);
  const raised = ready && handsRaised(target);
  if (!raised) {
    calibrationStartedAt = 0;
    calibrationProgress.style.width = '0%';
    calibrationMessage.textContent = !target.detected
      ? 'Procurando você…'
      : !ready
        ? 'Mostre as duas mãos…'
        : 'Agora levante as mãos!';
    return;
  }

  if (!calibrationStartedAt) calibrationStartedAt = now;
  const progress = Math.min(1, (now - calibrationStartedAt) / 1100);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.55 ? 'Ótimo, continue assim!' : 'Super Turbo pronto!';
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
    countdownValue.textContent = 'JÁ!';
    playTone(760, 0.14);
    setTimeout(beginGame, 350);
  }, 650);
}

function beginGame() {
  score = 0;
  combo = 1;
  consecutiveHits = 0;
  balloons = [];
  particles = [];
  popTexts = [];
  gameStartedAt = performance.now();
  lastSpawnAt = 0;
  updateHud(GAME_SECONDS);
  setState('playing');
}

function endGame() {
  setState('result');
  finalScoreValue.textContent = String(score);
  if (score >= 180) {
    resultTitle.textContent = 'Você é um mestre dos balões!';
    resultMessage.textContent = 'Velocidade, atenção e mãos certeiras!';
  } else if (score >= 100) {
    resultTitle.textContent = 'Mandou muito bem!';
    resultMessage.textContent = 'Mais uma rodada e o recorde vai subir!';
  } else {
    resultTitle.textContent = 'Boa brincadeira!';
    resultMessage.textContent = 'Continue se mexendo para estourar ainda mais.';
  }
  playCelebration();
}

function updateHud(remaining) {
  scoreValue.textContent = String(score);
  timeValue.textContent = String(Math.max(0, Math.ceil(remaining)));
  comboValue.textContent = `x${combo}`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function spawnBalloon(width, height, now) {
  const radius = Math.max(30, Math.min(width, height) * randomBetween(0.038, 0.055));
  const special = Math.random() < 0.12;
  balloons.push({
    id: `${now}-${Math.random()}`,
    x: randomBetween(radius * 1.6, width - radius * 1.6),
    y: height + radius * 1.5,
    radius: special ? radius * 1.15 : radius,
    speed: randomBetween(65, 110) + Math.min(55, score * 0.12),
    drift: randomBetween(-28, 28),
    phase: Math.random() * Math.PI * 2,
    color: special ? '#ffd43b' : BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)],
    symbol: special ? '★' : BALLOON_SYMBOLS[Math.floor(Math.random() * BALLOON_SYMBOLS.length)],
    special
  });
}

function distanceToSegmentSquared(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 0.0001) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
}

function sweptHandHit(balloon, previous, current, width, height) {
  if (!current.visible) return false;
  const handRadius = Math.max(28, Math.min(width, height) * 0.044);
  const currentX = current.x * width;
  const currentY = current.y * height;
  const previousX = previous.visible ? previous.x * width : currentX;
  const previousY = previous.visible ? previous.y * height : currentY;
  const radius = balloon.radius + handRadius;
  return distanceToSegmentSquared(
    balloon.x,
    balloon.y,
    previousX,
    previousY,
    currentX,
    currentY
  ) <= radius * radius;
}

function popBalloon(balloon) {
  const points = (balloon.special ? 20 : 10) * combo;
  score += points;
  consecutiveHits += 1;
  combo = Math.min(5, 1 + Math.floor(consecutiveHits / 4));
  popTexts.push({ x: balloon.x, y: balloon.y, text: `+${points}`, life: 1 });

  for (let i = 0; i < 8; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(80, 180);
    particles.push({
      x: balloon.x,
      y: balloon.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randomBetween(3, 7),
      color: balloon.color,
      life: 1
    });
  }
  playTone(balloon.special ? 820 : 620, balloon.special ? 0.14 : 0.07);
}

function updateGame(now, dt, width, height) {
  const remaining = GAME_SECONDS - (now - gameStartedAt) / 1000;
  if (remaining <= 0) {
    updateHud(0);
    endGame();
    return;
  }

  const spawnInterval = Math.max(360, 850 - score * 1.6);
  if (now - lastSpawnAt >= spawnInterval && balloons.length < 10) {
    spawnBalloon(width, height, now);
    lastSpawnAt = now;
  }

  const seconds = dt / 1000;
  for (const balloon of balloons) {
    balloon.y -= balloon.speed * seconds;
    balloon.x += (balloon.drift + Math.sin(now / 500 + balloon.phase) * 18) * seconds;
  }

  const poppedIds = new Set();
  for (const balloon of balloons) {
    if (
      sweptHandHit(balloon, previousHands.left, motion.left, width, height)
      || sweptHandHit(balloon, previousHands.right, motion.right, width, height)
    ) {
      poppedIds.add(balloon.id);
      popBalloon(balloon);
    }
  }

  let missed = false;
  balloons = balloons.filter((balloon) => {
    if (poppedIds.has(balloon.id)) return false;
    if (balloon.y + balloon.radius < -20) {
      missed = true;
      return false;
    }
    return true;
  });
  if (missed) {
    consecutiveHits = 0;
    combo = 1;
  }
  updateHud(remaining);
}

function updateEffects(dt) {
  const seconds = dt / 1000;
  for (const particle of particles) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vy += 250 * seconds;
    particle.life -= seconds * 2.2;
  }
  particles = particles.filter((particle) => particle.life > 0);

  for (const text of popTexts) {
    text.y -= 55 * seconds;
    text.life -= seconds * 1.8;
  }
  popTexts = popTexts.filter((text) => text.life > 0);
}

function updateMotion(now, dt) {
  const fresh = now - target.receivedAt < POSE_TIMEOUT_MS;
  previousHands.left = { ...motion.left };
  previousHands.right = { ...motion.right };

  for (const name of POINT_NAMES) {
    const source = target[name];
    const current = motion[name];
    const visible = Boolean(fresh && target.detected && source.visible);
    current.visible = visible;
    if (!visible) continue;

    const isWrist = WRIST_NAMES.has(name);
    const speed = Math.hypot(source.vx, source.vy);
    const packetAge = Math.min((now - target.receivedAt) / 1000, 0.025);
    const lead = isWrist ? Math.min(0.032, 0.008 + packetAge) : 0;
    const desiredX = clamp(source.x + source.vx * lead * 0.55);
    const desiredY = clamp(source.y + source.vy * lead * 0.55);
    const distance = Math.hypot(desiredX - current.x, desiredY - current.y);

    if (isWrist) {
      if (!motion.detected || distance > 0.0015 || speed > 0.08) {
        current.x = desiredX;
        current.y = desiredY;
      }
    } else {
      const seconds = Math.max(1 / 120, dt / 1000);
      const alpha = 1 - Math.exp(-seconds / 0.04);
      current.x += (desiredX - current.x) * alpha;
      current.y += (desiredY - current.y) * alpha;
    }
    current.vx = source.vx;
    current.vy = source.vy;
  }
  motion.detected = Boolean(fresh && target.detected);
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

function drawBackground(width, height) {
  ctx.drawImage(backgroundCanvas, 0, 0, width, height);
}

function drawBalloon(balloon, now) {
  ctx.save();
  ctx.translate(balloon.x, balloon.y);
  ctx.rotate(Math.sin(now / 450 + balloon.phase) * 0.08);

  ctx.strokeStyle = 'rgba(35, 41, 72, .3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, balloon.radius * 0.88);
  ctx.quadraticCurveTo(balloon.radius * 0.25, balloon.radius * 1.7, -balloon.radius * 0.08, balloon.radius * 2.4);
  ctx.stroke();

  ctx.fillStyle = balloon.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, balloon.radius * 0.82, balloon.radius, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.ellipse(-balloon.radius * 0.25, -balloon.radius * 0.3, balloon.radius * 0.15, balloon.radius * 0.25, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = balloon.special ? '#704f00' : 'rgba(255,255,255,.92)';
  ctx.font = `900 ${Math.round(balloon.radius * 0.58)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(balloon.symbol, 0, 2);
  ctx.restore();
}

function drawHand(hand, side, width, height) {
  if (!hand.visible) return;
  const x = hand.x * width;
  const y = hand.y * height;
  const radius = Math.max(28, Math.min(width, height) * 0.044);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = side === 'left' ? '#ff5d8f' : '#2ec4b6';
  ctx.fill();
  ctx.lineWidth = Math.max(4, radius * 0.15);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.font = `900 ${Math.round(radius * 0.9)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('✋', x, y + 1);
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

  for (const text of popTexts) {
    ctx.globalAlpha = Math.max(0, text.life);
    ctx.font = '900 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#5530b9';
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
    gain.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.008);
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
    setTimeout(() => playTone(frequency, 0.16), index * 100);
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

  updateMotion(now, dt);
  drawBackground(width, height);
  if (state === 'calibrating') handleCalibration(now);
  if (state === 'playing') updateGame(now, dt, width, height);
  handleRestartGesture(now);
  updateEffects(dt);

  for (const balloon of balloons) drawBalloon(balloon, now);
  drawEffects();
  if (phoneConnected && state !== 'pairing') {
    drawHand(motion.left, 'left', width, height);
    drawHand(motion.right, 'right', width, height);
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
    poseValue.textContent = target.detected
      ? `detectada • ${poseRate}/s • IA ${target.processingMs} ms`
      : 'não detectada';
    networkValue.textContent = `${transportMode === 'direct' ? 'Direto' : 'Servidor'} • ${transportRtt || '--'} ms • ${poseRate}/s`;
  }

  requestAnimationFrame(frame);
}

setState('pairing');
requestAnimationFrame(frame);
