export const HAND_SYSTEM_VERSION = '1.0.0';
export const HAND_PROFILE_VERSION = 1;
export const HAND_PROFILE_SCOPE = 'universal-two-hand';
export const HAND_PROFILE_KEY = 'mexemundo-universal-hand-profile-v1';
export const MEDIAPIPE_TASKS_VERSION = '0.10.35';

const config = {
  system: {
    version: HAND_SYSTEM_VERSION,
    inputVersion: 1,
    profileVersion: HAND_PROFILE_VERSION,
    profileScope: HAND_PROFILE_SCOPE
  },
  camera: {
    facingMode: 'user',
    idealWidth: 360,
    idealHeight: 640,
    idealAspectRatio: 9 / 16,
    idealFrameRate: 60,
    maximumFrameRate: 60,
    resizeMode: 'crop-and-scale'
  },
  detector: {
    tasksVersion: MEDIAPIPE_TASKS_VERSION,
    numberOfHands: 2,
    minimumDetectionConfidence: 0.5,
    minimumPresenceConfidence: 0.5,
    minimumTrackingConfidence: 0.5,
    handModel: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    poseModel: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
  },
  scheduler: {
    handRates: [30, 24, 18, 12],
    shoulderIntervalMs: 110,
    maximumMissingHandMs: 180,
    reacquireResetMs: 260,
    poseFreshnessMs: 260
  },
  calibration: {
    holdMs: 2800,
    minimumSamplesPerHand: 24,
    minimumOpenness: 0.26,
    maximumStillSpeed: 0.13,
    minimumSeparation: 0.13,
    restRadiusMinimum: 0.001,
    restRadiusMaximum: 0.015
  },
  output: {
    velocityMinimumForPrediction: 0.35,
    maximumVisualPredictionMs: 10,
    maximumCollisionPredictionMs: 24,
    maximumPacketAgePredictionMs: 25
  }
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const HAND_SYSTEM_CONFIG = deepFreeze(config);

export function handSystemFingerprint() {
  const detector = HAND_SYSTEM_CONFIG.detector;
  return [
    HAND_SYSTEM_VERSION,
    detector.tasksVersion,
    detector.numberOfHands,
    detector.minimumDetectionConfidence,
    detector.minimumPresenceConfidence,
    detector.minimumTrackingConfidence
  ].join(':');
}
