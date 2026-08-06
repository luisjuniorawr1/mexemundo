const TASKS_VERSION = '0.10.22-rc.20250304';
const TASKS_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const NUMBER_OF_HANDS = 2;
const MINIMUM_DETECTION_CONFIDENCE = 0.5;
const MINIMUM_PRESENCE_CONFIDENCE = 0.5;
const MINIMUM_TRACKING_CONFIDENCE = 0.5;

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
      modelAssetPath: HAND_MODEL,
      delegate
    },
    runningMode: 'VIDEO',
    numHands: NUMBER_OF_HANDS,
    minHandDetectionConfidence: MINIMUM_DETECTION_CONFIDENCE,
    minHandPresenceConfidence: MINIMUM_PRESENCE_CONFIDENCE,
    minTrackingConfidence: MINIMUM_TRACKING_CONFIDENCE
  });
}

async function initialize() {
  if (initialized) return;
  try {
    handLandmarker = await createTask('GPU');
    initialized = true;
    self.postMessage({ type: 'ready', delegate: 'GPU', workerType: 'classic' });
  } catch (gpuError) {
    try {
      handLandmarker = await createTask('CPU');
      initialized = true;
      self.postMessage({ type: 'ready', delegate: 'CPU', workerType: 'classic' });
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
