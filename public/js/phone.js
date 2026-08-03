import { RealtimeClient } from './realtime.js';
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const socket = new RealtimeClient();
const roomInput = document.querySelector('#roomInput');
const startButton = document.querySelector('#startButton');
const joinPanel = document.querySelector('#joinPanel');
const cameraPanel = document.querySelector('#cameraPanel');
const video = document.querySelector('#camera');
const overlay = document.querySelector('#overlay');
const ctx = overlay.getContext('2d');
const sensorBadge = document.querySelector('#sensorBadge');
const trackingStatus = document.querySelector('#trackingStatus');
const processingValue = document.querySelector('#processingValue');
const sendValue = document.querySelector('#sendValue');
const roomValue = document.querySelector('#roomValue');
const poseQuality = document.querySelector('#poseQuality');

const POINTS = {
  left: 15,
  right: 16,
  leftElbow: 13,
  rightElbow: 14,
  leftShoulder: 11,
  rightShoulder: 12,
  nose: 0
};
const WRISTS = new Set(['left', 'right']);
const drawingUtils = new DrawingUtils(ctx);
const pointFilters = new Map();

let landmarker;
let running = false;
let room = '';
let lastVideoTime = -1;
let lastOverlayAt = 0;
let lastPoseAt = 0;
let sentCounter = 0;
let sentWindow = performance.now();
let missingPoseSentAt = 0;
let sequence = 0;
let previousFrameAt = 0;

const queryRoom = new URLSearchParams(location.search).get('sala');
if (queryRoom) roomInput.value = queryRoom.toUpperCase().slice(0, 6);

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function alphaFor(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class OneEuroAxis {
  constructor({ minCutoff, beta, dCutoff = 1 }) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.value = null;
    this.raw = null;
    this.derivative = 0;
    this.time = null;
  }

  reset() {
    this.value = null;
    this.raw = null;
    this.derivative = 0;
    this.time = null;
  }

  filter(raw, timeMs) {
    if (this.time === null) {
      this.value = raw;
      this.raw = raw;
      this.time = timeMs;
      return { value: raw, velocity: 0 };
    }

    const dt = clamp((timeMs - this.time) / 1000, 1 / 120, 0.12);
    const rawDerivative = (raw - this.raw) / dt;
    const derivativeAlpha = alphaFor(this.dCutoff, dt);
    this.derivative += (rawDerivative - this.derivative) * derivativeAlpha;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const valueAlpha = alphaFor(cutoff, dt);
    this.value += (raw - this.value) * valueAlpha;
    this.raw = raw;
    this.time = timeMs;

    return {
      value: this.value,
      velocity: clamp(this.derivative, -4, 4)
    };
  }
}

class PointFilter {
  constructor(config) {
    this.x = new OneEuroAxis(config);
    this.y = new OneEuroAxis(config);
    this.last = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }

  filter(rawX, rawY, timeMs) {
    const fx = this.x.filter(rawX, timeMs);
    const fy = this.y.filter(rawY, timeMs);
    this.last = { x: fx.value, y: fy.value, vx: fx.velocity, vy: fy.velocity };
    return this.last;
  }
}

function getPointFilter(name) {
  if (!pointFilters.has(name)) {
    const config = WRISTS.has(name)
      ? { minCutoff: 1.15, beta: 0.34, dCutoff: 1.2 }
      : { minCutoff: 0.82, beta: 0.16, dCutoff: 1.0 };
    pointFilters.set(name, new PointFilter(config));
  }
  return pointFilters.get(name);
}

function resetFilters() {
  for (const filter of pointFilters.values()) filter.reset();
}

function compact(value) {
  return Math.round(value * 10000) / 10000;
}

function filteredLandmark(name, landmark, now) {
  const visible = (landmark?.visibility ?? 0) > 0.32;
  const filter = getPointFilter(name);

  if (!visible) {
    return {
      x: compact(filter.last.x),
      y: compact(filter.last.y),
      vx: 0,
      vy: 0,
      visible: false
    };
  }

  const filtered = filter.filter(clamp(1 - landmark.x), clamp(landmark.y), now);
  return {
    x: compact(clamp(filtered.x)),
    y: compact(clamp(filtered.y)),
    vx: compact(filtered.vx),
    vy: compact(filtered.vy),
    visible: true
  };
}

async function createLandmarker() {
  trackingStatus.textContent = 'Carregando inteligência de movimento…';
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm'
  );

  const options = {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.55,
    outputSegmentationMasks: false
  };

  try {
    return await PoseLandmarker.createFromOptions(vision, options);
  } catch (error) {
    console.warn('GPU indisponível; tentando CPU.', error);
    options.baseOptions.delegate = 'CPU';
    return PoseLandmarker.createFromOptions(vision, options);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador não liberou acesso à câmera. Abra usando HTTPS.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 480 },
      height: { ideal: 640 },
      frameRate: { ideal: 30, max: 30 }
    }
  });

  video.srcObject = stream;
  await video.play();
}

function fitCanvas() {
  const width = video.videoWidth || 480;
  const height = video.videoHeight || 640;
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
}

function averageVisibility(pose) {
  const important = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
  const total = important.reduce((sum, index) => sum + (pose[index]?.visibility ?? 0), 0);
  return total / important.length;
}

function drawPose(pose) {
  drawingUtils.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS, {
    color: 'rgba(255,255,255,.62)',
    lineWidth: 3
  });
  drawingUtils.drawLandmarks(pose, {
    color: '#ffcf4a',
    fillColor: '#6938ef',
    radius: 3,
    lineWidth: 1
  });
}

