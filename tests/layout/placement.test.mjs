// Placement rules of the automatic layout on the fourteen test plans: the sofa faces the television, tall pieces lean on the
// north and west walls when the room offers a choice, and a studio has a place to sleep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { SPEC_BY_ID } from '../../src/furniture/specs.js';
import { autoFurnish, checkLayout } from '../../src/layout/index.js';
import { frontOf, onNorthOrWestWall } from '../../src/layout/geometry.js';
import { TALL_WALL_BONUS } from '../../src/layout/engine.js';
import { roomType, isStudio } from '../../src/layout/rooms.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }
const furnished = (plan) => {
  const res = analyzePlan(plan);
  assert.ok(res.ok);
  const model = buildModel(modelOf(res));
  return { model, layout: autoFurnish(model, { seed: 7 }) };
};
const SOFAS = ['sofa2', 'sofa3', 'sofa-bed'];
const BEDS = ['bed-double', 'bed-single', 'bed-king', 'sofa-bed'];

test('the sofa faces the television within 25 degrees in every living room', () => {
  let rooms = 0;
  for (const [name, plan] of plans) {
    const { model, layout } = furnished(plan);
    for (const L of layout.levels) {
      const level = model.levels.find((l) => l.id === L.id);
      for (const room of level.rooms) {
        if (roomType(room, model) !== 'living') continue;
        const mine = L.pieces.filter((p) => p.room === room.id);
        const sofa = mine.find((p) => SOFAS.includes(p.type)), unit = mine.find((p) => p.type === 'tv-unit');
        if (!sofa || !unit) continue;
        rooms++;
        const [fx, fy] = frontOf(sofa.rot);
        const dx = unit.x - sofa.x, dy = unit.y - sofa.y;
        const angle = (Math.acos(Math.max(-1, Math.min(1, (fx * dx + fy * dy) / Math.hypot(dx, dy)))) * 180) / Math.PI;
        assert.ok(angle <= 25, `${name} ${room.id}: sofa turned ${angle.toFixed(1)} degrees from the television`);
      }
    }
  }
  assert.ok(rooms >= 14, `only ${rooms} living rooms checked`);
});

test('tall pieces lean on the north and west walls more often than on the others', () => {
  let tall = 0, northWest = 0;
  for (const [, plan] of plans) {
    const { layout } = furnished(plan);
    for (const L of layout.levels) for (const p of L.pieces) {
      const spec = SPEC_BY_ID[p.type];
      if (!spec.tall || spec.place.mode !== 'floor' || !/wardrobe|bookshelf/.test(p.type)) continue;
      const [fx, fy] = frontOf(p.rot);
      tall++;
      if (fy > 0.7 || fx > 0.7) northWest++; // the back is on a north wall (front to the south) or a west wall (front to the east)
    }
  }
  assert.ok(tall >= 20, `only ${tall} tall pieces`);
  assert.ok(northWest / tall >= 0.65, `${northWest} of ${tall} tall pieces on a north or west wall`);
});

test('the wall helper puts a north or west wall first for a tall piece and keeps other pieces on their own score', () => {
  assert.equal(onNorthOrWestWall({ n: [0, 1] }), true);
  assert.equal(onNorthOrWestWall({ n: [1, 0] }), true);
  assert.equal(onNorthOrWestWall({ n: [0, -1] }), false);
  assert.equal(onNorthOrWestWall({ n: [-1, 0] }), false);
  assert.ok(TALL_WALL_BONUS > 0);
});

test('a studio gets a bed, and a flat with bedrooms does not get one in its living room', () => {
  let studios = 0;
  for (const [name, plan] of plans) {
    const { model, layout } = furnished(plan);
    for (const L of layout.levels) {
      const level = model.levels.find((l) => l.id === L.id);
      for (const room of level.rooms) {
        if (roomType(room, model) !== 'living') continue;
        const beds = L.pieces.filter((p) => p.room === room.id && BEDS.includes(p.type));
        if (isStudio(room, model)) {
          studios++;
          assert.ok(beds.length >= 1, `${name} ${room.id}: the studio has no bed`);
        } else {
          assert.equal(beds.length, 0, `${name} ${room.id}: a living room with bedrooms next to it got a bed`);
        }
      }
    }
  }
  assert.ok(studios >= 1, 'no studio among the test plans');
});

test('the studio keeps its full living set next to the bed and stays free of violations', () => {
  const { family, plan } = generatePlan(407);
  assert.equal(family, 'studio');
  const { model, layout } = furnished(plan);
  const bad = checkLayout(model, layout);
  assert.deepEqual(bad, [], JSON.stringify(bad.slice(0, 5)));
  const types = new Set(layout.levels.flatMap((l) => l.pieces.map((p) => p.type)));
  assert.ok(SOFAS.some((t) => types.has(t)), 'studio lacks a sofa');
  for (const t of ['tv-unit', 'coffee-table', 'rug']) assert.ok(types.has(t), `studio lacks ${t}`);
  assert.ok(BEDS.some((t) => types.has(t)), 'studio lacks a bed');
});
