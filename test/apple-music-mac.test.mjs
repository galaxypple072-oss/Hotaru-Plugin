import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppleMusicMac, applePlaybackUrl, matchesAppleTrack } from '../dsh-plugin/apple-music-mac.js';

const row = { kind: 'song', trackId: 123, trackName: 'ただ君に晴れ', artistName: 'Yorushika', trackTimeMillis: 200000,
  trackViewUrl: 'https://music.apple.com/hk/album/example/100?i=123&uo=4' };

test('recommendations diversify artists, reject unrelated results and cache concurrent loads without player calls', async () => {
  let searches = 0;
  const service = createAppleMusicMac({
    execImpl: async () => { throw new Error('Recommendations must not touch the player'); },
    fetchImpl: async url => {
      searches++; const query = new URL(url).searchParams.get('term');
      const artist = query.startsWith('Afterglow') ? 'Afterglow' : query;
      return Response.json({ results: Array.from({ length: 5 }, (_, i) => ({ ...row, artistName: i === 4 ? 'Unrelated artist' : artist,
        trackId: `${artist}${i}`, trackName: `${artist} song ${i}` })) });
    },
  });
  const [a, b] = await Promise.all([service.recommend(), service.recommend()]);
  assert.equal(searches, 4); assert.equal(a.tracks.length, 16); assert.deepEqual(a, b);
  assert.equal(new Set(a.tracks.slice(0, 4).map(t => t.artist)).size, 4);
  assert.ok(a.tracks.every(t => t.artist !== 'Unrelated artist' && t.recommendationReason));
  assert.match(a.basis, /非 Apple 官方/u);
  await service.recommend(); assert.equal(searches, 4);
});
test('only Apple song links are handed to the official player', () => {
  assert.match(applePlaybackUrl(row.trackViewUrl), /^music:\/\/music.apple.com\/hk\/album\/example\/100\?i=123&play=1$/);
  for (const url of ['file:///tmp/test', 'https://music.apple.com.evil.test/hk/song/1', 'https://music.apple.com@evil.test/hk/song/1', 'https://music.apple.com/hk/playlist/test']) {
    assert.throws(() => applePlaybackUrl(url));
  }
});
test('opening a link is not reported as successful playback without matching real state', async () => {
  const calls = []; let current = { running: true, state: 'playing', track: { title: 'Another song', artist: 'Yorushika', duration: 200 } };
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    execImpl: async (file, args) => { calls.push({ file, args }); return { stdout: JSON.stringify(current) }; } });
  await assert.rejects(service.open('hk:123'), /重新搜索/);
  assert.equal((await service.search('ただ君に晴れ'))[0].id, 'hk:123');
  assert.equal((await service.open('hk:123')).verified, false);
  current = { ...current, track: { title: row.trackName, artist: row.artistName, duration: 200 } };
  assert.equal((await service.open('hk:123')).verified, true);
  current.state = 'paused'; assert.equal((await service.open('hk:123')).verified, false);
  assert.equal(calls.find(c => c.file === '/usr/bin/open').args[0], '-g');
});
test('translated artist names can match by title and duration, but a wrong title never matches', () => {
  assert.equal(matchesAppleTrack({ title: row.trackName, artist: 'ヨルシカ', duration: 200 }, { title: row.trackName, artist: 'Yorushika', duration: 200.5 }), true);
  assert.equal(matchesAppleTrack({ title: row.trackName, artist: 'Yorushika', duration: 200 }, { title: 'Wrong', artist: 'Yorushika', duration: 200 }), false);
});

test('a library start that initially reports paused is verified after the real player catches up', async () => {
  const actions = [], track = { title: row.trackName, artist: row.artistName, duration: 200 };
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    automationImpl: async () => { throw new Error('must not open a catalog page'); },
    execImpl: async (_file, args) => {
      const action = args.at(-2); actions.push(action);
      return { stdout: JSON.stringify({ running: true, state: action === 'play-track' ? 'paused' : 'playing', track }) };
    },
  });
  await service.search('Song');
  assert.equal((await service.play('hk:123')).verified, true);
  assert.deepEqual(actions, ['play-track', 'state']);
});

test('a sent command with no matching playback ends in a retryable failure instead of indefinite waiting', async () => {
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }), automationImpl: async () => ({ requested: true }),
    execImpl: async (_file, args) => ({ stdout: JSON.stringify({ running: true, state: 'paused', needsClient: args.at(-2) === 'play-track',
      track: { title: 'Other', artist: 'Other', duration: 100 } }) }),
  });
  await service.search('Song'); const result = await service.play('hk:123');
  assert.equal(result.verified, false); assert.equal(result.needsClient, true); assert.match(result.message, /重试/u);
});

