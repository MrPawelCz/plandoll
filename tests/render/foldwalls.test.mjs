// Which walls open and how: the outer walls only, the side that is outside, the hinge matrix, the box for the camera, and which wall a hung piece hangs on.
// Runs on the two example plans and twelve synthetic ones (all seven families), like plans14.test.mjs. No GL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { pointInPolygon } from '../../src/core/geom2d.js';
import { foldWalls, outwardNormal, flatFootprint, openExtent, hingeMatrix, hostWall, innerFace, FOLD_KIND } from '../../src/model/foldwalls.js';
import { generatePlan } from '../../tools/gen-plans.mjs';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }
const modelFor = (plan) => buildModel(modelOf(analyzePlan(plan)));
const models = plans.map(([name, plan]) => [name, modelFor(plan)]);

const near = (a, b, eps = 1e-9, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
// apply a column-major 4x4 to a point [x, y, z]
const mul = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const inside = (level, p) => level.rooms.some((r) => r.polygon.length >= 3 && pointInPolygon(p, r.polygon));

test('exactly the walls marked exterior open, in the order of the model, and nothing else', () => {
  assert.equal(FOLD_KIND, 'exterior');
  for (const [name, model] of models) {
    const want = [];
    model.levels.forEach((lv, li) => lv.walls.forEach((w) => { if (w.kind === 'exterior') want.push(`${li}:${w.id}`); }));
    const got = foldWalls(model);
    assert.deepEqual(got.map((f) => `${f.level}:${f.id}`), want, name);
    assert.ok(got.length >= 3, `${name} has outer walls`);
    got.forEach((f, i) => assert.equal(f.index, i));
  }
  assert.deepEqual(foldWalls(null), []); assert.deepEqual(foldWalls({ levels: [] }), []);
});

test('the outward normal is a unit vector across the wall and points away from the rooms', () => {
  let checked = 0, withRoomBehind = 0;
  for (const [name, model] of models) {
    for (const f of foldWalls(model)) {
      const lv = model.levels[f.level], [nx, ny] = f.out;
      near(Math.hypot(nx, ny), 1, 1e-9, `${name} ${f.id} unit`); near(nx * f.dir[0] + ny * f.dir[1], 0, 1e-9, `${name} ${f.id} across`);
      const w = lv.wallById.get(f.id), mid = [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2], t = w.thickness;
      const out = [mid[0] + nx * (t / 2 + 0.12), mid[1] + ny * (t / 2 + 0.12)], back = [mid[0] - nx * (t / 2 + 0.12), mid[1] - ny * (t / 2 + 0.12)];
      assert.ok(!inside(lv, out), `${name} ${f.id}: a point outside the wall is not in a room`);
      checked++; if (inside(lv, back)) withRoomBehind++;
    }
  }
  assert.ok(checked > 60, `${checked} walls checked`);
  assert.ok(withRoomBehind / checked > 0.9, `${withRoomBehind} of ${checked} outer walls have a room behind them`);
});

test('a wall with rooms on both sides or on none still gets an outward normal from the middle of the level', () => {
  const level = { rooms: [], walls: [{ from: [0, 0], to: [10, 0] }, { from: [0, 6], to: [10, 6] }] };
  const w = { from: [0, 0], to: [10, 0], dir: [1, 0], length: 10, thickness: 0.3, normal: [0, -1] };
  assert.deepEqual(outwardNormal(level, w).map(Math.abs), [0, 1]);
  const [, ny] = outwardNormal(level, w); assert.ok(ny < 0, 'the wall at y = 0 falls towards negative y, away from the wall at y = 6');
  const w2 = { from: [0, 6], to: [10, 6], dir: [1, 0], length: 10, thickness: 0.3, normal: [0, -1] };
  assert.ok(outwardNormal(level, w2)[1] > 0);
});

test('the hinge matrix: identity at zero, orthonormal, the foot line stays, the top lands outside and the inner face faces up at ninety degrees', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let walls = 0;
  for (const [name, model] of models) {
    for (const f of foldWalls(model)) {
      walls++;
      hingeMatrix(f, 0).forEach((v, i) => near(v, I[i], 1e-12, `${name} ${f.id} identity`));
      for (const deg of [30, 90, 94, 135]) {
        const m = hingeMatrix(f, deg);
        const cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) near(cols[a][0] * cols[b][0] + cols[a][1] * cols[b][1] + cols[a][2] * cols[b][2], a === b ? 1 : 0, 1e-9, `${name} ${f.id} ${deg} orthonormal`);
        const det = cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1]) - cols[1][0] * (cols[0][1] * cols[2][2] - cols[0][2] * cols[2][1]) + cols[2][0] * (cols[0][1] * cols[1][2] - cols[0][2] * cols[1][1]);
        near(det, 1, 1e-9, `${name} ${f.id} ${deg} rotation`);
        for (const p of [[f.from[0], f.y, f.from[1]], [f.to[0], f.y, f.to[1]], [f.pivot[0], f.y, f.pivot[1]]]) mul(m, p).forEach((v, i) => near(v, p[i], 1e-9, `${name} ${f.id} ${deg} foot line`));
      }
      const flat = hingeMatrix(f, 90), mid = [f.pivot[0], f.pivot[1]];
      const top = mul(flat, [mid[0], f.y + f.reach, mid[1]]);  // the top of the outer face
      near(top[0], mid[0] + f.out[0] * f.reach, 1e-9, `${name} ${f.id} top x`); near(top[1], f.y, 1e-9, `${name} ${f.id} top lies on the foot height`); near(top[2], mid[1] + f.out[1] * f.reach, 1e-9, `${name} ${f.id} top z`);
      const innerFoot = mul(flat, [mid[0] - f.out[0] * f.thickness, f.y, mid[1] - f.out[1] * f.thickness]); // the inner face at the foot
      near(innerFoot[1], f.y + f.thickness, 1e-9, `${name} ${f.id} the inner face ends up on top`);
      const past = mul(hingeMatrix(f, 94), [mid[0], f.y + f.reach, mid[1]]);
      assert.ok(past[1] < f.y - 0.1, `${name} ${f.id}: at 94 degrees the top dips below the foot height (the overshoot)`);
    }
  }
  assert.ok(walls > 60);
  assert.equal(hingeMatrix(foldWalls(models[0][1])[0], NaN).length, 16);
});

