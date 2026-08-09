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

const ASSET_ROOT = '/assets/missao-estrela-perdida';
const ASSET_PATHS = {
  backgrounds: {
    intro: `${ASSET_ROOT}/backgrounds/bg_space_intro.png`,
    launch: `${ASSET_ROOT}/backgrounds/bg_ship_launch.png`,
    meteors: `${ASSET_ROOT}/backgrounds/bg_meteors.png`,
    robot: `${ASSET_ROOT}/backgrounds/bg_robot_station.png`,
    crystals: `${ASSET_ROOT}/backgrounds/bg_crystal_energy.png`,
    moons: `${ASSET_ROOT}/backgrounds/bg_moon_orbit.png`,
    nebula: `${ASSET_ROOT}/backgrounds/bg_nebula.png`,
    rescue: `${ASSET_ROOT}/backgrounds/bg_rescue_star.png`,
    constellation: `${ASSET_ROOT}/backgrounds/bg_constellation_home.png`,
    ending: `${ASSET_ROOT}/backgrounds/bg_story_complete.png`
  },
  characters: {
    shipIdle: `${ASSET_ROOT}/characters/ship_idle.png`,
    shipPowering: `${ASSET_ROOT}/characters/ship_powering.png`,
    shipDamaged: `${ASSET_ROOT}/characters/ship_damaged_light.png`,
    shipReady: `${ASSET_ROOT}/characters/ship_ready.png`,
    robotSleep: `${ASSET_ROOT}/characters/robot_sleep.png`,
    robotWaking: `${ASSET_ROOT}/characters/robot_waking.png`,
    robotIdle: `${ASSET_ROOT}/characters/robot_idle.png`,
    robotPowered: `${ASSET_ROOT}/characters/robot_powered.png`,
    robotHappy: `${ASSET_ROOT}/characters/robot_happy.png`,
    starWorried: `${ASSET_ROOT}/characters/lost_star_worried.png`,
    starRescued: `${ASSET_ROOT}/characters/lost_star_rescued.png`,
    starFlying: `${ASSET_ROOT}/characters/lost_star_flying.png`,
    starHome: `${ASSET_ROOT}/characters/lost_star_home.png`
  },
  interactive: {
    controlOff: `${ASSET_ROOT}/interactive/ship_control_button_off.png`,
    controlOn: `${ASSET_ROOT}/interactive/ship_control_button_on.png`,
    meteor1: `${ASSET_ROOT}/interactive/meteor.png`,
    meteor2: `${ASSET_ROOT}/interactive/meteor_02.png`,
    meteor3: `${ASSET_ROOT}/interactive/meteor_03.png`,
    robotPart: `${ASSET_ROOT}/interactive/robot_part.png`,
    crystalOff: `${ASSET_ROOT}/interactive/energy_crystal_off.png`,
    crystalOn: `${ASSET_ROOT}/interactive/energy_crystal_on.png`,
    moonInactive: `${ASSET_ROOT}/interactive/moon_inactive.png`,
    moonActive: `${ASSET_ROOT}/interactive/moon_active.png`,
    nebulaStar: `${ASSET_ROOT}/interactive/nebula_star.png`,
    fragment: `${ASSET_ROOT}/interactive/star_fragment.png`,
    constellationStar: `${ASSET_ROOT}/interactive/constellation_star.png`
  },
  fx: {
    success: `${ASSET_ROOT}/fx/success_burst.png`,
    collect: `${ASSET_ROOT}/fx/star_collect_fx.png`,
    sparkle: `${ASSET_ROOT}/fx/sparkle_fx.png`,
    energy: `${ASSET_ROOT}/fx/energy_glow_fx.png`,
    trail: `${ASSET_ROOT}/fx/trail_fx.png`,
    meteorHit: `${ASSET_ROOT}/fx/meteor_hit_fx.png`,
    robotPower: `${ASSET_ROOT}/fx/robot_power_fx.png`,
    constellationLine: `${ASSET_ROOT}/fx/constellation_line_fx.png`
  }
};

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
const images = new Map();

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
let spriteEffects = [];
let audioContext = null;
let constellationPoints = [];
let nebulaLight = 0;
let shipEnergy = 0;
let robotPower = 0;
let nextMeteorSpawnAt = 0;
let nextCrystalSpawnAt = 0;

function flattenAssetPaths(group, output = []) {
  for (const value of Object.values(group)) {
    if (typeof value === 'string') output.push(value);
    else flattenAssetPaths(value, output);
  }
  return output;
}

function preloadAssets() {
  for (const path of flattenAssetPaths(ASSET_PATHS)) {
    const image = new Image();
    image.decoding = 'async';
    image.src = path;
    images.set(path, image);
  }
}

function readyImage(path) {
  const image = images.get(path);
  return image?.complete && image.naturalWidth > 0 ? image : null;
}

function drawImageContain(path, cx, cy, maxWidth, maxHeight, options = {}) {
  const image = readyImage(path);
  if (!image) return false;
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.translate(cx, cy);
  if (options.rotation) ctx.rotate(options.rotation);
  const sx = options.flipX ? -1 : 1;
  ctx.scale(sx, 1);
  if (options.glow) {
    ctx.shadowBlur = options.glow;
    ctx.shadowColor = options.glowColor || '#ffffff';
  }
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}

