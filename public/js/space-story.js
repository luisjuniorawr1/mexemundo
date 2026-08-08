import { RealtimeClient } from './realtime.js';

const socket = new RealtimeClient();
const canvas = document.querySelector('#storyCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
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

const room = String(new URLSearchParams(location.search).get('sala') || '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 6);

const POSE_TIMEOUT_MS = 320;
const HAND_RADIUS = 0.045;
const STAGES = [
  { id: 'launch', title: 'LIGUE A NAVE!', hint: 'Toque nos 4 controles', goal: 4, done: 'NAVE PRONTA!' },
  { id: 'meteors', title: 'PROTEJA A NAVE!', hint: 'Toque nos meteoros', goal: 8, done: 'CAMINHO LIVRE!' },
  { id: 'robot', title: 'ACORDE O ROBÔ!', hint: 'Toque nas peças brilhantes', goal: 4, done: 'NOVO AMIGO!' },
  { id: 'crystals', title: 'CARREGUE A ENERGIA!', hint: 'Toque nos cristais', goal: 6, done: 'ENERGIA COMPLETA!' },
  { id: 'moons', title: 'ATIVE AS LUAS!', hint: 'Toque na lua que brilhar', goal: 5, done: 'ÓRBITA ALINHADA!' },
  { id: 'nebula', title: 'ILUMINE O CAMINHO!', hint: 'Toque nas estrelas', goal: 7, done: 'CAMINHO ENCONTRADO!' },
  { id: 'rescue', title: 'LIBERTE A ESTRELINHA!', hint: 'Toque nos fragmentos', goal: 6, done: 'ESTRELINHA LIVRE!' },
  { id: 'constellation', title: 'LEVE-A PARA CASA!', hint: 'Toque nas estrelas em ordem', goal: 7, done: 'ELA VOLTOU!' }
];

const STAR_FIELD = Array.from({ length: 110 }, (_, index) => ({
  x: ((index * 73) % 997) / 997,
  y: ((index * 191 + 41) % 991) / 991,
  r: 0.7 + ((index * 17) % 9) / 5,
  phase: ((index * 31) % 100) / 100 * Math.PI * 2
}));

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const emptyHand = (x) => ({ x, y: 0.58, vx: 0, vy: 0, visible: false });

let pose = {
  detected: false,
  left: emptyHand(0.35),
  right: emptyHand(0.65)
};
let previousHands = {
  left: emptyHand(0.35),
  right: emptyHand(0.65)
};
let lastPoseAt = 0;
let phoneConnected = false;
let state = room.length >= 4 ? 'waiting' : 'invalid-room';
let setupReadyAt = 0;
let stageIndex = 0;
let stageElapsedMs = 0;
let stageScore = 0;
let targets = [];
let totalHits = 0;
let transitionUntil = 0;
let pendingStageIndex = null;
let lastFrame = performance.now();
let particles = [];
let popTexts = [];
let audioContext = null;
let constellationPoints = [];
let nebulaLight = 0;
let shipEnergy = 0;
let robotPower = 0;
let nextMeteorSpawnAt = 0;
let nextCrystalSpawnAt = 0;

function handsReady(now = performance.now()) {
  const fresh = phoneConnected && now - lastPoseAt < POSE_TIMEOUT_MS && pose.detected;
  return Boolean(fresh && (pose.left.visible || pose.right.visible));
}

function showMessage(eyebrow, title, text = '', progress = null) {
  messageEyebrow.textContent = eyebrow;
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageText.classList.toggle('hidden', !text);
  messageProgress.style.width = `${Math.round(clamp(progress ?? 0) * 100)}%`;
  messageProgress.parentElement?.classList.toggle('hidden', progress === null);
  messageCard.classList.remove('hidden');
}

function hideMessage() {
  messageCard.classList.add('hidden');
}

function setObjective(title = '', hint = '', progress = '') {
  if (!title) {
    objective.classList.add('hidden');
    objective.innerHTML = '';
    return;
  }
  objective.innerHTML = `
    <strong>${title}</strong>
    <span>${hint}</span>
    ${progress ? `<b>${progress}</b>` : ''}
  `;
  objective.classList.remove('hidden');
}

function updateProgress() {
  storyProgress.innerHTML = STAGES.map((_, index) => {
    const cls = index < stageIndex ? 'done' : index === stageIndex ? 'current' : '';
    return `<i class="${cls}"></i>`;
  }).join('');
}

function resize() {
  const scale = Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.resume?.().catch(() => {});
}

function tone(frequency, duration = 0.07, gainValue = 0.05) {
  try {
    ensureAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, audioContext.currentTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.025);
  } catch {}
}

function successSound() {
  [620, 780, 980].forEach((frequency, index) => setTimeout(() => tone(frequency, 0.11), index * 70));
}

function burst(x, y, color = '#ffe56c', count = 12) {
  const width = canvas.width || 1920;
  const height = canvas.height || 1080;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.min(width, height) * (0.07 + Math.random() * 0.12);
    particles.push({
      x: x * width,
      y: y * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.max(3, width * (0.0025 + Math.random() * 0.003)),
      life: 1,
      color
    });
  }
  popTexts.push({ x: x * width, y: y * height, life: 1, text: '✓' });
}

