import { createStateSink } from './state.js';
import { startPetControl } from './pet-control.js';
import { openCompanionStore } from './companion-store.js';
import { registerRemoteControl } from './remote-api.js';
import { createVoiceCache } from './voice-cache.js';
import { registerMobileBootstrap } from './mobile-bootstrap.js';
import { openMusicStore } from './music-store.js';
import { createMusicDiary } from './music-diary.js';
import { planMusicRecommendations } from './music-intent.js';
import { openHotaruMemory } from './hotaru-memory.js';
import { registerAvatarRoute } from './avatars.js';

const PRESET_ID = 'emilia-companion';
export const inject = ['credentials', 'connection', 'llm'];

export function createPresenceController(sink, store = null) {
  const presets = new Map();
  const models = new Map();
  const replyRoutes = new Map();
  let activeSessionId = null;
  let pendingIdle = null;
  let hasReply = false;
  let bubble = null;
  let replyCue = null;
  let lastPublishedState = 'idle';
  let musicDriven = false;
  const composing = new Map();
  const playback = new Map();
  function publish(state, sessionId = null, { text, cue = null } = {}) {
    musicDriven = false;
    if (state === 'idle' && sessionId) {
      if ([...playback.values()].some(p => p.sessionId === sessionId)) { state = 'listening'; musicDriven = true; }
      else if ([...composing.values()].includes(sessionId)) { state = 'working'; musicDriven = true; }
    }
    lastPublishedState = state;
    if (text !== undefined) bubble = text ? { text, until: Date.now() + 6500 } : null;
    if (bubble && bubble.until <= Date.now()) bubble = null;
    const character = sessionId && models.get(sessionId)?.model === 'hotaru-v0.1'
      ? 'hotaru' : sessionId ? store?.getSessionCharacter(sessionId) || 'emilia' : 'emilia';
    void sink.write(state, sessionId, { bubble, cue, character }).catch(error => {
      console.warn('[emilia-loop] pet state update failed', error);
    });
  }
  function replyPreview(event) {
    const blocks = event.data?.message?.content;
    if (!Array.isArray(blocks)) return '';
    const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text).join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  }
  function cancelPendingIdle() {
    if (pendingIdle !== null) clearTimeout(pendingIdle);
    pendingIdle = null;
  }
  const musicTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, value] of playback) if (value.until < now) playback.delete(id);
    if (musicDriven && activeSessionId) publish('idle', activeSessionId);
  }, 5000);
  musicTimer.unref?.();
  return {
    onCue(sessionId, cue) {
      if (activeSessionId !== sessionId || models.get(sessionId)?.model !== 'hotaru-v0.1') return false;
      replyCue = cue;
      publish(lastPublishedState, sessionId, { cue });
      return true;
    },
    onMusicActivity({ id, sessionId, phase, token }) {
      if (phase === 'composing') composing.set(id, sessionId);
      else if (['ready', 'failed', 'cancelled'].includes(phase)) composing.delete(id);
      if (phase === 'playing') playback.set(token, { sessionId, until: Date.now() + 15000 });
      else if (phase === 'stopped') playback.delete(token);
      if (activeSessionId !== null && activeSessionId !== sessionId) return;
      if (!activeSessionId) { activeSessionId = sessionId; models.set(sessionId, { model: 'hotaru-v0.1' }); }
      if (models.get(sessionId)?.model !== 'hotaru-v0.1') return;
      if (['thinking', 'speaking'].includes(lastPublishedState)) return;
      publish('idle', sessionId, { text: phase === 'composing' ? '把这段心情写成旋律…'
        : phase === 'playing' ? '一起听听这段旋律吧。' : phase === 'ready' ? '钢琴小品写好了。' : null,
        cue: phase === 'ready' ? 'smile' : null });
    },
    onCharacterSelected(sessionId) {
      activeSessionId = sessionId;
      cancelPendingIdle();
      publish('idle', sessionId, { text: null });
    },
    onEvent(session, event) {
      const id = String(session.id);
      if (event.type === 'agent-preset/selected') presets.set(id, event.data.agentPreset);
      if (event.type === 'model/selection') models.set(id, event.data);
      if (event.type === 'request/header') models.set(id, event.data.header.config);
      const preset = presets.get(id) ?? session.header?.agentPreset;
      const model = models.get(id) ?? session.requestHeader?.()?.config;
      if (event.type === 'request/header' || event.type === 'turn/start') {
        const mode = model?.model === 'hotaru-v0.1' ? 'companion' : store?.getSessionMode(id) || 'work';
        replyRoutes.set(id, { provider: model?.provider, model: model?.model, mode,
          character: model?.provider !== 'emilia-character' ? null : model?.model === 'hotaru-v0.1' ? 'hotaru'
            : model?.model === 'emilia-companion' ? 'emilia' : mode === 'companion' ? store?.getSessionCharacter(id) || 'emilia' : null });
      }
      if (event.type === 'assistant/message') {
        try { store?.saveReplySpeaker(id, event.data?.message?.id, replyRoutes.get(id)); }
        catch (error) { console.warn('[emilia-loop] reply identity was not saved:', error.message); }
      }
      const isAgentsTimeModel = model?.provider === 'emilia-character'
        && ['emilia-companion', 'emilia-x1', 'hotaru-v0.1'].includes(model?.model);
      if (event.type === 'model/selection' && isAgentsTimeModel) {
        activeSessionId = id;
        cancelPendingIdle();
        publish('idle', id, { text: null });
      }
      if (preset !== PRESET_ID && !isAgentsTimeModel) return;
      if (event.type === 'turn/start' || event.type === 'request/header') {
        cancelPendingIdle();
        activeSessionId = id;
        hasReply = false;
        replyCue = null;
        publish('thinking', id, { text: '让我想想…' });
      } else if (id === activeSessionId && event.type === 'tool/call') {
        publish('working', id, { text: '正在处理…' });
      } else if (id === activeSessionId && event.type === 'tool/result') {
        publish('thinking', id, { text: '整理结果中…', cue: 'nod' });
      } else if (id === activeSessionId && event.type === 'assistant/message') {
        hasReply = true;
        publish('speaking', id, { text: replyPreview(event) || '回应来了。' });
      } else if (id === activeSessionId && event.type === 'turn/end') {
        cancelPendingIdle();
        if (hasReply) {
          const outcome = event.data?.reason?.kind;
          publish('speaking', id, { cue: ['error', 'aborted', 'cancelled', 'failed'].includes(outcome)
            || model?.model === 'hotaru-v0.1' ? null : 'smile' });
          pendingIdle = setTimeout(() => {
            pendingIdle = null;
            if (activeSessionId === id) publish('idle', id);
          }, replyCue ? 3500 : 1500);
        } else {
          publish('idle', id, { text: null });
        }
      }
    },
    onDisposed(session) {
      const id = String(session.id);
      presets.delete(id);
      models.delete(id);
      replyRoutes.delete(id);
      for (const [key, value] of composing) if (value === id) composing.delete(key);
      for (const [key, value] of playback) if (value.sessionId === id) playback.delete(key);
      if (activeSessionId === id) {
        cancelPendingIdle();
        activeSessionId = null;
        publish('idle', null, { text: null });
      }
    },
    dispose() {
      clearInterval(musicTimer);
      composing.clear(); playback.clear();
      cancelPendingIdle();
      publish('idle', null, { text: null });
    },
  };
}