test('the open extent holds the closed one and every wall lying flat; walls the plan does not mark leave it alone', () => {
  for (const [name, model] of models) {
    const ext = modelExtent(model), walls = foldWalls(model), open = openExtent(model, ext, walls);
    for (const k of ['minX', 'minY', 'minZ']) assert.ok(open[k] <= ext[k] + 1e-12, `${name} ${k}`);
    for (const k of ['maxX', 'maxY', 'maxZ']) assert.ok(open[k] >= ext[k] - 1e-12, `${name} ${k}`);
    near(open.minY, ext.minY, 0, `${name} heights unchanged`); near(open.maxY, ext.maxY, 0, `${name} heights unchanged`);
    for (const f of walls) for (const [x, y] of flatFootprint(f)) assert.ok(x >= open.minX - 1e-9 && x <= open.maxX + 1e-9 && y >= open.minZ - 1e-9 && y <= open.maxZ + 1e-9, `${name} ${f.id} in the box`);
    assert.deepEqual(openExtent(model, ext), open, `${name} the same twice`);
    const grown = (open.maxX - open.minX) - (ext.maxX - ext.minX) + (open.maxZ - open.minZ) - (ext.maxZ - ext.minZ);
    assert.ok(grown > 1, `${name} the box grows by the walls that fall (${grown.toFixed(2)} m)`);
  }
  const bare = { levels: [{ id: 'a', walls: [], rooms: [], height: 2.6, slab: 0.2 }] }, e = { minX: 0, maxX: 4, minY: 0, maxY: 2.6, minZ: 0, maxZ: 3 };
  assert.deepEqual(openExtent(bare, e), e, 'a model without outer walls keeps its extent');
});

test('hostWall names the outer wall that a hung piece hangs on, and nothing for a point inside a room or on a partition', () => {
  const model = models[0][1], walls = foldWalls(model), lv = model.levels[0];
  let hung = 0;
  for (const f of walls) {
    const probe = [f.pivot[0] - f.out[0] * (f.thickness - 0.08), f.pivot[1] - f.out[1] * (f.thickness - 0.08)]; // just behind a picture on the inner face
    assert.equal(hostWall(walls, f.levelId, probe[0], probe[1]), f.index, `${f.id}`); hung++;
    const room = [f.pivot[0] - f.out[0] * 1.2, f.pivot[1] - f.out[1] * 1.2];
    if (inside(lv, room)) assert.equal(hostWall(walls, f.levelId, room[0], room[1]), -1, `${f.id} 1.2 m into the room`);
  }
  assert.ok(hung >= 3);
  assert.equal(hostWall(walls, 'no-such-level', 1, 1), -1); assert.equal(hostWall([], 'a', 0, 0), -1);
});

test('innerFace is the vertical plane of the face that looks into the rooms: one wall thickness inside the outer face line, normal pointing out, in every plan', () => {
  let n = 0;
  for (const [name, model] of models) for (const f of foldWalls(model)) {
    const face = innerFace(f);
    assert.equal(face.point[1], 0, `${name} ${f.id}: only the plan matters`); assert.equal(face.normal[1], 0);
    near(Math.hypot(...face.normal), 1, 1e-9, `${name} ${f.id} unit normal`);
    assert.deepEqual([face.normal[0], face.normal[2]], f.out);
    // the outer face line is f.from to f.to; the inner face is one thickness behind it
    near((face.point[0] - f.from[0]) * f.out[0] + (face.point[2] - f.from[1]) * f.out[1], -f.thickness, 1e-9, `${name} ${f.id} one thickness inside`);
    near((face.point[0] - f.from[0]) * f.dir[0] + (face.point[2] - f.from[1]) * f.dir[1], 0, 1e-9, `${name} ${f.id} straight behind the end of the face`);
    // the middle of the wall is between the two faces, and a point in a room next to the wall is on the inner side
    const mid = [(f.from[0] + f.to[0]) / 2 - f.out[0] * f.thickness / 2, (f.from[1] + f.to[1]) / 2 - f.out[1] * f.thickness / 2];
    near((mid[0] - face.point[0]) * face.normal[0] + (mid[1] - face.point[2]) * face.normal[2], f.thickness / 2, 1e-9, `${name} ${f.id} the middle line of the wall`);
    n++;
  }
  assert.ok(n >= 40, `${n} walls`);
});
