const DRUMS = [
  { id: 'cymbal', label: 'TIN!', name: 'Prato', x: 0.50, y: 0.26, radius: 0.105, color: '#ffd43b', sound: 'cymbal' },
  { id: 'tom-left', label: 'TOM!', name: 'Tom azul', x: 0.36, y: 0.46, radius: 0.105, color: '#4d96ff', sound: 'tom-high' },
  { id: 'tom-right', label: 'TUM!', name: 'Tom roxo', x: 0.64, y: 0.46, radius: 0.105, color: '#9b5de5', sound: 'tom-low' },
  { id: 'snare', label: 'TÁ!', name: 'Caixa', x: 0.39, y: 0.70, radius: 0.12, color: '#ff5d8f', sound: 'snare' },
  { id: 'floor', label: 'BUM!', name: 'Surdo', x: 0.61, y: 0.70, radius: 0.12, color: '#2ec4b6', sound: 'kick' }
];

const HANDS = ['left', 'right'];
const ROUND_SECONDS = 45;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function distanceToSegmentSquared(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 0.0001) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
}

export class MagicDrumsGame {
  constructor({ getAudioContext }) {
    this.getAudioContext = getAudioContext;
    this.startedAt = 0;
    this.hits = 0;
    this.sequence = 1;
    this.bestSequence = 1;
    this.lastDrumId = null;
    this.lastHitAt = 0;
    this.effects = [];
    this.active = false;
    this.inside = {
      left: new Set(),
      right: new Set()
    };
    this.drumState = new Map(DRUMS.map((drum) => [drum.id, { pulse: 0, flash: 0 }]));
    this.noiseBuffers = new WeakMap();
  }

  start(now) {
    this.startedAt = now;
    this.hits = 0;
    this.sequence = 1;
    this.bestSequence = 1;
    this.lastDrumId = null;
    this.lastHitAt = 0;
    this.effects = [];
    this.active = true;
    this.inside.left.clear();
    this.inside.right.clear();
    for (const state of this.drumState.values()) {
      state.pulse = 0;
      state.flash = 0;
    }
  }

  stop() {
    this.active = false;
    this.inside.left.clear();
    this.inside.right.clear();
  }

  getResult() {
    return {
      hits: this.hits,
      bestSequence: this.bestSequence
    };
  }

  layout(width, height) {
    const base = Math.min(width, height);
    return DRUMS.map((drum) => ({
      ...drum,
      px: drum.x * width,
      py: drum.y * height,
      pr: Math.max(48, base * drum.radius)
    }));
  }

  update({ now, dt, width, height, hands, previousHands }) {
    if (!this.active) {
      return { ended: false, remaining: ROUND_SECONDS, hits: this.hits, sequence: this.sequence };
    }

    const remaining = ROUND_SECONDS - (now - this.startedAt) / 1000;
    const seconds = dt / 1000;

    for (const state of this.drumState.values()) {
      state.pulse = Math.max(0, state.pulse - seconds * 4.2);
      state.flash = Math.max(0, state.flash - seconds * 2.8);
    }
    for (const effect of this.effects) {
      effect.life -= seconds * 1.8;
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);

    const drums = this.layout(width, height);
    const handRadius = Math.max(28, Math.min(width, height) * 0.044);

    for (const handName of HANDS) {
      const current = hands[handName];
      const previous = previousHands[handName];
      const insideSet = this.inside[handName];

      if (!current?.visible) {
        insideSet.clear();
        continue;
      }

      const currentX = current.x * width;
      const currentY = current.y * height;
      const previousX = previous?.visible ? previous.x * width : currentX;
      const previousY = previous?.visible ? previous.y * height : currentY;
      const travel = Math.hypot(currentX - previousX, currentY - previousY);
      const speed = Math.hypot(Number(current.vx) || 0, Number(current.vy) || 0);

      for (const drum of drums) {
        const hitRadius = drum.pr + handRadius * 0.72;
        const distance = Math.hypot(currentX - drum.px, currentY - drum.py);
        const insideNow = distance <= hitRadius;
        const swept = distanceToSegmentSquared(
          drum.px,
          drum.py,
          previousX,
          previousY,
          currentX,
          currentY
        ) <= hitRadius * hitRadius;
        const wasInside = insideSet.has(drum.id);
        const deliberateMovement = speed > 0.09 || travel > Math.max(8, drum.pr * 0.07);

        if (!wasInside && (insideNow || swept) && deliberateMovement) {
          this.strike(drum, now);
        }

        if (insideNow) insideSet.add(drum.id);
        else insideSet.delete(drum.id);
      }
    }

    if (remaining <= 0) {
      this.stop();
      return { ended: true, remaining: 0, hits: this.hits, sequence: this.sequence };
    }

    return {
      ended: false,
      remaining,
      hits: this.hits,
      sequence: this.sequence
    };
  }

