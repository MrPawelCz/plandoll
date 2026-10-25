// Hostile but valid plans never hang or break the scene builders: PlanScene and composeLayout (on an automatic layout) finish in under two
// seconds in Node, throw nothing, produce finite vertex positions and stay inside mesh and vertex limits. Plans the validator rejects are
// skipped here (the validator tests cover them); the cases listed in MUST_PASS have to be accepted, so the checks cannot go quiet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish, LIMITS } from '../../src/layout/index.js';
import { PlanScene } from '../../src/render/scene.js';
import { composeLayout, disposeComposed } from '../../src/render/compose.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const MAX_MS = 2000;
const NAMES = ['Salon', 'Bedroom', 'Kuchnia', 'Łazienka', 'Hall', 'Gabinet', 'xyz', 'Kids', 'WC', 'Jadalnia'];
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const wallsOf = (poly, p, extra = {}) => poly.map((a, i) => ({ id: `${p}w${i}`, from: a, to: poly[(i + 1) % poly.length], kind: 'interior', ...extra }));

// rooms: [{ polygon, name?, window?, thickness? }] -> one level
function levelOf(id, elevation, rooms, extra = {}) {
  const walls = [], openings = [], rs = [];
  rooms.forEach((r, i) => {
    walls.push(...wallsOf(r.polygon, `${id}r${i}`, r.thickness ? { thickness: r.thickness } : {}));
    rs.push({ id: `${id}room${i}`, name: r.name ?? NAMES[i % NAMES.length], polygon: r.polygon, use: 'other' });
    if (r.door !== false) openings.push({ id: `${id}d${i}`, wall: `${id}r${i}w0`, type: 'door', offset: 0.05, width: r.doorWidth ?? 0.8 });
    if (r.window) openings.push({ id: `${id}win${i}`, wall: `${id}r${i}w2`, type: 'window', offset: 0.1, width: r.windowWidth ?? 1.0 });
  });
  return { id, name: id, height: 2.7, elevation, walls, openings, rooms: rs, ...extra };
}
const planOf = (levels) => ({ version: 1, name: 'hostile', units: 'm', meta: { source: 'synthetic' }, levels });
const grid = (n, cols, size = 4, gap = 0.2) => Array.from({ length: n }, (_, i) => ({ polygon: rect((i % cols) * (size + gap), Math.floor(i / cols) * (size + gap), size, size), window: i % 2 === 0 }));

function ring(points, radius) {
  return Array.from({ length: points }, (_, i) => [Math.round(radius * Math.cos((2 * Math.PI * i) / points) * 1000) / 1000, Math.round(radius * Math.sin((2 * Math.PI * i) / points) * 1000) / 1000]);
}

const CASES = [
  ['200 rooms on two levels', () => planOf([levelOf('L0', 0, grid(100, 10)), levelOf('L1', 3, grid(100, 10))]), true],
  ['150 rooms on one level', () => planOf([levelOf('L0', 0, grid(150, 15))]), false],
  ['twelve levels of 40 rooms', () => planOf(Array.from({ length: 12 }, (_, k) => levelOf(`L${k}`, k * 3, grid(40, 8)))), false],
  ['rooms at the smallest area the validator accepts (0.5 square metres) next to a living room', () => planOf([levelOf('L0', 0, [{ polygon: rect(0, 0, 1, 0.5), name: 'WC', doorWidth: 0.3 }, { polygon: rect(1.5, 0, 0.5, 1), name: 'Kuchnia', door: false }, { polygon: rect(2.5, 0, 0.8, 0.7), door: false, thickness: 0.05 }, { polygon: rect(4, 0, 4, 4), name: 'Salon', window: true }])]), true],
  ['a room polygon with 120 points', () => planOf([levelOf('L0', 0, [{ polygon: ring(120, 5), name: 'Salon', door: false }])]), true],
  ['600 walls in one room', () => {
    const lv = levelOf('L0', 0, [{ polygon: rect(0, 0, 30, 30), name: 'Hall' }]);
    for (let i = lv.walls.length; i < 600; i++) { const x = 1 + (i % 25), y = 1 + Math.floor(i / 25) % 24; lv.walls.push({ id: `x${i}`, from: [x, y], to: [x + 0.4, y + 0.1], kind: 'partition' }); }
    return planOf([lv]);
  }, true],
  ['a 150 m hall with 3 m thick walls and a 30 m window, next to a 100 m long sliver 0.6 m wide', () => planOf([levelOf('L0', 0, [
    { polygon: rect(-75, -75, 150, 150), name: 'Hall', window: true, windowWidth: 30, thickness: 3, doorWidth: 2 },
    { polygon: rect(-50, 80, 100, 0.6), name: 'Hall', doorWidth: 0.5 },
  ])]), true],
  ['a 40 m high level above a 12 m high one', () => planOf([
    levelOf('L0', 0, [{ polygon: rect(0, 0, 5, 4), window: true, windowWidth: 3 }], { height: 12 }),
    levelOf('L1', 12, [{ polygon: rect(0, 0, 5, 4), window: true, windowWidth: 4.9 }], { height: 40 }),
  ]), true],
];
const MUST_PASS = CASES.filter((c) => c[2]).map((c) => c[0]);