function createTarget(kind, x, y, radius = 0.07, extra = {}) {
  return {
    id: `${kind}-${performance.now()}-${Math.random()}`,
    kind,
    x,
    y,
    radius,
    activeAt: performance.now() + 280,
    hit: false,
    ...extra
  };
}

function safePosition(index = 0) {
  const positions = [
    [0.22, 0.31], [0.48, 0.27], [0.76, 0.34], [0.32, 0.58],
    [0.67, 0.59], [0.18, 0.73], [0.5, 0.72], [0.82, 0.72]
  ];
  const [x, y] = positions[index % positions.length];
  return { x, y };
}

function startStage(index) {
  stageIndex = index;
  stageElapsedMs = 0;
  stageScore = 0;
  targets = [];
  transitionUntil = 0;
  pendingStageIndex = null;
  constellationPoints = [];
  updateProgress();
  hideMessage();

  const stage = STAGES[index];
  setObjective(stage.title, stage.hint, `0/${stage.goal}`);

  if (stage.id === 'launch') {
    [[0.33, 0.64], [0.46, 0.55], [0.59, 0.64], [0.72, 0.55]].forEach(([x, y], targetIndex) => {
      targets.push(createTarget('control', x, y, 0.072, { targetIndex }));
    });
  }

  if (stage.id === 'robot') {
    [[0.5, 0.33], [0.43, 0.51], [0.57, 0.51], [0.5, 0.68]].forEach(([x, y], targetIndex) => {
      targets.push(createTarget('robot-part', x, y, 0.065, { targetIndex }));
    });
  }

  if (stage.id === 'moons') spawnMoonTarget();

  if (stage.id === 'nebula') {
    nebulaLight = 0;
    for (let i = 0; i < stage.goal; i += 1) {
      const pos = safePosition(i + 1);
      targets.push(createTarget('nebula-star', pos.x, pos.y, 0.057, { targetIndex: i }));
    }
  }

  if (stage.id === 'rescue') {
    const centerX = 0.5;
    const centerY = 0.52;
    for (let i = 0; i < stage.goal; i += 1) {
      const angle = -Math.PI * 0.85 + (i / (stage.goal - 1)) * Math.PI * 1.7;
      targets.push(createTarget(
        'fragment',
        centerX + Math.cos(angle) * 0.23,
        centerY + Math.sin(angle) * 0.22,
        0.065,
        { angle, targetIndex: i }
      ));
    }
  }

  if (stage.id === 'constellation') spawnConstellationPoint();

  nextMeteorSpawnAt = performance.now();
  nextCrystalSpawnAt = performance.now();
}

