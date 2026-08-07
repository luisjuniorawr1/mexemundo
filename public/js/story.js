import { RealtimeClient } from './realtime.js';
import { POSE_TIMEOUT_MS, NARRATIVE_TIME_SCALE, CHAPTERS, NARRATIVE } from './story-data.js';
import { createStoryArt } from './story-art.js';

const socket = new RealtimeClient();
const canvas = document.querySelector('#storyCanvas');
const connectionBadge = document.querySelector('#connectionBadge');
const messageCard = document.querySelector('#messageCard');
const messageEyebrow = document.querySelector('#messageEyebrow');
const messageTitle = document.querySelector('#messageTitle');
const messageText = document.querySelector('#messageText');
const messageProgress = document.querySelector('#messageProgress');
const objective = document.querySelector('#objective');
const storyProgress = document.querySelector('#storyProgress');
const endingCard = document.querySelector('#endingCard');
const restartButton = document.querySelector('#restartButton');
const art = createStoryArt(canvas);

const room = String(new URLSearchParams(location.search).get('sala') || '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const emptyPoint = (x, y) => ({ x, y, vx: 0, vy: 0, visible: false });
const emptyPose = () => ({
  detected: false,
  left: emptyPoint(0.35, 0.55), right: emptyPoint(0.65, 0.55),
  leftShoulder: emptyPoint(0.44, 0.36), rightShoulder: emptyPoint(0.56, 0.36)
});

let pose = emptyPose();
let lastPoseAt = 0;
let phoneConnected = false;
let state = room.length >= 4 ? 'waiting' : 'invalid-room';
let scene = 'arrival';
let sceneElapsedMs = 0;
let neutralShoulderY = 0.36;
let neutralShoulderX = 0.5;
let calibrationStartedAt = 0;
let actionHold = 0;
let restartHold = 0;
let lastFrame = performance.now();
let applesCaught = 0;
let apples = [];
let appleSpawnAt = 0;
let firefliesCaught = new Set();
let fireflyTargets = [];
let riverProgress = 0;
let bridgeTarget = 0;
let duckCount = 0;
let duckWasLow = false;
let audioContext = null;

function handsReady(now = performance.now()) {
  return phoneConnected && now - lastPoseAt < POSE_TIMEOUT_MS && pose.detected && pose.left.visible && pose.right.visible;
}
function shouldersReady(now = performance.now()) {
  return handsReady(now) && pose.leftShoulder.visible && pose.rightShoulder.visible;
}
function poseReady(now = performance.now()) { return handsReady(now); }
function handDistance() { return Math.abs(pose.right.x - pose.left.x); }
function handMidX() { return (pose.left.x + pose.right.x) / 2; }
function shoulderMidX() { return (pose.leftShoulder.x + pose.rightShoulder.x) / 2; }
function shoulderMidY() { return (pose.leftShoulder.y + pose.rightShoulder.y) / 2; }
function bothHandsRaised() {
  if (!pose.left.visible || !pose.right.visible) return false;
  const shoulderY = shouldersReady() ? Math.min(pose.leftShoulder.y, pose.rightShoulder.y) : 0.32;
  return pose.left.y < shoulderY - 0.02 && pose.right.y < shoulderY - 0.02;
}

function setObjective(text = '') {
  objective.textContent = text;
  objective.classList.toggle('hidden', !text);
}
function showMessage(eyebrow, title, text, progress = null, dialogue = false) {
  messageCard.classList.toggle('dialogue', dialogue);
  messageEyebrow.textContent = eyebrow;
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageProgress.style.width = `${Math.round(clamp(progress ?? 0) * 100)}%`;
  messageCard.classList.remove('hidden');
}
function hideMessage() {
  messageCard.classList.add('hidden');
  messageCard.classList.remove('dialogue');
}
function updateProgress() {
  const current = Math.max(0, CHAPTERS.findIndex((chapter) => chapter.includes(scene)));
  storyProgress.innerHTML = CHAPTERS.map((_, index) => `<i class="${index < current ? 'done' : index === current ? 'current' : ''}"></i>`).join('');
}
function resize() {
  const scale = Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.resume?.().catch(() => {});
}
function tone(frequency, duration = 0.08) {
  try {
    ensureAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, audioContext.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration + 0.03);
  } catch {}
}
function sceneTone() { [523, 659, 784].forEach((frequency, index) => setTimeout(() => tone(frequency, 0.1), index * 75)); }

