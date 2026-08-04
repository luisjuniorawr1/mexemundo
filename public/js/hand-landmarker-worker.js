import {
  HAND_SYSTEM_CONFIG,
  MEDIAPIPE_TASKS_VERSION
} from './hand-system-config.js';

const TASKS_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
const DETECTOR = HAND_SYSTEM_CONFIG.detector;

let handLandmarker = null;
let initialized = false;
let visionModulePromise = null;

function serializeCategory(category) {
  return {
    categoryName: String(category?.categoryName ?? ''),
    displayName: String(category?.displayName ?? ''),
    score: Number(category?.score ?? 0),
    index: Number(category?.index ?? -1)
  };
}

function serializeResult(result) {
  return {
    landmarks: (result?.landmarks ?? []).map((hand) => hand.map((point) => ({
      x: Number(point.x ?? 0),
      y: Number(point.y ?? 0),
      z: Number(point.z ?? 0)
    }))),
    worldLandmarks: (result?.worldLandmarks ?? []).map((hand) => hand.map((point) => ({
      x: Number(point.x ?? 0),
      y: Number(point.y ?? 0),
      z: Number(point.z ?? 0)
    }))),
    handednesses: (result?.handednesses ?? []).map((group) => group.map(serializeCategory))
  };
}

async function loadVisionModule() {
  visionModulePromise ??= import(TASKS_MODULE);
  return visionModulePromise;
}

async function createTask(delegate) {
  const { FilesetResolver, HandLandmarker } = await loadVisionModule();
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: DETECTOR.handModel,
      delegate
    },
    runningMode: 'VIDEO',
    numHands: DETECTOR.numberOfHands,
    minHandDetectionConfidence: DETECTOR.minimumDetectionConfidence,
    minHandPresenceConfidence: DETECTOR.minimumPresenceConfidence,
    minTrackingConfidence: DETECTOR.minimumTrackingConfidence
  });
}

async function initialize() {
  if (initialized) return;
  try {
    handLandmarker = await createTask('GPU');
    initialized = true;
    self.postMessage({ type: 'ready', delegate: 'GPU' });
  } catch (gpuError) {
    try {
      handLandmarker = await createTask('CPU');
      initialized = true;
      self.postMessage({ type: 'ready', delegate: 'CPU' });
    } catch (cpuError) {
      self.postMessage({
        type: 'fatal',
        message: cpuError?.message || gpuError?.message || 'Falha ao carregar o Hand Landmarker.'
      });
    }
  }
}

self.addEventListener('message', async (event) => {
  const message = event.data ?? {};

  if (message.type === 'init') {
    await initialize();
    return;
  }

  if (message.type === 'frame') {
    const bitmap = message.bitmap;
    if (!initialized || !handLandmarker || !bitmap) {
      bitmap?.close?.();
      self.postMessage({
        type: 'frame-error',
        frameId: message.frameId,
        message: 'Detector ainda não está pronto.'
      });
      return;
    }

    const startedAt = performance.now();
    try {
      const result = handLandmarker.detectForVideo(bitmap, Number(message.timestampMs));
      self.postMessage({
        type: 'result',
        frameId: message.frameId,
        timestampMs: Number(message.timestampMs),
        inferenceMs: performance.now() - startedAt,
        result: serializeResult(result)
      });
    } catch (error) {
      self.postMessage({
        type: 'frame-error',
        frameId: message.frameId,
        message: error?.message || 'Falha ao processar o quadro.'
      });
    } finally {
      bitmap.close?.();
    }
    return;
  }

  if (message.type === 'close') {
    handLandmarker?.close?.();
    handLandmarker = null;
    initialized = false;
    self.close();
  }
});
