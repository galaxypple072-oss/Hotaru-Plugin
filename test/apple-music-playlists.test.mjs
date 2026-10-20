import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppleMusicMac } from '../dsh-plugin/apple-music-mac.js';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('native playlist starts use Music once mode instead of inheriting its unrelated autoplay queue', async () => {
  const source = await readFile(new URL('../dsh-plugin/apple-music-mac.jxa', import.meta.url), 'utf8');
  const calls = [], track = { name: () => 'Song', artist: () => 'Artist', album: () => 'Album', duration: () => 200, persistentID: () => 'native' };
  const music = { running: () => true, userPlaylists: { whose: () => () => [{ tracks: { whose: () => () => [track] } }] },
    play: (...args) => calls.push(args), currentTrack: () => track, playerState: () => 'playing', playerPosition: () => 0 };
  const run = runInNewContext(`${source};run`, { Application: () => music });
  run(['play-track', JSON.stringify({ playlistId: 'favorites', persistentId: 'native', title: 'Song', artist: 'Artist', duration: 200, position: 0 })]);
  assert.equal(calls[0][0], track); assert.equal(calls[0][1].once, true);
});

const playlists = [
  { id: 'music', name: '音乐', kind: 'Music', smart: true },
  { id: 'favorites', name: '心水歌曲', kind: 'none', smart: true },
  { id: 'regular', name: '散步', kind: 'none', smart: false },
  { id: 'smart', name: '最近播放', kind: 'none', smart: true },
];
const row = { kind: 'song', trackId: 123, trackName: 'Song', artistName: 'Artist', trackTimeMillis: 200000,
  collectionName: 'Album', trackViewUrl: 'https://music.apple.com/hk/album/album/1?i=123' };
const entry = { persistentId: 'native-123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200 };

test('all playlist tracks remain playable beyond the search cache limit and use native playlist identities', async () => {
  const calls = [], rows = Array.from({ length: 350 }, (_, i) => ({ ...entry, persistentId: String(i), title: 'Song ' + i }));
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    automationImpl: action => { assert.equal(action, 'restrict-playlist'); return { requested: true }; },
    execImpl: async (_file, args) => {
      const action = args.at(-2), input = JSON.parse(args.at(-1)); calls.push({ action, input });
      return { stdout: JSON.stringify(action === 'playlists' ? { playlists } : action === 'playlist-tracks'
        ? { playlist: playlists[1], tracks: rows, total: rows.length } : { running: true, state: 'playing', track: rows[0] }) };
    },
  });
  const index = await service.playlists(); assert.equal(index.defaultId, 'favorites');
  assert.equal(index.playlists.some(p => p.id === 'music'), false);
  assert.equal(index.playlists.find(p => p.id === 'favorites').writable, true);
  assert.equal(index.playlists.find(p => p.id === 'smart').writable, false);
  const list = await service.playlistTracks('favorites'); assert.equal(list.tracks.length, 350);
  assert.equal((await service.play(list.tracks[0].id)).verified, true);
  const play = calls.find(c => c.action === 'play-track');
  assert.equal(play.input.playlistId, 'favorites'); assert.equal(play.input.persistentId, '0');
  await assert.rejects(service.playlistTracks('missing'), /不存在/u);
});

test('playlist play fails closed when native autoplay restrictions cannot be verified', async () => {
  let starts = 0;
  const service = createAppleMusicMac({ platform: 'darwin', automationImpl: async () => ({ requested: false, error: 'autoplay-control-unavailable' }),
    execImpl: async (_file, args) => {
      if (args.at(-2) === 'play-track') starts++;
      return { stdout: JSON.stringify(args.at(-2) === 'playlists' ? { playlists }
        : { playlist: playlists[1], tracks: [entry], total: 1 }) };
    },
  });
  const list = await service.playlistTracks('favorites');
  await assert.rejects(service.play(list.tracks[0].id), /未能关闭/u);
  assert.equal(starts, 0);
});

