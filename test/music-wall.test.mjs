import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Run the real bridge with a controllable media element. No audio, server or DB
// mutation is needed to reproduce a user cancelling/changing a pending download.
async function mount(options = {}) {
  const source = await readFile(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');
  const component = source.slice(source.indexOf('    function MusicWall('), source.indexOf('    function MusicDialog('));
  const effects = [], listeners = new Map(), requests = [], messages = [], played = [], revoked = [], timers = [];
  const rows = ['a', 'b'].map(id => ({ id, status: 'completed', audioAvailable: true, seconds: 200, kind: 'cover', vocalAvailable: true }));
  const iframeWindow = { postMessage: data => messages.push(data) };
  const pending = new Map();
  let audio;
  class FakeAudio {
    paused = true; ended = false; currentTime = 0;
    constructor() { audio = this; }
    pause() { if (!this.paused) { this.paused = true; this.onpause?.(); } }
    async play() { this.paused = false; played.push(this.src); this.onplay?.(); this.onplaying?.(); }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const context = {
    React: { useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect: effect => effects.push(effect), Fragment: 'fragment' },
    h: (tag, props, ...children) => { if (tag === 'iframe') props.ref.current = { contentWindow: iframeWindow }; return { tag, props, children }; },
    Audio: FakeAudio, musicWallDocument: '', MusicCard() {}, button: {},
    api: async (...args) => { requests.push(args); const result = options.api?.(...args); return result === undefined ? rows.find(row => args[0].includes(row.id)) || {} : result; },
    musicAudio: id => new Promise(resolve => pending.set(id, resolve)),
    URL: { createObjectURL: blob => `blob:${blob.id}`, revokeObjectURL: src => revoked.push(src) },
    crypto: { randomUUID: () => 'test-playback' },
    diaryMouth: () => ({ stop() {}, start() {}, heartbeat() {} }),
    currentMusic: null, currentVoice: null,
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
    setInterval: callback => { timers.push(callback); return timers.length; }, clearInterval() {},
  };
  const MusicWall = runInNewContext(`${component}; MusicWall`, context);
  MusicWall({ songs: rows, sessionId: 'session', onChange() {}, onClose() {} });
  const cleanups = effects.map(effect => effect()).filter(Boolean);
  return { pending, played, requests, messages, revoked, audio: () => audio,
    tick: () => timers.forEach(callback => callback()),
    message: (data, trusted = true) => listeners.get('message')({ source: trusted ? iframeWindow : {}, data: { channel: 'hotaru-wall', ...data } }),
    close: () => cleanups.forEach(cleanup => cleanup()),
  };
}

test('cover-wall pause or close cancels audio that is still downloading', async () => {
  for (const action of ['pause', 'close']) {
    const wall = await mount();
    const playing = wall.message({ type: 'play', id: 'a', time: 0 });
    if (action === 'pause') await wall.message({ type: 'pause' }); else wall.close();
    wall.pending.get('a')({ id: 'a' }); await playing;
    assert.deepEqual(wall.played, []);
    if (action !== 'close') wall.close();
  }
});

test('official playback changes selection without fetching or replacing the playlist with a queue', async () => {
  const first = { id: 'hk:1', title: 'First', artist: 'Artist', album: 'Album', duration: 200 };
  const next = { ...first, id: 'hk:2', title: 'Next' };
  let current = first;
  const wall = await mount({ api: path => path.endsWith('/apple/search') ? { tracks: [first] }
    : path.endsWith('/apple/play') ? { verified: true, state: 'playing', position: 3 }
    : path.includes('/apple/session?') ? { matched: current === first, current, state: 'playing', position: 8 }
    : undefined });
  await wall.message({ type: 'apple-search', query: 'First', country: 'hk', requestId: 1 });
  await wall.message({ type: 'play', id: first.id, time: 0 });
  await new Promise(resolve => setImmediate(resolve));
  current = next; wall.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(wall.messages.find(m => m.type === 'apple-current')?.current.id, next.id);
  assert.equal(wall.requests.filter(r => r[0].endsWith('/apple/play')).length, 1);
  assert.equal(wall.requests.filter(r => r[0].includes('queue=1')).length, 0);
  assert.equal(wall.messages.filter(m => m.type === 'apple-session').length, 0);
  wall.close();
});

test('a natural playlist ending advances only within the selected playlist and stops at its last song', async () => {
  const tracks = ['first', 'last'].map(id => ({ id, playlistId: 'favorites', title: id, duration: 200, artworkUrl: 'cover' }));
  let current = tracks[0], ended = false, position = 199;
  const wall = await mount({ api: (path, method, input) => {
    if (path.includes('/playlist-tracks?')) return { playlist: { id: 'favorites' }, tracks };
    if (path.endsWith('/apple/play')) { current = tracks.find(t => t.id === input.id); ended = false; position = current === tracks[0] ? 199 : 0;
      return { verified: true, state: 'playing', position }; }
    if (path.includes('/apple/session?')) return { state: ended ? 'stopped' : 'playing', matched: !ended, current: ended ? null : current, track: ended ? null : current, position };
    return {};
  } });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await wall.message({ type: 'apple-playlist', id: 'favorites', requestId: 1 }); await settle();
  await wall.message({ type: 'play', id: 'first', time: 0 }); await settle();
  ended = true; wall.tick(); await settle(); await settle();
  assert.deepEqual(wall.requests.filter(r => r[0].endsWith('/apple/play')).map(r => r[2].id), ['first', 'last']);
  assert.equal(wall.messages.find(m => m.type === 'apple-current')?.current.id, 'last');
  position = 199; wall.tick(); await settle(); ended = true; wall.tick(); await settle();
  wall.tick(); await settle();
  assert.equal(wall.requests.filter(r => r[0].endsWith('/apple/play')).length, 2);
  assert.equal(wall.messages.filter(m => m.type === 'state').at(-1).playing, false);
  wall.close();
});

test('only the latest Apple search can update the music wall; stale responses and other windows are ignored', async () => {
  const searches = new Map();
  const wall = await mount({ api: (path, method, body) => path.endsWith('/apple/search') ? new Promise(resolve => searches.set(body.query, resolve)) : undefined });
  const first = wall.message({ type: 'apple-search', query: 'first', country: 'hk', requestId: 1 });
  const second = wall.message({ type: 'apple-search', query: 'second', country: 'jp', requestId: 2 });
  await wall.message({ type: 'apple-search', query: 'untrusted', requestId: 3 }, false);
  assert.equal(searches.size, 2);
  searches.get('second')({ tracks: [{ id: 'jp:2' }] }); await second;
  searches.get('first')({ tracks: [{ id: 'hk:1' }] }); await first;
  const updates = wall.messages.filter(m => m.type === 'apple-results');
  assert.equal(updates.length, 1); assert.equal(updates[0].requestId, 2);
  assert.equal(updates[0].tracks[0].id, 'jp:2'); wall.close();
});

test('initial wall loads favorites once and a late playlist response cannot replace a newer selection', async () => {
  let finish;
  const wall = await mount({ api: path => path.endsWith('/apple/playlists') ? { defaultId: 'favorites', playlists: [{ id: 'favorites' }, { id: 'other' }] }
    : path.includes('/playlist-tracks?id=favorites') ? new Promise(resolve => { finish = resolve; })
    : path.includes('/playlist-tracks?id=other') ? { playlist: { id: 'other' }, tracks: [{ id: 'chosen', artworkUrl: 'https://example.com/cover' }] } : undefined });
  await wall.message({ type: 'ready' }); await wall.message({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wall.requests.filter(r => r[0].endsWith('/apple/playlists')).length, 1);
  await wall.message({ type: 'apple-playlist', id: 'other', requestId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  finish({ playlist: { id: 'favorites' }, tracks: [{ id: 'default' }] });
  await new Promise(resolve => setImmediate(resolve));
  const updates = wall.messages.filter(m => m.type === 'apple-library');
  assert.equal(updates.length, 1); assert.equal(updates[0].tracks[0].id, 'chosen');
  assert.equal(wall.requests.filter(r => /apple\/(?:play|open)$/u.test(r[0])).length, 0);
  wall.close();
});

test('repeated Apple play clicks make one background request and never fall back to opening a window', async () => {
  let finish;
  const track = { id: 'hk:123', title: 'Online song', duration: 200 };
  const wall = await mount({ api: path => path.endsWith('/apple/search') ? { tracks: [track] }
    : path.endsWith('/apple/play') ? new Promise(resolve => { finish = resolve; }) : undefined });
  await wall.message({ type: 'apple-search', query: 'song', country: 'hk', requestId: 1 });
  const first = wall.message({ type: 'play', id: track.id, time: 0 });
  await wall.message({ type: 'play', id: track.id, time: 0 });
  finish({ verified: false, needsClient: true }); await first;
  assert.equal(wall.requests.filter(r => r[0].endsWith('/apple/play')).length, 1);
  assert.equal(wall.requests.filter(r => r[0].endsWith('/apple/open')).length, 0);
  wall.close();
});

test('resume waits for the previous pause acknowledgement so a late pause cannot silence it', async () => {
  const track = { id: 'hk:123', title: 'Song', duration: 200 };
  let finishPause, starts = 0;
  const wall = await mount({ api: (path, _method, body) => path.endsWith('/apple/search') ? { tracks: [track] }
    : path.endsWith('/apple/play') ? (starts++, { verified: true })
    : path.endsWith('/apple/control') && body.action === 'pause' ? new Promise(resolve => { finishPause = resolve; })
    : path.includes('/apple/session?') ? { current: track, matched: true, state: 'playing', position: 20 } : undefined });
  await wall.message({ type: 'apple-search', query: 'Song', country: 'hk', requestId: 1 });
  await wall.message({ type: 'play', id: track.id, time: 0 });
  await wall.message({ type: 'pause' });
  const resuming = wall.message({ type: 'play', id: track.id, time: 20 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  finishPause({}); await resuming;
  assert.equal(starts, 2);
  wall.close();
});

test('only the newest song can play when downloads finish out of order', async () => {
  const wall = await mount();
  const first = wall.message({ type: 'play', id: 'a', time: 0 });
  const second = wall.message({ type: 'play', id: 'b', time: 135 });
  wall.pending.get('b')({ id: 'b' }); await second;
  wall.pending.get('a')({ id: 'a' }); await first;
  assert.deepEqual(wall.played, ['blob:b']);
  assert.equal(wall.audio().currentTime, 135);
  await wall.message({ type: 'seek', id: 'b', time: 1000 });
  assert.equal(wall.audio().currentTime, 200);
  wall.close();
  assert.equal(wall.audio().paused, true);
  assert.deepEqual(wall.revoked, ['blob:b']);
});

test('cover-wall ignores other windows, unknown songs and invalid time values', async () => {
  const wall = await mount();
  await wall.message({ type: 'play', id: 'a', time: 0 }, false);
  await wall.message({ type: 'play', id: 'missing', time: 0 });
  await wall.message({ type: 'play', id: 'a', time: 'invalid' });
  assert.equal(wall.pending.size, 0);
  assert.deepEqual(wall.played, []);
  wall.close();
});
