// The clock of the intro (introrun.js) with a clock and a scene of its own (no browser, no three.js): it begins with the empty plan, runs from the first frames, and ends exactly once,
// whatever ends it, putting the scene back before the page is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntroRun } from '../../src/app/introrun.js';
import { introTimeline } from '../../src/app/intro.js';

function rig({ pieces = 35, guard = false, failPrepare = false } = {}) {
  const log = [], tl = introTimeline(pieces);
  let now = 0, id = 0, tid = 0;
  const frames = new Map(), timers = new Map();
  const r = {
    log, tl,
    build: {
      timeline: tl, active: false,
      prepare() { if (failPrepare) throw new Error('no scene'); log.push('prepare'); this.active = true; return { pieces }; },
      apply(t) { log.push(`apply ${t.toFixed(3)}`); return { placed: Math.min(pieces, Math.floor((t / tl.total) * pieces)), total: pieces }; },
      finish() { log.push('build.finish'); this.active = false; },
    },
    view: { arm() { log.push('arm'); }, show(look) { r.looks.push(look); }, end() { log.push('view.end'); }, dispose() { log.push('view.dispose'); } },
    looks: [], cams: [], lifts: [], states: [],
    run: null,
    // a clock that the test moves by hand: frames and timers run when it is advanced
    advance(ms) {
      const stop = now + ms;
      while (true) {
        const nextFrame = frames.size ? now + 16.7 : Infinity, due = [...timers.values()].map((x) => x.at).sort((a, b) => a - b)[0] ?? Infinity;
        const next = Math.min(nextFrame, due, stop);
        now = next;
        for (const [h, x] of [...timers]) if (x.at <= now) { timers.delete(h); x.f(); }
        if (frames.size && now >= nextFrame - 1e-9) { const fs = [...frames.values()]; frames.clear(); for (const f of fs) f(now); }
        if (next >= stop) break;
      }
    },
    get now() { return now; },
  };
  r.run = createIntroRun({
    build: r.build, view: r.view, end: { azimuth: 35.5, polar: 50, distance: 20 }, guard,
    setCamera: (s) => r.cams.push(s), setLift: (k) => r.lifts.push(k), render: () => log.push('render'), invalidate: () => log.push('invalidate'), nextFrame: () => Promise.resolve(),
    finishScene: () => log.push('finishScene'), setState: (s, why) => { r.states.push([s, why]); log.push(`state ${s} ${why ?? ''}`.trim()); },
    request: (f) => { frames.set(++id, f); return id; }, cancel: (h) => frames.delete(h), setTimeout: (f, ms) => { timers.set(++tid, { f, at: now + ms }); return tid; }, clearTimeout: (h) => timers.delete(h),
  });
  return r;
}
const count = (log, s) => log.filter((x) => x === s).length;

test('begin() draws one frame with everything on show, then puts the empty plan on the stage and arms the skip, all before any frame of the page', () => {
  const r = rig();
  assert.equal(r.run.begin(), true);
  assert.deepEqual(r.log.slice(0, 5), ['prepare', `apply ${r.tl.total.toFixed(3)}`, 'render', 'apply 0.000', 'arm']);
  assert.equal(r.run.state, 'ready'); assert.equal(r.run.active, true);
  assert.deepEqual(r.cams[0], { azimuth: 35.5 - 24, polar: 13, distance: 18 }, 'the camera starts above, a little nearer');
  assert.equal(r.looks[0].chip.key, 'empty'); assert.equal(r.looks[0].count.show, false);
  assert.equal(r.states.length, 0, 'the page says "playing" itself, when the first frame is drawn');
  r.run.shown();
  assert.deepEqual(r.states, [['playing', undefined]]);
  assert.equal(r.run.state, 'playing');
});

test('the clock begins with the first frame, not before (the page is still being built): t = 0 is the first tick after it', () => {
  const r = rig();
  r.run.begin();
  r.advance(5000);
  assert.equal(r.run.t, 0); assert.equal(r.run.state, 'ready');
  r.run.shown(); r.run.shown();
  r.advance(1000);
  assert.ok(r.run.t > 0.9 && r.run.t < 1.1, `t is about 1 s: ${r.run.t}`);
  assert.equal(r.run.state, 'playing');
  assert.equal(r.states.filter(([s]) => s === 'playing').length, 1, 'said once');
});

