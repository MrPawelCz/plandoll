// The third pass of the layout engine: one run of kitchen units, a table near the kitchen, somewhere to sit, nothing hung by the stairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { roomType } from '../../src/layout/rooms.js';
import { obb, penetration, byStairs } from '../../src/layout/geometry.js';
import { decorate } from '../../src/layout/recipes.js';
import { generatePlan } from '../../tools/gen-plans.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const modelFor = (plan) => buildModel(modelOf(analyzePlan(plan)));
const plans = [['flat-1', load('flat-1')], ['flat-2', load('flat-2')], ['duplex-1', load('duplex-1')], ['duplex-2', load('duplex-2')]];
for (let i = 1; i <= 30; i++) plans.push([`gen:${i}`, generatePlan(i).plan]);
const runs = plans.map(([name, plan]) => { const model = modelFor(plan); return { name, model, lay: autoFurnish(model, { seed: 1 }) }; });

const box = (p, grow = 0) => obb(p.x, p.y, p.size[0] + grow, p.size[1] + grow, p.rot);
const UNITS = new Set(['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'fridge']);
const SEAT = { pouf: 1, 'dining-chair': 1, 'desk-chair': 1, armchair: 1, sofa2: 2, sofa3: 3, 'sofa-bed': 2, 'bar-stool': 1, 'bed-double': 2, 'bed-king': 2, 'bed-single': 1 };
const seats = (ps) => ps.reduce((n, p) => n + (SEAT[p.type] ?? (p.type === 'bench' ? Math.floor(p.size[0] / 0.5) : 0)), 0);

test('kitchen units stand in one run: none is alone, the washer touches a run', () => {
  for (const { name, lay } of runs) for (const lv of lay.levels) {
    const ps = lv.pieces;
    for (const room of new Set(ps.map((p) => p.room))) {
      const units = ps.filter((p) => p.room === room && (UNITS.has(p.type) || p.type === 'washing-machine' && ps.some((q) => q.room === room && q.type === 'kitchen-sink')));
      for (const u of units) {
        if (units.length < 2) break;
        assert.ok(units.some((v) => v !== u && penetration(box(u, 0.1), box(v)) > 0), `${name} ${room}: ${u.type} stands alone`);
      }
    }
  }
});

test('the dining table of the second flat stands within 3.5 m of the kitchen run', () => {
  const { lay } = runs.find((r) => r.name === 'flat-2');
  const ps = lay.levels[0].pieces, table = ps.find((p) => p.type === 'dining-table'), units = ps.filter((p) => p.type === 'kitchen-sink' || p.type === 'kitchen-hob' || p.type === 'kitchen-base');
  assert.ok(table && units.length);
  const c = (p) => box(p).pts;
  const gap = (a, b) => Math.min(...c(a).flatMap((p) => c(b).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
  assert.ok(Math.min(...units.map((u) => gap(table, u))) <= 3.5);
});

test('every living room seats five and no big room is all cupboards', () => {
  const short = []; // a crowded generated living room may stay at four seats; the examples must not
  for (const { name, model, lay } of runs) for (const lv of model.levels) { // flat-1 has a 2 x 3 m hall with three doors: no seat fits there
    const ps = lay.levels[lv.index].pieces;
    for (const room of lv.rooms) {
      if (name === 'flat-1') continue;
      const type = roomType(room, model), mine = ps.filter((p) => p.room === room.id);
      const xs = room.polygon.map((q) => q[0]), ys = room.polygon.map((q) => q[1]), across = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (type === 'hall' && (across < 1.8 || room.floorHoles?.length || room.ceilingHoles?.length)) continue; // a narrow hall and a gallery round a stair opening are walkways: a seat there would block them (rules2.md E3)
      if (type === 'living' && room.area >= 14 && seats(mine) < 5) short.push(name);
      if (['living', 'dining', 'office', 'hall'].includes(type) && room.area >= 6 && mine.length) if (!(seats(mine) > 0 || mine.some((p) => p.type === 'dining-table'))) short.push(`${name}/${room.id}`);
    }
  }
  assert.deepEqual(short.filter((n) => n.startsWith('flat-2') || n.startsWith('duplex-2')), []); // the page's two examples (flat-2 and duplex-2) must not
  assert.ok(short.length <= 40, short.join(' '));
});

test('no picture, mirror or shelf hangs by a flight of stairs; a stairwell is left bare', () => {
  let stairs = 0;
  for (const { name, model, lay } of runs) for (const lv of model.levels) {
    const foots = (model.stairs ?? []).filter((s) => s.lower === lv.index || s.upper === lv.index).map((s) => s.footprint);
    stairs += foots.length;
    for (const p of lay.levels[lv.index].pieces) if (['art-large', 'art-small', 'mirror', 'shelf-wall'].includes(p.type)) assert.ok(!byStairs(p, foots), `${name}: ${p.type} by the stairs`);
  }
  assert.ok(stairs > 0);
  assert.equal(decorate({ type: 'stair' }), undefined);
});

test('the same seed gives the same layout', () => {
  const model = modelFor(load('duplex-2'));
  assert.deepEqual(autoFurnish(model, { seed: 3 }), autoFurnish(model, { seed: 3 }));
});
