import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { handleRemoteControlRequest } from '../dsh-plugin/remote-api.js';

const ctx = { connection: { authenticatedUrl: origin => `${origin}?token=test-token` } };
const request = value => new Request('http://127.0.0.1/api/emilia', {
  method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json' },
});

test('authenticated browser route forwards companion data only to local control', async () => {
  const seen = [];
  const fetchImpl = async (target, options) => {
    seen.push({ target: target.href, method: options.method, body: options.body });
    return Response.json({ mode: 'work' });
  };
  const response = await handleRemoteControlRequest(
    request({ path: '/companion/mode?sessionId=test', method: 'PUT', body: { mode: 'work' } }),
    ctx, fetchImpl,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: 'work' });
  assert.deepEqual(seen, [{ target: 'http://127.0.0.1:37471/companion/mode?sessionId=test',
    method: 'PUT', body: '{"mode":"work"}' }]);

  const forbidden = await handleRemoteControlRequest(
    request({ path: '//attacker.example/steal', method: 'GET' }), ctx, fetchImpl,
  );
  assert.equal(forbidden.status, 400);
  assert.equal(seen.length, 1);
});

test('pairing link uses the configured HTTPS origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emilia-remote-'));
  const config = join(directory, 'remote-access.json');
  try {
    await writeFile(config, JSON.stringify({ origin: 'https://emilia.example.com' }));
    const response = await handleRemoteControlRequest(request({ action: 'pairing' }), ctx, fetch, config);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: 'https://emilia.example.com/?token=test-token' });
    await writeFile(config, JSON.stringify({ origin: 'http://emilia.example.com' }));
    const invalid = await handleRemoteControlRequest(request({ action: 'pairing' }), ctx, fetch, config);
    assert.equal(invalid.status, 503);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('mobile voice proxy preserves speaker/session and WAV bytes', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const body = { text: 'こんにちは。', speakerId: 'hotaru', sessionId: 'hotaru-chat' };
  const response = await handleRemoteControlRequest(
    request({ path: '/voice/synthesize', method: 'POST', body }), ctx,
    async (url, options) => {
      assert.equal(url.href, 'http://127.0.0.1:37471/voice/synthesize');
      assert.deepEqual(JSON.parse(options.body), body);
      return new Response(bytes, { headers: { 'content-type': 'audio/wav' } });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
