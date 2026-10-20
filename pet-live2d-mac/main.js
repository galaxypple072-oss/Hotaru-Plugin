import { createLive2DPet } from './live2d-pet.js';

const error = document.getElementById('error');
window.addEventListener('error', event => {
  window.webkit?.messageHandlers?.ready?.postMessage(`window error: ${event.message} @ ${event.filename}:${event.lineno}`);
});
let pet;
let requestedState = 'idle';
let requestedCue = null;
let lipSyncActive = false;
let lipSyncGeneration = 0;
let lipSyncLoad = Promise.resolve();
let lipSyncTimer = null;
const characterIds = new Set(['emilia', 'rem', 'ram', 'beatrice', 'felt', 'crusch', 'anastasia', 'echidna', 'hotaru']);
let requestedCharacter = 'emilia';
function characterOutfit(id) {
  const path = id === 'emilia'
    ? './assets/live2d/emilia/classic/model.model3.json'
    : id === 'hotaru'
      ? './assets/live2d/characters/hotaru/casual/model.model3.json'
    : `./assets/live2d/characters/${id}/classic/model.model3.json`;
  return { id, model: new URL(path, window.location.href).href };
}
window.__setCharacter = id => {
  const next = characterIds.has(id) ? id : 'emilia';
  if (next !== requestedCharacter) window.__setLipSync?.(null);
  requestedCharacter = next;
  if (pet) return pet.setOutfit(characterOutfit(requestedCharacter)).catch(cause => {
    console.warn('[live2d] character switch failed', cause);
  });
};
window.__setState = state => {
  requestedState = state;
  if (!lipSyncActive) pet?.setState(state);
};
window.__setAppearance = config => {
  pet?.setView(config.view);
  pet?.setSize(config.size);
};
window.__playCue = cue => {
  if (pet) pet.playCue(cue);
  else requestedCue = cue;
};
window.__lookAt = (x, y) => pet?.lookAt(x, y);
window.__setLipSync = cue => {
  const outfitReady = cue?.id && ['emilia', 'hotaru'].includes(cue.speakerId)
    && cue.speakerId !== requestedCharacter ? window.__setCharacter(cue.speakerId) : null;
  const generation = ++lipSyncGeneration;
  if (lipSyncTimer !== null) window.clearTimeout(lipSyncTimer);
  lipSyncTimer = null;
  lipSyncActive = false;
  pet?.stopLipSync();
  pet?.setState(requestedState);
  if (!cue?.id) return;
  lipSyncLoad = lipSyncLoad.catch(() => {}).then(async () => {
    await outfitReady;
    if (generation !== lipSyncGeneration || !pet) return;
    try {
      const url = `http://127.0.0.1:37471/voice/lipsync/audio?id=${encodeURIComponent(cue.id)}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const audio = await response.arrayBuffer();
      if (generation !== lipSyncGeneration) return;
      const elapsed = (Date.now() - cue.startedAt) / 1000;
      const remaining = await pet.startLipSync(audio, elapsed, cue.startedAt);
      if (generation !== lipSyncGeneration) {
        pet.stopLipSync();
        return;
      }
      if (!remaining) return;
      lipSyncActive = true;
      pet.setState('speaking');
      lipSyncTimer = window.setTimeout(() => {
        if (generation === lipSyncGeneration) window.__setLipSync(null);
      }, Math.ceil(remaining * 1000));
    } catch (cause) {
      console.warn('[live2d] lip sync unavailable', cause);
    }
  });
};

const canvas = document.getElementById('pet');
let dragPoint = null;
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragPoint = { x: event.screenX, y: event.screenY };
  window.webkit?.messageHandlers?.drag?.postMessage({ phase: 'start' });
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!dragPoint) return;
  const dx = event.screenX - dragPoint.x;
  const dy = event.screenY - dragPoint.y;
  dragPoint = { x: event.screenX, y: event.screenY };
  if (dx || dy) window.webkit?.messageHandlers?.drag?.postMessage({ phase: 'move', dx, dy });
});
function finishDrag() {
  if (!dragPoint) return;
  dragPoint = null;
  window.webkit?.messageHandlers?.drag?.postMessage({ phase: 'end' });
}
canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);

try {
  const coreUrl = new URL('./assets/vendor/live2dcubismcore.min.js', window.location.href).href;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = coreUrl;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  await window.PurismCoreReady;
  pet = await createLive2DPet(document.getElementById('pet'), { outfit: characterOutfit(requestedCharacter) });
  pet.setState(requestedState, { restart: true });
  if (requestedCue) pet.playCue(requestedCue);
  window.webkit?.messageHandlers?.ready?.postMessage('ready');
} catch (cause) {
  const detail = cause instanceof Event
    ? `${cause.type} ${cause.target?.src || cause.target?.url || cause.target?.tagName || ''}`
    : `${cause?.name || 'Error'}: ${cause?.message || String(cause)}\n${cause?.stack || ''}`;
  error.style.display = 'block';
  error.textContent = `Live2D 加载失败：${detail}`;
  window.webkit?.messageHandlers?.ready?.postMessage(`error: ${detail}`);
}
