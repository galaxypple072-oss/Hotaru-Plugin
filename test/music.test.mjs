import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMusicStore, musicMemory, publicSong } from '../dsh-plugin/music-store.js';
import { createMusicDiary } from '../dsh-plugin/music-diary.js';
import { openCompanionStore } from '../dsh-plugin/companion-store.js';
import { apply as applyModel } from '../dsh-plugin/model.js';
import { handleRemoteControlRequest } from '../dsh-plugin/remote-api.js';

const source = { sessionId: 'hotaru-chat', userTurnId: 'u1', conversation: [{ role: 'user', text: '今天考试很累，想安静休息。' }], reply: '辛苦了，先歇一会儿吧。' };
const plan = async () => ({ title: '放学后的片刻', reason: '听到你说今天考试很累，我想用轻柔的旋律陪你休息。', mood: '轻柔、舒缓', prompt: 'Gentle lyrical solo piano with delicate arpeggios, 72 BPM.' });
const wav = Buffer.alloc(100); wav.write('RIFF'); wav.write('WAVE', 8);

async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hotaru-music-'));
  const store = openMusicStore(join(root, 'music.sqlite'));
  let renders = 0;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/health') return Response.json({ ready: true });
    if (path === '/v1/jobs') { renders++; const input = JSON.parse(init.body); assert.match(input.prompt, /Solo acoustic grand piano/u); return Response.json({ id: 'job-1' }); }
    if (path.endsWith('/audio')) return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
    if (init.method === 'DELETE') return Response.json({ ok: true });
    return Response.json({ status: 'completed', inferenceMs: 800 });
  };
  const service = createMusicDiary(store, {}, {}, { root: join(root, 'audio'), fetchImpl, plan, ...options });
  try { await run({ root, store, service, renders: () => renders }); }
  finally { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); }
}

async function request(service, path, method = 'GET', body) {
  let status, headers, data;
  const req = { url: path, method, async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); } };
  const res = { writeHead(code, h) { status = code; headers = h; }, end(value) { data = value; } };
  assert.equal(await service.handle(req, res), true);
  return { status, headers, data, body: headers?.['Content-Type'] === 'audio/wav' ? null : JSON.parse(data) };
}

test('music diary deduplicates a conversation turn and remembers actual feedback across reopen', async () => {
  await fixture(async ({ root, store, service, renders }) => {
    store.saveExchange(source.sessionId, source.userTurnId, source.conversation, source.reply);
    assert.equal(store.source(source.sessionId, '辛苦了，先歇一会儿吧。').userTurnId, 'u1');
    assert.equal(store.source('another-chat', source.reply), null);
    const a = service.start(source), b = service.start(source);
    assert.equal(a.id, b.id);
    await service.settled();
    assert.equal(renders(), 1);
    const song = store.get(a.id);
    assert.equal(song.status, 'completed'); assert.equal(song.audioAvailable, true);
    assert.equal(publicSong(song).source, undefined);
    assert.equal(publicSong(song).prompt, undefined);
    await request(service, `/companion/music/${a.id}/played`, 'POST');
    await request(service, `/companion/music/${a.id}`, 'PUT', { liked: true });
    const reopened = openMusicStore(join(root, 'music.sqlite'));
    try {
      const memory = musicMemory(reopened, '还记得你之前弹的那首曲子吗？', 'new-chat');
      assert.match(memory, /放学后的片刻/u); assert.match(memory, /"userLiked":true/u); assert.match(memory, /"userPlayed":true/u);
      assert.equal(musicMemory(reopened, '帮我看看这段代码', 'new-chat'), '');
    } finally { reopened.close(); }
  });
});

test('unfinished, failed and forgotten music is never recalled as a completed memory', async () => {
  const store = openMusicStore(':memory:');
  try {
    const song = store.create(source);
    assert.equal(musicMemory(store, '钢琴曲', source.sessionId), '');
    store.update(song.id, { status: 'failed' }); assert.equal(musicMemory(store, '钢琴曲', source.sessionId), '');
    store.update(song.id, { status: 'forgotten' }); assert.equal(musicMemory(store, '钢琴曲', source.sessionId), '');
  } finally { store.close(); }
});

