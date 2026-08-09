const POSE_TIMEOUT_MS = 300;
const STAGE_IDS = ['point', 'stars', 'clouds', 'bridge', 'crystals', 'join', 'raise'];
const POINT_NAMES = ['left', 'right', 'leftShoulder', 'rightShoulder'];
const WRISTS = new Set(['left', 'right']);

const ASSETS = {
  village: '/assets/farol-das-estrelas/backgrounds/bg_village_night.png',
  beach: '/assets/farol-das-estrelas/backgrounds/bg_star_beach.png',
  clouds: '/assets/farol-das-estrelas/backgrounds/bg_cloud_path.png',
  bridge: '/assets/farol-das-estrelas/backgrounds/bg_wind_bridge.png',
  garden: '/assets/farol-das-estrelas/backgrounds/bg_crystal_garden.png',
  towerDark: '/assets/farol-das-estrelas/backgrounds/bg_lighthouse_dark.png',
  towerPower: '/assets/farol-das-estrelas/backgrounds/bg_lighthouse_powerup.png',
  towerFinal: '/assets/farol-das-estrelas/backgrounds/bg_lighthouse_final.png',
  finalSky: '/assets/farol-das-estrelas/backgrounds/bg_star_sky_final.png',
  lume: '/assets/farol-das-estrelas/characters/lume_idle.png',
  lumeHappy: '/assets/farol-das-estrelas/characters/lume_happy.png',
  fragment: '/assets/farol-das-estrelas/items/star_fragment.png',
  crystalOff: '/assets/farol-das-estrelas/items/crystal_off.png',
  crystalOn: '/assets/farol-das-estrelas/items/crystal_on.png',
  starBroken: '/assets/farol-das-estrelas/items/big_star_broken.png',
  starRestored: '/assets/farol-das-estrelas/items/big_star_restored.png',
  cloud: '/assets/farol-das-estrelas/obstacles/cloud_obstacle.png'
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const randomBetween = (min, max) => min + Math.random() * (max - min);

function emptyPoint(x, y) {
  return { x, y, vx: 0, vy: 0, visible: false };
}

function emptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.56),
    right: emptyPoint(0.65, 0.56),
    leftShoulder: emptyPoint(0.44, 0.38),
    rightShoulder: emptyPoint(0.56, 0.38)
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

function loadOptionalImages() {
  const images = new Map();
  if (typeof Image === 'undefined') return images;
  for (const [name, src] of Object.entries(ASSETS)) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    images.set(name, image);
  }
  return images;
}

