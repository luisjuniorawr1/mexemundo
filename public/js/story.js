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

const room = String(new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const POSE_TIMEOUT_MS = 260;
const SCENES = ['intro', 'tracks', 'vines', 'apples', 'bridge', 'duck', 'fireflies', 'rescue', 'ending'];
const targetPose = emptyPose();
let pose = emptyPose();
let lastPoseAt = 0;
let phoneConnected = false;
let state = room.length >= 4 ? 'waiting' : 'invalid-room';
let scene = 'intro';
let sceneStartedAt = 0;
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
let particles = [];
let audioContext = null;

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function emptyPoint(x, y) { return { x, y, vx: 0, vy: 0, visible: false }; }
function emptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55), right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.36), rightShoulder: emptyPoint(0.56, 0.36)
  };
}
function poseReady(now = performance.now()) {
  return phoneConnected && now - lastPoseAt < POSE_TIMEOUT_MS && pose.detected
    && pose.left.visible && pose.right.visible && pose.leftShoulder.visible && pose.rightShoulder.visible;
}
function handDistance() { return Math.abs(pose.right.x - pose.left.x); }
function handMidX() { return (pose.left.x + pose.right.x) / 2; }
function shoulderMidX() { return (pose.leftShoulder.x + pose.rightShoulder.x) / 2; }
function shoulderMidY() { return (pose.leftShoulder.y + pose.rightShoulder.y) / 2; }
function bothHandsRaised() {
  const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
  return pose.left.y < shoulderY - 0.02 && pose.right.y < shoulderY - 0.02;
}
function setObjective(text = '') {
  objective.textContent = text;
  objective.classList.toggle('hidden', !text);
}
function showMessage(eyebrow, title, text, progress = null) {
  messageEyebrow.textContent = eyebrow;
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageProgress.style.width = `${Math.round(clamp(progress ?? 0) * 100)}%`;
  messageCard.classList.remove('hidden');
}
function hideMessage() { messageCard.classList.add('hidden'); }
function updateProgress() {
  storyProgress.innerHTML = SCENES.map((name, index) => {
    const current = SCENES.indexOf(scene);
    const cls = index < current ? 'done' : index === current ? 'current' : '';
    return `<i class="${cls}"></i>`;
  }).join('');
}
function resize() {
  const scale = Math.min(devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * scale));
  const h = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  audioContext.resume?.().catch(() => {});
}
function tone(freq, duration = 0.08) {
  try {
    ensureAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = freq;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.02);
  } catch {}
}
function sparkle(x, y, count = 8) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x, y,
      vx: Math.cos(angle) * (40 + Math.random() * 90),
      vy: Math.sin(angle) * (40 + Math.random() * 90),
      life: 1,
      size: 2 + Math.random() * 5
    });
  }
}
function nextScene(next) {
  scene = next;
  sceneStartedAt = performance.now();
  actionHold = 0;
  setObjective('');
  updateProgress();
  if (next === 'tracks') setObjective('Toque na trilha de pegadas');
  if (next === 'vines') setObjective('Abra bem os braços para liberar a passagem');
  if (next === 'apples') {
    applesCaught = 0;
    apples = [];
    appleSpawnAt = 0;
    setObjective('Pegue 5 maçãs com a cesta');
  }
  if (next === 'bridge') {
    riverProgress = 0;
    bridgeTarget = 0;
    setObjective('Incline o corpo para manter o equilíbrio');
  }
  if (next === 'duck') {
    duckCount = 0;
    duckWasLow = false;
    setObjective('Abaixe-se quando o galho chegar');
  }
  if (next === 'fireflies') {
    firefliesCaught.clear();
    fireflyTargets = [{ x: .28, y: .42 }, { x: .72, y: .33 }, { x: .5, y: .56 }];
    setObjective('Encoste em 3 vaga-lumes');
  }
  if (next === 'rescue') setObjective('Abra os braços para libertar o filhote');
  if (next === 'ending') {
    setObjective('');
    setTimeout(() => endingCard.classList.remove('hidden'), 1100);
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .16), i * 100));
  }
}
function restartStory() {
  endingCard.classList.add('hidden');
  scene = 'intro';
  sceneStartedAt = performance.now();
  actionHold = 0;
  restartHold = 0;
  updateProgress();
  setObjective('');
}
restartButton.addEventListener('click', restartStory);
window.addEventListener('pointerdown', ensureAudio, { once: true });

