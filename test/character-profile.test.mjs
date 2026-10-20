import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHARACTER_MODELS } from '../dsh-plugin/character-profile.js';
import { apply } from '../dsh-plugin/model.js';

test('source profile exposes only its declared character models and preserves the appropriate legacy alias', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'character-profile-')); let adapter, dispose;
  apply({ effect(fn) { dispose = fn(); }, credentials: {}, llm: { registerAdapter(_names, value) { adapter = value; } } }, { storePath: join(temp, 'settings.sqlite') });
  try {
    assert.deepEqual((await adapter.listModels()).map(model => model.id), CHARACTER_MODELS);
    for (const id of ['emilia-x1', 'hotaru-v0.1', 'emilia-companion']) {
      if (CHARACTER_MODELS.includes(id) || id === 'emilia-companion' && CHARACTER_MODELS.includes('emilia-x1')) {
        assert.equal((await adapter.resolveModel('emilia-character', id)).id, id);
      } else await assert.rejects(adapter.resolveModel('emilia-character', id), /Unknown/u);
    }
  } finally { dispose(); await rm(temp, { recursive: true, force: true }); }
});
