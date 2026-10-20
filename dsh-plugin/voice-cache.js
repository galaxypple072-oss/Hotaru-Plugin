import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { QWEN_KEY_REF } from './companion-api.js';
import { RUNTIME_CONFIG } from './runtime-config.js';

const CACHE_DIR = join(homedir(), '.dsh', 'emilia-loop', 'voice-cache');
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TTS_URL = RUNTIME_CONFIG.ttsUrl + '/v1/synthesize';
const FAILED_TURNS = new Set(['error', 'aborted', 'cancelled', 'failed']);
const ACTION_BRACKETS = new Map([['（', '）'], ['(', ')'], ['【', '】'], ['[', ']']]);

export const VOICE_VERSIONS = Object.freeze({
  emilia: 'emilia-e15-e8-ja-v1',
  hotaru: 'hotaru-e8-56a5e96a-be50b36d-ja-v1',
});
export function voiceSpeaker(model, characterId = 'emilia') {
  if (model?.provider !== 'emilia-character') return null;
  if (model.model === 'hotaru-v0.1') return 'hotaru';
  return model.model === 'emilia-x1' && characterId === 'emilia' ? 'emilia' : null;
}

export function spokenText(input) {
  const text = typeof input === 'string' ? input : '';
  const closing = [];
  let result = '';
  for (const character of text) {
    if (ACTION_BRACKETS.has(character)) {
      closing.push(ACTION_BRACKETS.get(character));
    } else if (closing.length && character === closing.at(-1)) {
      closing.pop();
    } else if (!closing.length) {
      result += character;
    }
  }
  return result.replace(/\s+/gu, ' ').trim();
}

function voiceText(event) {
  const blocks = event.data?.message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('').trim();
}

