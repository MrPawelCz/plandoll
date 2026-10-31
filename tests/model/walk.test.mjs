// The physics of Spacer on the examples and fixtures: walls, windows, stairs, the start, the free views, a stair that leaves the plan. Node only.
// Ported from planwalk tests/viewer/walk.test.mjs (MIT, same author), source commit fa1a280 (v0.3.2), without the furniture: the model of the page has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, levelOffsets, modelExtent, EXPLODE_FACTOR } from '../../src/model/geometry.js';
import { createWorld, createPlayer, stepPlayer, teleport, defaultSpawn, maxPenetration, freeDistance, longestView } from '../../src/model/physics.js';
import { leafPose } from '../../src/model/geometry.js';
import { fileModel, planModel, twoRooms } from '../helpers/walk-model.mjs';

const modelOf = fileModel;
const flat = () => modelOf('examples/flat-1.plan.json');
const duplex = () => modelOf('tests/fixtures/duplex-min.plan.json');

function walk(world, p, input, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepPlayer(world, p, input, dt);
  return p;
}
const player = (world, x, y, yawDeg, level = 0) => createPlayer(world, { level, x, y, yawDeg });

test('flat-1 builds the expected model (no furniture: the page strips it before building)', () => {
  const m = flat();
  assert.deepEqual(m.counts, { levels: 1, walls: 8, openings: 12, rooms: 5, furniture: 0, stairs: 0 });
});

test('default spawn is the room behind the exterior door', () => {
  const m = flat();
  const sp = defaultSpawn(m);
  assert.equal(sp.roomId ?? m.levels[sp.level].rooms.find((r) => r.name === 'Hall')?.id, sp.roomId ?? 'hall');
  const w = createWorld(m);
  const p = createPlayer(w, { level: sp.level, x: sp.x, y: sp.y, yawDeg: sp.yawDeg });
  assert.equal(maxPenetration(m.levels[0], p.x, p.y), 0, 'the spawn point must be free of colliders');
});

test('a wall stops the player', () => {
  const m = duplex();
  const w = createWorld(m);
  // interior wall g5 sits at x = 4 (thickness 0.12); the gap (passage) is at y 2.0 to 3.0, so y = 1.0 is solid
  const p = walk(w, player(w, 3, 1.0, 0), { forward: 1 }, 4);
  assert.ok(p.x < 4 - 0.06 - 0.2 + 1e-3, `x = ${p.x}`);
  assert.ok(p.collisions > 0);
});

test('a passage lets the player through', () => {
  const m = duplex();
  const w = createWorld(m);
  const p = walk(w, player(w, 3, 2.5, 0), { forward: 1 }, 3);
  assert.ok(p.x > 5, `x = ${p.x}`);
});

test('a window is not an exit: the sill is below eye height so the gap stays solid', () => {
  const m = duplex();
  const w = createWorld(m);
  // window gw1 on g1 (y = 0) spans x 1.5 to 2.9
  const p = walk(w, player(w, 2.2, 2, -90), { forward: 1 }, 4);
  assert.ok(p.y > 0.15, `y = ${p.y}`);
});

test('the player walks on until the wall: nothing stands in the way in the room of the fixture', () => {
  const m = duplex();
  const w = createWorld(m);
  // walking +y from (6.0, 3.0) crosses the middle of the room; the wall g3 (y = 5, 0.3 thick) is the first thing that stops it
  const p = walk(w, player(w, 6.0, 3.0, 90), { forward: 1 }, 3);
  assert.ok(Math.abs(p.y - (5 - 0.15 - 0.2)) < 1e-2, `y = ${p.y}`);
  assert.equal(maxPenetration({ colliders: w.solid[0].colliders }, p.x, p.y) < 1e-3, true, 'the player never ends up inside a wall');
});

