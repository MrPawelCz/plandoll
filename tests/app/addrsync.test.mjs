// The address that follows the layout (src/app/addrsync.js): a change is written a moment after the last one, flush() writes the last change at once and says whether the
// address holds it, builds never overlap, and a failure leaves the page asking for a file. Fake timers and fake build and write: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressSync, leaveAdvice } from '../../src/app/addrsync.js';

function fakeTimers() {
  let id = 0; const waiting = new Map();
  return {
    setTimeout: (f, ms) => { waiting.set(++id, { f, ms }); return id; },
    clearTimeout: (i) => { waiting.delete(i); },
    fire() { const all = [...waiting.values()]; waiting.clear(); for (const t of all) t.f(); },
    get count() { return waiting.size; },
    get delays() { return [...waiting.values()].map((t) => t.ms); },
  };
}
// build gives a numbered result so that a test sees which build was written; log keeps the order of builds and writes
function rig(opts = {}) {
  const timers = fakeTimers(), log = []; let n = 0, running = 0, overlap = 0;
  const build = opts.build ?? (async () => { running += 1; overlap = Math.max(overlap, running); await new Promise((r) => setImmediate(r)); running -= 1; n += 1; log.push(`build ${n}`); return { ok: true, hash: `h${n}` }; });
  const write = opts.write ?? ((made) => { log.push(`write ${made.hash}`); return true; });
  const sync = createAddressSync({ build, write, timers });
  return { sync, timers, log, get overlap() { return overlap; } };
}

test('a burst of changes is one write, a moment after the last one', async () => {
  const { sync, timers, log } = rig();
  sync.changed(); sync.changed(); sync.changed();
  assert.equal(timers.count, 1, 'every change restarts the one timer');
  assert.deepEqual(timers.delays, [400]);
  assert.equal(sync.pending, true); assert.deepEqual(log, [], 'nothing is written while changes keep coming');
  timers.fire();
  assert.equal(await sync.flush(), true);
  assert.deepEqual(log, ['build 1', 'write h1'], 'one build, one write');
  assert.equal(sync.pending, false);
});

test('flush writes at once what is waiting, cancels the timer and says that the address holds the last change', async () => {
  const { sync, timers, log } = rig();
  sync.changed();
  assert.equal(timers.count, 1);
  assert.equal(await sync.flush(), true);
  assert.equal(timers.count, 0, 'the timer is not left to write the same thing again');
  assert.deepEqual(log, ['build 1', 'write h1']);
  timers.fire(); assert.equal(await sync.flush(), true); assert.deepEqual(log, ['build 1', 'write h1'], 'nothing is built twice');
});

test('with nothing changed flush writes nothing and says yes', async () => {
  const { sync, log } = rig();
  assert.equal(sync.pending, false);
  assert.equal(await sync.flush(), true);
  assert.deepEqual(log, []);
});

test('a build that is not ok, one that throws and a write that returns false all leave the address behind: flush says no and pending stays', async () => {
  for (const [name, opts] of [
    ['not ok', { build: async () => ({ ok: false, error: 'too-long' }) }],
    ['throws', { build: async () => { throw new Error('boom'); } }],
    ['nothing built', { build: async () => null }],
    ['write refuses', { write: () => false }],
    ['write throws', { write: () => { throw new Error('no history'); } }],
  ]) {
    const { sync } = rig(opts);
    sync.changed();
    assert.equal(await sync.flush(), false, name);
    assert.equal(sync.pending, true, name);
  }
});

test('a write that returns nothing counts as done, and every flush tries again what failed before', async () => {
  let calls = 0, ok = false;
  const { sync, log } = rig({ build: async () => { calls += 1; return ok ? { ok: true, hash: 'x' } : { ok: false }; }, write: (made) => { log.push(`write ${made.hash}`); } });
  sync.changed();
  assert.equal(await sync.flush(), false); assert.equal(calls, 1);
  assert.equal(await sync.flush(), false); assert.equal(calls, 2, 'a second tap tries again');
  ok = true;
  assert.equal(await sync.flush(), true); assert.equal(calls, 3, 'and goes through when the cause is gone, with no new change');
  assert.deepEqual(log, ['write x']);
  assert.equal(sync.pending, false);
});

