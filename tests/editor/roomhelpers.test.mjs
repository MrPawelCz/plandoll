// roomsOf and roomInfoAt: the rooms of a level and the room under a point, for picking a room by touching its floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAt, roomsOf, roomInfoAt } from '../../src/editor/index.js';
import { pointInPolygon } from '../../src/layout/geometry.js';
import { testPlans, deepFreeze } from './plans.mjs';

const plans = testPlans();
const centroid = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];

for (const plan of plans) {
  test(`roomsOf lists every room of every level (${plan.name})`, () => {
    for (const level of plan.model.levels) {
      const list = roomsOf(plan.model, level.id);
      assert.equal(list.length, level.rooms.length);
      list.forEach((r, i) => {
        assert.equal(r.id, level.rooms[i].id);
        assert.equal(typeof r.name, 'string');
        assert.ok(r.name.length > 0);
        assert.ok(r.polygon.length >= 3, 'a polygon');
        assert.ok(r.polygon.every((q) => q.length === 2 && q.every(Number.isFinite)));
        if (r.interior) assert.ok(r.interior.length >= 3);
      });
    }
  });

  test(`roomInfoAt finds the room under a point inside its floor and agrees with roomAt (${plan.name})`, () => {
    let found = 0;
    for (const level of plan.model.levels) for (const r of roomsOf(plan.model, level.id)) {
      if (!r.interior) continue;
      // a point inside the floor: the label point when it is inside, otherwise the first corner pulled towards the middle
      const c = centroid(r.interior);
      const probe = pointInPolygon(c, r.interior) ? c : [(r.interior[0][0] + c[0]) / 2, (r.interior[0][1] + c[1]) / 2];
      if (!pointInPolygon(probe, r.interior)) continue;
      const hit = roomInfoAt(plan.model, level.id, probe[0], probe[1]);
      assert.ok(hit, `${level.id}/${r.id}`);
      assert.equal(hit.id, roomAt(plan.model, level.id, probe[0], probe[1]));
      assert.equal(hit.name, r.name);
      assert.deepEqual(hit.polygon, r.polygon);
      found++;
    }
    assert.ok(found >= 3, `${found} rooms found by touch`);
  });
}

test('roomInfoAt gives null outside every room and for a wrong level or a bad point', () => {
  const { model } = plans[0];
  const id = model.levels[0].id;
  assert.equal(roomInfoAt(model, id, 500, 500), null);
  assert.equal(roomInfoAt(model, 'nowhere', 1, 1), null);
  assert.equal(roomInfoAt(model, id, NaN, 1), null);
  assert.equal(roomInfoAt(null, id, 1, 1), null);
  assert.deepEqual(roomsOf(model, 'nowhere'), []);
  assert.deepEqual(roomsOf(null, id), []);
  assert.deepEqual(roomsOf({ levels: [{ id: 'a', rooms: [null, { id: 3 }, { id: 'x' }] }] }, 'a'), [], 'broken room records are left out');
});

test('roomsOf returns copies: changing them does not touch the model', () => {
  const { model } = plans[0];
  const id = model.levels[0].id;
  const before = JSON.stringify(model.levels[0].rooms);
  const list = roomsOf(model, id);
  list[0].polygon[0][0] = 9999;
  list[0].name = 'changed';
  assert.equal(JSON.stringify(model.levels[0].rooms), before);
  assert.equal(roomsOf(model, id)[0].polygon[0][0] !== 9999, true);
});

test('roomsOf and roomInfoAt do not change a frozen model', () => {
  const frozen = deepFreeze(JSON.parse(JSON.stringify({ levels: [{ id: 'a', rooms: [{ id: 'r1', name: 'Hall', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], area: 4, use: 'hall' }], walls: [], openings: [], height: 2.6, elevation: 0 }] })));
  assert.doesNotThrow(() => { roomsOf(frozen, 'a'); roomInfoAt(frozen, 'a', 1, 1); });
});