function spawnMoonTarget() {
  if (stageIndex >= STAGES.length || STAGES[stageIndex].id !== 'moons') return;
  const positions = [[0.23, 0.34], [0.77, 0.3], [0.68, 0.68], [0.3, 0.7], [0.5, 0.24]];
  const pos = positions[stageScore % positions.length];
  targets = [createTarget('moon', pos[0], pos[1], 0.075, { targetIndex: stageScore })];
}

function spawnConstellationPoint() {
  if (stageIndex >= STAGES.length || STAGES[stageIndex].id !== 'constellation') return;
  const points = [[0.23, 0.64], [0.34, 0.39], [0.49, 0.54], [0.61, 0.28], [0.74, 0.45], [0.66, 0.68], [0.45, 0.75]];
  const point = points[stageScore % points.length];
  targets = [createTarget('constellation-star', point[0], point[1], 0.064, { targetIndex: stageScore })];
}

function randomMovingTarget(kind, now) {
  const fromLeft = Math.random() < 0.5;
  const y = 0.22 + Math.random() * 0.57;
  const speed = 0.075 + Math.random() * 0.065;
  return createTarget(kind, fromLeft ? -0.08 : 1.08, y, kind === 'meteor' ? 0.072 : 0.062, {
    vx: fromLeft ? speed : -speed,
    vy: (Math.random() - 0.5) * 0.025,
    activeAt: now + 180
  });
}

function segmentDistanceSquared(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 0.000001) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function handTouchesTarget(handName, target) {
  const current = pose[handName];
  if (!current.visible) return false;
  const previous = previousHands[handName];
  const ax = previous.visible ? previous.x : current.x;
  const ay = previous.visible ? previous.y : current.y;
  const radius = target.radius + HAND_RADIUS;
  return segmentDistanceSquared(target.x, target.y, ax, ay, current.x, current.y) <= radius * radius;
}

function processTargetHits(now) {
  for (const target of targets) {
    if (target.hit || now < target.activeAt) continue;
    for (const handName of ['left', 'right']) {
      if (!handTouchesTarget(handName, target)) continue;
      hitTarget(target, handName, now);
      break;
    }
  }
}

function hitTarget(target, handName, now) {
  if (target.hit) return;
  target.hit = true;
  stageScore += 1;
  totalHits += 1;

  const colors = {
    control: '#61e6ff',
    meteor: '#ff9a61',
    'robot-part': '#7dffb2',
    crystal: '#b987ff',
    moon: '#fff3a5',
    'nebula-star': '#ff86dd',
    fragment: '#ffbd72',
    'constellation-star': '#fff477'
  };
  burst(target.x, target.y, colors[target.kind] || '#ffe56c', target.kind === 'meteor' ? 18 : 12);
  tone(handName === 'left' ? 620 : 720, 0.065);

  if (target.kind === 'control') shipEnergy = stageScore / STAGES[stageIndex].goal;
  if (target.kind === 'robot-part') robotPower = stageScore / STAGES[stageIndex].goal;
  if (target.kind === 'nebula-star') nebulaLight = stageScore / STAGES[stageIndex].goal;
  if (target.kind === 'constellation-star') constellationPoints.push({ x: target.x, y: target.y });

  const stage = STAGES[stageIndex];
  setObjective(stage.title, stage.hint, `${stageScore}/${stage.goal}`);

  if (stageScore >= stage.goal) {
    finishStage(now);
    return;
  }

  if (stage.id === 'moons') setTimeout(spawnMoonTarget, 220);
  if (stage.id === 'constellation') setTimeout(spawnConstellationPoint, 220);
}

function finishStage(now) {
  const stage = STAGES[stageIndex];
  successSound();
  setObjective('', '', '');
  showMessage('ÓTIMO!', stage.done, '');
  transitionUntil = now + 950;
  pendingStageIndex = stageIndex + 1;
}

