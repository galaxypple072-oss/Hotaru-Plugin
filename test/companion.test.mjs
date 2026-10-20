import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { openCompanionStore } from '../dsh-plugin/companion-store.js';
import { handleCompanionApi } from '../dsh-plugin/companion-api.js';
import { apply as applyModel } from '../dsh-plugin/model.js';
import { STARTER_KNOWLEDGE } from '../dsh-plugin/companion-content.js';
import { validateQwenEndpoint } from '../dsh-plugin/companion-store.js';

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'emilia-companion-'));
  const path = join(directory, 'companion.sqlite');
  const store = openCompanionStore(path);
  try { await run(store, path); }
  finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('topic state survives a switch and resumes the correct parent topic', async () => {
  await withStore(store => {
    const first = store.commitTurn('chat', 'u1', {
      action: 'continue', title: '沙盒游戏', summary: '用户正在谈沙盒游戏',
      latestDevelopment: '用户喜欢沙盒游戏', openQuestions: ['喜欢哪种玩法？'],
    });
    assert.equal(first.title, '沙盒游戏');
    assert.equal(store.commitTurn('chat', 'u1', { action: 'switch', title: '错误重复' }).id, first.id);

    const child = store.commitTurn('chat', 'u2', {
      action: 'side_question', title: '模型选择', summary: '用户转而讨论模型',
      latestDevelopment: '用户询问模型', openQuestions: [],
    });
    assert.equal(child.parentId, first.id);
    assert.equal(store.listTopics('chat').find(item => item.id === first.id).status, 'paused');
    assert.equal(store.listEpisodes()[0].topicId, first.id);

    const resumed = store.commitTurn('chat', 'u3', {
      action: 'resume', resumeTopicId: first.id, title: '沙盒游戏',
      summary: '回到沙盒游戏', latestDevelopment: '用户继续聊游戏', openQuestions: [],
    });
    assert.equal(resumed.id, first.id);
    assert.equal(store.listTopics('chat').find(item => item.id === child.id).status, 'paused');
  });
});

test('extracted memory requires exact user evidence and relationship memory awaits approval', async () => {
  await withStore(store => {
    const invalid = store.saveExtractedMemory({ kind: 'preference', subject: '用户', key: 'food',
      content: '用户不吃香菜', evidence: '用户不吃香菜', confidence: 0.99 }, 'u1', '我喜欢香菜');
    assert.equal(invalid, null);
    assert.equal(store.saveExtractedMemory({ kind: 'preference', subject: '用户', key: 'secret',
      content: '用户有一个凭据', evidence: '我的密码是 123456', confidence: 0.99 }, 'u2', '我的密码是 123456'), null);
    const relationship = store.saveExtractedMemory({ kind: 'relationship', subject: '用户与爱蜜莉雅', key: 'promise',
      content: '双方约好以后继续聊游戏', evidence: '以后继续聊游戏', confidence: 0.95 }, 'u2', '我们以后继续聊游戏');
    assert.equal(relationship.status, 'candidate');
    store.setMemoryStatus(relationship.id, 'active');
    assert.equal(store.listMemories()[0].status, 'active');
    store.setMemoryStatus(relationship.id, 'forgotten');
    assert.equal(store.listMemories().length, 0);
  });
});

test('memory can be recorded with topic tracking disabled without creating a topic', async () => {
  await withStore(store => {
    store.commitMemoryTurn('chat', 'u1', [{
      candidate: { kind: 'preference', subject: '用户', key: 'game', content: '用户喜欢沙盒游戏',
        evidence: '我喜欢沙盒游戏', confidence: 0.95 },
      sourceMessageId: 'u1', sourceText: '我喜欢沙盒游戏',
    }]);
    assert.equal(store.listTopics().length, 0);
    assert.equal(store.listMemories()[0].content, '用户喜欢沙盒游戏');
    assert.equal(store.hasProcessedTurn('chat', 'u1'), true);
  });
});

