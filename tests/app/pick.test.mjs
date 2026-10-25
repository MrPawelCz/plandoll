// Picking with a ray: oriented boxes, nearest hit, hung and stacked pieces, a second storey, hostile input, speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPiece, floorHit, rayInFrame, planeHit, slidePoint } from '../../src/app/pick.js';
import { hingeMatrix, innerFace } from '../../src/model/foldwalls.js';

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

// ---- pieces on a wall that has turned (the open shell): the ray is taken back through the matrix of the wall ----
// A wall along plan x at z = 0 with the rooms on the +z side; its outer face foot line is z = 0 and it falls towards -z. A turn of 90 degrees takes the world
// point (x, y, z) to (x, z, -y): a picture 1.65 m up the wall lies on the ground, 1.65 m outside the wall.
const fall = { dir: [1, 0], out: [0, -1], pivot: [0, 0], y: 0 };
const flat = hingeMatrix(fall, 90), noTurn = hingeMatrix(fall, 0);
const pic = () => piece('pic', 2, 0.03, 0, [0.6, 0.04, 0.5], 1.4); // faces +z, hangs 1.4 to 1.9 m up
const lyingDown = { origin: [2, 5, -1.65], direction: [0, -1, 0] }; // from above, at the picture where it lies
const closedPlace = { origin: [2, 1.65, 5], direction: [0, 0, -1] }; // from the room, at the picture where it hung

