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

let landmarker;
let running = false;
let room = '';
let lastVideoTime = -1;
let lastSentAt = 0;
let sentCounter = 0;
let sentWindow = performance.now();
let missingPoseSentAt = 0;
const drawingUtils = new DrawingUtils(ctx);

const queryRoom = new URLSearchParams(location.search).get('sala');
if (queryRoom) roomInput.value = queryRoom.toUpperCase().slice(0, 6);

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

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
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
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
      width: { ideal: 720 },
      height: { ideal: 1280 },
      frameRate: { ideal: 30, max: 30 }
    }
  });

  video.srcObject = stream;
  await video.play();
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizedLandmark(landmark) {
  return {
    x: clamp(1 - landmark.x),
    y: clamp(landmark.y),
    z: Number.isFinite(landmark.z) ? landmark.z : 0,
    visible: (landmark.visibility ?? 1) > 0.35
  };
}

function fitCanvas() {
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
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
    color: 'rgba(255,255,255,.65)',
    lineWidth: 4
  });
  drawingUtils.drawLandmarks(pose, {
    color: '#ffcf4a',
    fillColor: '#6938ef',
    radius: 4,
    lineWidth: 2
  });
}

function emitPose(pose, detected) {
  const payload = {
    detected,
    capturedAt: Date.now(),
    left: detected ? normalizedLandmark(pose[15]) : { x: 0.35, y: 0.55, z: 0, visible: false },
    right: detected ? normalizedLandmark(pose[16]) : { x: 0.65, y: 0.55, z: 0, visible: false },
    leftElbow: detected ? normalizedLandmark(pose[13]) : { x: 0.4, y: 0.48, z: 0, visible: false },
    rightElbow: detected ? normalizedLandmark(pose[14]) : { x: 0.6, y: 0.48, z: 0, visible: false },
    leftShoulder: detected ? normalizedLandmark(pose[11]) : { x: 0.44, y: 0.35, z: 0, visible: false },
    rightShoulder: detected ? normalizedLandmark(pose[12]) : { x: 0.56, y: 0.35, z: 0, visible: false },
    nose: detected ? normalizedLandmark(pose[0]) : { x: 0.5, y: 0.2, z: 0, visible: false }
  };

  socket.emit('pose', payload);
  sentCounter += 1;
}

async function predict() {
  if (!running) return;
  fitCanvas();

  if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = video.currentTime;
    const startedAt = performance.now();
    const result = landmarker.detectForVideo(video, startedAt);
    const processing = performance.now() - startedAt;
    processingValue.textContent = `${Math.round(processing)} ms`;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const pose = result.landmarks?.[0];
    const now = performance.now();

    if (pose) {
      drawPose(pose);
      const quality = averageVisibility(pose);
      const qualityPercent = Math.round(quality * 100);
      poseQuality.textContent = `${qualityPercent}%`;
      poseQuality.className = `quality-badge ${quality > 0.72 ? 'good' : quality > 0.5 ? 'medium' : 'low'}`;

      const wristsVisible = (pose[15]?.visibility ?? 0) > 0.35 && (pose[16]?.visibility ?? 0) > 0.35;
      trackingStatus.textContent = wristsVisible
        ? 'Tudo certo! Olhe para a TV.'
        : 'Mostre as duas mãos para a câmera.';

      if (now - lastSentAt >= 33) {
        emitPose(pose, true);
        lastSentAt = now;
      }
    } else {
      poseQuality.textContent = '0%';
      poseQuality.className = 'quality-badge low';
      trackingStatus.textContent = 'Afaste-se até aparecer o corpo inteiro.';
      if (now - missingPoseSentAt >= 120) {
        emitPose(null, false);
        missingPoseSentAt = now;
      }
    }

    if (now - sentWindow >= 1000) {
      sendValue.textContent = `${sentCounter}/s`;
      sentCounter = 0;
      sentWindow = now;
    }
  }

  requestAnimationFrame(predict);
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
    predict();
  } catch (error) {
    console.error(error);
    alert(`Falha ao iniciar: ${error.message}`);
    startButton.disabled = false;
    startButton.textContent = 'Conectar e abrir câmera';
  }
});
