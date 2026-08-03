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
const ctx = canvas.getContext('2d');
const fpsValue = document.querySelector('#fpsValue');
const networkValue = document.querySelector('#networkValue');
const poseValue = document.querySelector('#poseValue');

const GAME_SECONDS = 45;
const BALLOON_COLORS = ['#ff5d8f', '#ff9f1c', '#2ec4b6', '#4d96ff', '#9b5de5', '#fee440'];
const BALLOON_SYMBOLS = ['★', '♥', '●', '✦', '♪'];

roomCode.textContent = room;
await socket.connect();
await socket.request('join', { room, role: 'tv' });

let phoneConnected = false;
let state = 'pairing';
let target = emptyPose();
let smooth = emptyPose();
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

function emptyPoint(x = 0.5, y = 0.5) {
  return { x, y, visible: false };
}

function emptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftElbow: emptyPoint(0.4, 0.48),
    rightElbow: emptyPoint(0.6, 0.48),
    leftShoulder: emptyPoint(0.44, 0.35),
    rightShoulder: emptyPoint(0.56, 0.35),
    nose: emptyPoint(0.5, 0.2),
    receivedAt: 0,
    capturedAt: 0
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
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
  connectionBadge.textContent = phoneConnected ? 'Celular conectado' : 'Aguardando celular';
  connectionBadge.className = `badge ${phoneConnected ? 'online' : 'waiting'}`;

  if (!phoneConnected) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    setState('pairing');
    target = emptyPose();
    smooth = emptyPose();
    return;
  }

  if (state === 'pairing') setState('calibrating');
}

socket.on('room-status', updateConnection);
socket.on('disconnect', () => updateConnection({ phone: false }));

socket.on('pose', (data) => {
  target = { ...emptyPose(), ...data, receivedAt: performance.now() };
  poseValue.textContent = data.detected ? 'detectada' : 'não detectada';
  if (data.capturedAt) networkValue.textContent = `${Math.max(0, Date.now() - data.capturedAt)} ms`;
});

setInterval(async () => {
  try {
    const sentAt = Date.now();
    const response = await socket.request('ping-latency', { sentAt }, 2500);
    if (!target.capturedAt) networkValue.textContent = `${Date.now() - response.sentAt} ms RTT`;
  } catch {
    connectionBadge.textContent = 'Servidor desconectado';
    connectionBadge.className = 'badge waiting';
  }
}, 2000);

document.querySelector('#fullscreenButton').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  } catch (error) {
    console.warn('Tela cheia indisponível.', error);
  }
});

restartButton.addEventListener('click', () => startCountdown());

function bodyReady(now) {
  const fresh = now - target.receivedAt < 650;
  return fresh && target.detected && target.left?.visible && target.right?.visible;
}

function handsRaised(pose) {
  if (!pose.left?.visible || !pose.right?.visible) return false;
  const shoulderY = Math.min(pose.leftShoulder?.y ?? 0.4, pose.rightShoulder?.y ?? 0.4);
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
  const progress = Math.min(1, (now - calibrationStartedAt) / 1800);
  calibrationProgress.style.width = `${Math.round(progress * 100)}%`;
  calibrationMessage.textContent = progress < 0.55 ? 'Ótimo, continue assim!' : 'Tudo certo!';
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
    playTone(760, 0.16);
    setTimeout(beginGame, 550);
  }, 800);
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
  const x = randomBetween(radius * 1.6, width - radius * 1.6);
  const color = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
  const special = Math.random() < 0.12;

  balloons.push({
    id: crypto.randomUUID?.() ?? `${now}-${Math.random()}`,
    x,
    y: height + radius * 1.5,
    radius: special ? radius * 1.15 : radius,
    speed: randomBetween(65, 110) + Math.min(55, score * 0.12),
    drift: randomBetween(-28, 28),
    phase: Math.random() * Math.PI * 2,
    color: special ? '#ffd43b' : color,
    symbol: special ? '★' : BALLOON_SYMBOLS[Math.floor(Math.random() * BALLOON_SYMBOLS.length)],
    special,
    bornAt: now
  });
}

function circleHit(balloon, hand, width, height) {
  if (!hand.visible) return false;
  const handX = hand.x * width;
  const handY = hand.y * height;
  const handRadius = Math.max(24, Math.min(width, height) * 0.038);
  const dx = balloon.x - handX;
  const dy = balloon.y - handY;
  const distanceSquared = dx * dx + dy * dy;
  return distanceSquared <= (balloon.radius + handRadius) ** 2;
}

function popBalloon(balloon) {
  const points = (balloon.special ? 20 : 10) * combo;
  score += points;
  consecutiveHits += 1;
  combo = Math.min(5, 1 + Math.floor(consecutiveHits / 4));
  popTexts.push({ x: balloon.x, y: balloon.y, text: `+${points}`, life: 1 });

  for (let i = 0; i < 18; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(70, 210);
    particles.push({
      x: balloon.x,
      y: balloon.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randomBetween(3, 8),
      color: balloon.color,
      life: 1
    });
  }

  playTone(balloon.special ? 820 : 620, balloon.special ? 0.16 : 0.08);
}