test('the story plays to its end, the words and the counter follow the clock, and the end is announced once: scene put back first, then the page told', () => {
  const r = rig();
  r.run.begin(); r.run.shown();
  r.advance(r.tl.total * 1000 + 200);
  assert.equal(r.run.state, 'done'); assert.equal(r.run.reason, 'finished');
  const i = (s) => r.log.indexOf(s);
  assert.ok(i('build.finish') > 0 && i('build.finish') < i('view.end') && i('view.end') < i('finishScene') && i('finishScene') < i('state done finished'), r.log.slice(-8).join(' | '));
  assert.equal(count(r.log, 'finishScene'), 1); assert.equal(count(r.log, 'build.finish'), 1);
  const keys = new Set(r.looks.map((l) => l.chip.key));
  for (const k of ['empty', 'walls', 'openings', 'furniture', 'ready']) assert.ok(keys.has(k), `the word ${k} was shown`);
  const counts = r.looks.filter((l) => l.count.show).map((l) => l.count.n);
  assert.ok(counts.length > 50, 'the counter was drawn on many frames');
  for (let k = 1; k < counts.length; k++) assert.ok(counts[k] >= counts[k - 1], 'and only counts up');
  assert.equal(r.lifts[0], 0, 'the picture starts in the middle of the window'); assert.equal(r.lifts[r.lifts.length - 1], 1, 'and ends where the page keeps it');
  for (let k = 1; k < r.lifts.length; k++) assert.ok(r.lifts[k] >= r.lifts[k - 1], 'it only goes up');
  const lastCamera = r.cams[r.cams.length - 1];
  assert.ok(lastCamera.polar > 49.9 && lastCamera.distance > 19.9, 'the camera came down to the starting view');
  r.advance(5000);
  assert.equal(count(r.log, 'finishScene'), 1, 'nothing runs after the end');
  assert.equal(r.run.skip('key'), false, 'a late skip does nothing');
});

test('skip() ends it at once, once, and says how', () => {
  const r = rig();
  r.run.begin(); r.run.shown(); r.advance(1500);
  assert.equal(r.run.skip('pointer'), true);
  assert.equal(r.run.state, 'done'); assert.equal(r.run.reason, 'skipped'); assert.equal(r.run.how, 'pointer');
  assert.equal(r.run.skip('key'), false);
  assert.equal(count(r.log, 'finishScene'), 1);
  assert.deepEqual(r.states[r.states.length - 1], ['done', 'skipped']);
  r.advance(20000);
  assert.equal(count(r.log, 'finishScene'), 1);
});

test('a skip before the first frame (the page still being built) ends it too, and nothing starts after the end', () => {
  const r = rig();
  r.run.begin();
  assert.equal(r.run.skip('key'), true);
  assert.equal(r.run.state, 'done');
  r.run.shown(); r.advance(2000);
  assert.equal(r.run.state, 'done'); assert.equal(count(r.log, 'finishScene'), 1, 'shown() after the end starts nothing');
  assert.equal(r.states.filter(([s]) => s === 'playing').length, 0);
  assert.equal(r.run.how, 'key');
  assert.equal(r.run.skip('api'), false); assert.equal(r.run.how, 'key', 'a late call does not change how it ended');
});

test('a slow device ends it: frames at 8 a second jump to the end, the page in its usual state', () => {
  // frames come every 125 ms
  const frames = new Map(); let now = 0, id = 0, timerFn = null;
  const log = [];
  const tl = introTimeline(35);
  const run = createIntroRun({
    build: { timeline: tl, prepare() {}, apply: () => ({ placed: 0, total: 35 }), finish() { log.push('build.finish'); } }, view: { arm() {}, show() {}, end() {} }, end: { azimuth: 1, polar: 50, distance: 10 }, guard: true,
    setCamera() {}, render() {}, invalidate() {}, finishScene() { log.push('finishScene'); }, setState: (s, w) => log.push(`${s} ${w ?? ''}`),
    request: (f) => { frames.set(++id, f); return id; }, cancel: (h) => frames.delete(h), setTimeout: (f) => { timerFn = f; return 1; }, clearTimeout() {},
  });
  run.begin(); run.shown();
  for (let k = 0; k < 80 && run.state !== 'done'; k++) { now += 125; const fs = [...frames.values()]; frames.clear(); for (const f of fs) f(now); }
  assert.equal(run.state, 'done'); assert.equal(run.reason, 'slow');
  assert.ok(now < 3000, `within a few seconds: ${now}`);
  assert.deepEqual(log.filter((x) => x !== 'done slow' && x !== 'playing '), ['build.finish', 'finishScene']);
  assert.ok(timerFn);
});

