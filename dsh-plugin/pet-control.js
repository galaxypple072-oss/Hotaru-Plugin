import { createServer } from 'node:http';
import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { handleCompanionApi } from './companion-api.js';
import { CUES } from './state.js';
import { loadAvatar } from './avatars.js';
import { RUNTIME_CONFIG } from './runtime-config.js';

const PORT = 37471;
const TTS_URL = RUNTIME_CONFIG.ttsUrl;
const FILE = join(homedir(), '.dsh', 'emilia-loop', 'pet-config.json');
const LIP_SYNC_FILE = join(homedir(), '.dsh', 'emilia-loop', 'lip-sync.json');
const APP = RUNTIME_CONFIG.petApp;
const defaults = { visible: true, view: 'half', size: 1, position: null,
  bubbleEnabled: true, mouseTracking: true };

function validPosition(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Math.abs(value.x) < 10000 && Math.abs(value.y) < 10000;
}

async function readConfig() {
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8'));
    return {
      visible: raw.visible !== false,
      view: raw.view === 'full' ? 'full' : 'half',
      size: Number.isFinite(raw.size) ? Math.min(1, Math.max(0.6, raw.size)) : 1,
      position: validPosition(raw.position) ? raw.position : null,
      bubbleEnabled: raw.bubbleEnabled !== false,
      mouseTracking: raw.mouseTracking !== false,
    };
  } catch { return { ...defaults }; }
}

function launch() {
  if (process.platform !== 'darwin' || !APP) return;
  const child = spawn('/usr/bin/open', ['-a', APP], { stdio: 'ignore' });
  child.on('error', error => console.warn('[emilia-loop] cannot open pet', error));
}

