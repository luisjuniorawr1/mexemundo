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

  update(point, now) {
    const next = mirrored(point);
    if (!this.ready) {
      this.ready = true;
      this.x = next.x;
      this.y = next.y;
      this.vx = 0;
      this.vy = 0;
      this.lastAt = now;
      return;
    }

    const dt = clamp((now - this.lastAt) / 1000, 1 / 120, 0.09);
    const rawVx = (next.x - this.x) / dt;
    const rawVy = (next.y - this.y) / dt;
    this.vx += (rawVx - this.vx) * CONFIG.velocityBlend;
    this.vy += (rawVy - this.vy) * CONFIG.velocityBlend;
    this.x = next.x;
    this.y = next.y;
    this.lastAt = now;
  }
}

/**
 * Mantém a identidade física das mãos quando elas cruzam, se aproximam ou
 * quando o Pose Landmarker troca temporariamente os lados detectados.
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

  stabilize(pose, now = performance.now()) {
    if (!Array.isArray(pose)) return pose;

    const source = {
      left: extractGroup(pose, 'left'),
      right: extractGroup(pose, 'right')
    };
    const anyVisible = source.left.visible || source.right.visible;
    if (!anyVisible) {
      if (
        this.lastResolvedAt
        && now - this.lastResolvedAt > CONFIG.lostResetMs
      ) this.reset();
      return pose;
    }

    let stableLeft = null;
    let stableRight = null;

    if (source.left.visible && source.right.visible) {
      if (!this.tracks.left.ready || !this.tracks.right.ready) {
        stableLeft = source.left;
        stableRight = source.right;
        this.assignment = 'direct';
      } else {
        const directCost = this.tracks.left.cost(source.left.wrist, now)
          + this.tracks.right.cost(source.right.wrist, now);
        const swappedCost = this.tracks.left.cost(source.right.wrist, now)
          + this.tracks.right.cost(source.left.wrist, now);

        let proposed = this.assignment;
        if (swappedCost + CONFIG.switchMargin < directCost) {
          proposed = 'swapped';
        } else if (directCost + CONFIG.switchMargin < swappedCost) {
          proposed = 'direct';
        }

        if (proposed !== this.assignment) {
          if (this.candidate !== proposed) {
            this.candidate = proposed;
            this.candidateSince = now;
          } else if (now - this.candidateSince >= CONFIG.switchConfirmMs) {
            this.assignment = proposed;
          }
        } else {
          this.candidate = this.assignment;
          this.candidateSince = 0;
        }

        const frameAssignment = Math.abs(directCost - swappedCost)
          >= CONFIG.emergencySwapAdvantage
          ? proposed
          : this.assignment;

        if (frameAssignment === 'swapped') {
          stableLeft = source.right;
          stableRight = source.left;
        } else {
          stableLeft = source.left;
          stableRight = source.right;
        }
      }
    } else {
      const onlyGroup = source.left.visible ? source.left : source.right;
      const leftCost = this.tracks.left.ready
        ? this.tracks.left.cost(onlyGroup.wrist, now)
        : Infinity;
      const rightCost = this.tracks.right.ready
        ? this.tracks.right.cost(onlyGroup.wrist, now)
        : Infinity;

      if (leftCost === Infinity && rightCost === Infinity) {
        if (onlyGroup.side === 'left') stableLeft = onlyGroup;
        else stableRight = onlyGroup;
      } else if (leftCost <= rightCost) {
        stableLeft = onlyGroup;
      } else {
        stableRight = onlyGroup;
      }
    }

    const accept = (side, group) => {
      if (!group) return null;
      const track = this.tracks[side];
      if (
        track.ready
        && track.cost(group.wrist, now) > CONFIG.maximumAcceptedJump
      ) return null;
      track.update(group.wrist, now);
      return group;
    };

    stableLeft = accept('left', stableLeft);
    stableRight = accept('right', stableRight);
    this.lastResolvedAt = now;
    return this.writeGroups(pose, stableLeft, stableRight);
  }
}

export function createHandIdentityGuard() {
  return new HandIdentityGuard();
}
