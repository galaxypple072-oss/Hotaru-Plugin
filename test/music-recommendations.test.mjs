import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { planMusicRecommendations } from '../dsh-plugin/music-intent.js';

test('general song planner requests factual original artists and validates structured output', async () => {
  const picks = [{ title: '光るなら', artist: 'Goose house', reason: '明亮的合唱' }];
  const ctx = { llm: { async *stream(input) {
    assert.equal(input.provider, 'deepseek-account'); assert.equal(input.reasoningEffort, 'off'); assert.match(input.system, /原唱/u);
    assert.equal(input.messages[0].content[0].text, '散步的 ACG 歌曲');
    yield { type: 'text-delta', text: JSON.stringify({ recommendations: picks }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  assert.deepEqual(await planMusicRecommendations(ctx, 'deepseek-flash', '散步的 ACG 歌曲'), picks);
  await assert.rejects(planMusicRecommendations({ llm: { async *stream() { yield { type: 'text-delta', text: '{}' }; } } }, 'deepseek-flash', ''), /没有有效/u);
});

test('recommendation popup waits for a human selection and refreshes only a verified real addition', async () => {
  const source = await readFile(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');
  const component = source.slice(source.indexOf('    function MusicRecommendationDialog('), source.indexOf('    function MusicWall('));
  const states = [], effects = [], nodes = [], calls = [], events = [];
  let cursor = 0, first = true, verified = false;
  const context = {
    React: {
      useRef: () => ({ current: { showModal() {}, close() {} } }),
      useState: value => { const key = cursor++; if (!(key in states)) states[key] = value;
        return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }]; },
      useEffect: effect => { if (first) effects.push(effect); },
    },
    h: (tag, props, ...children) => { const node = { tag, props: props || {}, children }; nodes.push(node); return node; },
    renderDialog: () => null, typography: {}, field: {}, button: {}, colors: {},
    api: async (path, method, body) => {
      calls.push({ path, method, body });
      if (path.endsWith('/playlists')) return { defaultId: 'favorites', playlists: [{ id: 'favorites', name: '心水歌曲', writable: true }] };
      if (path.endsWith('/suggest')) return { tracks: [{ id: 'new', title: 'New', artist: 'Artist' }] };
      return { added: verified, playlist: { id: 'favorites', name: '心水歌曲' } };
    },
    CustomEvent: class { constructor(type, input) { this.type = type; this.detail = input.detail; } },
    window: { dispatchEvent: event => events.push(event) },
  };
  const Dialog = runInNewContext(`${component}; MusicRecommendationDialog`, context);
  function render() { cursor = 0; nodes.length = 0; Dialog({ sessionId: 'chat', reply: 'original reply',
    initialTracks: [{ id: 'old', title: 'Old', artist: 'Artist' }], onClose() {} }); first = false; }
  const node = text => nodes.find(n => n.children.includes(text));
  render(); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); render();
  assert.equal(node('加入歌单').props.disabled, true);
  assert.equal(calls.filter(c => c.path.endsWith('/playlist-add')).length, 0);
  await nodes.find(n => n.tag === 'form').props.onSubmit({ preventDefault() {} }); render();
  nodes.find(n => n.tag === 'button' && 'aria-pressed' in n.props).props.onClick(); render();
  assert.equal(Boolean(node('加入歌单').props.disabled), false);
  await node('加入歌单').props.onClick(); render();
  assert.equal(events.length, 0); // An attempted write is not success.
  assert.match(nodes.find(n => n.props.role === 'alert').children[0], /尚未确认/u);
  verified = true; await node('加入歌单').props.onClick(); render();
  assert.equal(events.length, 1); assert.equal(events[0].detail.playlistId, 'favorites');
  assert.equal(node('已加入').props.disabled, true);
  assert.equal(calls.find(c => c.path.endsWith('/playlist-add')).body.reply, null); // New picks are not bound to the old chat reply.
});
