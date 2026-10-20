import { COMPANION_PERSONA } from './companion-content.js';
import { CHARACTERS, characterById } from './characters.js';

export const QWEN_KEY_REF = 'EMILIA_QWEN_API_KEY';

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12000) throw new Error('请求内容过大');
  }
  return JSON.parse(body || '{}');
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

export async function handleCompanionApi(request, response, store, credentials, onCharacterSelected = () => {}) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const path = url.pathname;
  if (!path.startsWith('/companion/')) return false;
  try {
    if (path === '/companion/reply-speaker') {
      if (request.method !== 'GET') { send(response, 405, { error: '不支持此操作' }); return true; }
      const sessionId = url.searchParams.get('sessionId'), messageId = url.searchParams.get('messageId');
      if (!sessionId || !messageId || sessionId.length > 200 || messageId.length > 200) throw new Error('回复参数无效');
      send(response, 200, { speaker: store.replySpeaker(sessionId, messageId) });
      return true;
    }
    if (path === '/companion/characters') {
      if (request.method === 'GET') send(response, 200, CHARACTERS.map(({ id, name }) => ({ id, name })));
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/character') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId || sessionId.length > 200) throw new Error('会话 ID 无效');
      if (request.method === 'GET') {
        const character = characterById(store.getSessionCharacter(sessionId));
        send(response, 200, { id: character.id, name: character.name });
      } else if (request.method === 'PUT') {
        const id = store.setSessionCharacter(sessionId, (await readBody(request)).id);
        onCharacterSelected(sessionId);
        const character = characterById(id);
        send(response, 200, { id: character.id, name: character.name });
      } else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/mode') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId || sessionId.length > 200) throw new Error('会话 ID 无效');
      if (request.method === 'GET') send(response, 200, { mode: store.getSessionMode(sessionId) });
      else if (request.method === 'PUT') send(response, 200, { mode: store.setSessionMode(sessionId, (await readBody(request)).mode) });
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/qwen-key') {
      if (request.method === 'GET') {
        const info = await credentials.describe(QWEN_KEY_REF);
        send(response, 200, { configured: info.configured, source: info.source, writable: info.writable });
      } else if (request.method === 'PUT') {
        const key = (await readBody(request)).key;
        if (typeof key !== 'string' || !key.trim() || key.length > 300) throw new Error('API Key 无效');
        await credentials.set(QWEN_KEY_REF, key.trim());
        send(response, 200, { configured: true });
      } else if (request.method === 'DELETE') {
        await credentials.unset(QWEN_KEY_REF);
        send(response, 200, { configured: false });
      } else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/content') {
      if (request.method === 'GET') send(response, 200, { persona: COMPANION_PERSONA });
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/settings') {
      if (request.method === 'GET') send(response, 200, store.getSettings());
      else if (request.method === 'PUT') send(response, 200, store.updateSettings(await readBody(request)));
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/memories') {
      if (request.method === 'GET') send(response, 200, store.listMemories());
      else if (request.method === 'POST') send(response, 200, store.saveMemory(await readBody(request)));
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    const memory = /^\/companion\/memories\/([a-z0-9-]+)(?:\/(approve))?$/iu.exec(path);
    if (memory) {
      if (request.method === 'DELETE' && !memory[2]) {
        store.setMemoryStatus(memory[1], 'forgotten'); send(response, 200, { ok: true });
      } else if (request.method === 'POST' && memory[2] === 'approve') {
        store.setMemoryStatus(memory[1], 'active'); send(response, 200, { ok: true });
      } else if (request.method === 'PUT' && !memory[2]) {
        const existing = store.listMemories().find(item => item.id === memory[1]);
        if (!existing) throw new Error('找不到记忆');
        send(response, 200, store.saveMemory({ ...existing, ...await readBody(request), id: memory[1], provenance: 'explicit' }));
      } else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    if (path === '/companion/topics') {
      if (request.method !== 'GET') send(response, 405, { error: '不支持此操作' });
      else send(response, 200, store.listTopics());
      return true;
    }
    if (path === '/companion/topics/reset') {
      if (request.method !== 'POST') send(response, 405, { error: '不支持此操作' });
      else {
        const body = await readBody(request);
        if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error('会话 ID 无效');
        store.resetTopic(body.sessionId);
        send(response, 200, { ok: true });
      }
      return true;
    }
    if (path === '/companion/knowledge') {
      if (request.method === 'GET') send(response, 200, store.listKnowledge());
      else if (request.method === 'POST') send(response, 200, store.saveKnowledge(await readBody(request)));
      else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    const knowledge = /^\/companion\/knowledge\/([a-z0-9-]+)$/iu.exec(path);
    if (knowledge) {
      if (request.method === 'DELETE') {
        store.deleteKnowledge(knowledge[1]); send(response, 200, { ok: true });
      } else if (request.method === 'PUT') {
        send(response, 200, store.saveKnowledge({ ...await readBody(request), id: knowledge[1] }));
      } else send(response, 405, { error: '不支持此操作' });
      return true;
    }
    send(response, 404, { error: '找不到接口' });
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
