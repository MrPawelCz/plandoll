// The jump of Spacer: the height above the floor, the time in the air, no second jump, the same result every run, stairs and an upper floor.
// Node only, the physics of the model.
// Ported from planwalk tests/viewer/walk-jump.test.mjs (MIT, same author), source commit fa1a280 (v0.3.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JUMP } from '../../src/model/geometry.js';
import { createWorld, createPlayer, stepPlayer, teleport, jump } from '../../src/model/physics.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const modelOf = fileModel;
const airborne = (p) => p.jumpH > 0 || p.jumpV > 0;

// Jumps and steps until the player is back on the floor: the highest point and the seconds in the air.
function flight(world, p, dt, input = {}) {
  assert.equal(jump(world, p), true);
  let peak = 0, t = 0;
  for (let i = 0; i < 600 && airborne(p); i++) { stepPlayer(world, p, input, dt); t += dt; peak = Math.max(peak, p.jumpH); }
  return { peak, t };
}

test('a jump peaks at 0.459 m and lasts 0.612 s (the step that lands counts whole), at 60, 30 and 120 steps a second', () => {
  const w = createWorld(twoRooms());
  for (const dt of [1 / 60, 1 / 30, 1 / 120]) {
    const p = createPlayer(w, { x: 2, y: 3.4, yawDeg: 0 });
    const { peak, t } = flight(w, p, dt);
    // v2 / 2g: a gravity term without its half gives 0.435 m and 0.600 s, which a loose range let through
    assert.ok(Math.abs(peak - 0.459) < 0.004, `dt ${dt}: peak ${peak.toFixed(3)} m`);
    // the walker lands in the step that takes the height to zero, so the time is 2v/g up to one step more
    assert.ok(t >= 0.612 - 1e-6 && t <= 0.612 + dt + 1e-6, `dt ${dt}: ${t.toFixed(3)} s in the air`);
    assert.equal(p.jumpH, 0);
    assert.equal(p.jumpV, 0);
  }
  // the numbers of the design: 3.0 m/s and 9.8 m/s2 give 0.459 m and 0.612 s
  assert.ok(Math.abs(JUMP.speed ** 2 / (2 * JUMP.gravity) - 0.459) < 1e-3);
  assert.ok(Math.abs((2 * JUMP.speed) / JUMP.gravity - 0.612) < 1e-3);
});

test('there is no second jump in the air; after the landing the next one starts', () => {
  const w = createWorld(twoRooms());
  const p = createPlayer(w, { x: 2, y: 3.4, yawDeg: 0 });
  assert.equal(jump(w, p), true);
  for (let i = 0; i < 6; i++) stepPlayer(w, p, {}, 1 / 60);
  const h = p.jumpH, v = p.jumpV;
  assert.ok(h > 0.1 && v > 0, 'still on the way up');
  assert.equal(jump(w, p), false, 'a jump on the way up does nothing');
  assert.deepEqual([p.jumpH, p.jumpV], [h, v], 'and changes nothing');
  for (let i = 0; i < 12; i++) stepPlayer(w, p, {}, 1 / 60);
  assert.equal(jump(w, p), false, 'nor on the way down');
  for (let i = 0; i < 60 && airborne(p); i++) stepPlayer(w, p, {}, 1 / 60);
  assert.equal(airborne(p), false);
  assert.equal(jump(w, p), true, 'on the floor again');
  assert.equal(p.jumpV, JUMP.speed);
});

test('a jump is deterministic: the same keys give the same heights and the same player, at 60 and at 30 steps a second', () => {
  const run = (dt) => {
    const w = createWorld(twoRooms());
    const p = createPlayer(w, { x: 1, y: 3.4, yawDeg: 0 });
    const heights = [];
    for (let i = 0; i < Math.round(1.5 / dt); i++) {
      if (i === Math.round(0.2 / dt)) jump(w, p);
      stepPlayer(w, p, { forward: 1, turn: i % 50 < 25 ? 0.2 : -0.2 }, dt);
      heights.push(p.jumpH);
    }
    return JSON.stringify([heights, p]);
  };
  for (const dt of [1 / 60, 1 / 30]) assert.equal(run(dt), run(dt), `dt ${dt}`);
});