const stats = (root) => {
  let meshes = 0, vertices = 0, bad = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    vertices += pos.count;
    const a = pos.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad++; break; }
  });
  return { meshes, vertices, bad };
};

// Limits for the whole set (the biggest plan above stays at about half the mesh limit and a quarter to a third of the vertex limit).
const LIMIT_SCENE = { meshes: 20000, vertices: 1000000 };
const LIMIT_FURNISHING = { meshes: 10000, vertices: 3000000 };

for (const [name, make, must] of CASES) {
  test(`hostile plan "${name}": scene and furnishing build fast, finite and bounded`, () => {
    const res = analyzePlan(make());
    if (!res.ok) {
      assert.ok(!MUST_PASS.includes(name), `unexpectedly rejected: ${JSON.stringify(res.errors?.slice(0, 2))}`);
      return;
    }
    const model = buildModel(modelOf(res));
    const t0 = performance.now();
    const ps = new PlanScene(model, 'textured');
    const sceneMs = performance.now() - t0;
    const s = stats(ps.group);
    if (process.env.HOSTILE_VERBOSE) console.log(`${name}: scene ${sceneMs.toFixed(0)} ms, ${s.meshes} meshes, ${s.vertices} vertices`);
    assert.ok(sceneMs < MAX_MS, `scene ${sceneMs.toFixed(0)} ms`);
    assert.equal(s.bad, 0, 'non-finite vertex positions in the scene');
    assert.ok(s.meshes <= LIMIT_SCENE.meshes, `${s.meshes} meshes`);
    assert.ok(s.vertices <= LIMIT_SCENE.vertices, `${s.vertices} vertices`);

    const layout = autoFurnish(model, { seed: 5 });
    const t1 = performance.now();
    const composed = composeLayout({ model, layout, quality: 'low', look: 'textured', seed: 1 });
    const furnishMs = performance.now() - t1;
    const f = stats(composed.group);
    if (process.env.HOSTILE_VERBOSE) console.log(`${name}: furnishing ${furnishMs.toFixed(0)} ms, ${composed.pieces.size} pieces, ${f.meshes} meshes, ${f.vertices} vertices`);
    assert.ok(furnishMs < MAX_MS, `furnishing ${furnishMs.toFixed(0)} ms`);
    assert.ok(composed.pieces.size <= LIMITS.total, `${composed.pieces.size} pieces`);
    assert.equal(f.bad, 0, 'non-finite vertex positions in the furnishing');
    assert.ok(f.meshes <= LIMIT_FURNISHING.meshes, `${f.meshes} meshes`);
    assert.ok(f.vertices <= LIMIT_FURNISHING.vertices, `${f.vertices} vertices`);
    for (const e of composed.emitters) assert.ok(e.pos.every(Number.isFinite), 'emitter position');
    disposeComposed(composed.group);
    ps.dispose();
  });
}

test('a room of 0.2 square metres never reaches the scene builders: the validator rejects it (E008)', () => {
  const res = analyzePlan(planOf([levelOf('L0', 0, [{ polygon: rect(0, 0, 0.5, 0.4), doorWidth: 0.2 }, { polygon: rect(4, 0, 4, 4), window: true }])]));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.code === 'E008'), JSON.stringify(res.errors.map((e) => e.code)));
});

test('the cases that must pass the validator are all in the list', () => {
  assert.deepEqual(MUST_PASS.length, CASES.filter((c) => c[2]).length);
  assert.ok(MUST_PASS.length >= 4);
});