  strike(drum, now) {
    this.hits += 1;
    if (this.lastDrumId && this.lastDrumId !== drum.id && now - this.lastHitAt <= 1300) {
      this.sequence += 1;
    } else {
      this.sequence = 1;
    }
    this.bestSequence = Math.max(this.bestSequence, this.sequence);
    this.lastDrumId = drum.id;
    this.lastHitAt = now;

    const state = this.drumState.get(drum.id);
    state.pulse = 1;
    state.flash = 1;
    this.effects.push({
      x: drum.x,
      y: drum.y,
      text: drum.label,
      color: drum.color,
      life: 1
    });
    this.playSound(drum.sound);
  }

  getNoiseBuffer(context) {
    let buffer = this.noiseBuffers.get(context);
    if (buffer) return buffer;
    const length = Math.max(1, Math.floor(context.sampleRate * 0.45));
    buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffers.set(context, buffer);
    return buffer;
  }

  playSound(type) {
    try {
      const context = this.getAudioContext?.();
      if (!context) return;
      const now = context.currentTime;

      if (type === 'kick') {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(145, now);
        oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.24);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.42, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.3);
        return;
      }

      if (type === 'tom-high' || type === 'tom-low') {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startFrequency = type === 'tom-high' ? 245 : 175;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(startFrequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(startFrequency * 0.58, now + 0.18);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.28, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.25);
        return;
      }

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.getNoiseBuffer(context);
      filter.type = type === 'cymbal' ? 'highpass' : 'bandpass';
      filter.frequency.value = type === 'cymbal' ? 5200 : 1700;
      filter.Q.value = type === 'cymbal' ? 0.7 : 1.2;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(type === 'cymbal' ? 0.17 : 0.24, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (type === 'cymbal' ? 0.34 : 0.13));
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(now);
      source.stop(now + (type === 'cymbal' ? 0.38 : 0.16));
    } catch {
      // O áudio não interrompe a brincadeira quando o navegador ainda não o liberou.
    }
  }

  draw(ctx, { now, width, height }) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(35, 18, 94, .72)');
    gradient.addColorStop(1, 'rgba(19, 12, 57, .2)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#ffffff';
    for (let index = 0; index < 11; index += 1) {
      const x = ((index * 149) + Math.sin(now / 900 + index) * 36) % width;
      const y = height * (0.13 + (index % 4) * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, 5 + (index % 3) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const drums = this.layout(width, height);
    for (const drum of drums) {
      const state = this.drumState.get(drum.id);
      const scale = 1 + state.pulse * 0.11;
      const radius = drum.pr * scale;

      ctx.save();
      ctx.translate(drum.px, drum.py);
      ctx.shadowColor = drum.color;
      ctx.shadowBlur = 20 + state.flash * 34;

      if (drum.id === 'cymbal') {
        ctx.fillStyle = drum.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.35, radius * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath();
        ctx.ellipse(-radius * 0.25, -radius * 0.07, radius * 0.42, radius * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#704f00';
        ctx.lineWidth = Math.max(4, radius * 0.06);
        ctx.beginPath();
        ctx.moveTo(0, radius * 0.28);
        ctx.lineTo(0, radius * 1.18);
        ctx.stroke();
      } else {
        ctx.fillStyle = drum.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(6, radius * 0.09);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.beginPath();
        ctx.ellipse(-radius * 0.24, -radius * 0.20, radius * 0.30, radius * 0.12, -0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.max(16, Math.round(radius * 0.20))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(drum.name, 0, drum.id === 'cymbal' ? radius * 0.67 : 0);
      ctx.restore();
    }

    for (const effect of this.effects) {
      ctx.save();
      ctx.globalAlpha = clamp(effect.life);
      ctx.font = `1000 ${Math.max(28, Math.round(Math.min(width, height) * 0.055))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(35,18,94,.7)';
      ctx.fillStyle = '#ffffff';
      const x = effect.x * width;
      const y = effect.y * height - (1 - effect.life) * 40;
      ctx.strokeText(effect.text, x, y);
      ctx.fillText(effect.text, x, y);
      ctx.restore();
    }
  }
}