test('companion settings API persists settings and manages knowledge', async () => {
  await withStore(async store => {
    let secret = null;
    const credentials = {
      async describe() { return { configured: Boolean(secret), writable: true }; },
      async set(_ref, value) { secret = value; },
      async unset() { secret = null; },
    };
    const request = async (path, method = 'GET', body) => {
      const response = {
        status: 200, payload: '',
        writeHead(status) { this.status = status; return this; },
        end(value) { this.payload = value; },
      };
      const incoming = { url: path, method, async *[Symbol.asyncIterator]() { if (body) yield JSON.stringify(body); } };
      await handleCompanionApi(incoming, response, store, credentials);
      return { status: response.status, body: JSON.parse(response.payload) };
    };
    const settings = await request('/companion/settings', 'PUT', { topicTracking: false, backendModel: 'deepseek-pro' });
    assert.equal(settings.body.topicTracking, false);
    assert.equal((await request('/companion/settings')).body.backendModel, 'deepseek-pro');
    assert.equal((await request('/companion/qwen-key')).body.configured, false);
    assert.equal((await request('/companion/qwen-key', 'PUT', { key: 'sk-qwen-example' })).body.configured, true);
    assert.equal((await request('/companion/qwen-key')).body.configured, true);
    assert.equal(JSON.stringify((await request('/companion/qwen-key')).body).includes('sk-qwen-example'), false);
    assert.equal((await request('/companion/qwen-key', 'DELETE')).body.configured, false);
    assert.equal((await request('/companion/mode?sessionId=chat', 'PUT', { mode: 'companion' })).body.mode, 'companion');
    assert.equal((await request('/companion/mode?sessionId=chat')).body.mode, 'companion');
    assert.match((await request('/companion/content')).body.persona, /圣域试炼/u);
    assert.equal((await request('/companion/knowledge', 'POST', { title: '帕克', content: '精灵', source: '' })).status, 400);
    const saved = await request('/companion/knowledge', 'POST', { title: '帕克', triggers: '帕克', content: '精灵', source: '手工整理' });
    assert.equal(saved.status, 200);
    assert.equal((await request('/companion/knowledge')).body.length, STARTER_KNOWLEDGE.length + 1);
    assert.equal((await request(`/companion/knowledge/${saved.body.id}`, 'DELETE')).status, 200);
    assert.equal((await request('/companion/knowledge')).body.length, STARTER_KNOWLEDGE.length);
  });
});

test('Qwen endpoint only accepts official HTTPS Chat Completions URLs', () => {
  assert.equal(validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.throws(() => validateQwenEndpoint('http://127.0.0.1/compatible-mode/v1/chat/completions'));
  assert.throws(() => validateQwenEndpoint('https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1/chat/completions'));
});

test('client registers a mode control beside the DSH model selector', async () => {
  let bundle;
  const source = await readFile(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');
  runInNewContext(source, { window: { __ModuleLoader__: { load(value) { bundle = value; } } } });
  const plugin = bundle.factory(() => ({ createElement() {} }));
  const registered = [];
  const directory = { store: { getSnapshot() {} } };
  plugin.apply({
    modelDirectories: { directoryFor() { return directory; } },
    slots: {
      entries() { return []; },
      inject(_seat, callback) { callback(); },
      register(options, component) { registered.push({ options, component }); },
    },
  });
  assert.ok(registered.some(item => item.options.name === 'settings.section'));
  const mode = registered.find(item => item.options.name === 'conversation.input.right');
  assert.equal(mode.options.inject('chat').directory, directory.store);
});

test('starter lore is sourced, editable, and seeded only once', async () => {
  await withStore((store, path) => {
    const initial = store.listKnowledge();
    assert.equal(initial.length, STARTER_KNOWLEDGE.length);
    assert.ok(initial.every(item => item.source.includes('https://')));
    store.saveKnowledge({ ...initial[0], content: '用户修改后的内容' });
    store.deleteKnowledge(initial[1].id);
    const reopened = openCompanionStore(path);
    try {
      assert.equal(reopened.listKnowledge().length, initial.length - 1);
      assert.equal(reopened.listKnowledge().find(item => item.id === initial[0].id).content, '用户修改后的内容');
      assert.equal(reopened.listMemories().length, 0);
      assert.equal(reopened.listTopics().length, 0);
    } finally { reopened.close(); }
  });
});

test('virtual companion model plans, recalls, and persists one real turn', async () => {
  await withStore(async (store, path) => {
    store.saveKnowledge({ title: '帕克', triggers: '帕克,大精灵', content: '帕克是与爱蜜莉雅关系密切的精灵。', source: '手工整理' });
    const calls = [];
    let adapter;
    let dispose;
    const ctx = {
      effect(cleanup) { dispose = cleanup(); },
      llm: {
        registerAdapter(_providers, value) { adapter = value; },
        async listModels() { return [{ id: 'deepseek-flash' }, { id: 'deepseek-pro' }]; },
        async *stream(options) {
          calls.push(options);
          const isPlanner = Boolean(options.system);
          const content = isPlanner ? JSON.stringify({
            action: 'continue', title: '帕克与游戏', summary: '用户在问帕克，也说自己喜欢沙盒游戏。',
            latestDevelopment: '用户询问帕克', goal: '', userPosition: '', openQuestions: [],
            recallTerms: ['帕克', '沙盒游戏'], memoryCandidates: [{
              kind: 'preference', subject: '用户', key: 'game_genre', content: '用户喜欢沙盒游戏',
              evidence: '我喜欢沙盒游戏', sourceMessageId: 'u1', confidence: 0.95, importance: 4,
            }],
          }) : '帕克对我很重要。你也喜欢沙盒游戏呀。';
          yield { type: 'text-delta', index: 0, text: content };
          yield { type: 'finish', reason: 'stop' };
        },
      },
    };
    applyModel(ctx, { storePath: path });
    const request = {
      provider: 'emilia-character', model: 'emilia-companion', sessionId: 'chat',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '我喜欢沙盒游戏。帕克是谁？' }] }],
    };
    const chunks = [];
    for await (const chunk of adapter.stream(request)) chunks.push(chunk);
    assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), '帕克对我很重要。你也喜欢沙盒游戏呀。');
    assert.equal(calls.length, 2);
    assert.match(calls[1].messages[0].content[0].text, /帕克是与爱蜜莉雅关系密切的精灵/u);
    assert.equal(store.getActiveTopic('chat').title, '帕克与游戏');
    assert.equal(store.listMemories()[0].content, '用户喜欢沙盒游戏');
    assert.equal(store.hasProcessedTurn('chat', 'u1'), true);
    dispose();
  });
});

