// The doors of Spacer: open at the start, the space bar shuts and opens the one in reach, a shut door blocks, a door never shuts on the player,
// and the leaf swings in 0.45 s. Node only, the physics and the geometry of the model.
// Ported from planwalk tests/viewer/walk-doors.test.mjs (MIT, same author), source commit fa1a280 (v0.3.2), without the furniture: the model of the page has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leafPose, LEAF_OPEN_DEG } from '../../src/model/geometry.js';
import { createWorld, createPlayer, stepPlayer, doorInReach, useDoor, useSpace, stepDoors, openAllDoors, defaultSpawn } from '../../src/model/physics.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const modelOf = fileModel;
const walk = (world, p, input, seconds, dt = 1 / 60) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) stepPlayer(world, p, input, dt); return p; };
const at = (world, x, y, yawDeg, level = 0) => createPlayer(world, { level, x, y, yawDeg });
const rad = (d) => (d * Math.PI) / 180;
// d1 sits in the wall x = 4 at y 1.0 to 1.9 (middle (4, 1.45)); the player faces it from the west with yaw 0.

test('every door starts open: no shut collider, the leaf stands in the pose that is drawn', () => {
  for (const file of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json', 'tests/fixtures/duplex-min.plan.json']) {
    const m = modelOf(file), w = createWorld(m);
    const doors = m.levels.flatMap((lv) => lv.openings.filter((o) => o.type === 'door'));
    assert.equal(w.doors.length, doors.length, `${file}: one state per door`);
    assert.ok(w.doors.every((d) => d.closed === false && d.t === 1));
    for (const lv of m.levels) assert.equal(w.solid[lv.index].colliders.some((c) => c.kind === 'door'), false, `${file}: nothing shut`);
  }
  // only a door with a gap that can be walked through is switchable: a passage has no leaf, and a high sill closes the gap for good
  assert.deepEqual(createWorld(twoRooms()).doors.map((d) => d.id), ['d1']);
  assert.deepEqual(createWorld(twoRooms({ sill: 0.6 })).doors.map((d) => d.id), []);
});

test('the leaf pose at t = 1 is the pose it was always drawn in, at t = 0 it lies in the wall', () => {
  for (const file of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json']) {
    for (const lv of modelOf(file).levels) for (const o of lv.openings.filter((q) => q.type === 'door')) {
      // the formula of v0.3.1, written out here as the reference
      const { px, py, closed, sn, wl } = o.swing, open = (LEAF_OPEN_DEG * Math.PI) / 180;
      const e = [closed[0] * Math.cos(open) + sn[0] * Math.sin(open), closed[1] * Math.cos(open) + sn[1] * Math.sin(open)];
      const was = { cx: px + (e[0] * wl) / 2, cy: py + (e[1] * wl) / 2, angle: Math.atan2(e[1], e[0]) };
      assert.deepEqual(leafPose(o.swing, 1), was, `${o.id}: open`);
      assert.deepEqual({ cx: o.leaf.cx, cy: o.leaf.cy, angle: o.leaf.angle }, was, `${o.id}: the box in the model`);
      const shut = leafPose(o.swing, 0), w = lv.wallById.get(o.wallId);
      assert.ok(Math.abs(Math.cos(shut.angle - Math.atan2(closed[1], closed[0])) - 1) < 1e-9, `${o.id}: along the wall`);
      // the shut leaf spans the opening between its hinge and the far jamb, on the wall line
      const far = [px + closed[0] * wl, py + closed[1] * wl];
      assert.ok(Math.abs(shut.cx - (px + far[0]) / 2) < 1e-9 && Math.abs(shut.cy - (py + far[1]) / 2) < 1e-9);
      assert.ok(Math.abs((far[0] - px) * w.normal[0] + (far[1] - py) * w.normal[1]) < 1e-9);
    }
  }
});