test('stairs carry the player to the upper level', () => {
  const m = duplex();
  const w = createWorld(m);
  const p = walk(w, player(w, 1.0, 1.0, 90), { forward: 1 }, 6);
  assert.equal(p.level, 1, `level ${p.level}, y = ${p.y}`);
  assert.ok(Math.abs(p.floor - m.levels[1].elevation) < 0.05, `floor ${p.floor} vs ${m.levels[1].elevation}`);
});

test('the default spawn is never on a stair run (duplex-1 has its stair through the middle of the hall)', () => {
  const m = modelOf('examples/duplex-1.plan.json');
  const w = createWorld(m);
  const sp = defaultSpawn(m);
  assert.equal(sp.level, 0);
  assert.equal(sp.roomId, 'hall');
  const p = createPlayer(w, { level: sp.level, x: sp.x, y: sp.y, yawDeg: sp.yawDeg });
  walk(w, p, {}, 1);
  assert.equal(p.level, 0);
  assert.equal(p.onStair, null);
  assert.equal(p.floor, 0);
  for (const st of m.stairs) {
    // the stair footprint is 1.0 m wide: stay at least the player radius away from it
    const inside = (x, y) => x >= Math.min(...st.footprint.map((q) => q[0])) && x <= Math.max(...st.footprint.map((q) => q[0])) && y >= Math.min(...st.footprint.map((q) => q[1])) && y <= Math.max(...st.footprint.map((q) => q[1]));
    assert.equal(inside(sp.x, sp.y), false, `spawn (${sp.x}, ${sp.y}) lies on ${st.id}`);
  }
});

test('duplex-1: walking north from the foot of the stair arrives on the upper floor', () => {
  const m = modelOf('examples/duplex-1.plan.json');
  const w = createWorld(m);
  const p = walk(w, player(w, 1.1, 5.7, -90), { forward: 1, run: true }, 3);
  assert.equal(p.level, 1);
  assert.ok(Math.abs(p.floor - m.levels[1].elevation) < 0.05);
});

test('explode offsets are cumulative level heights', () => {
  const m = duplex();
  assert.deepEqual(levelOffsets(m, 0), [0, 0]);
  const off = levelOffsets(m, 1);
  assert.equal(off[0], 0);
  assert.ok(Math.abs(off[1] - m.levels[0].height * EXPLODE_FACTOR) < 1e-9);
});

test('the same input sequence gives the same state (determinism)', () => {
  const run = () => {
    const m = flat();
    const w = createWorld(m);
    const sp = defaultSpawn(m);
    const p = createPlayer(w, { level: sp.level, x: sp.x, y: sp.y, yawDeg: sp.yawDeg });
    for (let i = 0; i < 600; i++) stepPlayer(w, p, { forward: 1, strafe: i % 90 < 45 ? 0.5 : -0.5, turn: i % 200 < 100 ? 0.3 : -0.3, run: i % 300 > 150 }, 1 / 60);
    teleport(w, p, p.x, p.y);
    return JSON.stringify(p);
  };
  assert.equal(run(), run());
});

test('walking speed matches the spec (1.4 m/s, 2.8 m/s running)', () => {
  const m = duplex();
  const w = createWorld(m);
  const a = walk(w, player(w, 4.5, 0.8, 0), { forward: 1 }, 1);
  assert.ok(Math.abs(a.x - (4.5 + 1.4)) < 0.05, `x = ${a.x}`);
  const b = walk(w, player(w, 4.5, 0.8, 0), { forward: 1, run: true }, 1);
  assert.ok(Math.abs(b.x - (4.5 + 2.8)) < 0.05, `x = ${b.x}`);
});

// ---- the start direction of Spacer: the longest free view, not the nearest wall ----
const ahead = (m, sp, deg = sp.yawDeg) => freeDistance(m.levels[sp.level], sp.x, sp.y, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));

