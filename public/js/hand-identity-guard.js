import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const CONFIG = HAND_SYSTEM_CONFIG.identity;
const GROUPS = Object.freeze({
  left: Object.freeze([15, 17, 19, 21]),
  right: Object.freeze([16, 18, 20, 22])
});

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function pointVisible(point, threshold = CONFIG.minimumVisibility) {
  return finitePoint(point)
    && (point.visibility ?? 0) >= threshold;
}

function copyPoint(point) {
  return point
    ? { ...point }
    : { x: 0.5, y: 0.5, z: 0, visibility: 0, presence: 0 };
}

function hiddenPoint(point) {
  return {
    ...copyPoint(point),
    visibility: 0,
    presence: 0
  };
}

function extractGroup(pose, side) {
  const indices = GROUPS[side];
  const points = indices.map((index) => copyPoint(pose?.[index]));
  const wristVisible = pointVisible(points[0]);
  const supportCount = points
    .slice(1)
    .filter((point) => pointVisible(point, CONFIG.palmSupportVisibility))
    .length;
  const palmSupported = finitePoint(points[0])
    && supportCount >= CONFIG.minimumPalmSupportPoints;

  if (!wristVisible && palmSupported) {
    // A posição continua sendo a estimativa original do pulso. Os pontos dos
    // dedos apenas confirmam que a palma existe; nenhuma coordenada é trocada.
    points[0].visibility = Math.max(
      points[0].visibility ?? 0,
      CONFIG.palmTrustedWristVisibility
    );
    points[0].presence = Math.max(
      points[0].presence ?? 0,
      CONFIG.palmTrustedWristVisibility
    );
  }

  return {
    points,
    visible: wristVisible || palmSupported
  };
}

function writeGroups(pose, leftGroup, rightGroup) {
  const output = pose.map(copyPoint);

  for (let index = 0; index < GROUPS.left.length; index += 1) {
    output[GROUPS.left[index]] = leftGroup
      ? copyPoint(leftGroup.points[index])
      : hiddenPoint(pose?.[GROUPS.left[index]]);
    output[GROUPS.right[index]] = rightGroup
      ? copyPoint(rightGroup.points[index])
      : hiddenPoint(pose?.[GROUPS.right[index]]);
  }

  return output;
}

/**
 * Preserva estritamente a identidade anatômica produzida pelo Pose Landmarker.
 *
 * Não há associação por proximidade, previsão, troca de emergência, rejeição
 * de salto ou reaproveitamento do rastro oposto. Os índices 15/17/19/21 são
 * sempre a mão esquerda e 16/18/20/22 são sempre a mão direita.
 */
export class HandIdentityGuard {
  reset() {
    // Mantido por compatibilidade com o pipeline do celular. Não existe estado
    // de identidade para acumular ou reaproveitar entre quadros.
  }

  stabilize(pose) {
    if (!Array.isArray(pose)) return pose;

    const left = extractGroup(pose, 'left');
    const right = extractGroup(pose, 'right');

    return writeGroups(
      pose,
      left.visible ? left : null,
      right.visible ? right : null
    );
  }
}

export function createHandIdentityGuard() {
  return new HandIdentityGuard();
}