test('the walk goes on in the air: the player covers the ground at the same speed, and a wall still stops it', () => {
  const w = createWorld(twoRooms());
  const p = createPlayer(w, { x: 0.8, y: 3.4, yawDeg: 0 });
  const x0 = p.x;
  const { t } = flight(w, p, 1 / 60, { forward: 1 });
  assert.ok(Math.abs(p.x - x0 - 1.4 * t) < 0.03, `moved ${(p.x - x0).toFixed(3)} m in ${t.toFixed(3)} s`);
  // the outer wall at y = 4 (0.3 thick)
  const r = createPlayer(w, { x: 3.0, y: 3.2, yawDeg: 90 });
  flight(w, r, 1 / 60, { forward: 1 });
  assert.ok(r.y <= 4 - 0.15 - 0.2 + 1e-3, `y = ${r.y.toFixed(3)}, inside the wall at y = 4`);
});

test('jumping on a stair and on the upper floor: the height is above the floor under the player, and the landing is on it', () => {
  const m = modelOf('examples/duplex-1.plan.json'), w = createWorld(m);
  // the stair of duplex-1 climbs from (1.1, 5.2) to (1.1, 2.4); half way up the floor is 1.2 m above the ground floor
  const p = createPlayer(w, { level: 0, x: 1.1, y: 4.0, yawDeg: -90 });
  assert.ok(p.onStair && p.floor > 1, `floor ${p.floor}`);
  const floor = p.floor;
  const { peak } = flight(w, p, 1 / 60);
  assert.ok(peak >= 0.4 && peak <= 0.5, `peak ${peak.toFixed(3)}`);
  assert.equal(p.floor, floor, 'standing still, the floor under the player is the same');
  assert.equal(p.jumpH, 0);
  // walking up and jumping on the way, over the top of the stair: the player arrives on level 1 and lands on its floor
  const q = createPlayer(w, { level: 0, x: 1.1, y: 5.6, yawDeg: -90 });
  let up = 0;
  for (let i = 0; i < 6 * 60; i++) {
    if (q.onStair && q.floor > 2.2 && !airborne(q) && up === 0) { jump(w, q); up = 1; }
    stepPlayer(w, q, { forward: 1 }, 1 / 60);
  }
  assert.equal(up, 1, 'the jump was made on the stair');
  assert.equal(q.level, 1);
  assert.equal(q.jumpH, 0, 'landed');
  assert.ok(Math.abs(q.floor - m.levels[1].elevation) < 0.05, `floor ${q.floor}`);
  // on the upper floor the jump is the same
  teleport(w, q, 6, 4.5, 1);
  const { peak: upper } = flight(w, q, 1 / 60);
  assert.ok(upper >= 0.4 && upper <= 0.5, `upper floor: peak ${upper.toFixed(3)}`);
  assert.equal(q.floor, m.levels[1].elevation);
  assert.equal(q.level, 1);
});

test('placing the player (walkTo, a new start) ends a jump, and a world with no level has nothing to jump on', () => {
  const w = createWorld(twoRooms());
  const p = createPlayer(w, { x: 2, y: 3.4, yawDeg: 0 });
  jump(w, p);
  for (let i = 0; i < 10; i++) stepPlayer(w, p, {}, 1 / 60);
  assert.ok(airborne(p));
  teleport(w, p, 6, 3.4);
  assert.equal(airborne(p), false);
  assert.deepEqual([p.jumpH, p.jumpV], [0, 0]);
  const empty = createWorld({ bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, levels: [], stairs: [] });
  assert.equal(jump(empty, createPlayer(empty, {})), false);
});
