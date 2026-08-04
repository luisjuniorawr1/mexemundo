import { RealtimeClient } from './realtime.js';
import { SessionKeeper } from './session-keeper.js';
import { HandTrackingCore } from './hand-tracking-core.js';
import {
  loadUniversalHandProfile,
  saveUniversalHandProfile
} from './hand-profile.js';
import {
  HAND_PROFILE_SCOPE,
  HAND_PROFILE_VERSION,
  HAND_SYSTEM_CONFIG,
  MEDIAPIPE_TASKS_VERSION
} from './hand-system-config.js';

const CAMERA = HAND_SYSTEM_CONFIG.camera;
const DETECTOR = HAND_SYSTEM_CONFIG.detector;
const SCHEDULER = HAND_SYSTEM_CONFIG.scheduler;
const CALIBRATION = HAND_SYSTEM_CONFIG.calibration;
const TASKS_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;

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

overlay.style.display = 'none';

let poseLandmarker = null;
let handLandmarker = null;
let handWorker = null;
let workerReadyResolve = null;
let workerReadyReject = null;
let pipelineMode = 'loading';
let workerDelegate = '';
let handBusy = false;
let switchingToMain = false;
let targetHandRate = SCHEDULER.defaultHandRate;
let nextHandAt = 0;
let lastPoseRunAt = 0;
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
let sessionKeeper = null;
let latestSnapshot = null;
let latestHandInferenceMs = 0;
let latestPoseInferenceMs = 0;
let visionModulePromise = null;
let latestShoulders = {
  detected: false,
  receivedAt: 0,
  left: hiddenPoint(0.44, 0.35),
  right: hiddenPoint(0.56, 0.35)
};

const storedProfile = loadUniversalHandProfile();
const handCore = new HandTrackingCore({ mirrorX: true, calibration: storedProfile });
const calibration = {
  ready: Boolean(storedProfile),
  active: false,
  stableSince: 0,
  progress: storedProfile ? 1 : 0,
  samples: [[], []],
  scales: [[], []],
  message: storedProfile
    ? 'Perfil universal das duas mãos carregado.'
    : 'Entre em um jogo e levante as duas mãos.'
};

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

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rms(points) {
  if (points.length < 6) return 0;
  const centerX = mean(points.map((point) => point.x));
  const centerY = mean(points.map((point) => point.y));
  return Math.sqrt(mean(points.map((point) => (
    (point.x - centerX) ** 2 + (point.y - centerY) ** 2
  ))));
}

function hiddenPoint(x, y) {
  return { x, y, vx: 0, vy: 0, visible: false };
}

function resetCalibrationSamples() {
  calibration.stableSince = 0;
  calibration.progress = 0;
  calibration.samples = [[], []];
  calibration.scales = [[], []];
}

function visibleHands(snapshot = latestSnapshot) {
  return snapshot?.hands?.filter((hand) => hand.visible && hand.visual && hand.raw) ?? [];
}

function shouldersFresh(now) {
  return latestShoulders.detected
    && now - latestShoulders.receivedAt <= SCHEDULER.shoulderFreshnessMs;
}

function handsAreRaised(hands, now) {
  if (hands.length !== DETECTOR.numberOfHands || !shouldersFresh(now)) return false;
  const shoulderY = Math.min(latestShoulders.left.y, latestShoulders.right.y);
  return hands.every((hand) => hand.visual.y < shoulderY + CALIBRATION.raisedShoulderTolerance);
}

function handsAreOpenAndStill(hands) {
  if (hands.length !== DETECTOR.numberOfHands) return false;
  const separation = Math.hypot(
    hands[0].visual.x - hands[1].visual.x,
    hands[0].visual.y - hands[1].visual.y
  );
  const averageScale = mean(hands.map((hand) => hand.scale));
  const open = hands.every((hand) => hand.openness >= CALIBRATION.minimumOpenness);
  const still = hands.every((hand) => {
    const speed = Math.hypot(hand.velocity.x, hand.velocity.y);
    return speed <= Math.max(
      CALIBRATION.maximumStillSpeed,
      hand.scale * CALIBRATION.stillSpeedScaleMultiplier
    );
  });
  return open && still && separation >= Math.max(
    CALIBRATION.minimumSeparation,
    averageScale * CALIBRATION.separationScaleMultiplier
  );
}