function drawImageCover(path, width, height) {
  const image = readyImage(path);
  if (!image) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

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

function addSpriteEffect(path, x, y, size = 0.18, duration = 520) {
  spriteEffects.push({ path, x, y, size, duration, elapsed: 0 });
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
    activeAt: now + 180,
    variant: Math.floor(Math.random() * 3)
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
  const fxPath = target.kind === 'meteor'
    ? ASSET_PATHS.fx.meteorHit
    : target.kind === 'robot-part'
      ? ASSET_PATHS.fx.robotPower
      : target.kind === 'crystal'
        ? ASSET_PATHS.fx.energy
        : ASSET_PATHS.fx.collect;
  addSpriteEffect(fxPath, target.x, target.y, target.kind === 'meteor' ? 0.2 : 0.16);
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
  addSpriteEffect(ASSET_PATHS.fx.success, 0.5, 0.48, 0.35, 780);
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
  addSpriteEffect(ASSET_PATHS.fx.success, 0.5, 0.5, 0.55, 1200);
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
  for (const effect of spriteEffects) effect.elapsed += dt;
  spriteEffects = spriteEffects.filter((effect) => effect.elapsed < effect.duration);
}

function drawFallbackSpace(width, height, now, stageId) {
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
}

function drawSpace(width, height, now) {
  if (state === 'ending') {
    if (!drawImageCover(ASSET_PATHS.backgrounds.ending, width, height)) {
      drawFallbackSpace(width, height, now, 'constellation');
    }
    return;
  }

  const stageId = STAGES[Math.min(stageIndex, STAGES.length - 1)]?.id || 'launch';
  const backgroundPath = state === 'waiting' || state === 'invalid-room'
    ? ASSET_PATHS.backgrounds.intro
    : ASSET_PATHS.backgrounds[stageId];
  if (!drawImageCover(backgroundPath, width, height)) drawFallbackSpace(width, height, now, stageId);

  if (stageId === 'nebula' && nebulaLight > 0) {
    ctx.fillStyle = `rgba(255, 110, 220, ${nebulaLight * 0.08})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawFallbackShip(width, height, now) {
  const cx = width * 0.12;
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
  ctx.restore();
}

function drawShip(width, height, now) {
  const stageId = STAGES[Math.min(stageIndex, STAGES.length - 1)]?.id || 'launch';
  if (state === 'ending') {
    drawImageContain(ASSET_PATHS.characters.shipReady, width * 0.18, height * 0.78, width * 0.3, height * 0.42);
    return;
  }
  const cx = width * (stageId === 'launch' ? 0.15 : 0.13);
  const cy = height * 0.79 + Math.sin(now / 500) * height * 0.007;
  const size = Math.min(width, height) * (stageId === 'launch' ? 0.36 : 0.3);
  let path = ASSET_PATHS.characters.shipIdle;
  if (stageId === 'launch' && shipEnergy > 0.05) path = ASSET_PATHS.characters.shipPowering;
  if (stageId === 'meteors') path = ASSET_PATHS.characters.shipDamaged;
  if (stageId !== 'launch' && stageId !== 'meteors') path = ASSET_PATHS.characters.shipReady;
  if (!drawImageContain(path, cx, cy, size, size)) drawFallbackShip(width, height, now);
}

function drawFallbackRobot(width, height, now, stageId) {
  const cx = width * (stageId === 'robot' ? 0.5 : 0.84);
  const cy = height * (stageId === 'robot' ? 0.52 : 0.78) + Math.sin(now / 480) * height * 0.012;
  const s = Math.min(width, height) * (stageId === 'robot' ? 0.15 : 0.095);
  ctx.fillStyle = '#d9edf5';
  ctx.beginPath();
  ctx.roundRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.78, s * 0.18);
  ctx.fill();
}

function drawRobot(width, height, now) {
  const stageId = STAGES[stageIndex]?.id;
  if (state === 'ending') {
    drawImageContain(ASSET_PATHS.characters.robotHappy, width * 0.82, height * 0.78, width * 0.25, height * 0.38);
    return;
  }
  if (!['robot', 'crystals', 'moons', 'nebula', 'rescue', 'constellation'].includes(stageId)) return;
  const cx = width * (stageId === 'robot' ? 0.5 : 0.84);
  const cy = height * (stageId === 'robot' ? 0.54 : 0.79) + Math.sin(now / 480) * height * 0.009;
  const maxSize = Math.min(width, height) * (stageId === 'robot' ? 0.42 : 0.27);
  let path = ASSET_PATHS.characters.robotIdle;
  if (stageId === 'robot' && robotPower < 0.25) path = ASSET_PATHS.characters.robotSleep;
  else if (stageId === 'robot' && robotPower < 0.75) path = ASSET_PATHS.characters.robotWaking;
  else if (robotPower >= 0.75 || stageId !== 'robot') path = ASSET_PATHS.characters.robotPowered;
  if (!drawImageContain(path, cx, cy, maxSize, maxSize)) drawFallbackRobot(width, height, now, stageId);
}

function drawFallbackStar(width, height, now) {
  const cx = width * 0.5;
  const cy = height * 0.52 + Math.sin(now / 420) * height * 0.012;
  const outer = Math.min(width, height) * 0.085;
  const inner = outer * 0.43;
  ctx.save();
  ctx.translate(cx, cy);
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
  ctx.restore();
}

function drawLostStar(width, height, now) {
  const stageId = STAGES[stageIndex]?.id;
  if (!['rescue', 'constellation'].includes(stageId) && state !== 'ending') return;
  const cx = width * 0.5;
  const cy = height * (state === 'ending' ? 0.47 : 0.52) + Math.sin(now / 420) * height * 0.009;
  const maxSize = Math.min(width, height) * (state === 'ending' ? 0.42 : 0.32);
  const path = state === 'ending'
    ? ASSET_PATHS.characters.starHome
    : stageId === 'rescue'
      ? ASSET_PATHS.characters.starWorried
      : ASSET_PATHS.characters.starRescued;
  if (!drawImageContain(path, cx, cy, maxSize, maxSize, { glow: Math.min(width, height) * 0.018, glowColor: '#fff477' })) {
    drawFallbackStar(width, height, now);
  }
}

function drawConstellation(width, height) {
  if (STAGES[stageIndex]?.id !== 'constellation' && state !== 'ending') return;
  if (constellationPoints.length < 2) return;
  const lineImage = readyImage(ASSET_PATHS.fx.constellationLine);
  for (let index = 1; index < constellationPoints.length; index += 1) {
    const a = constellationPoints[index - 1];
    const b = constellationPoints[index];
    const ax = a.x * width;
    const ay = a.y * height;
    const bx = b.x * width;
    const by = b.y * height;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (lineImage) {
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.globalAlpha = 0.78;
      ctx.drawImage(lineImage, -length / 2, -Math.max(10, height * 0.018), length, Math.max(20, height * 0.036));
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(255,244,119,.78)';
      ctx.lineWidth = Math.max(3, width * 0.003);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
}

function fallbackTarget(target, width, height, now) {
  const x = target.x * width;
  const y = target.y * height;
  const r = target.radius * Math.min(width, height);
  const pulse = 0.92 + Math.sin(now / 180 + (target.targetIndex || 0)) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = target.kind === 'meteor' ? '#b77859' : '#fff477';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function targetAssetPath(target) {
  if (target.kind === 'control') return target.hit ? ASSET_PATHS.interactive.controlOn : ASSET_PATHS.interactive.controlOff;
  if (target.kind === 'meteor') return [ASSET_PATHS.interactive.meteor1, ASSET_PATHS.interactive.meteor2, ASSET_PATHS.interactive.meteor3][target.variant % 3];
  if (target.kind === 'robot-part') return ASSET_PATHS.interactive.robotPart;
  if (target.kind === 'crystal') return ASSET_PATHS.interactive.crystalOn;
  if (target.kind === 'moon') return target.hit ? ASSET_PATHS.interactive.moonActive : ASSET_PATHS.interactive.moonInactive;
  if (target.kind === 'nebula-star') return ASSET_PATHS.interactive.nebulaStar;
  if (target.kind === 'fragment') return ASSET_PATHS.interactive.fragment;
  if (target.kind === 'constellation-star') return ASSET_PATHS.interactive.constellationStar;
  return null;
}

function drawTarget(target, width, height, now) {
  if (target.hit && !['control', 'moon'].includes(target.kind)) return;
  const x = target.x * width;
  const y = target.y * height;
  const r = target.radius * Math.min(width, height);
  const pulse = target.hit ? 1 : 0.92 + Math.sin(now / 180 + (target.targetIndex || 0)) * 0.08;
  const path = targetAssetPath(target);
  const rendered = path && drawImageContain(path, x, y, r * 2.35 * pulse, r * 2.35 * pulse, {
    glow: target.hit ? 8 : Math.max(8, r * 0.28),
    glowColor: target.kind === 'meteor' ? '#ff9a61' : '#fff3a5',
    rotation: target.kind === 'meteor' ? now / 1900 + (target.variant || 0) : 0
  });
  if (!rendered) fallbackTarget(target, width, height, now);
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

function drawEffects(width, height) {
  for (const effect of spriteEffects) {
    const progress = clamp(effect.elapsed / effect.duration);
    const alpha = 1 - progress;
    const size = Math.min(width, height) * effect.size * (0.7 + progress * 0.55);
    drawImageContain(effect.path, effect.x * width, effect.y * height, size, size, { alpha });
  }

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
  drawEffects(width, height);
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
  spriteEffects = [];
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

preloadAssets();
connect().catch((error) => {
  console.error(error);
  showMessage('CONEXÃO', 'Não foi possível abrir a missão', 'Volte ao menu e tente novamente.');
});

updateProgress();
requestAnimationFrame(frame);