function finishStory() {
  state = 'ending';
  hideMessage();
  setObjective('', '', '');
  storyProgress.innerHTML = STAGES.map(() => '<i class="done"></i>').join('');
  setTimeout(() => endingCard.classList.remove('hidden'), 500);
  [523, 659, 784, 1047].forEach((frequency, index) => setTimeout(() => tone(frequency, 0.16, 0.06), index * 90));
}

function updateSetup(now) {
  if (state === 'invalid-room') {
    showMessage('SEM SALA', 'Abra pelo menu da TV', '');
    return;
  }
  if (!phoneConnected) {
    setupReadyAt = 0;
    showMessage('MISSÃO PRONTA', 'Conecte o celular', '');
    return;
  }
  if (!handsReady(now)) {
    setupReadyAt = 0;
    showMessage('PREPARAR!', 'Mostre suas mãos', 'Uma mão já é suficiente para começar.');
    return;
  }
  if (!setupReadyAt) setupReadyAt = now;
  const progress = clamp((now - setupReadyAt) / 650);
  showMessage('MÃOS DETECTADAS', 'Vamos para o espaço!', '', progress);
  if (progress >= 1) {
    state = 'playing';
    hideMessage();
    startStage(0);
  }
}

function updateMovingTargets(now, dt) {
  const stage = STAGES[stageIndex];
  const seconds = dt / 1000;

  if (stage.id === 'meteors') {
    const alive = targets.filter((target) => !target.hit && target.x > -0.16 && target.x < 1.16);
    targets = alive;
    if (now >= nextMeteorSpawnAt && targets.length < 3 && stageScore < stage.goal) {
      targets.push(randomMovingTarget('meteor', now));
      nextMeteorSpawnAt = now + 520 + Math.random() * 360;
    }
  }

  if (stage.id === 'crystals') {
    const alive = targets.filter((target) => !target.hit && target.x > -0.16 && target.x < 1.16 && target.y < 1.15);
    targets = alive;
    if (now >= nextCrystalSpawnAt && targets.length < 3 && stageScore < stage.goal) {
      const target = randomMovingTarget('crystal', now);
      target.vx *= 0.55;
      target.vy = 0.025 + Math.random() * 0.025;
      targets.push(target);
      nextCrystalSpawnAt = now + 700 + Math.random() * 400;
    }
  }

  for (const target of targets) {
    if (target.hit) continue;
    if (Number.isFinite(target.vx)) target.x += target.vx * seconds;
    if (Number.isFinite(target.vy)) target.y += target.vy * seconds;
  }
}

function updateStory(now, dt) {
  if (state !== 'playing') return;
  if (!handsReady(now)) {
    showMessage('CÂMERA', 'Mostre uma das mãos', 'A missão continua assim que a câmera encontrar sua mão.');
    return;
  }

  if (transitionUntil) {
    if (now < transitionUntil) return;
    hideMessage();
    transitionUntil = 0;
    if (pendingStageIndex >= STAGES.length) {
      finishStory();
      return;
    }
    startStage(pendingStageIndex);
    return;
  }

  hideMessage();
  stageElapsedMs += dt;
  updateMovingTargets(now, dt);
  processTargetHits(now);
}

function updateParticles(dt) {
  const seconds = dt / 1000;
  for (const particle of particles) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
    particle.life -= seconds * 2.1;
  }
  particles = particles.filter((particle) => particle.life > 0);
  for (const text of popTexts) {
    text.y -= 60 * seconds;
    text.life -= seconds * 2.4;
  }
  popTexts = popTexts.filter((text) => text.life > 0);
}

