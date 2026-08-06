import { installRightHandMenu } from './right-hand-menu.js';

function keepCalibrationAsInitialScreen() {
  const pairPanel = document.querySelector('#pairPanel');
  const calibrationPanel = document.querySelector('#calibrationPanel');
  const calibrationProgress = document.querySelector('#calibrationProgress');
  const calibrationMessage = document.querySelector('#calibrationMessage');
  const connectionBadge = document.querySelector('#connectionBadge');

  if (!pairPanel || !calibrationPanel || !connectionBadge) return;

  const syncInitialScreen = () => {
    const waitingForPhone = connectionBadge.textContent?.trim() === 'Aguardando celular';
    if (!waitingForPhone) return;

    pairPanel.classList.add('hidden');
    pairPanel.setAttribute('aria-hidden', 'true');
    calibrationPanel.classList.remove('hidden');
    calibrationPanel.removeAttribute('aria-hidden');
    if (calibrationProgress) calibrationProgress.style.width = '0%';
    if (calibrationMessage) calibrationMessage.textContent = 'Aguardando o celular conectar…';
  };

  const observer = new MutationObserver(syncInitialScreen);
  observer.observe(connectionBadge, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    characterData: true,
    subtree: true
  });

  syncInitialScreen();
}

keepCalibrationAsInitialScreen();
installRightHandMenu();
await import('./tv.js');
