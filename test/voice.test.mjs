import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceCache, spokenText, voiceSpeaker } from '../dsh-plugin/voice-cache.js';

test('speaker routing and nested stage direction filtering', () => {
  assert.equal(voiceSpeaker({ provider: 'emilia-character', model: 'hotaru-v0.1' }, 'emilia'), 'hotaru');
  assert.equal(voiceSpeaker({ provider: 'emilia-character', model: 'emilia-x1' }, 'rem'), null);
  assert.equal(voiceSpeaker({ provider: 'emilia-character', model: 'emilia-x1' }), 'emilia');
  assert.equal(voiceSpeaker({ provider: 'deepseek', model: 'hotaru-v0.1' }), null);
  assert.equal(spokenText('（微笑[挥手]）こんにちは。【旁白】'), 'こんにちは。');
  assert.equal(spokenText('（只有动作）'), '');
});

test('voices have isolated caches, deduplicate requests, translate and filter, and pre-generate Hotaru replies', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'hotaru-voice-'));
  const originalFetch = globalThis.fetch;
  const requests = [];
  const store = { getSettings: () => ({ qwenEndpoint: 'https://translation.invalid', qwenModel: 'test' }), getSessionCharacter: () => 'emilia' };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    if (String(url).includes('translation.invalid')) return Response.json({ choices: [{ message: { content: '（微笑）今日はいい天気ですね。' } }] });
    return new Response(Buffer.from(`WAV:${body.speakerId}:${body.text}`));
  };
  const voice = createVoiceCache(store, { resolve: async () => ({ value: 'test' }) }, { cacheDir });
  try {
    const text = 'こんにちは。';
    const [a, b] = await Promise.all([voice.getOrCreate(text, 'hotaru'), voice.getOrCreate(text, 'hotaru')]);
    assert.deepEqual(a, b);
    assert.equal(requests.length, 1);
    const emilia = await voice.getOrCreate(text);
    assert.notDeepEqual(emilia, a);
    await voice.getOrCreate(text, 'hotaru');
    assert.equal(requests.length, 2);
    await voice.getOrCreate('（挥手）今天天气真好。', 'hotaru');
    assert.equal(requests.at(-1).body.text, '今日はいい天気ですね。');
    assert.equal(requests.at(-1).body.speakerId, 'hotaru');
    assert.equal(requests.at(-2).body.messages[0].content.includes('挥手'), false);
    await assert.rejects(voice.getOrCreate('（微笑）', 'hotaru'), /没有可朗读/);
    await assert.rejects(voice.getOrCreate(text, 'rem'), /尚未配置/);
    const session = { id: 'h', requestHeader: () => ({ config: { provider: 'emilia-character', model: 'hotaru-v0.1' } }) };
    voice.onEvent(session, { type: 'assistant/message', data: { message: { id: 'reply', content: [{ type: 'text', text: 'おやすみなさい。' }] } } });
    voice.onEvent(session, { type: 'turn/end', data: {} });
    await voice.getOrCreate('おやすみなさい。', 'hotaru');
    assert.equal(requests.filter(r => r.body.text === 'おやすみなさい。').length, 1);
    assert.equal(voice.resolveSpeaker({ sessionId: 'h', speakerId: 'hotaru' }), 'hotaru');
    assert.throws(() => voice.resolveSpeaker({ sessionId: 'h', speakerId: 'emilia' }), /已切换/);
    voice.onEvent(session, { type: 'model/selection', data: { provider: 'emilia-character', model: 'emilia-x1' } });
    assert.throws(() => voice.resolveSpeaker({ sessionId: 'h', speakerId: 'hotaru' }), /已切换/);
    assert.equal((await readdir(cacheDir)).filter(name => name.endsWith('.wav')).length, 4);
  } finally {
    voice.dispose(); globalThis.fetch = originalFetch;
    await rm(cacheDir, { recursive: true, force: true });
  }
});
