import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const jsDirectory = path.join(root, 'public', 'js');
const gameFiles = fs.readdirSync(jsDirectory)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({
    name,
    content: fs.readFileSync(path.join(jsDirectory, name), 'utf8')
  }))
  .filter(({ content }) => /role:\s*['"]tv['"]/.test(content));

const legacyGamesPendingMigration = new Set(['tv.js', 'goalkeeper.js']);
const forbiddenGamePatterns = [
  { pattern: /@mediapipe\/tasks-vision/, reason: 'importar MediaPipe diretamente' },
  { pattern: /HandLandmarker|PoseLandmarker/, reason: 'instanciar detectores próprios' },
  { pattern: /minHandDetectionConfidence|minHandPresenceConfidence|minTrackingConfidence/, reason: 'definir confiança de rastreamento' },
  { pattern: /localStorage\.(?:getItem|setItem).*hand/i, reason: 'criar perfil de mãos próprio' },
  { pattern: /new\s+StableTurboPointFilter/, reason: 'criar filtro temporal próprio' }
];

test('configuração geral das mãos possui uma única fonte', () => {
  const config = fs.readFileSync(path.join(jsDirectory, 'hand-system-config.js'), 'utf8');
  assert.match(config, /HAND_SYSTEM_VERSION/);
  assert.match(config, /numberOfHands:\s*2/);
  assert.match(config, /HAND_PROFILE_KEY\s*=\s*['"]mexemundo-universal-hand-profile-v1['"]/);
});

test('perfil universal depende da versão do sistema', () => {
  const profile = fs.readFileSync(path.join(jsDirectory, 'hand-profile.js'), 'utf8');
  assert.match(profile, /handSystemFingerprint/);
  assert.match(profile, /HAND_SYSTEM_VERSION/);
});

test('todo jogo novo consome a entrada universal', () => {
  for (const game of gameFiles) {
    if (legacyGamesPendingMigration.has(game.name)) continue;

    assert.match(
      game.content,
      /from\s+['"]\.\/game-hand-input\.js['"]/,
      `${game.name} deve importar UniversalHandInput.`
    );

    for (const forbidden of forbiddenGamePatterns) {
      assert.doesNotMatch(
        game.content,
        forbidden.pattern,
        `${game.name} não pode ${forbidden.reason}.`
      );
    }
  }
});

test('somente o núcleo controla o perfil universal', () => {
  const profileOwners = gameFiles.filter(({ content }) => (
    /mexemundo-universal-hand-profile-v1/.test(content)
    || /saveUniversalHandProfile/.test(content)
  ));
  assert.deepEqual(profileOwners, []);
});
