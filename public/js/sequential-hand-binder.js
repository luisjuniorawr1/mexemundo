import { HAND_SYSTEM_CONFIG } from './hand-system-config.js';

const SOURCE_GROUPS = Object.freeze({
  left: Object.freeze({
    shoulder: 11,
    elbow: 13,
    wrist: 15,
    supports: Object.freeze([17, 19, 21])
  }),
  right: Object.freeze({
    shoulder: 12,
    elbow: 14,
    wrist: 16,
    supports: Object.freeze([18, 20, 22])
  })
});

const PHYSICAL_SIDES = Object.freeze(['right', 'left']);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function visibility(point) {
  return finitePoint(point) ? Number(point.visibility ?? 0) : 0;
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

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function averagePoint(points) {
  if (!points.length) return null;
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y
  }), { x: 0, y: 0 });
  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function median(values, fallback = 0) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return fallback;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
}

function extractGroup(pose, source, config) {
  const map = SOURCE_GROUPS[source];
  const shoulder = copyPoint(pose?.[map.shoulder]);
  const elbow = copyPoint(pose?.[map.elbow]);
  const wrist = copyPoint(pose?.[map.wrist]);
  const supports = map.supports.map((index) => copyPoint(pose?.[index]));
  const visibleSupports = supports.filter(
    (point) => visibility(point) >= config.supportVisibility
  );
  const supportCenter = averagePoint(visibleSupports);
  const wristVisibility = visibility(wrist);
  const strongestSupports = visibleSupports
    .map(visibility)
    .sort((a, b) => b - a)
    .slice(0, config.minimumSupportPoints);
  const supportEvidence = strongestSupports.length >= config.minimumSupportPoints
    ? strongestSupports.reduce((sum, value) => sum + value, 0) / strongestSupports.length
    : 0;
  const anchor = wristVisibility >= config.wristVisibility
    ? { x: wrist.x, y: wrist.y }
    : supportCenter;
  const shoulderVisible = visibility(shoulder) >= config.armVisibility;
  const elbowVisible = visibility(elbow) >= config.armVisibility;
  const evidence = Math.max(wristVisibility, supportEvidence) * 0.72
    + Math.min(visibility(elbow), 1) * 0.14
    + Math.min(visibility(shoulder), 1) * 0.14;
  const raised = Boolean(
    anchor
    && shoulderVisible
    && anchor.y <= shoulder.y + config.raiseShoulderTolerance
  );

  return {
    source,
    map,
    shoulder,
    elbow,
    wrist,
    supports,
    visibleSupports,
    supportCenter,
    anchor,
    evidence,
    raised,
    elbowVisible,
    shoulderVisible
  };
}

class SensorRuntimeState {
  constructor() {
    this.reset();
  }

  reset() {
    this.ready = false;
    this.x = 0.5;
    this.y = 0.5;
    this.lastValidAt = 0;
  }

  hold(now, config) {
    if (!this.ready || now - this.lastValidAt > config.dropoutHoldMs) return null;
    return { x: this.x, y: this.y, held: true };
  }

  accept(point, now) {
    this.ready = true;
    this.x = clamp(point.x);
    this.y = clamp(point.y);
    this.lastValidAt = now;
    return { x: this.x, y: this.y, held: false };
  }
}

/**
 * Configura um sensor por vez e prende cada sensor ao grupo bruto capturado.
 * Depois da configuração não existe reatribuição entre direita e esquerda.
 */
export class SequentialHandBinder {
  constructor(config = HAND_SYSTEM_CONFIG.sensorCalibration) {
    this.config = config;
    this.runtime = {
      left: new SensorRuntimeState(),
      right: new SensorRuntimeState()
    };
    this.reset();
  }

  reset() {
    this.stage = 'right';
    this.bindings = { left: null, right: null };
    this.models = { left: null, right: null };
    this.candidateSource = null;
    this.candidateSince = 0;
    this.lastCandidateAnchor = null;
    this.samples = [];
    this.progress = 0;
    this.reason = 'show-right';
    this.runtime.left.reset();
    this.runtime.right.reset();
  }

  get ready() {
    return this.stage === 'ready';
  }

  status() {
    return {
      stage: this.stage,
      progress: this.ready ? 1 : this.progress,
      ready: this.ready,
      reason: this.reason,
      bindings: this.ready ? { ...this.bindings } : undefined
    };
  }

  resetCandidate(reason) {
    this.candidateSource = null;
    this.candidateSince = 0;
    this.lastCandidateAnchor = null;
    this.samples = [];
    this.progress = 0;
    this.reason = reason;
  }

  selectCalibrationCandidate(pose) {
    const usedSource = this.stage === 'left' ? this.bindings.right : null;
    const groups = Object.keys(SOURCE_GROUPS)
      .filter((source) => source !== usedSource)
      .map((source) => extractGroup(pose, source, this.config));
    const active = groups
      .filter((group) => (
        group.anchor
        && group.raised
        && group.evidence >= this.config.minimumEvidence
      ))
      .sort((first, second) => second.evidence - first.evidence);

    if (!active.length) {
      return {
        group: null,
        reason: this.stage === 'right' ? 'show-right' : 'show-left'
      };
    }

    if (
      active.length > 1
      && active[0].evidence - active[1].evidence
        < this.config.minimumEvidenceAdvantage
    ) {
      return { group: null, reason: 'lower-other-hand' };
    }

    return { group: active[0], reason: 'hold-still' };
  }