export function startPetControl(store, credentials, voice, onCharacterSelected = () => {}, music = null, onCue = () => false, hotaruMemory = null, options = {}) {
  const lipSyncFile = options.lipSyncFile || LIP_SYNC_FILE;
  let lipSync = null;
  let lipSyncGeneration = 0;
  let lipSyncWrite = Promise.resolve();
  function publishLipSync(value) {
    const work = lipSyncWrite.catch(() => {}).then(async () => {
      await mkdir(dirname(lipSyncFile), { recursive: true });
      const temporary = `${lipSyncFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value) + '\n');
        await rename(temporary, lipSyncFile);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
    lipSyncWrite = work;
    return work;
  }
  const musicLipLease = setInterval(() => {
    if (lipSync?.music && lipSync.expiresAt < Date.now()) {
      lipSyncGeneration += 1; lipSync = null;
      void publishLipSync({ id: null }).catch(() => {});
    }
  }, 1000);
  musicLipLease.unref?.();
  const lipCue = () => ({ id: lipSync.id, speakerId: lipSync.speakerId, startedAt: lipSync.startedAt,
    ...(lipSync.music ? { durationMs: lipSync.durationMs, expiresAt: lipSync.expiresAt } : {}) });
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const audioPath = request.url?.startsWith('/voice/lipsync/audio?') && request.method === 'GET';
    const petOrigin = audioPath && /^http:\/\/127\.0\.0\.1:\d+$/u.test(origin || '');
    if (origin && origin !== 'dsh-app://app' && !petOrigin) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', petOrigin ? origin : 'dsh-app://app');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    const avatarRoute = /^\/companion\/avatars\/([a-z]+)$/u.exec(request.url || '');
    if (avatarRoute && request.method === 'GET') {
      const avatar = await loadAvatar(avatarRoute[1]).catch(() => null);
      if (!avatar) { response.writeHead(404).end(); return; }
      const headers = { 'Content-Type': avatar.type, ETag: avatar.etag, 'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff' };
      if (request.headers['if-none-match'] === avatar.etag) response.writeHead(304, headers).end();
      else response.writeHead(200, headers).end(avatar.bytes);
      return;
    }
    if (audioPath) {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id');
      if (!lipSync || lipSync.id !== id || lipSync.phase !== 'playing') {
        response.writeHead(404).end();
      } else {
        response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(lipSync.audio.length) })
          .end(lipSync.audio);
      }
      return;
    }
    if (request.url?.startsWith('/voice/lipsync/') && request.method === 'POST') {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8192) throw new Error('请求内容过长');
        }
        const input = JSON.parse(body);
        if (request.url === '/voice/lipsync/prepare-music') {
          if (!music || typeof input.songId !== 'string' || !/^[a-f0-9-]{36}$/u.test(input.songId)) throw new Error('曲目参数无效');
          const generation = ++lipSyncGeneration;
          const route = { speakerId: 'hotaru', sessionId: input.sessionId };
          voice.resolveSpeaker(route);
          const { audio, seconds } = await music.lipSyncAudio(input.songId);
          if (generation !== lipSyncGeneration) throw new Error('播放已切换');
          voice.resolveSpeaker(route);
          lipSync = { id: randomUUID(), audio, speakerId: 'hotaru', input: route, music: true,
            phase: 'prepared', durationMs: Math.min(900000, Math.max(1000, seconds * 1000)), expiresAt: Date.now() + 15000 };
          await publishLipSync({ id: null });
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: lipSync.id }));
        } else if (request.url === '/voice/lipsync/heartbeat') {
          if (lipSync?.music && lipSync.id === input.id && lipSync.phase === 'playing') {
            voice.resolveSpeaker(lipSync.input); lipSync.expiresAt = Date.now() + 15000;
            await publishLipSync(lipCue());
          }
          response.writeHead(204).end();
        } else if (request.url === '/voice/lipsync/prepare') {
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1200) {
            throw new Error('只支持 1200 字以内的文本');
          }
          const generation = ++lipSyncGeneration;
          const speakerId = voice.resolveSpeaker(input);
          const audio = await voice.getOrCreate(input.text, speakerId);
          if (generation !== lipSyncGeneration) throw new Error('角色或播放已切换');
          voice.resolveSpeaker(input);
          const id = randomUUID();
          lipSync = { id, audio, speakerId, input, phase: 'prepared' };
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }));
        } else if (request.url === '/voice/lipsync/start') {
          if (lipSync?.id === input.id && lipSync.phase === 'prepared') {
            voice.resolveSpeaker(lipSync.input);
            lipSync.phase = 'playing';
            const startedAt = Number(input.startedAt);
            lipSync.startedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
            if (lipSync.music) lipSync.expiresAt = Date.now() + 15000;
            await publishLipSync(lipCue());
          }
          response.writeHead(204).end();
        } else if (request.url === '/voice/lipsync/stop') {
          if (lipSync?.id === input.id) {
            lipSync = null;
            await publishLipSync({ id: null });
          }
          response.writeHead(204).end();
        } else {
          response.writeHead(404).end();
        }
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: String(error.message || error).slice(0, 240) }));
      }
      return;
    }
    if (request.url === '/voice/health' && request.method === 'GET') {
      try {
        const upstream = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(2000) });
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(await upstream.text());
      } catch {
        response.writeHead(503, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ready: false, error: '本机 TTS 服务未运行' }));
      }
      return;
    }
    if (request.url === '/voice/synthesize' && request.method === 'POST') {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8192) throw new Error('请求内容过长');
        }
        const input = JSON.parse(body);
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1200) {
          throw new Error('只支持 1200 字以内的文本');
        }
        const audio = await voice.getOrCreate(input.text, voice.resolveSpeaker(input));
        response.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': String(audio.length),
        }).end(audio);
      } catch (error) {
        const status = error.message?.includes('1200 字') ? 400 : 503;
        response.writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: String(error.message || '语音服务暂时不可用').slice(0, 240) }));
      }
      return;
    }
    if (request.url === '/pet/cue' && request.method === 'POST') {
      try {
        let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 2048) throw new Error('动作请求过长'); }
        const input = JSON.parse(raw);
        if (typeof input.sessionId !== 'string' || input.sessionId.length > 200 || !CUES.has(input.cue)) throw new Error('动作参数无效');
        const applied = onCue(input.sessionId, input.cue);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ applied }));
      } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
      return;
    }
    if (request.url?.startsWith('/companion/hotaru/')) {
      const original = request.url;
      const url = new URL(original, 'http://127.0.0.1');
      const tail = url.pathname.slice('/companion/hotaru/'.length);
      if (!hotaruMemory || !/^(?:memories(?:\/[a-z0-9-]+(?:\/approve)?)?|topics(?:\/reset)?)$/iu.test(tail)) {
        response.writeHead(404).end(); return;
      }
      try {
        request.url = `/companion/${tail}${url.search}`;
        await handleCompanionApi(request, response, hotaruMemory, credentials);
      } finally { request.url = original; }
      return;
    }
    if (music && await music.handle(request, response)) return;
    if (await handleCompanionApi(request, response, store, credentials, sessionId => {
      lipSyncGeneration += 1;
      lipSync = null;
      void publishLipSync({ id: null }).catch(error => console.warn('[emilia-loop] lip sync reset failed', error));
      onCharacterSelected(sessionId);
    })) return;
    if (request.url !== '/pet') { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await readConfig()));
      return;
    }
    if (request.method !== 'PUT') { response.writeHead(405).end(); return; }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw new Error('request too large');
      }
      const input = JSON.parse(body);
      if (typeof input.visible !== 'boolean' || !['half', 'full'].includes(input.view)
          || !Number.isFinite(input.size) || input.size < 0.6 || input.size > 1
          || (input.position !== null && !validPosition(input.position))
          || typeof input.bubbleEnabled !== 'boolean'
          || typeof input.mouseTracking !== 'boolean') throw new Error('invalid pet settings');
      const config = { visible: input.visible, view: input.view, size: input.size,
        position: input.position, bubbleEnabled: input.bubbleEnabled,
        mouseTracking: input.mouseTracking };
      await mkdir(dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify(config) + '\n');
      if (config.visible) launch();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(config));
    } catch (error) {
      response.writeHead(400).end(String(error));
    }
  });
  server.on('error', error => console.warn('[emilia-loop] pet control unavailable', error));
  server.listen(options.port ?? PORT, '127.0.0.1', async () => {
    await publishLipSync({ id: null }).catch(error => console.warn('[emilia-loop] lip sync reset failed', error));
    if (options.launchPet !== false && (await readConfig()).visible) launch();
    options.onListening?.(server.address());
  });
  return () => {
    clearInterval(musicLipLease);
    lipSync = null;
    void publishLipSync({ id: null }).catch(error => console.warn('[emilia-loop] lip sync reset failed', error));
    server.close();
  };
}
