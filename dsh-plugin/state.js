import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATES = new Set(['idle', 'thinking', 'speaking', 'working', 'listening']);
export const CUES = new Set(['nod', 'smile', 'question', 'denial', 'greeting', 'goodbye', 'serious']);

export function stateFilePath(env = process.env) {
  return env.EMILIA_PET_STATE_FILE || join(env.DSH_HOME || join(homedir(), '.dsh'), 'emilia-loop', 'state.json');
}

export function createStateSink(path = stateFilePath()) {
  let sequence = 0;
  let pending = Promise.resolve();
  return {
    write(state, sessionId = null, { bubble = null, cue = null, character = 'emilia' } = {}) {
      if (!STATES.has(state)) throw new Error(`unknown pet state: ${state}`);
      if (cue !== null && !CUES.has(cue)) throw new Error(`unknown pet cue: ${cue}`);
      const payload = {
        version: 2, sequence: ++sequence, state, sessionId, character,
        bubble: bubble && typeof bubble.text === 'string' && Number.isFinite(bubble.until)
          ? { text: bubble.text.slice(0, 120), until: bubble.until } : null,
        cue, updatedAt: new Date().toISOString(),
      };
      pending = pending.catch(() => undefined).then(async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
        await rename(temporary, path);
      });
      return pending;
    },
    drain() { return pending; },
  };
}
