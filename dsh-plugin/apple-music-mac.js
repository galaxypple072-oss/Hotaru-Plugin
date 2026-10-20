import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stat, mkdir, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./apple-music-mac.jxa', import.meta.url));
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function artworkUrl(value, size) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.mzstatic.com') || url.username || url.password || url.port) return null;
    if (size) url.pathname = url.pathname.replace(/\/\d+x\d+bb\.(jpg|png)$/u, `/${size}x${size}bb.$1`);
    return url.href;
  } catch { return null; }
}

export function matchesAppleTrack(expected, actual) {
  if (expected?.persistentId && actual?.persistentId) return expected.persistentId === actual.persistentId;
  if (!actual || normalize(expected.title) !== normalize(actual.title)) return false;
  return normalize(expected.artist) === normalize(actual.artist)
    || Number.isFinite(expected.duration) && Number.isFinite(actual.duration)
      && Math.abs(expected.duration - actual.duration) < 3;
}

export function applePlaybackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com'
      || url.username || url.password || url.port || !/^\/[a-z]{2}\/(album|song)\//u.test(url.pathname)) {
    throw new Error('只接受 Apple Music 的歌曲链接');
  }
  url.searchParams.delete('uo');
  url.searchParams.set('play', '1');
  // WHATWG URL does not allow changing a special scheme to a custom scheme in place.
  return url.href.replace(/^https:/u, 'music:');
}

