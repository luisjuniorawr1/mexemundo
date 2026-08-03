import { RealtimeClient } from './realtime.js';
import {
  FilesetResolver,
  PoseLandmarker
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const socket = new RealtimeClient();
const roomInput = document.querySelector('#roomInput');
const startButton = document.querySelector('#startButton');
const joinPanel = document.querySelector('#joinPanel');
const cameraPanel = document.querySelector('#cameraPanel');
const video = document.querySelector('#camera');
const overlay = document.querySelector('#overlay');
const sensorBadge = document.querySelector('#sensorBadge');
const trackingStatus = document.querySelector('#trackingStatus');
const processingValue = document.querySelector('#processingValue');
const sendValue = document.querySelector('#sendValue');
const roomValue = document.querySelector('#roomValue');
const poseQuality = document.querySelector('#poseQuality');

const POINTS = {
  left: 15,
  right: 16,
  leftShoulder: 11,
  rightShoulder: 12
};
const POINT_NAMES = Object.keys(POINTS);
const WRISTS = new Set(['left', 'right']);
const filters = new Map();

overlay.style.display = 'none';

let landmarker;
let running = false;
let room = '';
let lastVideoTime = -1;
let lastPoseAt = 0;
let missingPoseSentAt = 0;
let sentCounter = 0;
let sentWindow = performance.now();
let sequence = 0;
let previousFrameAt = 0;
let transportMode = 'relay';

const queryRoom = new URLSearchParams(location.search).get('sala');
if (queryRoom) roomInput.value = queryRoom.toUpperCase().slice(0, 6);

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function compact(value) {
  return Math.round(value * 10000) / 10000;
}

class StableTurboPointFilter {
  constructor({ wrist = false } = {}) {
    this.wrist = wrist;
    this.ready = false;
    this.rawX = 0.5;
    this.rawY = 0.5;
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.time = 0;
  }

  reset() {
    this.ready = false;
    this.vx = 0;
    this.vy = 0;
  }

  filter(rawX, rawY, now) {
    if (!this.ready) {
      this.ready = true;
      this.rawX = rawX;
      this.rawY = rawY;
      this.x = rawX;
      this.y = rawY;
      this.time = now;
      return this.output();
    }

    const dt = clamp((now - this.time) / 1000, 1 / 120, 0.09);
    const rawVx = (rawX - this.rawX) / dt;
    const rawVy = (rawY - this.rawY) / dt;
    const velocityBlend = this.wrist ? 0.38 : 0.24;
    this.vx += (rawVx - this.vx) * velocityBlend;
    this.vy += (rawVy - this.vy) * velocityBlend;

    const dx = rawX - this.x;
    const dy = rawY - this.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(this.vx, this.vy);

    let deadZone;
    let alpha;

    if (this.wrist) {
      const movement = clamp((speed - 0.07) / 0.95);
      const displacement = clamp(distance / 0.045);
      const responsiveness = Math.max(movement, displacement);

      deadZone = speed < 0.12 ? 0.0032 : speed < 0.35 ? 0.0016 : 0.0007;
      alpha = 0.18 + responsiveness * 0.76;

      if (distance > 0.075 || speed > 1.35) alpha = 1;
    } else {
      deadZone = 0.0016;
      alpha = clamp(0.20 + distance * 5, 0.20, 0.72);
    }

    if (distance > deadZone) {
      const previousX = this.x;
      const previousY = this.y;
      this.x += dx * alpha;
      this.y += dy * alpha;

      const filteredVx = (this.x - previousX) / dt;
      const filteredVy = (this.y - previousY) / dt;
      this.vx += (filteredVx - this.vx) * 0.35;
      this.vy += (filteredVy - this.vy) * 0.35;
    } else {
      this.vx *= 0.72;
      this.vy *= 0.72;
    }

    this.rawX = rawX;
    this.rawY = rawY;
    this.time = now;
    return this.output();
  }

  output() {
    return {
      x: compact(clamp(this.x)),
      y: compact(clamp(this.y)),
      vx: compact(clamp(this.vx, -4, 4)),
      vy: compact(clamp(this.vy, -4, 4))
    };
  }
}

function getFilter(name) {
  if (!filters.has(name)) filters.set(name, new StableTurboPointFilter({ wrist: WRISTS.has(name) }));
  return filters.get(name);
}

function resetFilters() {
  for (const filter of filters.values()) filter.reset();
}

function filteredPoint(name, landmark, now) {
  const filter = getFilter(name);
  const visible = (landmark?.visibility ?? 0) > 0.3;
  if (!visible) {
    const last = filter.output();
    return { ...last, vx: 0, vy: 0, visible: false };
  }
  return {
    ...filter.filter(clamp(1 - landmark.x), clamp(landmark.y), now),
    visible: true
  };
}

async function createLandmarker() {
  trackingStatus.textContent = 'Ativando Super Turbo estável…';
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
      width: { ideal: 360 },
      height: { ideal: 640 },
      aspectRatio: { ideal: 9 / 16 },
      frameRate: { ideal: 60, max: 60 },
      resizeMode: 'crop-and-scale'
    }
  });

  const [track] = stream.getVideoTracks();
  if (track && 'contentHint' in track) track.contentHint = 'motion';
  video.srcObject = stream;
  await video.play();
}