test('freeDistance: a ray stops at the first wall, ignores what lies behind it and stops at the limit', () => {
  const m = duplex();
  const lv = m.levels[0];
  // g5 (x = 4, thickness 0.12) is solid at y = 1: from (3, 1) going east the first face is at x = 3.94
  assert.ok(Math.abs(freeDistance(lv, 3, 1, 1, 0) - 0.94) < 0.01);
  assert.ok(Math.abs(freeDistance(lv, 6, 1, -1, 0) - 1.94) < 0.01, 'the other side of g5, going west');
  // through the passage (y 2 to 3) the ray reaches the east wall g2 (x = 8, thickness 0.3, face at 7.85)
  assert.ok(Math.abs(freeDistance(lv, 3, 2.05, 1, 0) - 4.85) < 0.01);
  assert.ok(Math.abs(freeDistance(lv, 3, 2.05, 0.6, 0.8) - freeDistance(lv, 3, 2.05, 0.6, 0.8, 100)) < 1e-9, 'a slanted ray works too, and the default limit is not what stops it');
  assert.equal(freeDistance(lv, 3, 2.05, 1, 0, 2), 2, 'the limit caps the answer');
  assert.equal(freeDistance(lv, 4, 1, 1, 0), 0, 'a start inside a wall is 0');
  assert.equal(freeDistance({ colliders: [] }, 0, 0, 1, 0), 40);
});

test('the start of Spacer looks along the longest free view in every example and fixture', () => {
  // [file, the free distance the old start (towards the room from the door) had, the least the new one must give]; the page has no furniture in the
  // model, so the start stays at the label point of the room and the views are the ones of the bare walls (duplex-min: 4.48 m, it was 6 with a sofa to dodge)
  for (const [file, old, least] of [['tests/fixtures/duplex-min.plan.json', 1.68, 4.4], ['examples/duplex-1.plan.json', 3.06, 3.2], ['examples/flat-1.plan.json', 2.86, 2.8], ['tests/fixtures/flat-stairs-out.plan.json', 3.14, 3]]) {
    const m = modelOf(file), sp = defaultSpawn(m);
    const d = ahead(m, sp);
    assert.ok(d >= least, `${file}: ${d.toFixed(2)} m ahead, wanted at least ${least} (the old start had ${old})`);
    assert.ok(d >= old - 0.1, `${file}: not worse than before`);
    assert.deepEqual(defaultSpawn(m), sp, `${file}: the same answer every time`);
    assert.ok(sp.yawDeg > -180 && sp.yawDeg <= 180, `${file}: yaw ${sp.yawDeg} is a plain angle in degrees`);
  }
});

test('the first view is taken from a point with room around it, so no bare wall fills the frame', () => {
  // [file, the share of the picture (103 degrees: 16:9 at 70 degrees of height) that may end within 1.2 m]. The old start of duplex-1 stood in the
  // strip of 1.1 m between the stair rail and the wall (0.46 m from a collider): 42 percent of the frame was that wall, all of it on the left.
  for (const [file, most] of [['examples/flat-1.plan.json', 0.1], ['examples/duplex-1.plan.json', 0.05], ['tests/fixtures/duplex-min.plan.json', 0.05], ['tests/fixtures/flat-stairs-out.plan.json', 0.3]]) {
    const m = modelOf(file), sp = defaultSpawn(m), lv = m.levels[sp.level];
    assert.equal(maxPenetration(lv, sp.x, sp.y, 0.8), 0, `${file}: at least 0.8 m from every collider`);
    let near = 0, n = 0;
    for (let a = -51; a <= 51; a++, n++) if (ahead(m, sp, sp.yawDeg + a) < 1.2) near++;
    assert.ok(near / n <= most, `${file}: ${Math.round((100 * near) / n)} percent of the frame ends within 1.2 m, at most ${most * 100}`);
  }
});