async function cleanCache(cacheDir = CACHE_DIR) {
  await mkdir(cacheDir, { recursive: true });
  const files = await readdir(cacheDir, { withFileTypes: true });
  const entries = [];
  const now = Date.now();
  for (const file of files) {
    if (!file.isFile()) continue;
    const path = join(cacheDir, file.name);
    const isAudio = /^[a-f0-9]{64}\.wav$/u.test(file.name);
    const isTemporary = /^\.[a-f0-9-]{36}\.tmp$/u.test(file.name);
    if (!isAudio && !isTemporary) continue;
    let details;
    try { details = await stat(path); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (isTemporary && now - details.mtimeMs > 60 * 60 * 1000) {
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } else if (!isAudio) {
      continue;
    } else if (now - details.mtimeMs > MAX_AGE_MS) {
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } else {
      entries.push({ path, bytes: details.size, usedAt: details.mtimeMs });
    }
  }
  entries.sort((a, b) => a.usedAt - b.usedAt);
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  while (entries.length > MAX_FILES || bytes > MAX_BYTES) {
    const oldest = entries.shift();
    await unlink(oldest.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    bytes -= oldest.bytes;
  }
}

export function createVoiceCache(store, credentials, { cacheDir = CACHE_DIR } = {}) {
  const translations = new Map();
  const pending = new Map();
  const sessions = new Map();
  const processed = new Set();
  let queue = Promise.resolve();
  queue = queue.then(() => cleanCache(cacheDir)).catch(error => {
    console.warn('[emilia-loop] voice cache cleanup failed', error);
  });
  const cleanupTimer = setInterval(() => {
    queue = queue.then(() => cleanCache(cacheDir)).catch(error => {
      console.warn('[emilia-loop] voice cache cleanup failed', error);
    });
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref();

  async function japaneseSpeechText(text, speakerId) {
    if (/[\u3040-\u30ff]/u.test(text)) return text;
    const translationKey = `${speakerId}:${text}`;
    if (translations.has(translationKey)) return translations.get(translationKey);
    const key = await credentials.resolve(QWEN_KEY_REF);
    if (!key?.value) throw new Error('请先在「设置 → 角色与桌宠」配置 Qwen API Key，才能将中文回复译成日语');
    const settings = store.getSettings();
    const result = await fetch(settings.qwenEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.qwenModel,
        character_options: { profile: `朗读角色是${speakerId === 'hotaru' ? '汐见萤，语气自然、细腻、克制' : '爱蜜莉雅，语气温柔自然'}。你是专业的中日翻译。将用户给出的文本译成自然、口语化的日语，保留原意、人名和语气。忽略括号动作和舞台旁白。只输出日语译文，不解释，不加引号。` },
        messages: [{ role: 'user', content: `请翻译成日语：\n${text}` }],
        stream: false,
        max_tokens: 1600,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!result.ok) throw new Error(`日语翻译服务返回 HTTP ${result.status}`);
    const value = await result.json();
    const translated = value?.choices?.[0]?.message?.content?.trim();
    if (typeof translated !== 'string' || !/[\u3040-\u30ff]/u.test(translated) || translated.length > 1200) {
      throw new Error('日语翻译未返回可朗读的文本');
    }
    translations.set(translationKey, translated);
    if (translations.size > 50) translations.delete(translations.keys().next().value);
    return translated;
  }

  async function generate(text, path, speakerId) {
    const japanese = spokenText(await japaneseSpeechText(text, speakerId));
    if (!japanese) throw new Error('回复没有可朗读的内容');
    const result = await fetch(TTS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: japanese, speakerId }), signal: AbortSignal.timeout(120000),
    });
    if (!result.ok) {
      let detail = '';
      try { detail = String((await result.json()).error || '').slice(0, 160); } catch { /* Status is enough. */ }
      throw new Error(`本机 TTS 返回 HTTP ${result.status}${detail ? `：${detail}` : ''}`);
    }
    const audio = Buffer.from(await result.arrayBuffer());
    if (!audio.length || audio.length > MAX_BYTES) throw new Error('生成的音频超过缓存上限');
    await mkdir(cacheDir, { recursive: true });
    const temporary = join(cacheDir, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, audio, { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await cleanCache(cacheDir);
    return audio;
  }

  async function getOrCreate(input, speakerId = 'emilia') {
    if (!Object.hasOwn(VOICE_VERSIONS, speakerId)) throw new Error('此角色尚未配置语音');
    const text = spokenText(input);
    if (!text) throw new Error('回复没有可朗读的内容');
    if (text.length > 1200) throw new Error('只支持 1200 字以内的文本');
    const hash = createHash('sha256').update(JSON.stringify([speakerId, VOICE_VERSIONS[speakerId], 'ja-cut5-b3-seed1234-translate-v2', text])).digest('hex');
    const path = join(cacheDir, `${hash}.wav`);
    try {
      const audio = await readFile(path);
      const now = new Date();
      await utimes(path, now, now).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return audio;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (pending.has(hash)) return pending.get(hash);
    const work = queue.then(() => generate(text, path, speakerId));
    queue = work.catch(() => {});
    pending.set(hash, work);
    try { return await work; } finally { pending.delete(hash); }
  }

  function onEvent(session, event) {
    const id = String(session.id);
    const state = sessions.get(id) || { model: session.requestHeader?.()?.config, reply: null };
    if (event.type === 'model/selection') state.model = event.data;
    if (event.type === 'request/header') state.model = event.data.header.config;
    if (event.type === 'turn/start') state.reply = null;
    if (event.type === 'assistant/message') {
      const text = voiceText(event);
      if (text) state.reply = { id: event.data.message.id, text };
    }
    sessions.set(id, state);
    if (event.type !== 'turn/end') return;
    const reply = state.reply;
    state.reply = null;
    const text = spokenText(reply?.text);
    const speakerId = voiceSpeaker(state.model, store.getSessionCharacter(id));
    if (!speakerId
        || FAILED_TURNS.has(event.data?.reason?.kind) || !reply?.id
        || !text || text.length > 1200
        || processed.has(reply.id)) return;
    processed.add(reply.id);
    if (processed.size > 1000) processed.delete(processed.values().next().value);
    void getOrCreate(text, speakerId).catch(error => {
      console.warn('[emilia-loop] proactive voice generation failed', error);
    });
  }

  return {
    getOrCreate,
    resolveSpeaker(input) {
      const requested = input.speakerId ?? 'emilia';
      if (!Object.hasOwn(VOICE_VERSIONS, requested)) throw new Error('此角色尚未配置语音');
      if (input.sessionId !== undefined) {
        if (typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 200) throw new Error('会话 ID 无效');
        const model = sessions.get(input.sessionId)?.model;
        if (model && voiceSpeaker(model, store.getSessionCharacter(input.sessionId)) !== requested) {
          throw new Error('会话角色已切换，请重新播放');
        }
      }
      return requested;
    },
    onEvent,
    onDisposed(session) { sessions.delete(String(session.id)); },
    dispose() { clearInterval(cleanupTimer); sessions.clear(); },
  };
}
