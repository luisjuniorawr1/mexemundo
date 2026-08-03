import { RealtimeClient } from './realtime.js';
import { SessionKeeper } from './session-keeper.js';
import {
  MOTION_POINT_NAMES,
  MotionSource,
  PoseRecorder,
  playPoseRecording,
  validatePoseRecording
} from './motion-engine.js';
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
const motionSource = new MotionSource();
const poseRecorder = new PoseRecorder();

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
let transportMode = 'relay';
let sessionKeeper = null;
let cameraSettings = null;
let transportQuality = null;
let replayActive = false;
let activePlayback = null;

const queryRoom = new URLSearchParams(location.search).get('sala');
if (queryRoom) roomInput.value = queryRoom.toUpperCase().slice(0, 6);

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
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
  cameraSettings = track?.getSettings?.() ?? null;
  video.srcObject = stream;
  await video.play();
}

function averageVisibility(pose) {
  return POINT_NAMES.reduce((sum, name) => sum + (pose[POINTS[name]]?.visibility ?? 0), 0) / POINT_NAMES.length;
}

function sourcePoints(pose) {
  if (!pose) return null;
  const points = {};
  for (const name of MOTION_POINT_NAMES) {
    const landmark = pose[POINTS[name]];
    points[name] = {
      x: clamp(1 - finite(landmark?.x, 0.5)),
      y: clamp(finite(landmark?.y, 0.5)),
      confidence: clamp(finite(landmark?.visibility))
    };
  }
  return points;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function emitPose(pose, detected, frameAt, processingMs) {
  if (replayActive) return;
  const source = motionSource.process(sourcePoints(pose), frameAt, { detected, processingMs });
  const payload = {
    detected,
    sequence: ++sequence,
    capturedAt: Date.now() - Math.round(processingMs),
    processingMs: Math.round(processingMs),
    sourceIntervalMs: Math.round(source.sourceIntervalMs),
    left: source.left,
    right: source.right,
    leftShoulder: source.leftShoulder,
    rightShoulder: source.rightShoulder
  };
  poseRecorder.capture(payload);
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
    motionSource.noteVideoFrame(metadata);
    const frameAt = Number.isFinite(metadata?.expectedDisplayTime)
      ? metadata.expectedDisplayTime
      : now;
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
      emitPose(pose, true, frameAt, processing);
    } else {
      poseQuality.textContent = '0%';
      poseQuality.className = 'quality-badge low';
      trackingStatus.textContent = 'Afaste-se até aparecer a parte superior do corpo.';
      if (current - lastPoseAt > 250) motionSource.reset();
      if (current - missingPoseSentAt >= 100) {
        emitPose(null, false, frameAt, processing);
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
socket.on('quality', (quality) => {
  transportQuality = quality;
});

globalThis.mexeMundoMotion = {
  metrics: () => ({
    source: motionSource.getMetrics(),
    camera: cameraSettings,
    transport: transportQuality
  }),
  startRecording: () => poseRecorder.start(),
  stopRecording: () => poseRecorder.stop(),
  play(recording, options = {}) {
    activePlayback?.stop();
    validatePoseRecording(recording);
    if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0)) {
      throw new Error('A velocidade do replay deve ser um número positivo.');
    }
    replayActive = true;
    let playback;
    try {
      playback = playPoseRecording(recording, (recordedPose) => {
        const replayPose = { ...recordedPose, sequence: ++sequence };
        socket.emit('pose', replayPose);
      }, {
        ...options,
        onFinish: () => {
          replayActive = false;
          activePlayback = null;
          motionSource.reset();
          if (typeof options.onFinish === 'function') options.onFinish();
        }
      });
    } catch (error) {
      replayActive = false;
      throw error;
    }
    activePlayback = { stop: () => playback.stop() };
    return activePlayback;
  },
  download(recording, filename = `mexemundo-poses-${Date.now()}.json`) {
    const blob = new Blob([JSON.stringify(validatePoseRecording(recording), null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

function applyTvStatus({ tv } = {}) {
  if (!running) return;
  sensorBadge.textContent = tv
    ? `${transportMode === 'direct' ? 'TURBO ESTÁVEL' : 'TV conectada'} • ${room}`
    : `Aguardando TV • ${room}`;
  sensorBadge.className = `badge ${tv ? 'online' : 'waiting'}`;
}

socket.on('room-status', applyTvStatus);

socket.on('disconnect', () => {
  activePlayback?.stop();
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
