import { randomUUID } from 'node:crypto';
import { openCompanionStore } from './companion-store.js';
import { COMPANION_PERSONA } from './companion-content.js';
import { characterById } from './characters.js';
import { HOTARU_PERSONA } from './hotaru-persona.js';
import { QWEN_KEY_REF } from './companion-api.js';
import { streamQwenCharacter } from './qwen-character.js';
import { openMusicStore, musicMemory } from './music-store.js';
import { decideMusicAction } from './music-intent.js';
import { CHARACTER_MODELS } from './character-profile.js';
import { openHotaruMemory, prepareHotaruMemory, commitHotaruMemory } from './hotaru-memory.js';
import {
  buildCompanionPrompt, conversationFromRequest, fallbackPlan, planCompanionTurn,
  selectCompanionContext, userTurnId, isCharacterConversationMessage,
} from './companion-engine.js';

const PROVIDER = 'emilia-character';
const MODEL = 'emilia-x1';
const HOTARU_MODEL = 'hotaru-v0.1';
const LEGACY_MODEL = 'emilia-companion';
const BACKEND_PROVIDER = 'deepseek-account';

export const inject = ['llm', 'credentials'];

export function apply(ctx, config = {}) {
  const store = openCompanionStore(config.storePath);
  const music = openMusicStore(config.storePath ? `${config.storePath}.music` : undefined);
  const hotaruMemory = openHotaruMemory(config.storePath ? `${config.storePath}.hotaru` : undefined);
  ctx.effect(() => () => { music.close(); hotaruMemory.close(); store.close(); }, 'emilia companion and hotaru music stores');
  const adapter = {
    providerInfo(provider) { return { id: provider, name: 'Agents-Time' }; },
    providerRetryPolicy() { return undefined; },
    imageRequestPricing() { return undefined; },
    async listModels() {
      return [
        { provider: PROVIDER, id: MODEL, name: 'Emilia X1', description: '陪伴 / 工作模式' },
        { provider: PROVIDER, id: HOTARU_MODEL, name: 'Hotaru V0.1', description: '汐见萤 · 陪伴对话' },
      ].filter(model => CHARACTER_MODELS.includes(model.id));
    },
    async resolveModel(provider, model) {
      if (provider !== PROVIDER || !(CHARACTER_MODELS.includes(model) || model === LEGACY_MODEL && CHARACTER_MODELS.includes(MODEL))) throw new Error(`Unknown Agents-Time model: ${provider}/${model}`);
      return { provider, id: model, name: model === MODEL ? 'Emilia X1' : model === HOTARU_MODEL ? 'Hotaru V0.1' : '爱蜜莉雅 · 陪伴', inputModalities: ['text'] };
    },
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) };
    },
    async *stream(options) {
      const settings = store.getSettings();
      const sessionId = String(options.sessionId || 'emilia-default');
      if (options.purpose === 'session-title' || options.purpose === 'compaction'
          || options.messages.some(message => message.source?.kind === 'dsh-session-title-llm')) {
        yield* ctx.llm.stream({ ...options, provider: BACKEND_PROVIDER, model: settings.backendModel });
        return;
      }
      if (options.model === HOTARU_MODEL) {
        const qwenKey = await ctx.credentials.resolve(QWEN_KEY_REF);
        if (!qwenKey?.value) throw new Error('Qwen API Key 尚未配置：请在 DSH「设置 → 角色与桌宠」中填写');
        const messages = store.messagesForSessionModel(sessionId, HOTARU_MODEL, options.messages.filter(isCharacterConversationMessage));
        const conversation = conversationFromRequest(messages);
        const latest = conversation.findLast(item => item.role === 'user');
        const turnId = userTurnId(sessionId, conversation);
        const memory = await prepareHotaruMemory(ctx, hotaruMemory, settings, conversation, sessionId, turnId, HOTARU_PERSONA, options.signal);
        let reply = '';
        for await (const chunk of streamQwenCharacter({ ...options, messages }, {
          endpoint: settings.qwenEndpoint, model: settings.qwenModel,
          apiKey: qwenKey.value, profile: memory.prompt + musicMemory(music, latest?.text || '', sessionId),
        }, config.fetchImpl)) {
          if (chunk.type === 'text-delta') reply += chunk.text;
          if (chunk.type === 'finish' && chunk.reason?.kind === 'stop' && reply.trim() && turnId) {
            try { commitHotaruMemory(hotaruMemory, settings, sessionId, turnId, memory.plan); }
            catch (error) { console.warn('[emilia-loop] Hotaru memory was not saved:', error.message); }
            music.saveExchange(sessionId, turnId, conversation, reply);
            const existingIntent = music.intent(sessionId, turnId);
            if (!existingIntent || ['checking', 'failed'].includes(existingIntent.status)) {
              music.saveIntent(sessionId, turnId, { status: 'checking' });
              let decision;
              try {
                const songs = music.list({ sessionId, limit: 200 });
                decision = await decideMusicAction({ conversation, reply, songs }, {
                  endpoint: settings.qwenEndpoint, model: settings.qwenModel, apiKey: qwenKey.value, signal: options.signal,
                }, config.fetchImpl);
                const invoke = async (path, method, input) => {
                  const response = await fetch(`http://127.0.0.1:37471${path}`, { method,
                    headers: { 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}),
                    signal: AbortSignal.timeout(path.endsWith('/apple/suggest') ? 65000 : 5000) });
                  if (!response.ok) throw new Error(`音乐请求 HTTP ${response.status}`);
                  return response.status === 204 ? {} : response.json();
                };
                if (decision.action === 'compose') {
                  const trigger = config.musicTrigger || (input => invoke('/companion/music', 'POST', input));
                  await trigger({ sessionId, reply, seconds: decision.seconds });
                } else if (decision.action === 'cancel') {
                  const cancel = config.musicCancel || (id => invoke(`/companion/music/${id}/cancel`, 'POST'));
                  for (const song of songs.filter(s => ['planning', 'queued', 'generating'].includes(s.status))) await cancel(song.id);
                } else if (decision.action === 'recommend') {
                  const suggest = config.musicSuggest || (input => invoke('/companion/music/apple/suggest', 'POST', input));
                  const result = await suggest({ picks: decision.recommendations, prompt: conversation.slice(-8).map(m => `${m.role}: ${m.text}`).join('\n').slice(-1800) });
                  decision.recommendations = result.tracks;
                  decision.presented = false;
                }
                if (decision.cue) {
                  const act = config.petCue || (input => invoke('/pet/cue', 'POST', input));
                  await act({ sessionId, cue: decision.cue }).catch(error => console.warn('[emilia-loop] pet cue failed:', error.message));
                }
                music.saveIntent(sessionId, turnId, { ...decision, status: 'done' });
              } catch (error) {
                console.warn('[emilia-loop] music action failed:', error.message);
                music.saveIntent(sessionId, turnId, { status: 'failed', error: error.message });
                if (decision?.action === 'compose' && !music.forTurn(sessionId, turnId)) {
                  const song = music.create(music.source(sessionId, reply));
                  music.update(song.id, { status: 'failed', error: `音乐任务未能提交：${error.message}。可以点击重试。` });
                }
              }
            }
          }
          yield chunk;
        }
        return;
      }
      const mode = options.model === LEGACY_MODEL ? 'legacy' : store.getSessionMode(sessionId);
      if (mode === 'work') {
        yield* ctx.llm.stream({ ...options, provider: BACKEND_PROVIDER, model: settings.backendModel });
        return;
      }
      const qwenKey = mode === 'companion' ? await ctx.credentials.resolve(QWEN_KEY_REF) : null;
      if (mode === 'companion' && !qwenKey?.value) {
        throw new Error('Qwen API Key 尚未配置：请在 DSH「设置 → 角色与桌宠」中填写');
      }
      const character = characterById(mode === 'legacy' ? 'emilia' : store.getSessionCharacter(sessionId));
      const characterMessages = store.messagesForSessionCharacter(sessionId, options.messages.filter(isCharacterConversationMessage));
      if (mode === 'companion' && character.id !== 'emilia') {
        yield* streamQwenCharacter({ ...options, messages: characterMessages }, {
          endpoint: settings.qwenEndpoint, model: settings.qwenModel,
          apiKey: qwenKey.value, profile: character.persona,
        }, config.fetchImpl);
        return;
      }
      const conversation = conversationFromRequest(characterMessages);
      const latest = [...conversation].reverse().find(item => item.role === 'user');
      const turnId = userTurnId(sessionId, conversation);
      const active = settings.topicTracking ? store.getActiveTopic(sessionId) : null;
      const paused = settings.topicTracking ? store.listTopics(sessionId, 10).filter(item => item.status === 'paused') : [];
      let plan = fallbackPlan(latest?.text || '', active);
      if (latest && turnId && !store.hasProcessedTurn(sessionId, turnId)
          && (settings.topicTracking || settings.autoMemory)) {
        plan = await planCompanionTurn(ctx, settings.backendModel, conversation, active, paused, options.signal);
      }
      const selected = selectCompanionContext(store, settings, plan, active, latest?.text || '');
      const prompt = buildCompanionPrompt(COMPANION_PERSONA, settings, active, plan, selected);
      const messages = [{
        id: randomUUID(), role: 'system', source: { kind: 'system-prompt' },
        content: [{ type: 'text', text: prompt }],
      }, ...characterMessages];
      const deepseekRequest = {
        ...options,
        provider: BACKEND_PROVIDER,
        model: settings.backendModel,
        messages,
        tools: [],
        toolHistory: { tools: [], updates: [] },
      };
      let completed = false;
      let reply = '';
      const response = mode === 'companion'
        ? streamQwenCharacter({ ...options, messages: characterMessages }, {
          endpoint: settings.qwenEndpoint, model: settings.qwenModel,
          apiKey: qwenKey.value, profile: prompt,
        }, config.fetchImpl)
        : ctx.llm.stream(deepseekRequest);
      for await (const chunk of response) {
        if (chunk.type === 'text-delta') reply += chunk.text;
        if (chunk.type === 'finish') completed = !['error', 'aborted'].includes(chunk.reason?.kind || chunk.reason);
        yield chunk;
      }
      if (completed && reply.trim() && turnId && !store.hasProcessedTurn(sessionId, turnId)) {
        try {
          if (settings.topicTracking) {
            store.commitTurn(sessionId, turnId, plan, settings.autoMemory ? plan.memoryCandidates || [] : []);
          } else if (settings.autoMemory) {
            store.commitMemoryTurn(sessionId, turnId, plan.memoryCandidates || []);
          }
        } catch (error) {
          console.warn('[emilia-loop] companion state was not saved', error);
        }
      }
    },
  };
  ctx.llm.registerAdapter([PROVIDER], adapter);
}