test('a hidden AutoMix control permits start, then restrictions are rechecked when playback exposes it', async () => {
  for (const secondCheckFails of [false, true]) {
    let checks = 0; const actions = [];
    const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
      automationImpl: async action => {
        assert.equal(action, 'restrict-playlist'); checks++;
        if (checks === 1) return { requested: true, autoplay: false, mixingAvailable: false, mixing: null };
        return { requested: !secondCheckFails, autoplay: false, mixingAvailable: true, mixing: false };
      },
      execImpl: async (_file, args) => {
        const action = args.at(-2); actions.push(action);
        return { stdout: JSON.stringify(action === 'playlists' ? { playlists }
          : action === 'playlist-tracks' ? { playlist: playlists[1], tracks: [entry] }
          : { running: true, state: 'playing', track: entry }) };
      },
    });
    const list = await service.playlistTracks('favorites');
    if (secondCheckFails) {
      await assert.rejects(service.play(list.tracks[0].id), /播放已暂停/u);
      assert.equal(actions.at(-1), 'pause');
    } else assert.equal((await service.play(list.tracks[0].id)).verified, true);
    assert.equal(checks, 2); assert.equal(actions.includes('play-track'), true);
  }
});

test('recommendations never mutate playlists; explicit add verifies membership and subsequent adds are idempotent', async () => {
  let items = [], writes = 0;
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row, { ...row, trackId: 999, trackName: 'Unrelated' }] }),
    automationImpl: () => { throw new Error('native library track should not need UI'); },
    execImpl: async (_file, args) => {
      const action = args.at(-2);
      if (action === 'playlist-add-native') { writes++; items = [entry]; }
      return { stdout: JSON.stringify(action === 'playlists' ? { playlists } : action === 'playlist-tracks'
        ? { playlist: playlists[1], tracks: items, total: items.length } : { requested: true }) };
    },
  });
  const suggested = await service.suggest([{ title: 'Song', artist: 'Artist', reason: '适合散步' }]);
  assert.equal(suggested.tracks.length, 1); assert.equal(writes, 0);
  assert.equal((await service.addToPlaylist('hk:123', 'favorites')).added, true); assert.equal(writes, 1);
  assert.equal((await service.addToPlaylist('hk:123', 'favorites')).alreadyPresent, true); assert.equal(writes, 1);
  await assert.rejects(service.addToPlaylist('hk:123', 'smart'), /可写/u);
  assert.equal(writes, 1);
});

test('an unconfirmed catalog addition is not reported as added', async () => {
  const service = createAppleMusicMac({ platform: 'darwin', wait: async () => {},
    fetchImpl: async () => Response.json({ results: [row] }), automationImpl: async () => ({ requested: true }),
    execImpl: async (_file, args) => ({ stdout: JSON.stringify(args.at(-2) === 'playlists' ? { playlists }
      : args.at(-2) === 'playlist-tracks' ? { playlist: playlists[1], tracks: [], total: 0 } : { needsCatalog: true }) }),
  });
  await service.search('Song');
  await assert.rejects(service.addToPlaylist('hk:123', 'regular'), /尚未确认/u);
});

test('Japanese originals verify localized HK artist names by catalog ID and tolerate another failed search', async () => {
  const service = createAppleMusicMac({ fetchImpl: async url => {
    if (url.searchParams.get('term').includes('Offline')) throw new Error('network unavailable');
    return Response.json({ results: [{ ...row, trackName: '藍二乗', artistName: url.searchParams.get('country') === 'jp' ? 'ヨルシカ' : 'Yorushika' }] });
  } });
  const result = await service.suggest([{ title: '藍二乗', artist: 'ヨルシカ' }, { title: 'Offline', artist: 'Other' }]);
  assert.equal(result.tracks.length, 1); assert.equal(result.tracks[0].id, 'hk:123');
  assert.equal(result.tracks[0].artist, 'Yorushika');
});
