import { RealtimeClient } from './realtime.js';
import {
  HAND_SYSTEM_CONFIG,
  MEDIAPIPE_TASKS_VERSION
} from './hand-system-config.js';
import { createPoseFistGestureTracker } from './pose-gesture.js';
import { createProductionHandAnchor } from './production-hand-anchor.js';

const CAMERA = HAND_SYSTEM_CONFIG.camera;
const DETECTOR = HAND_SYSTEM_CONFIG.detector;
const FILTER = HAND_SYSTEM_CONFIG.filter;
const SCHEDULER = HAND_SYSTEM_CONFIG.scheduler;
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

const POINTS = {
  leftShoulder: 11,
  rightShoulder: 12
};
const BODY_QUALITY_POINTS = [11, 12, 13, 14];
const WRISTS = new Set(['left', 'right']);
const filters = new Map();
const anchorOutputs = new Map();
const handAnchor = createProductionHandAnchor();
const gestureTracker = createPoseFistGestureTracker();

overlay.style.display = 'none';

let landmarker = null;
let running = false;
let room = '';
let lastVideoTime = -1;
let lastBodyPoseAt = 0;
let missingPoseSentAt = 0;
let sentCounter = 0;
let sentWindow = performance.now();
let sequence = 0;
let previousFrameAt = 0;
let transportMode = 'relay';
let activeStream = null;

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
  anchorOutputs.clear();
  gestureTracker.reset();
}

