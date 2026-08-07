const ENVIRONMENTS = [
  {
    name: 'Cidade',
    skyTop: '#75c8ff',
    skyBottom: '#e8f6ff',
    ground: '#79c96b',
    distant: '#8db7c9',
    road: '#59616e',
    edge: '#f3f4f7',
    accent: '#ffcf4a',
    prop: 'city'
  },
  {
    name: 'Floresta',
    skyTop: '#7fd6c1',
    skyBottom: '#e8ffe6',
    ground: '#3e9b55',
    distant: '#2f7650',
    road: '#535d58',
    edge: '#dcebd9',
    accent: '#ffd45c',
    prop: 'forest'
  },
  {
    name: 'Deserto',
    skyTop: '#62c7f4',
    skyBottom: '#fff0bd',
    ground: '#e9b85b',
    distant: '#c98945',
    road: '#6d6258',
    edge: '#fff1bd',
    accent: '#ffb238',
    prop: 'desert'
  },
  {
    name: 'Praia',
    skyTop: '#63cdf6',
    skyBottom: '#e8fbff',
    ground: '#efce82',
    distant: '#3bb7d6',
    road: '#59636a',
    edge: '#f8f4dd',
    accent: '#ffcf4a',
    prop: 'beach'
  }
];

const TRAFFIC = [
  { id: 'city-center', spawn: 4500, lane: 0, color: '#ef476f' },
  { id: 'city-left', spawn: 11500, lane: -1, color: '#4d96ff' },
  { id: 'city-pair-center', spawn: 18000, lane: 0, color: '#ff9f1c' },
  { id: 'city-pair-right', spawn: 18000, lane: 1, color: '#9b5de5' },
  { id: 'forest-right', spawn: 27000, lane: 1, color: '#ef476f' },
  { id: 'forest-pair-left', spawn: 35000, lane: -1, color: '#4d96ff' },
  { id: 'forest-pair-center', spawn: 35000, lane: 0, color: '#ff9f1c' },
  { id: 'desert-center', spawn: 44000, lane: 0, color: '#2ec4b6' },
  { id: 'desert-pair-left', spawn: 52000, lane: -1, color: '#9b5de5' },
  { id: 'desert-pair-right', spawn: 52000, lane: 1, color: '#ef476f' },
  { id: 'beach-right', spawn: 61000, lane: 1, color: '#4d96ff' },
  { id: 'beach-pair-left', spawn: 68500, lane: -1, color: '#ff9f1c' },
  { id: 'beach-pair-center', spawn: 68500, lane: 0, color: '#2ec4b6' }
];