socket.on('pose', (data) => {
  for (const name of ['left', 'right', 'leftShoulder', 'rightShoulder']) {
    const point = data?.[name];
    if (point) targetPose[name] = { ...point };
  }
  targetPose.detected = Boolean(data?.detected);
  pose = targetPose;
  lastPoseAt = performance.now();
});
socket.on('room-status', ({ phone }) => {
  phoneConnected = Boolean(phone);
  connectionBadge.textContent = phoneConnected ? `Celular conectado • ${room}` : `Aguardando celular • ${room || '----'}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
  if (!phoneConnected && state !== 'invalid-room') state = 'waiting';
});
socket.on('disconnect', () => {
  phoneConnected = false;
  state = 'waiting';
});

async function connect() {
  if (state === 'invalid-room') {
    showMessage('CÓDIGO AUSENTE', 'Abra a história pelo menu da TV', 'Assim o código da sala será mantido e o celular continuará conectado.');
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
  if (!phoneConnected) {
    showMessage('HISTÓRIA PRONTA', 'Aguardando o celular', `A câmera precisa continuar conectada à sala ${room}.`);
    return;
  }
  if (!poseReady(now)) {
    calibrationStartedAt = 0;
    showMessage('PREPARANDO A AVENTURA', 'Mostre as duas mãos', 'Fique de frente para a câmera. O celular continua parado onde está.');
    return;
  }
  if (!calibrationStartedAt) calibrationStartedAt = now;
  const elapsed = now - calibrationStartedAt;
  neutralShoulderY = lerp(neutralShoulderY, shoulderMidY(), 0.1);
  neutralShoulderX = lerp(neutralShoulderX, shoulderMidX(), 0.1);
  showMessage('CALIBRANDO', 'Ótimo, continue assim!', 'Só mais um instante e a floresta vai aparecer.', elapsed / 1100);
  if (elapsed >= 1100) {
    state = 'playing';
    sceneStartedAt = now;
    hideMessage();
    updateProgress();
  }
}

function updateStory(now, dt) {
  const seconds = dt / 1000;
  if (!poseReady(now) && scene !== 'ending') {
    showMessage('CÂMERA', 'Volte para a área da câmera', 'Assim que suas mãos aparecerem, a aventura continua.');
    return;
  }
  hideMessage();
  const elapsed = now - sceneStartedAt;

  if (scene === 'intro') {
    if (elapsed > 6500) nextScene('tracks');
  } else if (scene === 'tracks') {
    const target = { x: .28, y: .58 };
    const hand = pose.right;
    if (Math.hypot(hand.x - target.x, hand.y - target.y) < .12) actionHold += dt;
    else actionHold = Math.max(0, actionHold - dt * 1.6);
    if (actionHold > 550) {
      tone(660, .1);
      sparkle(target.x * canvas.width, target.y * canvas.height);
      nextScene('vines');
    }
  } else if (scene === 'vines') {
    const spread = clamp((handDistance() - .22) / .34);
    actionHold = spread * 1000;
    if (spread > .88) {
      tone(600, .12);
      nextScene('apples');
    }
  } else if (scene === 'apples') {
    if (now - appleSpawnAt > 760 && apples.length < 4 && applesCaught < 5) {
      apples.push({ x: .16 + Math.random() * .68, y: .12, vy: .16 + Math.random() * .07, caught: false });
      appleSpawnAt = now;
    }
    const basketX = handMidX();
    for (const apple of apples) {
      apple.y += apple.vy * seconds;
      if (!apple.caught && apple.y > .73 && apple.y < .9 && Math.abs(apple.x - basketX) < .12) {
        apple.caught = true;
        applesCaught += 1;
        tone(520 + applesCaught * 45, .07);
        sparkle(apple.x * canvas.width, apple.y * canvas.height, 5);
      }
    }
    apples = apples.filter((apple) => !apple.caught && apple.y < 1.05);
    setObjective(`Pegue 5 maçãs com a cesta • ${applesCaught}/5`);
    if (applesCaught >= 5) nextScene('bridge');
  } else if (scene === 'bridge') {
    riverProgress += seconds * .11;
    bridgeTarget = Math.sin(now / 900) * .055;
    const lean = clamp((shoulderMidX() - neutralShoulderX) / .12, -1, 1);
    const balance = 1 - clamp(Math.abs(lean - bridgeTarget / .055) / 1.2);
    riverProgress += balance * seconds * .07;
    if (riverProgress >= 1) {
      tone(650, .1);
      nextScene('duck');
    }
  } else if (scene === 'duck') {
    const cycle = (elapsed % 3200) / 3200;
    const danger = cycle > .55 && cycle < .86;
    const low = shoulderMidY() > neutralShoulderY + .055;
    if (danger && low && !duckWasLow) {
      duckWasLow = true;
      duckCount += 1;
      tone(560 + duckCount * 70, .08);
    }
    if (!danger) duckWasLow = false;
    setObjective(`Abaixe-se quando o galho chegar • ${duckCount}/2`);
    if (duckCount >= 2) nextScene('fireflies');
  } else if (scene === 'fireflies') {
    for (let i = 0; i < fireflyTargets.length; i += 1) {
      if (firefliesCaught.has(i)) continue;
      const target = fireflyTargets[i];
      const hit = Math.min(
        Math.hypot(pose.left.x - target.x, pose.left.y - target.y),
        Math.hypot(pose.right.x - target.x, pose.right.y - target.y)
      );
      if (hit < .105) {
        firefliesCaught.add(i);
        tone(720 + i * 90, .08);
        sparkle(target.x * canvas.width, target.y * canvas.height, 10);
      }
    }
    setObjective(`Encoste em 3 vaga-lumes • ${firefliesCaught.size}/3`);
    if (firefliesCaught.size >= 3 && elapsed > 1000) nextScene('rescue');
  } else if (scene === 'rescue') {
    const spread = clamp((handDistance() - .18) / .42);
    actionHold = spread > .72 ? actionHold + dt : Math.max(0, actionHold - dt * 1.6);
    setObjective('Abra os braços e mantenha por um instante');
    if (actionHold > 900) {
      sparkle(canvas.width * .5, canvas.height * .52, 26);
      nextScene('ending');
    }
  } else if (scene === 'ending') {
    if (poseReady(now) && bothHandsRaised()) restartHold += dt;
    else restartHold = 0;
    if (restartHold > 1800) restartStory();
  }
}

function drawForest(width, height, mood = 0) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, mood > .5 ? '#183f43' : '#7fcbb0');
  sky.addColorStop(.58, mood > .5 ? '#315c4a' : '#cfe9ad');
  sky.addColorStop(1, '#315536');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#6f9d50';
  ctx.beginPath();
  ctx.moveTo(0, height * .7);
  for (let i = 0; i <= 8; i += 1) {
    const x = i / 8 * width;
    ctx.lineTo(x, height * (.64 + Math.sin(i * 1.6) * .025));
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 10; i += 1) {
    const x = ((i * .113 + .02) % 1) * width;
    const trunkW = width * (.025 + (i % 3) * .006);
    ctx.fillStyle = i % 2 ? '#594b35' : '#665139';
    ctx.fillRect(x - trunkW / 2, height * .13, trunkW, height * .62);
    ctx.fillStyle = i % 3 ? '#2f7044' : '#3f8650';
    for (let j = 0; j < 4; j += 1) {
      ctx.beginPath();
      ctx.arc(x + (j - 1.5) * trunkW * .9, height * (.16 + j * .07), trunkW * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function drawFox(x, y, scale, cub = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = cub ? '#dd7c35' : '#c96b2c';
  ctx.beginPath(); ctx.ellipse(0, 8, 34, 29, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -22, 25, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-18, -39); ctx.lineTo(-9, -70); ctx.lineTo(1, -42); ctx.fill();
  ctx.beginPath(); ctx.moveTo(18, -39); ctx.lineTo(9, -70); ctx.lineTo(-1, -42); ctx.fill();
  ctx.fillStyle = '#f8e6ca';
  ctx.beginPath(); ctx.ellipse(0, -13, 15, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#27241f';
  ctx.beginPath(); ctx.arc(-8, -26, 3, 0, Math.PI * 2); ctx.arc(8, -26, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -14, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function drawHandMarkers(width, height) {
  if (!poseReady()) return;
  for (const [name, color] of [['left', '#ff6c8f'], ['right', '#47d2b3']]) {
    const hand = pose[name];
    ctx.beginPath();
    ctx.arc(hand.x * width, hand.y * height, Math.max(16, width * .015), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = .78;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
function drawScene(width, height, now) {
  drawForest(width, height, ['fireflies', 'rescue', 'ending'].includes(scene) ? 1 : 0);
  const t = (now - sceneStartedAt) / 1000;

  if (scene === 'intro') {
    drawFox(width * .72, height * .69, Math.min(width, height) / 620, false);
    ctx.fillStyle = 'rgba(255,251,234,.94)';
    roundedRect(width * .12, height * .18, width * .48, height * .23, 28);
    ctx.fill();
    ctx.fillStyle = '#264234';
    ctx.textAlign = 'left';
    ctx.font = `900 ${Math.max(22, width * .026)}px system-ui`;
    ctx.fillText('Meu filhote sumiu na floresta…', width * .16, height * .25);
    ctx.font = `700 ${Math.max(16, width * .016)}px system-ui`;
    ctx.fillStyle = '#53665a';
    ctx.fillText('Você pode me ajudar a encontrá-lo?', width * .16, height * .31);
  }
  if (scene === 'tracks') {
    drawFox(width * .78, height * .72, Math.min(width, height) / 760, false);
    ctx.font = `${Math.max(48, width * .052)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('🐾', width * .28, height * .59);
    ctx.globalAlpha = .35;
    ctx.fillText('🐾', width * .72, height * .46);
    ctx.globalAlpha = 1;
  }
  if (scene === 'vines') {
    const spread = clamp((handDistance() - .22) / .34);
    ctx.strokeStyle = '#315d35';
    ctx.lineWidth = Math.max(18, width * .025);
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i += 1) {
      const side = i < 3 ? -1 : 1;
      const x = width * (.5 + side * (.05 + (i % 3) * .07) * (1 - spread));
      ctx.beginPath();
      ctx.moveTo(x, height * .15);
      ctx.quadraticCurveTo(width * .5, height * .45, x, height * .82);
      ctx.stroke();
    }
  }
  if (scene === 'apples') {
    const basketX = handMidX() * width;
    ctx.fillStyle = '#b97c3e';
    roundedRect(basketX - width * .085, height * .78, width * .17, height * .08, 16);
    ctx.fill();
    ctx.strokeStyle = '#6f4526';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(basketX, height * .78, width * .07, Math.PI, 0);
    ctx.stroke();
    for (const apple of apples) {
      ctx.fillStyle = '#e9473d';
      ctx.beginPath();
      ctx.arc(apple.x * width, apple.y * height, Math.max(13, width * .013), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4e7e3f';
      ctx.fillRect(apple.x * width + 3, apple.y * height - 18, 4, 10);
    }
  }
  if (scene === 'bridge') {
    const y = height * .68;
    ctx.fillStyle = '#438db3';
    ctx.fillRect(0, y, width, height - y);
    ctx.fillStyle = '#8b6842';
    ctx.save();
    ctx.translate(width * .5, y + height * .02);
    ctx.rotate(Math.sin(now / 900) * .035);
    ctx.fillRect(-width * .28, -height * .035, width * .56, height * .07);
    ctx.restore();
    drawFox(width * (.25 + riverProgress * .5), y - height * .03, Math.min(width, height) / 900, true);
    const lean = clamp((shoulderMidX() - neutralShoulderX) / .12, -1, 1);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    roundedRect(width * .38, height * .17, width * .24, height * .035, 99);
    ctx.fill();
    ctx.fillStyle = '#f4bd45';
    ctx.beginPath();
    ctx.arc(width * (.5 + lean * .1), height * .187, width * .012, 0, Math.PI * 2);
    ctx.fill();
  }
  if (scene === 'duck') {
    const cycle = (t % 3.2) / 3.2;
    const x = width * (1.15 - cycle * 1.3);
    ctx.strokeStyle = '#6d5133';
    ctx.lineWidth = Math.max(20, width * .025);
    ctx.beginPath();
    ctx.moveTo(x, height * .48);
    ctx.lineTo(x + width * .23, height * .48);
    ctx.stroke();
    drawFox(width * .5, height * .72, Math.min(width, height) / 850, true);
  }
  if (scene === 'fireflies') {
    fireflyTargets.forEach((target, index) => {
      if (firefliesCaught.has(index)) return;
      const pulse = .7 + Math.sin(now / 220 + index) * .3;
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ffe96b';
      ctx.fillStyle = '#ffe96b';
      ctx.beginPath();
      ctx.arc(target.x * width, target.y * height, 8 + 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }
  if (scene === 'rescue' || scene === 'ending') {
    drawFox(width * .5, height * .66, Math.min(width, height) / 780, true);
    if (scene === 'rescue') {
      const spread = clamp((handDistance() - .18) / .42);
      ctx.strokeStyle = '#705335';
      ctx.lineWidth = Math.max(22, width * .026);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(width * (.5 + side * .03), height * .26);
        ctx.quadraticCurveTo(
          width * (.5 + side * .11 * (1 - spread)),
          height * .5,
          width * (.5 + side * .08 * (1 - spread)),
          height * .79
        );
        ctx.stroke();
      }
    } else {
      drawFox(width * .38, height * .69, Math.min(width, height) / 690, false);
    }
  }
  for (const particle of particles) {
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = '#ffe56a';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawHandMarkers(width, height);
}
function updateParticles(dt) {
  const seconds = dt / 1000;
  for (const particle of particles) {
    particle.x += particle.vx * seconds;
    particle.y += particle.vy * seconds;
    particle.vy += 50 * seconds;
    particle.life -= seconds * 1.8;
  }
  particles = particles.filter((particle) => particle.life > 0);
}

function frame(now) {
  resize();
  const dt = Math.min(42, now - lastFrame);
  lastFrame = now;
  if (state !== 'playing') updateSetup(now);
  else updateStory(now, dt);
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
