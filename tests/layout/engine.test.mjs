// The layout engine on the fourteen test plans: no overlaps, nothing outside the room, nothing in a door zone, tall pieces away from
// windows, a full set for every living room, bedroom, kitchen and bathroom, deterministic, fast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { SPEC_BY_ID } from '../../src/furniture/specs.js';
import { autoFurnish, checkLayout, defaultAllowed, LIMITS } from '../../src/layout/index.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }
const modelOfPlan = (plan) => { const res = analyzePlan(plan); assert.ok(res.ok); return buildModel(modelOf(res)); };

// Violation kinds that count as geometry errors; a missing set is checked separately below.
const GEOMETRY_KINDS = ['overlap', 'outside-room', 'door-zone', 'stair', 'tall-before-window', 'size-range', 'unknown-type', 'bad-number', 'floating-prop', 'too-many-pieces'];

for (const [name, plan] of plans) {
  test(`plan ${name}: no geometric violations, deterministic, fast`, () => {
    const model = modelOfPlan(plan);
    const t0 = performance.now();
    const a = autoFurnish(model, { seed: 7 });
    const ms = performance.now() - t0;
    const b = autoFurnish(model, { seed: 7 });
    assert.deepEqual(a, b, 'two calls give the same layout');
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
    const bad = checkLayout(model, a).filter((v) => GEOMETRY_KINDS.includes(v.kind));
    assert.deepEqual(bad, [], JSON.stringify(bad.slice(0, 5)));
    assert.equal(a.version, 1);
    const ids = new Set();
    for (const lv of a.levels) for (const p of lv.pieces) {
      assert.ok(!ids.has(p.id)); ids.add(p.id);
      assert.deepEqual(Object.keys(p), ['id', 'type', 'room', 'x', 'y', 'rot', 'size', 'elev', 'on', 'colors']);
      assert.ok(SPEC_BY_ID[p.type]);
    }
    assert.ok(ids.size >= 20, `only ${ids.size} pieces`);
  });

  test(`plan ${name}: every living room, bedroom, kitchen and bathroom has its set`, () => {
    const model = modelOfPlan(plan);
    const missing = checkLayout(model, autoFurnish(model, { seed: 1 })).filter((v) => v.kind === 'missing-set');
    assert.deepEqual(missing, [], JSON.stringify(missing));
  });
}

test('additions come from the plan: curtains at windows, lamps, pictures, rugs under the sofa and the bed, plants', () => {
  const all = new Set();
  for (const [name, plan] of plans) {
    const model = modelOfPlan(plan);
    const lay = autoFurnish(model, { seed: 1 });
    const types = new Set(lay.levels.flatMap((l) => l.pieces.map((p) => p.type)));
    for (const t of ['curtain', 'art-large', 'art-small', 'rug']) assert.ok(types.has(t), `${name} has no ${t}`);
    for (const t of types) all.add(t);
    for (const lv of lay.levels) for (const p of lv.pieces) if (p.on) {
      const parent = lv.pieces.find((q) => q.id === p.on);
      assert.ok(parent && Math.abs(p.elev - (parent.elev + parent.size[2])) < 0.02, `${name} prop ${p.type} floats`);
    }
  }
  assert.ok(all.has('floor-lamp') && all.has('table-lamp') && all.has('pendant') && all.has('dining-chair') && all.has('plant-large'), [...all].join(' '));
});

test('allowedTypes limits the engine and different seeds stay valid', () => {
  const model = modelOfPlan(plans[2][1]);
  const only = new Set(['sofa2', 'coffee-table', 'bed-double', 'wardrobe', 'toilet', 'washbasin', 'shower']);
  const lay = autoFurnish(model, { seed: 3, allowedTypes: only });
  for (const lv of lay.levels) for (const p of lv.pieces) assert.ok(only.has(p.type), p.type);
  assert.ok(lay.levels[0].pieces.length > 3);
  for (const seed of [0, 1, 99, 123456, -5, NaN]) {
    const l = autoFurnish(model, { seed });
    assert.deepEqual(checkLayout(model, l).filter((v) => GEOMETRY_KINDS.includes(v.kind)), []);
  }
  assert.ok(defaultAllowed().has('sofa2') && !defaultAllowed().has('bench'));
});

test('the seed changes colours, never positions', () => {
  const model = modelOfPlan(plans[3][1]);
  const strip = (lay) => lay.levels.map((l) => l.pieces.map(({ colors, ...rest }) => rest));
  const a = autoFurnish(model, { seed: 1 }), b = autoFurnish(model, { seed: 2 }), c = autoFurnish(model, { seed: 1 });
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(a, c);
  assert.notDeepEqual(a.levels.map((l) => l.pieces.map((p) => p.colors)), b.levels.map((l) => l.pieces.map((p) => p.colors)));
  for (const lv of a.levels) for (const p of lv.pieces) for (const [slot, col] of Object.entries(p.colors)) {
    assert.ok(SPEC_BY_ID[p.type].slots.includes(slot), `${p.type} has no slot ${slot}`);
    assert.match(col, /^#[0-9a-f]{6}$/);
  }
});

test('limits: at most 400 pieces per level and 1500 in total', () => {
  assert.equal(LIMITS.perLevel, 400);
  assert.equal(LIMITS.total, 1500);
});