test('a start that already has room stays on the label point of the room, one that has not moves to the open part of it', () => {
  for (const file of ['examples/flat-1.plan.json', 'tests/fixtures/duplex-min.plan.json', 'tests/fixtures/flat-stairs-out.plan.json']) {
    const m = modelOf(file), sp = defaultSpawn(m);
    assert.deepEqual([sp.x, sp.y], m.levels[sp.level].rooms.find((r) => r.id === sp.roomId).label, `${file}: the label point has 0.8 m of room`);
  }
  // duplex-1: the label point of the hall (1.4, 3.2) is on the stair run, and the free floor beside it is 1.1 m wide; the start is in the
  // part of the hall north of the stair (y under 2.29 less the 0.5 m ring), 1 m or more from the label point and not further than 2.5 m
  const m = modelOf('examples/duplex-1.plan.json'), sp = defaultSpawn(m), hall = m.levels[0].rooms.find((r) => r.id === 'hall');
  assert.equal(sp.roomId, 'hall');
  assert.ok(sp.y < 2.29 - 0.5 + 1e-9, `y = ${sp.y}`);
  const away = Math.hypot(sp.x - hall.label[0], sp.y - hall.label[1]);
  assert.ok(away > 1 && away < 2.5, `${away.toFixed(2)} m from the label point`);
});

// the angle (degrees) from the start to the middle of an opening of its level
const toMiddle = (m, sp, op) => {
  const w = m.levels[sp.level].wallById.get(op.wallId), um = (op.u0 + op.u1) / 2;
  return (Math.atan2(w.from[1] + w.dir[1] * um - sp.y, w.from[0] + w.dir[0] * um - sp.x) * 180) / Math.PI;
};
const offMiddle = (m, sp, op) => Math.abs(((toMiddle(m, sp, op) - sp.yawDeg + 540) % 360) - 180);

test('the start looks at the middle of the door or passage its longest view runs through, not at its edge', () => {
  for (const file of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json', 'tests/fixtures/duplex-min.plan.json']) {
    const m = modelOf(file), sp = defaultSpawn(m);
    const least = Math.min(...m.levels[sp.level].openings.filter((op) => op.type !== 'window').map((op) => offMiddle(m, sp, op)));
    assert.ok(least < 0.01, `${file}: the nearest middle of an opening is ${least.toFixed(2)} degrees off the view`);
  }
  // two rooms: the longest view from the middle of room A runs at -10 degrees, through the door d1 (middle at -15.4); the passage p1 is at 28.8
  const two = twoRooms(), sp = defaultSpawn(two), d1 = two.levels[0].openings.find((op) => op.id === 'd1');
  assert.ok(offMiddle(two, sp, d1) < 0.01, `yaw ${sp.yawDeg}`);
  assert.ok(Math.abs(sp.yawDeg - -10) > 5, 'it is turned, not left where the ray was');
});

test('a window is not aimed at: its gap is solid, so the view keeps its own direction; the same opening as a door is', () => {
  const room = (type) => planModel({
    version: 1, name: 'Long room', units: 'm',
    levels: [{
      id: 'L0', name: 'Ground', height: 2.6,
      walls: [
        { id: 'w1', from: [0, 0], to: [9, 0], kind: 'exterior' }, { id: 'w2', from: [9, 0], to: [9, 3], kind: 'exterior' },
        { id: 'w3', from: [9, 3], to: [0, 3], kind: 'exterior' }, { id: 'w4', from: [0, 3], to: [0, 0], kind: 'exterior' },
      ],
      openings: [{ id: 'd1', wall: 'w3', type: 'door', offset: 8, width: 0.9 }, { id: 'o2', wall: 'w2', type, offset: 0.6, width: 0.8 }],
      rooms: [{ id: 'room', name: 'Room', polygon: [[0, 0], [9, 0], [9, 3], [0, 3]], floor: 'wood', ceiling: true }],
      stairs: [], furniture: [],
    }],
  });
  const asWindow = room('window'), asDoor = room('door');
  const sw = defaultSpawn(asWindow), sd = defaultSpawn(asDoor);
  assert.ok(Number.isInteger(sw.yawDeg / 5), `a window: yaw ${sw.yawDeg} stays on the five degree grid of the rays`);
  assert.ok(offMiddle(asDoor, sd, asDoor.levels[0].openings.find((op) => op.id === 'o2')) < 0.01, `a door: yaw ${sd.yawDeg} is the middle of it`);
});