function emitPose(pose, detected, now, processingMs) {
  const sourceIntervalMs = previousFrameAt ? now - previousFrameAt : 0;
  previousFrameAt = now;
  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now(),
    processingMs: Math.round(processingMs),
    sourceIntervalMs: Math.round(sourceIntervalMs),
    left: detected ? filteredLandmark('left', pose[POINTS.left], now) : { x: 0.35, y: 0.55, vx: 0, vy: 0, visible: false },
    right: detected ? filteredLandmark('right', pose[POINTS.right], now) : { x: 0.65, y: 0.55, vx: 0, vy: 0, visible: false },
    leftElbow: detected ? filteredLandmark('leftElbow', pose[POINTS.leftElbow], now) : { x: 0.4, y: 0.48, vx: 0, vy: 0, visible: false },
    rightElbow: detected ? filteredLandmark('rightElbow', pose[POINTS.rightElbow], now) : { x: 0.6, y: 0.48, vx: 0, vy: 0, visible: false },
    leftShoulder: detected ? filteredLandmark('leftShoulder', pose[POINTS.leftShoulder], now) : { x: 0.44, y: 0.35, vx: 0, vy: 0, visible: false },
    rightShoulder: detected ? filteredLandmark('rightShoulder', pose[POINTS.rightShoulder], now) : { x: 0.56, y: 0.35, vx: 0, vy: 0, visible: false },
    nose: detected ? filteredLandmark('nose', pose[POINTS.nose], now) : { x: 0.5, y: 0.2, vx: 0, vy: 0, visible: false }
  };

  if (socket.emit('pose', payload)) sentCounter += 1;
}

function schedulePrediction() {
  if (!running) return;
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(processFrame);
  } else {
    requestAnimationFrame((now) => processFrame(now, { mediaTime: video.currentTime }));
  }
}

function processFrame(now, metadata) {
  if (!running) return;
  fitCanvas();

  const mediaTime = metadata?.mediaTime ?? video.currentTime;
  if (mediaTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = mediaTime;
    const startedAt = performance.now();
    const result = landmarker.detectForVideo(video, startedAt);
    const processing = performance.now() - startedAt;
    processingValue.textContent = `${Math.round(processing)} ms`;

    const pose = result.landmarks?.[0];
    const current = performance.now();

    if (pose) {
      lastPoseAt = current;
      const quality = averageVisibility(pose);
      const qualityPercent = Math.round(quality * 100);
      poseQuality.textContent = `${qualityPercent}%`;
      poseQuality.className = `quality-badge ${quality > 0.72 ? 'good' : quality > 0.5 ? 'medium' : 'low'}`;

      const wristsVisible = (pose[15]?.visibility ?? 0) > 0.32 && (pose[16]?.visibility ?? 0) > 0.32;
      trackingStatus.textContent = wristsVisible
        ? 'Movimento estabilizado. Olhe para a TV!'
        : 'Mostre as duas mãos para a câmera.';

      emitPose(pose, true, current, processing);

      // O desenho é apenas diagnóstico e não precisa disputar 30 FPS com a IA.
      if (current - lastOverlayAt >= 100) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        drawPose(pose);
        lastOverlayAt = current;
      }
    } else {
      poseQuality.textContent = '0%';
      poseQuality.className = 'quality-badge low';
      trackingStatus.textContent = 'Afaste-se até aparecer o corpo inteiro.';
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      if (current - lastPoseAt > 350) resetFilters();
      if (current - missingPoseSentAt >= 120) {
        emitPose(null, false, current, processing);
        missingPoseSentAt = current;
      }
    }

    if (current - sentWindow >= 1000) {
      sendValue.textContent = `${sentCounter}/s`;
      sentCounter = 0;
      sentWindow = current;
    }
  }

  schedulePrediction();
}

socket.on('room-status', ({ tv }) => {
  if (!running) return;
  sensorBadge.textContent = tv ? `TV conectada • ${room}` : `Aguardando TV • ${room}`;
  sensorBadge.className = `badge ${tv ? 'online' : 'waiting'}`;
});

socket.on('disconnect', () => {
  if (!running) return;
  sensorBadge.textContent = 'Servidor desconectado';
  sensorBadge.className = 'badge waiting';
});

startButton.addEventListener('click', async () => {
  room = roomInput.value.trim();
  if (room.length < 4) {
    roomInput.focus();
    roomInput.classList.add('shake');
    setTimeout(() => roomInput.classList.remove('shake'), 450);
    return;
  }

  startButton.disabled = true;
  startButton.textContent = 'Preparando…';

  try {
    await socket.connect();
    const joinResult = await socket.request('join', { room, role: 'phone' });
    if (!joinResult?.ok) throw new Error(joinResult?.error || 'Não foi possível entrar na sala.');

    landmarker = await createLandmarker();
    await startCamera();

    joinPanel.classList.add('hidden');
    cameraPanel.classList.remove('hidden');
    roomValue.textContent = room;
    sensorBadge.textContent = joinResult.status?.tv ? `TV conectada • ${room}` : `Aguardando TV • ${room}`;
    sensorBadge.className = `badge ${joinResult.status?.tv ? 'online' : 'waiting'}`;
    running = true;
    schedulePrediction();
  } catch (error) {
    console.error(error);
    alert(`Falha ao iniciar: ${error.message}`);
    startButton.disabled = false;
    startButton.textContent = 'Conectar e abrir câmera';
  }
});
