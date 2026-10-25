// Draw scheduling, against a fake requestAnimationFrame: the page must keep answering after its first frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from '../../src/app/loop.js';

function rig(opts) {
  const queue = [], drawn = [];
  const loop = createLoop({ ...opts, draw: (n) => drawn.push(n), request: (f) => queue.push(f) });
  const step = () => { const f = queue.shift(); if (f) f(); return !!f; }; // one animation frame
  const run = (max = 50) => { let k = 0; while (queue.length && k++ < max) step(); return k; };
  return { loop, queue, drawn, step, run };
}

test('the first frames are drawn one per animation frame, then the loop goes quiet', () => {
  const r = rig({ frames: 4 });
  r.loop.start();
  r.run();
  assert.deepEqual(r.drawn, [1, 2, 3, 4]);
  assert.equal(r.queue.length, 0, 'nothing stays queued while idle');
  assert.equal(r.loop.idle, true);
});

test('a change after the first frames draws exactly one more frame (the page used to stop for good)', () => {
  const r = rig({ frames: 4 });
  r.loop.start(); r.run();
  r.loop.invalidate();
  assert.equal(r.queue.length, 1);
  r.run();
  assert.deepEqual(r.drawn, [1, 2, 3, 4, 5]);
  assert.equal(r.loop.idle, true);
  r.loop.invalidate(); r.run();
  assert.equal(r.drawn.at(-1), 6);
});

test('many changes before the next animation frame make one frame', () => {
  const r = rig({ frames: 1 });
  r.loop.start(); r.run();
  for (let i = 0; i < 20; i++) r.loop.invalidate(); // a slider drag fires many input events
  assert.equal(r.queue.length, 1);
  r.run();
  assert.deepEqual(r.drawn, [1, 2]);
});

test('a change made during a draw is not lost', () => {
  const queue = [], drawn = [];
  let loop;
  loop = createLoop({ frames: 1, request: (f) => queue.push(f), draw: (n) => { drawn.push(n); if (n === 2) loop.invalidate(); } });
  loop.start(); while (queue.length) queue.shift()();
  loop.invalidate(); while (queue.length) queue.shift()();
  assert.deepEqual(drawn, [1, 2, 3]);
});

test('live mode draws only the first frame at the start, then waits for a request and still draws only on demand', () => {
  const r = rig({ frames: 4, live: true });
  r.loop.start(); r.run();
  assert.deepEqual(r.drawn, [1], 'the first frame is drawn because the page starts out dirty');
  assert.equal(r.loop.idle, true);
  r.run();
  assert.deepEqual(r.drawn, [1]);
  r.loop.invalidate(); r.run();
  assert.deepEqual(r.drawn, [1, 2]);
});

test('a start before the first change and a change before the first animation frame do not double up', () => {
  const r = rig({ frames: 2 });
  r.loop.start(); r.loop.invalidate(); r.loop.start();
  assert.equal(r.queue.length, 1);
  r.run();
  assert.deepEqual(r.drawn, [1, 2]);
});
