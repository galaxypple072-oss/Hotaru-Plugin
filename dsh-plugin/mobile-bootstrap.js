import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PATH = '/emilia/mobile';
const SCRIPT = "location.replace('/');";
const SCRIPT_HASH = createHash('sha256').update(SCRIPT).digest('base64');
const PAGE = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>正在打开 DSH</title><body><p>正在打开 DSH…</p><script>${SCRIPT}</script><noscript><a href="/">打开 DSH</a></noscript></body></html>`;
const BRIDGE_FILE = join(homedir(), '.dsh', 'emilia-loop', 'remote-auth-bridge.json');

async function bridgeOrigin(request) {
  let config;
  try { config = JSON.parse(await readFile(BRIDGE_FILE, 'utf8')); }
  catch { return null; }
  if (!/^[a-f0-9]{64}$/u.test(config.secret || '')) return null;
  const address = request.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return null;
  let origin; try { origin = new URL(config.origin); } catch { return null; }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || origin.username || origin.password || origin.port) return null;
  if (request.headers.host !== origin.host) return null;
  const supplied = request.headers['x-emilia-auth-bridge'];
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/u.test(supplied)) return null;
  if (!timingSafeEqual(Buffer.from(config.secret, 'hex'), Buffer.from(supplied, 'hex'))) return null;
  return origin.origin;
}

export function registerMobileBootstrap(ctx) {
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: PATH,
      async handler(request, response) {
        if (request.method !== 'GET') {
          response.writeHead(405, { Allow: 'GET' }).end();
          return;
        }
        const origin = await bridgeOrigin(request);
        if (origin) {
          // Only the authenticated reverse proxy knows this server-side secret.
          // DSH still exchanges its normal launch token for its signed HttpOnly cookie.
          response.writeHead(303, {
            Location: ctx.connection.authenticatedUrl(`${origin}/`),
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          }).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        }).end(PAGE);
      },
    }), 'emilia mobile same-origin entry');
  });
}
