// In Spacer the player goes through furniture and is stopped by walls, windows, stairs with their rails and shut doors.
// Node only: the physics on the real examples and on a small plan of its own.
// Ported (cut down) from planwalk tests/viewer/walk-furniture.test.mjs (MIT, same author), source commit fa1a280 (v0.3.2). The model of the page has no
// furniture at all (the layout engine furnishes the flat on its own), so what is left of the original is what still stops the player, plus one guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createPlayer, stepPlayer, maxPenetration, useDoor } from '../../src/model/physics.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const modelOf = fileModel;
const walk = (world, p, input, seconds, dt = 1 / 60) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) stepPlayer(world, p, input, dt); return p; };
const at = (world, x, y, yawDeg, level = 0) => createPlayer(world, { level, x, y, yawDeg });

test('the model of the page has no furniture and no furniture collider: nothing but walls, window gaps, stairs and shut doors can stop the player', () => {
  for (const file of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json', 'tests/fixtures/duplex-min.plan.json', 'tests/fixtures/flat-stairs-out.plan.json']) {
    const m = modelOf(file), w = createWorld(m);
    for (const lv of m.levels) {
      assert.equal(lv.furniture.length, 0, `${file}: no furniture in the model`);
      const kinds = new Set(w.solid[lv.index].colliders.map((c) => c.kind));
      for (const k of kinds) assert.ok(['wall', 'stair', 'rail', 'door'].includes(k), `${file}: collider kind ${k}`);
    }
  }
});

test('guard: even a model that carries a sofa is walked through (the world leaves furniture out of what stops the player)', () => {
  const m = twoRooms({ sofa: true }), w = createWorld(m);
  assert.equal(m.levels[0].colliders.some((c) => c.kind === 'furniture'), true, 'the model keeps the collider of the sofa');
  assert.equal(w.solid[0].colliders.some((c) => c.kind === 'furniture'), false, 'the world that the player moves in has none');
  assert.equal(w.fixed[0].colliders.some((c) => c.kind === 'furniture'), false);
  const a = walk(w, at(w, 0.8, 2, 0), { forward: 1 }, 1.8);
  assert.ok(a.x > 3.0 && a.collisions === 0, `through the sofa (x 1 to 3): x = ${a.x.toFixed(2)}`);
});

test('walls, windows and stairs still stop the player', () => {
  const duplex = modelOf('examples/duplex-1.plan.json'), w = createWorld(duplex);
  // wall g5 (x = 2.8, 0.12 thick) between the hall and the rooms, walking east at y = 1.9 (the kitchen door is at y 0.6 to 1.5, the other at 3.4 to 4.35)
  const a = walk(w, at(w, 2.0, 2.0, 0), { forward: 1 }, 2);
  assert.ok(Math.abs(a.x - (2.8 - 0.06 - 0.2)) < 0.01, `wall: x = ${a.x.toFixed(3)}`);
  // window win-kitchen in g1 (y = 0): the sill is below eye height, the gap stays solid
  const b = walk(w, at(w, 4.2, 1.4, -90), { forward: 1 }, 2);
  assert.ok(Math.abs(b.y - (0.15 + 0.2)) < 0.01, `window: y = ${b.y.toFixed(3)}`);
  // the rails of stair-1 (x 0.6 to 1.6, from (1.1, 5.2) to (1.1, 2.4)): sideways from the middle of the flight the player stops 20 cm short of a rail
  const c = walk(w, at(w, 1.1, 4.0, 0), { forward: 1 }, 2);
  assert.ok(Math.abs(c.x - (1.6 - 0.2)) < 0.01, `rail: x = ${c.x.toFixed(3)}`);
  const d = walk(w, at(w, 1.1, 4.0, 180), { forward: 1 }, 2);
  assert.ok(Math.abs(d.x - (0.6 + 0.2)) < 0.01, `rail: x = ${d.x.toFixed(3)}`);
  assert.equal(c.level, 0);
  // a stair that leaves the plan is solid like a wall
  const flat = modelOf('tests/fixtures/flat-stairs-out.plan.json'), fw = createWorld(flat);
  const e = walk(fw, at(fw, 0.4, 1.2, 0), { forward: 1 }, 3);
  assert.ok(e.x < 0.915 - 0.2 + 1e-2, `loose stair: x = ${e.x.toFixed(3)}`);
});

test('two rooms: the open door lets the player through, the shut door and the wall do not', () => {
  const m = twoRooms(), w = createWorld(m);
  // the door d1 (y 1.0 to 1.9 in the wall x = 4): open, the player passes; shut, it stops at the door like at a wall
  const open = walk(w, at(w, 3.0, 1.45, 0), { forward: 1 }, 1.5);
  assert.ok(open.x > 4.5 && open.collisions === 0, `open door: x = ${open.x.toFixed(2)}`);
  const p = at(w, 3.0, 1.45, 0);
  assert.equal(useDoor(w, p).action, 'close');
  walk(w, p, { forward: 1 }, 2);
  assert.ok(Math.abs(p.x - (4 - 0.06 - 0.2)) < 0.01, `shut door: x = ${p.x.toFixed(3)}`);
  assert.ok(p.collisions > 0);
  // the wall beside the door
  const q = walk(w, at(w, 3.0, 0.4, 0), { forward: 1 }, 2);
  assert.ok(Math.abs(q.x - (4 - 0.06 - 0.2)) < 0.01, `wall: x = ${q.x.toFixed(3)}`);
  assert.equal(maxPenetration(w.solid[0], q.x, q.y) < 1e-3, true);
});
