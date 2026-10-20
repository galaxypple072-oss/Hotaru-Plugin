import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPetControl } from '../dsh-plugin/pet-control.js';

test('singing mouth uses only curated vocal bytes, supports seeking past 2 minutes and ignores stale stops', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hotaru-mouth-'));
  const cuePath = join(root, 'lip.json');
  const songId = '12345678-1234-1234-1234-123456789abc';
  const vocal = Buffer.from('RIFF-test-vocal-only');
  let dispose, address;
  const ready = new Promise(resolve => { dispose = startPetControl({}, {}, { resolveSpeaker: input => input.speakerId }, () => {},
    { async lipSyncAudio(id) { assert.equal(id, songId); return { audio: vocal, seconds: 274 }; }, async handle() { return false; } },
    () => {}, null, { port: 0, launchPet: false, lipSyncFile: cuePath, onListening(value) { address = value; resolve(); } }); });
  try {
    await ready; const base = `http://127.0.0.1:${address.port}`;
    const post = (path, input) => fetch(base + '/voice/lipsync/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal((await post('prepare-music', { songId: '/etc/passwd' })).status, 400);
    const first = await (await post('prepare-music', { songId, sessionId: 'hotaru-chat' })).json();
    assert.equal((await fetch(base + `/voice/lipsync/audio?id=${first.id}`)).status, 404, 'prepared bytes not served until start');
    const startedAt = Date.now() - 160000;
    await post('start', { id: first.id, startedAt });
    let cue = JSON.parse(await readFile(cuePath, 'utf8'));
    assert.equal(cue.durationMs, 274000); assert.equal(cue.startedAt, startedAt); assert.ok(cue.expiresAt > Date.now());
    assert.deepEqual(Buffer.from(await (await fetch(base + `/voice/lipsync/audio?id=${first.id}`)).arrayBuffer()), vocal);
    const second = await (await post('prepare-music', { songId })).json();
    assert.notEqual(first.id, second.id);
    await post('start', { id: second.id, startedAt: Date.now() - 200000 });
    await post('stop', { id: first.id });
    assert.equal((await fetch(base + `/voice/lipsync/audio?id=${second.id}`)).status, 200);
    await post('heartbeat', { id: second.id });
    cue = JSON.parse(await readFile(cuePath, 'utf8')); assert.equal(cue.id, second.id);
    await post('stop', { id: second.id });
    assert.equal((await fetch(base + `/voice/lipsync/audio?id=${second.id}`)).status, 404);
    assert.equal(JSON.parse(await readFile(cuePath, 'utf8')).id, null);
  } finally { dispose?.(); await new Promise(resolve => setTimeout(resolve, 50)); await rm(root, { recursive: true, force: true }); }
});
