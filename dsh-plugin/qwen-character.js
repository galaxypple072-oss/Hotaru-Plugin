import { conversationFromRequest } from './companion-engine.js';

function requestMessages(messages, model) {
  const history = conversationFromRequest(messages).slice(-16);
  let remaining = model === 'qwen-flash-character' ? 4500 : 16000;
  const selected = [];
  for (let index = history.length - 1; index >= 0 && remaining > 0; index--) {
    const item = history[index];
    const content = item.text.slice(0, Math.min(remaining, index === history.length - 1 ? 6000 : 1200));
    if (content) selected.push({ role: item.role, content });
    remaining -= content.length;
  }
  return selected.reverse();
}

function finishReason(value) {
  return value === 'length' ? { kind: 'max-tokens' } : { kind: 'stop' };
}

/** Stream an OpenAI-compatible Qwen Character response as DSH text chunks. */
export async function* streamQwenCharacter(options, config, fetchImpl = fetch) {
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: requestMessages(options.messages, config.model),
      character_options: { profile: config.profile },
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.min(options.maxTokens || 1024, 4096),
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    let message = '';
    try { message = String((await response.json()).error?.message || '').slice(0, 240); } catch { /* status is enough */ }
    throw new Error(`Qwen API HTTP ${response.status}${message ? `：${message}` : ''}`);
  }
  if (!response.body) throw new Error('Qwen 响应没有流内容');
  const decoder = new TextDecoder();
  let pending = '';
  let text = '';
  let started = false;
  let done = false;
  let nativeReason = 'stop';
  let usage = null;
  for await (const bytes of response.body) {
    pending = (pending + decoder.decode(bytes, { stream: true })).replace(/\r\n/gu, '\n');
    let split;
    while ((split = pending.indexOf('\n\n')) >= 0) {
      const event = pending.slice(0, split);
      pending = pending.slice(split + 2);
      const data = event.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { done = true; break; }
      const frame = JSON.parse(data);
      if (frame.error) throw new Error(`Qwen API：${String(frame.error.message || '请求失败').slice(0, 240)}`);
      const delta = frame.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        if (!started) { started = true; yield { type: 'block-start', index: 0, blockType: 'text' }; }
        text += delta;
        yield { type: 'text-delta', index: 0, text: delta };
      }
      if (frame.choices?.[0]?.finish_reason) nativeReason = frame.choices[0].finish_reason;
      if (frame.usage) usage = frame.usage;
    }
    if (done) break;
  }
  if (!done) throw new Error('Qwen 响应在完成前中断');
  if (started) yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  if (usage) {
    yield { type: 'usage', usage: {
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || undefined,
    } };
  }
  yield { type: 'finish', reason: finishReason(nativeReason) };
}
