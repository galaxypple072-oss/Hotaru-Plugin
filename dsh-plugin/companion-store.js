import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STARTER_KNOWLEDGE } from './companion-content.js';
import { CHARACTERS } from './characters.js';

export const DEFAULT_COMPANION_SETTINGS = Object.freeze({
  backendModel: 'deepseek-flash',
  qwenModel: 'qwen-plus-character',
  qwenEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  topicTracking: true,
  autoMemory: true,
  autoPlayVoice: false,
  knowledgeEnabled: true,
  memoryRecallLimit: 5,
  episodeRecallLimit: 2,
  knowledgeRecallLimit: 2,
  extraPersona: '',
});

const MEMORY_KINDS = new Set(['preference', 'person', 'routine', 'relationship', 'commitment', 'other']);
const TOPIC_ACTIONS = new Set(['continue', 'elaborate', 'correct', 'side_question', 'switch', 'resume', 'close', 'wait']);
const SENSITIVE = /(?:密码|口令|验证码|api\s*key|access\s*token|secret|身份证|银行卡|信用卡|精确住址)/iu;

function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function boundedText(value, max, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

export function validateQwenEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Qwen 接口地址无效'); }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*aliyuncs\.com$/iu.test(url.hostname)
      || url.username || url.password || url.search || url.hash
      || url.pathname !== '/compatible-mode/v1/chat/completions') {
    throw new Error('Qwen 接口需使用阿里云百炼的 HTTPS Chat Completions 地址');
  }
  return url.href;
}

function asTopic(row) {
  if (!row) return null;
  return {
    id: row.id, sessionId: row.session_id, parentId: row.parent_id, title: row.title,
    status: row.status, phase: row.phase, goal: row.goal, userPosition: row.user_position,
    summary: row.summary, latestDevelopment: row.latest_development,
    openQuestions: json(row.open_questions_json, []), resumeHint: row.resume_hint,
    turnCount: row.turn_count, updatedAt: row.updated_at,
  };
}

function asMemory(row) {
  return {
    id: row.id, scope: row.scope, kind: row.kind, subject: row.subject,
    key: row.memory_key, content: row.content, sourceMessageId: row.source_message_id,
    evidence: row.evidence, provenance: row.provenance, confidence: row.confidence,
    importance: row.importance, pinned: Boolean(row.pinned), status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function validateCompanionSettings(input, current = DEFAULT_COMPANION_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式无效');
  const next = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_COMPANION_SETTINGS)) throw new Error(`未知设置：${key}`);
    if (key === 'backendModel') {
      if (!['deepseek-flash', 'deepseek-pro'].includes(value)) throw new Error('模型选项无效');
      next[key] = value;
    } else if (key === 'qwenModel') {
      if (!['qwen-plus-character', 'qwen-flash-character'].includes(value)) throw new Error('Qwen 模型选项无效');
      next[key] = value;
    } else if (key === 'qwenEndpoint') {
      next[key] = validateQwenEndpoint(value);
    } else if (key === 'extraPersona') {
      if (typeof value !== 'string' || value.length > 4000) throw new Error('补充设定过长');
      next[key] = value.trim();
    } else if (key.endsWith('Limit')) {
      if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error(`${key} 必须在 0 到 10 之间`);
      next[key] = value;
    } else {
      if (typeof value !== 'boolean') throw new Error(`${key} 必须是开关`);
      next[key] = value;
    }
  }
  return next;
}

