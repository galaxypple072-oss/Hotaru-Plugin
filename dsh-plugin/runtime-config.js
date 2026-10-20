import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readRuntimeConfig({ env = process.env, home = homedir(), applications = '/Applications', workspace = fileURLToPath(new URL('../..', import.meta.url)) } = {}) {
  const file = env.AGENTS_TIME_CONFIG || join(env.DSH_HOME || join(home, '.dsh'), 'emilia-loop', 'services.json');
  let input = {};
  try { input = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法读取服务配置 ${file}：${error.message}`); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('services.json 必须是 JSON 对象');
  const localUrl = (value, fallback) => {
    const url = new URL(value || fallback);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('可选音频服务必须使用本机 HTTP 地址（不含路径或密钥）');
    return url.origin;
  };
  const path = (value, fallback) => {
    if (!value) return fallback && existsSync(fallback) ? fallback : null;
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('资源路径必须使用绝对路径');
    return resolve(value);
  };
  return {
    ttsUrl: localUrl(env.AGENTS_TIME_TTS_URL || input.ttsUrl, 'http://127.0.0.1:9881'),
    pianoUrl: localUrl(env.AGENTS_TIME_PIANO_URL || input.pianoUrl, 'http://127.0.0.1:9882'),
    pianoRuntime: path(env.AGENTS_TIME_PIANO_RUNTIME || input.pianoRuntime, join(workspace, 'stable-audio-runtime')),
    coversRoot: path(env.AGENTS_TIME_COVERS_ROOT || input.coversRoot, join(workspace, 'hotaru-rvc-runtime', 'covers')),
    petApp: path(env.AGENTS_TIME_PET_APP || input.petApp,
      existsSync(join(home, 'Applications', 'Emilia Live2D.app')) ? join(home, 'Applications', 'Emilia Live2D.app') : join(applications, 'Emilia Live2D.app')),
  };
}

export const RUNTIME_CONFIG = readRuntimeConfig();