  sampleModel(group) {
    const wristStrong = visibility(group.wrist) >= this.config.wristVisibility;
    const supportReady = group.visibleSupports.length >= this.config.minimumSupportPoints;
    const offset = wristStrong && supportReady && group.supportCenter
      ? {
          x: group.wrist.x - group.supportCenter.x,
          y: group.wrist.y - group.supportCenter.y
        }
      : null;

    return { offset };
  }

  completeStage(group) {
    const side = this.stage;
    const offsets = this.samples.map((sample) => sample.offset).filter(Boolean);
    this.bindings[side] = group.source;
    this.models[side] = {
      source: group.source,
      offset: offsets.length
        ? {
            x: median(offsets.map((offset) => offset.x)),
            y: median(offsets.map((offset) => offset.y))
          }
        : { x: 0, y: 0 }
    };

    if (side === 'right') {
      this.stage = 'left';
      this.resetCandidate('show-left');
      return;
    }

    this.stage = 'ready';
    this.progress = 1;
    this.reason = 'ready';
    this.candidateSource = null;
    this.lastCandidateAnchor = null;
    this.samples = [];
  }

  calibrate(pose, now) {
    const selected = this.selectCalibrationCandidate(pose);
    const group = selected.group;
    if (!group) {
      this.resetCandidate(selected.reason);
      return this.status();
    }

    if (this.candidateSource !== group.source) {
      this.candidateSource = group.source;
      this.candidateSince = now;
      this.lastCandidateAnchor = group.anchor;
      this.samples = [this.sampleModel(group)];
      this.progress = 0;
      this.reason = 'hold-still';
      return this.status();
    }

    if (
      this.lastCandidateAnchor
      && distance(group.anchor, this.lastCandidateAnchor)
        > this.config.maximumStillStep
    ) {
      this.candidateSince = now;
      this.lastCandidateAnchor = group.anchor;
      this.samples = [this.sampleModel(group)];
      this.progress = 0;
      this.reason = 'hold-still';
      return this.status();
    }

    this.lastCandidateAnchor = group.anchor;
    this.samples.push(this.sampleModel(group));
    if (this.samples.length > this.config.maximumCalibrationSamples) {
      this.samples.shift();
    }
    this.progress = clamp((now - this.candidateSince) / this.config.holdMs);
    this.reason = 'hold-still';

    if (
      this.progress >= 1
      && this.samples.length >= this.config.minimumCalibrationSamples
    ) {
      this.completeStage(group);
    }

    return this.status();
  }

  resolveSensor(side, group, now) {
    const model = this.models[side];
    const state = this.runtime[side];
    const wristStrong = visibility(group.wrist) >= this.config.wristVisibility;
    const supportReady = group.visibleSupports.length >= this.config.minimumSupportPoints;
    const reconstructed = supportReady && group.supportCenter
      ? {
          x: group.supportCenter.x + model.offset.x,
          y: group.supportCenter.y + model.offset.y
        }
      : null;
    let candidate = wristStrong
      ? { x: group.wrist.x, y: group.wrist.y }
      : reconstructed;

    if (wristStrong && reconstructed) {
      const disagreement = distance(candidate, reconstructed);
      if (disagreement > this.config.maximumWristPalmDisagreement) {
        candidate = reconstructed;
      }
    }

    if (!candidate) return state.hold(now, this.config);

    if (state.ready) {
      const gap = now - state.lastValidAt;
      const jump = distance(candidate, state);
      if (
        gap < this.config.reacquireAfterMs
        && jump > this.config.maximumSensorJump
      ) {
        return state.hold(now, this.config);
      }
    }

    return state.accept(candidate, now);
  }

  writeBoundPose(pose, now) {
    const groups = {
      left: extractGroup(pose, this.bindings.left, this.config),
      right: extractGroup(pose, this.bindings.right, this.config)
    };
    const resolved = {
      left: this.resolveSensor('left', groups.left, now),
      right: this.resolveSensor('right', groups.right, now)
    };
    const output = pose.map(copyPoint);

    for (const targetSide of PHYSICAL_SIDES) {
      const target = SOURCE_GROUPS[targetSide];
      const sourceGroup = groups[targetSide];
      const point = resolved[targetSide];
      const targetIndices = [
        target.shoulder,
        target.elbow,
        target.wrist,
        ...target.supports
      ];
      const sourcePoints = [
        sourceGroup.shoulder,
        sourceGroup.elbow,
        sourceGroup.wrist,
        ...sourceGroup.supports
      ];

      targetIndices.forEach((index, position) => {
        output[index] = copyPoint(sourcePoints[position]);
      });

      if (!point) {
        output[target.wrist] = hiddenPoint(output[target.wrist]);
        target.supports.forEach((index) => {
          output[index] = hiddenPoint(output[index]);
        });
        continue;
      }

      output[target.wrist] = {
        ...output[target.wrist],
        x: clamp(point.x),
        y: clamp(point.y),
        visibility: Math.max(
          output[target.wrist].visibility ?? 0,
          this.config.trustedOutputVisibility
        ),
        presence: Math.max(
          output[target.wrist].presence ?? 0,
          this.config.trustedOutputVisibility
        )
      };

      if (point.held) {
        target.supports.forEach((index) => {
          output[index] = hiddenPoint(output[index]);
        });
      }
    }

    return output;
  }

  update(pose, now = performance.now()) {
    if (!Array.isArray(pose)) {
      return { pose: null, status: this.status() };
    }

    if (!this.ready) {
      return {
        pose: null,
        status: this.calibrate(pose, now)
      };
    }

    return {
      pose: this.writeBoundPose(pose, now),
      status: this.status()
    };
  }
}

export function createSequentialHandBinder(config) {
  return new SequentialHandBinder(config);
}