test('queue inspection cannot open or close menus during a catalog start', async () => {
  const actions = []; let finishQueue;
  const track = { title: row.trackName, artist: row.artistName, duration: 200 };
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    automationImpl: action => { actions.push(action); return action === 'queue'
      ? new Promise(resolve => { finishQueue = resolve; }) : { requested: true }; },
    execImpl: async (_file, args) => ({ stdout: JSON.stringify({ running: true, state: 'playing', track,
      needsClient: args.at(-2) === 'play-track' }) }),
  });
  await service.search('Song');
  const reading = service.session('hk:123', true, true);
  await new Promise(resolve => setImmediate(resolve));
  const playing = service.play('hk:123');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, ['queue']);
  finishQueue({ available: true, rows: [] });
  await reading; assert.equal((await playing).verified, true);
  assert.deepEqual(actions, ['queue', 'play']);
});
test('commands and search inputs are bounded, and command data is passed without a shell', async () => {
  const calls = [];
  const service = createAppleMusicMac({ platform: 'darwin', execImpl: async (...args) => { calls.push(args); return { stdout: '{}' }; } });
  assert.throws(() => service.control('delete'), /无效/);
  assert.throws(() => service.control('seek', NaN), /无效/);
  await assert.rejects(service.search('x', 'invalid'), /地区/);
  await service.control('seek', 20); assert.equal(calls[0][1].at(-1), '{"position":20}');
  assert.equal(calls[0][2].shell, undefined);
});

test('a diary pause/seek never controls an unrelated song playing in Music', async () => {
  const calls = [];
  const service = createAppleMusicMac({ platform: 'darwin', fetchImpl: async () => Response.json({ results: [row] }),
    execImpl: async (_file, args) => { calls.push(args); return { stdout: JSON.stringify({ state: 'playing', track: { title: 'Unrelated', artist: 'Someone', duration: 200 } }) }; } });
  await service.search('ただ君に晴れ');
  await assert.rejects(service.control('pause', undefined, 'hk:123'), /当前不是这首歌/);
  assert.equal(calls.length, 1); assert.equal(calls[0].at(-2), 'state');
  assert.equal((await service.state('hk:123')).matched, false);
});

test('without accessibility permission, background play returns an actionable reason without opening Music windows', async () => {
  const calls = []; let state = { running: true, state: 'paused', needsClient: true };
  const service = createAppleMusicMac({ platform: 'darwin', automationImpl: async () => ({ needsAccessibility: true }), fetchImpl: async () => Response.json({ results: [row] }),
    execImpl: async (file, args) => { calls.push({ file, args }); return { stdout: JSON.stringify(state) }; } });
  await service.search('ただ君に晴れ');
  const unavailable = await service.play('hk:123', 0);
  assert.equal(unavailable.verified, false); assert.equal(unavailable.needsAccessibility, true);
  state = { running: true, state: 'playing', track: { title: row.trackName, artist: row.artistName, duration: 200 } };
  assert.equal((await service.play('hk:123', 30)).verified, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.file === '/usr/bin/osascript' && c.args.at(-2) === 'play-track'));
});

test('repeated opens for the same song share one pending native request', async () => {
  let finish; let opened = 0;
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    execImpl: async file => { if (file === '/usr/bin/open') { opened++; await new Promise(resolve => { finish = resolve; }); }
      return { stdout: JSON.stringify({ state: 'playing', track: { title: row.trackName, artist: row.artistName, duration: 200 } }) }; } });
  await service.search('ただ君に晴れ');
  const first = service.open('hk:123'), second = service.open('hk:123');
  assert.equal(first, second); await Promise.resolve(); finish();
  assert.equal((await first).verified, true); assert.equal(opened, 1);
});

test('client automation is followed by real player verification, never accepted as playback proof by itself', async () => {
  let requested = 0, correct = false;
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    automationImpl: async (action, track) => { requested++; assert.equal(action, 'play'); assert.equal(track.title, row.trackName); return { requested: true }; },
    execImpl: async (_file, args) => ({ stdout: JSON.stringify(args.at(-2) === 'play-track'
      ? { running: true, state: 'paused', needsClient: true }
      : { running: true, state: 'playing', track: { title: correct ? row.trackName : 'Wrong song', artist: row.artistName, duration: 200 } }) }),
  });
  await service.search('ただ君に晴れ');
  assert.equal((await service.play('hk:123')).verified, false);
  correct = true; assert.equal((await service.play('hk:123')).verified, true);
  assert.equal(requested, 2);
});

test('verified playback can follow the real current song and hydrate only official queue entries', async () => {
  const actions = [];
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }),
    automationImpl: async action => action === 'queue' ? { available: true, rows: [
      { label: `${row.trackName} ${row.artistName} — Album`, section: 'autoplay' },
      { label: 'Unknown Song Unknown Artist — Album', section: 'autoplay' },
    ] } : { requested: true },
    execImpl: async (_file, args) => { const action = args.at(-2); actions.push(action); return { stdout: JSON.stringify(action === 'play-track'
      ? { running: true, state: 'paused', needsClient: true }
      : { running: true, state: 'playing', track: { title: row.trackName, artist: row.artistName, duration: 200 } }) }; },
  });
  await service.search('ただ君に晴れ');
  assert.equal((await service.play('hk:123')).verified, true);
  assert.deepEqual(actions, ['play-track', 'state']);
  const session = await service.session('hk:123', true, true);
  assert.equal(session.current.id, 'hk:123');
  assert.equal(session.queue.tracks.length, 1);
  assert.equal(session.queue.tracks[0].queueSection, 'autoplay');
  assert.equal(session.queue.unresolved, 1);
  assert.equal((await service.session('hk:missing', false)).current, null);
});
