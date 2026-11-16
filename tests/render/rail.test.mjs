// The rail round a stair opening on the upper floor: drawn only along the edges that fall open (not against a wall), none when the flight stands in a shaft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';

const any = () => new Proxy(function stub() {}, { get: (t, k) => (k === 'width' ? 100 : k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : () => any()), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const outer = (p) => [['a', [0, 0], [6, 0]], ['b', [6, 0], [6, 6]], ['c', [6, 6], [0, 6]], ['d', [0, 6], [0, 0]]].map(([id, from, to]) => ({ id: `${p}${id}`, from, to, kind: 'exterior' }));
// x: stair axis; shaft: walls round the flight below; wallX / wallEnd: walls on the upper floor beside the right edge and across the lower end
const plan = ({ x = 0.65, wallX = false, wallEnd = false } = {}) => {
  const lo = outer('g'), up = outer('u');
  lo.push({ id: 'gx', from: [1.21, 1.45], to: [1.21, 5.7], kind: 'interior' }, { id: 'gy', from: [0, 1.45], to: [1.21, 1.45], kind: 'interior' }, { id: 'ge', from: [0, 5.7], to: [1.21, 5.7], kind: 'interior' });
  if (wallX) up.push({ id: 'ux', from: [1.21, 1.45], to: [1.21, 5.7], kind: 'interior' });
  if (wallEnd) up.push({ id: 'ue', from: [0, 5.7], to: [1.21, 5.7], kind: 'interior' });
  return {
    version: 1, name: 'rail', units: 'm',
    levels: [
      { id: 'L0', name: 'Ground', height: 2.7, walls: lo, openings: [{ id: 'gp', wall: 'ge', type: 'passage', offset: 0.15, width: 1.0 }],
        rooms: [{ id: 'sw', name: 'Stairwell', use: 'other', polygon: rect(0, 1.45, 1.21, 5.7), floor: 'none' }, { id: 'rest', name: 'Living room', use: 'living', polygon: rect(1.21, 0, 6, 6), floor: 'wood' }, { id: 'hall', name: 'Hall', use: 'hall', polygon: rect(0, 5.7, 1.21, 6), floor: 'tile' }, { id: 'n', name: 'Study', use: 'office', polygon: rect(0, 0, 1.21, 1.45), floor: 'wood' }],
        stairs: [{ id: 's', from: [x, 5.4], to: [x, 1.65], width: 1.0, steps: 16, to_level: 'L1' }] },
      { id: 'L1', name: 'Upper', height: 2.7, walls: up, openings: [], rooms: [{ id: 'up', name: 'Gallery', use: 'hall', polygon: rect(0, 0, 6, 6), floor: 'wood' }], stairs: [] },
    ],
  };
};
const railOf = (opts) => {
  const model = buildModel(modelOf(analyzePlan(plan(opts)))), ps = new PlanScene(model, 'textured'), names = [];
  ps.group.traverse((o) => { if (o.name?.startsWith('rail:s/')) names.push(o.name.slice(7)); });
  return { model, names };
};
const sides = (names) => ['bar1', 'bar-1'].filter((n) => names.includes(n)).length;

test('a flight beside one wall gets a rail along its open side only, none across a walled end', () => {
  const { names } = railOf({ wallEnd: true });
  assert.equal(sides(names), 1);
  assert.ok(!names.includes('end'));
  assert.ok(names.some((n) => n.startsWith('post')));
});

test('a flight closed in by walls on both sides and at the end has no rail at all', () => {
  const { names } = railOf({ wallX: true, wallEnd: true });
  assert.deepEqual(names, []);
});

test('a flight standing free keeps both sides and the end', () => {
  const { names } = railOf({ x: 3 });
  assert.equal(sides(names), 2);
  assert.ok(names.includes('end'));
});

test('the opening in both floors takes the outline of the flight', () => {
  const { model } = railOf({ wallEnd: true });
  const up = model.levels[1].rooms.find((r) => r.id === 'up'), sw = model.levels[0].rooms.find((r) => r.id === 'sw');
  assert.equal(up.floorHoles.length, 1);
  assert.equal(sw.ceilingHoles.length, 1);
  assert.deepEqual(up.floorHoles[0], sw.ceilingHoles[0]);
});