test('a steady 60 frames a second never trips the guard', () => {
  const tl = introTimeline(35), frames = new Map(); let id = 0, now = 0;
  const run = createIntroRun({
    build: { timeline: tl, prepare() {}, apply: () => ({ placed: 0, total: 35 }), finish() {} }, view: { arm() {}, show() {}, end() {} }, end: { azimuth: 1, polar: 50, distance: 10 }, guard: true,
    setCamera() {}, render() {}, invalidate() {}, finishScene() {}, setState() {},
    request: (f) => { frames.set(++id, f); return id; }, cancel: (h) => frames.delete(h), setTimeout: () => 1, clearTimeout() {},
  });
  run.begin(); run.shown();
  while (run.state !== 'done' && now < 20000) { now += 1000 / 60; const fs = [...frames.values()]; frames.clear(); for (const f of fs) f(now); }
  assert.equal(run.reason, 'finished');
  assert.ok(now / 1000 < tl.total + 0.1 && now / 1000 > tl.total - 0.1);
});

test('the failsafe ends an intro whose page never draws, or whose frames stop; a slow first frame is not a stuck intro', () => {
  const never = rig();
  never.run.begin();
  never.advance(14000);
  assert.equal(never.run.state, 'ready', 'still waiting at 14 s');
  never.advance(1500);
  assert.equal(never.run.state, 'done'); assert.equal(never.run.reason, 'timeout');
  assert.equal(count(never.log, 'finishScene'), 1);
  const slowLoad = rig();
  slowLoad.run.begin(); slowLoad.advance(12000); slowLoad.run.shown(); // a first frame that took 12 s to come
  slowLoad.advance(slowLoad.tl.total * 1000 + 200);
  assert.equal(slowLoad.run.reason, 'finished', 'the failsafe started again with the first frame');
  // the frames stop (a tab that is hidden): the timer of a running intro is its length plus seven seconds
  let timers = [], now = 0;
  const log = [], tl = introTimeline(35);
  const run = createIntroRun({
    build: { timeline: tl, prepare() {}, apply: () => ({ placed: 0, total: 35 }), finish() {} }, view: { arm() {}, show() {}, end() {} }, end: { azimuth: 1, polar: 50, distance: 10 }, guard: false,
    setCamera() {}, render() {}, invalidate() {}, finishScene() { log.push('finishScene'); }, setState() {},
    request: () => 1, cancel() {}, setTimeout: (f, ms) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout: (h) => { timers[h - 1] = { f() {}, at: Infinity }; },
  });
  run.begin(); run.shown();
  const live = timers.filter((t) => t.at !== Infinity);
  assert.equal(live.length, 1);
  assert.ok(Math.abs(live[0].at - (tl.total + 7) * 1000) < 1e-6, 'length plus seven seconds');
  live[0].f();
  assert.equal(run.state, 'done'); assert.equal(run.reason, 'timeout'); assert.deepEqual(log, ['finishScene']);
});

test('a scene that cannot be prepared leaves the page as it is: no intro, the page told, no throw', () => {
  const r = rig({ failPrepare: true });
  assert.equal(r.run.begin(), false);
  assert.equal(r.run.state, 'done'); assert.equal(r.run.reason, 'error'); assert.equal(r.run.active, false);
  assert.ok(r.log.includes('view.dispose') && r.log.includes('finishScene') && r.log.includes('state done error'));
  assert.equal(r.run.skip('key'), false);
  r.run.shown();
  assert.equal(r.states.filter(([s]) => s === 'playing').length, 0);
});

test('seek() holds the story at a time and ends it at the end, for a test tool', async () => {
  const r = rig();
  r.run.begin(); r.run.shown();
  assert.equal(await r.run.seek(2.5), true);
  assert.ok(Math.abs(r.run.t - 2.5) < 1e-9 && r.run.state === 'playing');
  r.advance(3000);
  assert.ok(Math.abs(r.run.t - 2.5) < 1e-9, 'the clock does not run while it is held');
  assert.equal(await r.run.seek(-3), true); assert.equal(r.run.t, 0);
  assert.equal(await r.run.seek(r.tl.total + 5), true);
  assert.equal(r.run.state, 'done'); assert.equal(r.run.reason, 'finished');
  assert.equal(await r.run.seek(1), false);
  assert.deepEqual(r.run.counts.total, 35);
});