export function apply(ctx) {
  registerMobileBootstrap(ctx);
  const store = openCompanionStore();
  const sink = createStateSink();
  const presence = createPresenceController(sink, store);
  const voice = createVoiceCache(store, ctx.credentials);
  const musicStore = openMusicStore();
  const hotaruMemory = openHotaruMemory();
  const music = createMusicDiary(musicStore, store, ctx.credentials, {
    onActivity: event => presence.onMusicActivity(event),
    recommend: prompt => planMusicRecommendations(ctx, store.getSettings().backendModel, prompt),
  });
  const stopControl = startPetControl(store, ctx.credentials, voice, sessionId => presence.onCharacterSelected(sessionId), music,
    (sessionId, cue) => presence.onCue(sessionId, cue), hotaruMemory);
  ctx.effect(() => () => { stopControl(); voice.dispose(); void music.dispose().finally(() => musicStore.close());
    hotaruMemory.close(); store.close(); }, 'emilia pet and companion control');
  ctx.effect(() => registerRemoteControl(ctx), 'emilia authenticated web control');
  ctx.effect(() => registerAvatarRoute(ctx), 'emilia authenticated avatar images');
  ctx.on('session/event', (session, event) => {
    if (event.type === 'model/selection' && event.data?.provider === 'emilia-character'
        && event.data?.model === 'hotaru-v0.1') {
      store.resetSessionModelContext(String(session.id), 'hotaru-v0.1');
    }
    presence.onEvent(session, event);
    voice.onEvent(session, event);
  });
  ctx.on('session/disposed', session => { presence.onDisposed(session); voice.onDisposed(session); });
  ctx.effect(() => () => presence.dispose(), 'emilia pet reset');
}
