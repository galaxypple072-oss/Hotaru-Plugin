import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPresenceController } from '../dsh-plugin/index.js';
import { createStateSink } from '../dsh-plugin/state.js';

test('only the Emilia preset drives the pet; a reply remains visible before idle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emilia-loop-'));
  const path = join(directory, 'state.json');
  const sink = createStateSink(path);
  const presence = createPresenceController(sink);
  const ordinary = { id: 'ordinary', header: { agentPreset: 'standard' } };
  const emilia = { id: 'emilia', header: { agentPreset: 'emilia-companion' } };
  try {
    presence.onEvent(ordinary, { type: 'turn/start' });
    await sink.drain();
    await assert.rejects(readFile(path));

    presence.onEvent(emilia, { type: 'turn/start' });
    await sink.drain();
    assert.equal(JSON.parse(await readFile(path)).state, 'thinking');

    presence.onEvent(emilia, { type: 'assistant/message' });
    presence.onEvent(emilia, { type: 'turn/end' });
    await sink.drain();
    assert.equal(JSON.parse(await readFile(path)).state, 'speaking');

    await new Promise(resolve => setTimeout(resolve, 1600));
    await sink.drain();
    assert.equal(JSON.parse(await readFile(path)).state, 'idle');
  } finally {
    presence.dispose();
    await sink.drain();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Emilia X1 in standard mode drives the pet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emilia-model-'));
  const path = join(directory, 'state.json');
  const sink = createStateSink(path);
  const presence = createPresenceController(sink);
  const session = { id: 'standard-chat', header: { agentPreset: 'standard' } };
  try {
    presence.onEvent(session, { type: 'turn/start' });
    await sink.drain();
    await assert.rejects(readFile(path));

    presence.onEvent(session, {
      type: 'request/header',
      data: { header: { config: { provider: 'emilia-character', model: 'emilia-x1' } } },
    });
    await sink.drain();
    const state = JSON.parse(await readFile(path));
    assert.equal(state.state, 'thinking');
    assert.equal(state.sessionId, session.id);

    presence.onEvent(session, { type: 'assistant/message' });
    await sink.drain();
    assert.equal(JSON.parse(await readFile(path)).state, 'speaking');
  } finally {
    presence.dispose();
    await sink.drain();
    await rm(directory, { recursive: true, force: true });
  }
});

test('tool events, reply text and completion cue reach the desktop pet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emilia-pet-events-'));
  const path = join(directory, 'state.json');
  const sink = createStateSink(path);
  const presence = createPresenceController(sink);
  const session = { id: 'pet-flow', header: { agentPreset: 'emilia-companion' } };
  const current = async () => { await sink.drain(); return JSON.parse(await readFile(path)); };
  try {
    presence.onEvent(session, { type: 'turn/start' });
    assert.equal((await current()).bubble.text, '让我想想…');

    presence.onEvent(session, { type: 'tool/call' });
    assert.equal((await current()).state, 'working');

    presence.onEvent(session, { type: 'tool/result' });
    assert.equal((await current()).cue, 'nod');

    presence.onEvent(session, { type: 'assistant/message', data: { message: { content: [
      { type: 'text', text: '你好，今天一起看看吧。' },
    ] } } });
    const reply = await current();
    assert.equal(reply.state, 'speaking');
    assert.equal(reply.bubble.text, '你好，今天一起看看吧。');

    presence.onEvent(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    const completed = await current();
    assert.equal(completed.cue, 'smile');
    assert.equal(completed.bubble.text, reply.bubble.text);
  } finally {
    presence.dispose();
    await sink.drain();
    await rm(directory, { recursive: true, force: true });
  }
});
