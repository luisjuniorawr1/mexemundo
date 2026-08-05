import { RealtimeClient } from './realtime.js';
import {
  HAND_SYSTEM_CONFIG,
  MEDIAPIPE_TASKS_VERSION
} from './hand-system-config.js';
import { createPoseFistGestureTracker } from './pose-gesture.js';
import { createSequentialHandBinder } from './sequential-hand-binder.js';

const CAMERA = HAND_SYSTEM_CONFIG.camera;
const DETECTOR = HAND_SYSTEM_CONFIG.detector;
const FILTER = HAND_SYSTEM_CONFIG.filter;
const SCHEDULER = HAND_SYSTEM_CONFIG.scheduler;
const SENSOR_CALIBRATION = HAND_SYSTEM_CONFIG.sensorCalibration;
const TASKS_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
let visionModulePromise = null;

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
const calibrationStep = document.querySelector('#sensorCalibrationStep');
const calibrationInstruction = document.querySelector('#sensorCalibrationInstruction');
const calibrationHint = document.querySelector('#sensorCalibrationHint');
const calibrationProgress = document.querySelector('#sensorCalibrationProgress');
const calibrationPanel = document.querySelector('#sensorCalibrationPanel');

const POINTS = {
  left: 15,
  right: 16,
  leftShoulder: 11,
  rightShoulder: 12
};
const POINT_NAMES = Object.keys(POINTS);
const WRISTS = new Set(['left', 'right']);
const filters = new Map();
const handBinder = createSequentialHandBinder();
const gestureTracker = createPoseFistGestureTracker();

overlay.style.display = 'none';

let landmarker = null;
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
let activeStream = null;
let lastCalibrationBroadcastAt = 0;
let lastCalibrationStatusKey = '';

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

function hiddenPoint(x, y) {
  return { x, y, vx: 0, vy: 0, visible: false };
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
    const velocityBlend = this.wrist
      ? FILTER.wristVelocityBlend
      : FILTER.bodyVelocityBlend;

    this.vx += (rawVx - this.vx) * velocityBlend;
    this.vy += (rawVy - this.vy) * velocityBlend;

    const dx = rawX - this.x;
    const dy = rawY - this.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(this.vx, this.vy);

    let deadZone;
    let alpha;

    if (this.wrist) {
      const movement = clamp(
        (speed - FILTER.wristMovementStart) / FILTER.wristMovementRange
      );
      const displacement = clamp(distance / FILTER.wristDisplacementRange);
      const responsiveness = Math.max(movement, displacement);

      deadZone = speed < FILTER.wristRestSpeed
        ? FILTER.wristRestDeadZone
        : speed < FILTER.wristMoveSpeed
          ? FILTER.wristMoveDeadZone
          : FILTER.wristFastDeadZone;
      alpha = FILTER.wristBaseAlpha + responsiveness * FILTER.wristAlphaRange;

      if (distance > FILTER.wristSnapDistance || speed > FILTER.wristSnapSpeed) {
        alpha = 1;
      }
    } else {
      deadZone = FILTER.bodyDeadZone;
      alpha = clamp(
        FILTER.bodyBaseAlpha + distance * FILTER.bodyDistanceGain,
        FILTER.bodyBaseAlpha,
        FILTER.bodyMaximumAlpha
      );
    }

    if (distance > deadZone) {
      const previousX = this.x;
      const previousY = this.y;
      this.x += dx * alpha;
      this.y += dy * alpha;

      const filteredVx = (this.x - previousX) / dt;
      const filteredVy = (this.y - previousY) / dt;
      this.vx += (filteredVx - this.vx) * FILTER.filteredVelocityBlend;
      this.vy += (filteredVy - this.vy) * FILTER.filteredVelocityBlend;
    } else {
      this.vx *= FILTER.idleVelocityDecay;
      this.vy *= FILTER.idleVelocityDecay;
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
  if (!filters.has(name)) {
    filters.set(name, new StableTurboPointFilter({ wrist: WRISTS.has(name) }));
  }
  return filters.get(name);
}

function resetOutputFilters() {
  for (const filter of filters.values()) filter.reset();
  gestureTracker.reset();
}

function restartSensorCalibration() {
  handBinder.reset();
  resetOutputFilters();
  lastCalibrationStatusKey = '';
  renderCalibration(handBinder.status());
  broadcastCalibration(handBinder.status(), performance.now(), true);
}

function filteredPoint(name, landmark, now) {
  const filter = getFilter(name);
  const visible = (landmark?.visibility ?? 0) > DETECTOR.pointVisibilityConfidence;
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
  trackingStatus.textContent = 'Ativando rastreamento rápido…';
  visionModulePromise ??= import(TASKS_MODULE);
  const { FilesetResolver, PoseLandmarker } = await visionModulePromise;
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: {
      modelAssetPath: DETECTOR.poseModel,
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: DETECTOR.poseDetectionConfidence,
    minPosePresenceConfidence: DETECTOR.posePresenceConfidence,
    minTrackingConfidence: DETECTOR.poseTrackingConfidence,
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

  activeStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: CAMERA.facingMode,
      width: { ideal: CAMERA.idealWidth },
      height: { ideal: CAMERA.idealHeight },
      aspectRatio: { ideal: CAMERA.idealAspectRatio },
      frameRate: { ideal: CAMERA.idealFrameRate, max: CAMERA.maximumFrameRate },
      resizeMode: CAMERA.resizeMode
    }
  });

  const [track] = activeStream.getVideoTracks();
  if (track && 'contentHint' in track) track.contentHint = 'motion';
  video.srcObject = activeStream;
  await video.play();
}