export function createAppleMusicMac({ fetchImpl = fetch, execImpl = execute, platform = process.platform,
  automationImpl, artworkRoot,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const results = new Map();
  const libraryTracks = new Map(), artworkLoading = new Map();
  let playlistIndex = null;
  const lookup = id => libraryTracks.get(id) || results.get(id);
  const favoritesName = name => ['心水歌曲', '喜愛的歌曲', '喜爱的歌曲', '最愛的歌曲', 'Favorite Songs', 'Favorites', 'お気に入りの曲'].includes(name);
  const opening = new Map();
  const recommendations = new Map(), recommending = new Map();
  const resolvedQueue = new Map();
  let queueSnapshot = null, queueLoading = null;
  let queue = Promise.resolve();
  let uiQueue = Promise.resolve();
  let building = null;
  function automate(action, track) {
    const work = uiQueue.then(() => runAutomation(action, track));
    uiQueue = work.catch(() => {});
    return work;
  }
  async function runAutomation(action, track) {
    if (automationImpl) return automationImpl(action, track);
    if (platform !== 'darwin') return { available: false, error: 'mac-required' };
    const source = fileURLToPath(new URL('./native/apple-music-ui.swift', import.meta.url));
    const binary = fileURLToPath(new URL('./native/apple-music-ui', import.meta.url));
    const info = await stat(source), built = await stat(binary).catch(() => null);
    if (!built || built.mtimeMs < info.mtimeMs) {
      if (!building) building = execImpl('/usr/bin/xcrun', ['swiftc', source, '-o', binary], { timeout: 45000, maxBuffer: 128 * 1024 })
        .finally(() => { building = null; });
      await building;
    }
    const { stdout } = await execImpl(binary, [action, JSON.stringify(track || {})], { timeout: 25000, maxBuffer: 128 * 1024 })
      .catch(() => { throw new Error('音乐客户端响应超时，请稍后重试；没有自动弹出窗口。'); });
    return JSON.parse(stdout.trim());
  }
  function remember(tracks) {
    for (const track of tracks) { applePlaybackUrl(track.url); results.delete(track.id); results.set(track.id, track); }
    while (results.size > 200) results.delete(results.keys().next().value);
    return tracks;
  }
  async function native(action, input = {}) {
    if (platform !== 'darwin') throw new Error('此桥接需要 Mac 的“音乐”应用');
    const { stdout } = await execImpl('/usr/bin/osascript', ['-l', 'JavaScript', script, action, JSON.stringify(input)],
      { timeout: action === 'playlist-tracks' ? 30000 : 10000, maxBuffer: action === 'playlist-tracks' ? 16 * 1024 * 1024 : 128 * 1024 }).catch(() => { throw new Error('暂时无法读取音乐播放器，请稍后重试。'); });
    return JSON.parse(stdout.trim());
  }
  function serial(task) {
    const next = queue.then(task); queue = next.catch(() => {}); return next;
  }
  async function resolveLabel(label, country) {
    const key = `${country}:${label}`;
    if (resolvedQueue.has(key)) return resolvedQueue.get(key);
    const head = label.split(' — ')[0];
    let tracks = [...results.values()].filter(t => normalize(`${t.title} ${t.artist}`) === normalize(head));
    if (!tracks.length) tracks = await service.search(head.slice(0, 160), country).catch(() => []);
    const matching = tracks.filter(t => normalize(`${t.title} ${t.artist}`) === normalize(head));
    const track = matching.find(t => normalize(t.album) === normalize(label.split(' — ').slice(1).join(' — '))) || matching[0];
    if (track) resolvedQueue.set(key, track);
    return track || null;
  }
  async function officialQueue(country, identity) {
    if (queueSnapshot?.identity === identity && Date.now() - queueSnapshot.time < 15000) return queueSnapshot.value;
    if (queueLoading) return queueLoading;
    queueLoading = (async () => {
      const snapshot = await automate('queue');
      const rows = snapshot.rows || [], tracks = [];
      // Bound catalog requests; preserve Music's actual queue order.
      for (let i = 0; i < Math.min(rows.length, 12); i += 3) {
        const batch = await Promise.all(rows.slice(i, i + 3).map(async row => {
          const track = await resolveLabel(row.label, country);
          return track ? { ...track, queueSection: row.section } : null;
        }));
        tracks.push(...batch.filter(Boolean));
      }
      const value = { available: Boolean(snapshot.available), tracks, unresolved: rows.length - tracks.length };
      queueSnapshot = { identity, time: Date.now(), value };
      return value;
    })().finally(() => { queueLoading = null; });
    return queueLoading;
  }
  const service = {
    diagnostics: () => automate('status'),
    registerTracks: tracks => remember(tracks),
    async playlists(refresh = false) {
      if (!refresh && playlistIndex && Date.now() - playlistIndex.time < 60000) return playlistIndex.value;
      const response = await native('playlists');
      if (!Array.isArray(response.playlists)) throw new Error('请先启动 Mac 的音乐应用并登录曲库。');
      const playlists = response.playlists.filter(p => p.kind === 'none').map(p => ({ ...p,
        favorites: favoritesName(p.name), writable: !p.smart || favoritesName(p.name) }));
      const value = { playlists, defaultId: playlists.find(p => p.favorites)?.id || playlists[0]?.id || null };
      playlistIndex = { time: Date.now(), value }; return value;
    },
    async playlistTracks(id) {
      const index = await service.playlists();
      if (!index.playlists.some(p => p.id === id)) throw new Error('歌单不存在，请刷新歌单列表。');
      const data = await native('playlist-tracks', { playlistId: id, limit: 100000 });
      if (!Array.isArray(data.tracks)) throw new Error('暂时无法读取歌单。');
      const tracks = data.tracks.map(t => ({ ...t, id: `library:${id}:${t.persistentId}`, playlistId: id, source: 'library', artworkUrl: null }));
      for (const [key, t] of libraryTracks) if (t.playlistId === id) libraryTracks.delete(key);
      for (const t of tracks) libraryTracks.set(t.id, t);
      return { ...data, tracks };
    },
    async artwork(id) {
      const track = lookup(id); if (!track) throw new Error('请先加载歌单。');
      if (track.artworkUrl) return { id, artworkUrl: track.artworkUrl };
      if (!track.playlistId || !artworkRoot) return { id, artworkUrl: null };
      if (artworkLoading.has(id)) return artworkLoading.get(id);
      const work = (async () => {
        await mkdir(artworkRoot, { recursive: true, mode: 0o700 });
        const name = createHash('sha256').update(track.persistentId).digest('hex');
        const target = join(artworkRoot, name + '.jpg'), raw = join(artworkRoot, name + '.raw');
        try {
          if (!(await stat(target).catch(() => null))) {
            await execImpl('/usr/bin/osascript', [fileURLToPath(new URL('./apple-music-artwork.applescript', import.meta.url)), track.playlistId, track.persistentId, raw], { timeout: 12000 });
            await execImpl('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '360', raw, '--out', target], { timeout: 10000 });
          }
          const bytes = await readFile(target);
          if (bytes.length > 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid artwork');
          return { id, artworkUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
        } catch { return { id, artworkUrl: null }; }
        finally { await unlink(raw).catch(() => {}); }
      })().finally(() => artworkLoading.delete(id));
      artworkLoading.set(id, work); return work;
    },
    async suggest(picks) {
      if (!Array.isArray(picks) || !picks.length || picks.length > 6) throw new Error('请提供1到6首推荐歌曲。');
      const groups = await Promise.allSettled(picks.map(async pick => {
        if (typeof pick.title !== 'string' || typeof pick.artist !== 'string' || !pick.title.trim() || !pick.artist.trim()) return null;
        const query = `${pick.title} ${pick.artist}`.slice(0, 160);
        const matches = t => normalize(t.title) === normalize(pick.title)
          && (normalize(t.artist).includes(normalize(pick.artist)) || normalize(pick.artist).includes(normalize(t.artist)));
        const tracks = await service.search(query);
        let track = tracks.find(matches);
        if (!track) {
          // Japanese names are often localized in the HK storefront. Confirm
          // both original names in Japan, then prefer the same HK catalog ID.
          const japanese = (await service.search(query, 'jp')).find(matches);
          if (japanese) track = tracks.find(t => t.id.split(':')[1] === japanese.id.split(':')[1]) || japanese;
        }
        return track ? { ...track, recommendationReason: String(pick.reason || '').slice(0, 200) } : null;
      }));
      const tracks = [...new Map(groups.filter(g => g.status === 'fulfilled' && g.value).map(g => [g.value.id, g.value])).values()];
      if (!tracks.length) throw new Error('暂未在曲库匹配到：' + picks.map(p => `${String(p.title || '').slice(0, 100)}（${String(p.artist || '').slice(0, 100)}）`).join('、') + '。请换一个方向试试。');
      return { tracks };
    },
    addToPlaylist(trackId, playlistId) {
      return serial(async () => {
        const index = await service.playlists(true), destination = index.playlists.find(p => p.id === playlistId);
        const track = lookup(trackId);
        if (!destination?.writable || !track) throw new Error('请选择可写的歌单和有效歌曲。');
        const contains = async () => (await service.playlistTracks(playlistId)).tracks.find(t => matchesAppleTrack(track, t)
          && (!track.album || normalize(track.album) === normalize(t.album)));
        let existing = await contains();
        if (existing) return { added: true, alreadyPresent: true, playlist: destination, track: existing };
        const input = { ...track, playlistId, favorites: destination.favorites, playlistName: destination.name };
        const result = await native('playlist-add-native', input);
        if (result.needsCatalog) {
          if (index.playlists.filter(p => p.name === destination.name).length !== 1) throw new Error('目标歌单同名，暂时无法准确选择，请先重命名。');
          const ui = await automate('add', { ...input, url: applePlaybackUrl(track.url) });
          if (!ui.requested) throw new Error(`未能加入歌单（${ui.error || '需要辅助功能权限'}）。`);
        }
        for (let i = 0; i < 10; i++) {
          await wait(800); existing = await contains();
          if (existing) return { added: true, playlist: destination, track: existing };
        }
        throw new Error('Apple Music 尚未确认加入，拼图未更新；稍后刷新或重试，不会重复添加。');
      });
    },
    async search(query, country = 'hk') {
      if (typeof query !== 'string' || !query.trim() || query.length > 160) throw new Error('请输入 160 字以内的歌名或歌手');
      if (!['hk', 'cn', 'tw', 'jp', 'us'].includes(country)) throw new Error('不支持的曲库地区');
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({ term: query.trim(), country, media: 'music', entity: 'song', limit: '12' });
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`歌曲搜索失败：HTTP ${response.status}`);
      const tracks = (await response.json()).results.filter(row => row.kind === 'song' && row.trackId && row.trackViewUrl)
        .map(row => ({ id: `${country}:${row.trackId}`, title: row.trackName, artist: row.artistName,
          artworkUrl: artworkUrl(row.artworkUrl100 || row.artworkUrl60, 600),
          artworkThumbnailUrl: artworkUrl(row.artworkUrl100 || row.artworkUrl60),
          album: row.collectionName || '', duration: row.trackTimeMillis / 1000, url: row.trackViewUrl }));
      // Only server-returned results may be opened. Never accept an arbitrary client URL.
      return remember(tracks);
    },
    async recommend(country = 'hk') {
      if (!['hk', 'cn', 'tw', 'jp', 'us'].includes(country)) throw new Error('不支持的曲库地区');
      const cached = recommendations.get(country);
      if (cached && Date.now() - cached.createdAt < 3600000) return { ...cached.value, tracks: remember(cached.value.tracks) };
      if (recommending.has(country)) return recommending.get(country);
      const work = (async () => {
        // Editorial starting points from the user's Japanese/ACG interests.
        // No account history or claim of Apple's personal recommendations.
        const artists = [
          { query: 'Yorushika', names: ['Yorushika', 'ヨルシカ'] },
          { query: 'Afterglow BanG Dream', names: ['Afterglow'] },
          { query: 'Aimer', names: ['Aimer'] },
          { query: 'YOASOBI', names: ['YOASOBI'] },
        ];
        const batches = await Promise.allSettled(artists.map(async artist => {
          const tracks = await service.search(artist.query, country);
          return tracks.filter(track => artist.names.some(name => normalize(track.artist) === normalize(name)))
            .slice(0, 4).map(track => ({ ...track, recommendationReason: `日語／ACG 選曲 · ${artist.names[0]} 的作品` }));
        }));
        const groups = batches.filter(batch => batch.status === 'fulfilled').map(batch => batch.value);
        const tracks = [], seen = new Set();
        for (let i = 0; i < 4; i++) for (const group of groups) {
          const track = group[i];
          if (track && !seen.has(track.id)) { seen.add(track.id); tracks.push(track); }
        }
        if (!tracks.length) throw new Error('推荐曲暂时加载失败，可以直接搜索歌名，或稍后重试');
        const value = { tracks: remember(tracks), basis: '依你提過的日語／ACG方向，按歌手分散挑選；非 Apple 官方個人推薦。',
          mode: 'recommendations', partial: batches.some(batch => batch.status === 'rejected') };
        recommendations.set(country, { createdAt: Date.now(), value });
        return value;
      })();
      recommending.set(country, work);
      try { return await work; } finally { recommending.delete(country); }
    },
    async state(id) {
      const state = await native('state');
      return id ? { ...state, matched: Boolean(lookup(id) && matchesAppleTrack(lookup(id), state.track)) } : state;
    },
    async session(id, follow = false, withQueue = false) {
      const state = await native('state'), expected = lookup(id);
      const matched = Boolean(expected && matchesAppleTrack(expected, state.track));
      if (!matched && !follow) return { ...state, matched, current: null };
      if (expected?.playlistId) return { ...state, matched, current: matched ? expected :
        [...libraryTracks.values()].find(t => t.playlistId === expected.playlistId && matchesAppleTrack(t, state.track)) || null };
      const country = id?.split(':')[0] || 'hk';
      const current = matched ? expected : state.track
        ? await resolveLabel(`${state.track.title} ${state.track.artist} — ${state.track.album}`, country) : null;
      if (current) remember([current]);
      return { ...state, matched, current, queue: withQueue && current
        ? await officialQueue(country, `${state.track.title}:${state.track.artist}`).catch(() => ({ available: false, tracks: [] }))
        : undefined };
    },
    control(action, position, id) {
      if (!['play', 'pause', 'next', 'previous', 'seek'].includes(action)) throw new Error('播放操作无效');
      if (action === 'seek' && (!Number.isFinite(position) || position < 0 || position > 86400)) throw new Error('播放位置无效');
      return serial(async () => {
        if (id) {
          const state = await native('state');
          if (!lookup(id) || !matchesAppleTrack(lookup(id), state.track)) {
            throw new Error('官方播放器当前不是这首歌，请先在“音乐”中播放所选歌曲');
          }
        }
        return native(action, { position });
      });
    },
    play(id, position = 0) {
      if (!Number.isFinite(position) || position < 0 || position > 86400) throw new Error('播放位置无效');
      return serial(async () => {
        const track = lookup(id);
        if (!track) throw new Error('请重新搜索后选择歌曲');
        async function restrictPlaylist() {
          if (!track.playlistId) return;
          // AutoMix can begin an Infinity recommendation before the track ends,
          // bypassing Music's once parameter. Disable and verify both first.
          const restricted = await automate('restrict-playlist', {});
          if (!restricted.requested) throw new Error('未能关闭 Apple Music 自动连播，暂未开始播放：' + (restricted.error || '需要辅助功能权限'));
        }
        await restrictPlaylist();
        async function verifiedPlayback(state) {
          // AutoMix is absent while stopped on some Music versions. It can
          // appear only after starting, so enforce the same policy again.
          try { await restrictPlaylist(); }
          catch (error) {
            await native('pause');
            throw new Error('播放已暂停，未能确认歌单播放范围：' + error.message);
          }
          return { ...state, verified: true };
        }
        let state = await native('play-track', { title: track.title, artist: track.artist, duration: track.duration, position,
          persistentId: track.persistentId, playlistId: track.playlistId });
        if (state.needsClient || !state.running) {
          if (track.playlistId) return { ...state, verified: false, needsClient: true, message: '这首歌暂时无法播放，请刷新歌单后重试。' };
          const result = await automate('play', { ...track, url: applePlaybackUrl(track.url) });
          if (result.needsAccessibility) return { ...state, verified: false, needsClient: true, needsAccessibility: true,
            message: '播放新的在线歌曲需要允许 DeepSeek Harness 使用 macOS「辅助功能」操作音乐客户端；目前未授权，因此没有打开窗口或发送播放操作。' };
          if (!result.requested) return { ...state, verified: false, needsClient: true,
            message: `官方客户端播放桥接未完成（${result.error || 'unavailable'}）；没有把打开页面当作播放成功。` };
        }
        // Library/current-track starts are asynchronous too. Verify all paths;
        // a sent command must never leave the interface waiting indefinitely.
        for (let attempt = 0; attempt < 8; attempt++) {
          if (state.state === 'playing' && matchesAppleTrack(track, state.track)) return verifiedPlayback(state);
          await wait(700); state = await native('state');
        }
        const verified = state.state === 'playing' && matchesAppleTrack(track, state.track);
        if (verified) return verifiedPlayback(state);
        return { ...state, verified, needsClient: !verified,
          message: verified ? undefined : '未能确认这首歌开播，请重试。当前歌曲或资料库歌曲可后台播放；不会自动弹出官方窗口。' };
      });
    },
    open(id, { foreground = false } = {}) {
      if (opening.has(id)) return opening.get(id);
      const work = serial(async () => {
        const track = lookup(id);
        if (!track) throw new Error('请重新搜索后选择歌曲');
        if (!track.url) throw new Error('歌单歌曲直接使用播放键即可。');
        if (platform !== 'darwin') throw new Error('此桥接需要 Mac 的“音乐”应用');
        await execImpl('/usr/bin/open', [...(foreground ? [] : ['-g']), applePlaybackUrl(track.url)], { timeout: 10000 });
        let state;
        for (let attempt = 0; attempt < 8; attempt++) {
          await wait(1000); state = await native('state');
          if (state.state === 'playing' && matchesAppleTrack(track, state.track)) return { verified: true, expected: track, ...state };
        }
        return { verified: false, expected: track, ...state,
          message: '已打开歌曲链接，但尚未确认目标歌曲正在播放；请在“音乐”里点播放。' };
      });
      opening.set(id, work);
      void work.finally(() => { if (opening.get(id) === work) opening.delete(id); }).catch(() => {});
      return work;
    },
  };
  return service;
}
