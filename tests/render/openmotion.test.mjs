// The motion of the open shell: the gaps between walls, the angle curve with its overshoot, the growth of low walls, the clock that runs forward and back, the order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOTAL_MS, OPEN_DEG, OVERSHOOT_DEG, STAGGER_MIN_MS, STAGGER_MAX_MS, GROW_END, staggerGap, wallTime, turnFraction, growFraction, frameOf, stepClock, modeOf, startOrder } from '../../src/render/openmotion.js';

const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what ?? ''} ${a} vs ${b}`);

test('the whole motion takes about three seconds and ends flat at ninety degrees', () => {
  assert.equal(TOTAL_MS, 3000); assert.equal(OPEN_DEG, 90);
  for (const n of [1, 2, 4, 8, 12]) for (let rank = 0; rank < n; rank++) {
    near(frameOf(1, rank, n).deg, 90, 1e-9, `rest at the end, wall ${rank} of ${n}`);
    near(frameOf(0, rank, n).deg, 0, 1e-9, `closed at the start, wall ${rank} of ${n}`);
  }
});

test('the walls start one after another with a gap of 80 to 150 ms', () => {
  assert.equal(staggerGap(1), 0); assert.equal(staggerGap(0), 0);
  for (let n = 2; n <= 12; n++) {
    const g = staggerGap(n);
    assert.ok(g >= STAGGER_MIN_MS && g <= STAGGER_MAX_MS, `n=${n} gap ${g}`);
    for (let rank = 0; rank < n; rank++) { // the wall of that rank leaves 0 exactly when the clock has run rank * gap
      const p = (rank * g) / TOTAL_MS;
      near(wallTime(p, rank, n), 0, 1e-9, `rank ${rank} of ${n} at its own start`);
      assert.ok(wallTime(p + 0.01, rank, n) > 0, `rank ${rank} of ${n} just after its start`);
    }
  }
  assert.ok(staggerGap(40) * 39 <= 1200 + 1e-9, 'many walls never spread over more than 1.2 s');
  assert.ok(staggerGap(16) >= STAGGER_MIN_MS - 1e-9);
});

test('a wall turns with an ease-out, overshoots flat by 3 to 5 degrees and settles at exactly flat', () => {
  assert.ok(OVERSHOOT_DEG >= 3 && OVERSHOOT_DEG <= 5);
  let peak = 0, at = 0, prev = 0, rises = true;
  for (let i = 0; i <= 1000; i++) {
    const k = i / 1000, deg = turnFraction(k) * OPEN_DEG;
    if (deg > peak) { peak = deg; at = k; }
    if (k <= 0.78 + 1e-9) rises = rises && deg >= prev - 1e-9; else assert.ok(deg <= prev + 1e-9, `falls back after the peak at ${k}`);
    prev = deg;
  }
  assert.ok(rises, 'rises until the peak');
  near(peak - 90, OVERSHOOT_DEG, 0.01, 'overshoot in degrees');
  near(at, 0.78, 0.002, 'the peak');
  assert.equal(turnFraction(1), 1); assert.equal(turnFraction(0), 0);
  assert.ok(turnFraction(0.2) > 0.5, 'ease-out: more than half of the way in the first fifth of the time');
  const speed = (k) => (turnFraction(k + 1e-4) - turnFraction(k)) / 1e-4;
  assert.ok(speed(0.05) > speed(0.4) && speed(0.4) > speed(0.7), 'it slows down on the way');
  near(speed(0.78 - 2e-4), 0, 0.01, 'no jerk at the peak'); near(speed(0.78 + 1e-4), 0, 0.01, 'no jerk after the peak');
  assert.equal(turnFraction(-3), 0); assert.equal(turnFraction(7), 1); assert.equal(turnFraction(NaN), 0);
});

test('a wall that was held low grows to full height in the first part of its own time', () => {
  assert.equal(growFraction(0), 0); assert.equal(growFraction(GROW_END), 1); assert.equal(growFraction(1), 1);
  let prev = 0;
  for (let i = 0; i <= 100; i++) { const g = growFraction(i / 100); assert.ok(g >= prev - 1e-12); prev = g; }
  assert.ok(growFraction(0.1) > 0 && growFraction(0.1) < 1);
});

test('the pose depends on the clock only: opening and closing pass through the same poses', () => {
  const opening = [], closing = [];
  let p = 0; for (let i = 0; i < 31; i++) { p = stepClock(p, 1, 100); opening.push([p, frameOf(p, 1, 4).deg]); }
  for (let i = 0; i < 31; i++) { p = stepClock(p, 0, 100); closing.push([p, frameOf(p, 1, 4).deg]); }
  assert.equal(opening.at(-1)[0], 1); assert.equal(closing.at(-1)[0], 0);
  for (const [clock, deg] of closing) { // every pose of the way back equals the pose of the way there at the same clock
    near(frameOf(clock, 1, 4).deg, deg, 1e-9);
    const match = opening.find(([c]) => Math.abs(c - clock) < 1e-9);
    if (match) near(match[1], deg, 1e-9, `clock ${clock}`);
  }
});

test('the clock runs the whole motion in TOTAL_MS either way, stops at the target and reverses without a jump', () => {
  let p = 0, t = 0; while (p < 1) { p = stepClock(p, 1, 16); t += 16; }
  assert.ok(t >= 3000 && t < 3016 + 1, `opening took ${t} ms`);
  assert.equal(stepClock(1, 1, 500), 1); assert.equal(stepClock(0, 0, 500), 0);
  p = 1; t = 0; while (p > 0) { p = stepClock(p, 0, 16); t += 16; }
  assert.ok(t >= 3000 && t < 3016 + 1, `closing took ${t} ms`);
  const mid = stepClock(stepClock(0, 1, 1200), 1, 300); // 0.5
  near(mid, 0.5, 1e-12);
  near(stepClock(mid, 0, 300), 0.4, 1e-12, 'a reversal goes back from where it is');
  assert.equal(stepClock(0.3, 1, -50), 0.3, 'a negative step changes nothing'); assert.equal(stepClock(0.3, 1, NaN), 0.3); assert.equal(stepClock(NaN, 1, 100), 100 / 3000);
  assert.equal(stepClock(0.99, 1, 1e9), 1); assert.equal(stepClock(0.01, 0, 1e9), 0);
});

test('modeOf names the four states', () => {
  assert.equal(modeOf(0, 0), 'closed'); assert.equal(modeOf(0, 1), 'opening'); assert.equal(modeOf(0.4, 1), 'opening'); assert.equal(modeOf(1, 1), 'open');
  assert.equal(modeOf(0.4, 0), 'closing'); assert.equal(modeOf(1, 0), 'closing');
});

test('startOrder: walls facing the camera go first, then the sides, ties by level and name; bad input still gives a full ranking', () => {
  const walls = [
    { id: 'n', out: [0, -1], level: 0 }, { id: 's', out: [0, 1], level: 0 }, { id: 'w', out: [-1, 0], level: 0 }, { id: 'e', out: [1, 0], level: 0 },
    { id: 's', out: [0, 1], level: 1 },
  ];
  const r = startOrder(walls, [0, 1]); // the camera is south of the model
  assert.equal(r[1], 0, 'south wall of the ground level first'); assert.equal(r[4], 1, 'then the south wall above it');
  assert.deepEqual([r[2], r[3]].sort(), [2, 3], 'the sides come next'); assert.equal(r[0], 4, 'the far wall last');
  const ranks = (x) => [...x].sort((a, b) => a - b);
  assert.deepEqual(ranks(startOrder(walls, [0.7071, 0.7071])), [0, 1, 2, 3, 4]);
  assert.deepEqual(ranks(startOrder(walls, null)), [0, 1, 2, 3, 4]);
  assert.deepEqual(ranks(startOrder(walls, [NaN, undefined])), [0, 1, 2, 3, 4]);
  assert.deepEqual(startOrder([], [0, 1]), []);
  assert.deepEqual(startOrder(walls, [0.7071, 0.7071]), startOrder(walls, [0.7071, 0.7071]), 'deterministic');
});
