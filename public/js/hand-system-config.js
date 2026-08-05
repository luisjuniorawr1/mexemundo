export const HAND_SYSTEM_VERSION = '1.6.2';
export const HAND_PROFILE_VERSION = 2;
export const HAND_PROFILE_SCOPE = 'universal-two-hand';
export const HAND_PROFILE_KEY = 'mexemundo-universal-hand-profile-v2';
export const MEDIAPIPE_TASKS_VERSION = '0.10.22-rc.20250304';

const config = {
  system: {
    version: HAND_SYSTEM_VERSION,
    inputVersion: 8,
    profileVersion: HAND_PROFILE_VERSION,
    profileScope: HAND_PROFILE_SCOPE,
    referenceVersion: '0.6.0',
    productionEngine: 'pose-landmarker-lite-single-pass',
    visualResponse: 'mexeflow-v2-anti-pull',
    identityGuard: 'sticky-anatomical-two-hand-v2',
    handPresence: 'short-dropout-bridge-v1',
    menuActivation: 'stable-dwell-v1',
    handInterface: 'universal-dwell-controls-v1'
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
  presence: {
    visualGraceMs: 220,
    collisionGraceMs: 80
  },
  identity: {
    minimumVisibility: 0.18,
    trustedWristVisibility: 0.32,
    sourceLabelBias: 0.06,
    switchMargin: 0.03,
    switchConfirmMs: 170,
    maximumPredictionMs: 70,
    velocityBlend: 0.34,
    maximumAcceptedJump: 0.18,
    lostResetMs: 520
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
    mode: 'mexeflow-v2-anti-pull',
    minimumDeltaMs: 4,
    maximumDeltaMs: 45,
    restEnterSpeed: 0.14,
    restExitSpeed: 0.30,
    restEnterDistance: 0.0045,
    restExitDistance: 0.010,
    restHoldMs: 110,
    restMicroDeadZone: 0.0022,
    restFollowHalfLifeMs: 190,
    slowHalfLifeMs: 44,
    fastHalfLifeMs: 8,
    fastResponseSpeed: 0.90,
    fastResponseDistance: 0.052,
    maximumLagDistance: 0.028,
    lagCatchUpHalfLifeMs: 34,
    maximumStepBase: 0.010,
    maximumStepSpeedGain: 1.45,
    maximumStepDistance: 0.050,
    reacquireResetMs: 360,
    missingGraceMs: 180
  },
  menu: {
    preferredHand: 'right',
    fallbackHand: 'left',
    dwellMs: 5000,
    stableStepDistance: 0.008,
    maximumRecoverableStepDistance: 0.026,
    unstableDecayMultiplier: 0.65,
    maximumFrameDeltaMs: 55,
    targetExitMarginPx: 58,
    missingGraceMs: 240,
    cooldownMs: 1200
  },
  interface: {
    preferredHand: 'right',
    fallbackHand: 'left',
    defaultDwellMs: 2600,
    resultDwellMs: 2200,
    playingDwellMs: 4200,
    stableStepDistance: 0.009,
    maximumRecoverableStepDistance: 0.030,
    unstableDecayMultiplier: 0.55,
    maximumFrameDeltaMs: 55,
    targetExitMarginPx: 68,
    missingGraceMs: 240,
    cooldownMs: 1100
  },
  gesture: {
    sideUsedForMenus: 'right',
    minimumVisibility: 0.14,
    minimumVisibleTips: 1,
    bootstrapMs: 120,
    initialOpenReferenceRatio: 0.10,
    minimumOpenReferenceRatio: 0.045,
    maximumOpenReferenceRatio: 0.25,
    openReferenceRiseAlpha: 0.28,
    openReferenceFallAlpha: 0.04,
    openReferenceFallFloor: 0.94,
    fistEnterFraction: 0.86,
    fistExitFraction: 0.96,
    minimumFistRatio: 0.020,
    minimumThresholdGap: 0.008,
    confirmationMs: 90,
    releaseMs: 70,
    unknownAfterMs: 300,
    armOpenness: 0.93,
    activationOpenness: 0.88,
    releaseOpenness: 0.95,
    compressionConfirmationMs: 90,
    minimumActivationConfidence: 0.04,
    targetLatchClosure: 0.08,
    targetReleaseClosure: 0.03,
    clickCooldownMs: 420
  },
  startupCheck: {
    holdMs: 950,
    maximumStillSpeed: 0.26,
    minimumVisibleHands: 1,
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
  const identity = HAND_SYSTEM_CONFIG.identity;
  const filter = HAND_SYSTEM_CONFIG.filter;
  const visual = HAND_SYSTEM_CONFIG.visual;
  const menu = HAND_SYSTEM_CONFIG.menu;
  const handInterface = HAND_SYSTEM_CONFIG.interface;
  const gesture = HAND_SYSTEM_CONFIG.gesture;
  return [
    HAND_SYSTEM_VERSION,
    HAND_SYSTEM_CONFIG.system.productionEngine,
    HAND_SYSTEM_CONFIG.system.visualResponse,
    HAND_SYSTEM_CONFIG.system.identityGuard,
    HAND_SYSTEM_CONFIG.system.handPresence,
    HAND_SYSTEM_CONFIG.system.menuActivation,
    HAND_SYSTEM_CONFIG.system.handInterface,
    detector.tasksVersion,
    detector.poseDetectionConfidence,
    detector.poseTrackingConfidence,
    identity.trustedWristVisibility,
    identity.sourceLabelBias,
    identity.switchConfirmMs,
    identity.maximumAcceptedJump,
    filter.wristRestDeadZone,
    visual.mode,
    visual.restEnterDistance,
    visual.maximumLagDistance,
    visual.maximumStepDistance,
    menu.dwellMs,
    menu.stableStepDistance,
    handInterface.defaultDwellMs,
    handInterface.playingDwellMs,
    gesture.fistEnterFraction,
    gesture.activationOpenness,
    gesture.minimumVisibleTips,
    HAND_SYSTEM_CONFIG.startupCheck.minimumVisibleHands,
    HAND_SYSTEM_CONFIG.startupCheck.holdMs
  ].join(':');
}
