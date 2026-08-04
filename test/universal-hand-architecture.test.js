import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const jsDirectory = path.join(root, 'public', 'js');
const gameFiles = ['tv.js', 'goalkeeper.js'].map((name) => ({
  name,
  content: fs.readFileSync(path.join(jsDirectory, name), 'utf8')
}));

const forbiddenGamePatterns = [
  { pattern: /@mediapipe\/tasks-vision/, reason: 'importar MediaPipe diretamente' },
  { pattern: /HandLandmarker|PoseLandmarker/, reason: 'instanciar detectores próprios' },
  { pattern: /minHandDetectionConfidence|minHandPresenceConfidence|minTrackingConfidence/, reason: 'definir confiança de rastreamento' },
  { pattern: /localStorage\.(?:getItem|setItem).*hand/i, reason: 'criar perfil de mãos próprio' },
  { pattern: /calibratedDeadZone|sessionDeadZone|StableTurboPointFilter/, reason: 'criar filtro ou zona morta própria' }
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

test('todos os jogos consomem a entrada universal', () => {
  for (const game of gameFiles) {
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

test('jogos separam posição visual e trajetória de colisão', () => {
  for (const game of gameFiles) {
    assert.match(game.content, /\.visual/, `${game.name} deve usar a saída visual.`);
    assert.match(game.content, /\.collision/, `${game.name} deve usar a saída de colisão.`);
  }
});

test('menu abre sem criar uma segunda calibração', () => {
  const menu = fs.readFileSync(path.join(jsDirectory, 'menu.js'), 'utf8');
  assert.match(menu, /from\s+['"]\.\/game-hand-input\.js['"]/);
  assert.match(menu, /from\s+['"]\.\/universal-menu-cursor\.js['"]/);
  assert.match(menu, /showMenu\(\)/);
  assert.doesNotMatch(
    menu,
    /buildMotionProfile|getMotionProfile|saveMotionProfile|clearMotionProfile|CALIBRATION_MS|MIN_CALIBRATION_SAMPLES/,
    'O menu não pode criar ou aguardar um perfil legado.'
  );
});
