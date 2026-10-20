import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('playlist wall stays fixed through playback and cover updates, preserving selection on refresh', async () => {
  const source = await readFile(new URL('../dsh-plugin/assets/music-wall/apple-search.js', import.meta.url), 'utf8');
  let receive, builds = 0, restarts = 0;
  const elements = new Map();
  const context = {
    parent: {}, window: { addEventListener: (_type, callback) => { receive = callback; } },
    S: { tab: 'found', items: { found: [] }, sel: 0, playing: false, t: 0 },
    playlistRequest: 0, playlistId: null, playlistName: '', playlistLoaded: false, libraryError: '', playlistSelect: {}, playlistArtwork: {},
    switching: false, tiles: [],
    $: key => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); },
    cur: () => context.S.items.found[context.S.sel],
    buildWall: () => { builds++; context.tiles = context.S.items.found.map(() => ({ style: {} })); },
    select: i => { context.S.sel = i; context.S.t = 0; if (context.S.playing) restarts++; },
    startAudio() { restarts++; }, emptyState() {}, info() {}, syncPlay() {}, progress() {}, bgset() {},
  };
  runInNewContext(source.slice(source.indexOf('  function wallItem(')), context);
  const rows = ['1', '2', '3'].map(id => ({ id, title: id, artist: 'A', album: 'B', duration: 200 }));
  const send = data => receive({ source: context.parent, data: { channel: 'hotaru-host', ...data } });
  send({ type: 'apple-library', requestId: 0, playlist: { id: 'favorites', name: '心水歌曲' }, tracks: rows });
  assert.equal(builds, 1); const tiles = context.tiles;
  send({ type: 'apple-notice', message: '未能关闭自动连播' });
  assert.match(elements.get('#trace').textContent, /未能/u);
  send({ type: 'apple-notice', message: '已核對：正在官方 Apple Music 背景播放。' });
  assert.equal(elements.get('#trace').textContent, '心水歌曲 · 共 3 首');
  send({ type: 'apple-current', current: rows[1], playing: true, time: 42 });
  assert.equal(builds, 1); assert.equal(context.S.sel, 1); assert.equal(restarts, 0);
  assert.deepEqual(Array.from(context.S.items.found, t => t.id), ['1', '2', '3']);
  send({ type: 'apple-artwork', id: '2', artworkUrl: 'data:image/jpeg;base64,abc' });
  assert.equal(context.tiles, tiles); assert.match(tiles[1].style.backgroundImage, /base64,abc/);
  send({ type: 'apple-session', current: { id: 'outside' }, tracks: [] });
  assert.equal(context.S.items.found.length, 3);
  send({ type: 'apple-library', requestId: 0, playlist: { id: 'favorites', name: '心水歌曲' }, tracks: rows });
  assert.equal(context.S.sel, 1); assert.equal(context.S.t, 42); assert.equal(context.S.playing, true); assert.equal(builds, 1);
  context.playlistRequest = 1;
  send({ type: 'apple-library', requestId: 0, playlist: { id: 'stale', name: '旧歌单' }, tracks: [] });
  assert.equal(context.S.items.found.length, 3);
});