function imageReady(image) {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

function drawCover(ctx, image, width, height) {
  if (!imageReady(image)) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  return true;
}

function drawContain(ctx, image, x, y, width, height) {
  if (!imageReady(image)) return false;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
  return true;
}

function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const images = loadOptionalImages();
  let particles = [];

  function resize() {
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function burst(x, y, count = 14) {
    const size = Math.min(canvas.width, canvas.height);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = size * randomBetween(0.06, 0.15);
      particles.push({
        x: x * canvas.width,
        y: y * canvas.height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: size * randomBetween(0.004, 0.009)
      });
    }
  }

  function updateParticles(dt) {
    const seconds = dt / 1000;
    for (const particle of particles) {
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vy += canvas.height * 0.08 * seconds;
      particle.life -= seconds * 1.35;
    }
    particles = particles.filter((particle) => particle.life > 0);
  }

  function drawParticles() {
    ctx.save();
    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life);
      ctx.fillStyle = '#fff5a7';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.6 + particle.life * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function nightGradient(top = '#081a43', bottom = '#173e66') {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawStars(now, amount = 70, brightness = 1) {
    ctx.save();
    for (let index = 0; index < amount; index += 1) {
      const x = ((index * 79 + 17) % 997) / 997 * canvas.width;
      const y = ((index * 191 + 43) % 619) / 619 * canvas.height * 0.66;
      const pulse = 0.55 + Math.sin(now * 0.003 + index * 1.7) * 0.35;
      ctx.globalAlpha = clamp(pulse * brightness);
      ctx.fillStyle = index % 8 === 0 ? '#ffe77a' : '#fff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, canvas.width * (index % 11 === 0 ? 0.0018 : 0.001)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSea() {
    const y = canvas.height * 0.66;
    const gradient = ctx.createLinearGradient(0, y, 0, canvas.height);
    gradient.addColorStop(0, '#173d66');
    gradient.addColorStop(1, '#061933');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, canvas.width, canvas.height - y);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#9de1ff';
    ctx.lineWidth = Math.max(2, canvas.width * 0.0015);
    for (let row = 0; row < 5; row += 1) {
      const yy = y + canvas.height * (0.035 + row * 0.06);
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += canvas.width / 12) {
        const wave = Math.sin(x / canvas.width * Math.PI * 4 + row) * canvas.height * 0.008;
        if (x === 0) ctx.moveTo(x, yy + wave); else ctx.lineTo(x, yy + wave);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawIslandLighthouse({ lit = false, power = 0 } = {}) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#142b39';
    ctx.beginPath();
    ctx.ellipse(w * 0.77, h * 0.69, w * 0.19, h * 0.075, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4e7c8';
    ctx.beginPath();
    ctx.moveTo(w * 0.75, h * 0.59);
    ctx.lineTo(w * 0.81, h * 0.59);
    ctx.lineTo(w * 0.80, h * 0.34);
    ctx.lineTo(w * 0.762, h * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cf5b48';
    ctx.fillRect(w * 0.752, h * 0.315, w * 0.064, h * 0.035);
    ctx.fillStyle = lit ? '#fff5a4' : '#6b7890';
    ctx.fillRect(w * 0.766, h * 0.285, w * 0.036, h * 0.035);
    if (lit || power > 0) {
      const beam = clamp(Math.max(power, lit ? 1 : 0));
      const gradient = ctx.createLinearGradient(w * 0.8, h * 0.31, w * 0.15, h * 0.05);
      gradient.addColorStop(0, `rgba(255,245,164,${0.55 * beam})`);
      gradient.addColorStop(1, 'rgba(255,245,164,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(w * 0.8, h * 0.31);
      ctx.lineTo(w * 0.13, h * 0.02);
      ctx.lineTo(w * 0.14, h * 0.13);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawLume(x, y, size, now, happy = false) {
    const image = images.get(happy ? 'lumeHappy' : 'lume');
    if (drawContain(ctx, image, x - size, y - size, size * 2, size * 2)) return;
    ctx.save();
    ctx.translate(x, y + Math.sin(now * 0.004) * size * 0.08);
    ctx.shadowColor = '#ffe878';
    ctx.shadowBlur = size * 0.65;
    ctx.fillStyle = '#ffe56c';
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const radius = index % 2 === 0 ? size : size * 0.45;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#473b49';
    ctx.beginPath(); ctx.arc(-size * 0.2, -size * 0.05, size * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(size * 0.2, -size * 0.05, size * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawFragment(x, y, radius, now) {
    if (drawContain(ctx, images.get('fragment'), x - radius, y - radius, radius * 2, radius * 2)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now * 0.0015);
    ctx.shadowColor = '#fff0a0';
    ctx.shadowBlur = radius;
    ctx.fillStyle = '#ffe86c';
    ctx.beginPath();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const rr = index % 2 === 0 ? radius : radius * 0.45;
      const px = Math.cos(angle) * rr;
      const py = Math.sin(angle) * rr;
      if (!index) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawCloud(x, y, width, height) {
    if (drawContain(ctx, images.get('cloud'), x - width / 2, y - height / 2, width, height)) return;
    ctx.save();
    ctx.fillStyle = 'rgba(225,237,255,.93)';
    ctx.shadowColor = 'rgba(120,170,220,.35)';
    ctx.shadowBlur = height * 0.22;
    ctx.beginPath();
    ctx.ellipse(x - width * 0.2, y, width * 0.28, height * 0.35, 0, 0, Math.PI * 2);
    ctx.ellipse(x + width * 0.05, y - height * 0.12, width * 0.3, height * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(x + width * 0.28, y, width * 0.24, height * 0.33, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }

  function drawCrystal(x, y, size, active) {
    const image = images.get(active ? 'crystalOn' : 'crystalOff');
    if (drawContain(ctx, image, x - size * 0.55, y - size, size * 1.1, size * 2)) return;
    ctx.save();
    if (active) { ctx.shadowColor = '#8ff6ff'; ctx.shadowBlur = size * 0.45; }
    ctx.fillStyle = active ? '#8df7ff' : '#4d5b8c';
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.5, y - size * 0.15);
    ctx.lineTo(x + size * 0.3, y + size);
    ctx.lineTo(x - size * 0.3, y + size);
    ctx.lineTo(x - size * 0.5, y - size * 0.15);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawHandsCue(kind, strength = 1) {
    const w = canvas.width;
    const h = canvas.height;
    const cy = h * 0.78;
    ctx.save();
    ctx.globalAlpha = 0.38 + strength * 0.45;
    ctx.strokeStyle = '#fff6ac';
    ctx.fillStyle = 'rgba(255,246,172,.13)';
    ctx.lineWidth = Math.max(5, w * 0.004);
    ctx.lineCap = 'round';
    const hand = (x, y) => {
      ctx.beginPath(); ctx.arc(x, y, w * 0.018, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    if (kind === 'together') {
      hand(w * 0.34, cy); hand(w * 0.66, cy);
      ctx.beginPath();
      ctx.moveTo(w * 0.43, cy); ctx.lineTo(w * 0.49, cy); ctx.moveTo(w * 0.57, cy); ctx.lineTo(w * 0.51, cy); ctx.stroke();
    } else if (kind === 'up') {
      hand(w * 0.4, cy); hand(w * 0.6, cy);
      ctx.beginPath();
      ctx.moveTo(w * 0.4, cy - h * 0.05); ctx.lineTo(w * 0.4, cy - h * 0.16);
      ctx.moveTo(w * 0.6, cy - h * 0.05); ctx.lineTo(w * 0.6, cy - h * 0.16); ctx.stroke();
    } else if (kind === 'open') {
      hand(w * 0.44, cy); hand(w * 0.56, cy);
      ctx.beginPath();
      ctx.moveTo(w * 0.38, cy); ctx.lineTo(w * 0.3, cy);
      ctx.moveTo(w * 0.62, cy); ctx.lineTo(w * 0.7, cy); ctx.stroke();
    } else if (kind === 'side') {
      hand(w * 0.5, cy);
      ctx.beginPath(); ctx.moveTo(w * 0.41, cy); ctx.lineTo(w * 0.32, cy); ctx.moveTo(w * 0.59, cy); ctx.lineTo(w * 0.68, cy); ctx.stroke();
    }
    ctx.restore();
  }

  function fallbackBackground(key, now, power = 0) {
    if (key === 'garden' || key === 'towerDark' || key === 'towerPower') {
      nightGradient('#101638', '#26365c');
      drawStars(now, 45, 0.7);
      const h = canvas.height;
      ctx.fillStyle = '#182645';
      ctx.fillRect(0, h * 0.68, canvas.width, h * 0.32);
      return;
    }
    nightGradient();
    drawStars(now, key === 'finalSky' || key === 'towerFinal' ? 100 : 62, key === 'village' ? 0.65 : 1);
    drawSea();
    if (['village', 'towerFinal', 'finalSky'].includes(key)) drawIslandLighthouse({ lit: key !== 'village', power });
  }

  function drawBackground(key, now, power = 0) {
    if (!drawCover(ctx, images.get(key), canvas.width, canvas.height)) fallbackBackground(key, now, power);
  }

  function draw(state, now) {
    const w = canvas.width;
    const h = canvas.height;
    const stage = state.stage;
    const backgroundKey = stage === 'point' || stage === 'intro' || stage === 'setup' ? 'village'
      : stage === 'stars' ? 'beach'
        : stage === 'clouds' ? 'clouds'
          : stage === 'bridge' ? 'bridge'
            : stage === 'crystals' ? 'garden'
              : stage === 'join' ? 'towerDark'
                : stage === 'raise' ? 'towerPower'
                  : 'finalSky';
    drawBackground(backgroundKey, now, state.power);

    if (stage === 'point' || stage === 'intro') {
      drawLume(w * 0.28, h * 0.44, Math.min(w, h) * 0.055, now);
      if (stage === 'point') {
        const targetX = w * 0.78; const targetY = h * 0.32;
        const pulse = 1 + Math.sin(now * 0.006) * 0.14;
        ctx.strokeStyle = 'rgba(255,239,117,.9)';
        ctx.lineWidth = Math.max(4, w * 0.003);
        ctx.beginPath(); ctx.arc(targetX, targetY, Math.min(w, h) * 0.085 * pulse, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (stage === 'stars') {
      for (const star of state.fallingStars) drawFragment(star.x * w, star.y * h, Math.min(w, h) * 0.04, now + star.seed);
      drawLume(w * 0.5, h * 0.2, Math.min(w, h) * 0.045, now);
    }
    if (stage === 'clouds') {
      for (const cloud of state.clouds) drawCloud(cloud.x * w, cloud.y * h, w * 0.23, h * 0.13);
      const playerX = state.playerX * w;
      drawLume(playerX, h * 0.78, Math.min(w, h) * 0.045, now);
      drawHandsCue('side', 0.8);
    }
    if (stage === 'bridge') {
      const open = state.armsOpen;
      const bridgeY = h * 0.68;
      ctx.save();
      ctx.strokeStyle = '#c68c5f';
      ctx.lineWidth = Math.max(16, h * 0.035);
      ctx.beginPath(); ctx.moveTo(w * 0.12, bridgeY); ctx.lineTo(w * 0.88, bridgeY); ctx.stroke();
      ctx.strokeStyle = '#efd0a0'; ctx.lineWidth = Math.max(2, w * 0.002);
      ctx.beginPath(); ctx.moveTo(w * 0.12, bridgeY - h * 0.12); ctx.lineTo(w * 0.88, bridgeY - h * 0.12); ctx.stroke();
      ctx.restore();
      const avatarX = w * (0.5 + state.lean * 0.16);
      drawLume(avatarX, bridgeY - h * 0.08, Math.min(w, h) * 0.05, now);
      drawHandsCue('open', open ? 1 : 0.4);
    }
    if (stage === 'crystals') {
      const xs = [0.27, 0.5, 0.73];
      xs.forEach((x, index) => drawCrystal(x * w, h * 0.62, Math.min(w, h) * 0.09, index < state.crystalIndex));
      const expectedX = state.expectedHand === 'left' ? w * 0.34 : w * 0.66;
      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(now * 0.01) * 0.25;
      ctx.fillStyle = '#fff5a4';
      ctx.beginPath();
      ctx.moveTo(expectedX, h * 0.31); ctx.lineTo(expectedX - w * 0.025, h * 0.37); ctx.lineTo(expectedX + w * 0.025, h * 0.37); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (stage === 'join') {
      const cx = w * 0.5; const cy = h * 0.48; const size = Math.min(w, h) * 0.19;
      if (!drawContain(ctx, images.get('starBroken'), cx - size, cy - size, size * 2, size * 2)) {
        drawFragment(cx - size * 0.38 * (1 - state.joinVisual), cy, size * 0.28, now);
        drawFragment(cx + size * 0.38 * (1 - state.joinVisual), cy, size * 0.28, now + 1200);
        drawFragment(cx, cy - size * 0.42 * (1 - state.joinVisual), size * 0.28, now + 2400);
      }
      drawHandsCue('together', state.joinVisual);
    }
    if (stage === 'raise') {
      const cx = w * 0.5; const cy = h * 0.47; const size = Math.min(w, h) * 0.2;
      if (!drawContain(ctx, images.get('starRestored'), cx - size, cy - size, size * 2, size * 2)) {
        drawFragment(cx, cy, size * (0.42 + state.power * 0.12), now);
      }
      if (state.power > 0) {
        const beam = ctx.createLinearGradient(cx, cy, cx, 0);
        beam.addColorStop(0, `rgba(255,241,132,${0.55 * state.power})`);
        beam.addColorStop(1, 'rgba(255,241,132,0)');
        ctx.fillStyle = beam;
        ctx.fillRect(cx - w * 0.075, 0, w * 0.15, cy);
      }
      drawHandsCue('up', state.power);
    }
    if (stage === 'ending') drawLume(w * 0.5, h * 0.38, Math.min(w, h) * 0.07, now, true);
    drawParticles();
  }

  return { resize, draw, burst, updateParticles };
}

export function createLighthouseStory({ root, client, room, onClose, onEndingChange }) {
  const canvas = root.querySelector('.lighthouse-canvas');
  const connection = root.querySelector('.lighthouse-connection');
  const prompt = root.querySelector('.lighthouse-prompt');
  const promptIcon = root.querySelector('.lighthouse-prompt-icon');
  const promptTitle = root.querySelector('.lighthouse-prompt-title');
  const promptMeter = root.querySelector('.lighthouse-prompt-meter');
  const promptMeterFill = promptMeter.querySelector('span');
  const objective = root.querySelector('.lighthouse-objective');
  const progress = root.querySelector('.lighthouse-progress');
  const ending = root.querySelector('.lighthouse-ending');
  const restartButton = root.querySelector('.lighthouse-restart');
  const backButton = root.querySelector('.lighthouse-back');
  const renderer = createRenderer(canvas);

  let rawPose = emptyPose();
  let pose = emptyPose();
  let previousHands = { left: emptyPoint(0.35, 0.56), right: emptyPoint(0.65, 0.56) };
  let lastPoseAt = 0;
  let phoneConnected = Boolean(client?.roomStatus?.phone);
  let running = false;
  let animationFrame = 0;
  let lastFrame = performance.now();
  let stage = 'setup';
  let stageElapsed = 0;
  let calibrationStartedAt = 0;
  let neutralShoulderX = 0.5;
  let neutralShoulderY = 0.38;
  let actionHold = 0;
  let fallingStars = [];
  let nextStarAt = 0;
  let starsCaught = 0;
  let clouds = [];
  let nextCloudAt = 0;
  let cloudsDodged = 0;
  let bridgeProgress = 0;
  let crystalIndex = 0;
  let crystalReadyAt = 0;
  let handsWereRaised = { left: false, right: false };
  let joinVisual = 0;
  let power = 0;
  let audioContext = null;
  let lastSpokenStage = '';

  function poseFresh(now = performance.now()) {
    return phoneConnected && now - lastPoseAt < POSE_TIMEOUT_MS && pose.detected;
  }
  function handsReady(now = performance.now()) {
    return poseFresh(now) && pose.left.visible && pose.right.visible;
  }
  function shouldersReady(now = performance.now()) {
    return handsReady(now) && pose.leftShoulder.visible && pose.rightShoulder.visible;
  }
  function shoulderMidX() { return (pose.leftShoulder.x + pose.rightShoulder.x) / 2; }
  function shoulderMidY() { return (pose.leftShoulder.y + pose.rightShoulder.y) / 2; }
  function handDistance() { return Math.abs(pose.right.x - pose.left.x); }

  function ensureAudio() {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume?.().catch(() => {});
    } catch {}
  }
  function tone(frequency = 620, duration = 0.07, gainValue = 0.045) {
    try {
      ensureAudio();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(gainValue, audioContext.currentTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + duration + 0.025);
    } catch {}
  }
  function successTone() {
    [620, 780, 980].forEach((frequency, index) => setTimeout(() => tone(frequency, 0.1), index * 55));
  }
  function speak(text, key = stage) {
    if (!text || lastSpokenStage === key || !('speechSynthesis' in window)) return;
    lastSpokenStage = key;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR'; utterance.rate = 0.95; utterance.pitch = 1.08;
      speechSynthesis.speak(utterance);
    } catch {}
  }

  function showPrompt(title, icon = '⭐', meter = null) {
    promptTitle.textContent = title;
    promptIcon.textContent = icon;
    prompt.classList.remove('hidden');
    promptMeter.classList.toggle('hidden', meter === null);
    if (meter !== null) promptMeterFill.style.width = `${Math.round(clamp(meter) * 100)}%`;
  }
  function hidePrompt() { prompt.classList.add('hidden'); }
  function setObjective(text = '') {
    objective.textContent = text;
    objective.classList.toggle('hidden', !text);
  }
  function updateProgress() {
    const current = STAGE_IDS.indexOf(stage);
    progress.innerHTML = STAGE_IDS.map((_, index) => `<i class="${index < current ? 'done' : index === current ? 'current' : ''}"></i>`).join('');
  }
  function setConnection() {
    connection.textContent = phoneConnected ? `Celular conectado • ${room}` : `Aguardando celular • ${room}`;
    connection.className = `lighthouse-connection ${phoneConnected ? 'online' : 'waiting'}`;
  }

  function enterStage(next) {
    stage = next; stageElapsed = 0; actionHold = 0;
    hidePrompt(); setObjective(''); updateProgress(); lastSpokenStage = '';
    if (next === 'intro') { showPrompt('O farol apagou!', '🌙'); speak('O farol apagou!'); }
    if (next === 'point') { showPrompt('Ache o farol!', '👉'); speak('Ache o farol!'); }
    if (next === 'stars') {
      fallingStars = []; starsCaught = 0; nextStarAt = 0;
      setObjective('⭐ 0/5'); showPrompt('Pegue as estrelas!', '⭐'); speak('Pegue as estrelas!');
    }
    if (next === 'clouds') {
      clouds = []; cloudsDodged = 0; nextCloudAt = 0;
      setObjective('☁️ 0/4'); showPrompt('Desvie!', '↔️'); speak('Desvie das nuvens!');
    }
    if (next === 'bridge') {
      bridgeProgress = 0; showPrompt('Abra os braços!', '🙌', 0); speak('Abra os braços!');
    }
    if (next === 'crystals') {
      crystalIndex = 0; crystalReadyAt = 0; handsWereRaised = { left: false, right: false };
      setObjective('💎 0/3'); showPrompt('Acenda!', '✨'); speak('Acenda os cristais!');
    }
    if (next === 'join') { joinVisual = 0; showPrompt('Junte as mãos!', '🤲', 0); speak('Junte as mãos!'); }
    if (next === 'raise') { power = 0; showPrompt('Braços para cima!', '🙌', 0); speak('Braços para cima!'); }
    if (next === 'ending') {
      power = 1; hidePrompt(); setObjective(''); ending.classList.remove('hidden'); onEndingChange?.(true);
      successTone(); speak('Conseguimos! As estrelas voltaram!', 'ending');
    }
  }

  function reset() {
    stage = 'setup'; stageElapsed = 0; calibrationStartedAt = 0; actionHold = 0;
    fallingStars = []; starsCaught = 0; clouds = []; cloudsDodged = 0; bridgeProgress = 0;
    crystalIndex = 0; joinVisual = 0; power = 0;
    ending.classList.add('hidden'); onEndingChange?.(false); progress.innerHTML = '';
    setObjective(''); showPrompt('Mostre as mãos', '🙌'); lastSpokenStage = '';
  }

  function updateMotion(now, dt) {
    const fresh = now - lastPoseAt < POSE_TIMEOUT_MS && rawPose.detected;
    const seconds = Math.max(1 / 120, dt / 1000);
    previousHands = { left: { ...pose.left }, right: { ...pose.right } };
    for (const name of POINT_NAMES) {
      const source = rawPose[name];
      const current = pose[name];
      const visible = Boolean(fresh && source.visible);
      current.visible = visible;
      if (!visible) continue;
      const speed = Math.hypot(source.vx, source.vy);
      const lead = WRISTS.has(name) ? Math.min(0.05, 0.018 + speed * 0.018) : 0.016;
      const desiredX = clamp(source.x + source.vx * lead * 0.65);
      const desiredY = clamp(source.y + source.vy * lead * 0.65);
      const distance = Math.hypot(desiredX - current.x, desiredY - current.y);
      if (!pose.detected || distance > 0.25) {
        current.x = desiredX; current.y = desiredY;
      } else {
        const responsiveness = clamp(speed / (WRISTS.has(name) ? 1.45 : 0.95));
        const tau = WRISTS.has(name) ? lerp(0.046, 0.012, responsiveness) : lerp(0.07, 0.025, responsiveness);
        const alpha = 1 - Math.exp(-seconds / tau);
        const deadZone = speed < 0.09 ? 0.0022 : 0;
        const dx = Math.abs(desiredX - current.x) < deadZone ? 0 : desiredX - current.x;
        const dy = Math.abs(desiredY - current.y) < deadZone ? 0 : desiredY - current.y;
        current.x = clamp(current.x + dx * alpha);
        current.y = clamp(current.y + dy * alpha);
      }
      current.vx = source.vx; current.vy = source.vy;
    }
    pose.detected = Boolean(fresh);
  }

  function segmentDistanceSquared(px, py, ax, ay, bx, by) {
    const abx = bx - ax; const aby = by - ay;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared < 0.000001) return (px - ax) ** 2 + (py - ay) ** 2;
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared);
    const cx = ax + abx * t; const cy = ay + aby * t;
    return (px - cx) ** 2 + (py - cy) ** 2;
  }
  function sweptHandHit(target, radius) {
    return ['left', 'right'].some((name) => {
      const current = pose[name];
      if (!current.visible) return false;
      const previous = previousHands[name]?.visible ? previousHands[name] : current;
      return segmentDistanceSquared(target.x, target.y, previous.x, previous.y, current.x, current.y) <= radius ** 2;
    });
  }

  function updateSetup(now) {
    if (!phoneConnected) { calibrationStartedAt = 0; showPrompt('Conecte o celular', '📱'); return; }
    if (!shouldersReady(now)) { calibrationStartedAt = 0; showPrompt('Mostre as mãos', '🙌'); return; }
    if (!calibrationStartedAt) calibrationStartedAt = now;
    neutralShoulderX = lerp(neutralShoulderX, shoulderMidX(), 0.12);
    neutralShoulderY = lerp(neutralShoulderY, shoulderMidY(), 0.12);
    const calibration = clamp((now - calibrationStartedAt) / 800);
    showPrompt('Pronto!', '✨', calibration);
    if (calibration >= 1) enterStage('intro');
  }

  function updateStage(now, dt) {
    stageElapsed += dt;
    const seconds = dt / 1000;
    if (!handsReady(now) && stage !== 'ending') { showPrompt('Volte para a câmera', '🙌'); return; }
    if (stage === 'intro') { if (stageElapsed > 1600) enterStage('point'); return; }
    if (stage === 'point') {
      const target = { x: 0.78, y: 0.32 };
      const hit = sweptHandHit(target, stageElapsed > 7000 ? 0.16 : 0.115);
      actionHold = hit ? actionHold + dt : Math.max(0, actionHold - dt * 1.8);
      if (actionHold > 320) { renderer.burst(target.x, target.y, 18); successTone(); enterStage('stars'); }
      return;
    }
    if (stage === 'stars') {
      const spawnDelay = stageElapsed > 18000 ? 520 : 700;
      if (now >= nextStarAt && fallingStars.length < 5 && starsCaught < 5) {
        fallingStars.push({ x: randomBetween(0.16, 0.84), y: 0.12, vy: randomBetween(0.16, 0.22), seed: Math.random() * 5000 });
        nextStarAt = now + spawnDelay;
      }
      const hitRadius = stageElapsed > 14000 ? 0.115 : 0.085;
      for (const star of fallingStars) {
        star.y += star.vy * seconds;
        if (!star.hit && sweptHandHit(star, hitRadius)) {
          star.hit = true; starsCaught += 1; renderer.burst(star.x, star.y, 10); tone(540 + starsCaught * 70);
        }
      }
      fallingStars = fallingStars.filter((star) => !star.hit && star.y < 1.08);
      setObjective(`⭐ ${starsCaught}/5`);
      if (starsCaught >= 5) { successTone(); enterStage('clouds'); }
      return;
    }
    if (stage === 'clouds') {
      if (!shouldersReady(now)) { showPrompt('Mostre os ombros', '🙌'); return; }
      hidePrompt();
      const rawShift = clamp((shoulderMidX() - neutralShoulderX) / 0.16, -1, 1);
      const playerX = 0.5 + rawShift * 0.28;
      const spawnDelay = stageElapsed > 20000 ? 950 : 1250;
      if (now >= nextCloudAt && clouds.length < 2) {
        const lane = Math.random() < 0.5 ? 0.37 : 0.63;
        clouds.push({ x: lane, y: -0.08, vy: stageElapsed > 20000 ? 0.17 : 0.2, checked: false });
        nextCloudAt = now + spawnDelay;
      }
      for (const cloud of clouds) {
        cloud.y += cloud.vy * seconds;
        if (!cloud.checked && cloud.y > 0.72) {
          cloud.checked = true;
          if (Math.abs(playerX - cloud.x) > 0.14) {
            cloudsDodged += 1; renderer.burst(playerX, 0.78, 8); tone(650 + cloudsDodged * 55);
          } else tone(360, 0.05, 0.025);
        }
      }
      clouds = clouds.filter((cloud) => cloud.y < 1.08);
      setObjective(`☁️ ${cloudsDodged}/4`);
      if (cloudsDodged >= 4) { successTone(); enterStage('bridge'); }
      return;
    }
    if (stage === 'bridge') {
      if (!shouldersReady(now)) { showPrompt('Mostre os ombros', '🙌'); return; }
      const armsOpen = handDistance() > (stageElapsed > 18000 ? 0.34 : 0.39);
      const lean = clamp((shoulderMidX() - neutralShoulderX) / 0.12, -1, 1);
      const targetLean = Math.sin(now / 1150) * 0.6;
      const tolerance = stageElapsed > 18000 ? 0.8 : 0.62;
      const balanced = Math.abs(lean - targetLean) < tolerance;
      if (armsOpen && balanced) bridgeProgress += seconds * (stageElapsed > 18000 ? 0.28 : 0.22);
      bridgeProgress = clamp(bridgeProgress);
      showPrompt('Abra e equilibre!', '🙌', bridgeProgress);
      if (bridgeProgress >= 1) { successTone(); enterStage('crystals'); }
      return;
    }
    if (stage === 'crystals') {
      if (!shouldersReady(now)) { showPrompt('Mostre os ombros', '🙌'); return; }
      const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
      const threshold = stageElapsed > 18000 ? 0.045 : 0.075;
      const raised = { left: pose.left.y < shoulderY - threshold, right: pose.right.y < shoulderY - threshold };
      const expected = ['left', 'right', 'left'][crystalIndex] || 'left';
      const bothDown = !raised.left && !raised.right;
      if (bothDown && now >= crystalReadyAt) crystalReadyAt = 0;
      if (!crystalReadyAt && raised[expected] && !handsWereRaised[expected]) {
        renderer.burst([0.27, 0.5, 0.73][crystalIndex], 0.62, 16);
        crystalIndex += 1; tone(650 + crystalIndex * 100); crystalReadyAt = now + 450;
        setObjective(`💎 ${crystalIndex}/3`);
      }
      handsWereRaised = raised;
      if (crystalIndex >= 3) { successTone(); enterStage('join'); }
      return;
    }
    if (stage === 'join') {
      const distance = handDistance();
      joinVisual = clamp((0.38 - distance) / 0.27);
      const closeEnough = distance < (stageElapsed > 15000 ? 0.17 : 0.135);
      actionHold = closeEnough ? actionHold + dt : Math.max(0, actionHold - dt * 1.5);
      showPrompt('Junte as mãos!', '🤲', clamp(actionHold / 650));
      if (actionHold > 650) { renderer.burst(0.5, 0.48, 24); successTone(); enterStage('raise'); }
      return;
    }
    if (stage === 'raise') {
      if (!shouldersReady(now)) { showPrompt('Mostre os ombros', '🙌'); return; }
      const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
      const raised = pose.left.y < shoulderY - 0.045 && pose.right.y < shoulderY - 0.045;
      actionHold = raised ? actionHold + dt : Math.max(0, actionHold - dt * 1.25);
      power = clamp(actionHold / 900);
      showPrompt('Braços para cima!', '🙌', power);
      if (actionHold > 900) { renderer.burst(0.5, 0.42, 32); enterStage('ending'); }
    }
  }

  function frame(now) {
    if (!running) return;
    renderer.resize();
    const dt = Math.min(42, Math.max(0, now - lastFrame));
    lastFrame = now;
    updateMotion(now, dt);
    if (stage === 'setup') updateSetup(now); else updateStage(now, dt);
    renderer.updateParticles(dt);
    const lean = shouldersReady(now) ? clamp((shoulderMidX() - neutralShoulderX) / 0.12, -1, 1) : 0;
    const playerX = 0.5 + lean * 0.28;
    renderer.draw({
      stage, fallingStars, clouds, playerX, bridgeProgress,
      armsOpen: handDistance() > 0.39,
      lean,
      crystalIndex,
      expectedHand: ['left', 'right', 'left'][Math.min(crystalIndex, 2)],
      joinVisual, power
    }, now);
    animationFrame = requestAnimationFrame(frame);
  }

  client.on('pose', (data) => {
    const next = emptyPose();
    for (const name of POINT_NAMES) next[name] = normalizePoint(data?.[name], next[name]);
    next.detected = Boolean(data?.detected);
    rawPose = next; lastPoseAt = performance.now();
  });
  client.on('room-status', ({ phone }) => {
    phoneConnected = Boolean(phone); setConnection();
    if (!phoneConnected && stage !== 'ending') calibrationStartedAt = 0;
  });
  client.on('disconnect', () => { phoneConnected = false; setConnection(); calibrationStartedAt = 0; });

  restartButton.addEventListener('click', () => { reset(); if (!running) start(); });
  backButton.addEventListener('click', () => onClose?.());

  function start() {
    ensureAudio();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    running = true; lastFrame = performance.now(); setConnection(); reset();
    animationFrame = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    try { speechSynthesis?.cancel?.(); } catch {}
    onEndingChange?.(false);
  }

  return { start, stop, restart: start };
}
