import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOCAL_CONTROL = 'http://127.0.0.1:37471';
const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE']);
const REMOTE_CONFIG = join(homedir(), '.dsh', 'emilia-loop', 'remote-access.json');

async function pairingUrl(ctx, configPath = REMOTE_CONFIG) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
      || origin.search || origin.hash) throw new Error('手机入口必须是 HTTPS 域名');
  return ctx.connection.authenticatedUrl(origin.href);
}

function controlPath(path) {
  if (typeof path !== 'string' || path.length > 512 || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('接口路径无效');
  }
  const url = new URL(path, LOCAL_CONTROL);
  if (url.origin !== LOCAL_CONTROL || (url.pathname !== '/pet' && !url.pathname.startsWith('/companion/')
      && !['/voice/health', '/voice/synthesize'].includes(url.pathname))) {
    throw new Error('接口路径无效');
  }
  return url;
}

export async function handleRemoteControlRequest(request, ctx, fetchImpl = fetch, configPath = REMOTE_CONFIG) {
  try {
    const raw = await request.text();
    if (raw.length > 65536) throw new Error('请求过大');
    const input = JSON.parse(raw);
    if (input?.action === 'pairing') {
      try {
        return Response.json({ url: await pairingUrl(ctx, configPath) }, { headers: { 'cache-control': 'no-store' } });
      } catch {
        return Response.json({ error: '尚未配置手机入口；请先运行远程接入配置脚本。' }, {
          status: 503, headers: { 'cache-control': 'no-store' },
        });
      }
    }
    if (!input || typeof input !== 'object' || !METHODS.has(input.method)) throw new Error('接口方法无效');
    const target = controlPath(input.path);
    let upstream;
    try {
      upstream = await fetchImpl(target, {
        method: input.method,
        headers: input.body === undefined ? {} : { 'content-type': 'application/json' },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: request.signal,
      });
    } catch {
      return Response.json({ error: '本机 Emilia 控制服务暂时不可用' }, {
        status: 502, headers: { 'cache-control': 'no-store' },
      });
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

export function registerRemoteControl(ctx) {
  return ctx.connection.fetch.register({
    path: '/api/emilia',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleRemoteControlRequest(request, ctx),
  });
}