const RIDE_DURATION_MS = 80000;
const ENVIRONMENT_DURATION_MS = 20000;
const TRANSITION_MS = 2200;
const CALIBRATION_MS = 1000;
const TRAFFIC_TRAVEL_MS = 9200;
const STEERING_DEAD_ZONE = 0.035;
const STEERING_RANGE = 0.18;
const MAX_WHEEL_ANGLE = Math.PI * 0.26;
const LANE_POSITION = 0.64;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function parseHex(color) {
  const value = color.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function mixColor(from, to, amount) {
  const a = parseHex(from);
  const b = parseHex(to);
  return `rgb(${Math.round(lerp(a.r, b.r, amount))}, ${Math.round(lerp(a.g, b.g, amount))}, ${Math.round(lerp(a.b, b.b, amount))})`;
}

function ease(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function seeded(index) {
  const value = Math.sin(index * 91.733 + 17.17) * 43758.5453;
  return value - Math.floor(value);
}

export class CarRideGame {
  constructor({ ctx }) {
    this.ctx = ctx;
    this.startedAt = 0;
    this.elapsedMs = 0;
    this.calibrationMs = 0;
    this.calibrationSum = 0;
    this.calibrationSamples = 0;
    this.neutralTilt = 0;
    this.ready = false;
    this.rawSteering = 0;
    this.steering = 0;
    this.wheelAngle = 0;
    this.targetWheelAngle = 0;
    this.playerOffset = 0;
    this.lateralVelocity = 0;
    this.scroll = 0;
    this.handsVisible = false;
    this.trafficAlert = 0;
    this.feedbackText = '';
    this.feedbackUntil = 0;
    this.resolvedTraffic = new Set();
  }

  start(now = performance.now()) {
    this.startedAt = now;
    this.elapsedMs = 0;
    this.calibrationMs = 0;
    this.calibrationSum = 0;
    this.calibrationSamples = 0;
    this.neutralTilt = 0;
    this.ready = false;
    this.rawSteering = 0;
    this.steering = 0;
    this.wheelAngle = 0;
    this.targetWheelAngle = 0;
    this.playerOffset = 0;
    this.lateralVelocity = 0;
    this.scroll = 0;
    this.handsVisible = false;
    this.trafficAlert = 0;
    this.feedbackText = '';
    this.feedbackUntil = 0;
    this.resolvedTraffic.clear();
  }

  update({ dt, pose }) {
    const frameMs = clamp(Number(dt) || 0, 0, 45);
    const seconds = frameMs / 1000;
    const left = pose?.left;
    const right = pose?.right;
    const handsVisible = Boolean(
      pose?.detected
      && left?.visible
      && right?.visible
      && Number.isFinite(left.x)
      && Number.isFinite(left.y)
      && Number.isFinite(right.x)
      && Number.isFinite(right.y)
    );
    const handsApart = handsVisible && Math.abs(right.x - left.x) >= 0.12;
    this.handsVisible = handsApart;

    if (!this.ready) {
      this.targetWheelAngle = 0;
      if (handsApart) {
        this.calibrationMs += frameMs;
        this.calibrationSum += right.y - left.y;
        this.calibrationSamples += 1;
        if (this.calibrationMs >= CALIBRATION_MS) {
          this.neutralTilt = this.calibrationSamples
            ? this.calibrationSum / this.calibrationSamples
            : 0;
          this.ready = true;
        }
      } else {
        this.calibrationMs = Math.max(0, this.calibrationMs - frameMs * 1.8);
        if (this.calibrationMs === 0) {
          this.calibrationSum = 0;
          this.calibrationSamples = 0;
        }
      }
      const wheelAlpha = 1 - Math.exp(-seconds / 0.13);
      this.wheelAngle += (this.targetWheelAngle - this.wheelAngle) * wheelAlpha;
      return false;
    }

    this.elapsedMs += frameMs;
    this.scroll = (this.scroll + seconds * 0.31) % 1;

    let rawSteering = 0;
    if (handsApart) {
      const tilt = (right.y - left.y) - this.neutralTilt;
      const magnitude = Math.abs(tilt);
      if (magnitude > STEERING_DEAD_ZONE) {
        rawSteering = Math.sign(tilt)
          * clamp((magnitude - STEERING_DEAD_ZONE) / STEERING_RANGE, 0, 1);
      }
    }
    this.rawSteering = rawSteering;

    const steeringAlpha = 1 - Math.exp(-seconds / 0.17);
    this.steering += (this.rawSteering - this.steering) * steeringAlpha;

    this.targetWheelAngle = this.steering * MAX_WHEEL_ANGLE;
    const wheelAlpha = 1 - Math.exp(-seconds / 0.11);
    this.wheelAngle += (this.targetWheelAngle - this.wheelAngle) * wheelAlpha;

    const targetVelocity = this.steering * 0.78;
    const velocityAlpha = 1 - Math.exp(-seconds / 0.29);
    this.lateralVelocity += (targetVelocity - this.lateralVelocity) * velocityAlpha;
    this.playerOffset += this.lateralVelocity * seconds;

    const limitedOffset = clamp(this.playerOffset, -0.88, 0.88);
    if (limitedOffset !== this.playerOffset) this.lateralVelocity *= 0.2;
    this.playerOffset = limitedOffset;

    this.updateTrafficFeedback();
    return this.elapsedMs >= RIDE_DURATION_MS;
  }

  trafficProgress(item) {
    return (this.elapsedMs - item.spawn) / TRAFFIC_TRAVEL_MS;
  }

  effectiveTrafficLane(item, progress) {
    const lane = item.lane * LANE_POSITION;
    const distance = Math.abs(this.playerOffset - lane);
    if (progress < 0.7 || distance >= 0.28) return lane;

    const direction = item.lane === 0
      ? (this.playerOffset <= 0 ? 1 : -1)
      : -Math.sign(item.lane);
    return lane + direction * 0.3 * ease((progress - 0.7) / 0.22);
  }

  updateTrafficFeedback() {
    this.trafficAlert = 0;

    for (const item of TRAFFIC) {
      const progress = this.trafficProgress(item);
      if (progress < 0 || progress > 1.08) continue;

      const lane = item.lane * LANE_POSITION;
      const distance = Math.abs(this.playerOffset - lane);
      if (progress >= 0.42 && progress <= 0.82 && distance < 0.32) {
        this.trafficAlert = Math.max(this.trafficAlert, ease((progress - 0.42) / 0.4));
      }

      if (progress < 0.86 || this.resolvedTraffic.has(item.id)) continue;
      this.resolvedTraffic.add(item.id);
      this.feedbackText = distance >= 0.31
        ? 'Boa ultrapassagem!'
        : 'Tudo bem, o outro carro deu passagem!';
      this.feedbackUntil = this.elapsedMs + 1300;
    }
  }

  currentEnvironment() {
    const capped = Math.min(this.elapsedMs, RIDE_DURATION_MS - 1);
    return Math.min(ENVIRONMENTS.length - 1, Math.floor(capped / ENVIRONMENT_DURATION_MS));
  }

  sceneBlend() {
    const currentIndex = this.currentEnvironment();
    if (currentIndex === 0) {
      return {
        previous: ENVIRONMENTS[0],
        current: ENVIRONMENTS[0],
        amount: 1,
        index: 0
      };
    }

    const localMs = this.elapsedMs - currentIndex * ENVIRONMENT_DURATION_MS;
    return {
      previous: ENVIRONMENTS[currentIndex - 1],
      current: ENVIRONMENTS[currentIndex],
      amount: ease(localMs / TRANSITION_MS),
      index: currentIndex
    };
  }

  draw({ width, height }) {
    const ctx = this.ctx;
    const scene = this.sceneBlend();
    const mix = scene.amount;
    const skyTop = mixColor(scene.previous.skyTop, scene.current.skyTop, mix);
    const skyBottom = mixColor(scene.previous.skyBottom, scene.current.skyBottom, mix);
    const ground = mixColor(scene.previous.ground, scene.current.ground, mix);
    const distant = mixColor(scene.previous.distant, scene.current.distant, mix);
    const road = mixColor(scene.previous.road, scene.current.road, mix);
    const edge = mixColor(scene.previous.edge, scene.current.edge, mix);
    const accent = mixColor(scene.previous.accent, scene.current.accent, mix);

    const horizonY = height * 0.34;
    const gradient = ctx.createLinearGradient(0, 0, 0, horizonY * 1.55);
    gradient.addColorStop(0, skyTop);
    gradient.addColorStop(1, skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    this.drawSun(width, height, scene.index, mix);
    this.drawDistantLand(width, height, horizonY, distant);

    ctx.fillStyle = ground;
    ctx.fillRect(0, horizonY, width, height - horizonY);

    if (scene.previous.prop !== scene.current.prop) {
      this.drawEnvironment(scene.previous.prop, width, height, horizonY, 1 - mix);
      this.drawEnvironment(scene.current.prop, width, height, horizonY, mix);
    } else {
      this.drawEnvironment(scene.current.prop, width, height, horizonY, 1);
    }

    this.drawRoad(width, height, horizonY, road, edge, accent);
    this.drawTraffic(width, height, horizonY);
    this.drawPlayerCar(width, height, accent);
    this.drawWheelOverlay(width, height, accent);
    this.drawEnvironmentLabel(width, height, scene.current.name);
    this.drawTrafficMessage(width, height);

    if (!this.ready) this.drawCalibration(width, height);
    else if (!this.handsVisible) this.drawHandsReminder(width, height);
  }

  drawSun(width, height, environmentIndex, transition) {
    const ctx = this.ctx;
    const x = lerp(width * 0.77, width * 0.68, environmentIndex / 3);
    const y = height * 0.14;
    const radius = Math.max(25, Math.min(width, height) * 0.045);
    ctx.save();
    ctx.globalAlpha = 0.78 + transition * 0.12;
    ctx.fillStyle = environmentIndex === 3 ? '#fff4b0' : '#ffe379';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawDistantLand(width, height, horizonY, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + height * 0.02);
    for (let index = 0; index <= 10; index += 1) {
      const x = (index / 10) * width;
      const wave = Math.sin(index * 1.55 + this.scroll * 2.1) * height * 0.024;
      ctx.lineTo(x, horizonY - height * 0.034 + wave);
    }
    ctx.lineTo(width, horizonY + height * 0.1);
    ctx.lineTo(0, horizonY + height * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  roadGeometry(width, height, horizonY) {
    return {
      width,
      horizonY,
      bottomY: height * 1.04,
      horizonHalf: width * 0.052,
      bottomHalf: width * 0.49
    };
  }

  roadMetricsAt(geometry, y) {
    const progress = clamp((y - geometry.horizonY) / (geometry.bottomY - geometry.horizonY));
    const perspective = progress * progress;
    const center = geometry.width * 0.5;
    const half = lerp(geometry.horizonHalf, geometry.bottomHalf, perspective);
    return { left: center - half, right: center + half, center, half, progress, perspective };
  }

  drawRoad(width, height, horizonY, roadColor, edgeColor, accentColor) {
    const ctx = this.ctx;
    const geometry = this.roadGeometry(width, height, horizonY);
    const top = this.roadMetricsAt(geometry, geometry.horizonY);
    const bottom = this.roadMetricsAt(geometry, geometry.bottomY);

    ctx.fillStyle = roadColor;
    ctx.beginPath();
    ctx.moveTo(top.left, geometry.horizonY);
    ctx.lineTo(top.right, geometry.horizonY);
    ctx.lineTo(bottom.right, geometry.bottomY);
    ctx.lineTo(bottom.left, geometry.bottomY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = Math.max(5, width * 0.008);
    ctx.beginPath();
    ctx.moveTo(top.left, geometry.horizonY);
    ctx.lineTo(bottom.left, geometry.bottomY);
    ctx.moveTo(top.right, geometry.horizonY);
    ctx.lineTo(bottom.right, geometry.bottomY);
    ctx.stroke();

    for (const divider of [-1 / 3, 1 / 3]) {
      for (let index = 0; index < 13; index += 1) {
        const phase = (index / 13 + this.scroll) % 1;
        const start = phase * phase;
        const end = clamp(start + 0.042 + phase * 0.065);
        const y1 = lerp(geometry.horizonY, geometry.bottomY, start);
        const y2 = lerp(geometry.horizonY, geometry.bottomY, end);
        const p1 = this.roadMetricsAt(geometry, y1);
        const p2 = this.roadMetricsAt(geometry, y2);
        ctx.strokeStyle = index % 2 ? '#ffffff' : accentColor;
        ctx.lineWidth = Math.max(2, lerp(2, width * 0.01, end));
        ctx.beginPath();
        ctx.moveTo(p1.center + divider * p1.half, y1);
        ctx.lineTo(p2.center + divider * p2.half, y2);
        ctx.stroke();
      }
    }
  }

  drawTraffic(width, height, horizonY) {
    const geometry = this.roadGeometry(width, height, horizonY);
    const active = TRAFFIC
      .map((item) => ({ item, progress: this.trafficProgress(item) }))
      .filter(({ progress }) => progress >= 0 && progress <= 1.08)
      .sort((a, b) => a.progress - b.progress);

    for (const { item, progress } of active) {
      const visual = ease(clamp(progress));
      const y = lerp(horizonY + height * 0.012, height * 0.93, visual);
      const metrics = this.roadMetricsAt(geometry, y);
      const lane = this.effectiveTrafficLane(item, progress);
      const x = metrics.center + lane * metrics.half * 0.9;
      const scale = lerp(0.1, 1.05, visual);
      const alpha = progress > 0.97 ? clamp((1.08 - progress) / 0.11) : 1;
      this.drawTrafficCar(x, y, scale, item.color, alpha);
    }
  }

  drawTrafficCar(x, y, scale, color, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(20, 24, 38, .28)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 46, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#202738';
    ctx.fillRect(-43, -28, 12, 40);
    ctx.fillRect(31, -28, 12, 40);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-44, -76, 88, 82, 20);
    ctx.fill();

    ctx.fillStyle = '#26364a';
    ctx.beginPath();
    ctx.roundRect(-31, -65, 62, 31, 10);
    ctx.fill();

    ctx.fillStyle = 'rgba(198, 235, 255, .82)';
    ctx.beginPath();
    ctx.roundRect(-25, -60, 50, 21, 7);
    ctx.fill();

    ctx.fillStyle = '#ff4d5d';
    ctx.beginPath();
    ctx.roundRect(-35, -20, 18, 12, 5);
    ctx.roundRect(17, -20, 18, 12, 5);
    ctx.fill();

    ctx.fillStyle = '#f6f1d1';
    ctx.beginPath();
    ctx.roundRect(-19, -11, 38, 13, 4);
    ctx.fill();
    ctx.restore();
  }

  drawPlayerCar(width, height, accentColor) {
    const ctx = this.ctx;
    const geometry = this.roadGeometry(width, height, height * 0.34);
    const y = height * 0.835;
    const metrics = this.roadMetricsAt(geometry, y);
    const x = metrics.center + this.playerOffset * metrics.half * 0.9;
    const scale = clamp(Math.min(width, height) / 720, 0.72, 1.28);
    const tilt = clamp(this.steering * 0.09 + this.lateralVelocity * 0.035, -0.12, 0.12);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(16, 21, 36, .32)';
    ctx.beginPath();
    ctx.ellipse(0, 48, 72, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b2132';
    ctx.beginPath();
    ctx.roundRect(-67, -8, 20, 70, 9);
    ctx.roundRect(47, -8, 20, 70, 9);
    ctx.fill();

    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(-72, -78, 144, 124, 34);
    ctx.fill();

    ctx.fillStyle = '#29384f';
    ctx.beginPath();
    ctx.roundRect(-51, -66, 102, 48, 17);
    ctx.fill();

    ctx.fillStyle = 'rgba(196, 235, 255, .9)';
    ctx.beginPath();
    ctx.roundRect(-43, -59, 86, 33, 12);
    ctx.fill();

    ctx.fillStyle = '#ff4d5d';
    ctx.beginPath();
    ctx.roundRect(-58, 13, 27, 18, 7);
    ctx.roundRect(31, 13, 27, 18, 7);
    ctx.fill();

    ctx.fillStyle = '#fff0b3';
    ctx.beginPath();
    ctx.roundRect(-27, 15, 54, 18, 6);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-48, -4);
    ctx.lineTo(48, -4);
    ctx.stroke();
    ctx.restore();
  }

  drawWheelOverlay(width, height, accentColor) {
    const ctx = this.ctx;
    const radius = Math.max(38, Math.min(width, height) * 0.075);
    const centerX = width - radius - Math.max(24, width * 0.025);
    const centerY = height - radius - Math.max(24, height * 0.035);

    ctx.save();
    ctx.fillStyle = 'rgba(20, 27, 48, .68)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(centerX, centerY);
    ctx.rotate(this.wheelAngle);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = Math.max(10, radius * 0.2);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#5d6880';
    ctx.lineWidth = Math.max(3, radius * 0.055);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#1b2337';
    ctx.lineWidth = Math.max(9, radius * 0.17);
    ctx.lineCap = 'round';
    [-Math.PI * 0.78, -Math.PI * 0.22, Math.PI * 0.5].forEach((angle) => {
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.22, Math.sin(angle) * radius * 0.22);
      ctx.lineTo(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8);
      ctx.stroke();
    });

    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawEnvironment(type, width, height, horizonY, alpha) {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    const geometry = this.roadGeometry(width, height, horizonY);
    ctx.save();
    ctx.globalAlpha = alpha;

    for (let index = 0; index < 18; index += 1) {
      const depth = (index / 18 + this.scroll * 0.43) % 1;
      const perspective = depth * depth;
      const y = lerp(horizonY + height * 0.01, height * 0.9, perspective);
      const edges = this.roadMetricsAt(geometry, y);
      const side = index % 2 === 0 ? -1 : 1;
      const seed = seeded(index + type.length * 31);
      const margin = lerp(width * 0.025, width * 0.17, perspective);
      const x = side < 0 ? edges.left - margin : edges.right + margin;
      const scale = lerp(0.2, 1.35, perspective) * (0.82 + seed * 0.34);
      this.drawProp(type, x, y, scale, side, seed);
    }
    ctx.restore();
  }

  drawProp(type, x, y, scale, side, seed) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * side, scale);

    if (type === 'city') {
      const buildingWidth = 34 + seed * 24;
      const buildingHeight = 72 + seed * 70;
      ctx.fillStyle = seed > 0.5 ? '#7c8fa3' : '#65778c';
      ctx.fillRect(-buildingWidth / 2, -buildingHeight, buildingWidth, buildingHeight);
      ctx.fillStyle = '#ffe484';
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 2; column += 1) {
          ctx.fillRect(
            -buildingWidth * 0.31 + column * buildingWidth * 0.36,
            -buildingHeight + 16 + row * 19,
            7,
            9
          );
        }
      }
    } else if (type === 'forest') {
      ctx.fillStyle = '#6f4c2d';
      ctx.fillRect(-7, -74, 14, 74);
      ctx.fillStyle = seed > 0.5 ? '#2d8f52' : '#237843';
      ctx.beginPath();
      ctx.arc(0, -82, 34, 0, Math.PI * 2);
      ctx.arc(-19, -61, 25, 0, Math.PI * 2);
      ctx.arc(20, -61, 26, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'desert') {
      if (seed > 0.32) {
        ctx.strokeStyle = '#3f9a62';
        ctx.lineWidth = 13;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -70);
        ctx.moveTo(0, -43);
        ctx.lineTo(-24, -55);
        ctx.lineTo(-24, -72);
        ctx.moveTo(0, -28);
        ctx.lineTo(22, -39);
        ctx.lineTo(22, -55);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#99663b';
        ctx.beginPath();
        ctx.ellipse(0, -8, 31, 15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'beach') {
      ctx.fillStyle = '#8b5d36';
      ctx.fillRect(-6, -78, 12, 78);
      ctx.strokeStyle = '#2b9b67';
      ctx.lineWidth = 13;
      ctx.lineCap = 'round';
      for (let leaf = -2; leaf <= 2; leaf += 1) {
        ctx.beginPath();
        ctx.moveTo(0, -77);
        ctx.quadraticCurveTo(leaf * 16, -96, leaf * 27, -80 + Math.abs(leaf) * 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawEnvironmentLabel(width, height, name) {
    const ctx = this.ctx;
    const local = this.elapsedMs % ENVIRONMENT_DURATION_MS;
    const fadeIn = clamp(local / 500);
    const fadeOut = clamp((3500 - local) / 700);
    const opacity = this.elapsedMs < 3500 || local < 3500 ? Math.min(fadeIn, fadeOut) : 0;
    if (opacity <= 0.01 || !this.ready) return;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `900 ${Math.max(22, Math.round(height * 0.036))}px system-ui`;
    const textWidth = ctx.measureText(name).width;
    const boxWidth = textWidth + 54;
    const boxHeight = Math.max(52, height * 0.07);
    const x = width * 0.5 - boxWidth / 2;
    const y = height * 0.055;
    ctx.fillStyle = 'rgba(20, 28, 55, .72)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, width * 0.5, y + boxHeight / 2 + 1);
    ctx.restore();
  }

  drawTrafficMessage(width, height) {
    let text = '';
    let opacity = 0;

    if (this.feedbackUntil > this.elapsedMs) {
      text = this.feedbackText;
      opacity = clamp((this.feedbackUntil - this.elapsedMs) / 350);
    } else if (this.trafficAlert > 0.05) {
      text = 'Escolha outra faixa';
      opacity = this.trafficAlert;
    }
    if (!text || !this.ready) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `900 ${Math.max(21, Math.round(height * 0.032))}px system-ui`;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = textWidth + 48;
    const boxHeight = Math.max(50, height * 0.066);
    const x = width * 0.5 - boxWidth / 2;
    const y = height * 0.135;
    ctx.fillStyle = 'rgba(20, 27, 53, .78)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width * 0.5, y + boxHeight / 2);
    ctx.restore();
  }

  drawCalibration(width, height) {
    const ctx = this.ctx;
    const progress = clamp(this.calibrationMs / CALIBRATION_MS);
    const boxWidth = Math.min(width * 0.68, 690);
    const boxHeight = Math.min(height * 0.24, 190);
    const x = width * 0.5 - boxWidth / 2;
    const y = height * 0.18;

    ctx.save();
    ctx.fillStyle = 'rgba(20, 27, 53, .84)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 30);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.max(25, Math.round(height * 0.041))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Segure um volante com as duas mãos', width * 0.5, y + boxHeight * 0.38);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.roundRect(x + boxWidth * 0.12, y + boxHeight * 0.67, boxWidth * 0.76, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#ffcf4a';
    ctx.beginPath();
    ctx.roundRect(x + boxWidth * 0.12, y + boxHeight * 0.67, boxWidth * 0.76 * progress, 18, 9);
    ctx.fill();
    ctx.restore();
  }

  drawHandsReminder(width, height) {
    const ctx = this.ctx;
    const text = 'Mostre as duas mãos como um volante';
    ctx.save();
    ctx.font = `850 ${Math.max(20, Math.round(height * 0.03))}px system-ui`;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = textWidth + 42;
    const boxHeight = Math.max(48, height * 0.065);
    const x = width * 0.5 - boxWidth / 2;
    const y = height * 0.12;
    ctx.fillStyle = 'rgba(20, 27, 53, .76)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width * 0.5, y + boxHeight / 2);
    ctx.restore();
  }
}
