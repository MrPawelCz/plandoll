// Which part of the 16:9 backdrop a screen shows: the whole picture at 16:9, the middle of it on a tall or a very wide screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backdropCrop } from '../../src/look/crop.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('a 16:9 screen shows the whole backdrop', () => {
  const c = backdropCrop(16 / 9);
  assert.deepEqual(c.repeat.map((v) => +v.toFixed(9)), [1, 1]);
  assert.deepEqual(c.offset.map((v) => +v.toFixed(9)), [0, 0]);
});

test('a tall screen (a phone held upright) shows the middle of the width, so round lights stay round', () => {
  const aspect = 390 / 844, c = backdropCrop(aspect);
  close(c.repeat[0], aspect / (16 / 9)); close(c.repeat[1], 1);
  close(c.offset[0], (1 - c.repeat[0]) / 2); close(c.offset[1], 0);
  // pixels per texel are equal in both directions: screen aspect = visible texture aspect
  close((c.repeat[0] * 16) / (c.repeat[1] * 9), aspect);
});

test('a very wide screen shows the middle of the height', () => {
  const aspect = 21 / 9, c = backdropCrop(aspect);
  close(c.repeat[0], 1); close(c.repeat[1], 16 / 9 / aspect);
  close(c.offset[1], (1 - c.repeat[1]) / 2);
  close((c.repeat[0] * 16) / (c.repeat[1] * 9), aspect);
});

test('the shown window always lies inside the texture, and a missing aspect falls back to the whole picture', () => {
  for (const a of [0.3, 0.46, 0.75, 1, 1.5, 16 / 9, 2.4, 4]) {
    const c = backdropCrop(a);
    for (let i = 0; i < 2; i++) { assert.ok(c.repeat[i] > 0 && c.repeat[i] <= 1 + 1e-12); assert.ok(c.offset[i] >= -1e-12 && c.offset[i] + c.repeat[i] <= 1 + 1e-12); }
  }
  for (const bad of [0, -1, NaN, undefined, Infinity]) assert.deepEqual(backdropCrop(bad).repeat.map((v) => +v.toFixed(9)), [1, 1]);
});