test('a long room is entered looking along its length, not at the wall opposite the door', () => {
  const plan = {
    version: 1, name: 'Long room', units: 'm',
    levels: [{
      id: 'L0', name: 'Ground', height: 2.6,
      walls: [
        { id: 'w1', from: [0, 0], to: [9, 0], kind: 'exterior' }, { id: 'w2', from: [9, 0], to: [9, 3], kind: 'exterior' },
        { id: 'w3', from: [9, 3], to: [0, 3], kind: 'exterior' }, { id: 'w4', from: [0, 3], to: [0, 0], kind: 'exterior' },
      ],
      openings: [{ id: 'd1', wall: 'w3', type: 'door', offset: 4.5, width: 0.9 }],
      rooms: [{ id: 'room', name: 'Room', polygon: [[0, 0], [9, 0], [9, 3], [0, 3]], floor: 'wood', ceiling: true }],
      stairs: [], furniture: [],
    }],
  };
  const m = planModel(plan), sp = defaultSpawn(m);
  // the old start looked from the door at the middle of the room: north, at a wall 1.4 m away
  assert.ok(Math.abs(Math.sin((sp.yawDeg * Math.PI) / 180)) < 0.45, `yaw ${sp.yawDeg} runs within 25 degrees of the 9 m side`);
  assert.ok(ahead(m, sp) > 4, `${ahead(m, sp).toFixed(2)} m ahead`);
});

test('longestView: the length of a corridor wins, equal views go to the preferred direction, an open end stops at the model bounds', () => {
  const rect = (cx, cy, hx, hy) => ({ cx, cy, hx, hy, ux: 1, uy: 0, minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy });
  // a corridor 10 x 1 with the point in the middle: both ends are 5 m away, the sides 0.5 m
  const sides = [rect(5, 0, 5, 0.05), rect(5, 1, 5, 0.05)];
  const closed = { colliders: [...sides, rect(0, 0.5, 0.05, 0.5), rect(10, 0.5, 0.05, 0.5)] };
  const b = { minX: 0, maxX: 10, minY: 0, maxY: 1 };
  assert.equal(longestView(closed, 5, 0.5, b, 0), 0);
  assert.equal(longestView(closed, 5, 0.5, b, 180), 180);
  assert.equal(longestView(closed, 5, 0.5, b, 175), 180, 'the closer of two equal views');
  assert.equal(longestView(closed, 5, 0.5, b, -90), 0, 'a direction facing the side wall is not an equal view: ties go to the first, which is 0');
  // a slanted ray down the corridor is longer than the straight one, but only the axis has long neighbours: the axis wins
  assert.equal(longestView(closed, 5, 0.5, b, 20), 0);
  // both ends open: the bounds end the views at 7 m (east) and 3 m (west) from x = 3, so the east end wins whatever is preferred
  const open = { colliders: sides };
  assert.equal(longestView(open, 3, 0.5, b, 180), 0);
  assert.equal(longestView(open, 3, 0.5, null, 180), 180, 'no bounds: both ends are as long as the limit, the preferred one wins');
  assert.equal(longestView({ colliders: [] }, 3, 3, null, 90), 90, 'an empty level and no bounds: the preferred direction');
});

// Stairs without to_level leave the plan (a drawing of one floor): drawn, solid, not a way to another level.
const outStairs = () => modelOf('tests/fixtures/flat-stairs-out.plan.json');