function makeHandProfile(index) {
  const jitter = rms(calibration.samples[index]);
  const scale = median(calibration.scales[index]) || 0.08;
  const relativeNoise = jitter / Math.max(0.025, scale);
  return {
    jitter,
    scale,
    restRadius: clamp(
      Math.max(
        jitter * CALIBRATION.jitterRestMultiplier,
        scale * CALIBRATION.palmScaleRestMultiplier
      ),
      CALIBRATION.restRadiusMinimum,
      CALIBRATION.restRadiusMaximum
    ),
    minCutoff: clamp(
      CALIBRATION.minimumCutoffBase
        - relativeNoise * CALIBRATION.minimumCutoffNoiseMultiplier,
      CALIBRATION.minimumCutoffFloor,
      CALIBRATION.minimumCutoffBase
    ),
    beta: clamp(
      CALIBRATION.betaBase + relativeNoise * CALIBRATION.betaNoiseMultiplier,
      CALIBRATION.betaBase,
      CALIBRATION.betaMaximum
    ),
    derivativeCutoff: CALIBRATION.derivativeCutoff
  };
}

function completeCalibration() {
  const profile = saveUniversalHandProfile({
    version: HAND_PROFILE_VERSION,
    scope: HAND_PROFILE_SCOPE,
    engine: `mediapipe-hand-landmarker-${MEDIAPIPE_TASKS_VERSION}`,
    createdAt: Date.now(),
    hands: [makeHandProfile(0), makeHandProfile(1)],
    device: {
      inferenceMs: Math.round(latestHandInferenceMs),
      targetRate: targetHandRate,
      width: video.videoWidth,
      height: video.videoHeight
    }
  });
  handCore.applyCalibration(profile);
  calibration.ready = true;
  calibration.active = false;
  calibration.progress = 1;
  calibration.message = 'Perfil universal pronto para todos os jogos.';
}

function updateUniversalCalibration(snapshot, now) {
  if (calibration.ready) return;

  const hands = visibleHands(snapshot);
  if (!handsAreRaised(hands, now)) {
    calibration.active = false;
    resetCalibrationSamples();
    calibration.message = hands.length < DETECTOR.numberOfHands
      ? 'Mostre as duas mãos para a câmera.'
      : 'Levante as duas mãos para criar o perfil universal.';
    return;
  }

  calibration.active = true;
  if (!handsAreOpenAndStill(hands)) {
    resetCalibrationSamples();
    calibration.active = true;
    calibration.message = 'Mantenha as duas mãos abertas e paradas.';
    return;
  }

  if (!calibration.stableSince) calibration.stableSince = now;
  hands.forEach((hand, index) => {
    calibration.samples[index].push({ ...hand.raw });
    calibration.scales[index].push(hand.scale);
    if (calibration.samples[index].length > 120) calibration.samples[index].shift();
    if (calibration.scales[index].length > 120) calibration.scales[index].shift();
  });

  calibration.progress = clamp((now - calibration.stableSince) / CALIBRATION.holdMs);
  calibration.message = `Criando perfil universal • ${Math.round(calibration.progress * 100)}%`;

  const enoughSamples = calibration.samples.every(
    (samples) => samples.length >= CALIBRATION.minimumSamplesPerHand
  );
  if (calibration.progress >= 1 && enoughSamples) completeCalibration();
}

function pointFromHand(hand, fallbackX) {
  if (!hand?.visible || !hand.visual) return hiddenPoint(fallbackX, 0.55);
  return {
    x: compact(clamp(hand.visual.x)),
    y: compact(clamp(hand.visual.y)),
    vx: compact(clamp(hand.velocity.x, -4, 4)),
    vy: compact(clamp(hand.velocity.y, -4, 4)),
    visible: true
  };
}

function currentHandPair() {
  const hands = latestSnapshot?.hands ?? [];
  return {
    left: pointFromHand(hands[0], 0.35),
    right: pointFromHand(hands[1], 0.65)
  };
}

function currentShouldersForOutput(now) {
  if (!shouldersFresh(now)) {
    return {
      left: hiddenPoint(0.44, 0.35),
      right: hiddenPoint(0.56, 0.35)
    };
  }

  // A calibração pode aparecer dentro de qualquer jogo, mas pertence à
  // plataforma. A contagem fica bloqueada apenas enquanto o perfil universal
  // está sendo criado.
  if (calibration.active && !calibration.ready) {
    return {
      left: { ...latestShoulders.left, y: 0.01, visible: true },
      right: { ...latestShoulders.right, y: 0.01, visible: true }
    };
  }

  return {
    left: { ...latestShoulders.left },
    right: { ...latestShoulders.right }
  };
}

