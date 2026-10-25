// The extra piece types in the recipes (small wardrobe, sofa bed, wall shelf, bathroom cabinet): the automatic layout uses them where
// they belong, keeps every rule of the layout (no overlap, nothing in a door zone, nothing before a window, a full set in every room)
// and only draws from the types it is allowed to use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { SPEC_BY_ID } from '../../src/furniture/specs.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { autoFurnish, checkLayout } from '../../src/layout/index.js';
import { roomType } from '../../src/layout/rooms.js';
import { placementProblems } from '../../src/editor/index.js';

const ALL = piecesImplemented();
const EXTRA = ['wardrobe-small', 'sofa-bed', 'shelf-wall', 'bathroom-cabinet'];
const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) plans.push([`gen-${seed}`, generatePlan(seed).plan]);
const modelOfPlan = (plan) => { const res = analyzePlan(plan); assert.ok(res.ok); return buildModel(modelOf(res)); };
const built = plans.map(([name, plan]) => {
  const model = modelOfPlan(plan);
  return { name, model, layout: autoFurnish(model, { seed: 1, allowedTypes: ALL }) };
});

test('the extra types have a builder, so the page may use them', () => {
  for (const t of EXTRA) assert.ok(ALL.includes(t), t);
});

for (const { name, model, layout } of built) {
  test(`plan ${name} with every built type: all rules hold, full sets, deterministic, at most 2 blocked fronts`, () => {
    assert.deepEqual(layout, autoFurnish(model, { seed: 1, allowedTypes: ALL }));
    const bad = checkLayout(model, layout, { allowedTypes: ALL });
    assert.deepEqual(bad, [], JSON.stringify(bad.slice(0, 4)));
    let blocked = 0;
    for (const lv of layout.levels) for (const p of lv.pieces) if (placementProblems(model, layout, lv.id, p).some((q) => q.kind === 'front-blocked')) blocked++;
    assert.ok(blocked <= 2, `${blocked} pieces with a blocked front`);
  });
}

test('each extra type shows up in the fourteen plans', () => {
  const count = Object.fromEntries(EXTRA.map((t) => [t, 0]));
  for (const { layout } of built) for (const lv of layout.levels) for (const p of lv.pieces) if (p.type in count) count[p.type]++;
  assert.ok(count['sofa-bed'] >= 3, JSON.stringify(count));
  assert.ok(count['wardrobe-small'] >= 5, JSON.stringify(count));
  assert.ok(count['bathroom-cabinet'] >= 10, JSON.stringify(count));
  assert.ok(count['shelf-wall'] >= 10, JSON.stringify(count));
});

test('the extra types stand where they belong', () => {
  for (const { name, model, layout } of built) {
    for (const lv of layout.levels) {
      const level = model.levels.find((l) => l.id === lv.id);
      for (const p of lv.pieces) {
        if (!EXTRA.includes(p.type)) continue;
        const room = level.rooms.find((r) => r.id === p.room);
        const type = roomType(room, model);
        assert.ok(SPEC_BY_ID[p.type].rooms.includes(type) || SPEC_BY_ID[p.type].rooms.includes('any'), `${name}: ${p.type} in a ${type}`);
        if (p.type === 'sofa-bed') assert.ok(type === 'living' && room.area < 17.5, `${name}: sofa bed in a ${type} of ${room.area} m2`);
        if (p.type === 'bathroom-cabinet') {
          const basin = lv.pieces.find((q) => q.type === 'washbasin' && q.room === p.room && Math.hypot(q.x - p.x, q.y - p.y) < 0.7);
          assert.ok(basin, `${name}: bathroom cabinet without a washbasin below it`);
          assert.ok(p.elev >= basin.size[2] + 0.2, `${name}: cabinet at ${p.elev} m`);
        }
        if (p.type === 'shelf-wall') assert.ok(p.elev >= 1.2 && p.elev + p.size[2] < level.height, `${name}: shelf at ${p.elev} m`);
      }
    }
  }
});

test('types that are not allowed are never used: the default set has none of the extra types, and a living room still gets a sofa', () => {
  for (const [name, plan] of plans) {
    const model = modelOfPlan(plan);
    const lay = autoFurnish(model, { seed: 1 });
    const types = new Set(lay.levels.flatMap((l) => l.pieces.map((p) => p.type)));
    for (const t of EXTRA) assert.ok(!types.has(t), `${name}: ${t} in the default layout`);
    const without = ALL.filter((t) => t !== 'sofa-bed' && t !== 'wardrobe-small');
    const lay2 = autoFurnish(model, { seed: 1, allowedTypes: without });
    assert.deepEqual(lay2.levels.flatMap((l) => l.pieces).filter((p) => p.type === 'sofa-bed' || p.type === 'wardrobe-small'), []);
    assert.deepEqual(checkLayout(model, lay2, { allowedTypes: without }), [], name);
  }
});