test('Apple Music routes use the provider and never fall through to diary UUID lookup', async () => {
  const calls = [];
  const track = { id: 'hk:123', title: 'Real song', artworkUrl: 'https://is1-ssl.mzstatic.com/cover.jpg' };
  await fixture(async ({ service }) => {
    const search = await request(service, '/companion/music/apple/search', 'POST', { query: 'song', country: 'hk' });
    assert.equal(search.status, 200); assert.equal(search.body.tracks[0].id, track.id);
    const recommended = await request(service, '/companion/music/apple/recommend', 'POST', { country: 'jp' });
    assert.equal(recommended.status, 200); assert.equal(recommended.body.tracks[0].id, track.id);
    assert.equal((await request(service, '/companion/music/apple/state?id=hk%3A123')).body.matched, true);
    assert.equal((await request(service, '/companion/music/apple/open', 'POST', { id: track.id })).body.verified, false);
    assert.equal((await request(service, '/companion/music/apple/control', 'POST', { id: track.id, action: 'pause' })).status, 200);
    assert.equal((await request(service, '/companion/music/apple/control', 'POST', { action: 'pause' })).status, 400);
    assert.equal((await request(service, '/companion/music/apple/unknown')).status, 404);
    assert.deepEqual(calls, [['song', 'hk'], ['jp'], ['hk:123'], ['hk:123', { foreground: false }], ['pause', undefined, 'hk:123']]);
  }, { appleMusic: {
    search: async (...args) => { calls.push(args); return [track]; },
    recommend: async (...args) => { calls.push(args); return { tracks: [track] }; },
    state: async (...args) => { calls.push(args); return { matched: true }; },
    open: async (...args) => { calls.push(args); return { verified: false }; },
    control: async (...args) => { calls.push(args); return { state: 'paused' }; },
  } });
});

test('chat recommendations survive reopening and only an explicit validated selection adds to the real playlist', async () => {
  const calls = [], track = { id: 'hk:123', title: 'Real song', artist: 'Artist' };
  await fixture(async ({ service, store }) => {
    store.saveExchange(source.sessionId, source.userTurnId, source.conversation, source.reply);
    store.saveIntent(source.sessionId, source.userTurnId, { action: 'recommend', status: 'done', presented: false, recommendations: [track] });
    const input = { sessionId: source.sessionId, reply: source.reply };
    const reopened = await request(service, '/companion/music/source', 'POST', input);
    assert.equal(reopened.body.intent.recommendations[0].id, track.id);
    assert.equal(calls.filter(c => c[0] === 'add').length, 0);
    assert.equal((await request(service, '/companion/music/apple/playlist-add', 'POST', { ...input, id: 'invented', playlistId: 'favorites' })).status, 400);
    assert.equal(calls.filter(c => c[0] === 'add').length, 0);
    const added = await request(service, '/companion/music/apple/playlist-add', 'POST', { ...input, id: track.id, playlistId: 'favorites' });
    assert.equal(added.body.added, true);
    assert.deepEqual(calls.find(c => c[0] === 'add'), ['add', track.id, 'favorites']);
    await request(service, '/companion/music/apple/recommendation-seen', 'POST', input);
    assert.equal(store.intent(source.sessionId, source.userTurnId).presented, true);
    assert.equal((await request(service, '/companion/music/apple/playlists')).body.defaultId, 'favorites');
    assert.equal((await request(service, '/companion/music/apple/playlist-tracks?id=favorites')).body.tracks[0].id, track.id);
  }, { appleMusic: {
    registerTracks: tracks => { calls.push(['register', tracks]); },
    addToPlaylist: async (...args) => { calls.push(['add', ...args]); return { added: true }; },
    playlists: async () => ({ defaultId: 'favorites', playlists: [{ id: 'favorites', writable: true }] }),
    playlistTracks: async id => ({ playlist: { id }, tracks: [track] }),
  } });
});

test('general-model song planning replaces unreliable character guesses before real catalog lookup', async () => {
  const picks = [{ title: '光るなら', artist: 'Goose house' }]; let received;
  await fixture(async ({ service }) => {
    const result = await request(service, '/companion/music/apple/suggest', 'POST', {
      prompt: '夜晚的 ACG 歌曲', picks: [{ title: '光るなら', artist: 'wacci' }],
    });
    assert.equal(result.status, 200); assert.deepEqual(received, picks);
  }, { recommend: async prompt => { assert.match(prompt, /ACG/u); return picks; },
    appleMusic: { suggest: async input => { received = input; return { tracks: [] }; } } });
});

