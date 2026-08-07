import {
  BACKGROUND_ATLAS_URLS,
  BACKGROUND_FRAMES,
  SPRITE_ATLAS_URLS,
  SPRITES,
  SCENE_BACKGROUND
} from './story-data.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function createStoryArt(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const atlases = { backgrounds: {}, sprites: {} };
  const particles = [];
  let ready = false;
  let failed = false;

  const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    image.src = url;
  });

  const load = async () => {
    try {
      await Promise.all([
        ...Object.entries(BACKGROUND_ATLAS_URLS).map(async ([key, url]) => { atlases.backgrounds[key] = await loadImage(url); }),
        ...Object.entries(SPRITE_ATLAS_URLS).map(async ([key, url]) => { atlases.sprites[key] = await loadImage(url); })
      ]);
      ready = true;
    } catch (error) {
      failed = true;
      console.error(error);
    }
  };
  load();

  function drawFallback(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#82d4ef');
    gradient.addColorStop(0.55, '#8bcf78');
    gradient.addColorStop(1, '#436e3f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawBackground(name, width, height, now) {
    const frame = BACKGROUND_FRAMES[name];
    const image = frame && atlases.backgrounds[frame.atlas];
    if (!image) return drawFallback(width, height);
    const scale = Math.max(width / frame.w, height / frame.h);
    const sourceW = width / scale;
    const sourceH = height / scale;
    const breathe = Math.sin(now / 8500) * 0.012;
    const sx = frame.x + (frame.w - sourceW) * (0.5 + breathe);
    const sy = frame.y + (frame.h - sourceH) * 0.5;
    ctx.drawImage(image, sx, sy, sourceW, sourceH, 0, 0, width, height);
  }

  function drawSprite(name, x, y, options = {}) {
    const frame = SPRITES[name];
    const image = frame && atlases.sprites[frame.atlas];
    if (!image) return;
    const ratio = frame.w / frame.h;
    const h = options.h ?? (options.w ? options.w / ratio : canvas.height * 0.2);
    const w = options.w ?? h * ratio;
    const anchorX = options.anchorX ?? 0.5;
    const anchorY = options.anchorY ?? 1;
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.translate(x, y);
    ctx.rotate(options.rotation ?? 0);
    if (options.flipX) ctx.scale(-1, 1);
    if (options.shadow) {
      ctx.shadowColor = 'rgba(15,30,15,.28)';
      ctx.shadowBlur = options.shadowBlur ?? 14;
      ctx.shadowOffsetY = options.shadowOffsetY ?? 7;
    }
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, -w * anchorX, -h * anchorY, w, h);
    ctx.restore();
  }

  function drawFirefly(name, x, y, size, now, index = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha * (0.78 + Math.sin(now / 230 + index) * 0.2);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 1.2);
    glow.addColorStop(0, 'rgba(255,246,125,.8)');
    glow.addColorStop(1, 'rgba(255,246,125,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawSprite(name, x, y + size * 0.35, { h: size, anchorY: 0.5, alpha });
  }

  function drawHands(pose, width, height) {
    for (const [side, hand] of [['left', pose.left], ['right', pose.right]]) {
      if (!hand?.visible) continue;
      const x = hand.x * width;
      const y = hand.y * height;
      const radius = Math.max(20, Math.min(width, height) * 0.032);
      ctx.save();
      ctx.fillStyle = side === 'left' ? 'rgba(255,112,143,.86)' : 'rgba(48,198,174,.86)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(3, radius * 0.14);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawTracks(width, height, now) {
    const points = [
      ['pegada_falsa_01', 0.52, 0.67, -0.12],
      ['pegada_brilhando', 0.28, 0.58, 0.08],
      ['pegada_falsa_02', 0.68, 0.55, 0.16]
    ];
    points.forEach(([name, px, py, rotation]) => {
      if (name === 'pegada_brilhando') {
        const pulse = 42 + Math.sin(now / 280) * 8;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,227,91,.85)';
        ctx.lineWidth = Math.max(4, width * 0.004);
        ctx.beginPath();
        ctx.arc(px * width, py * height, pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawSprite(name, px * width, py * height, { h: height * 0.13, anchorY: 0.5, rotation, shadow: true });
    });
  }

  function sparkle(x, y, count = 8) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * (40 + Math.random() * 90),
        vy: Math.sin(angle) * (40 + Math.random() * 90),
        life: 1,
        size: 2 + Math.random() * 5
      });
    }
  }

  function updateParticles(dt) {
    const seconds = dt / 1000;
    for (const particle of particles) {
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vy += 50 * seconds;
      particle.life -= seconds * 1.8;
    }
    while (particles.length && particles[0].life <= 0) particles.shift();
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  function draw(state, now) {
    const width = canvas.width;
    const height = canvas.height;
    const scene = state.scene;
    const pose = state.pose;
    drawBackground(SCENE_BACKGROUND[scene] ?? 'entrada', width, height, now);
    const t = state.sceneElapsedMs / 1000;
    const bob = Math.sin(t * 3.4) * height * 0.008;
    const characterH = height * 0.37;

    if (scene === 'arrival') drawSprite('raposa_preocupada', width * 0.76, height * 0.9 + bob * 0.2, { h: characterH * 0.95, shadow: true });
    if (scene === 'mother') drawSprite('raposa_falando', width * 0.76, height * 0.9, { h: characterH, shadow: true });
    if (scene === 'tracks') { drawSprite('raposa_pegadas', width * 0.79, height * 0.9, { h: characterH * 0.88, shadow: true }); drawTracks(width, height, now); }
    if (scene === 'trail-walk') drawSprite('raposa_andando', width * 0.3, height * 0.9 + bob, { h: characterH * 0.82, shadow: true });
    if (scene === 'vines') {
      drawSprite('raposa_preocupada', width * 0.18, height * 0.9, { h: characterH * 0.72, shadow: true });
      const spread = state.handDistance();
      const normalized = clamp((spread - 0.22) / 0.34);
      drawSprite(normalized < 0.42 ? 'cipos_fechados' : 'cipos_meio', width * 0.5, height * 0.92, { w: width * 0.95, alpha: normalized > 0.82 ? clamp(1 - (normalized - 0.82) / 0.18) : 1 });
    }
    if (scene === 'after-vines') { drawSprite('raposa_andando', width * 0.22, height * 0.9, { h: characterH * 0.75, shadow: true }); drawSprite('esquilo_falando', width * 0.76, height * 0.84, { h: characterH * 0.68, shadow: true }); }
    if (scene === 'squirrel') { drawSprite('raposa_falando', width * 0.2, height * 0.91, { h: characterH * 0.77, shadow: true, flipX: true }); drawSprite('esquilo_pedindo', width * 0.76, height * 0.86, { h: characterH * 0.73, shadow: true }); }
    if (scene === 'apples') {
      drawSprite('raposa_preocupada', width * 0.13, height * 0.92, { h: characterH * 0.62, shadow: true, flipX: true });
      drawSprite('esquilo_pedindo', width * 0.86, height * 0.88, { h: characterH * 0.58, shadow: true });
      drawSprite(state.applesCaught >= 4 ? 'cesta_cheia' : 'cesta_vazia', state.handMidX() * width, height * 0.93, { w: width * 0.16, shadow: true });
      state.apples.forEach((apple) => drawSprite('maca', apple.x * width, apple.y * height, { h: Math.max(42, height * 0.075), anchorY: 0.5, rotation: Math.sin(now / 280 + apple.x * 8) * 0.08, shadow: true }));
    }
    if (scene === 'squirrel-thanks') { drawSprite('raposa_agradecendo', width * 0.2, height * 0.91, { h: characterH * 0.77, shadow: true, flipX: true }); drawSprite('esquilo_agradecendo', width * 0.76, height * 0.87, { h: characterH * 0.72, shadow: true }); }
    if (scene === 'creek-walk') drawSprite('raposa_andando', width * 0.3, height * 0.9 + bob, { h: characterH * 0.78, shadow: true });
    if (scene === 'bridge-intro') { drawSprite('raposa_preocupada', width * 0.22, height * 0.89, { h: characterH * 0.7, shadow: true, flipX: true }); drawSprite('ponte', width * 0.54, height * 0.83, { w: width * 0.54, rotation: -0.02, shadow: true }); }
    if (scene === 'bridge') {
      drawSprite('ponte', width * 0.54, height * 0.83, { w: width * 0.54, rotation: state.bridgeTarget * 0.55, shadow: true });
      const lean = clamp((state.shoulderMidX() - state.neutralShoulderX) / 0.12, -1, 1);
      drawSprite('raposa_andando', width * (0.26 + clamp(state.riverProgress) * 0.48), height * 0.71, { h: characterH * 0.5, rotation: lean * 0.06, shadow: true });
    }
    if (scene === 'far-bank') { drawSprite('raposa_apontando', width * 0.27, height * 0.9, { h: characterH * 0.77, shadow: true, flipX: true }); drawSprite('pelo_galho', width * 0.7, height * 0.59, { h: height * 0.21, anchorY: 0.5, rotation: -0.08 }); }
    if (scene === 'tunnel-intro') drawSprite('raposa_andando', width * 0.28, height * 0.91, { h: characterH * 0.68, shadow: true });
    if (scene === 'duck') { drawSprite('raposa_andando', width * 0.24, height * 0.91, { h: characterH * 0.58, shadow: true }); const cycle = (state.sceneElapsedMs % 5000) / 5000; drawSprite('galho_baixo', width * (1.12 - cycle * 1.34), height * 0.56, { w: width * 0.42, anchorY: 0.5, shadow: true }); }
    if (scene === 'dusk-walk' || scene === 'firefly-intro') {
      drawSprite(scene === 'dusk-walk' ? 'raposa_andando' : 'raposa_preocupada', width * 0.2, height * 0.91 + bob, { h: characterH * 0.7, shadow: true });
      for (let index = 0; index < 6; index += 1) drawFirefly(`vagalume_0${index % 3 + 1}`, width * (0.3 + index * 0.09), height * (0.34 + Math.sin(now / 500 + index) * 0.12), height * 0.055, now, index, 0.85);
    }
    if (scene === 'fireflies') {
      drawSprite('raposa_feliz', width * 0.16, height * 0.92, { h: characterH * 0.63, shadow: true, flipX: true });
      state.fireflyTargets.forEach((target, index) => { if (!state.firefliesCaught.has(index)) drawFirefly(`vagalume_0${index + 1}`, target.x * width, target.y * height, height * 0.085, now, index); });
    }
    if (scene === 'whisper' || scene === 'rescue-intro' || scene === 'rescue') {
      drawSprite('raposa_preocupada', width * 0.18, height * 0.91, { h: characterH * 0.67, shadow: true, flipX: true });
      if (scene !== 'whisper' || state.sceneElapsedMs > 17000) {
        drawSprite('filhote_galhos', width * 0.62, height * 0.78, { h: characterH * 0.58, shadow: true });
        const spread = clamp((state.handDistance() - 0.18) / 0.42);
        const branches = scene === 'rescue' ? (spread < 0.42 ? 'resgate_fechado' : spread < 0.78 ? 'resgate_meio' : 'resgate_aberto') : 'resgate_fechado';
        drawSprite(branches, width * 0.62, height * 0.85, { w: width * 0.55 });
      }
    }
    if (scene === 'reunion' || scene === 'ending') {
      drawSprite(scene === 'reunion' ? 'raposa_reencontro' : 'raposa_feliz', width * 0.38, height * 0.91, { h: characterH * 0.9, shadow: true, flipX: true });
      drawSprite(scene === 'reunion' ? 'filhote_reencontro' : 'filhote_comemorando', width * 0.57, height * 0.9 + bob * 0.5, { h: characterH * 0.66, shadow: true });
      drawSprite('esquilo_final', width * 0.79, height * 0.91, { h: characterH * 0.53, shadow: true });
      for (let index = 0; index < 9; index += 1) drawFirefly(`vagalume_0${index % 3 + 1}`, width * (0.16 + index * 0.08), height * (0.22 + Math.sin(now / 300 + index) * 0.08), height * 0.036, now, index, 0.78);
    }

    for (const particle of particles) {
      ctx.save(); ctx.globalAlpha = particle.life; ctx.shadowBlur = 14; ctx.shadowColor = '#ffe56a'; ctx.fillStyle = '#ffe56a';
      ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (['tracks', 'vines', 'apples', 'bridge', 'duck', 'fireflies', 'rescue'].includes(scene)) drawHands(pose, width, height);
  }

  return { draw, sparkle, updateParticles, get ready() { return ready; }, get failed() { return failed; } };
}