export function openCompanionStore(path = join(homedir(), '.dsh', 'emilia-loop', 'companion.sqlite'), { seedKnowledge = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
      memory_key TEXT NOT NULL, content TEXT NOT NULL, source_message_id TEXT,
      evidence TEXT NOT NULL DEFAULT '', provenance TEXT NOT NULL, confidence REAL NOT NULL,
      importance INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','forgotten')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_status_idx ON memories(status, importance, updated_at);
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','paused','resolved')),
      phase TEXT NOT NULL, goal TEXT NOT NULL, user_position TEXT NOT NULL,
      summary TEXT NOT NULL, latest_development TEXT NOT NULL,
      open_questions_json TEXT NOT NULL, resume_hint TEXT NOT NULL,
      turn_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS topics_session_idx ON topics(session_id, status, updated_at);
    CREATE TABLE IF NOT EXISTS episodes (
      topic_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT NOT NULL, source_message_id TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_turns (
      session_id TEXT NOT NULL, message_id TEXT NOT NULL, topic_id TEXT,
      created_at INTEGER NOT NULL, PRIMARY KEY(session_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, triggers TEXT NOT NULL,
      content TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_seed (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS session_modes (
      session_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('companion','work')),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_characters (
      session_id TEXT PRIMARY KEY, character_id TEXT NOT NULL,
      first_message_id TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_model_contexts (
      session_id TEXT NOT NULL, model_id TEXT NOT NULL,
      first_message_id TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(session_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS reply_speakers (
      session_id TEXT NOT NULL, message_id TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY(session_id,message_id)
    );
  `);
  if (seedKnowledge && !db.prepare("SELECT 1 FROM content_seed WHERE name='starter-lore-v1'").get()) {
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare(`INSERT OR IGNORE INTO knowledge(id,title,triggers,content,source,enabled,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?)`);
      for (const item of STARTER_KNOWLEDGE) {
        insert.run(item.id, item.title, item.triggers, item.content, item.source, now, now);
      }
      db.prepare('INSERT OR IGNORE INTO content_seed(name,applied_at) VALUES (?,?)').run('starter-lore-v1', now);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }

  const store = {
    close() { db.close(); },
    saveReplySpeaker(sessionId, messageId, speaker) {
      if (!messageId || !speaker?.provider || !speaker?.model) return;
      const safe = { provider: String(speaker.provider).slice(0, 100), model: String(speaker.model).slice(0, 100),
        character: speaker.character === 'hotaru' || CHARACTERS.some(c => c.id === speaker.character) ? speaker.character : null,
        mode: speaker.mode === 'work' ? 'work' : 'companion' };
      db.prepare('INSERT OR IGNORE INTO reply_speakers VALUES (?,?,?)').run(sessionId, messageId, JSON.stringify(safe));
    },
    replySpeaker(sessionId, messageId) {
      // Forked sessions retain durable message IDs; provenance follows the original reply.
      const row = db.prepare('SELECT data_json FROM reply_speakers WHERE session_id=? AND message_id=?').get(sessionId, messageId)
        || db.prepare('SELECT data_json FROM reply_speakers WHERE message_id=? LIMIT 1').get(messageId);
      return row ? JSON.parse(row.data_json) : null;
    },
    getSettings() {
      const row = db.prepare('SELECT value FROM settings WHERE id = 1').get();
      return validateCompanionSettings(json(row?.value, {}));
    },
    updateSettings(patch) {
      const next = validateCompanionSettings(patch, this.getSettings());
      db.prepare('INSERT INTO settings(id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
        .run(JSON.stringify(next));
      return next;
    },
    getSessionMode(sessionId) {
      return db.prepare('SELECT mode FROM session_modes WHERE session_id=?').get(sessionId)?.mode || 'work';
    },
    setSessionMode(sessionId, mode) {
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('会话 ID 无效');
      if (!['companion', 'work'].includes(mode)) throw new Error('模式无效');
      db.prepare(`INSERT INTO session_modes(session_id,mode,updated_at) VALUES (?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at`)
        .run(sessionId, mode, Date.now());
      return mode;
    },
    getSessionCharacter(sessionId) {
      return db.prepare('SELECT character_id FROM session_characters WHERE session_id=?').get(sessionId)?.character_id || 'emilia';
    },
    setSessionCharacter(sessionId, characterId) {
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('会话 ID 无效');
      if (!CHARACTERS.some(character => character.id === characterId)) throw new Error('角色无效');
      db.prepare(`INSERT INTO session_characters(session_id,character_id,first_message_id,updated_at) VALUES (?,?,NULL,?)
        ON CONFLICT(session_id) DO UPDATE SET character_id=excluded.character_id,
          first_message_id=NULL,updated_at=excluded.updated_at`)
        .run(sessionId, characterId, Date.now());
      this.setSessionMode(sessionId, 'companion');
      return characterId;
    },
    messagesForSessionCharacter(sessionId, messages) {
      const conversation = messages.filter(message => message.role === 'user' || message.role === 'assistant');
      const row = db.prepare('SELECT first_message_id FROM session_characters WHERE session_id=?').get(sessionId);
      if (!row) return conversation;
      const anchor = row.first_message_id
        ? conversation.findIndex(message => message.id === row.first_message_id) : -1;
      if (anchor >= 0) return conversation.slice(anchor);
      const first = conversation.findLastIndex(message => message.role === 'user');
      if (first < 0) return [];
      const id = conversation[first]?.id;
      if (typeof id === 'string') {
        db.prepare('UPDATE session_characters SET first_message_id=? WHERE session_id=?').run(id, sessionId);
      }
      return conversation.slice(first);
    },
    resetSessionModelContext(sessionId, modelId) {
      db.prepare(`INSERT INTO session_model_contexts(session_id,model_id,first_message_id,updated_at)
        VALUES (?,?,NULL,?) ON CONFLICT(session_id,model_id) DO UPDATE SET
        first_message_id=NULL,updated_at=excluded.updated_at`).run(sessionId, modelId, Date.now());
    },
    messagesForSessionModel(sessionId, modelId, messages) {
      const conversation = messages.filter(message => message.role === 'user' || message.role === 'assistant');
      const row = db.prepare('SELECT first_message_id FROM session_model_contexts WHERE session_id=? AND model_id=?')
        .get(sessionId, modelId);
      const anchor = row?.first_message_id
        ? conversation.findIndex(message => message.id === row.first_message_id) : -1;
      if (anchor >= 0) return conversation.slice(anchor);
      const first = conversation.findLastIndex(message => message.role === 'user');
      if (first < 0) return [];
      const id = conversation[first]?.id;
      if (typeof id === 'string') {
        db.prepare(`INSERT INTO session_model_contexts(session_id,model_id,first_message_id,updated_at)
          VALUES (?,?,?,?) ON CONFLICT(session_id,model_id) DO UPDATE SET
          first_message_id=excluded.first_message_id,updated_at=excluded.updated_at`)
          .run(sessionId, modelId, id, Date.now());
      }
      return conversation.slice(first);
    },
    listMemories(limit = 100) {
      return db.prepare(`SELECT * FROM memories WHERE status IN ('active','candidate')
        ORDER BY pinned DESC, status ASC, importance DESC, updated_at DESC LIMIT ?`).all(limit).map(asMemory);
    },
    saveMemory(input) {
      const content = boundedText(input.content, 500);
      if (!content || SENSITIVE.test(content) || SENSITIVE.test(input.evidence || '')) throw new Error('记忆内容无效或包含敏感凭据');
      const kind = MEMORY_KINDS.has(input.kind) ? input.kind : 'other';
      const scope = input.scope === 'relationship' ? 'relationship' : 'user';
      const subject = boundedText(input.subject, 80, '用户') || '用户';
      const key = boundedText(input.key, 80, content.slice(0, 40)) || content.slice(0, 40);
      const provenance = input.provenance === 'extracted' ? 'extracted' : 'explicit';
      const status = input.status === 'candidate' ? 'candidate' : 'active';
      const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
      const now = Date.now();
      const existing = db.prepare('SELECT created_at FROM memories WHERE id = ?').get(id);
      db.prepare(`INSERT INTO memories(id,scope,kind,subject,memory_key,content,source_message_id,evidence,provenance,
        confidence,importance,pinned,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,kind=excluded.kind,subject=excluded.subject,
        memory_key=excluded.memory_key,content=excluded.content,source_message_id=excluded.source_message_id,
        evidence=excluded.evidence,provenance=excluded.provenance,confidence=excluded.confidence,
        importance=excluded.importance,pinned=excluded.pinned,status=excluded.status,updated_at=excluded.updated_at`)
        .run(id, scope, kind, subject, key, content, input.sourceMessageId ?? null,
          boundedText(input.evidence, 500), provenance,
          Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 1,
          Number.isInteger(input.importance) ? Math.max(1, Math.min(5, input.importance)) : 3,
          input.pinned ? 1 : 0, status, existing?.created_at ?? now, now);
      return asMemory(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
    },
    saveExtractedMemory(candidate, sourceMessageId, sourceText) {
      if (!candidate || typeof candidate !== 'object') return null;
      const evidence = boundedText(candidate.evidence, 300);
      if (!evidence || !sourceText.includes(evidence) || SENSITIVE.test(evidence)) return null;
      const content = boundedText(candidate.content, 300);
      if (!content || SENSITIVE.test(content)) return null;
      const kind = MEMORY_KINDS.has(candidate.kind) ? candidate.kind : null;
      if (!kind) return null;
      const scope = kind === 'relationship' || kind === 'commitment' ? 'relationship' : 'user';
      const subject = boundedText(candidate.subject, 80, '用户') || '用户';
      const key = boundedText(candidate.key, 80);
      if (!key) return null;
      const confidence = Number(candidate.confidence);
      if (!Number.isFinite(confidence) || confidence < 0.8) return null;
      const existing = db.prepare(`SELECT id FROM memories WHERE scope=? AND kind=? AND subject=? AND memory_key=?
        AND status IN ('active','candidate') ORDER BY updated_at DESC LIMIT 1`).get(scope, kind, subject, key);
      return this.saveMemory({ id: existing?.id, scope, kind, subject, key, content, evidence,
        sourceMessageId, provenance: 'extracted', confidence, importance: candidate.importance,
        status: scope === 'relationship' ? 'candidate' : 'active' });
    },
    setMemoryStatus(id, status) {
      if (!['active', 'forgotten'].includes(status)) throw new Error('记忆状态无效');
      const result = db.prepare('UPDATE memories SET status=?,updated_at=? WHERE id=?').run(status, Date.now(), id);
      if (!result.changes) throw new Error('找不到记忆');
    },
    getActiveTopic(sessionId) {
      return asTopic(db.prepare(`SELECT * FROM topics WHERE session_id=? AND status='active'
        ORDER BY updated_at DESC LIMIT 1`).get(sessionId));
    },
    listTopics(sessionId = null, limit = 30) {
      const rows = sessionId
        ? db.prepare('SELECT * FROM topics WHERE session_id=? ORDER BY updated_at DESC LIMIT ?').all(sessionId, limit)
        : db.prepare('SELECT * FROM topics ORDER BY updated_at DESC LIMIT ?').all(limit);
      return rows.map(asTopic);
    },
    listEpisodes(limit = 100) {
      return db.prepare('SELECT * FROM episodes ORDER BY updated_at DESC LIMIT ?').all(limit)
        .map(row => ({ topicId: row.topic_id, sessionId: row.session_id, title: row.title,
          summary: row.summary, sourceMessageId: row.source_message_id, updatedAt: row.updated_at }));
    },
    hasProcessedTurn(sessionId, messageId) {
      return Boolean(db.prepare('SELECT 1 FROM processed_turns WHERE session_id=? AND message_id=?').get(sessionId, messageId));
    },
    commitMemoryTurn(sessionId, messageId, extracted = []) {
      if (this.hasProcessedTurn(sessionId, messageId)) return;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO processed_turns(session_id,message_id,topic_id,created_at) VALUES (?,?,NULL,?)')
          .run(sessionId, messageId, Date.now());
        for (const item of extracted) this.saveExtractedMemory(item.candidate, item.sourceMessageId, item.sourceText);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    commitTurn(sessionId, messageId, plan, extracted = []) {
      if (this.hasProcessedTurn(sessionId, messageId)) return this.getActiveTopic(sessionId);
      const action = TOPIC_ACTIONS.has(plan.action) ? plan.action : 'continue';
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        let active = this.getActiveTopic(sessionId);
        let target = active;
        if (action === 'switch' || action === 'side_question') {
          if (active) {
            db.prepare("UPDATE topics SET status='paused',resume_hint=?,updated_at=? WHERE id=?")
              .run(boundedText(plan.resumeHint, 240, active.latestDevelopment), now, active.id);
            db.prepare(`INSERT INTO episodes(topic_id,session_id,title,summary,source_message_id,updated_at)
              VALUES (?,?,?,?,?,?) ON CONFLICT(topic_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at`)
              .run(active.id, sessionId, active.title, active.summary || active.latestDevelopment, messageId, now);
          }
          target = null;
        } else if (action === 'resume' && plan.resumeTopicId) {
          const resumed = db.prepare("SELECT * FROM topics WHERE id=? AND session_id=? AND status='paused'")
            .get(plan.resumeTopicId, sessionId);
          if (resumed) {
            if (active && active.id !== resumed.id) db.prepare("UPDATE topics SET status='paused',updated_at=? WHERE id=?").run(now, active.id);
            db.prepare("UPDATE topics SET status='active',updated_at=? WHERE id=?").run(now, resumed.id);
            target = asTopic(resumed);
          }
        } else if (action === 'close' && active) {
          db.prepare("UPDATE topics SET status='resolved',updated_at=? WHERE id=?").run(now, active.id);
          db.prepare(`INSERT INTO episodes(topic_id,session_id,title,summary,source_message_id,updated_at)
            VALUES (?,?,?,?,?,?) ON CONFLICT(topic_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at`)
            .run(active.id, sessionId, active.title, active.summary || active.latestDevelopment, messageId, now);
          target = null;
        }
        if (action !== 'close') {
          const title = boundedText(plan.title, 100, target?.title || '日常交流') || '日常交流';
          if (!target) {
            const id = randomUUID();
            db.prepare(`INSERT INTO topics(id,session_id,parent_id,title,status,phase,goal,user_position,summary,
              latest_development,open_questions_json,resume_hint,turn_count,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(id, sessionId, action === 'side_question' ? active?.id ?? null : null, title,
                'active', 'opening', boundedText(plan.goal, 240), boundedText(plan.userPosition, 240),
                boundedText(plan.summary, 600), boundedText(plan.latestDevelopment, 240),
                JSON.stringify(Array.isArray(plan.openQuestions) ? plan.openQuestions.slice(0, 3).map(q => boundedText(q, 120)) : []),
                '', 1, now, now);
            target = { id };
          } else {
            db.prepare(`UPDATE topics SET title=?,phase=?,goal=?,user_position=?,summary=?,latest_development=?,
              open_questions_json=?,turn_count=turn_count+1,updated_at=? WHERE id=?`)
              .run(title, action === 'wait' ? 'collecting' : action === 'correct' ? 'correcting' : 'developing',
                boundedText(plan.goal, 240, target.goal), boundedText(plan.userPosition, 240, target.userPosition),
                boundedText(plan.summary, 600, target.summary),
                boundedText(plan.latestDevelopment, 240, target.latestDevelopment),
                JSON.stringify(Array.isArray(plan.openQuestions) ? plan.openQuestions.slice(0, 3).map(q => boundedText(q, 120)) : target.openQuestions),
                now, target.id);
          }
        }
        db.prepare('INSERT INTO processed_turns(session_id,message_id,topic_id,created_at) VALUES (?,?,?,?)')
          .run(sessionId, messageId, target?.id ?? null, now);
        for (const item of extracted) this.saveExtractedMemory(item.candidate, item.sourceMessageId, item.sourceText);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return this.getActiveTopic(sessionId);
    },
    resetTopic(sessionId) {
      db.prepare("UPDATE topics SET status='resolved',updated_at=? WHERE session_id=? AND status='active'").run(Date.now(), sessionId);
    },
    listKnowledge(limit = 100) {
      return db.prepare('SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT ?').all(limit)
        .map(row => ({ id: row.id, title: row.title, triggers: row.triggers, content: row.content,
          source: row.source, enabled: Boolean(row.enabled), updatedAt: row.updated_at }));
    },
    saveKnowledge(input) {
      const title = boundedText(input.title, 100);
      const content = boundedText(input.content, 2000);
      const source = boundedText(input.source, 300);
      if (!title || !content || !source) throw new Error('知识条目需要标题、内容和来源');
      const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO knowledge(id,title,triggers,content,source,enabled,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,triggers=excluded.triggers,
        content=excluded.content,source=excluded.source,enabled=excluded.enabled,updated_at=excluded.updated_at`)
        .run(id, title, boundedText(input.triggers, 300), content, source,
          input.enabled === false ? 0 : 1, now, now);
      return this.listKnowledge().find(item => item.id === id);
    },
    deleteKnowledge(id) { db.prepare('DELETE FROM knowledge WHERE id=?').run(id); },
  };
  return store;
}