function emitCurrentPose(now = performance.now()) {
  const sourceIntervalMs = previousFrameAt ? now - previousFrameAt : 0;
  previousFrameAt = now;
  const hands = currentHandPair();
  const shoulders = currentShouldersForOutput(now);
  const detected = hands.left.visible || hands.right.visible || latestShoulders.detected;
  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now(),
    processingMs: Math.round(latestHandInferenceMs + latestPoseInferenceMs),
    sourceIntervalMs: Math.round(sourceIntervalMs),
    left: hands.left,
    right: hands.right,
    leftShoulder: shoulders.left,
    rightShoulder: shoulders.right
  };
  if (socket.emit('pose', payload)) sentCounter += 1;
}

function updateTrackingUi() {
  const hands = visibleHands();
  const handQuality = hands.length === DETECTOR.numberOfHands
    ? mean(hands.map((hand) => clamp(hand.handednessScore || 0.7)))
    : hands.length * 0.35;
  const shoulderQuality = latestShoulders.detected ? 1 : 0;
  const quality = clamp(handQuality * 0.78 + shoulderQuality * 0.22);
  poseQuality.textContent = `${Math.round(quality * 100)}%`;
  poseQuality.className = `quality-badge ${quality > 0.72 ? 'good' : quality > 0.46 ? 'medium' : 'low'}`;

  if (!calibration.ready) {
    trackingStatus.textContent = calibration.message;
  } else if (hands.length < DETECTOR.numberOfHands) {
    trackingStatus.textContent = 'Perfil universal ativo • mostre as duas mãos.';
  } else {
    const pipeline = pipelineMode === 'worker'
      ? `perfil universal • segundo plano${workerDelegate ? ` • ${workerDelegate}` : ''}`
      : 'perfil universal • modo compatível';
    trackingStatus.textContent = `${pipeline} • olhe para a TV!`;
  }

  processingValue.textContent = `${Math.round(latestHandInferenceMs)} ms`;
}

function updateAdaptiveRate(inferenceMs) {
  const rates = SCHEDULER.handRates;
  const thresholds = SCHEDULER.inferenceThresholdsMs;
  const next = inferenceMs <= thresholds[0]
    ? rates[0]
    : inferenceMs <= thresholds[1]
      ? rates[1]
      : inferenceMs <= thresholds[2]
        ? rates[2]
        : rates[3];

  if (next < targetHandRate) targetHandRate = next;
  else if (next > targetHandRate && inferenceMs < (1000 / targetHandRate) * 0.62) {
    targetHandRate = next;
  }
}

function handleHandResult(result, timestampMs, inferenceMs) {
  latestHandInferenceMs = Number(inferenceMs || 0);
  updateAdaptiveRate(latestHandInferenceMs);
  latestSnapshot = handCore.ingest(result, timestampMs);
  updateUniversalCalibration(latestSnapshot, timestampMs);
  updateTrackingUi();
  emitCurrentPose(performance.now());
}

function handleWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.type === 'ready') {
    workerDelegate = message.delegate || '';
    pipelineMode = 'worker';
    workerReadyResolve?.();
    workerReadyResolve = null;
    workerReadyReject = null;
    return;
  }
  if (message.type === 'fatal') {
    workerReadyReject?.(new Error(message.message || 'Falha no worker de mãos.'));
    workerReadyResolve = null;
    workerReadyReject = null;
    return;
  }
  if (message.type === 'result') {
    handBusy = false;
    nextHandAt = performance.now() + 1000 / targetHandRate;
    handleHandResult(message.result, Number(message.timestampMs), Number(message.inferenceMs));
    return;
  }
  if (message.type === 'frame-error') {
    handBusy = false;
    nextHandAt = performance.now() + 1000 / Math.max(
      SCHEDULER.handRates.at(-1),
      targetHandRate
    );
  }
}

async function loadVisionModule() {
  visionModulePromise ??= import(TASKS_MODULE);
  return visionModulePromise;
}

async function initializeWorkerPipeline() {
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') {
    throw new Error('Worker com ImageBitmap indisponível.');
  }

  handWorker = new Worker('/js/hand-landmarker-worker.js', { type: 'module' });
  handWorker.addEventListener('message', handleWorkerMessage);
  handWorker.addEventListener('error', (event) => {
    workerReadyReject?.(new Error(event.message || 'Falha ao iniciar o worker.'));
  });

  await new Promise((resolve, reject) => {
    workerReadyResolve = resolve;
    workerReadyReject = reject;
    const timeout = setTimeout(
      () => reject(new Error('Tempo esgotado ao iniciar o worker.')),
      SCHEDULER.workerInitializationTimeoutMs
    );
    const originalResolve = workerReadyResolve;
    const originalReject = workerReadyReject;
    workerReadyResolve = () => {
      clearTimeout(timeout);
      originalResolve();
    };
    workerReadyReject = (error) => {
      clearTimeout(timeout);
      originalReject(error);
    };
    handWorker.postMessage({ type: 'init' });
  });
}

