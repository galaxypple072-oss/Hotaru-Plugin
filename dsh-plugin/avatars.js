import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const FILES = Object.freeze({ emilia: 'emilia.jpg', hotaru: 'hotaru.png', rem: 'rem.webp', ram: 'ram.webp',
  beatrice: 'beatrice.webp', felt: 'felt.webp', crusch: 'crusch.webp', anastasia: 'anastasia.webp', echidna: 'echidna.webp' });
const cache = new Map();

export async function loadAvatar(id) {
  const file = FILES[id];
  if (!file) return null;
  if (!cache.has(id)) {
    let bytes, type;
    try {
      bytes = await readFile(new URL(`./assets/avatars/${file}`, import.meta.url));
      type = file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.png') ? 'image/png' : 'image/webp';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const label = id === 'emilia' ? 'EM' : id === 'hotaru' ? 'HO' : id.slice(0, 2).toUpperCase();
      bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${id === 'hotaru' ? '#374b68' : '#65517c'}"/><text x="64" y="77" text-anchor="middle" font-family="system-ui,sans-serif" font-size="36" fill="white">${label}</text></svg>`);
      type = 'image/svg+xml';
    }
    cache.set(id, { bytes, type,
      etag: `"${createHash('sha256').update(bytes).digest('hex')}"` });
  }
  return cache.get(id);
}

export function registerAvatarRoute(ctx) {
  return ctx.connection.fetch.register({ path: '/api/emilia/avatar', methods: ['GET'], requestBody: 'buffered',
    async fetch(request) {
      const avatar = await loadAvatar(new URL(request.url).searchParams.get('id'));
      if (!avatar) return new Response('not found', { status: 404 });
      const headers = { 'content-type': avatar.type, etag: avatar.etag, 'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff' };
      if (request.headers.get('if-none-match') === avatar.etag) return new Response(null, { status: 304, headers });
      return new Response(avatar.bytes, { headers });
    },
  });
}
