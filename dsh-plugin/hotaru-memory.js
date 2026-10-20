import { homedir } from 'node:os';
import { join } from 'node:path';
import { openCompanionStore } from './companion-store.js';
import { fallbackPlan, planCompanionTurn, selectCompanionContext, buildCompanionPrompt } from './companion-engine.js';

export function openHotaruMemory(path) {
  return openCompanionStore(path || join(homedir(), '.dsh', 'emilia-loop', 'hotaru-memory.sqlite'), { seedKnowledge: false });
}

export async function prepareHotaruMemory(ctx, store, settings, conversation, sessionId, turnId, persona, signal) {
  const ownSettings = { ...settings, knowledgeEnabled: false, extraPersona: '' };
  const latest = conversation.findLast(m => m.role === 'user');
  const active = settings.topicTracking ? store.getActiveTopic(sessionId) : null;
  const paused = settings.topicTracking ? store.listTopics(sessionId, 10).filter(t => t.status === 'paused') : [];
  let plan = fallbackPlan(latest?.text || '', active);
  if (latest && turnId && !store.hasProcessedTurn(sessionId, turnId) && (settings.topicTracking || settings.autoMemory)) {
    plan = await planCompanionTurn(ctx, settings.backendModel, conversation, active, paused, signal,
      store.listMemories(100).map(m => ({ key: m.key, kind: m.kind, subject: m.subject, content: m.content })));
  }
  const selected = selectCompanionContext(store, ownSettings, plan, active, latest?.text || '');
  plan.memoryCandidates = (plan.memoryCandidates || []).filter(item => item.sourceMessageId === latest?.id);
  return { plan, prompt: buildCompanionPrompt(persona, ownSettings, active, plan, selected) };
}

export function commitHotaruMemory(store, settings, sessionId, turnId, plan) {
  if (!turnId || store.hasProcessedTurn(sessionId, turnId)) return;
  if (settings.topicTracking) store.commitTurn(sessionId, turnId, plan, settings.autoMemory ? plan.memoryCandidates || [] : []);
  else if (settings.autoMemory) store.commitMemoryTurn(sessionId, turnId, plan.memoryCandidates || []);
}
