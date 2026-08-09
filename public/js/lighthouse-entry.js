import { RealtimeClient } from './realtime.js';
import { createLighthouseStory } from './lighthouse-story.js';

let primaryRealtimeClient = null;
let storyInstance = null;
let storyOpen = false;

const baseOn = RealtimeClient.prototype.on;
RealtimeClient.prototype.on = function captureLighthouseRealtimeClient(type, callback) {
  if (!primaryRealtimeClient) primaryRealtimeClient = this;
  return baseOn.call(this, type, callback);
};

function ensureStyles() {
  if (document.querySelector('#mexemundoLighthouseStoryStyles')) return;
  const link = document.createElement('link');
  link.id = 'mexemundoLighthouseStoryStyles';
  link.rel = 'stylesheet';
  link.href = '/lighthouse-story.css';
  document.head.append(link);
}

function createStoryShell() {
  const gameShell = document.querySelector('.game-shell');
  if (!gameShell) return null;
  const existing = document.querySelector('#lighthouseStoryExperience');
  if (existing) return existing;

  ensureStyles();
  const shell = document.createElement('section');
  shell.id = 'lighthouseStoryExperience';
  shell.className = 'lighthouse-shell hidden';
  shell.setAttribute('aria-label', 'História O Farol das Estrelas');
  shell.innerHTML = `
    <canvas class="lighthouse-canvas" aria-label="O Farol das Estrelas"></canvas>

    <header class="lighthouse-topbar">
      <div>
        <span>MEXEMUNDO • HISTÓRIA</span>
        <strong>O Farol das Estrelas</strong>
      </div>
      <div class="lighthouse-connection waiting">Celular conectado</div>
    </header>

    <section class="lighthouse-prompt hidden" aria-live="polite">
      <div class="lighthouse-prompt-icon" aria-hidden="true">⭐</div>
      <strong class="lighthouse-prompt-title"></strong>
      <div class="lighthouse-prompt-meter hidden"><span></span></div>
    </section>

    <div class="lighthouse-objective hidden" aria-live="polite"></div>
    <div class="lighthouse-progress" aria-label="Progresso da aventura"></div>

    <section class="lighthouse-ending hidden">
      <div class="lighthouse-ending-stars">✦ ⭐ ✦</div>
      <span>AVENTURA CONCLUÍDA</span>
      <h2>As estrelas voltaram!</h2>
      <button class="lighthouse-restart" type="button" data-hand-target="true">Jogar novamente</button>
      <button class="lighthouse-back" type="button" data-hand-target="true">Voltar ao MexeMundo</button>
    </section>
  `;
  gameShell.append(shell);
  return shell;
}

function closeStory() {
  storyOpen = false;
  storyInstance?.stop();
  document.querySelector('#lighthouseStoryExperience')?.classList.add('hidden');
  document.body.classList.remove('story-active', 'story-ending', 'lighthouse-story-active');
  document.querySelector('#countdownPanel')?.classList.add('hidden');
  document.querySelector('#resultPanel')?.classList.add('hidden');
  document.querySelector('#gameMenuPanel')?.classList.remove('hidden');
}

function setEndingMode(active) {
  if (!storyOpen) return;
  document.body.classList.toggle('story-ending', Boolean(active));
}

function openStory() {
  const room = document.querySelector('#roomCode')?.textContent?.trim() || '';
  if (!primaryRealtimeClient || room.length < 4) {
    console.warn('O Farol das Estrelas aguardou a conexão principal da TV.');
    return;
  }

  const shell = createStoryShell();
  if (!shell) return;

  document.querySelector('#gameMenuPanel')?.classList.add('hidden');
  document.querySelector('#countdownPanel')?.classList.add('hidden');
  document.querySelector('#resultPanel')?.classList.add('hidden');
  document.body.classList.add('story-active', 'lighthouse-story-active');
  document.body.classList.remove('story-ending');
  shell.classList.remove('hidden');
  storyOpen = true;

  if (!storyInstance) {
    storyInstance = createLighthouseStory({
      root: shell,
      client: primaryRealtimeClient,
      room,
      onClose: closeStory,
      onEndingChange: setEndingMode
    });
  }

  storyInstance.start();
}

function installMenuCard() {
  const menu = document.querySelector('#gameMenuPanel');
  const grid = menu?.querySelector('.game-menu-grid');
  if (!grid || grid.querySelector('#lighthouseStoryCard')) return Boolean(grid);

  const card = document.createElement('button');
  card.id = 'lighthouseStoryCard';
  card.className = 'game-menu-card story-card lighthouse-menu-card';
  card.type = 'button';
  card.setAttribute('data-hand-target', 'true');
  card.innerHTML = `
    <span class="game-menu-icon">⭐</span>
    <strong>O Farol das Estrelas</strong>
    <small>Uma aventura de corpo e luz</small>
  `;
  card.addEventListener('click', openStory);

  const spaceCard = grid.querySelector('#spaceStoryCard');
  if (spaceCard?.nextSibling) grid.insertBefore(card, spaceCard.nextSibling);
  else grid.append(card);
  return true;
}

if (!installMenuCard()) {
  const observer = new MutationObserver(() => {
    if (installMenuCard()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
