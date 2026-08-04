import {
  HAND_PROFILE_KEY,
  HAND_PROFILE_SCOPE,
  HAND_PROFILE_VERSION,
  HAND_SYSTEM_VERSION,
  handSystemFingerprint
} from './hand-system-config.js';

const LEGACY_PROFILE_KEYS = [
  'mexemundo-game-hand-profile-v1',
  'mexemundo-hand-calibration-v2',
  'mexemundo-hand-calibration-v1'
];

export { HAND_PROFILE_VERSION, HAND_PROFILE_SCOPE };

function validHandProfile(hand) {
  return hand
    && typeof hand === 'object'
    && Number.isFinite(Number(hand.restRadius))
    && Number.isFinite(Number(hand.minCutoff))
    && Number.isFinite(Number(hand.beta));
}

function structurallyValid(profile) {
  return Boolean(
    profile
    && typeof profile === 'object'
    && Number(profile.version) === HAND_PROFILE_VERSION
    && Array.isArray(profile.hands)
    && profile.hands.length === 2
    && profile.hands.every(validHandProfile)
  );
}

export function isUniversalHandProfile(profile) {
  if (!structurallyValid(profile)) return false;
  const fingerprint = String(profile.systemFingerprint || '');
  return !fingerprint || fingerprint === handSystemFingerprint();
}

function normalizedProfile(profile) {
  return {
    ...profile,
    version: HAND_PROFILE_VERSION,
    scope: HAND_PROFILE_SCOPE,
    engine: profile.engine || 'mediapipe-hand-landmarker',
    systemVersion: HAND_SYSTEM_VERSION,
    systemFingerprint: handSystemFingerprint(),
    hands: profile.hands.map((hand) => ({ ...hand }))
  };
}

function readProfile(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return isUniversalHandProfile(parsed) ? normalizedProfile(parsed) : null;
}

export function loadUniversalHandProfile() {
  try {
    const current = readProfile(HAND_PROFILE_KEY);
    if (current) {
      localStorage.setItem(HAND_PROFILE_KEY, JSON.stringify(current));
      return current;
    }

    for (const key of LEGACY_PROFILE_KEYS) {
      const migrated = readProfile(key);
      if (!migrated) continue;
      localStorage.setItem(HAND_PROFILE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    return null;
  }
  return null;
}

export function saveUniversalHandProfile(profile) {
  const normalized = normalizedProfile(profile);
  if (!isUniversalHandProfile(normalized)) {
    throw new Error('Perfil universal de mãos inválido.');
  }
  localStorage.setItem(HAND_PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearUniversalHandProfile() {
  localStorage.removeItem(HAND_PROFILE_KEY);
}

export function universalHandProfileKey() {
  return HAND_PROFILE_KEY;
}
