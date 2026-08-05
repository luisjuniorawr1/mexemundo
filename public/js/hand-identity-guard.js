import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const CONFIG = HAND_SYSTEM_CONFIG.identity;
const GROUPS = Object.freeze({
  left: Object.freeze([15, 17, 19, 21]),
  right: Object.freeze([16, 18, 20, 22])
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function pointVisible(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && (point.visibility ?? 0) >= CONFIG.minimumVisibility;
}

function mirrored(point) {
  return {
    x: clamp(1 - point.x),
    y: clamp(point.y)
  };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
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

function copyGroup(group) {
  if (!group) return null;
  const points = group.points.map(copyPoint);
  return {
    side: group.side,
    points,
    wrist: points[0],
    visible: Boolean(group.visible)
  };
}

function trustedGroup(group) {
  const trusted = copyGroup(group);
  if (!trusted) return null;

  // O guardião já validou a trajetória. Mantém somente o pulso acima do
  // limiar do filtro final; os dedos preservam a confiança original.
  trusted.points[0].visibility = Math.max(
    trusted.points[0].visibility ?? 0,
    CONFIG.trustedWristVisibility
  );
  trusted.points[0].presence = Math.max(
    trusted.points[0].presence ?? 0,
    CONFIG.trustedWristVisibility
  );
  trusted.wrist = trusted.points[0];
  trusted.visible = true;
  return trusted;
}

function extractGroup(pose, side) {
  const indices = GROUPS[side];
  const points = indices.map((index) => copyPoint(pose?.[index]));
  return {
    side,
    points,
    wrist: points[0],
    visible: pointVisible(points[0])
  };
}

class IdentityTrack {
  constructor() {
    this.reset();
  }

  reset() {
    this.ready = false;
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.lastAt = 0;
    this.lastAcceptedAt = 0;
  }

  predict(now) {
    if (!this.ready) return null;
    const predictionSeconds = Math.min(
      CONFIG.maximumPredictionMs,
      Math.max(0, now - this.lastAt)
    ) / 1000;
    return {
      x: clamp(this.x + this.vx * predictionSeconds),
      y: clamp(this.y + this.vy * predictionSeconds)
    };
  }

  cost(point, now) {
    const predicted = this.predict(now);
    return predicted ? distance(predicted, mirrored(point)) : 0;
  }

  update(group, now) {
    const next = mirrored(group.wrist);
    if (!this.ready) {
      this.ready = true;
      this.x = next.x;
      this.y = next.y;
      this.vx = 0;
      this.vy = 0;
    } else {
      const dt = clamp((now - this.lastAt) / 1000, 1 / 120, 0.09);
      const rawVx = (next.x - this.x) / dt;
      const rawVy = (next.y - this.y) / dt;
      this.vx += (rawVx - this.vx) * CONFIG.velocityBlend;
      this.vy += (rawVy - this.vy) * CONFIG.velocityBlend;
      this.x = next.x;
      this.y = next.y;
    }

    this.lastAt = now;
    this.lastAcceptedAt = now;
  }

  stale(now) {
    return !this.ready
      || !this.lastAcceptedAt
      || now - this.lastAcceptedAt > CONFIG.lostResetMs;
  }
}

/**
 * Mantém a identidade física das mãos quando elas cruzam, se aproximam ou
 * quando o Pose Landmarker troca temporariamente os lados detectados.
 *
 * A identidade informada pelo Pose é a referência principal. Uma troca só é
 * aceita quando as duas mãos permanecem visíveis e a evidência persiste. Uma
 * mão isolada nunca rouba o rastro da outra.
 */
export class HandIdentityGuard {
  constructor() {
    this.tracks = {
      left: new IdentityTrack(),
      right: new IdentityTrack()
    };
    this.resetAssignment();
  }

  resetAssignment() {
    this.assignment = 'direct';
    this.candidate = 'direct';
    this.candidateSince = 0;
    this.lastResolvedAt = 0;
  }

  reset() {
    this.tracks.left.reset();
    this.tracks.right.reset();
    this.resetAssignment();
  }

  writeGroups(pose, leftGroup, rightGroup) {
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

  accept(side, group, now) {
    if (!group) return null;
    const track = this.tracks[side];

    if (track.stale(now)) {
      track.reset();
      track.update(group, now);
      return trustedGroup(group);
    }

    if (track.cost(group.wrist, now) > CONFIG.maximumAcceptedJump) {
      // A ponte universal tratará a perda com tempos diferentes para visual
      // e colisão. O guardião não inventa uma medição nem troca sua identidade.
      return null;
    }

    track.update(group, now);
    return trustedGroup(group);
  }

  updateAssignment(source, now) {
    if (!this.tracks.left.ready || !this.tracks.right.ready) {
      this.assignment = 'direct';
      this.candidate = 'direct';
      this.candidateSince = 0;
      return;
    }

    const directCost = this.tracks.left.cost(source.left.wrist, now)
      + this.tracks.right.cost(source.right.wrist, now);
    const swappedCost = this.tracks.left.cost(source.right.wrist, now)
      + this.tracks.right.cost(source.left.wrist, now)
      + CONFIG.sourceLabelBias;

    let proposed = this.assignment;
    if (swappedCost + CONFIG.switchMargin < directCost) {
      proposed = 'swapped';
    } else if (directCost + CONFIG.switchMargin < swappedCost) {
      proposed = 'direct';
    }

    if (proposed === this.assignment) {
      this.candidate = this.assignment;
      this.candidateSince = 0;
      return;
    }

    if (this.candidate !== proposed) {
      this.candidate = proposed;
      this.candidateSince = now;
      return;
    }

    if (now - this.candidateSince >= CONFIG.switchConfirmMs) {
      this.assignment = proposed;
      this.candidate = proposed;
      this.candidateSince = 0;
    }
  }

  stabilize(pose, now = performance.now()) {
    if (!Array.isArray(pose)) return pose;

    const source = {
      left: extractGroup(pose, 'left'),
      right: extractGroup(pose, 'right')
    };
    const bothVisible = source.left.visible && source.right.visible;
    const anyVisible = source.left.visible || source.right.visible;

    let proposedLeft = null;
    let proposedRight = null;

    if (bothVisible) {
      this.updateAssignment(source, now);
      if (this.assignment === 'swapped') {
        proposedLeft = source.right;
        proposedRight = source.left;
      } else {
        proposedLeft = source.left;
        proposedRight = source.right;
      }
    } else if (source.left.visible) {
      // Uma mão isolada conserva o lado anatômico informado pelo Pose.
      proposedLeft = source.left;
      this.candidate = this.assignment;
      this.candidateSince = 0;
    } else if (source.right.visible) {
      proposedRight = source.right;
      this.candidate = this.assignment;
      this.candidateSince = 0;
    }

    const stableLeft = this.accept('left', proposedLeft, now);
    const stableRight = this.accept('right', proposedRight, now);

    if (stableLeft || stableRight || anyVisible) {
      this.lastResolvedAt = now;
    } else if (
      this.lastResolvedAt
      && now - this.lastResolvedAt > CONFIG.lostResetMs
    ) {
      this.reset();
      return pose;
    }

    return this.writeGroups(pose, stableLeft, stableRight);
  }
}

export function createHandIdentityGuard() {
  return new HandIdentityGuard();
}