test('a shut door blocks the walk from both sides, an open one lets through', () => {
  const m = twoRooms(), w = createWorld(m);
  const open = walk(w, at(w, 3.0, 1.45, 0), { forward: 1 }, 1.5);
  assert.ok(open.x > 4.5 && open.collisions === 0, `open: x = ${open.x.toFixed(2)}`);
  const p = at(w, 3.0, 1.45, 0);
  assert.deepEqual(useDoor(w, p), { id: 'd1', action: 'close' });
  walk(w, p, { forward: 1 }, 2);
  assert.ok(Math.abs(p.x - (4 - 0.06 - 0.2)) < 0.01, `shut, from the west: x = ${p.x.toFixed(3)}`);
  const q = at(w, 5.0, 1.45, 180);
  walk(w, q, { forward: 1 }, 2);
  assert.ok(Math.abs(q.x - (4 + 0.06 + 0.2)) < 0.01, `shut, from the east: x = ${q.x.toFixed(3)}`);
  // the passage beside it stays open
  const r = walk(w, at(w, 3.0, 3.1, 0), { forward: 1 }, 1.5);
  assert.ok(r.x > 4.5, `passage: x = ${r.x.toFixed(2)}`);
  // opening it again lets the player through at once
  assert.deepEqual(useDoor(w, p), { id: 'd1', action: 'open' });
  walk(w, p, { forward: 1 }, 1.5);
  assert.ok(p.x > 4.5, `open again: x = ${p.x.toFixed(2)}`);
});

test('the space bar shuts and opens the door in reach and jumps when there is none', () => {
  const w = createWorld(twoRooms());
  const p = at(w, 3.0, 1.45, 0);
  assert.equal(useSpace(w, p).action, 'close');
  assert.equal(p.jumpV, 0, 'at a door the space bar does not jump');
  assert.equal(useSpace(w, p).action, 'open');
  assert.equal(p.jumpV, 0);
  const far = at(w, 0.8, 3.4, 0);
  assert.deepEqual(useSpace(w, far), { action: 'jump' });
  assert.ok(far.jumpV > 0);
  assert.deepEqual(useSpace(w, far), { action: 'none' }, 'in the air with no door: nothing');
  assert.equal(w.doors[0].closed, false);
});

test('the reach is 1.3 m and the cone 70 degrees from where the player looks', () => {
  const w = createWorld(twoRooms());
  const door = (x, y, yawDeg) => doorInReach(w, at(w, x, y, yawDeg))?.id ?? null;
  assert.equal(door(2.8, 1.45, 0), 'd1', '1.2 m away, facing it');
  assert.equal(door(2.6, 1.45, 0), null, '1.4 m away');
  assert.equal(door(2.74, 1.45, 0), 'd1', 'just inside 1.3 m');
  assert.equal(door(2.65, 1.45, 0), null, 'just outside 1.3 m');
  assert.equal(door(3.0, 1.45, 180), null, 'facing away');
  assert.equal(door(3.0, 1.45, 90), null, 'looking along the wall, 90 degrees off');
  // from (3.5, 1.45 + 0.5) the middle of the opening is 0.5 m ahead and 0.5 m aside; the nearest point of it is straight ahead of the player's
  // side: at 40 degrees to the left or right of the line to it the door still counts, at 85 it does not
  assert.equal(door(3.4, 0.45, 40), 'd1', 'to the south of the door, turned 40 degrees towards it');
  assert.equal(door(3.4, 0.45, -80), null, 'turned 80 degrees away');
  // looking at it from the other side
  assert.equal(door(5.0, 1.45, 180), 'd1');
  assert.equal(door(5.0, 1.45, 0), null);
});

test('a wall between the player and the door hides it', () => {
  // the divider at y = 2.4 (x 4 to 8) closes the south part of room B off from the door; the player is 1.2 m from its nearest end
  const hidden = createWorld(twoRooms({ divider: true })), seen = createWorld(twoRooms());
  const yaw = (Math.atan2(1.9 - 3.0, 4 - 4.5) * 180) / Math.PI;
  assert.equal(doorInReach(hidden, at(hidden, 4.5, 3.0, yaw)), null, 'behind the divider');
  assert.equal(doorInReach(seen, at(seen, 4.5, 3.0, yaw))?.id, 'd1', 'the same spot in a room without it');
  assert.equal(useSpace(hidden, at(hidden, 4.5, 3.0, yaw)).action, 'jump', 'so the space bar jumps');
});

