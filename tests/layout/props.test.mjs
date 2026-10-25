// The prop layer of the automatic layout: pictures, mirrors, plants, rugs and small things on furniture. It must keep every rule of the
// layout (no overlap, nothing in a door zone or before a window, a full set in every room), stay deterministic, and leave the walls
// and surfaces of the fourteen test plans visibly fuller than a bare set of furniture.
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
import { LIMITS } from '../../src/layout/engine.js';

const ALL = piecesImplemented();
const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) plans.push([`gen-${seed}`, generatePlan(seed).plan]);
const built = plans.map(([name, plan]) => {
  const res = analyzePlan(plan);
  assert.ok(res.ok, name);
  const model = buildModel(modelOf(res));
  return { name, model, layout: autoFurnish(model, { seed: 7, allowedTypes: ALL }) };
});
const all = (layout) => layout.levels.flatMap((lv) => lv.pieces);
const SMALL = ['vase', 'books-stack', 'centerpiece'];

for (const { name, model, layout } of built) {
  test(`props on plan ${name}: every rule holds, deterministic, default type set also clean`, () => {
    assert.deepEqual(layout, autoFurnish(model, { seed: 7, allowedTypes: ALL }));
    assert.deepEqual(checkLayout(model, layout, { allowedTypes: ALL }), []);
    const plain = autoFurnish(model, { seed: 7 });
    assert.deepEqual(checkLayout(model, plain), []);
    assert.ok(all(plain).every((p) => SPEC_BY_ID[p.type].tier <= 2), 'the default set draws only from the first two tiers');
    for (const lv of layout.levels) assert.ok(lv.pieces.length <= LIMITS.perLevel);
  });
}

test('small things stand on a piece that carries them, at its top height', () => {
  for (const { name, layout } of built) {
    const byId = new Map(all(layout).map((p) => [p.id, p]));
    for (const p of all(layout)) {
      if (!SMALL.includes(p.type)) continue;
      const parent = byId.get(p.on);
      assert.ok(parent, `${name}: ${p.type} ${p.id} has a parent`);
      assert.ok(SPEC_BY_ID[p.type].place.onTop.includes(parent.type), `${name}: ${p.type} on ${parent.type}`);
      assert.ok(Math.abs(p.elev - (parent.elev + parent.size[2])) < 0.01, `${name}: ${p.type} sits on the top`);
    }
  }
});

test('the fourteen plans carry pictures, mirrors, plants and small things in numbers a bare layout does not reach', () => {
  const count = (types) => built.reduce((n, { layout }) => n + all(layout).filter((p) => types.includes(p.type)).length, 0);
  const rooms = built.reduce((n, { model }) => n + model.levels.reduce((m, lv) => m + lv.rooms.length, 0), 0);
  assert.ok(count(['art-large', 'art-small']) >= 130, `pictures ${count(['art-large', 'art-small'])}`);
  assert.ok(count(['mirror']) >= 25, `mirrors ${count(['mirror'])}`);
  assert.ok(count(['plant-large', 'plant-small']) >= 50, `plants ${count(['plant-large', 'plant-small'])}`);
  assert.ok(count(SMALL) >= 30, `small things ${count(SMALL)}`);
  assert.ok(count(['art-large', 'art-small']) / rooms >= 1.5, 'at least one and a half pictures per room on average');
});

test('every living room and bedroom has a picture or a mirror on the wall', () => {
  for (const { name, model, layout } of built) {
    for (const lv of layout.levels) {
      const level = model.levels.find((l) => l.id === lv.id);
      for (const room of level.rooms) {
        const type = roomType(room, model);
        if (type !== 'living' && type !== 'bedroom') continue;
        const mine = lv.pieces.filter((p) => p.room === room.id);
        if (!mine.length) continue;
        assert.ok(mine.some((p) => ['art-large', 'art-small', 'mirror'].includes(p.type)), `${name} ${room.id} has something on the wall`);
      }
    }
  }
});

test('pictures and mirrors on a wall never touch each other', () => {
  for (const { name, layout } of built) {
    for (const lv of layout.levels) {
      const wall = lv.pieces.filter((p) => ['art-large', 'art-small', 'mirror'].includes(p.type));
      for (let i = 0; i < wall.length; i++) for (let j = i + 1; j < wall.length; j++) {
        const a = wall[i], b = wall[j];
        if (a.room !== b.room || a.elev + a.size[2] <= b.elev || b.elev + b.size[2] <= a.elev) continue;
        const near = Math.hypot(a.x - b.x, a.y - b.y) - (a.size[0] + b.size[0]) / 2;
        assert.ok(near > 0.02 || Math.abs(a.rot - b.rot) > 1, `${name}: ${a.id} and ${b.id} are ${near.toFixed(2)} m apart`);
      }
    }
  }
});