function averageVisibility(pose) {
  return POINT_NAMES.reduce(
    (sum, name) => sum + (pose[POINTS[name]]?.visibility ?? 0),
    0
  ) / POINT_NAMES.length;
}

function calibrationCopy(status) {
  if (status.ready) {
    return {
      step: 'SENSORES CONFIGURADOS',
      instruction: 'Direita e esquerda estão presas aos sensores configurados.',
      hint: 'Agora você pode jogar normalmente com as duas mãos.'
    };
  }

  const sideName = status.stage === 'right' ? 'direita' : 'esquerda';
  const stepNumber = status.stage === 'right' ? '1 DE 2' : '2 DE 2';
  let hint = `Levante somente a mão ${sideName} e mantenha a outra abaixada.`;

  if (status.reason === 'lower-other-hand') {
    hint = 'Abaixe completamente a outra mão para não misturar os sensores.';
  } else if (status.reason === 'hold-still') {
    hint = `Mão ${sideName} encontrada. Mantenha-a parada até completar.`;
  }

  return {
    step: `CONFIGURAÇÃO ${stepNumber}`,
    instruction: `Mostre somente a mão ${sideName}.`,
    hint
  };
}

function renderCalibration(status) {
  const copy = calibrationCopy(status);
  calibrationPanel?.classList.toggle('ready', status.ready);
  calibrationStep.textContent = copy.step;
  calibrationInstruction.textContent = copy.instruction;
  calibrationHint.textContent = copy.hint;
  calibrationProgress.style.width = `${Math.round(clamp(status.progress) * 100)}%`;

  if (status.ready) {
    trackingStatus.textContent = `${transportMode === 'direct' ? 'Rastreamento rápido direto' : 'Rastreamento rápido via servidor'} • sensores separados ativos`;
  } else {
    trackingStatus.textContent = copy.instruction;
  }
}

function calibrationStatusKey(status) {
  return [
    status.stage,
    status.reason,
    Math.round(clamp(status.progress) * 20),
    status.ready ? 1 : 0
  ].join(':');
}

function broadcastCalibration(status, now, force = false) {
  const key = calibrationStatusKey(status);
  const changed = key !== lastCalibrationStatusKey;
  if (
    !force
    && !changed
    && now - lastCalibrationBroadcastAt < SENSOR_CALIBRATION.statusBroadcastIntervalMs
  ) return;

  lastCalibrationBroadcastAt = now;
  lastCalibrationStatusKey = key;
  socket.emit('game-command', {
    command: 'sensor-calibration',
    stage: status.stage,
    progress: clamp(status.progress),
    ready: Boolean(status.ready),
    reason: status.reason
  });
}