function averageVisibility(pose) {
  return POINT_NAMES.reduce((sum, name) => sum + (pose[POINTS[name]]?.visibility ?? 0), 0) / POINT_NAMES.length;
}

function emitPose(pose, detected, now, processingMs) {
  const sourceIntervalMs = previousFrameAt ? now - previousFrameAt : 0;
  previousFrameAt = now;
  const hidden = (x, y) => ({ x, y, vx: 0, vy: 0, visible: false });
  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now(),
    processingMs: Math.round(processingMs),
    sourceIntervalMs: Math.round(sourceIntervalMs),
    left: detected ? filteredPoint('left', pose[POINTS.left], now) : hidden(0.35, 0.55),
    right: detected ? filteredPoint('right', pose[POINTS.right], now) : hidden(0.65, 0.55),
    leftShoulder: detected ? filteredPoint('leftShoulder', pose[POINTS.leftShoulder], now) : hidden(0.44, 0.35),
    rightShoulder: detected ? filteredPoint('rightShoulder', pose[POINTS.rightShoulder], now) : hidden(0.56, 0.35)
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
  const mediaTime = metadata?.mediaTime ?? video.currentTime;

  if (mediaTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = mediaTime;
    const startedAt = performance.now();
    const result = landmarker.detectForVideo(video, startedAt);
    const processing = performance.now() - startedAt;
    const pose = result.landmarks?.[0];
    const current = performance.now();
    processingValue.textContent = `${Math.round(processing)} ms`;

    if (pose) {
      lastPoseAt = current;
      const quality = averageVisibility(pose);
      poseQuality.textContent = `${Math.round(quality * 100)}%`;
      poseQuality.className = `quality-badge ${quality > 0.7 ? 'good' : quality > 0.48 ? 'medium' : 'low'}`;

      const wristsVisible = (pose[POINTS.left]?.visibility ?? 0) > 0.3
        && (pose[POINTS.right]?.visibility ?? 0) > 0.3;
      trackingStatus.textContent = wristsVisible
        ? `${transportMode === 'direct' ? 'Super Turbo estável direto' : 'Super Turbo estável via servidor'} • olhe para a TV!`
        : 'Mostre as duas mãos para a câmera.';
      emitPose(pose, true, current, processing);
    } else {
      poseQuality.textContent = '0%';
      poseQuality.className = 'quality-badge low';
      trackingStatus.textContent = 'Afaste-se até aparecer a parte superior do corpo.';
      if (current - lastPoseAt > 250) resetFilters();
      if (current - missingPoseSentAt >= 100) {
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

socket.on('transport', ({ mode }) => {
  transportMode = mode;
  if (!running) return;
  sensorBadge.textContent = mode === 'direct' ? `TURBO ESTÁVEL • ${room}` : `Servidor • ${room}`;
  sensorBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

socket.on('room-status', ({ tv }) => {
  if (!running) return;
  sensorBadge.textContent = tv
    ? `${transportMode === 'direct' ? 'TURBO ESTÁVEL' : 'TV conectada'} • ${room}`
    : `Aguardando TV • ${room}`;
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
  startButton.textContent = 'Preparando Turbo Estável…';

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
