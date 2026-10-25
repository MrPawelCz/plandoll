// Picking with a ray: oriented boxes, nearest hit, hung and stacked pieces, a second storey, hostile input, speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPiece, floorHit } from '../../src/app/pick.js';

const piece = (id, x, y, rot, size, elev = 0) => ({ id, type: 'x', room: 'r', x, y, rot, size, elev, on: null, colors: {} });
const layout = (...pieces) => ({ version: 1, seed: 1, levels: [{ id: 'L0', pieces }, { id: 'L1', pieces: [] }] });
const down = (x, z, y = 5) => ({ origin: [x, y, z], direction: [0, -1, 0] }); // straight down from above a plan point

test('floorHit meets a horizontal plane in front of the camera and refuses the rest', () => {
  assert.deepEqual(floorHit({ origin: [1, 4, 2], direction: [0, -1, 0] }, 0), [1, 0, 2]);
  assert.deepEqual(floorHit({ origin: [0, 4, 0], dir: [1, -1, 0] }, 2), [2, 2, 0]);
  assert.equal(floorHit({ origin: [0, 4, 0], direction: [1, 0, 0] }, 0), null, 'parallel');
  assert.equal(floorHit({ origin: [0, 4, 0], direction: [0, 1, 0] }, 0), null, 'behind the camera');
  assert.equal(floorHit({ origin: [0, 4, 0], direction: [NaN, -1, 0] }, 0), null);
  assert.equal(floorHit(null, 0), null);
});

test('a ray hits a piece and misses the empty floor', () => {
  const l = layout(piece('a', 2, 3, 0, [1, 1, 0.5]));
  const hit = pickPiece(l, down(2.2, 3.1), { pad: 0 });
  assert.equal(hit.id, 'a'); assert.equal(hit.level, 'L0');
  assert.ok(Math.abs(hit.t - 4.5) < 1e-9, 'enters at the top face');
  assert.ok(Math.abs(hit.point[1] - 0.5) < 1e-9);
  assert.equal(pickPiece(l, down(2.51, 3), { pad: 0 }), null, 'just outside the side');
  assert.equal(pickPiece(l, down(2.51, 3))?.id, 'a', 'the default margin of 2 cm still hits');
  assert.equal(pickPiece(l, down(5, 5)), null);
});

test('the nearest of two pieces wins, in either order of the list', () => {
  const ray = { origin: [0, 1, 0], direction: [1, 0, 0] };
  const near = piece('near', 2, 0, 0, [1, 1, 1]), far = piece('far', 5, 0, 0, [1, 1, 1]);
  assert.equal(pickPiece(layout(near, far), ray).id, 'near');
  assert.equal(pickPiece(layout(far, near), ray).id, 'near');
});

test('a turned piece is hit only where its box is', () => {
  const l = layout(piece('s', 0, 0, 90, [2, 0.5, 0.5])); // 90 degrees: the long side runs along the plan y axis
  assert.equal(pickPiece(l, down(0, 0.8))?.id, 's');
  assert.equal(pickPiece(l, down(0.8, 0)), null);
  const d = layout(piece('d', 0, 0, 45, [2, 0.2, 0.5]));
  assert.equal(pickPiece(d, down(0.6, 0.6))?.id, 'd', 'along the diagonal');
  assert.equal(pickPiece(d, down(0.6, -0.6)), null, 'across the diagonal');
});

test('a hung piece is hit at its height and not below it', () => {
  const l = layout(piece('pic', 1, 1, 0, [0.6, 0.04, 0.5], 1.4));
  assert.equal(pickPiece(l, { origin: [1, 1.6, 4], direction: [0, 0, -1] })?.id, 'pic');
  assert.equal(pickPiece(l, { origin: [1, 0.6, 4], direction: [0, 0, -1] }), null);
});

test('the second storey of a duplex uses its own floor height, and hidden pieces are skipped', () => {
  const l = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [] }, { id: 'L1', pieces: [piece('up', 1, 1, 0, [1, 1, 1])] }] };
  const base = (id) => (id === 'L1' ? 3 : 0);
  assert.equal(pickPiece(l, { origin: [1, 3.5, 1], direction: [1, 0, 0] }, { levelBase: base })?.id, 'up', 'at the raised floor');
  assert.equal(pickPiece(l, { origin: [-3, 0.5, 1], direction: [1, 0, 0] }, { levelBase: base }), null, 'level 0 height misses it');
  assert.equal(pickPiece(l, down(1, 1, 9), { levelBase: base, skip: (id) => id === 'up' }), null);
});

test('a piece standing on another is hit first from above', () => {
  const l = layout(piece('table', 2, 2, 0, [1.6, 0.9, 0.75]), piece('vase', 2, 2, 0, [0.15, 0.15, 0.3], 0.75));
  assert.equal(pickPiece(l, down(2, 2))?.id, 'vase');
  assert.equal(pickPiece(l, down(2.5, 2))?.id, 'table');
});

test('a ray parallel to a slab, or starting inside a box, is handled', () => {
  const l = layout(piece('a', 0, 0, 0, [2, 2, 2]));
  assert.equal(pickPiece(l, { origin: [-5, 1, 0], direction: [1, 0, 0] })?.id, 'a');
  assert.equal(pickPiece(l, { origin: [-5, 3, 0], direction: [1, 0, 0] }), null, 'parallel and above');
  assert.equal(pickPiece(l, { origin: [0, 1, 0], direction: [1, 0, 0] })?.t, 0, 'inside');
});

test('hostile input gives null and never throws', () => {
  const l = layout(piece('a', 2, 2, 0, [1, 1, 1]));
  for (const ray of [null, undefined, {}, { origin: [NaN, 0, 0], direction: [0, -1, 0] }, { origin: [0, 5, 0], direction: [0, 0, 0] }, { origin: [0, 5], direction: [0, -1, 0] }, { origin: 'a', direction: 'b' }]) {
    assert.equal(pickPiece(l, ray), null);
  }
  const bad = { levels: [null, { pieces: null }, { id: 'L', pieces: [null, { id: 'z', x: NaN, y: 0, rot: 0, elev: 0, size: [1, 1, 1] }, { id: 'y', x: 0, y: 0, rot: 0, elev: 0, size: [1, 1] }, piece('ok', 0, 0, 0, [1, 1, 1])] }] };
  assert.equal(pickPiece(bad, down(0, 0))?.id, 'ok');
  assert.equal(pickPiece(null, down(0, 0)), null);
  assert.equal(pickPiece({}, down(0, 0)), null);
  assert.equal(pickPiece(l, down(2, 2), { levelBase: () => NaN })?.id, 'a', 'a broken base falls back to 0');
});

test('5000 pieces are searched in well under 100 ms', () => {
  const ps = [];
  for (let i = 0; i < 5000; i++) ps.push(piece('p' + i, (i % 100) * 1.2, Math.floor(i / 100) * 1.2, (i * 37) % 360, [0.8, 0.5, 0.7]));
  const l = layout(...ps);
  const t0 = performance.now();
  let hits = 0;
  for (let k = 0; k < 4; k++) if (pickPiece(l, down(10 * 1.2, 10 * 1.2 + k * 0.01))) hits++;
  const ms = (performance.now() - t0) / 4;
  assert.ok(hits >= 1);
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});