function nextScene(next) {
  scene = next;
  sceneElapsedMs = 0;
  actionHold = 0;
  setObjective(''); hideMessage(); updateProgress();
  if (next === 'tracks') setObjective('Encontre a pegada verdadeira e toque nela');
  if (next === 'vines') setObjective('Abra bem os braços para afastar os cipós');
  if (next === 'apples') { applesCaught = 0; apples = []; appleSpawnAt = 0; setObjective('Pegue 5 maçãs com a cesta • 0/5'); }
  if (next === 'bridge') { riverProgress = 0; bridgeTarget = 0; setObjective('Incline o corpo para manter o equilíbrio'); }
  if (next === 'duck') { duckCount = 0; duckWasLow = false; setObjective('Abaixe-se quando o galho chegar • 0/2'); }
  if (next === 'fireflies') {
    firefliesCaught = new Set();
    fireflyTargets = [{ x: 0.28, y: 0.42 }, { x: 0.72, y: 0.33 }, { x: 0.5, y: 0.56 }];
    setObjective('Encoste nos vaga-lumes • 0/3');
  }
  if (next === 'rescue') setObjective('Abra os braços e mantenha por um instante');
  if (next === 'ending') {
    setTimeout(() => endingCard.classList.remove('hidden'), 1200);
    [523, 659, 784, 1047].forEach((frequency, index) => setTimeout(() => tone(frequency, 0.16), index * 100));
  }
}

function restartStory() {
  endingCard.classList.add('hidden');
  scene = 'arrival'; sceneElapsedMs = 0; actionHold = 0; restartHold = 0;
  apples = []; applesCaught = 0; riverProgress = 0; duckCount = 0; firefliesCaught.clear();
  setObjective(''); hideMessage(); updateProgress();
}
restartButton.addEventListener('click', restartStory);
window.addEventListener('pointerdown', ensureAudio, { once: true });