async function createMainHandLandmarker() {
  const { FilesetResolver, HandLandmarker } = await loadVisionModule();
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const create = (delegate) => HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: DETECTOR.handModel, delegate },
    runningMode: 'VIDEO',
    numHands: DETECTOR.numberOfHands,
    minHandDetectionConfidence: DETECTOR.minimumDetectionConfidence,
    minHandPresenceConfidence: DETECTOR.minimumPresenceConfidence,
    minTrackingConfidence: DETECTOR.minimumTrackingConfidence
  });
  try {
    return await create('GPU');
  } catch (error) {
    console.warn('GPU das mãos indisponível; usando CPU.', error);
    return create('CPU');
  }
}

async function switchToMainHandPipeline() {
  if (switchingToMain || pipelineMode === 'main') return;
  switchingToMain = true;
  pipelineMode = 'loading';
  handBusy = false;
  handWorker?.terminate?.();
  handWorker = null;
  try {
    handLandmarker = await createMainHandLandmarker();
    pipelineMode = 'main';
  } finally {
    switchingToMain = false;
  }
}

async function initializeHandPipeline() {
  trackingStatus.textContent = 'Carregando rastreamento universal das duas mãos…';
  try {
    await initializeWorkerPipeline();
  } catch (error) {
    console.warn('Worker de mãos indisponível; usando modo compatível.', error);
    handWorker?.terminate?.();
    handWorker = null;
    handLandmarker = await createMainHandLandmarker();
    pipelineMode = 'main';
  }
}

async function createPoseLandmarker() {
  const { FilesetResolver, PoseLandmarker } = await loadVisionModule();
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const create = (delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: DETECTOR.poseModel, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: DETECTOR.poseDetectionConfidence,
    minPosePresenceConfidence: DETECTOR.posePresenceConfidence,
    minTrackingConfidence: DETECTOR.poseTrackingConfidence,
    outputSegmentationMasks: false
  });
  try {
    return await create('GPU');
  } catch (error) {
    console.warn('GPU dos ombros indisponível; usando CPU.', error);
    return create('CPU');
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador não liberou acesso à câmera. Abra usando HTTPS.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: CAMERA.facingMode,
      width: { ideal: CAMERA.idealWidth },
      height: { ideal: CAMERA.idealHeight },
      aspectRatio: { ideal: CAMERA.idealAspectRatio },
      frameRate: {
        ideal: CAMERA.idealFrameRate,
        max: CAMERA.maximumFrameRate
      },
      resizeMode: CAMERA.resizeMode
    }
  });

  const [track] = stream.getVideoTracks();
  if (track && 'contentHint' in track) track.contentHint = 'motion';
  video.srcObject = stream;
  await video.play();
}

function updateShoulders(now) {
  if (
    !poseLandmarker
    || now - lastPoseRunAt < SCHEDULER.shoulderIntervalMs
    || video.readyState < 2
  ) return;

  lastPoseRunAt = now;
  const startedAt = performance.now();
  const result = poseLandmarker.detectForVideo(video, Math.round(now));
  latestPoseInferenceMs = performance.now() - startedAt;
  const pose = result.landmarks?.[0];

  if (!pose) {
    if (now - lastPoseAt > SCHEDULER.shoulderLostAfterMs) {
      latestShoulders.detected = false;
      latestShoulders.left.visible = false;
      latestShoulders.right.visible = false;
    }
    return;
  }

  const left = pose[11];
  const right = pose[12];
  const leftVisible = (left?.visibility ?? 0) > 0.35;
  const rightVisible = (right?.visibility ?? 0) > 0.35;
  latestShoulders = {
    detected: leftVisible && rightVisible,
    receivedAt: now,
    left: {
      x: compact(clamp(1 - (left?.x ?? 0.56))),
      y: compact(clamp(left?.y ?? 0.35)),
      vx: 0,
      vy: 0,
      visible: leftVisible
    },
    right: {
      x: compact(clamp(1 - (right?.x ?? 0.44))),
      y: compact(clamp(right?.y ?? 0.35)),
      vx: 0,
      vy: 0,
      visible: rightVisible
    }
  };
  lastPoseAt = now;
}

