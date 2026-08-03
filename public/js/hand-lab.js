import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';
import { HandTrackingCore } from './hand-tracking-core.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PROFILE_KEY = 'mexemundo-hand-calibration-v1';
const TARGET_RADIUS = 0.13;
const ALIGN_HOLD_MS = 1800;

const $ = (selector) => document.querySelector(selector);
const video = $('#camera');
const canvas = $('#overlay');
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
const stage = $('#cameraStage');
const startPanel = $('#startPanel');
const startButton = $('#startButton');
const calibrateButton = $('#calibrateButton');
const resetButton = $('#resetButton');
const copyButton = $('#copyButton');
const guideLayer = $('#guideLayer');
const guideStep = $('#guideStep');
const guideTitle = $('#guideTitle');
const guideText = $('#guideText');
const guideProgress = $('#guideProgress');
const targetElements = [$('#targetLeft'), $('#targetRight')];
const statusText = $('#statusText');
const statusDetail = $('#statusDetail');
const profileBadge = $('#profileBadge');
const calibrationInstruction = $('#calibrationInstruction');
const calibrationProgress = $('#calibrationProgress');
const phaseElements = [...document.querySelectorAll('[data-phase]')];
const cameraRate = $('#cameraRate');
const resolutionValue = $('#resolutionValue');
const handRate = $('#handRate');
const handTime = $('#handTime');
const visibleHands = $('#visibleHands');
const activeProfile = $('#activeProfile');
const profileDate = $('#profileDate');
const resultPanel = $('#resultPanel');
const resultTitle = $('#resultTitle');
const scoreBadge = $('#scoreBadge');
const stabilityResult = $('#stabilityResult');
const accuracyResult = $('#accuracyResult');
const continuityResult = $('#continuityResult');
const performanceResult = $('#performanceResult');
const resultMessage = $('#resultMessage');
const resultCode = $('#resultCode');

const PHASES = [
  { id: 'align', title: 'Posicione as mãos', text: 'Coloque uma mão em cada círculo e mantenha.', duration: ALIGN_HOLD_MS },
  { id: 'steady', title: 'Fique parado', text: 'Agora não mova as mãos. Vamos medir o tremor real.', duration: 3500 },
  { id: 'horizontal', title: 'Siga para os lados', text: 'Acompanhe os círculos sem subir ou descer.', duration: 5000 },
  { id: 'vertical', title: 'Siga para cima e para baixo', text: 'Acompanhe os círculos mantendo cada mão do seu lado.', duration: 5000 },
  { id: 'corners', title: 'Alcance os cantos', text: 'Siga os círculos até completar a volta.', duration: 6000 }
];

let handTask;
let running = false;
let lastMediaTime = -1;
let latestSnapshot = null;
let core = new HandTrackingCore({ mirrorX: true });
let loadedProfile = loadProfile();
let counters = resetCounters();
let rateStartedAt = performance.now();
let measuredRate = 0;
let measuredInferenceMs = 0;

