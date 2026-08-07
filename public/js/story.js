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

const POSE_TIMEOUT_MS = 260;
const NARRATIVE_TIME_SCALE = 1.55;
const targetPose = emptyPose();

const CHAPTERS = [
  ['arrival', 'mother', 'tracks'],
  ['trail-walk', 'vines', 'after-vines', 'squirrel'],
  ['apples', 'squirrel-thanks', 'creek-walk'],
  ['bridge-intro', 'bridge', 'far-bank'],
  ['tunnel-intro', 'duck', 'dusk-walk'],
  ['firefly-intro', 'fireflies', 'whisper', 'rescue-intro'],
  ['rescue', 'reunion', 'ending']
];

const NARRATIVE = {
  arrival: {
    next: 'mother',
    beats: [
      { duration: 6500, eyebrow: 'UMA TRILHA DIFERENTE', title: 'A floresta parecia muito tranquila…', text: 'Até que um som baixinho veio de trás das árvores.' },
      { duration: 6500, eyebrow: 'ESCUTE…', title: 'Alguém está procurando alguma coisa', text: 'Entre as folhas, uma raposa aparece olhando para todos os lados.' }
    ]
  },
  mother: {
    next: 'tracks',
    beats: [
      { duration: 6500, eyebrow: 'MAMÃE RAPOSA', title: '“Meu filhote saiu para explorar…”', text: '“Ele sempre volta antes do pôr do sol, mas hoje ainda não voltou.”' },
      { duration: 6500, eyebrow: 'MAMÃE RAPOSA', title: '“Eu encontrei umas pegadinhas!”', text: '“Você pode me ajudar a seguir o caminho dele?”' },
      { duration: 4500, eyebrow: 'SUA MISSÃO', title: 'Vamos encontrar o pequeno explorador', text: 'A raposa vai acompanhar você durante a aventura.' }
    ]
  },
  'trail-walk': {
    next: 'vines',
    beats: [
      { duration: 7000, eyebrow: 'MAIS FUNDO NA FLORESTA', title: 'As pegadas seguem pela trilha', text: 'Passarinhos voam entre as árvores enquanto a mamãe raposa corre logo atrás.' },
      { duration: 7000, eyebrow: 'UMA PISTA', title: 'As marcas continuam do outro lado…', text: 'Mas a vegetação ficou cada vez mais fechada.' }
    ]
  },
  'after-vines': {
    next: 'squirrel',
    beats: [
      { duration: 6500, eyebrow: 'CAMINHO ABERTO', title: 'Conseguimos passar!', text: 'Do outro lado existe uma pequena clareira cheia de árvores frutíferas.' },
      { duration: 5500, eyebrow: 'OLHA ALI!', title: 'Um esquilo está pulando de galho em galho', text: 'Ele parece ter visto alguma coisa importante.' }
    ]
  },
  squirrel: {
    next: 'apples',
    beats: [
      { duration: 6500, eyebrow: 'ESQUILO', title: '“Um filhote de raposa passou por aqui!”', text: '“Ele estava seguindo uma borboleta e correu em direção ao riacho.”' },
      { duration: 6500, eyebrow: 'ESQUILO', title: '“Eu mostro o caminho…”', text: '“…mas minhas maçãs caíram todas. Você me ajuda a juntá-las primeiro?”' },
      { duration: 4500, eyebrow: 'VAMOS AJUDAR', title: 'Prepare a cesta', text: 'Mova as duas mãos juntas para levar a cesta de um lado para o outro.' }
    ]
  },
  'squirrel-thanks': {
    next: 'creek-walk',
    beats: [
      { duration: 6500, eyebrow: 'ESQUILO', title: '“Cinco maçãs! Conseguimos!”', text: 'O esquilo guarda tudo e aponta rapidamente para uma trilha estreita.' },
      { duration: 6500, eyebrow: 'NOVA PISTA', title: '“Ele foi por ali, perto da água!”', text: 'A mamãe raposa reconhece uma nova pegada e vocês continuam juntos.' }
    ]
  },
  'creek-walk': {
    next: 'bridge-intro',
    beats: [
      { duration: 7000, eyebrow: 'PERTO DO RIACHO', title: 'O som da água fica cada vez mais forte', text: 'A trilha desce entre pedras, samambaias e raízes enormes.' },
      { duration: 7000, eyebrow: 'QUASE LÁ', title: 'Uma pegada aparece na margem', text: 'O filhote realmente atravessou para o outro lado.' }
    ]
  },
  'bridge-intro': {
    next: 'bridge',
    beats: [
      { duration: 6500, eyebrow: 'O RIACHO', title: 'A ponte está quebrada', text: 'Mas existe um tronco firme ligando as duas margens.' },
      { duration: 5500, eyebrow: 'COM CUIDADO', title: 'Vamos atravessar devagar', text: 'Incline o corpo para ajudar o pequeno explorador a manter o equilíbrio.' }
    ]
  },
  'far-bank': {
    next: 'tunnel-intro',
    beats: [
      { duration: 6500, eyebrow: 'OUTRO LADO', title: 'Chegamos!', text: 'Algumas gotinhas caem do tronco enquanto a floresta volta a ficar silenciosa.' },
      { duration: 6500, eyebrow: 'MAIS UMA PISTA', title: 'Há pelos laranjas presos num galho', text: 'O filhote passou por aqui há pouco tempo.' }
    ]
  },
  'tunnel-intro': {
    next: 'duck',
    beats: [
      { duration: 6500, eyebrow: 'TÚNEL DE ÁRVORES', title: 'A trilha passa por baixo de galhos baixos', text: 'A mamãe raposa consegue passar, mas você vai precisar se abaixar.' },
      { duration: 4500, eyebrow: 'ATENÇÃO', title: 'Observe os galhos chegando', text: 'Abaixe o corpo quando eles passarem por você.' }
    ]
  },
  'dusk-walk': {
    next: 'firefly-intro',
    beats: [
      { duration: 7000, eyebrow: 'FIM DE TARDE', title: 'A luz começa a mudar', text: 'O sol se esconde atrás das árvores e pequenas luzes aparecem na mata.' },
      { duration: 7000, eyebrow: 'QUE LUZES SÃO ESSAS?', title: 'Vaga-lumes começam a formar um caminho', text: 'Talvez eles tenham visto para onde o filhote foi.' },
      { duration: 5500, eyebrow: 'MAMÃE RAPOSA', title: '“Estamos chegando perto, eu sinto!”', text: 'Ela olha para você e continua seguindo as luzes.' }
    ]
  },
  'firefly-intro': {
    next: 'fireflies',
    beats: [
      { duration: 6000, eyebrow: 'LUZES DA FLORESTA', title: 'Os vaga-lumes querem ajudar', text: 'Encoste neles com qualquer uma das mãos para reuni-los.' },
      { duration: 4500, eyebrow: 'TRÊS LUZES', title: 'Quando estiverem juntos…', text: '…eles poderão iluminar a parte mais escura da trilha.' }
    ]
  },
  whisper: {
    next: 'rescue-intro',
    beats: [
      { duration: 6500, eyebrow: 'SILÊNCIO…', title: 'A floresta fica completamente quieta', text: 'Então vocês escutam um som baixinho atrás dos arbustos.' },
      { duration: 6500, eyebrow: 'MAMÃE RAPOSA', title: '“É ele!”', text: 'A raposa reconhece o chamado e corre até uma pequena clareira.' },
      { duration: 5000, eyebrow: 'ENCONTRAMOS!', title: 'O filhote está ali', text: 'Ele está bem, mas alguns galhos fecharam a passagem por onde entrou.' }
    ]
  },
  'rescue-intro': {
    next: 'rescue',
    beats: [
      { duration: 6000, eyebrow: 'ÚLTIMO DESAFIO', title: 'Vamos abrir espaço para ele sair', text: 'Coloque as mãos à frente e abra os braços devagar.' },
      { duration: 4500, eyebrow: 'JUNTOS', title: 'A mamãe raposa está esperando', text: 'Quando o caminho abrir, o filhote poderá correr até ela.' }
    ]
  },
  reunion: {
    next: 'ending',
    beats: [
      { duration: 7000, eyebrow: 'REENCONTRO', title: 'O filhote corre para a mamãe!', text: 'Ela encosta o focinho nele e finalmente relaxa.' },
      { duration: 6500, eyebrow: 'MAMÃE RAPOSA', title: '“Obrigada por não desistir!”', text: '“Você seguiu cada pista e ajudou todos que encontramos pelo caminho.”' },
      { duration: 6500, eyebrow: 'A FLORESTA COMEMORA', title: 'O esquilo aparece com as maçãs', text: 'Os vaga-lumes dançam no ar e os pássaros voltam a cantar.' },
      { duration: 5000, eyebrow: 'MISSÃO CUMPRIDA', title: 'O pequeno explorador está seguro', text: 'E agora ele tem uma história enorme para contar quando chegar em casa.' }
    ]
  }
};