function updateGame(now, dt, width, height) {
  const elapsed = (now - gameStartedAt) / 1000;
  const remaining = GAME_SECONDS - elapsed;
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
    if (circleHit(balloon, smooth.left, width, height) || circleHit(balloon, smooth.right, width, height)) {
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
    particle.vy += 260 * seconds;
    particle.life -= seconds * 1.8;
  }
  particles = particles.filter((particle) => particle.life > 0);

  for (const text of popTexts) {
    text.y -= 50 * seconds;
    text.life -= seconds * 1.4;
  }
  popTexts = popTexts.filter((text) => text.life > 0);
}

function drawBackground(width, height, now) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#6a4cff');
  gradient.addColorStop(0.55, '#7c5cff');
  gradient.addColorStop(1, '#45c8ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(255,255,255,.10)';
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 127 + now * 0.012) % (width + 160)) - 80;
    const y = (i * 89) % Math.max(1, height);
    const radius = 18 + (i % 4) * 8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#5dd39e';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.88);
  ctx.quadraticCurveTo(width * 0.25, height * 0.79, width * 0.5, height * 0.89);
  ctx.quadraticCurveTo(width * 0.76, height * 0.98, width, height * 0.84);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
}

function drawBalloon(balloon) {
  ctx.save();
  ctx.translate(balloon.x, balloon.y);
  ctx.rotate(Math.sin(performance.now() / 450 + balloon.phase) * 0.08);

  ctx.strokeStyle = 'rgba(35, 41, 72, .35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, balloon.radius * 0.88);
  ctx.quadraticCurveTo(balloon.radius * 0.25, balloon.radius * 1.7, -balloon.radius * 0.08, balloon.radius * 2.4);
  ctx.stroke();

  ctx.fillStyle = balloon.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, balloon.radius * 0.82, balloon.radius, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.beginPath();
  ctx.ellipse(-balloon.radius * 0.25, -balloon.radius * 0.3, balloon.radius * 0.15, balloon.radius * 0.25, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = balloon.color;
  ctx.beginPath();
  ctx.moveTo(-7, balloon.radius * 0.82);
  ctx.lineTo(7, balloon.radius * 0.82);
  ctx.lineTo(0, balloon.radius * 1.08);
  ctx.closePath();
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
  const radius = Math.max(24, Math.min(width, height) * 0.038);

  ctx.save();
  ctx.shadowColor = 'rgba(37, 15, 112, .32)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = side === 'left' ? '#ff5d8f' : '#2ec4b6';
  ctx.fill();
  ctx.lineWidth = Math.max(4, radius * 0.16);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = `900 ${Math.round(radius * 0.95)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('✋', x, y + 1);
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

  for (const text of popTexts) {
    ctx.globalAlpha = Math.max(0, text.life);
    ctx.font = '900 30px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#5530b9';
    ctx.lineWidth = 6;
    ctx.strokeText(text.text, text.x, text.y);
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
}

function smoothPose(now) {
  const alpha = 0.52;
  const points = ['left', 'right', 'leftElbow', 'rightElbow', 'leftShoulder', 'rightShoulder', 'nose'];
  for (const point of points) {
    const targetPoint = target[point] ?? emptyPoint();
    smooth[point].x += (targetPoint.x - smooth[point].x) * alpha;
    smooth[point].y += (targetPoint.y - smooth[point].y) * alpha;
    smooth[point].visible = Boolean(targetPoint.visible && now - target.receivedAt < 650);
  }
  smooth.detected = target.detected && now - target.receivedAt < 650;
}

function handleRestartGesture(now) {
  if (state !== 'result') return;
  if (!handsRaised(smooth)) {
    raisedHandsStartedAt = 0;
    return;
  }
  if (!raisedHandsStartedAt) raisedHandsStartedAt = now;
  if (now - raisedHandsStartedAt >= 2000) {
    raisedHandsStartedAt = 0;
    startCountdown();
  }
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
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
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
    setTimeout(() => playTone(frequency, 0.18), index * 120);
  });
}

window.addEventListener('pointerdown', ensureAudio, { once: true });
window.addEventListener('keydown', ensureAudio, { once: true });

function frame(now) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;

  smoothPose(now);
  drawBackground(width, height, now);

  if (state === 'calibrating') handleCalibration(now);
  if (state === 'playing') updateGame(now, dt, width, height);
  handleRestartGesture(now);
  updateEffects(dt);

  for (const balloon of balloons) drawBalloon(balloon);
  drawEffects();

  if (phoneConnected && state !== 'pairing') {
    drawHand(smooth.left, 'left', width, height);
    drawHand(smooth.right, 'right', width, height);
  }

  fpsAccumulator += dt;
  fpsFrames += 1;
  if (fpsAccumulator >= 500) {
    fpsValue.textContent = String(Math.round((fpsFrames * 1000) / fpsAccumulator));
    fpsAccumulator = 0;
    fpsFrames = 0;
  }

  requestAnimationFrame(frame);
}

setState('pairing');
requestAnimationFrame(frame);