const session = {
  active: false,
  phaseIndex: -1,
  phaseElapsed: 0,
  holdElapsed: 0,
  lastUpdateAt: 0,
  totalFrames: 0,
  visibleFrames: 0,
  samples: createSampleStore()
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function rms(points) {
  if (points.length < 8) return 0;
  const centerX = mean(points.map((point) => point.x));
  const centerY = mean(points.map((point) => point.y));
  return Math.sqrt(mean(points.map((point) => (
    (point.x - centerX) ** 2 + (point.y - centerY) ** 2
  ))));
}

function resetCounters() {
  return { camera: 0, hand: 0, handMs: 0 };
}

function createSampleStore() {
  return {
    steadyRaw: [[], []],
    steadyVisual: [[], []],
    scale: [[], []],
    movementError: [[], []],
    crossAxisError: [[], []]
  };
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    return profile?.version === 1 ? profile : null;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  loadedProfile = profile;
}

function applyLoadedProfile() {
  if (!loadedProfile) return;
  core.applyCalibration?.(loadedProfile);
}

function refreshProfileUi() {
  if (!loadedProfile) {
    profileBadge.textContent = 'Sem perfil';
    activeProfile.textContent = 'Padrão';
    profileDate.textContent = 'ainda não calibrado';
    return;
  }
  profileBadge.textContent = `Perfil ${loadedProfile.score}/100`;
  activeProfile.textContent = loadedProfile.tier;
  profileDate.textContent = new Date(loadedProfile.createdAt).toLocaleDateString('pt-BR');
}

function orderedVisibleHands() {
  const hands = latestSnapshot?.hands?.filter((hand) => hand.visible && hand.visual) ?? [];
  return hands.sort((a, b) => a.visual.x - b.visual.x).slice(0, 2);
}

function phaseTargets(phase, elapsed) {
  const progress = clamp(elapsed / Math.max(1, phase.duration));
  if (phase.id === 'horizontal') {
    const wave = 0.5 - 0.5 * Math.cos(progress * Math.PI * 2);
    return [
      { x: 0.20 + wave * 0.24, y: 0.58 },
      { x: 0.80 - wave * 0.24, y: 0.58 }
    ];
  }
  if (phase.id === 'vertical') {
    const wave = 0.5 - 0.5 * Math.cos(progress * Math.PI * 2);
    const y = 0.34 + wave * 0.38;
    return [{ x: 0.30, y }, { x: 0.70, y }];
  }
  if (phase.id === 'corners') {
    const pathLeft = [
      { x: 0.22, y: 0.38 }, { x: 0.42, y: 0.38 },
      { x: 0.42, y: 0.72 }, { x: 0.22, y: 0.72 },
      { x: 0.22, y: 0.38 }
    ];
    const pathRight = pathLeft.map((point) => ({ x: 1 - point.x, y: point.y }));
    return [interpolatePath(pathLeft, progress), interpolatePath(pathRight, progress)];
  }
  return [{ x: 0.30, y: 0.58 }, { x: 0.70, y: 0.58 }];
}

function interpolatePath(points, progress) {
  const scaled = clamp(progress) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const amount = scaled - index;
  return {
    x: points[index].x + (points[index + 1].x - points[index].x) * amount,
    y: points[index].y + (points[index + 1].y - points[index].y) * amount
  };
}

function setTargets(targets, hits = [false, false]) {
  targetElements.forEach((element, index) => {
    const target = targets[index];
    element.style.left = `${target.x * 100}%`;
    element.style.top = `${target.y * 100}%`;
    element.classList.toggle('hit', Boolean(hits[index]));
  });
}

function setPhase(index) {
  session.phaseIndex = index;
  session.phaseElapsed = 0;
  session.holdElapsed = 0;
  session.lastUpdateAt = performance.now();
  const phase = PHASES[index];
  guideStep.textContent = `ETAPA ${index + 1} DE ${PHASES.length}`;
  guideTitle.textContent = phase.title;
  guideText.textContent = phase.text;
  calibrationInstruction.textContent = phase.text;
  phaseElements.forEach((element, elementIndex) => {
    element.classList.toggle('active', elementIndex === index);
    element.classList.toggle('done', elementIndex < index);
  });
  setTargets(phaseTargets(phase, 0));
}

function startCalibration() {
  core.reset();
  applyLoadedProfile();
  session.active = true;
  session.phaseIndex = -1;
  session.phaseElapsed = 0;
  session.holdElapsed = 0;
  session.totalFrames = 0;
  session.visibleFrames = 0;
  session.samples = createSampleStore();
  resultPanel.classList.add('hidden');
  guideLayer.classList.remove('hidden');
  calibrateButton.disabled = true;
  calibrateButton.textContent = 'Calibrando…';
  setPhase(0);
}

function stopCalibration(message) {
  session.active = false;
  guideLayer.classList.add('hidden');
  calibrateButton.disabled = false;
  calibrateButton.textContent = 'Começar novamente';
  calibrationInstruction.textContent = message;
  phaseElements.forEach((element) => element.classList.remove('active'));
}

function recordSamples(phase, hands, targets) {
  hands.forEach((hand, index) => {
    if (phase.id === 'steady') {
      session.samples.steadyRaw[index].push({ ...hand.raw });
      session.samples.steadyVisual[index].push({ ...hand.visual });
      session.samples.scale[index].push(hand.scale);
      return;
    }
    session.samples.movementError[index].push(distance(hand.visual, targets[index]));
    if (phase.id === 'horizontal') {
      session.samples.crossAxisError[index].push(Math.abs(hand.visual.y - targets[index].y));
    } else if (phase.id === 'vertical') {
      session.samples.crossAxisError[index].push(Math.abs(hand.visual.x - targets[index].x));
    }
  });
}

function updateCalibration(now) {
  if (!session.active) return;
  const dt = session.lastUpdateAt ? clamp(now - session.lastUpdateAt, 0, 80) : 16;
  session.lastUpdateAt = now;
  const phase = PHASES[session.phaseIndex];
  const hands = orderedVisibleHands();
  const pairVisible = hands.length === 2;
  session.totalFrames += 1;
  if (pairVisible) session.visibleFrames += 1;

  const targets = phaseTargets(phase, session.phaseElapsed);
  const hits = pairVisible ? hands.map((hand, index) => distance(hand.visual, targets[index]) <= TARGET_RADIUS) : [false, false];
  setTargets(targets, hits);

  if (!pairVisible) {
    guideText.textContent = 'Mostre as duas mãos para continuar. A etapa está pausada.';
    calibrationInstruction.textContent = guideText.textContent;
    return;
  }

  guideText.textContent = phase.text;
  calibrationInstruction.textContent = phase.text;

  if (phase.id === 'align') {
    session.holdElapsed = hits.every(Boolean) ? session.holdElapsed + dt : 0;
    const progress = clamp(session.holdElapsed / ALIGN_HOLD_MS);
    updateProgress(progress);
    if (progress >= 1) setPhase(1);
    return;
  }

  if (phase.id === 'steady' && !hits.every(Boolean)) {
    guideText.textContent = 'Volte para dentro dos círculos. A medição está pausada.';
    calibrationInstruction.textContent = guideText.textContent;
    return;
  }

  session.phaseElapsed += dt;
  recordSamples(phase, hands, targets);
  const progress = clamp(session.phaseElapsed / phase.duration);
  updateProgress(progress);

  if (progress < 1) return;
  if (session.phaseIndex < PHASES.length - 1) {
    setPhase(session.phaseIndex + 1);
  } else {
    finishCalibration();
  }
}

function updateProgress(phaseProgress) {
  const overall = (session.phaseIndex + phaseProgress) / PHASES.length;
  guideProgress.style.width = `${Math.round(phaseProgress * 100)}%`;
  calibrationProgress.style.width = `${Math.round(overall * 100)}%`;
}

function makeHandProfile(index) {
  const rawJitter = rms(session.samples.steadyRaw[index]);
  const visualJitter = rms(session.samples.steadyVisual[index]);
  const scale = median(session.samples.scale[index]);
  const movementError = mean(session.samples.movementError[index]);
  const crossAxisError = mean(session.samples.crossAxisError[index]);
  const restRadius = clamp(Math.max(visualJitter * 3.2, scale * 0.011), 0.0012, 0.018);
  const relativeNoise = scale ? rawJitter / scale : 0.02;
  return {
    rawJitter,
    visualJitter,
    scale,
    movementError,
    crossAxisError,
    restRadius,
    minCutoff: clamp(1.55 - relativeNoise * 5.5, 0.85, 1.55),
    beta: clamp(0.14 + movementError * 0.9, 0.14, 0.28)
  };
}

function finishCalibration() {
  const hands = [makeHandProfile(0), makeHandProfile(1)];
  const continuity = session.totalFrames ? session.visibleFrames / session.totalFrames : 0;
  const averageJitter = mean(hands.map((hand) => hand.visualJitter));
  const averageError = mean(hands.map((hand) => hand.movementError));
  const width = Math.max(1, stage.clientWidth);
  const jitterPx = averageJitter * width;
  const errorPx = averageError * width;
  const stabilityScore = clamp(100 - jitterPx * 6, 0, 100);
  const accuracyScore = clamp(100 - errorPx * 1.05, 0, 100);
  const continuityScore = clamp(continuity * 100, 0, 100);
  const performanceScore = clamp((measuredRate / 24) * 100, 0, 100);
  const score = Math.round(
    stabilityScore * 0.32
    + accuracyScore * 0.30
    + continuityScore * 0.23
    + performanceScore * 0.15
  );
  const tier = score >= 82 ? 'Excelente' : score >= 68 ? 'Boa' : score >= 52 ? 'Utilizável' : 'Precisa de ajustes';
  const profile = {
    version: 1,
    createdAt: Date.now(),
    score,
    tier,
    hands,
    device: {
      fps: measuredRate,
      inferenceMs: measuredInferenceMs,
      width: video.videoWidth,
      height: video.videoHeight
    },
    metrics: {
      jitterPx,
      errorPx,
      continuity
    }
  };
  saveProfile(profile);
  core.applyCalibration?.(profile);
  showResult(profile);
  stopCalibration('Calibração concluída e salva neste aparelho.');
}

function showResult(profile) {
  resultPanel.classList.remove('hidden');
  resultTitle.textContent = `Rastreamento ${profile.tier.toLowerCase()}`;
  scoreBadge.textContent = `${profile.score}/100`;
  stabilityResult.textContent = `${profile.metrics.jitterPx.toFixed(1)} px`;
  accuracyResult.textContent = `${profile.metrics.errorPx.toFixed(1)} px`;
  continuityResult.textContent = `${Math.round(profile.metrics.continuity * 100)}%`;
  performanceResult.textContent = `${profile.device.fps.toFixed(1)}/s`;
  resultMessage.textContent = profile.score >= 68
    ? 'O perfil foi aplicado ao núcleo deste aparelho. Você pode repetir para comparar outra posição ou iluminação.'
    : 'O perfil foi salvo, mas a iluminação, distância ou desempenho ainda limitaram a precisão. Repita com o celular apoiado e mais luz.';
  resultCode.textContent = `MX1-${profile.score}-${Math.round(profile.device.fps)}-${Math.round(profile.metrics.jitterPx * 10)}-${Math.round(profile.metrics.errorPx)}`;
  refreshProfileUi();
}

function canvasTransform() {
  const sourceWidth = Math.max(1, video.videoWidth || 640);
  const sourceHeight = Math.max(1, video.videoHeight || 480);
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { width, height, x: (canvas.width - width) / 2, y: (canvas.height - height) / 2 };
}

function canvasPoint(point) {
  const transform = canvasTransform();
  return {
    x: transform.x + point.x * transform.width,
    y: transform.y + point.y * transform.height
  };
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function drawPoint(point, color, radius) {
  if (!point) return;
  const screen = canvasPoint(point);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawSnapshot() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const hand of latestSnapshot?.hands ?? []) {
    if (!hand.visible) continue;
    drawPoint(hand.raw, '#ff5d8f', Math.max(10, canvas.width / 70));
    drawPoint(hand.collision, '#66c7ff', Math.max(7, canvas.width / 92));
    drawPoint(hand.visual, '#36e2a5', Math.max(8, canvas.width / 82));
  }
}

async function createHandTask() {
  statusText.textContent = 'Carregando rastreamento…';
  statusDetail.textContent = 'A primeira abertura pode levar alguns segundos.';
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const create = (delegate) => HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.48,
    minHandPresenceConfidence: 0.48,
    minTrackingConfidence: 0.58
  });
  try {
    return await create('GPU');
  } catch (error) {
    console.warn('GPU indisponível; usando CPU.', error);
    return create('CPU');
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('A câmera exige HTTPS e um navegador compatível.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 60, max: 60 }
    }
  });
  video.srcObject = stream;
  await video.play();
  const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
  resolutionValue.textContent = settings.width && settings.height
    ? `${settings.width}×${settings.height}`
    : `${video.videoWidth}×${video.videoHeight}`;
}