let pose = emptyPose();
let lastPoseAt = 0;
let phoneConnected = false;
let state = room.length >= 4 ? 'waiting' : 'invalid-room';
let scene = 'arrival';
let sceneStartedAt = performance.now();
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
let particles = [];
let audioContext = null;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function emptyPoint(x, y) {
  return { x, y, vx: 0, vy: 0, visible: false };
}
function emptyPose() {
  return {
    detected: false,
    left: emptyPoint(0.35, 0.55),
    right: emptyPoint(0.65, 0.55),
    leftShoulder: emptyPoint(0.44, 0.36),
    rightShoulder: emptyPoint(0.56, 0.36)
  };
}
function poseReady(now = performance.now()) {
  return phoneConnected
    && now - lastPoseAt < POSE_TIMEOUT_MS
    && pose.detected
    && pose.left.visible
    && pose.right.visible
    && pose.leftShoulder.visible
    && pose.rightShoulder.visible;
}
function handDistance() {
  return Math.abs(pose.right.x - pose.left.x);
}
function handMidX() {
  return (pose.left.x + pose.right.x) / 2;
}
function shoulderMidX() {
  return (pose.leftShoulder.x + pose.rightShoulder.x) / 2;
}
function shoulderMidY() {
  return (pose.leftShoulder.y + pose.rightShoulder.y) / 2;
}
function bothHandsRaised() {
  const shoulderY = Math.min(pose.leftShoulder.y, pose.rightShoulder.y);
  return pose.left.y < shoulderY - 0.02 && pose.right.y < shoulderY - 0.02;
}
function setObjective(text = '') {
  objective.textContent = text;
  objective.classList.toggle('hidden', !text);
}
function setMessageMode(dialogue = false) {
  messageCard.classList.toggle('dialogue', dialogue);
}
function showMessage(eyebrow, title, text, progress = null, dialogue = false) {
  setMessageMode(dialogue);
  messageEyebrow.textContent = eyebrow;
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageProgress.style.width = `${Math.round(clamp(progress ?? 0) * 100)}%`;
  messageCard.classList.remove('hidden');
}
function hideMessage() {
  messageCard.classList.add('hidden');
  setMessageMode(false);
}
function chapterIndexForScene(sceneName) {
  const index = CHAPTERS.findIndex((chapter) => chapter.includes(sceneName));
  return Math.max(0, index);
}
function updateProgress() {
  const current = chapterIndexForScene(scene);
  storyProgress.innerHTML = CHAPTERS.map((_, index) => {
    const cls = index < current ? 'done' : index === current ? 'current' : '';
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
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  audioContext.resume?.().catch(() => {});
}
function tone(frequency, duration = 0.08) {
  try {
    ensureAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration + 0.02);
  } catch {
    // Áudio é apenas um reforço; a história continua sem ele.
  }
}
function sparkle(x, y, count = 8) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * (40 + Math.random() * 90),
      vy: Math.sin(angle) * (40 + Math.random() * 90),
      life: 1,
      size: 2 + Math.random() * 5
    });
  }
}
function sceneTone() {
  [523, 659, 784].forEach((frequency, index) => {
    setTimeout(() => tone(frequency, 0.11), index * 85);
  });
}
function nextScene(next) {
  scene = next;
  sceneStartedAt = performance.now();
  sceneElapsedMs = 0;
  actionHold = 0;
  setObjective('');
  hideMessage();
  updateProgress();

  if (next === 'tracks') {
    setObjective('Encontre a pegada verdadeira e toque nela');
  }
  if (next === 'vines') {
    setObjective('Abra bem os braços para afastar os cipós');
  }
  if (next === 'apples') {
    applesCaught = 0;
    apples = [];
    appleSpawnAt = 0;
    setObjective('Pegue 5 maçãs com a cesta • 0/5');
  }
  if (next === 'bridge') {
    riverProgress = 0;
    bridgeTarget = 0;
    setObjective('Incline o corpo para manter o equilíbrio');
  }
  if (next === 'duck') {
    duckCount = 0;
    duckWasLow = false;
    setObjective('Abaixe-se quando o galho chegar • 0/2');
  }
  if (next === 'fireflies') {
    firefliesCaught.clear();
    fireflyTargets = [
      { x: 0.28, y: 0.42 },
      { x: 0.72, y: 0.33 },
      { x: 0.5, y: 0.56 }
    ];
    setObjective('Encoste nos vaga-lumes • 0/3');
  }
  if (next === 'rescue') {
    setObjective('Abra os braços e mantenha por um instante');
  }
  if (next === 'ending') {
    setObjective('');
    setTimeout(() => endingCard.classList.remove('hidden'), 1200);
    [523, 659, 784, 1047].forEach((frequency, index) => {
      setTimeout(() => tone(frequency, 0.16), index * 100);
    });
  }
}
function restartStory() {
  endingCard.classList.add('hidden');
  scene = 'arrival';
  sceneStartedAt = performance.now();
  sceneElapsedMs = 0;
  actionHold = 0;
  restartHold = 0;
  updateProgress();
  setObjective('');
  hideMessage();
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
  connectionBadge.textContent = phoneConnected
    ? `Celular conectado • ${room}`
    : `Aguardando celular • ${room || '----'}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
  if (!phoneConnected && state !== 'invalid-room') {
    state = 'waiting';
    calibrationStartedAt = 0;
  }
});
socket.on('disconnect', () => {
  phoneConnected = false;
  state = 'waiting';
  calibrationStartedAt = 0;
});

async function connect() {
  if (state === 'invalid-room') {
    showMessage(
      'CÓDIGO AUSENTE',
      'Abra a história pelo menu da TV',
      'Assim o código da sala será mantido e o celular continuará conectado.'
    );
    return;
  }

  await socket.connect();
  const result = await socket.request('join', { room, role: 'tv' });
  phoneConnected = Boolean(result?.status?.phone);
  connectionBadge.textContent = phoneConnected
    ? `Celular conectado • ${room}`
    : `Aguardando celular • ${room}`;
  connectionBadge.className = `story-badge ${phoneConnected ? 'online' : 'waiting'}`;
}

function updateSetup(now) {
  if (state === 'invalid-room') return;

  if (!phoneConnected) {
    showMessage(
      'HISTÓRIA PRONTA',
      'Aguardando o celular',
      `A câmera precisa continuar conectada à sala ${room}.`
    );
    return;
  }

  if (!poseReady(now)) {
    calibrationStartedAt = 0;
    showMessage(
      'PREPARANDO A AVENTURA',
      'Mostre as duas mãos',
      'Fique de frente para a câmera. O celular continua parado onde está.'
    );
    return;
  }

  if (!calibrationStartedAt) calibrationStartedAt = now;
  const elapsed = now - calibrationStartedAt;
  neutralShoulderY = lerp(neutralShoulderY, shoulderMidY(), 0.1);
  neutralShoulderX = lerp(neutralShoulderX, shoulderMidX(), 0.1);

  showMessage(
    'CALIBRANDO',
    'Ótimo, continue assim!',
    'Só mais um instante e a floresta vai aparecer.',
    elapsed / 1100
  );

  if (elapsed >= 1100) {
    state = 'playing';
    sceneStartedAt = now;
    sceneElapsedMs = 0;
    hideMessage();
    updateProgress();
  }
}

function narrativeBeat(sceneName, elapsedMs) {
  const config = NARRATIVE[sceneName];
  if (!config) return null;

  let cursor = 0;
  for (let index = 0; index < config.beats.length; index += 1) {
    const beat = config.beats[index];
    const duration = beat.duration * NARRATIVE_TIME_SCALE;
    const end = cursor + duration;
    if (elapsedMs < end) {
      return {
        beat,
        index,
        progress: clamp((elapsedMs - cursor) / duration),
        total: config.beats.length
      };
    }
    cursor = end;
  }

  return {
    complete: true,
    next: config.next,
    totalDuration: cursor
  };
}

function updateNarrative(sceneName) {
  const beatInfo = narrativeBeat(sceneName, sceneElapsedMs);
  if (!beatInfo) return false;

  if (beatInfo.complete) {
    nextScene(beatInfo.next);
    return true;
  }

  const { beat, index, total } = beatInfo;
  showMessage(
    `${beat.eyebrow} • ${index + 1}/${total}`,
    beat.title,
    beat.text,
    null,
    true
  );
  return true;
}

function updateStory(now, dt) {
  if (!poseReady(now) && scene !== 'ending') {
    showMessage(
      'CÂMERA',
      'Volte para a área da câmera',
      'Assim que suas mãos aparecerem, a aventura continua.'
    );
    return;
  }

  sceneElapsedMs += dt;

  if (NARRATIVE[scene]) {
    setObjective('');
    updateNarrative(scene);
    return;
  }

  hideMessage();
  const seconds = dt / 1000;
  const elapsed = sceneElapsedMs;

  if (scene === 'tracks') {
    const target = { x: 0.28, y: 0.58 };
    const hand = pose.right;
    const assist = clamp((elapsed - 14000) / 18000);
    const radius = lerp(0.11, 0.18, assist);
    const distance = Math.hypot(hand.x - target.x, hand.y - target.y);

    if (distance < radius) actionHold += dt;
    else actionHold = Math.max(0, actionHold - dt * 1.5);

    if (elapsed > 12000) {
      setObjective('A pegada certa está brilhando do lado esquerdo');
    }

    if (actionHold > 600) {
      tone(660, 0.1);
      sparkle(target.x * canvas.width, target.y * canvas.height);
      sceneTone();
      nextScene('trail-walk');
    }
    return;
  }

  if (scene === 'vines') {
    const assist = clamp((elapsed - 16000) / 22000);
    const threshold = lerp(0.88, 0.68, assist);
    const spread = clamp((handDistance() - 0.22) / 0.34);
    actionHold = spread > threshold ? actionHold + dt : Math.max(0, actionHold - dt * 1.4);

    if (elapsed > 15000) {
      setObjective('Abra os braços como se afastasse uma cortina');
    }

    if (actionHold > 800) {
      tone(600, 0.12);
      sparkle(canvas.width * 0.5, canvas.height * 0.48, 14);
      nextScene('after-vines');
    }
    return;
  }

  if (scene === 'apples') {
    const spawnDelay = elapsed > 45000 ? 580 : 760;
    if (
      now - appleSpawnAt > spawnDelay
      && apples.length < 5
      && applesCaught < 5
    ) {
      apples.push({
        x: 0.15 + Math.random() * 0.7,
        y: 0.12,
        vy: 0.11 + Math.random() * 0.055,
        caught: false
      });
      appleSpawnAt = now;
    }

    const basketX = handMidX();
    const catchRadius = elapsed > 35000 ? 0.16 : 0.125;

    for (const apple of apples) {
      apple.y += apple.vy * seconds;
      if (
        !apple.caught
        && apple.y > 0.72
        && apple.y < 0.91
        && Math.abs(apple.x - basketX) < catchRadius
      ) {
        apple.caught = true;
        applesCaught += 1;
        tone(520 + applesCaught * 45, 0.07);
        sparkle(apple.x * canvas.width, apple.y * canvas.height, 5);
      }
    }

    apples = apples.filter((apple) => !apple.caught && apple.y < 1.05);
    setObjective(`Pegue 5 maçãs com a cesta • ${applesCaught}/5`);

    if (applesCaught >= 5) {
      sceneTone();
      nextScene('squirrel-thanks');
    }
    return;
  }

  if (scene === 'bridge') {
    bridgeTarget = Math.sin(now / 1100) * 0.055;
    const lean = clamp((shoulderMidX() - neutralShoulderX) / 0.12, -1, 1);
    const targetLean = bridgeTarget / 0.055;
    const balance = 1 - clamp(Math.abs(lean - targetLean) / 1.3);
    const assist = clamp((elapsed - 45000) / 35000);
    const baseSpeed = lerp(0.01, 0.016, assist);
    const bonusSpeed = lerp(0.012, 0.018, assist);

    riverProgress += seconds * (baseSpeed + balance * bonusSpeed);
    setObjective(`Mantenha o equilíbrio • ${Math.round(clamp(riverProgress) * 100)}%`);

    if (riverProgress >= 1) {
      tone(650, 0.1);
      sceneTone();
      nextScene('far-bank');
    }
    return;
  }

  if (scene === 'duck') {
    const cycleDuration = 5000;
    const cycle = (elapsed % cycleDuration) / cycleDuration;
    const danger = cycle > 0.48 && cycle < 0.86;
    const assist = clamp((elapsed - 18000) / 26000);
    const lowThreshold = lerp(0.055, 0.032, assist);
    const low = shoulderMidY() > neutralShoulderY + lowThreshold;

    if (danger && low && !duckWasLow) {
      duckWasLow = true;
      duckCount += 1;
      tone(560 + duckCount * 70, 0.08);
      sparkle(canvas.width * 0.5, canvas.height * 0.6, 7);
    }

    if (!danger) duckWasLow = false;
    setObjective(`Abaixe-se quando o galho chegar • ${duckCount}/2`);

    if (duckCount >= 2) {
      sceneTone();
      nextScene('dusk-walk');
    }
    return;
  }

  if (scene === 'fireflies') {
    const assist = clamp((elapsed - 18000) / 28000);
    const hitRadius = lerp(0.1, 0.17, assist);

    for (let index = 0; index < fireflyTargets.length; index += 1) {
      if (firefliesCaught.has(index)) continue;
      const target = fireflyTargets[index];
      const hit = Math.min(
        Math.hypot(pose.left.x - target.x, pose.left.y - target.y),
        Math.hypot(pose.right.x - target.x, pose.right.y - target.y)
      );

      if (hit < hitRadius) {
        firefliesCaught.add(index);
        tone(720 + index * 90, 0.08);
        sparkle(target.x * canvas.width, target.y * canvas.height, 10);
      }
    }

    setObjective(`Encoste nos vaga-lumes • ${firefliesCaught.size}/3`);

    if (firefliesCaught.size >= 3 && elapsed > 1200) {
      sceneTone();
      nextScene('whisper');
    }
    return;
  }

  if (scene === 'rescue') {
    const assist = clamp((elapsed - 12000) / 22000);
    const threshold = lerp(0.72, 0.58, assist);
    const spread = clamp((handDistance() - 0.18) / 0.42);
    actionHold = spread > threshold ? actionHold + dt : Math.max(0, actionHold - dt * 1.5);

    if (elapsed > 12000) {
      setObjective('Abra os braços como se abrisse uma grande porta');
    }

    if (actionHold > 1000) {
      sparkle(canvas.width * 0.5, canvas.height * 0.52, 30);
      [620, 760, 920].forEach((frequency, index) => {
        setTimeout(() => tone(frequency, 0.14), index * 100);
      });
      nextScene('reunion');
    }
    return;
  }

  if (scene === 'ending') {
    hideMessage();
    if (poseReady(now) && bothHandsRaised()) restartHold += dt;
    else restartHold = 0;
    if (restartHold > 1800) restartStory();
  }
}

function drawForest(width, height, mood = 0, scroll = 0) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, mood > 0.5 ? '#183f43' : '#7fcbb0');
  sky.addColorStop(0.58, mood > 0.5 ? '#315c4a' : '#cfe9ad');
  sky.addColorStop(1, '#315536');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = mood > 0.5 ? '#466b3f' : '#6f9d50';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.7);
  for (let index = 0; index <= 8; index += 1) {
    const x = (index / 8) * width;
    ctx.lineTo(
      x,
      height * (0.64 + Math.sin(index * 1.6 + scroll * 0.2) * 0.025)
    );
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  for (let index = 0; index < 12; index += 1) {
    const raw = index * 0.101 + 0.02 - scroll * 0.035;
    const x = (((raw % 1) + 1) % 1) * width;
    const trunkW = width * (0.023 + (index % 3) * 0.006);
    ctx.fillStyle = index % 2 ? '#594b35' : '#665139';
    ctx.fillRect(x - trunkW / 2, height * 0.13, trunkW, height * 0.62);
    ctx.fillStyle = index % 3 ? '#2f7044' : '#3f8650';

    for (let leaf = 0; leaf < 4; leaf += 1) {
      ctx.beginPath();
      ctx.arc(
        x + (leaf - 1.5) * trunkW * 0.9,
        height * (0.16 + leaf * 0.07),
        trunkW * 1.8,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  ctx.fillStyle = mood > 0.5 ? '#324e35' : '#527d42';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.83);
  ctx.quadraticCurveTo(width * 0.5, height * 0.72, width, height * 0.84);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
}

function drawFox(x, y, scale, cub = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.fillStyle = cub ? '#dd7c35' : '#c96b2c';
  ctx.beginPath();
  ctx.ellipse(0, 8, 34, 29, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -22, 25, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-18, -39);
  ctx.lineTo(-9, -70);
  ctx.lineTo(1, -42);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(18, -39);
  ctx.lineTo(9, -70);
  ctx.lineTo(-1, -42);
  ctx.fill();

  ctx.fillStyle = '#f8e6ca';
  ctx.beginPath();
  ctx.ellipse(0, -13, 15, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#27241f';
  ctx.beginPath();
  ctx.arc(-8, -26, 3, 0, Math.PI * 2);
  ctx.arc(8, -26, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -14, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = cub ? '#dd7c35' : '#c96b2c';
  ctx.beginPath();
  ctx.ellipse(35, 15, 24, 11, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8e6ca';
  ctx.beginPath();
  ctx.ellipse(52, 7, 9, 7, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSquirrel(x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.fillStyle = '#95633d';
  ctx.beginPath();
  ctx.ellipse(0, 8, 24, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -25, 19, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c8915d';
  ctx.beginPath();
  ctx.ellipse(28, 0, 25, 38, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2d241e';
  ctx.beginPath();
  ctx.arc(-6, -29, 2.6, 0, Math.PI * 2);
  ctx.arc(6, -29, 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f0c79b';
  ctx.beginPath();
  ctx.ellipse(0, 8, 10, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function drawHandMarkers(width, height) {
  if (!poseReady()) return;

  for (const [name, color] of [
    ['left', '#ff6c8f'],
    ['right', '#47d2b3']
  ]) {
    const hand = pose[name];
    ctx.beginPath();
    ctx.arc(
      hand.x * width,
      hand.y * height,
      Math.max(16, width * 0.015),
      0,
      Math.PI * 2
    );
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function walkingScene() {
  return [
    'trail-walk',
    'creek-walk',
    'dusk-walk'
  ].includes(scene);
}

function drawTracks(width, height) {
  const assist = clamp((sceneElapsedMs - 12000) / 18000);
  const pulse = 0.7 + Math.sin(performance.now() / 250) * 0.3;
  const size = Math.max(46, width * (0.045 + assist * 0.012));

  ctx.font = `${size}px system-ui`;
  ctx.textAlign = 'center';

  ctx.globalAlpha = 0.35;
  ctx.fillText('🐾', width * 0.72, height * 0.46);
  ctx.globalAlpha = 0.92;
  if (assist > 0) {
    ctx.shadowBlur = 20 + 25 * pulse;
    ctx.shadowColor = '#ffe77a';
  }
  ctx.fillText('🐾', width * 0.28, height * 0.59);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawScene(width, height, now) {
  const darkScenes = [
    'dusk-walk',
    'firefly-intro',
    'fireflies',
    'whisper',
    'rescue-intro',
    'rescue',
    'reunion',
    'ending'
  ];
  const mood = darkScenes.includes(scene) ? 1 : 0;
  const scroll = walkingScene() ? sceneElapsedMs / 1000 : 0;
  drawForest(width, height, mood, scroll);

  const t = sceneElapsedMs / 1000;
  const scale = Math.min(width, height);

  if (walkingScene()) {
    const bob = Math.sin(t * 4) * height * 0.006;
    drawFox(width * 0.34, height * 0.72 + bob, scale / 760, false);

    if (scene === 'dusk-walk') {
      for (let index = 0; index < 5; index += 1) {
        const x = width * (0.58 + Math.sin(t * 0.7 + index) * 0.11);
        const y = height * (0.32 + index * 0.07 + Math.cos(t + index) * 0.02);
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#ffe96b';
        ctx.fillStyle = '#ffe96b';
        ctx.beginPath();
        ctx.arc(x, y, 5 + (index % 2) * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  if (['arrival', 'mother'].includes(scene)) {
    drawFox(width * 0.73, height * 0.72, scale / 650, false);
  }

  if (scene === 'tracks') {
    drawFox(width * 0.78, height * 0.73, scale / 760, false);
    drawTracks(width, height);
  }

  if (scene === 'vines') {
    const spread = clamp((handDistance() - 0.22) / 0.34);
    ctx.strokeStyle = '#315d35';
    ctx.lineWidth = Math.max(18, width * 0.025);
    ctx.lineCap = 'round';

    for (let index = 0; index < 6; index += 1) {
      const side = index < 3 ? -1 : 1;
      const x = width * (
        0.5 + side * (0.05 + (index % 3) * 0.07) * (1 - spread)
      );
      ctx.beginPath();
      ctx.moveTo(x, height * 0.15);
      ctx.quadraticCurveTo(width * 0.5, height * 0.45, x, height * 0.82);
      ctx.stroke();
    }
  }

  if (['after-vines', 'squirrel', 'apples', 'squirrel-thanks'].includes(scene)) {
    drawSquirrel(width * 0.73, height * 0.67, scale / 650);
    drawFox(width * 0.2, height * 0.73, scale / 820, false);
  }

  if (scene === 'apples') {
    const basketX = handMidX() * width;

    ctx.fillStyle = '#b97c3e';
    roundedRect(
      basketX - width * 0.085,
      height * 0.78,
      width * 0.17,
      height * 0.08,
      16
    );
    ctx.fill();

    ctx.strokeStyle = '#6f4526';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(basketX, height * 0.78, width * 0.07, Math.PI, 0);
    ctx.stroke();

    for (const apple of apples) {
      ctx.fillStyle = '#e9473d';
      ctx.beginPath();
      ctx.arc(
        apple.x * width,
        apple.y * height,
        Math.max(13, width * 0.013),
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.fillStyle = '#4e7e3f';
      ctx.fillRect(
        apple.x * width + 3,
        apple.y * height - 18,
        4,
        10
      );
    }

    for (let index = 0; index < 6; index += 1) {
      const x = width * (0.12 + index * 0.14);
      ctx.fillStyle = '#3e7d43';
      ctx.beginPath();
      ctx.arc(x, height * 0.2, width * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (['bridge-intro', 'bridge', 'far-bank'].includes(scene)) {
    const riverY = height * 0.68;
    ctx.fillStyle = '#438db3';
    ctx.fillRect(0, riverY, width, height - riverY);

    for (let index = 0; index < 6; index += 1) {
      ctx.strokeStyle = 'rgba(255,255,255,.34)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const y = riverY + height * (0.06 + index * 0.05);
      ctx.moveTo(width * 0.05, y);
      ctx.quadraticCurveTo(width * 0.5, y - 8, width * 0.95, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#8b6842';
    ctx.save();
    ctx.translate(width * 0.5, riverY + height * 0.02);
    ctx.rotate(scene === 'bridge' ? Math.sin(now / 1100) * 0.035 : 0);
    ctx.fillRect(-width * 0.28, -height * 0.035, width * 0.56, height * 0.07);
    ctx.restore();

    const foxX = scene === 'bridge'
      ? width * (0.25 + clamp(riverProgress) * 0.5)
      : scene === 'far-bank'
        ? width * 0.74
        : width * 0.24;
    drawFox(foxX, riverY - height * 0.03, scale / 900, true);

    if (scene === 'bridge') {
      const lean = clamp((shoulderMidX() - neutralShoulderX) / 0.12, -1, 1);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      roundedRect(width * 0.38, height * 0.17, width * 0.24, height * 0.035, 99);
      ctx.fill();
      ctx.fillStyle = '#f4bd45';
      ctx.beginPath();
      ctx.arc(
        width * (0.5 + lean * 0.1),
        height * 0.187,
        width * 0.012,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  if (['tunnel-intro', 'duck'].includes(scene)) {
    drawFox(width * 0.5, height * 0.74, scale / 850, true);

    if (scene === 'duck') {
      const cycle = (sceneElapsedMs % 5000) / 5000;
      const x = width * (1.18 - cycle * 1.38);
      ctx.strokeStyle = '#6d5133';
      ctx.lineWidth = Math.max(20, width * 0.025);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, height * 0.48);
      ctx.lineTo(x + width * 0.23, height * 0.48);
      ctx.stroke();

      ctx.fillStyle = '#477d40';
      for (let index = 0; index < 4; index += 1) {
        ctx.beginPath();
        ctx.ellipse(
          x + index * width * 0.055,
          height * 0.45,
          width * 0.018,
          height * 0.025,
          0.4,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  if (['firefly-intro', 'fireflies'].includes(scene)) {
    if (scene === 'fireflies') {
      const assist = clamp((sceneElapsedMs - 18000) / 28000);
      fireflyTargets.forEach((target, index) => {
        if (firefliesCaught.has(index)) return;
        const pulse = 0.72 + Math.sin(now / 220 + index) * 0.28;
        const radius = (8 + 6 * pulse) * lerp(1, 1.5, assist);

        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ffe96b';
        ctx.fillStyle = '#ffe96b';
        ctx.beginPath();
        ctx.arc(
          target.x * width,
          target.y * height,
          radius,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    } else {
      for (let index = 0; index < 6; index += 1) {
        const x = width * (0.25 + index * 0.1);
        const y = height * (0.38 + Math.sin(now / 500 + index) * 0.12);
        ctx.shadowBlur = 22;
        ctx.shadowColor = '#ffe96b';
        ctx.fillStyle = '#ffe96b';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  if (['whisper', 'rescue-intro', 'rescue', 'reunion', 'ending'].includes(scene)) {
    drawFox(width * 0.5, height * 0.68, scale / 780, true);

    if (scene === 'rescue') {
      const spread = clamp((handDistance() - 0.18) / 0.42);
      ctx.strokeStyle = '#705335';
      ctx.lineWidth = Math.max(22, width * 0.026);

      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(width * (0.5 + side * 0.03), height * 0.26);
        ctx.quadraticCurveTo(
          width * (0.5 + side * 0.11 * (1 - spread)),
          height * 0.5,
          width * (0.5 + side * 0.08 * (1 - spread)),
          height * 0.79
        );
        ctx.stroke();
      }
    }

    if (['reunion', 'ending'].includes(scene)) {
      drawFox(width * 0.38, height * 0.71, scale / 690, false);
      drawSquirrel(width * 0.78, height * 0.74, scale / 920);

      for (let index = 0; index < 8; index += 1) {
        const x = width * (0.18 + index * 0.085);
        const y = height * (0.25 + Math.sin(now / 330 + index) * 0.08);
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#ffe96b';
        ctx.fillStyle = '#ffe96b';
        ctx.beginPath();
        ctx.arc(x, y, 4 + (index % 2) * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
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

  const interactive = [
    'tracks',
    'vines',
    'apples',
    'bridge',
    'duck',
    'fireflies',
    'rescue'
  ].includes(scene);

  if (interactive) drawHandMarkers(width, height);
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
  showMessage(
    'CONEXÃO',
    'Não foi possível abrir a aventura',
    error.message || 'Tente voltar ao menu da TV e abrir novamente.'
  );
});

updateProgress();
requestAnimationFrame(frame);