test('a change that comes while the layout is being built: the older write lands, pending stays, the next flush writes the newer layout', async () => {
  const log = []; let release; let n = 0;
  const gate = () => new Promise((r) => { release = r; });
  const timers = fakeTimers();
  const sync = createAddressSync({ timers, build: async () => { n += 1; const me = n; if (me === 1) await gate(); log.push(`build ${me}`); return { ok: true, hash: `h${me}` }; }, write: (made) => { log.push(`write ${made.hash}`); return true; } });
  sync.changed();
  const first = sync.flush();
  await new Promise((r) => setImmediate(r)); // build 1 has started and waits at the gate
  assert.equal(typeof release, 'function');
  sync.changed(); // while build 1 waits
  release(); assert.equal(await first, false, 'the address holds the first layout, not the last change');
  assert.equal(sync.pending, true);
  assert.equal(await sync.flush(), true);
  assert.deepEqual(log, ['build 1', 'write h1', 'build 2', 'write h2']);
});

test('builds never overlap, however flush and the timer are mixed', async () => {
  const r = rig();
  const jobs = [];
  for (let k = 0; k < 5; k++) { r.sync.changed(); jobs.push(r.sync.flush()); if (k === 2) r.timers.fire(); await Promise.resolve(); }
  await Promise.all(jobs);
  assert.equal(r.overlap, 1, 'a build starts only when the one before it is done');
  assert.ok(r.log.length >= 2, 'something was written');
  assert.equal(r.sync.pending, false);
  assert.ok(r.log.every((l, i, all) => !l.startsWith('build') || i === 0 || all[i - 1].startsWith('write')), `a write follows each build: ${r.log.join(', ')}`);
});

test('the default timers work in a browser too: setTimeout and clearTimeout are called as plain functions, never as methods of another object', async () => {
  // a browser throws 'Illegal invocation' for window.setTimeout called with any other `this`; Node does not, so the guard is put on the globals for this test
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const guard = (f) => function (...a) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return f(...a); };
  globalThis.setTimeout = guard(realSet); globalThis.clearTimeout = guard(realClear);
  try {
    const log = [];
    const sync = createAddressSync({ delay: 5, build: async () => ({ ok: true, hash: 'guarded' }), write: (made) => { log.push(made.hash); return true; } });
    sync.changed(); sync.changed(); // the second call clears the first timer
    await new Promise((r) => realSet(r, 60));
    assert.deepEqual(log, ['guarded']);
    sync.changed(); assert.equal(await sync.flush(), true); // flush clears a timer too
    assert.deepEqual(log, ['guarded', 'guarded']);
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
});

test('the default timers are the real ones: a change is written by itself after the delay', async () => {
  const log = [];
  const sync = createAddressSync({ delay: 5, build: async () => ({ ok: true, hash: 'real' }), write: (made) => { log.push(made.hash); return true; } });
  sync.changed();
  assert.deepEqual(log, []);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(log, ['real']); assert.equal(sync.pending, false);
});

test('leaveAdvice: leave, or say first why the layout would not survive; the second tap always leaves', () => {
  assert.equal(leaveAdvice({}), 'go');
  assert.equal(leaveAdvice(), 'go');
  assert.equal(leaveAdvice({ unsaved: true }), 'file');
  assert.equal(leaveAdvice({ lost: 2 }), 'lost');
  assert.equal(leaveAdvice({ unsaved: true, lost: 2 }), 'file', 'the address that does not hold the layout comes first');
  for (const args of [{ unsaved: true }, { lost: 3 }, { unsaved: true, lost: 3 }]) assert.equal(leaveAdvice({ ...args, warned: true }), 'go');
});