function filteredBodyPoint(name, landmark, now) {
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

function filteredAnchorPoint(name, hand, now) {
  const filter = getFilter(name);
  const previous = anchorOutputs.get(name) ?? {
    lastSeenAt: 0,
    output: filter.output()
  };

  if (!hand?.visible || !hand.raw) {
    anchorOutputs.set(name, previous);
    return { ...previous.output, vx: 0, vy: 0, visible: false };
  }

  if (hand.lastSeenAt > previous.lastSeenAt) {
    previous.output = filter.filter(
      clamp(hand.raw.x),
      clamp(hand.raw.y),
      hand.lastSeenAt || now
    );
    previous.lastSeenAt = hand.lastSeenAt;
    anchorOutputs.set(name, previous);
  }

  return {
    ...previous.output,
    vx: compact(clamp(hand.velocity?.x ?? previous.output.vx, -4, 4)),
    vy: compact(clamp(hand.velocity?.y ?? previous.output.vy, -4, 4)),
    visible: true
  };
}

async function createPoseLandmarker() {
  trackingStatus.textContent = 'Ativando corpo e mãos…';
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
    console.warn('GPU do corpo indisponível; tentando CPU.', error);
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

function averageBodyVisibility(pose) {
  if (!pose) return 0;
  return BODY_QUALITY_POINTS.reduce(
    (sum, index) => sum + Number(pose[index]?.visibility ?? 0),
    0
  ) / BODY_QUALITY_POINTS.length;
}

function updateTrackingUi(rawPose, hands, poseMs) {
  const visibleCount = Number(Boolean(hands.left.visible))
    + Number(Boolean(hands.right.visible));
  const anchorStatus = handAnchor.status();
  const bodyQuality = averageBodyVisibility(rawPose);

  poseQuality.textContent = `${visibleCount}/2`;
  poseQuality.className = `quality-badge ${visibleCount === 2 ? 'good' : visibleCount === 1 ? 'medium' : 'low'}`;
  processingValue.textContent = anchorStatus.inferenceMs
    ? `${Math.round(poseMs)} ms • mãos ${Math.round(anchorStatus.inferenceMs)} ms`
    : `${Math.round(poseMs)} ms`;

  if (!anchorStatus.ready) {
    trackingStatus.textContent = 'Carregando detector dedicado das mãos…';
  } else if (visibleCount === 2 && bodyQuality >= 0.35) {
    trackingStatus.textContent = `${transportMode === 'direct' ? 'Direto' : 'Servidor'} • duas palmas rastreadas • ${anchorStatus.targetRate}/s`;
  } else if (visibleCount === 1) {
    trackingStatus.textContent = 'Uma mão encontrada. Mostre também a outra.';
  } else if (visibleCount === 2) {
    trackingStatus.textContent = 'Mãos encontradas. Afaste-se até os ombros aparecerem.';
  } else {
    trackingStatus.textContent = 'Mostre as duas palmas para a câmera.';
  }
}

function emitFrame(rawPose, hands, now, processingMs) {
  const left = filteredAnchorPoint('left', hands.left, now);
  const right = filteredAnchorPoint('right', hands.right, now);
  const detected = Boolean(rawPose || left.visible || right.visible);

  if (!detected && now - missingPoseSentAt < SCHEDULER.emptyFrameIntervalMs) {
    return;
  }

  const sourceIntervalMs = previousFrameAt ? now - previousFrameAt : 0;
  previousFrameAt = now;
  const gestures = gestureTracker.missing(now);
  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now(),
    processingMs: Math.round(processingMs),
    sourceIntervalMs: Math.round(sourceIntervalMs),
    left: detected ? left : hiddenPoint(0.35, 0.55),
    right: detected ? right : hiddenPoint(0.65, 0.55),
    leftShoulder: rawPose
      ? filteredBodyPoint('leftShoulder', rawPose[POINTS.leftShoulder], now)
      : hiddenPoint(0.44, 0.35),
    rightShoulder: rawPose
      ? filteredBodyPoint('rightShoulder', rawPose[POINTS.rightShoulder], now)
      : hiddenPoint(0.56, 0.35),
    gestures
  };

  if (!detected) missingPoseSentAt = now;
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
    void handAnchor.maybeSubmit(video, now);

    const startedAt = performance.now();
    let rawPose = null;
    try {
      rawPose = landmarker.detectForVideo(video, startedAt).landmarks?.[0] ?? null;
    } catch (error) {
      console.warn('Quadro corporal descartado.', error);
    }
    const processingMs = performance.now() - startedAt;
    const current = performance.now();
    const hands = handAnchor.sample(current);

    if (rawPose) lastBodyPoseAt = current;
    updateTrackingUi(rawPose, hands, processingMs);
    emitFrame(rawPose, hands, current, processingMs);

    if (!rawPose && current - lastBodyPoseAt > 500 && !hands.left.visible && !hands.right.visible) {
      resetOutputFilters();
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
});

socket.on('room-status', ({ tv }) => {
  if (!running) return;
  sensorBadge.textContent = tv
    ? `${transportMode === 'direct' ? 'RÁPIDO' : 'TV conectada'} • ${room}`
    : `Aguardando TV • ${room}`;
  sensorBadge.className = `badge ${tv ? 'online' : 'waiting'}`;
});

socket.on('game-command', (payload = {}) => {
  if (payload.command !== 'recalibrate-sensors') return;
  handAnchor.reset();
  resetOutputFilters();
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
  startButton.textContent = 'Preparando detector de mãos…';

  try {
    await socket.connect();
    const joinResult = await socket.request('join', { room, role: 'phone' });
    if (!joinResult?.ok) {
      throw new Error(joinResult?.error || 'Não foi possível entrar na sala.');
    }

    const [poseTask] = await Promise.all([
      createPoseLandmarker(),
      handAnchor.init()
    ]);
    landmarker = poseTask;
    await startCamera();
    joinPanel.classList.add('hidden');
    cameraPanel.classList.remove('hidden');
    roomValue.textContent = room;
    sensorBadge.textContent = joinResult.status?.tv
      ? `TV conectada • ${room}`
      : `Aguardando TV • ${room}`;
    sensorBadge.className = `badge ${joinResult.status?.tv ? 'online' : 'waiting'}`;
    running = true;
    resetOutputFilters();
    schedulePrediction();
  } catch (error) {
    console.error(error);
    alert(`Falha ao iniciar: ${error.message}`);
    handAnchor.close();
    startButton.disabled = false;
    startButton.textContent = 'Conectar e abrir câmera';
  }
});

function cleanup() {
  running = false;
  activeStream?.getTracks?.().forEach((track) => track.stop());
  landmarker?.close?.();
  handAnchor.close();
}

window.addEventListener('pagehide', cleanup, { once: true });