test('Hotaru resolves real recommendation cards without composing or adding songs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hotaru-recommend-'));
  const path = join(root, 'companion.sqlite'), music = openMusicStore(path + '.music');
  const companion = openCompanionStore(path); companion.updateSettings({ topicTracking: false, autoMemory: false }); companion.close();
  let adapter, dispose, suggested;
  const picks = [{ title: '藍二乗', artist: 'Yorushika', reason: '适合散步' }];
  const cards = [{ id: 'hk:123', title: '藍二乗', artist: 'Yorushika' }];
  applyModel({ effect(fn) { dispose = fn(); }, credentials: { async resolve() { return { value: 'test-key' }; } },
    llm: { registerAdapter(_names, value) { adapter = value; } } }, { storePath: path,
    musicTrigger: () => { throw new Error('must not compose'); }, petCue: async () => {},
    musicSuggest: async input => { suggested = input; return { tracks: cards }; },
    fetchImpl: async (_url, init) => {
      const input = JSON.parse(init.body);
      if (!input.stream) return Response.json({ choices: [{ message: { content: JSON.stringify({ action: 'recommend', seconds: 30, reason: '用户请求推荐', recommendations: picks }) } }] });
      return new Response('data: {"choices":[{"delta":{"content":"这几首适合今晚听。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    } });
  try {
    for await (const _ of adapter.stream({ model: 'hotaru-v0.1', sessionId: 'rec-chat', messages: [
      { id: 'rec-user', role: 'user', source: { kind: 'user' }, content: '给我推荐几首散步的歌' },
    ] })) { /* consume */ }
    assert.deepEqual(suggested.picks, picks);
    const intent = music.intent('rec-chat', 'rec-user');
    assert.equal(intent.action, 'recommend'); assert.equal(intent.status, 'done'); assert.equal(intent.presented, false);
    assert.deepEqual(intent.recommendations, cards); assert.equal(music.list({ sessionId: 'rec-chat' }).length, 0);
  } finally { dispose(); music.close(); await rm(root, { recursive: true, force: true }); }
});

test('cleanup preserves the diary and pinned audio, and regeneration gets a fresh retention period', async () => {
  await fixture(async ({ root, store, service }) => {
    const a = service.start(source);
    await service.settled();
    store.update(a.id, { audioCreatedAt: 1 });
    await request(service, '/companion/music');
    assert.equal(store.get(a.id).audioAvailable, false);
    assert.match(musicMemory(store, '那首曲子', source.sessionId), /放学后的片刻/u);
    await request(service, `/companion/music/${a.id}/retry`, 'POST'); await service.settled();
    await request(service, '/companion/music'); assert.equal(store.get(a.id).audioAvailable, true);
    await request(service, `/companion/music/${a.id}`, 'PUT', { pinned: true });
    store.update(a.id, { audioCreatedAt: 1 });
    await request(service, '/companion/music'); assert.equal(store.get(a.id).audioAvailable, true);
    assert.deepEqual(await readFile(join(root, 'audio', a.id + '.wav')), wav);
    await request(service, `/companion/music/${a.id}`, 'DELETE');
    assert.equal(musicMemory(store, '那首曲子', source.sessionId), '');
  });
});

test('API requires captured Hotaru context and serves WAV through the authenticated mobile proxy', async () => {
  await fixture(async ({ store, service }) => {
    assert.equal((await request(service, '/companion/music', 'POST', { sessionId: source.sessionId, reply: '伪造回复' })).status, 400);
    store.saveExchange(source.sessionId, source.userTurnId, source.conversation, source.reply);
    const { body: song } = await request(service, '/companion/music', 'POST', { sessionId: source.sessionId, reply: source.reply });
    await service.settled();
    assert.equal(await service.handle({ url: '/companion/music/../../settings', method: 'GET' }, {}), false);
    assert.equal((await request(service, '/companion/music/not-an-id', 'GET')).status, 404);
    const audio = await request(service, `/companion/music/${song.id}/audio`);
    assert.equal(audio.headers['Content-Type'], 'audio/wav'); assert.deepEqual(audio.data, wav);
    const remote = await handleRemoteControlRequest(new Request('https://dsh.example/api/emilia', { method: 'POST',
      body: JSON.stringify({ path: `/companion/music/${song.id}/audio`, method: 'GET' }) }), {}, async () => new Response(wav, { headers: { 'content-type': 'audio/wav' } }));
    assert.equal(remote.headers.get('content-type'), 'audio/wav'); assert.deepEqual(Buffer.from(await remote.arrayBuffer()), wav);
  });
});

test('Hotaru recalls its music and queues an explicit piano request without affecting work mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hotaru-model-'));
  const path = join(root, 'companion.sqlite');
  const music = openMusicStore(path + '.music');
  const song = music.create(source); music.update(song.id, { status: 'completed', title: '放学后的片刻', reason: '考试后休息', liked: true });
  let adapter, dispose, payload, queued;
  applyModel({ effect(fn) { dispose = fn(); }, credentials: { async resolve() { return { value: 'test-key' }; } },
    llm: { registerAdapter(_names, value) { adapter = value; }, async *stream(options) {
      assert.equal(options.provider, 'deepseek-account'); yield { type: 'text-delta', text: '音乐联调' };
    } } }, { storePath: path,
    musicTrigger: async input => { queued = input; }, fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (!request.stream) return Response.json({ choices: [{ message: { content: JSON.stringify({ action: 'compose', seconds: 30, reason: '用户请求演奏' }) } }] });
      payload = request;
      return new Response('data: {"choices":[{"delta":{"content":"可以，我来写一小段。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    } });
  try {
    for await (const _ of adapter.stream({ model: 'hotaru-v0.1', sessionId: 'new-chat', messages: [
      { id: 'u2', role: 'user', source: { kind: 'user' }, content: '记得那首曲子吗？请为我弹一段钢琴。' },
      { id: 'skills', role: 'user', source: { kind: 'dsh-tool-skill' }, content: '<system-reminder>available skills</system-reminder>' },
    ] })) { /* consume */ }
    assert.match(payload.character_options.profile, /放学后的片刻/u);
    assert.equal(payload.messages.at(-1).content, '记得那首曲子吗？请为我弹一段钢琴。');
    assert.equal(queued.sessionId, 'new-chat');
    assert.equal(music.source('new-chat', queued.reply).userTurnId, 'u2');
    const before = queued;
    for await (const _ of adapter.stream({ model: 'hotaru-v0.1', sessionId: 'new-chat', purpose: 'session-title',
      messages: [{ role: 'user', source: { kind: 'dsh-session-title-llm' }, content: 'Generate the session title: 为我弹一段钢琴' }] })) { /* consume */ }
    assert.equal(queued, before);
    assert.equal(music.source('new-chat', '音乐联调'), null);
  } finally { dispose(); music.close(); await rm(root, { recursive: true, force: true }); }
});

test('curated covers import once, retain separate vocal tracks and persist diary edits without regeneration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hotaru-cover-'));
  const store = openMusicStore(join(root, 'db.sqlite'));
  const mix = Buffer.alloc(128, 1), vocal = Buffer.alloc(128, 2);
  for (const bytes of [mix, vocal]) { bytes.write('RIFF'); bytes.write('WAVE', 8); }
  const mixedPath = join(root, 'mix.wav'), vocalPath = join(root, 'vocal.wav');
  await writeFile(mixedPath, mix); await writeFile(vocalPath, vocal);
  const covers = [{ key: 'fixture-v1', title: 'ただ君に晴れ', seconds: 274, diaryDate: '2026-10-16', diaryText: '一起听这首歌吧。', audio: mixedPath, vocal: vocalPath }];
  const options = { root: join(root, 'library'), covers, fetchImpl() { throw new Error('covers must not call piano worker'); } };
  let service = createMusicDiary(store, {}, {}, options);
  try {
    await service.ready;
    const { body: rows } = await request(service, '/companion/music');
    assert.equal(rows.length, 1); const song = rows[0];
    assert.match(musicMemory(store, 'ただ君に晴れ', 'chat'), /ただ君に晴れ/u);
    assert.equal(song.kind, 'cover'); assert.equal(song.audioAvailable, true); assert.equal(song.vocalAvailable, true);
    assert.equal(song.audio, undefined); assert.equal(song.vocal, undefined);
    assert.deepEqual((await request(service, `/companion/music/${song.id}/audio`)).data, mix);
    assert.deepEqual((await service.lipSyncAudio(song.id)).audio, vocal);
    assert.equal((await request(service, `/companion/music/${song.id}/retry`, 'POST')).status, 400);
    const edited = await request(service, `/companion/music/${song.id}`, 'PUT', {
      title: '一起听过的歌', diaryDate: '2026-10-17', diaryText: '把这首留下来。', feedback: '副歌很喜欢。', pinned: false,
      audio: '/etc/passwd', kind: 'piano', seconds: 1,
    });
    assert.equal(edited.body.kind, 'cover'); assert.equal(edited.body.seconds, 274);
    assert.equal(edited.body.audio, undefined);
    store.update(song.id, { audioCreatedAt: 1 });
    await request(service, '/companion/music');
    assert.equal(store.get(song.id).audioAvailable, true, 'un-pinned covers are not expiring generation cache');
    assert.match(musicMemory(store, '还记得那首翻唱吗', 'chat'), /副歌很喜欢。/u);
    assert.equal((await request(service, `/companion/music/${song.id}`, 'PUT', { diaryDate: '2026-02-30' })).status, 400);
    assert.equal((await request(service, `/companion/music/${song.id}`, 'PUT', { feedback: 'x'.repeat(2001) })).status, 400);
    await service.dispose();
    service = createMusicDiary(store, {}, {}, options); await service.ready;
    assert.equal(store.list().length, 1);
    assert.equal(store.get(song.id).feedback, '副歌很喜欢。');
    assert.equal(store.get(song.id).title, '一起听过的歌');
    assert.equal(store.get(song.id).diaryDate, '2026-10-17');
    await request(service, `/companion/music/${song.id}`, 'DELETE');
    await assert.rejects(readFile(join(root, 'library', `${song.id}.vocals.wav`)), { code: 'ENOENT' });
    assert.deepEqual(await readFile(vocalPath), vocal, 'source file stays intact');
    await service.dispose(); service = createMusicDiary(store, {}, {}, options); await service.ready;
    assert.equal(store.list().length, 0, 'removed covers must not reappear after restart');
  } finally { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); }
});