test('stairs that leave the plan are drawn from the floor, up by default and down with a negative rise', () => {
  const m = outStairs();
  assert.equal(m.counts.stairs, 2);
  assert.equal(m.stairs.length, 0, 'they are not ramps between two levels');
  assert.deepEqual(m.looseStairs.map((s) => [s.id, s.down]), [['st-up', false], ['st-down', true]]);
  const [up, down] = m.levels[0].stairs;
  assert.equal(up.boxes.length, 14);
  assert.equal(up.boxes[0].y0, 0);
  assert.ok(Math.abs(up.boxes[13].y1 - (m.levels[0].height + m.levels[0].slab)) < 1e-9, 'one storey up by default');
  assert.ok(Math.abs(down.boxes[0].y0 + 3) < 1e-9 && Math.abs(down.boxes[13].y1) < 1e-9, 'the top step is flush with the floor and the flight goes 3 m down');
  const living = m.levels[0].rooms.find((r) => r.id === 'living'), bedroom = m.levels[0].rooms.find((r) => r.id === 'bedroom');
  assert.equal(living.ceilingHoles.length, 1, 'the flight up goes through the ceiling');
  assert.equal(living.floorHoles.length, 0);
  assert.equal(bedroom.floorHoles.length, 1, 'the flight down opens the floor');
  assert.equal(bedroom.ceilingHoles.length, 0);
  const e = modelExtent(m);
  assert.ok(e.minY <= m.levels[0].elevation - 3 + 1e-9 && e.maxY >= m.levels[0].elevation + 2.9 - 1e-9, 'the camera frames the steps too');
});

test('stairs that leave the plan block the walk and never change the level', () => {
  const m = outStairs();
  const w = createWorld(m);
  // st-up occupies x 0.915 to 3.285 at y 0.75 to 1.65: walking east along y = 1.2 stops in front of it
  const p = walk(w, player(w, 0.4, 1.2, 0), { forward: 1 }, 3);
  assert.ok(p.x < 0.915 - 0.2 + 1e-2, `x = ${p.x}`);
  assert.equal(p.level, 0);
  assert.equal(p.onStair, null);
  assert.equal(p.floor, m.levels[0].elevation);
  // st-down is a hole in the bedroom floor: the player does not fall in
  const q = walk(w, player(w, 5.7, 0.4, 90), { forward: 1 }, 3);
  assert.ok(q.y < 0.84 - 0.2 + 1e-2, `y = ${q.y}`);
  assert.equal(maxPenetration(m.levels[0], q.x, q.y) < 1e-3, true);
});

test('a stair that leaves the plan on one level of a two level plan leaves the real stair and the level alone', () => {
  const p = JSON.parse(readFileSync(new URL('../fixtures/duplex-min.plan.json', import.meta.url), 'utf8'));
  p.levels[1].stairs = [{ id: 'out', from: [5, 1], to: [7, 1], width: 0.9, steps: 12 }];
  const m = planModel(p);
  assert.equal(m.counts.stairs, 2);
  assert.deepEqual(m.stairs.map((s) => s.id), ['st1'], 'only the stair between the two levels is a ramp');
  const w = createWorld(m);
  const q = walk(w, player(w, 4.5, 1, 0, 1), { forward: 1 }, 3);
  assert.equal(q.level, 1);
  assert.equal(q.onStair, null);
  assert.ok(q.x < 5 - 0.09 - 0.2 + 1e-2, `x = ${q.x}`);
  const up = walk(w, player(w, 1.0, 1.0, 90), { forward: 1 }, 6);
  assert.equal(up.level, 1, 'the real stair still carries the player up');
});