test('the door never shuts on the player: standing in the doorway, or within a hair of it, nothing happens', () => {
  const w = createWorld(twoRooms());
  for (const [x, y, yaw] of [[4.0, 1.45, 0], [4.0, 1.45, 180], [4.0, 1.2, 90], [3.75, 1.45, 0], [4.25, 1.45, 180], [4.0, 1.0, 0]]) {
    const p = at(w, x, y, yaw);
    assert.deepEqual(useDoor(w, p), { id: 'd1', action: 'blocked' }, `at (${x}, ${y})`);
    assert.equal(w.doors[0].closed, false);
    assert.equal(useSpace(w, p).action, 'blocked', 'and the space bar does not jump there either');
    assert.equal(p.jumpV, 0);
  }
  // a step back and it shuts; the player is outside the door and can walk away
  const p = at(w, 3.65, 1.45, 0);
  assert.equal(useDoor(w, p).action, 'close');
  walk(w, p, { forward: -1 }, 1);
  assert.ok(p.x < 3.0);
  // a player who stands against a shut door is not inside it, and the door can be opened again
  const v = createWorld(twoRooms()), q = at(v, 3.0, 1.45, 0);
  assert.equal(useDoor(v, q).action, 'close');
  walk(v, q, { forward: 1 }, 2);
  assert.equal(useDoor(v, q).action, 'open');
  walk(v, q, { forward: 1 }, 1);
  assert.ok(q.x > 4.3);
});

test('the nearest door in reach is the one the space bar works', () => {
  const m = modelOf('examples/flat-1.plan.json'), w = createWorld(m);
  // d-hall-living (x 0.6 to 1.5 at y = 3) and d-hall-bath (x = 2, y 4.2 to 5) in the hall
  const near = (x, y, yaw, world = w) => doorInReach(world, at(world, x, y, yaw))?.id ?? null;
  assert.equal(near(1.3, 3.7, -90), 'd-hall-living');
  assert.equal(near(1.5, 4.4, 0), 'd-hall-bath');
  // From (0.7, 4.2), turned 67.5 degrees off the way to the bathroom door, both doors are in reach and in the cone (1.2 m and 1.3 m away): the
  // nearer one wins, and with it taken out the other one is found, so it was a candidate too.
  const without = (id) => ({ ...w, doors: w.doors.filter((d) => d.id !== id) });
  assert.equal(near(0.7, 4.2, -67.5), 'd-hall-living');
  assert.equal(near(0.7, 4.2, -67.5, without('d-hall-living')), 'd-hall-bath', 'the farther door was in reach as well');
  assert.equal(near(0.7, 4.2, -67.5, without('d-hall-bath')), 'd-hall-living');
});

test('the cone ends between 65 and 75 degrees from the line to the door', () => {
  const w = createWorld(twoRooms());
  const door = (yawDeg) => doorInReach(w, at(w, 3.0, 1.45, yawDeg))?.id ?? null; // the nearest point of the opening is straight ahead at yaw 0
  assert.deepEqual([door(65), door(-65)], ['d1', 'd1']);
  assert.deepEqual([door(75), door(-75)], [null, null]);
});

test('a door shuts on a player 23 cm from its face and not on one 21 cm from it (the circle is 20 cm and the margin 2 cm)', () => {
  // the shut door fills the wall: its face lies 6 cm from the wall line x = 4, on either side
  for (const [x, yaw] of [[4 - 0.06 - 0.21, 0], [4 + 0.06 + 0.21, 180]]) {
    const w = createWorld(twoRooms()), p = at(w, x, 1.45, yaw);
    assert.deepEqual(useDoor(w, p), { id: 'd1', action: 'blocked' }, `x = ${x.toFixed(2)}: just outside the circle, still too close`);
    assert.equal(w.doors[0].closed, false);
  }
  for (const [x, yaw] of [[4 - 0.06 - 0.23, 0], [4 + 0.06 + 0.23, 180]]) {
    const w = createWorld(twoRooms()), p = at(w, x, 1.45, yaw);
    assert.deepEqual(useDoor(w, p), { id: 'd1', action: 'close' }, `x = ${x.toFixed(2)}: far enough`);
    const before = [p.x, p.y];
    stepPlayer(w, p, {}, 1 / 60);
    assert.deepEqual([p.x, p.y, p.collisions], [...before, 0], 'the shut door does not push the player');
  }
});

test('doors of the other level are not in reach', () => {
  const m = modelOf('examples/duplex-1.plan.json'), w = createWorld(m);
  const p = at(w, 2.3, 2.65, 0, 0);
  assert.equal(doorInReach(w, p)?.level, 0);
  const q = at(w, 2.3, 2.65, 0, 1);
  assert.equal(doorInReach(w, q)?.id, 'd-land-bed1');
  assert.equal(doorInReach(w, q)?.level, 1);
});

