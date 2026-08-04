const UNIVERSAL_PROFILE_KEY = 'mexemundo-universal-hand-profile-v1';
const LEGACY_PROFILE_KEYS = [
  'mexemundo-game-hand-profile-v1',
  'mexemundo-hand-calibration-v2',
  'mexemundo-hand-calibration-v1'
];

export const HAND_PROFILE_VERSION = 1;
export const HAND_PROFILE_SCOPE = 'universal-two-hand';

function validHandProfile(hand) {
  return hand
    && typeof hand === 'object'
    && Number.isFinite(Number(hand.restRadius))
    && Number.isFinite(Number(hand.minCutoff))
    && Number.isFinite(Number(hand.beta));
}

export function isUniversalHandProfile(profile) {
  return Boolean(
    profile
    && typeof profile === 'object'
    && Number(profile.version) === HAND_PROFILE_VERSION
    && Array.isArray(profile.hands)
    && profile.hands.length === 2
    && profile.hands.every(validHandProfile)
  );
}

function normalizedProfile(profile) {
  return {
    ...profile,
    version: HAND_PROFILE_VERSION,
    scope: HAND_PROFILE_SCOPE,
    engine: profile.engine || 'mediapipe-hand-landmarker',
    hands: profile.hands.map((hand) => ({ ...hand }))
  };
}

export function loadUniversalHandProfile() {
  try {
    const current = localStorage.getItem(UNIVERSAL_PROFILE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      if (isUniversalHandProfile(parsed)) return normalizedProfile(parsed);
    }

    for (const key of LEGACY_PROFILE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!isUniversalHandProfile(parsed)) continue;
      const migrated = normalizedProfile(parsed);
      localStorage.setItem(UNIVERSAL_PROFILE_KEY, JSON.stringify(migrated));
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
  localStorage.setItem(UNIVERSAL_PROFILE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearUniversalHandProfile() {
  localStorage.removeItem(UNIVERSAL_PROFILE_KEY);
}

export function universalHandProfileKey() {
  return UNIVERSAL_PROFILE_KEY;
}
