// The share of the window height that the bars at the bottom cover (stack.js), from their boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverShare, isNarrow, COVER_GAP, NARROW_WIDTH } from '../../src/app/stack.js';
import { BOTTOM_MAX } from '../../src/app/camera.js';

const box = (top, height = 50, width = 300) => ({ top, height, width });

test('coverShare: the highest bar in the lower part decides, with a small gap added', () => {
  assert.ok(Math.abs(coverShare([box(700)], 844) - (844 - 700 + COVER_GAP) / 844) < 1e-9);
  assert.ok(Math.abs(coverShare([box(780), box(700), box(740)], 844) - (844 - 700 + COVER_GAP) / 844) < 1e-9);
});

test('coverShare: nothing, empty boxes and boxes in the upper part cover nothing', () => {
  assert.equal(coverShare([], 844), 0);
  assert.equal(coverShare(undefined, 844), 0);
  assert.equal(coverShare([null, undefined], 844), 0);
  assert.equal(coverShare([box(700, 0), box(700, 50, 0)], 844), 0);
  assert.equal(coverShare([box(100)], 844), 0, 'a bar at the top of the window is not a bottom bar');
  assert.equal(coverShare([box(844)], 844), 0, 'a box that starts at the window edge covers nothing');
});

test('coverShare: the cover is capped, and bad numbers give zero', () => {
  assert.equal(coverShare([box(300)], 844), BOTTOM_MAX);
  assert.equal(coverShare([box(700)], 0), 0);
  assert.equal(coverShare([box(700)], NaN), 0);
  assert.equal(coverShare([box(NaN)], 844), 0);
  assert.equal(coverShare([box(Infinity)], 844), 0);
  assert.equal(coverShare([box(700)], 'x'), 0);
});

test('coverShare: the edit bar above the controls makes the larger cover', () => {
  const controls = box(760), edit = box(690);
  assert.ok(coverShare([controls, edit], 844) > coverShare([controls], 844));
  assert.equal(coverShare([controls, edit], 844), coverShare([edit, controls], 844));
});

test('isNarrow: phones and narrow windows only, bad widths never', () => {
  assert.equal(NARROW_WIDTH, 760);
  for (const w of [320, 390, 430, 760]) assert.equal(isNarrow(w), true, `${w}`);
  for (const w of [761, 900, 1100, 1920, 0, -1, NaN, Infinity, undefined, null, '390']) assert.equal(isNarrow(w), false, `${w}`);
});
