import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function refreshFixture(switching = false) {
  const html = await readFile(new URL('../dsh-plugin/assets/music-wall/adapted.html', import.meta.url), 'utf8');
  const start = html.indexOf("  window.addEventListener('message',function(e){");
  const end = html.indexOf("  $('#askf').addEventListener", start);
  let receive;
  const calls = { build: 0, camera: 0, background: 0, tabs: 0 };
  const rows = ['a', 'b'].map((id, i) => ({ id, createdAt: 2 - i, kind: 'cover', title: id, seconds: 200, status: 'completed', audioAvailable: true }));
  const tile = id => ({ dataset: { id }, classList: { toggle() {} }, querySelector: () => ({}), setAttribute() {} });
  const tiles = rows.map(row => tile(row.id));
  const elements = new Map();
  const context = {
    window: { addEventListener: (_name, callback) => { receive = callback; } }, parent: {},
    S: { tab: 'cover', sel: 1, playing: true, t: 97, items: { cover: rows, original: [], found: [] } },
    tiles, libraryLoaded: true, switching, requestedTab: 'found',
    $: key => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); },
    document: { querySelectorAll: () => { calls.tabs++; return []; } },
    buildWall: () => calls.build++, camera: () => calls.camera++, bgset: () => calls.background++,
    depth() {}, info() {}, progress() {}, emptyState() {}, stopAudio() {}, syncPlay() {},
  };
  runInNewContext(html.slice(start, end), context);
  return { context, calls, rows, tiles, send: songs => receive({ source: context.parent, data: { channel: 'hotaru-host', type: 'songs', songs } }) };
}

test('playback updates and reordered polls retain the same tiles, selection, time and camera', async () => {
  const view = await refreshFixture();
  for (let i = 0; i < 20; i++) view.send(i % 2 ? view.rows : [...view.rows].reverse());
  assert.equal(view.context.S.sel, 1);
  assert.equal(view.context.S.t, 97);
  assert.equal(view.context.S.playing, true);
  assert.equal(view.context.tiles[1], view.tiles[1]);
  assert.deepEqual({ build: view.calls.build, camera: view.calls.camera, background: view.calls.background }, { build: 0, camera: 0, background: 0 });
});

test('polling during tab motion updates data without rebuilding or overriding the requested tab', async () => {
  const view = await refreshFixture(true);
  view.send([...view.rows, { ...view.rows[0], id: 'new', createdAt: 3 }]);
  assert.equal(view.context.S.items.cover.length, 3);
  assert.equal(view.context.requestedTab, 'found');
  assert.deepEqual(view.calls, { build: 0, camera: 0, background: 0, tabs: 0 });
});
