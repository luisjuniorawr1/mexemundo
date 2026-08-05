export const HAND_SYSTEM_VERSION = '1.3.0';
export const HAND_PROFILE_VERSION = 2;
export const HAND_PROFILE_SCOPE = 'universal-two-hand';
export const HAND_PROFILE_KEY = 'mexemundo-universal-hand-profile-v2';
export const MEDIAPIPE_TASKS_VERSION = '0.10.22-rc.20250304';

const config = {
  system: {
    version: HAND_SYSTEM_VERSION,
    inputVersion: 3,
    profileVersion: HAND_PROFILE_VERSION,
    profileScope: HAND_PROFILE_SCOPE,
    referenceVersion: '0.6.0',
    productionEngine: 'pose-landmarker-lite-single-pass',
    visualResponse: 'mexeflow-v1'
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
    poseDetectionConfidence: 0.5,
    posePresenceConfidence: 0.5,
    poseTrackingConfidence: 0.55,
    pointVisibilityConfidence: 0.3,
    poseModel: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',

    // Mantidos para os laboratórios de pesquisa. Não são carregados na produção.
    minimumDetectionConfidence: 0.5,
    minimumPresenceConfidence: 0.5,
    minimumTrackingConfidence: 0.5,
    handModel: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
  },
  filter: {
    wristVelocityBlend: 0.38,
    bodyVelocityBlend: 0.24,
    wristRestSpeed: 0.15,
    wristMoveSpeed: 0.35,
    wristRestDeadZone: 0.004,
    wristMoveDeadZone: 0.0016,
    wristFastDeadZone: 0.0007,
    wristBaseAlpha: 0.14,
    wristAlphaRange: 0.80,
    wristMovementStart: 0.07,
    wristMovementRange: 0.95,
    wristDisplacementRange: 0.045,
    wristSnapDistance: 0.075,
    wristSnapSpeed: 1.35,
    bodyDeadZone: 0.0016,
    bodyBaseAlpha: 0.20,
    bodyDistanceGain: 5,
    bodyMaximumAlpha: 0.72,
    filteredVelocityBlend: 0.35,
    idleVelocityDecay: 0.60
  },
  visual: {
    mode: 'mexeflow-v1',
    minimumDeltaMs: 4,
    maximumDeltaMs: 45,
    restEnterSpeed: 0.16,
    restExitSpeed: 0.28,
    restEnterDistance: 0.005,
    restExitDistance: 0.012,
    restHoldMs: 90,
    slowHalfLifeMs: 58,
    fastHalfLifeMs: 10,
    fastResponseSpeed: 0.95,
    fastResponseDistance: 0.06,
    snapDistance: 0.13,
    maximumLagDistance: 0.035,
    lookaheadMs: 7,
    lookaheadMinimumSpeed: 0.55,
    maximumLookaheadDistance: 0.012,
    missingGraceMs: 180
  },
  gesture: {
    sideUsedForMenus: 'right',
    minimumVisibility: 0.18,
    minimumVisibleTips: 2,
    bootstrapMs: 180,
    initialOpenReferenceRatio: 0.10,
    minimumOpenReferenceRatio: 0.055,
    maximumOpenReferenceRatio: 0.24,
    openReferenceRiseAlpha: 0.24,
    openReferenceFallAlpha: 0.035,
    fistEnterFraction: 0.72,
    fistExitFraction: 0.88,
    minimumFistRatio: 0.025,
    minimumThresholdGap: 0.012,
    confirmationMs: 110,
    releaseMs: 80,
    unknownAfterMs: 260,
    armOpenness: 0.84,
    activationOpenness: 0.72,
    minimumActivationConfidence: 0.08,
    targetLatchClosure: 0.10,
    targetReleaseClosure: 0.04,
    clickCooldownMs: 420
  },
  startupCheck: {
    holdMs: 1400,
    maximumStillSpeed: 0.18,
    minimumHandSeparation: 0.16,
    requireShoulders: true,
    requireOpenHands: false
  },
  scheduler: {
    poseFreshnessMs: 260,
    emptyFrameIntervalMs: 100,

    // Compatibilidade com módulos de pesquisa antigos.
    defaultHandRate: 24,
    handRates: [30, 24, 18, 12],
    inferenceThresholdsMs: [22, 34, 52],
    shoulderIntervalMs: 110,
    shoulderFreshnessMs: 360,
    shoulderLostAfterMs: 320,
    workerInitializationTimeoutMs: 15000,
    maximumMissingHandMs: 180,
    reacquireResetMs: 260
  },
  calibration: {
    holdMs: 1400,
    minimumSamplesPerHand: 20,
    minimumOpenness: 0,
    maximumStillSpeed: 0.18,
    stillSpeedScaleMultiplier: 1,
    minimumSeparation: 0.16,
    separationScaleMultiplier: 1,
    raisedShoulderTolerance: 0.02,
    jitterRestMultiplier: 3.1,
    palmScaleRestMultiplier: 0.009,
    restRadiusMinimum: 0.001,
    restRadiusMaximum: 0.015,
    minimumCutoffBase: 1.48,
    minimumCutoffNoiseMultiplier: 5,
    minimumCutoffFloor: 0.82,
    betaBase: 0.17,
    betaNoiseMultiplier: 0.95,
    betaMaximum: 0.31,
    derivativeCutoff: 1
  },
  output: {
    velocityMinimumForPrediction: 0.35,
    maximumVisualPredictionMs: 0,
    maximumCollisionPredictionMs: 14,
    maximumPacketAgePredictionMs: 18
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
  const filter = HAND_SYSTEM_CONFIG.filter;
  const visual = HAND_SYSTEM_CONFIG.visual;
  const gesture = HAND_SYSTEM_CONFIG.gesture;
  return [
    HAND_SYSTEM_VERSION,
    HAND_SYSTEM_CONFIG.system.productionEngine,
    HAND_SYSTEM_CONFIG.system.visualResponse,
    detector.tasksVersion,
    detector.poseDetectionConfidence,
    detector.poseTrackingConfidence,
    filter.wristRestDeadZone,
    visual.mode,
    visual.restEnterDistance,
    visual.maximumLagDistance,
    gesture.fistEnterFraction,
    gesture.minimumVisibleTips,
    HAND_SYSTEM_CONFIG.startupCheck.holdMs
  ].join(':');
}