function updateRates(now) {
  if (now - rateStartedAt < 1000) return;
  const seconds = (now - rateStartedAt) / 1000;
  measuredRate = counters.hand / seconds;
  measuredInferenceMs = counters.hand ? counters.handMs / counters.hand : 0;
  cameraRate.textContent = `${Math.round(counters.camera / seconds)} fps`;
  handRate.textContent = `${measuredRate.toFixed(1)}/s`;
  handTime.textContent = measuredInferenceMs ? `${measuredInferenceMs.toFixed(1)} ms` : '— ms';
  counters = resetCounters();
  rateStartedAt = now;
}

function processFrame(now, metadata) {
  if (!running) return;
  const mediaTime = metadata?.mediaTime ?? video.currentTime;
  if (mediaTime !== lastMediaTime && video.readyState >= 2) {
    lastMediaTime = mediaTime;
    counters.camera += 1;
    const startedAt = performance.now();
    const result = handTask.detectForVideo(video, Math.round(now));
    const processingMs = performance.now() - startedAt;
    counters.hand += 1;
    counters.handMs += processingMs;
    latestSnapshot = core.ingest(result, now);
    const visibleCount = latestSnapshot.hands.filter((hand) => hand.visible).length;
    visibleHands.textContent = `${visibleCount}/2`;
    drawSnapshot();
    updateCalibration(now);
    updateRates(now);
  }
  schedule();
}

