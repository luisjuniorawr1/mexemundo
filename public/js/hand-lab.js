import { FilesetResolver, HandLandmarker, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const PALM = [0, 5, 9, 13, 17];
const MEASURE_MS = 5000;
const HISTORY_MS = 2000;

const $ = (selector) => document.querySelector(selector);
const video = $('#camera');
const canvas = $('#overlay');
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
const stage = $('#cameraStage');
const startPanel = $('#startPanel');
const startButton = $('#startButton');
const clearButton = $('#clearButton');
const measureButton = $('#measureButton');
const modeSelect = $('#scheduleMode');
const statusText = $('#statusText');
const statusDetail = $('#statusDetail');
const cameraRate = $('#cameraRate');
const resolutionValue = $('#resolutionValue');
const handRate = $('#handRate');
const handTime = $('#handTime');
const poseRate = $('#poseRate');
const poseTime = $('#poseTime');
const combinedTime = $('#combinedTime');
const liveFields = {
  hand: [$('#liveHandLeft'), $('#liveHandRight')],
  stable: [$('#liveStableLeft'), $('#liveStableRight')],
  pose: [$('#livePoseLeft'), $('#livePoseRight')]
};
const measureInstruction = $('#measureInstruction');
const measureProgress = $('#measureProgress');
const measureFields = {
  hand: $('#measureHandResult'),
  stable: $('#measureStableResult'),
  pose: $('#measurePoseResult')
};

let handTask;
let poseTask;
let running = false;
let lastMediaTime = -1;
let frame = 0;
let rawHands = [null, null];
let stableHands = [null, null];
let poseWrists = [null, null];
let latestHandLandmarks = [];
let rateStartedAt = performance.now();
let counters = { camera: 0, hand: 0, pose: 0, handMs: 0, poseMs: 0 };
let lastDurations = { hand: 0, pose: 0 };

const history = {
  hand: [[], []],
  stable: [[], []],
  pose: [[], []]
};

const measurement = {
  waiting: false,
  active: false,
  startedAt: 0,
  samples: { hand: [[], []], stable: [[], []], pose: [[], []] }
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const validPair = (pair) => Boolean(pair[0] && pair[1]);

function coverTransform() {
  const sourceWidth = Math.max(1, video.videoWidth || 640);
  const sourceHeight = Math.max(1, video.videoHeight || 480);
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { width, height, x: (canvas.width - width) / 2, y: (canvas.height - height) / 2 };
}

function canvasPoint(point) {
  const transform = coverTransform();
  return {
    x: transform.x + point.x * transform.width,
    y: transform.y + point.y * transform.height
  };
}

function rms(points) {
  if (points.length < 6) return null;
  const transform = coverTransform();
  const centerX = mean(points.map((point) => point.x));
  const centerY = mean(points.map((point) => point.y));
  return Math.sqrt(mean(points.map((point) => {
    const dx = (point.x - centerX) * transform.width;
    const dy = (point.y - centerY) * transform.height;
    return dx * dx + dy * dy;
  })));
}

function formatPx(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} px` : '—';
}

function sortScreen(points) {
  const visible = points.filter(Boolean).sort((a, b) => a.x - b.x);
  return [visible[0] ?? null, visible[1] ?? null];
}

function palmCenter(landmarks) {
  const points = PALM.map((index) => landmarks[index]).filter(Boolean);
  if (!points.length) return null;
  return { x: 1 - mean(points.map((point) => point.x)), y: mean(points.map((point) => point.y)) };
}

function addHistory(type, pair, now) {
  for (let index = 0; index < 2; index += 1) {
    const point = pair[index];
    if (!point) continue;
    history[type][index].push({ ...point, at: now });
    while (history[type][index].length && now - history[type][index][0].at > HISTORY_MS) {
      history[type][index].shift();
    }
    if (measurement.active) measurement.samples[type][index].push({ ...point });
  }
}

class PalmFilter {
  constructor() { this.reset(); }
  reset() {
    this.ready = false;
    this.x = 0.5;
    this.y = 0.5;
    this.rawX = 0.5;
    this.rawY = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.at = 0;
  }
  update(point, now) {
    if (!point) return null;
    if (!this.ready) {
      Object.assign(this, { ready: true, x: point.x, y: point.y, rawX: point.x, rawY: point.y, at: now });
      return { x: this.x, y: this.y };
    }
    const dt = clamp((now - this.at) / 1000, 1 / 120, 0.1);
    this.vx += (((point.x - this.rawX) / dt) - this.vx) * 0.28;
    this.vy += (((point.y - this.rawY) / dt) - this.vy) * 0.28;
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(this.vx, this.vy);
    const deadZone = speed < 0.12 ? 0.0048 : speed < 0.34 ? 0.002 : 0.0007;
    if (distance > deadZone) {
      const response = Math.max(clamp((speed - 0.05) / 0.85), clamp(distance / 0.05));
      const alpha = distance > 0.065 || speed > 1.25 ? 1 : 0.13 + response * 0.82;
      this.x += dx * alpha;
      this.y += dy * alpha;
    } else {
      this.vx *= 0.65;
      this.vy *= 0.65;
    }
    Object.assign(this, { rawX: point.x, rawY: point.y, at: now });
    return { x: this.x, y: this.y };
  }
}

const filters = [new PalmFilter(), new PalmFilter()];

function handleHands(result, now) {
  latestHandLandmarks = (result.landmarks ?? []).map((landmarks) => landmarks.map((point) => ({ x: 1 - point.x, y: point.y })));
  rawHands = sortScreen((result.landmarks ?? []).map(palmCenter));
  stableHands = rawHands.map((point, index) => filters[index].update(point, now));
  addHistory('hand', rawHands, now);
  addHistory('stable', stableHands, now);
}

function handlePose(result, now) {
  const pose = result.landmarks?.[0];
  poseWrists = pose ? sortScreen([
    pose[15] ? { x: 1 - pose[15].x, y: pose[15].y } : null,
    pose[16] ? { x: 1 - pose[16].x, y: pose[16].y } : null
  ]) : [null, null];
  addHistory('pose', poseWrists, now);
}

async function createTask(create) {
  try { return await create('GPU'); }
  catch (error) {
    console.warn('GPU indisponível; usando CPU.', error);
    return create('CPU');
  }
}

async function loadModels() {
  statusText.textContent = 'Carregando MediaPipe…';
  statusDetail.textContent = 'A primeira abertura pode levar alguns segundos.';
  const vision = await FilesetResolver.forVisionTasks(WASM);
  handTask = await createTask((delegate) => HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.55
  }));
  poseTask = await createTask((delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.55,
    outputSegmentationMasks: false
  }));
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('A câmera exige HTTPS e navegador compatível.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 } }
  });
  video.srcObject = stream;
  await video.play();
  const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
  resolutionValue.textContent = settings.width && settings.height ? `${settings.width}×${settings.height}` : `${video.videoWidth}×${video.videoHeight}`;
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function drawPath(points, color, width) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = canvasPoint(point);
    if (index) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
  });
  ctx.stroke();
}

function drawPoint(point, color, label, radius) {
  if (!point) return;
  const screen = canvasPoint(point);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(18, canvas.width / 45)}px system-ui`;
  ctx.fillText(label, screen.x + radius + 5, screen.y - radius);
}

function drawHands() {
  ctx.fillStyle = 'rgba(255,255,255,.62)';
  for (const landmarks of latestHandLandmarks) {
    for (const point of landmarks) {
      const screen = canvasPoint(point);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, Math.max(2, canvas.width / 320), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function render(now) {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawHands();
  for (let index = 0; index < 2; index += 1) {
    drawPath(history.hand[index], 'rgba(255,93,143,.45)', Math.max(2, canvas.width / 350));
    drawPath(history.stable[index], 'rgba(54,226,165,.78)', Math.max(3, canvas.width / 270));
    drawPoint(poseWrists[index], '#ffd84d', 'Pose', Math.max(8, canvas.width / 76));
    drawPoint(rawHands[index], '#ff5d8f', 'Bruta', Math.max(10, canvas.width / 65));
    drawPoint(stableHands[index], '#36e2a5', 'Estável', Math.max(7, canvas.width / 82));
  }
  for (const type of Object.keys(liveFields)) {
    for (let index = 0; index < 2; index += 1) liveFields[type][index].textContent = formatPx(rms(history[type][index]));
  }
  updateMeasurement(now);
}

function resetSamples() {
  measurement.samples = { hand: [[], []], stable: [[], []], pose: [[], []] };
}

function startMeasurement() {
  resetSamples();
  measurement.waiting = true;
  measurement.active = false;
  measurement.startedAt = 0;
  measureProgress.style.width = '0%';
  measureInstruction.textContent = 'Mostre as duas mãos abertas e fique completamente parado.';
  Object.values(measureFields).forEach((field) => { field.textContent = '—'; });
  measureButton.disabled = true;
  measureButton.textContent = 'Preparando…';
}

function updateMeasurement(now) {
  if (!measurement.waiting && !measurement.active) return;
  if (!validPair(rawHands)) {
    if (measurement.active) resetSamples();
    measurement.active = false;
    measurement.startedAt = 0;
    measureProgress.style.width = '0%';
    measureInstruction.textContent = 'As duas mãos precisam permanecer visíveis. Posicione novamente.';
    return;
  }
  if (!measurement.active) {
    measurement.waiting = false;
    measurement.active = true;
    measurement.startedAt = now;
    resetSamples();
    measureInstruction.textContent = 'Medição em andamento: não mova as mãos.';
  }
  const progress = clamp((now - measurement.startedAt) / MEASURE_MS);
  measureProgress.style.width = `${Math.round(progress * 100)}%`;
  if (progress < 1) return;
  measurement.active = false;
  for (const type of Object.keys(measureFields)) {
    const values = measurement.samples[type].map(rms).filter(Number.isFinite);
    measureFields[type].textContent = formatPx(values.length ? mean(values) : null);
  }
  measureInstruction.textContent = 'Medição concluída. Repita em outro modo para comparar.';
  measureButton.disabled = false;
  measureButton.textContent = 'Medir novamente';
}

function updateRates(now) {
  if (now - rateStartedAt < 1000) return;
  const seconds = (now - rateStartedAt) / 1000;
  cameraRate.textContent = `${Math.round(counters.camera / seconds)} fps`;
  handRate.textContent = `${(counters.hand / seconds).toFixed(1)}/s`;
  poseRate.textContent = `${(counters.pose / seconds).toFixed(1)}/s`;
  handTime.textContent = counters.hand ? `${(counters.handMs / counters.hand).toFixed(1)} ms` : '— ms';
  poseTime.textContent = counters.pose ? `${(counters.poseMs / counters.pose).toFixed(1)} ms` : '— ms';
  const combined = lastDurations.hand + lastDurations.pose;
  combinedTime.textContent = combined ? `${combined.toFixed(1)} ms` : '— ms';
  counters = { camera: 0, hand: 0, pose: 0, handMs: 0, poseMs: 0 };
  rateStartedAt = now;
}

function runs(model) {
  const mode = modeSelect.value;
  if (mode === 'hand') return model === 'hand';
  if (mode === 'pose') return model === 'pose';
  return frame % 2 === (model === 'hand' ? 0 : 1);
}

function processFrame(now, metadata) {
  if (!running) return;
  const mediaTime = metadata?.mediaTime ?? video.currentTime;
  if (mediaTime !== lastMediaTime && video.readyState >= 2) {
    lastMediaTime = mediaTime;
    frame += 1;
    counters.camera += 1;
    const timestamp = Math.round(now);
    if (runs('hand')) {
      const started = performance.now();
      const result = handTask.detectForVideo(video, timestamp);
      lastDurations.hand = performance.now() - started;
      counters.hand += 1;
      counters.handMs += lastDurations.hand;
      handleHands(result, now);
    }
    if (runs('pose')) {
      const started = performance.now();
      const result = poseTask.detectForVideo(video, timestamp);
      lastDurations.pose = performance.now() - started;
      counters.pose += 1;
      counters.poseMs += lastDurations.pose;
      handlePose(result, now);
    }
    render(now);
    updateRates(now);
  }
  schedule();
}

function schedule() {
  if (!running) return;
  if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(processFrame);
  else requestAnimationFrame((now) => processFrame(now, { mediaTime: video.currentTime }));
}

function clearAll() {
  for (const type of Object.keys(history)) for (const series of history[type]) series.length = 0;
  filters.forEach((filter) => filter.reset());
  rawHands = [null, null];
  stableHands = [null, null];
  poseWrists = [null, null];
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.textContent = 'Carregando…';
  try {
    await loadModels();
    await openCamera();
    running = true;
    startPanel.classList.add('hidden');
    statusText.textContent = 'Laboratório ativo';
    statusDetail.textContent = 'Processamento local; nenhum vídeo é enviado.';
    measureInstruction.textContent = 'Posicione as duas mãos e inicie a medição.';
    measureButton.disabled = false;
    schedule();
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Não foi possível iniciar';
    statusDetail.textContent = error.message;
    startButton.disabled = false;
    startButton.textContent = 'Tentar novamente';
  }
});

clearButton.addEventListener('click', clearAll);
measureButton.addEventListener('click', startMeasurement);
modeSelect.addEventListener('change', () => {
  clearAll();
  lastDurations = { hand: 0, pose: 0 };
});
window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('pagehide', () => {
  running = false;
  for (const track of video.srcObject?.getTracks?.() ?? []) track.stop();
  handTask?.close?.();
  poseTask?.close?.();
});