test('rayInFrame takes a ray back through a turn and a shift; the identity leaves it, a bad matrix or ray gives null', () => {
  const same = rayInFrame(lyingDown, noTurn);
  for (let i = 0; i < 3; i++) { assert.ok(Math.abs(same.origin[i] - lyingDown.origin[i]) < 1e-12); assert.ok(Math.abs(same.direction[i] - lyingDown.direction[i]) < 1e-12); }
  const back = rayInFrame(lyingDown, flat);
  [2, 1.65, 5].forEach((v, i) => assert.ok(Math.abs(back.origin[i] - v) < 1e-9, `origin ${i}: ${back.origin[i]}`));
  [0, 0, -1].forEach((v, i) => assert.ok(Math.abs(back.direction[i] - v) < 1e-9, `direction ${i}: ${back.direction[i]}`));
  assert.ok(Math.abs(Math.hypot(...back.direction) - 1) < 1e-12, 'a turn keeps lengths');
  const shifted = rayInFrame({ origin: [1, 2, 3], direction: [0, 0, 1] }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
  assert.deepEqual(shifted.origin, [-9, -18, -27]); assert.deepEqual(shifted.direction, [0, 0, 1], 'a shift moves the origin and not the direction');
  for (const m of [null, undefined, [], [1, 2, 3], new Array(16).fill(NaN), 'x', { length: 16 }]) assert.equal(rayInFrame(lyingDown, m), null);
  for (const ray of [null, {}, { origin: [0, 0, 0], direction: [0, 0, 0] }, { origin: [NaN, 0, 0], direction: [0, 1, 0] }]) assert.equal(rayInFrame(ray, flat), null);
});

test('planeHit meets a plane in front of the ray and refuses a parallel plane, a plane behind and bad input', () => {
  assert.deepEqual(planeHit({ origin: [1, 5, 1], direction: [0, -1, 0] }, [0, 0, 0], [0, 1, 0]), [1, 0, 1]);
  assert.deepEqual(planeHit({ origin: [0, 1, 0], direction: [1, 0, 0] }, [3, 0, 0], [1, 0, 0]), [3, 1, 0]);
  assert.deepEqual(planeHit({ origin: [0, 1, 0], dir: [1, 0, 0] }, [3, 0, 0], [5, 0, 0]), [3, 1, 0], 'a normal that is not a unit vector');
  assert.equal(planeHit({ origin: [0, 1, 0], direction: [1, 0, 0] }, [0, 0, 0], [0, 1, 0]), null, 'parallel');
  assert.equal(planeHit({ origin: [0, 1, 0], direction: [-1, 0, 0] }, [3, 0, 0], [1, 0, 0]), null, 'behind');
  for (const [r, p, n] of [[null, [0, 0, 0], [0, 1, 0]], [{ origin: [0, 1, 0], direction: [0, -1, 0] }, null, [0, 1, 0]], [{ origin: [0, 1, 0], direction: [0, -1, 0] }, [0, 0, 0], [0, 0, 0]], [{ origin: [0, 1, 0], direction: [0, -1, 0] }, [NaN, 0, 0], [0, 1, 0]]]) assert.equal(planeHit(r, p, n), null);
});

test('a piece on a turned wall is found where the wall has put it, not where it hung', () => {
  const l = layout(pic()), frameOf = () => flat;
  const hit = pickPiece(l, lyingDown, { frameOf, pad: 0 });
  assert.equal(hit?.id, 'pic'); assert.equal(hit.level, 'L0');
  assert.ok(Math.abs(hit.t - 4.95) < 1e-9, `enters the front face of the lying box: ${hit.t}`);
  [2, 0.05, -1.65].forEach((v, i) => assert.ok(Math.abs(hit.point[i] - v) < 1e-9, `point ${i} is a point of the original ray: ${hit.point[i]}`));
  assert.equal(pickPiece(l, lyingDown, { pad: 0 }), null, 'without the matrix the ground there is empty');
  assert.equal(pickPiece(l, closedPlace, { frameOf, pad: 0 }), null, 'with it the place where the picture hung is empty');
  assert.equal(pickPiece(l, closedPlace, { pad: 0 })?.id, 'pic', 'and the closed layout alone still answers there');
  assert.equal(pickPiece(l, { origin: [2, 5, -2.5], direction: [0, -1, 0] }, { frameOf, pad: 0 }), null, 'beside the picture');
  assert.equal(pickPiece(l, { origin: [2, 5, -1.65], direction: [0, -1, 0] }, { frameOf: () => noTurn, pad: 0 }), null, 'a wall that has not turned puts nothing on the ground');
  assert.equal(pickPiece(l, closedPlace, { frameOf: () => noTurn, pad: 0 })?.id, 'pic', 'and at clock zero the picture is where it hung');
});

test('pieces with no matrix keep their place, the nearest of the pieces in either frame wins, and skip and a bad matrix leave a piece out', () => {
  const box = piece('box', 2, -1.65, 0, [1, 1, 1]); // a floor piece standing where the picture lies
  const l = layout(pic(), box);
  const frameOf = (id) => (id === 'pic' ? flat : null);
  assert.equal(pickPiece(l, lyingDown, { frameOf, pad: 0 })?.id, 'box', 'the box is nearer to the camera than the lying picture');
  assert.equal(pickPiece(l, lyingDown, { frameOf, pad: 0, skip: (id) => id === 'box' })?.id, 'pic');
  assert.equal(pickPiece(l, lyingDown, { frameOf, pad: 0, skip: (id) => id === 'box' || id === 'pic' }), null);
  for (const m of [() => undefined, () => null]) assert.equal(pickPiece(layout(pic()), closedPlace, { frameOf: m, pad: 0 })?.id, 'pic', 'null or undefined means "where the layout puts it"');
  for (const m of [[1, 2, 3], new Array(16).fill(Infinity), 'flat']) assert.equal(pickPiece(layout(pic()), closedPlace, { frameOf: () => m, pad: 0 }), null, 'a matrix that is not valid leaves the piece out');
  assert.equal(pickPiece(l, down(2, -1.65, 9), { pad: 0 })?.id, 'box', 'no frameOf at all is the old behaviour');
  let calls = 0;
  const many = layout(...Array.from({ length: 50 }, (_, i) => piece('w' + i, i, 0.03, 0, [0.6, 0.04, 0.5], 1.4)));
  pickPiece(many, lyingDown, { frameOf: () => { calls++; return flat; }, pad: 0 });
  assert.equal(calls, 50, 'asked once for every piece');
});

test('the pieces of one wall share one turned ray, and the pad of a fingertip works in the closed frame', () => {
  const l = layout(pic());
  const near = { origin: [2.33, 5, -1.65], direction: [0, -1, 0] }; // 3 cm beside the lying picture (0.3 m half width)
  assert.equal(pickPiece(l, near, { frameOf: () => flat, pad: 0 }), null);
  assert.equal(pickPiece(l, near, { frameOf: () => flat, pad: 0.06 })?.id, 'pic', 'a fingertip margin still hits it');
});

// ---- dragging: where the finger is on the surface the piece slides over ----
const mulPoint = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const unit = (v) => { const n = Math.hypot(...v); return v.map((c) => c / n); };

test('slidePoint: the floor plane at the height of the piece when no wall holds it, null when the ray misses it', () => {
  assert.deepEqual(slidePoint({ origin: [1, 5, 2], direction: [0, -1, 0] }, null, 0.4).map((v) => +v.toFixed(9)), [1, 2]);
  assert.deepEqual(slidePoint({ origin: [0, 5, 0], direction: [1, -1, 0] }, undefined, 3).map((v) => +v.toFixed(9)), [2, 0]);
  assert.equal(slidePoint({ origin: [0, 1, 0], direction: [1, 0, 0] }, null, 0), null, 'parallel to the floor');
  assert.equal(slidePoint({ origin: [0, 1, 0], direction: [0, 1, 0] }, null, 0), null, 'the floor is behind');
  assert.equal(slidePoint(null, null, 0), null);
});

test('slidePoint on a wall that has turned: the finger gives the place on the wall that it points at, along the wall, at any angle of the wall', () => {
  const face = innerFace({ from: [0, 0], out: [0, -1], thickness: 0.15 }); // the wall of the tests above: rooms on +z, the inner face at z = 0.15
  assert.deepEqual(face, { point: [0, 0, 0.15], normal: [0, 0, -1] });
  for (const deg of [0, 20, 45, 70, 90, 94]) {
    const m = hingeMatrix(fall, deg), host = { matrix: m, plane: face };
    for (const [x, up] of [[0.5, 0.3], [2, 1.65], [3.4, 2.4]]) {
      const p = mulPoint(m, [x, up, 0.15]); // the point of the inner face, x along the wall and `up` high in the closed place, as the turned wall carries it
      for (const lean of [[0.7, 4, 0.5], [-1.2, 3, 0.2], [0.1, 5, -1]]) {
        const ray = { origin: [p[0] + lean[0], p[1] + lean[1], p[2] + lean[2]], direction: unit(lean.map((c) => -c)) };
        const at = slidePoint(ray, host, 0);
        assert.ok(at && Math.abs(at[0] - x) < 1e-9 && Math.abs(at[1] - 0.15) < 1e-9, `${deg} degrees, x ${x}, up ${up}: ${at}`);
      }
    }
  }
  // moving the finger across the lying wall changes nothing in the plan (the piece stays on its wall); moving it along the wall changes the place by the same amount
  const host = { matrix: flat, plane: face }, down = (x, z) => ({ origin: [x, 6, z], direction: [0, -1, 0] });
  assert.deepEqual(slidePoint(down(2, -1.65), host, 0).map((v) => +v.toFixed(9)), [2, 0.15]);
  assert.deepEqual(slidePoint(down(2, -1.2), host, 0).map((v) => +v.toFixed(9)), [2, 0.15], 'across the lying wall');
  assert.deepEqual(slidePoint(down(2.8, -1.65), host, 0).map((v) => +v.toFixed(9)), [2.8, 0.15], 'along it');
  assert.deepEqual(slidePoint(down(2, -1.65), host, 12).map((v) => +v.toFixed(9)), [2, 0.15], 'the height of the foot of the piece is not used for a wall');
});

test('slidePoint with a wall that cannot be used gives null instead of a wrong place', () => {
  const face = innerFace({ from: [0, 0], out: [0, -1], thickness: 0.15 }), ray = { origin: [2, 6, -1.65], direction: [0, -1, 0] };
  assert.equal(slidePoint(ray, { matrix: [1, 2, 3], plane: face }, 0), null, 'a matrix that is not valid');
  assert.equal(slidePoint(ray, { matrix: flat }, 0), null, 'no plane');
  assert.equal(slidePoint(ray, { matrix: flat, plane: { point: [0, 0, NaN], normal: [0, 0, -1] } }, 0), null);
  assert.equal(slidePoint({ origin: [2, 0, -1.65], direction: [0, 0, 1] }, { matrix: flat, plane: face }, 0), null, 'a ray that meets the closed plane only behind the camera');
});
