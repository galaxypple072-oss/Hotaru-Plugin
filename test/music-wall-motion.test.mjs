import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function scene(reduced = false) {
  const code = await readFile(new URL('../dsh-plugin/assets/music-wall/motion.js', import.meta.url), 'utf8');
  let now = 0, next = 0;
  const jobs = new Map(), history = [];
  const schedule = (fn, delay) => { const id = ++next; jobs.set(id, { time: now + delay, fn }); return id; };
  const element = () => ({ style: { setProperty() {} }, dataset: {}, offsetWidth: 1200, hidden: false });
  const elements = { '#scene': element(), '#stage': element(), '#ask': element(), '#empty-panel': element() };
  const texts = { h2: {}, p: {} };
  elements['#empty-panel'].querySelector = selector => texts[selector];
  const tabs = ['original', 'cover', 'found'].map(id => ({ dataset: { tab: id }, setAttribute(key, value) { this[key] = value; } }));
  const S = { tab: 'original', sel: 1, playing: true, items: { original: [{ id: 'p1' }, { id: 'p2' }], cover: [{ id: 'c1' }, { id: 'c2' }], found: [] } };
  const context = { S, $: selector => elements[selector],
    window: { matchMedia: () => ({ matches: reduced }) }, matchMedia: () => ({ matches: reduced }),
    document: { querySelectorAll: () => tabs }, setTimeout: schedule, requestAnimationFrame: fn => schedule(fn, 16),
    cur: () => S.items[S.tab][S.sel], stopAudio() {}, syncPlay() {},
    buildWall: () => history.push(S.tab), select: index => { S.sel = index; },
  };
  const motion = runInNewContext(`${code};({switchTab,emptyState,get phase(){return scene.dataset.phase},get switching(){return switching}})`, context);
  return { motion, S, elements, history, texts, tabs,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const candidate = [...jobs].filter(([, job]) => job.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!candidate) break;
        const [id, job] = candidate; now = job.time; jobs.delete(id); job.fn();
      }
      now = end;
    },
  };
}

test('each board runs an exit and painted entrance, including the empty search board', async () => {
  const view = await scene();
  for (const tab of ['cover', 'found', 'original']) {
    const previous = view.S.tab;
    view.motion.switchTab(tab);
    assert.equal(view.motion.phase, 'exit');
    assert.equal(view.S.tab, previous, 'keep the outgoing board mounted during its exit');
    view.advance(220);
    assert.equal(view.S.tab, tab);
    assert.equal(view.motion.phase, 'prepare');
    view.advance(32);
    assert.equal(view.motion.phase, 'enter');
    view.advance(650);
    assert.equal(view.motion.phase, 'idle');
    assert.equal(view.motion.switching, false);
    assert.equal(view.elements['#empty-panel'].hidden, tab !== 'found');
  }
  assert.deepEqual(view.history, ['cover', 'found', 'original']);
  assert.equal(view.S.sel, 1, 'return to the previously selected piano track');
});

test('rapid board changes discard stale animation callbacks and settle on the last click', async () => {
  const view = await scene();
  view.motion.switchTab('cover'); view.advance(60);
  view.motion.switchTab('found'); view.advance(60);
  view.motion.switchTab('original'); view.advance(1500);
  assert.deepEqual(view.history, ['original']);
  assert.equal(view.S.tab, 'original');
  assert.equal(view.S.sel, 1);
  assert.equal(view.motion.phase, 'idle');
  assert.equal(view.elements['#scene'].style.opacity, '1');
});

test('returning during an incoming transition cancels it without leaving the scene transparent', async () => {
  const view = await scene();
  view.motion.switchTab('cover'); view.advance(300);
  assert.equal(view.motion.phase, 'enter');
  view.motion.switchTab('found'); view.advance(1000);
  assert.deepEqual(view.history, ['cover', 'found']);
  assert.equal(view.S.tab, 'found');
  assert.equal(view.elements['#scene'].style.opacity, '1');
  assert.equal(view.motion.phase, 'idle');
  assert.match(view.texts.p.textContent, /尚未接入/);
});

test('reduced motion keeps board navigation functional without sliding transitions', async () => {
  const view = await scene(true);
  view.motion.switchTab('found'); view.advance(32);
  assert.equal(view.S.tab, 'found');
  assert.equal(view.motion.phase, 'idle');
  assert.equal(view.elements['#scene'].style.transition, 'none');
});