socket.on('pose', (data) => {
  const next = emptyPose();
  for (const name of ['left', 'right', 'leftShoulder', 'rightShoulder']) if (data?.[name]) next[name] = { ...data[name] };
  next.detected = Boolean(data?.detected);
  pose = next; lastPoseAt = performance.now();
});
socket.on('room-status', ({ phone }) => {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected ? `Celular conectado • ${room}` : `Aguardando celular • ${room || '----'}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
  if (!phoneConnected && state !== 'invalid-room') { state = 'waiting'; calibrationStartedAt = 0; }
});
socket.on('disconnect', () => { phoneConnected = false; state = 'waiting'; calibrationStartedAt = 0; });

async function connect() {
  if (state === 'invalid-room') {
    showMessage('CÓDIGO AUSENTE', 'Abra a história pelo menu da TV', 'Assim a sala e a conexão com o celular são mantidas.');
    return;
  }
  await socket.connect();
  const result = await socket.request('join', { room, role: 'tv' });
  phoneConnected = Boolean(result?.status?.phone);
  connectionBadge.textContent = phoneConnected ? `Celular conectado • ${room}` : `Aguardando celular • ${room}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
}

function updateSetup(now) {
  if (state === 'invalid-room') return;
  if (art.failed) { showMessage('ARTE', 'Não foi possível carregar a floresta', 'Volte ao menu e abra a história novamente.'); return; }
  if (!art.ready) { showMessage('PREPARANDO A AVENTURA', 'Carregando a floresta…', 'Só um instante.'); return; }
  if (!phoneConnected) { showMessage('HISTÓRIA PRONTA', 'Aguardando o celular', `A câmera precisa continuar conectada à sala ${room}.`); return; }
  if (!poseReady(now)) {
    calibrationStartedAt = 0;
    showMessage('PREPARANDO A AVENTURA', 'Mostre as duas mãos', 'Fique de frente para a câmera. O celular continua parado onde está.');
    return;
  }
  if (!calibrationStartedAt) calibrationStartedAt = now;
  const elapsed = now - calibrationStartedAt;
  if (shouldersReady(now)) {
    neutralShoulderY = lerp(neutralShoulderY, shoulderMidY(), 0.1);
    neutralShoulderX = lerp(neutralShoulderX, shoulderMidX(), 0.1);
  }
  showMessage('CALIBRANDO', 'Ótimo, continue assim!', 'Só mais um instante e a floresta vai aparecer.', elapsed / 1100);
  if (elapsed >= 1100) { state = 'playing'; sceneElapsedMs = 0; hideMessage(); updateProgress(); }
}

function narrativeBeat(sceneName, elapsedMs) {
  const config = NARRATIVE[sceneName];
  if (!config) return null;
  let cursor = 0;
  for (let index = 0; index < config.beats.length; index += 1) {
    const [rawDuration, eyebrow, title, text] = config.beats[index];
    const duration = rawDuration * NARRATIVE_TIME_SCALE;
    if (elapsedMs < cursor + duration) return { index, total: config.beats.length, progress: clamp((elapsedMs - cursor) / duration), eyebrow, title, text };
    cursor += duration;
  }
  return { complete: true, next: config.next };
}
function updateNarrative(sceneName) {
  const beat = narrativeBeat(sceneName, sceneElapsedMs);
  if (!beat) return false;
  if (beat.complete) { nextScene(beat.next); return true; }
  showMessage(`${beat.eyebrow} • ${beat.index + 1}/${beat.total}`, beat.title, beat.text, null, true);
  return true;
}

function requireShoulders() {
  if (shouldersReady()) return true;
  showMessage('CÂMERA', 'Mostre também os ombros', 'Afaste-se um pouquinho da câmera sem mover o celular.');
  return false;
}

function updateStory(now, dt) {
  if (scene === 'ending') {
    sceneElapsedMs += dt;
    if (bothHandsRaised()) restartHold += dt; else restartHold = 0;
    if (restartHold > 1500) restartStory();
    return;
  }
  if (!poseReady(now)) { showMessage('CÂMERA', 'Volte para a área da câmera', 'Assim que suas mãos aparecerem, a aventura continua.'); return; }
  sceneElapsedMs += dt;
  if (NARRATIVE[scene]) { setObjective(''); updateNarrative(scene); return; }
  hideMessage();
  const seconds = dt / 1000;
  const elapsed = sceneElapsedMs;

  if (scene === 'tracks') {
    const target = { x: 0.28, y: 0.58 };
    const distance = Math.hypot(pose.right.x - target.x, pose.right.y - target.y);
    const radius = lerp(0.11, 0.18, clamp((elapsed - 14000) / 18000));
    actionHold = distance < radius ? actionHold + dt : Math.max(0, actionHold - dt * 1.5);
    if (elapsed > 12000) setObjective('A pegada certa está brilhando do lado esquerdo');
    if (actionHold > 600) { art.sparkle(target.x * canvas.width, target.y * canvas.height); sceneTone(); nextScene('trail-walk'); }
    return;
  }
  if (scene === 'vines') {
    const threshold = lerp(0.88, 0.68, clamp((elapsed - 16000) / 22000));
    const spread = clamp((handDistance() - 0.22) / 0.34);
    actionHold = spread > threshold ? actionHold + dt : Math.max(0, actionHold - dt * 1.4);
    if (elapsed > 15000) setObjective('Abra os braços como se afastasse uma cortina');
    if (actionHold > 800) { art.sparkle(canvas.width * 0.5, canvas.height * 0.48, 14); sceneTone(); nextScene('after-vines'); }
    return;
  }
  if (scene === 'apples') {
    const spawnDelay = elapsed > 45000 ? 580 : 760;
    if (now - appleSpawnAt > spawnDelay && apples.length < 5 && applesCaught < 5) {
      apples.push({ x: 0.15 + Math.random() * 0.7, y: 0.12, vy: 0.11 + Math.random() * 0.055, caught: false });
      appleSpawnAt = now;
    }
    const basketX = handMidX();
    const catchRadius = elapsed > 35000 ? 0.16 : 0.125;
    for (const apple of apples) {
      apple.y += apple.vy * seconds;
      if (!apple.caught && apple.y > 0.72 && apple.y < 0.91 && Math.abs(apple.x - basketX) < catchRadius) {
        apple.caught = true; applesCaught += 1; tone(520 + applesCaught * 45); art.sparkle(apple.x * canvas.width, apple.y * canvas.height, 5);
      }
    }
    apples = apples.filter((apple) => !apple.caught && apple.y < 1.05);
    setObjective(`Pegue 5 maçãs com a cesta • ${applesCaught}/5`);
    if (applesCaught >= 5) { sceneTone(); nextScene('squirrel-thanks'); }
    return;
  }
  if (scene === 'bridge') {
    if (!requireShoulders()) return;
    hideMessage();
    bridgeTarget = Math.sin(now / 1100) * 0.055;
    const lean = clamp((shoulderMidX() - neutralShoulderX) / 0.12, -1, 1);
    const targetLean = bridgeTarget / 0.055;
    const balance = 1 - clamp(Math.abs(lean - targetLean) / 1.3);
    const assist = clamp((elapsed - 45000) / 35000);
    riverProgress += seconds * (lerp(0.01, 0.016, assist) + balance * lerp(0.012, 0.018, assist));
    setObjective(`Mantenha o equilíbrio • ${Math.round(clamp(riverProgress) * 100)}%`);
    if (riverProgress >= 1) { sceneTone(); nextScene('far-bank'); }
    return;
  }
  if (scene === 'duck') {
    if (!requireShoulders()) return;
    hideMessage();
    const low = shoulderMidY() > neutralShoulderY + 0.085;
    if (low && !duckWasLow) { duckCount += 1; duckWasLow = true; tone(560 + duckCount * 80); art.sparkle(canvas.width * 0.5, canvas.height * 0.56, 6); }
    if (!low && shoulderMidY() < neutralShoulderY + 0.045) duckWasLow = false;
    setObjective(`Abaixe-se quando o galho chegar • ${Math.min(duckCount, 2)}/2`);
    if (duckCount >= 2) { sceneTone(); nextScene('dusk-walk'); }
    return;
  }
  if (scene === 'fireflies') {
    const hands = [pose.left, pose.right];
    fireflyTargets.forEach((target, index) => {
      if (firefliesCaught.has(index)) return;
      if (hands.some((hand) => hand.visible && Math.hypot(hand.x - target.x, hand.y - target.y) < 0.11)) {
        firefliesCaught.add(index); tone(650 + index * 100); art.sparkle(target.x * canvas.width, target.y * canvas.height, 9);
      }
    });
    setObjective(`Encoste nos vaga-lumes • ${firefliesCaught.size}/3`);
    if (firefliesCaught.size >= 3) { sceneTone(); nextScene('whisper'); }
    return;
  }
  if (scene === 'rescue') {
    const spread = clamp((handDistance() - 0.18) / 0.42);
    const threshold = lerp(0.86, 0.67, clamp((elapsed - 15000) / 25000));
    actionHold = spread > threshold ? actionHold + dt : Math.max(0, actionHold - dt * 1.2);
    setObjective('Abra os braços e mantenha por um instante');
    if (actionHold > 1000) { art.sparkle(canvas.width * 0.62, canvas.height * 0.58, 18); sceneTone(); nextScene('reunion'); }
  }
}

function drawScene(width, height, now) {
  art.draw({
    scene, sceneElapsedMs, pose, applesCaught, apples, riverProgress, bridgeTarget,
    neutralShoulderX, fireflyTargets, firefliesCaught, handDistance, handMidX, shoulderMidX
  }, now);
}
function updateParticles(dt) { art.updateParticles(dt); }

function frame(now) {
  resize();
  const dt = Math.min(42, now - lastFrame);
  lastFrame = now;
  if (state !== 'playing') updateSetup(now); else updateStory(now, dt);
  updateParticles(dt);
  drawScene(canvas.width, canvas.height, now);
  requestAnimationFrame(frame);
}

connect().catch((error) => {
  console.error(error);
  showMessage('CONEXÃO', 'Não foi possível abrir a aventura', error.message || 'Tente voltar ao menu da TV e abrir novamente.');
});
updateProgress();
requestAnimationFrame(frame);