test('the leaf swings in 0.45 s, in steps of any size, and the door blocks as soon as it is shut', () => {
  for (const dt of [1 / 60, 1 / 30, 1 / 120]) {
    const w = createWorld(twoRooms()), p = at(w, 3.0, 1.45, 0), d = w.doors[0];
    useDoor(w, p);
    assert.equal(d.t, 1, 'the leaf has not moved yet');
    let t = 0, seconds = 0;
    while (stepDoors(w, dt)) { seconds += dt; t = d.t; assert.ok(d.t >= 0 && d.t < 1); }
    assert.equal(d.t, 0);
    assert.ok(Math.abs(seconds - 0.45) <= dt + 1e-9, `dt ${dt}: ${seconds.toFixed(3)} s`);
    assert.ok(t >= 0);
    assert.equal(stepDoors(w, dt), false, 'at rest it does not move');
    useDoor(w, p);
    seconds = 0;
    while (stepDoors(w, dt)) seconds += dt;
    assert.equal(d.t, 1);
    assert.ok(Math.abs(seconds - 0.45) <= dt + 1e-9, `dt ${dt} (opening): ${seconds.toFixed(3)} s`);
  }
  // half way the leaf is turned half of 75 degrees: the swing of a leaf is the angle of the open pose times t
  const m = twoRooms(), o = m.levels[0].openings.find((q) => q.id === 'd1');
  const a0 = leafPose(o.swing, 0).angle, a1 = leafPose(o.swing, 1).angle, aHalf = leafPose(o.swing, 0.5).angle;
  const turn = (a, b) => Math.abs(((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(Math.abs(turn(a0, a1) - rad(LEAF_OPEN_DEG)) < 1e-9);
  assert.ok(Math.abs(turn(a0, aHalf) - rad(LEAF_OPEN_DEG) / 2) < 1e-9);
  // a shut door blocks while the leaf is still swinging
  const w = createWorld(m), p = at(w, 3.0, 1.45, 0);
  useDoor(w, p);
  stepDoors(w, 0.1);
  walk(w, p, { forward: 1 }, 1);
  assert.ok(p.x < 3.75, `x = ${p.x.toFixed(2)}`);
});

test('every door is open again after openAllDoors and in a world made anew; two worlds do not share doors', () => {
  const m = twoRooms(), w = createWorld(m), p = at(w, 3.0, 1.45, 0);
  assert.equal(openAllDoors(w), false, 'nothing to do');
  useDoor(w, p);
  stepDoors(w, 1);
  assert.equal(w.doors[0].t, 0);
  assert.equal(createWorld(m).doors[0].closed, false, 'a new world on the same model: open');
  assert.equal(openAllDoors(w), true);
  assert.deepEqual([w.doors[0].closed, w.doors[0].t], [false, 1]);
  assert.equal(w.solid[0].colliders.some((c) => c.kind === 'door'), false);
  assert.ok(walk(w, p, { forward: 1 }, 1.5).x > 4.5, 'the way is open');
});

test('the same keys give the same doors and the same player every run', () => {
  const run = () => {
    const w = createWorld(modelOf('examples/flat-1.plan.json'));
    const sp = defaultSpawn(w.model), p = createPlayer(w, { level: sp.level, x: sp.x, y: sp.y, yawDeg: sp.yawDeg });
    const log = [];
    for (let i = 0; i < 900; i++) {
      if (i % 150 === 40) log.push(useSpace(w, p));
      stepDoors(w, 1 / 60);
      stepPlayer(w, p, { forward: 1, turn: i % 120 < 60 ? 0.4 : -0.4 }, 1 / 60);
    }
    return JSON.stringify([log, p, w.doors.map((d) => [d.id, d.closed, d.t])]);
  };
  assert.equal(run(), run());
});

test('the start of Spacer is the same with doors in the model (they are open)', () => {
  for (const file of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json', 'tests/fixtures/duplex-min.plan.json']) {
    const m = modelOf(file);
    createWorld(m).doors.forEach((d) => { d.closed = true; });
    assert.deepEqual(defaultSpawn(m), defaultSpawn(modelOf(file)), `${file}: the model is not touched by the state of the doors`);
  }
});