function schedule() {
  if (!running) return;
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(processFrame);
  } else {
    requestAnimationFrame((now) => processFrame(now, { mediaTime: video.currentTime }));
  }
}

function resetTracking() {
  core.reset();
  applyLoadedProfile();
  latestSnapshot = null;
  if (session.active) stopCalibration('Calibração interrompida. Comece novamente.');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.textContent = 'Carregando…';
  try {
    handTask = await createHandTask();
    await openCamera();
    applyLoadedProfile();
    running = true;
    startPanel.classList.add('hidden');
    statusText.textContent = 'Rastreamento ativo';
    statusDetail.textContent = 'Posicione as duas mãos para iniciar a calibração.';
    calibrationInstruction.textContent = 'Toque em “Começar calibração” e siga os círculos.';
    calibrateButton.disabled = false;
    schedule();
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Não foi possível iniciar';
    statusDetail.textContent = error.message;
    startButton.disabled = false;
    startButton.textContent = 'Tentar novamente';
  }
});

calibrateButton.addEventListener('click', startCalibration);
resetButton.addEventListener('click', resetTracking);
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultCode.textContent);
    copyButton.textContent = 'Copiado!';
    setTimeout(() => { copyButton.textContent = 'Copiar resultado'; }, 1200);
  } catch {
    copyButton.textContent = 'Selecione o código acima';
  }
});
window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('pagehide', () => {
  running = false;
  for (const track of video.srcObject?.getTracks?.() ?? []) track.stop();
  handTask?.close?.();
});

refreshProfileUi();
if (loadedProfile) showResult(loadedProfile);