async function dispatchWorkerFrame(now) {
  if (!handWorker || handBusy) return;
  handBusy = true;
  try {
    const bitmap = await createImageBitmap(video);
    handWorker.postMessage({
      type: 'frame',
      frameId: sequence + 1,
      timestampMs: Math.round(now),
      bitmap
    }, [bitmap]);
  } catch (error) {
    handBusy = false;
    console.warn('O navegador não aceitou quadros no worker; mudando para modo compatível.', error);
    await switchToMainHandPipeline();
  }
}

function processMainHandFrame(now) {
  if (!handLandmarker || handBusy) return;
  handBusy = true;
  const startedAt = performance.now();
  try {
    const result = handLandmarker.detectForVideo(video, Math.round(now));
    const inferenceMs = performance.now() - startedAt;
    handleHandResult(result, now, inferenceMs);
  } finally {
    handBusy = false;
    nextHandAt = performance.now() + 1000 / targetHandRate;
  }
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
    updateShoulders(now);

    if (now >= nextHandAt && !handBusy) {
      if (pipelineMode === 'worker') {
        dispatchWorkerFrame(now).catch((error) => console.warn(error));
      } else if (pipelineMode === 'main') {
        processMainHandFrame(now);
      }
    }

    if (!latestSnapshot && now - missingPoseSentAt >= SCHEDULER.emptyFrameIntervalMs) {
      emitCurrentPose(now);
      missingPoseSentAt = now;
    }

    if (now - sentWindow >= 1000) {
      sendValue.textContent = `${sentCounter}/s`;
      sentCounter = 0;
      sentWindow = now;
    }
  }
  schedulePrediction();
}

socket.on('transport', ({ mode }) => {
  transportMode = mode;
  if (!running) return;
  sensorBadge.textContent = mode === 'direct'
    ? `PERFIL UNIVERSAL • ${room}`
    : `Servidor • ${room}`;
  sensorBadge.className = `badge ${mode === 'direct' ? 'online' : 'waiting'}`;
});

function applyTvStatus({ tv } = {}) {
  if (!running) return;
  sensorBadge.textContent = tv
    ? `${transportMode === 'direct' ? 'PERFIL UNIVERSAL' : 'TV conectada'} • ${room}`
    : `Aguardando TV • ${room}`;
  sensorBadge.className = `badge ${tv ? 'online' : 'waiting'}`;
}

socket.on('room-status', applyTvStatus);
socket.on('disconnect', () => {
  if (!running) return;
  sensorBadge.textContent = `Reconectando • ${room}`;
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
  startButton.textContent = 'Preparando perfil universal…';

  try {
    await socket.connect();
    const joinResult = await socket.request('join', { room, role: 'phone' });
    if (!joinResult?.ok) {
      throw new Error(joinResult?.error || 'Não foi possível entrar na sala.');
    }

    await Promise.all([
      initializeHandPipeline(),
      createPoseLandmarker().then((task) => { poseLandmarker = task; })
    ]);
    await startCamera();

    joinPanel.classList.add('hidden');
    cameraPanel.classList.remove('hidden');
    roomValue.textContent = room;
    sensorBadge.textContent = joinResult.status?.tv
      ? `TV conectada • ${room}`
      : `Aguardando TV • ${room}`;
    sensorBadge.className = `badge ${joinResult.status?.tv ? 'online' : 'waiting'}`;
    trackingStatus.textContent = calibration.ready
      ? 'Perfil universal carregado. Olhe para a TV.'
      : 'Levante as duas mãos para criar o perfil universal.';
    running = true;

    sessionKeeper?.stop();
    sessionKeeper = new SessionKeeper({
      client: socket,
      room,
      role: 'phone',
      onStatus: applyTvStatus,
      onWaiting: () => {
        sensorBadge.textContent = `Reconectando • ${room}`;
        sensorBadge.className = 'badge waiting';
      }
    });
    sessionKeeper.start();
    schedulePrediction();
  } catch (error) {
    console.error(error);
    alert(`Falha ao iniciar: ${error.message}`);
    startButton.disabled = false;
    startButton.textContent = 'Conectar e abrir câmera';
  }
});

window.addEventListener('pagehide', () => {
  running = false;
  sessionKeeper?.stop();
  for (const track of video.srcObject?.getTracks?.() ?? []) track.stop();
  handWorker?.postMessage?.({ type: 'close' });
  handWorker?.terminate?.();
  handLandmarker?.close?.();
  poseLandmarker?.close?.();
});