test('Emilia X1 work mode forwards DeepSeek tools and companion mode streams Qwen Character', async () => {
  await withStore(async (store, path) => {
    const calls = [];
    let adapter;
    let dispose;
    let qwenRequest;
    const ctx = {
      effect(cleanup) { dispose = cleanup(); },
      credentials: { async resolve() { return { value: 'sk-qwen-example' }; } },
      llm: {
        registerAdapter(_providers, value) { adapter = value; },
        async listModels() { return [{ id: 'deepseek-flash' }]; },
        async *stream(options) {
          calls.push(options);
          yield { type: 'text-delta', index: 0, text: options.system ? JSON.stringify({
            action: 'continue', title: '帕克', summary: '用户问帕克', latestDevelopment: '用户问帕克',
            recallTerms: ['帕克'], memoryCandidates: [],
          }) : '工作回复' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      },
    };
    const sse = 'data: {"choices":[{"delta":{"content":"帕克"},"finish_reason":null}]}\n\n'
      + 'data: {"choices":[{"delta":{"content":"很重要"},"finish_reason":"stop"}]}\n\n'
      + 'data: {"usage":{"prompt_tokens":20,"completion_tokens":4,"total_tokens":24},"choices":[]}\n\n'
      + 'data: [DONE]\n\n';
    applyModel(ctx, { storePath: path, async fetchImpl(_url, request) {
      qwenRequest = request;
      return { ok: true, body: { async *[Symbol.asyncIterator]() {
        const bytes = new TextEncoder().encode(sse);
        yield bytes.slice(0, 17); yield bytes.slice(17);
      } } };
    } });
    const request = {
      provider: 'emilia-character', model: 'emilia-x1', sessionId: 'chat',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '帕克是谁？' }] }],
      tools: [{ name: 'test_tool' }],
    };
    const work = [];
    for await (const chunk of adapter.stream(request)) work.push(chunk);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, 'deepseek-account');
    assert.equal(calls[0].tools, request.tools);
    assert.equal(work[0].text, '工作回复');
    assert.equal(store.listTopics().length, 0);

    store.setSessionMode('chat', 'companion');
    const companion = [];
    for await (const chunk of adapter.stream(request)) companion.push(chunk);
    assert.equal(calls.length, 2); // One DeepSeek planning call; Qwen generates the answer.
    const body = JSON.parse(qwenRequest.body);
    assert.equal(body.model, 'qwen-plus-character');
    assert.match(body.character_options.profile, /帕克/u);
    assert.equal(body.messages.at(-1).content, '帕克是谁？');
    assert.equal(qwenRequest.headers.Authorization, 'Bearer sk-qwen-example');
    assert.equal(companion.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), '帕克很重要');
    assert.equal(companion.at(-1).reason.kind, 'stop');
    assert.equal(store.getActiveTopic('chat').title, '帕克');
    dispose();
  });
});