function drawSpace(width, height, now) {
  const stageId = STAGES[Math.min(stageIndex, STAGES.length - 1)]?.id || 'launch';
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  const palettes = {
    launch: ['#141c4f', '#3d2f76'],
    meteors: ['#101a42', '#4e244e'],
    robot: ['#081b3b', '#163e5b'],
    crystals: ['#17113e', '#42296d'],
    moons: ['#081943', '#3a2162'],
    nebula: ['#130d34', '#4c1f61'],
    rescue: ['#091734', '#3b1748'],
    constellation: ['#07152f', '#16245f']
  };
  const palette = palettes[stageId] || palettes.launch;
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(1, palette[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const lightBoost = stageId === 'nebula' ? nebulaLight : 0;
  for (const star of STAR_FIELD) {
    const twinkle = 0.35 + 0.35 * Math.sin(now / 650 + star.phase);
    ctx.globalAlpha = clamp(0.34 + twinkle + lightBoost * 0.35);
    ctx.fillStyle = lightBoost > 0.35 && star.x > 0.45 ? '#ffb7f0' : '#ffffff';
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.r * Math.max(1, width / 1920), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (stageId === 'launch') {
    ctx.fillStyle = 'rgba(23,45,92,.74)';
    ctx.beginPath();
    ctx.roundRect(width * 0.25, height * 0.43, width * 0.55, height * 0.34, width * 0.025);
    ctx.fill();
    ctx.strokeStyle = 'rgba(97,230,255,.36)';
    ctx.lineWidth = Math.max(3, width * 0.003);
    ctx.stroke();
  }

  if (stageId === 'moons') {
    ctx.fillStyle = '#6656d9';
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.52, Math.min(width, height) * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,170,.5)';
    ctx.lineWidth = Math.max(10, width * 0.012);
    ctx.beginPath();
    ctx.ellipse(width * 0.5, height * 0.53, width * 0.3, height * 0.08, -0.12, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (stageId === 'nebula') {
    ctx.globalAlpha = 0.18 + nebulaLight * 0.5;
    const nebula = ctx.createRadialGradient(width * 0.55, height * 0.48, 10, width * 0.55, height * 0.48, width * 0.45);
    nebula.addColorStop(0, '#ff64d8');
    nebula.addColorStop(0.45, '#7e5cff');
    nebula.addColorStop(1, 'rgba(58,220,255,0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
}

function drawShip(width, height, now) {
  const stageId = STAGES[Math.min(stageIndex, STAGES.length - 1)]?.id || 'launch';
  const cx = width * (stageId === 'launch' ? 0.14 : 0.12);
  const cy = height * 0.81 + Math.sin(now / 500) * height * 0.006;
  const s = Math.min(width, height) * 0.13;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#e8f6ff';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#57bde8';
  ctx.beginPath();
  ctx.arc(s * 0.1, -s * 0.08, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6d8c';
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, s * 0.12);
  ctx.lineTo(-s * 0.64, s * 0.4);
  ctx.lineTo(-s * 0.2, s * 0.28);
  ctx.fill();
  const flame = 0.5 + shipEnergy * 0.5 + Math.sin(now / 80) * 0.1;
  ctx.fillStyle = '#ffd45f';
  ctx.beginPath();
  ctx.moveTo(-s * 0.52, -s * 0.12);
  ctx.lineTo(-s * (0.76 + flame * 0.2), 0);
  ctx.lineTo(-s * 0.52, s * 0.12);
  ctx.fill();
  ctx.restore();
}

function drawRobot(width, height, now) {
  const stageId = STAGES[stageIndex]?.id;
  if (!['robot', 'crystals', 'moons', 'nebula', 'rescue', 'constellation'].includes(stageId)) return;
  const cx = width * (stageId === 'robot' ? 0.5 : 0.84);
  const cy = height * (stageId === 'robot' ? 0.52 : 0.78) + Math.sin(now / 480) * height * 0.012;
  const s = Math.min(width, height) * (stageId === 'robot' ? 0.15 : 0.095);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#d9edf5';
  ctx.beginPath();
  ctx.roundRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.78, s * 0.18);
  ctx.fill();
  ctx.fillStyle = robotPower > 0.5 || stageId !== 'robot' ? '#7dffb2' : '#31445b';
  ctx.beginPath();
  ctx.arc(-s * 0.16, -s * 0.12, s * 0.07, 0, Math.PI * 2);
  ctx.arc(s * 0.16, -s * 0.12, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#96c9dc';
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.42);
  ctx.lineTo(0, -s * 0.7);
  ctx.stroke();
  ctx.fillStyle = '#ffda6b';
  ctx.beginPath();
  ctx.arc(0, -s * 0.76, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLostStar(width, height, now) {
  if (!['rescue', 'constellation'].includes(STAGES[stageIndex]?.id) && state !== 'ending') return;
  const cx = width * 0.5;
  const cy = height * 0.52 + Math.sin(now / 420) * height * 0.012;
  const outer = Math.min(width, height) * 0.085;
  const inner = outer * 0.43;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowBlur = Math.max(18, outer * 0.45);
  ctx.shadowColor = '#fff477';
  ctx.fillStyle = '#fff477';
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 ? inner : outer;
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#3c3561';
  ctx.beginPath();
  ctx.arc(-outer * 0.22, -outer * 0.05, outer * 0.06, 0, Math.PI * 2);
  ctx.arc(outer * 0.22, -outer * 0.05, outer * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawConstellation(width, height) {
  if (STAGES[stageIndex]?.id !== 'constellation' && state !== 'ending') return;
  if (constellationPoints.length < 2) return;
  ctx.strokeStyle = 'rgba(255,244,119,.78)';
  ctx.lineWidth = Math.max(3, width * 0.003);
  ctx.shadowBlur = 14;
  ctx.shadowColor = '#fff477';
  ctx.beginPath();
  constellationPoints.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawTarget(target, width, height, now) {
  if (target.hit) return;
  const x = target.x * width;
  const y = target.y * height;
  const r = target.radius * Math.min(width, height);
  const pulse = 0.92 + Math.sin(now / 180 + target.targetIndex) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);

  if (target.kind === 'control') {
    ctx.shadowBlur = r * 0.5;
    ctx.shadowColor = '#61e6ff';
    ctx.fillStyle = '#183f6d';
    ctx.beginPath();
    ctx.roundRect(-r, -r * 0.7, r * 2, r * 1.4, r * 0.28);
    ctx.fill();
    ctx.strokeStyle = '#61e6ff';
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
    ctx.fillStyle = '#dffaff';
    ctx.font = `900 ${Math.round(r * 0.9)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(['⚡', '●', '✦', '▶'][target.targetIndex % 4], 0, 2);
  }

  if (target.kind === 'meteor' || target.kind === 'fragment') {
    ctx.fillStyle = target.kind === 'meteor' ? '#b77859' : '#8b6e76';
    ctx.strokeStyle = '#f3b27d';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      const rr = r * (0.7 + ((i * 7) % 4) * 0.1);
      const px = Math.cos(angle) * rr;
      const py = Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (target.kind === 'robot-part') {
    ctx.shadowBlur = r * 0.65;
    ctx.shadowColor = '#7dffb2';
    ctx.fillStyle = '#7dffb2';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#eafff2';
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
  }

  if (target.kind === 'crystal') {
    ctx.shadowBlur = r * 0.65;
    ctx.shadowColor = '#b987ff';
    ctx.fillStyle = '#b987ff';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.62, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.62, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f0ddff';
    ctx.lineWidth = r * 0.1;
    ctx.stroke();
  }

  if (target.kind === 'moon') {
    ctx.shadowBlur = r * 0.7;
    ctx.shadowColor = '#fff3a5';
    ctx.fillStyle = '#fff1b6';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,120,180,.24)';
    ctx.beginPath();
    ctx.arc(-r * 0.22, -r * 0.13, r * 0.17, 0, Math.PI * 2);
    ctx.arc(r * 0.28, r * 0.22, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  if (target.kind === 'nebula-star' || target.kind === 'constellation-star') {
    ctx.shadowBlur = r * 0.8;
    ctx.shadowColor = target.kind === 'nebula-star' ? '#ff86dd' : '#fff477';
    ctx.fillStyle = target.kind === 'nebula-star' ? '#ffb1e8' : '#fff477';
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 ? r * 0.38 : r;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const px = Math.cos(angle) * rr;
      const py = Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawHands(width, height) {
  if (!handsReady()) return;
  const colors = { left: '#ff6c9f', right: '#54e2c2' };
  for (const handName of ['left', 'right']) {
    const hand = pose[handName];
    if (!hand.visible) continue;
    const x = hand.x * width;
    const y = hand.y * height;
    const radius = Math.max(24, Math.min(width, height) * HAND_RADIUS);
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = colors[handName];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(4, radius * 0.12);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(radius * 0.78)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✋', x, y + 1);
  }
}

function drawEffects(width) {
  for (const particle of particles) {
    ctx.globalAlpha = clamp(particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const text of popTexts) {
    ctx.globalAlpha = clamp(text.life);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4e3f89';
    ctx.lineWidth = Math.max(4, width * 0.003);
    ctx.font = `900 ${Math.max(34, Math.round(width * 0.034))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.strokeText(text.text, text.x, text.y);
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
}

function drawScene(width, height, now) {
  drawSpace(width, height, now);
  drawConstellation(width, height);
  drawShip(width, height, now);
  drawRobot(width, height, now);
  drawLostStar(width, height, now);
  for (const target of targets) drawTarget(target, width, height, now);
  drawEffects(width);
  if (state === 'playing' && !transitionUntil) drawHands(width, height);
}

function restartStory() {
  endingCard.classList.add('hidden');
  state = 'playing';
  stageIndex = 0;
  totalHits = 0;
  shipEnergy = 0;
  robotPower = 0;
  nebulaLight = 0;
  particles = [];
  popTexts = [];
  constellationPoints = [];
  startStage(0);
}

restartButton.addEventListener('click', restartStory);
window.addEventListener('pointerdown', ensureAudio, { once: true });

socket.on('pose', (data) => {
  previousHands = {
    left: { ...pose.left },
    right: { ...pose.right }
  };
  pose = {
    detected: Boolean(data?.detected),
    left: data?.left ? { ...data.left } : emptyHand(0.35),
    right: data?.right ? { ...data.right } : emptyHand(0.65)
  };
  lastPoseAt = performance.now();
});

socket.on('room-status', ({ phone }) => {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected
    ? `Celular conectado • ${room}`
    : `Aguardando celular • ${room || '----'}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
  if (!phoneConnected && state !== 'invalid-room') {
    state = 'waiting';
    setupReadyAt = 0;
  }
});

socket.on('disconnect', () => {
  phoneConnected = false;
  if (state !== 'invalid-room') state = 'waiting';
  setupReadyAt = 0;
});

async function connect() {
  if (state === 'invalid-room') return;
  await socket.connect();
  const result = await socket.request('join', { room, role: 'tv' });
  phoneConnected = Boolean(result?.status?.phone);
  connectionBadge.textContent = phoneConnected
    ? `Celular conectado • ${room}`
    : `Aguardando celular • ${room}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
}

function frame(now) {
  // SPACE_STORY_FRAME: tv-entry usa estas chamadas para pausar o loop quando a história fecha.
  resize();
  const dt = Math.min(42, Math.max(0, now - lastFrame));
  lastFrame = now;

  if (state === 'waiting' || state === 'invalid-room') updateSetup(now);
  else updateStory(now, dt);
  updateParticles(dt);
  drawScene(canvas.width, canvas.height, now);

  previousHands = {
    left: { ...pose.left },
    right: { ...pose.right }
  };
  requestAnimationFrame(frame);
}

connect().catch((error) => {
  console.error(error);
  showMessage('CONEXÃO', 'Não foi possível abrir a missão', 'Volte ao menu e tente novamente.');
});

updateProgress();
requestAnimationFrame(frame);