function emitPose(pose, detected, now, processingMs) {
  const sourceIntervalMs = previousFrameAt ? now - previousFrameAt : 0;
  previousFrameAt = now;
  const gestures = detected
    ? gestureTracker.update(pose, now)
    : gestureTracker.missing(now);

  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now(),
    processingMs: Math.round(processingMs),
    sourceIntervalMs: Math.round(sourceIntervalMs),
    left: detected
      ? filteredPoint('left', pose[POINTS.left], now)
      : hiddenPoint(0.35, 0.55),
    right: detected
      ? filteredPoint('right', pose[POINTS.right], now)
      : hiddenPoint(0.65, 0.55),
    leftShoulder: detected
      ? filteredPoint('leftShoulder', pose[POINTS.leftShoulder], now)
      : hiddenPoint(0.44, 0.35),
    rightShoulder: detected
      ? filteredPoint('rightShoulder', pose[POINTS.rightShoulder], now)
      : hiddenPoint(0.56, 0.35),
    gestures
  };

  if (socket.emit('pose', payload)) sentCounter += 1;
}

function emitHiddenPose(now, processingMs) {
  if (now - missingPoseSentAt < SCHEDULER.emptyFrameIntervalMs) return;
  emitPose(null, false, now, processingMs);
  missingPoseSentAt = now;
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
    const processingMs = performance.now() - startedAt;
    const rawPose = result.landmarks?.[0];
    const current = performance.now();

    processingValue.textContent = `${Math.round(processingMs)} ms`;

    if (rawPose) {
      lastPoseAt = current;
      const quality = averageVisibility(rawPose);
      poseQuality.textContent = `${Math.round(quality * 100)}%`;
      poseQuality.className = `quality-badge ${quality > 0.7 ? 'good' : quality > 0.48 ? 'medium' : 'low'}`;

      const bindingResult = handBinder.update(rawPose, current);
      renderCalibration(bindingResult.status);
      broadcastCalibration(bindingResult.status, current);

      if (bindingResult.pose) {
        emitPose(bindingResult.pose, true, current, processingMs);
      } else {
        emitHiddenPose(current, processingMs);
      }
    } else {
      poseQuality.textContent = '0%';
      poseQuality.className = 'quality-badge low';
      const status = handBinder.status();
      renderCalibration(status);
      broadcastCalibration(status, current);
      trackingStatus.textContent = status.ready
        ? 'Afaste-se até aparecer a parte superior do corpo.'
        : calibrationCopy(status).instruction;
      if (current - lastPoseAt > 250) resetOutputFilters();
      emitHiddenPose(current, processingMs);
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
  sensorBadge.textContent = mode === 'direct'
    ? `RÁPIDO • ${room}`
    : `Servidor • ${room}`;
  sensorBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
  renderCalibration(handBinder.status());
  broadcastCalibration(handBinder.status(), performance.now(), true);
});

socket.on('room-status', ({ tv }) => {
  if (!running) return;
  sensorBadge.textContent = tv
    ? `${transportMode === 'direct' ? 'RÁPIDO' : 'TV conectada'} • ${room}`
    : `Aguardando TV • ${room}`;
  sensorBadge.className = `badge ${tv ? 'online' : 'waiting'}`;
  if (tv) broadcastCalibration(handBinder.status(), performance.now(), true);
});

socket.on('game-command', (payload = {}) => {
  if (payload.command === 'recalibrate-sensors') restartSensorCalibration();
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
  startButton.textContent = 'Preparando rastreamento rápido…';

  try {
    await socket.connect();
    const joinResult = await socket.request('join', { room, role: 'phone' });
    if (!joinResult?.ok) {
      throw new Error(joinResult?.error || 'Não foi possível entrar na sala.');
    }

    landmarker = await createLandmarker();
    await startCamera();
    joinPanel.classList.add('hidden');
    cameraPanel.classList.remove('hidden');
    roomValue.textContent = room;
    sensorBadge.textContent = joinResult.status?.tv
      ? `TV conectada • ${room}`
      : `Aguardando TV • ${room}`;
    sensorBadge.className = `badge ${joinResult.status?.tv ? 'online' : 'waiting'}`;
    running = true;
    restartSensorCalibration();
    schedulePrediction();
  } catch (error) {
    console.error(error);
    alert(`Falha ao iniciar: ${error.message}`);
    startButton.disabled = false;
    startButton.textContent = 'Conectar e abrir câmera';
  }
});

function cleanup() {
  running = false;
  activeStream?.getTracks?.().forEach((track) => track.stop());
  landmarker?.close?.();
}

window.addEventListener('pagehide', cleanup, { once: true });
