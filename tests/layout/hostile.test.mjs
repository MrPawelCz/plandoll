// Hostile plans never hang the layout engine (under two seconds) and never throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish, checkLayout, LIMITS } from '../../src/layout/index.js';

const wallsOf = (poly, p) => poly.map((a, i) => ({ id: `${p}w${i}`, from: a, to: poly[(i + 1) % poly.length], kind: 'interior' }));
function planOf(rooms, extra = {}) {
  const walls = [], openings = [], rs = [];
  rooms.forEach((r, i) => {
    walls.push(...wallsOf(r.polygon, `r${i}`));
    rs.push({ id: `room${i}`, name: r.name ?? `Room ${i}`, polygon: r.polygon, use: r.use ?? 'other' });
    if (r.door !== false) openings.push({ id: `d${i}`, wall: `r${i}w0`, type: 'door', offset: r.doorOffset ?? 0.1, width: r.doorWidth ?? 0.8 });
    if (r.window) openings.push({ id: `win${i}`, wall: `r${i}w2`, type: 'window', offset: 0.2, width: 1.0 });
  });
  return { version: 1, name: 'hostile', units: 'm', meta: { source: 'synthetic' }, levels: [{ id: 'L0', name: 'Flat', height: 2.7, walls, openings, rooms: rs, ...extra }] };
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function run(plan, { expectValid = true } = {}) {
  const res = analyzePlan(plan);
  if (!res.ok) {
    if (process.env.HOSTILE_VERBOSE) console.log('rejected by the validator:', res.errors?.[0]?.code, String(res.errors?.[0]?.message).slice(0, 110));
    assert.ok(!expectValid, `unexpectedly rejected: ${JSON.stringify(res.errors?.slice(0, 2))}`);
    return null;
  }
  if (process.env.HOSTILE_VERBOSE) console.log('accepted by the validator, engine ran');
  const model = buildModel(modelOf(res));
  const t0 = performance.now();
  const lay = autoFurnish(model, { seed: 5 });
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  const total = lay.levels.reduce((n, l) => n + l.pieces.length, 0);
  assert.ok(total <= LIMITS.total);
  for (const l of lay.levels) assert.ok(l.pieces.length <= LIMITS.perLevel);
  const bad = checkLayout(model, lay).filter((v) => v.kind !== 'missing-set');
  assert.deepEqual(bad, [], JSON.stringify(bad.slice(0, 3)));
  return { model, lay, ms };
}

test('200 rooms: within the time and piece limits', () => {
  const rooms = [];
  for (let i = 0; i < 200; i++) rooms.push({ polygon: rect((i % 20) * 4.2, Math.floor(i / 20) * 4.2, 4, 4), name: ['Salon', 'Bedroom', 'Kuchnia', 'Łazienka', 'Hall', 'Gabinet', 'xyz', 'Kids', 'WC', 'Jadalnia'][i % 10], window: i % 2 === 0 });
  const plan = planOf(rooms);
  // the validator caps rooms at 150 and walls at 600 per level: it may reject the plan, which is also fine
  const res = analyzePlan(plan);
  if (!res.ok) return assert.ok(res.errors.length > 0);
  run(plan);
});

test('200 rooms on two levels (100 each) pass the validator and are furnished within the limits', () => {
  const names = ['Salon', 'Bedroom', 'Kuchnia', 'Łazienka', 'Hall', 'Gabinet', 'xyz', 'Kids', 'WC', 'Jadalnia'];
  const level = (id, elevation) => {
    const rooms = [];
    for (let i = 0; i < 100; i++) rooms.push({ polygon: rect((i % 10) * 4.2, Math.floor(i / 10) * 4.2, 4, 4), name: names[i % 10], window: i % 2 === 0 });
    const lv = planOf(rooms).levels[0];
    return { ...lv, id, name: id, elevation };
  };
  const plan = { version: 1, name: 'hostile', units: 'm', meta: { source: 'synthetic' }, levels: [level('L0', 0), level('L1', 3)] };
  const r = run(plan, { expectValid: true });
  assert.equal(r.model.levels.reduce((n, l) => n + l.rooms.length, 0), 200);
  assert.ok(r.lay.levels.reduce((n, l) => n + l.pieces.length, 0) > 200);
});

test('150 rooms (the validator cap) are furnished within the limits', () => {
  const rooms = [];
  for (let i = 0; i < 150; i++) rooms.push({ polygon: rect((i % 15) * 4.2, Math.floor(i / 15) * 4.2, 4, 4), name: ['Salon', 'Bedroom', 'Kuchnia', 'Łazienka', 'Hall', 'Gabinet', 'xyz', 'Kids', 'WC', 'Jadalnia'][i % 10], window: i % 2 === 0 });
  const plan = planOf(rooms);
  const res = analyzePlan(plan);
  if (!res.ok) return assert.ok(res.errors.length > 0); // 600 walls is the cap: exactly 600 here
  const r = run(plan);
  assert.ok(r.lay.levels[0].pieces.length > 100);
});

test('a room of 0.2 square metres gets nothing and nothing breaks', () => {
  const plan = planOf([{ polygon: rect(0, 0, 0.5, 0.4), name: 'Salon', door: false }, { polygon: rect(1, 0, 4, 3), name: 'Salon' }]);
  const r = run(plan, { expectValid: false });
  if (r) assert.equal(r.lay.levels[0].pieces.filter((p) => p.room === 'room0').length, 0);
});

test('a self crossing polygon is rejected or ignored', () => {
  const bow = [[0, 0], [4, 3], [4, 0], [0, 3]];
  const plan = planOf([{ polygon: bow, name: 'Salon', door: false }, { polygon: rect(5, 0, 4, 3), name: 'Bedroom' }]);
  const r = run(plan, { expectValid: false });
  if (r) assert.equal(r.lay.levels[0].pieces.filter((p) => p.room === 'room0').length, 0);
});

// The validator refuses these two plans, so the engine is also fed the broken rooms directly (a model edited after validation).
function mutated(change) {
  const res = analyzePlan(planOf([{ polygon: rect(0, 0, 4, 3), name: 'Salon', window: true }, { polygon: rect(5, 0, 4, 3), name: 'Bedroom', window: true }]));
  assert.ok(res.ok);
  const model = buildModel(modelOf(res));
  change(model.levels[0].rooms[0]);
  return model;
}

test('engine fed directly: a 0.2 square metre room, a self crossing polygon, NaN and a 5000 point polygon', () => {
  const cases = {
    tiny: (r) => { r.polygon = rect(0, 0, 0.5, 0.4); },
    bowtie: (r) => { r.polygon = [[0, 0], [4, 3], [4, 0], [0, 3]]; },
    nan: (r) => { r.polygon = [[0, 0], [NaN, 0], [4, 3], [0, 3]]; },
    far: (r) => { r.polygon = rect(1e9, 1e9, 4, 3); },
    many: (r) => { r.polygon = Array.from({ length: 5000 }, (_, i) => [2 + 2 * Math.cos((i / 5000) * 2 * Math.PI), 1.5 + 1.4 * Math.sin((i / 5000) * 2 * Math.PI)]); },
    line: (r) => { r.polygon = [[0, 0], [4, 0], [8, 0]]; },
  };
  for (const [name, change] of Object.entries(cases)) {
    const model = mutated(change);
    const t0 = performance.now();
    const lay = autoFurnish(model, { seed: 3 });
    assert.ok(performance.now() - t0 < 2000, name);
    const here = lay.levels[0].pieces.filter((p) => p.room === 'room0');
    assert.equal(here.length, 0, `${name}: ${here.length} pieces in a broken room`);
    assert.ok(lay.levels[0].pieces.length > 5, `${name}: the other room is still furnished`);
  }
});

test('a room without any door and a door as wide as the whole wall', () => {
  run(planOf([{ polygon: rect(0, 0, 4, 3), name: 'Salon', door: false, window: true }]), { expectValid: false });
  run(planOf([{ polygon: rect(0, 0, 4, 3), name: 'Bedroom', doorOffset: 0, doorWidth: 4 }, { polygon: rect(5, 0, 2.5, 3), name: 'Łazienka', doorOffset: 0, doorWidth: 2.5 }]), { expectValid: false });
});

test('a plan with 100000 walls is refused before the engine sees it', () => {
  const walls = [];
  for (let i = 0; i < 100000; i++) walls.push({ id: `w${i}`, from: [i * 0.01, 0], to: [i * 0.01, 1], kind: 'interior' });
  const res = analyzePlan({ version: 1, name: 'huge', units: 'm', levels: [{ id: 'L0', name: 'x', height: 2.7, walls, openings: [], rooms: [] }] });
  assert.equal(res.ok, false);
});

test('engine inputs that are not plans do not throw', () => {
  assert.deepEqual(autoFurnish({ levels: [] }).levels, []);
  assert.deepEqual(autoFurnish({}).levels, []);
});

// ---- the whole chain (validate, build the model, furnish) on hostile plans: no exception, under two seconds in all ----
function chain(plan) {
  const t0 = performance.now();
  let res;
  assert.doesNotThrow(() => { res = analyzePlan(plan); }, 'validation does not throw');
  assert.equal(typeof res.ok, 'boolean');
  let pieces = 0;
  if (res.ok) {
    let model;
    assert.doesNotThrow(() => { model = buildModel(modelOf(res)); }, 'building the model does not throw');
    let lay;
    assert.doesNotThrow(() => { lay = autoFurnish(model, { seed: 2 }); }, 'furnishing does not throw');
    pieces = lay.levels.reduce((n, l) => n + l.pieces.length, 0);
    assert.ok(pieces <= LIMITS.total);
    for (const l of lay.levels) for (const p of l.pieces) assert.ok([p.x, p.y, p.rot, p.elev, ...p.size].every(Number.isFinite), 'finite numbers only');
  } else {
    assert.ok(Array.isArray(res.errors) && res.errors.length > 0, 'a refused plan says why');
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  return { ok: res.ok, pieces, ms };
}

test('hostile plans, whole chain: empty, a level without rooms, numbers that are not numbers', () => {
  const level = { id: 'L0', name: 'x', height: 2.7, walls: [], openings: [], rooms: [] };
  const base = { version: 1, name: 'x', units: 'm' };
  assert.equal(chain({ ...base, levels: [] }).pieces, 0);
  assert.equal(chain({ ...base, levels: [level] }).pieces, 0);
  assert.equal(chain({}).ok, false);
  assert.equal(chain(null).ok, false);
  assert.equal(chain('').ok, false);
  assert.equal(chain([]).ok, false);
  const nan = (v) => ({ ...base, levels: [{ ...level, ...v }] });
  const poly = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const walls = wallsOf(poly, 'w');
  const room = { id: 'r', name: 'Salon', polygon: poly, use: 'living' };
  for (const bad of [NaN, Infinity, -Infinity, 1e308, null, '4', {}, [], true]) {
    const w2 = walls.map((w, i) => (i === 1 ? { ...w, to: [bad, 0] } : w));
    chain(nan({ walls: w2, rooms: [room], openings: [{ id: 'd', wall: 'w0', type: 'door', offset: 0.1, width: 0.8 }] }));
    chain(nan({ walls, rooms: [{ ...room, polygon: [[0, 0], [bad, 0], [4, 3], [0, 3]] }] }));
    chain(nan({ walls, rooms: [room], height: bad }));
    chain(nan({ walls, rooms: [room], openings: [{ id: 'd', wall: 'w0', type: 'door', offset: bad, width: 0.8 }] }));
    chain(nan({ walls, rooms: [room], openings: [{ id: 'd', wall: 'w0', type: 'window', offset: 0.1, width: bad, sill: bad }] }));
  }
});

test('hostile plans, whole chain: 200 rooms, a room of 0.2 square metres, a self crossing room, 100000 walls', () => {
  const names = ['Salon', 'Bedroom', 'Kuchnia', 'Łazienka', 'Hall', 'Gabinet', 'xyz', 'Kids', 'WC', 'Jadalnia'];
  const rooms = [];
  for (let i = 0; i < 200; i++) rooms.push({ polygon: rect((i % 20) * 4.2, Math.floor(i / 20) * 4.2, 4, 4), name: names[i % 10], window: i % 2 === 0 });
  chain(planOf(rooms));
  chain(planOf([{ polygon: rect(0, 0, 0.5, 0.4), name: 'Salon' }, { polygon: rect(1, 0, 4, 3), name: 'Salon' }]));
  chain(planOf([{ polygon: [[0, 0], [4, 3], [4, 0], [0, 3]], name: 'Salon', door: false }, { polygon: rect(5, 0, 4, 3), name: 'Bedroom' }]));
  const walls = [];
  for (let i = 0; i < 100000; i++) walls.push({ id: `w${i}`, from: [i * 0.01, 0], to: [i * 0.01, 1], kind: 'interior' });
  const r = chain({ version: 1, name: 'huge', units: 'm', levels: [{ id: 'L0', name: 'x', height: 2.7, walls, openings: [], rooms: [] }] });
  assert.equal(r.ok, false);
  // 100000 openings, rooms with 100000 points, and 100000 levels are refused as cheaply
  const openings = Array.from({ length: 100000 }, (_, i) => ({ id: `o${i}`, wall: 'w0', type: 'window', offset: 0.1, width: 0.5 }));
  assert.equal(chain({ version: 1, name: 'huge', units: 'm', levels: [{ id: 'L0', name: 'x', height: 2.7, walls: wallsOf(rect(0, 0, 4, 3), 'w'), openings, rooms: [] }] }).ok, false);
  const pts = Array.from({ length: 100000 }, (_, i) => [Math.cos(i), Math.sin(i)]);
  assert.equal(chain({ version: 1, name: 'huge', units: 'm', levels: [{ id: 'L0', name: 'x', height: 2.7, walls: wallsOf(rect(0, 0, 4, 3), 'w'), openings: [], rooms: [{ id: 'r', name: 'Salon', polygon: pts }] }] }).ok, false);
  const levels = Array.from({ length: 100000 }, (_, i) => ({ id: `L${i}`, name: 'x', height: 2.7, walls: [], openings: [], rooms: [] }));
  assert.equal(chain({ version: 1, name: 'huge', units: 'm', levels }).ok, false);
});