// A hall W x D with its exterior door in the south wall (offset along the wall from the east end); the leaf swings into the hall.
const hall = (W, D, { offset = 1.0, hinge = 'start', opens = 'right' } = {}) => planModel({
  version: 1, name: 'Hall', units: 'm',
  levels: [{
    id: 'L0', name: 'Ground', height: 2.6,
    walls: [
      { id: 'w1', from: [0, 0], to: [W, 0], kind: 'exterior' }, { id: 'w2', from: [W, 0], to: [W, D], kind: 'exterior' },
      { id: 'w3', from: [W, D], to: [0, D], kind: 'exterior' }, { id: 'w4', from: [0, D], to: [0, 0], kind: 'exterior' },
    ],
    openings: [{ id: 'front', wall: 'w3', type: 'door', offset, width: 0.9, hinge, opens_to: opens }],
    rooms: [{ id: 'hall', name: 'Hall', polygon: [[0, 0], [W, 0], [W, D], [0, D]], floor: 'wood', ceiling: true }], stairs: [], furniture: [],
  }],
});
// metres from a point to the open leaf of the door (the rectangle of leafPose, 4 cm thick)
const leafDistance = (m, x, y) => {
  const o = m.levels[0].openings.find((q) => q.swing), c = leafPose(o.swing, 1), hl = o.swing.wl / 2;
  const dx = x - c.cx, dy = y - c.cy, lx = dx * Math.cos(c.angle) + dy * Math.sin(c.angle), ly = -dx * Math.sin(c.angle) + dy * Math.cos(c.angle);
  return Math.hypot(Math.max(0, Math.abs(lx) - hl), Math.max(0, Math.abs(ly) - 0.02));
};
// the angle (degrees) between the start view and the nearest point of the leaf
const leafOff = (m, s) => {
  const o = m.levels[0].openings.find((q) => q.swing), c = leafPose(o.swing, 1), hl = o.swing.wl / 2;
  const dx = s.x - c.cx, dy = s.y - c.cy, k = Math.cos(c.angle), n = Math.sin(c.angle);
  const u = Math.max(-hl, Math.min(hl, dx * k + dy * n)), v = Math.max(-0.02, Math.min(0.02, -dx * n + dy * k));
  return Math.abs(((((Math.atan2(c.cy + u * n + v * k - s.y, c.cx + u * k - v * n - s.x) * 180) / Math.PI - s.yawDeg) % 360) + 540) % 360 - 180);
};

test('the start keeps 0.7 m from an open door leaf that stands in the first picture, and leaves a leaf behind the walker alone', () => {
  // a hall 2 x 2.5 m: the label point (1, 1.25) is 0.5 m from the leaf, which stands right in front of the view; in a hall of 1.4 x 2.5 m it is
  // 0.38 m from the leaf, which stands 34 degrees to the side (the 20 degrees of a narrower cone would miss it)
  for (const [W, D, offset] of [[2, 2.5, 1.0], [1.4, 2.5, 0.3]]) {
    const tight = hall(W, D, { offset }), [lx, ly] = tight.levels[0].rooms[0].label;
    assert.ok(leafDistance(tight, lx, ly) < 0.7, 'the label point is close to the leaf');
    const s = defaultSpawn(tight);
    assert.ok(leafDistance(tight, s.x, s.y) >= 0.7, `leaf ${leafDistance(tight, s.x, s.y).toFixed(2)} m from the start`);
    assert.ok(Math.hypot(s.x - lx, s.y - ly) < 0.6, 'the start only steps aside, it does not leave the middle of the hall');
    assert.equal(maxPenetration(tight.levels[0], s.x, s.y, 0.45), 0);
  }
  // the same door in a hall of 3.5 x 4 m: the label point is a metre from the leaf, so it stays
  const roomy = hall(3.5, 4);
  const r = defaultSpawn(roomy), label = roomy.levels[0].rooms[0].label;
  assert.ok(leafDistance(roomy, label[0], label[1]) >= 0.7);
  assert.deepEqual([r.x, r.y], label);
  // flat-1 and flat-stairs-out start 0.64 m from the leaf of the front door, which stands behind them: nothing moves
  for (const file of ['examples/flat-1.plan.json', 'tests/fixtures/flat-stairs-out.plan.json']) {
    const m = modelOf(file), f = defaultSpawn(m);
    assert.ok(leafDistance(m, f.x, f.y) < 0.7, 'the leaf is close');
    assert.ok(leafOff(m, f) > 60, `the leaf is behind the walker: ${leafOff(m, f).toFixed(0)} degrees`);
    assert.deepEqual([f.x, f.y], [1, 4.5]);
  }
});
