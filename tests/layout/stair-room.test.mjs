// The stair room type: "Stairwell" (and its Polish names) is recognised before the hall rule, and the engine puts nothing into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish, roomType, roomTypeFromName, ROOM_TYPES } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';

test('stairwell names give the stair type, hall names stay halls', () => {
  for (const n of ['Stairwell', 'stairwell', 'Klatka schodowa', 'Szyb schodowy', 'Main stairwell']) assert.equal(roomTypeFromName(n), 'stair', n);
  for (const n of ['Hall', 'Landing and gallery', 'Stairs', 'Przedpokój', 'Hall with stairs']) assert.equal(roomTypeFromName(n), 'hall', n);
  assert.ok(ROOM_TYPES.includes('stair'));
});

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function plan(name) {
  const walls = (l) => [['a', [0, 0], [6, 0]], ['b', [6, 0], [6, 4]], ['c', [0, 4], [6, 4]], ['d', [0, 0], [0, 4]], ['e', [1.2, 0], [1.2, 4]]].map(([id, from, to]) => ({ id: `${l}${id}`, from, to, kind: id === 'e' ? 'interior' : 'exterior' }));
  return {
    version: 1, name: 'stair room', units: 'm',
    levels: [{
      id: 'L0', name: 'Ground', height: 2.7, walls: walls('g'),
      openings: [{ id: 'front', wall: 'gc', type: 'door', offset: 3, width: 1 }, { id: 'p', wall: 'ge', type: 'passage', offset: 1.5, width: 1 }, { id: 'win', wall: 'gc', type: 'window', offset: 4.4, width: 1.2 }],
      rooms: [{ id: 'sw', name, polygon: rect(0, 0, 1.2, 4), use: 'hall', floor: 'tile' }, { id: 'living', name: 'Living room', polygon: rect(1.2, 0, 6, 4), use: 'living', floor: 'wood' }],
      stairs: [{ id: 's', from: [0.65, 3.4], to: [0.65, 0.5], width: 1, steps: 16, to_level: 'L1' }],
    }, {
      id: 'L1', name: 'First', height: 2.7, walls: walls('u'), openings: [{ id: 'uw', wall: 'uc', type: 'window', offset: 3, width: 1.4 }],
      rooms: [{ id: 'landing', name: 'Landing', polygon: rect(0, 0, 6, 4), use: 'hall', floor: 'wood' }],
    }],
  };
}

test('the engine adds nothing to a stair room, and an unnamed hall in its place would not be a stair', () => {
  const res = analyzePlan(plan('Stairwell'));
  assert.ok(res.ok, JSON.stringify(res.errors));
  const model = buildModel(modelOf(res));
  const shaft = model.levels[0].rooms.find((r) => r.id === 'sw');
  assert.equal(roomType(shaft, model), 'stair');
  for (const seed of [1, 2, 3]) {
    const layout = autoFurnish(model, { seed, allowedTypes: piecesImplemented() });
    const mine = layout.levels.find((l) => l.id === 'L0').pieces.filter((p) => p.room === 'sw' || p.room === 'Stairwell');
    assert.deepEqual(mine, [], `seed ${seed}`);
    const inside = layout.levels.find((l) => l.id === 'L0').pieces.filter((p) => p.x < 1.14 && p.x > 0.06 && p.y > 0.06 && p.y < 3.94);
    assert.deepEqual(inside.map((p) => p.type), [], `seed ${seed}`);
  }
  const hall = buildModel(modelOf(analyzePlan(plan('Hall with stairs'))));
  assert.equal(roomType(hall.levels[0].rooms.find((r) => r.id === 'sw'), hall), 'hall');
});
