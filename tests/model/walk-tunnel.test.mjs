// No walker goes through a wall, a window, a shut door or a stair rail, however it comes at it: thousands of attacks from seeded random starts, headings,
// speeds and step sizes, on a window, on shut doors and on the two examples. Every step is checked twice: the circle of the walker does not overlap anything,
// and the straight move of the step does not cross the middle of a solid (a step that jumps the wall ends outside the wall, so the overlap test alone is blind to it).
// What counts as solid is worked out here from the plan and the doors, not read back from the world under test, so a wall, a window or a shut door
// that the world forgot is a crossing the test sees. Node only, the physics of the model. The seeds are fixed: the same attacks every run, whatever the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER } from '../../src/model/geometry.js';
import { createWorld, createPlayer, stepPlayer, useDoor, maxPenetration } from '../../src/model/physics.js';
import { substeps } from '../../src/app/spacer.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const EPS_PEN = 1e-3; // the overlap the physics allows itself (a hair, so a walker can lean on a wall)
const rng = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }; // a small LCG
const FREE_SILL = 0.35; // the sill up to which a door or a passage is walked through (anything higher, and every window, is solid)

// A rectangle of the model the way the colliders have it (centre, half sides along (ux, uy) and across, and the box that holds it).
function rect(cx, cy, hx, hy, ux, uy) {
  const ex = Math.abs(ux) * hx + Math.abs(uy) * hy, ey = Math.abs(uy) * hx + Math.abs(ux) * hy;
  return { cx, cy, hx, hy, ux, uy, minX: cx - ex, maxX: cx + ex, minY: cy - ey, maxY: cy + ey };
}

// Everything that stops the walker on a level: the colliders of the walls, the gap of every window and of every opening with a high sill, and the
// leaf of every door that is shut now.
function solidsOf(world, level) {
  const lv = world.levels[level];
  const gaps = lv.openings.filter((o) => o.type === 'window' || o.sill > FREE_SILL).map((o) => {
    const w = lv.wallById.get(o.wallId), um = (o.u0 + o.u1) / 2;
    return rect(w.from[0] + w.dir[0] * um, w.from[1] + w.dir[1] * um, (o.u1 - o.u0) / 2, w.thickness / 2, w.dir[0], w.dir[1]);
  });
  const shut = world.doors.filter((d) => d.level === level && d.closed).map((d) => d.collider);
  return [...world.fixed[level].colliders, ...gaps, ...shut];
}

// True when the straight move (ax, ay) to (bx, by) passes from one side of a solid to the other through the middle of it. A solid is a rectangle
// of the model (a wall, a window gap, a shut leaf, a rail); its middle line runs along the long side. The last PLAYER.radius at each end is left
// out: a walker that goes round the end of a wall in one long step crosses the line of the wall beyond it, never inside it.
function crossesSolid(colliders, ax, ay, bx, by) {
  for (const c of colliders) {
    const along = c.hx >= c.hy, half = (along ? c.hx : c.hy) - PLAYER.radius;
    if (half <= 0) continue;
    const local = (x, y) => [(x - c.cx) * c.ux + (y - c.cy) * c.uy, -(x - c.cx) * c.uy + (y - c.cy) * c.ux];
    const [ax1, ay1] = local(ax, ay), [bx1, by1] = local(bx, by);
    const [a, b, la, lb] = along ? [ay1, by1, ax1, bx1] : [ax1, bx1, ay1, by1]; // a, b: across the middle line; la, lb: along it
    if (a * b >= 0) continue; // the same side (or on the line at an end of the move): not a crossing
    const t = a / (a - b), where = la + t * (lb - la);
    if (Math.abs(where) <= half) return true;
  }
  return false;
}

// Shuts every door of the world the way the visitor does: stands 0.7 m from the middle of it, looks at it and presses the space bar.
function shutAllDoors(world) {
  for (const d of world.doors) {
    const mx = (d.gap[0][0] + d.gap[1][0]) / 2, my = (d.gap[0][1] + d.gap[1][1]) / 2, nx = -d.collider.uy, ny = d.collider.ux;
    for (const side of [1, -1]) {
      if (d.closed) break;
      const x = mx + nx * side * 0.7, y = my + ny * side * 0.7;
      const p = createPlayer(world, { level: d.level, x, y, yawDeg: (Math.atan2(my - y, mx - x) * 180) / Math.PI });
      useDoor(world, p); // every door starts open, so the first call that finds it shuts it
    }
  }
  return world.doors.filter((d) => d.closed).length;
}

// One attack: a start 0.3 to 1.5 m from a random solid, on a random side, a heading at a point of it (within 25 degrees), forward, walking or running,
// sometimes with a strafe and a turn. Returns the player, the input and how many steps carry it 1.2 m beyond the wall at the speed it has.
function attack(world, sol, rnd, dt) {
  const level = Math.floor(rnd() * world.levels.length);
  const cs = sol[level];
  const c = cs[Math.floor(rnd() * cs.length)];
  const along = c.hx >= c.hy, half = Math.max(0, (along ? c.hx : c.hy) - PLAYER.radius);
  const s = (rnd() * 2 - 1) * half, side = rnd() < 0.5 ? 1 : -1, off = 0.3 + rnd() * 1.2, jitter = (rnd() * 2 - 1) * 0.5;
  // (u, n): the long and the short axis of the solid in the plane
  const [ux, uy] = along ? [c.ux, c.uy] : [-c.uy, c.ux], nx = -uy, ny = ux;
  const tx = c.cx + ux * s, ty = c.cy + uy * s;
  const x = tx + nx * side * off + ux * jitter, y = ty + ny * side * off + uy * jitter;
  const yawDeg = (Math.atan2(ty - y, tx - x) * 180) / Math.PI + (rnd() * 2 - 1) * 25;
  const p = createPlayer(world, { level, x, y, yawDeg });
  const run = rnd() < 0.5;
  const input = { forward: 1, strafe: rnd() < 0.3 ? (rnd() * 2 - 1) * 0.6 : 0, turn: rnd() < 0.3 ? (rnd() * 2 - 1) * 0.4 : 0, run };
  const steps = Math.min(150, Math.ceil((off + 1.2) / ((run ? PLAYER.run : PLAYER.walk) * dt)));
  return { p, input, steps };
}

// Steps the player once and says what went wrong, or '' when nothing did.
function stepChecked(world, sol, p, input, dt) {
  const level = p.level, x = p.x, y = p.y;
  stepPlayer(world, p, input, dt);
  if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) return 'not a number';
  const pen = maxPenetration({ colliders: sol[p.level] }, p.x, p.y, world.radius);
  if (pen > EPS_PEN + 1e-9) return `${pen.toFixed(4)} m inside a solid`;
  if (p.level === level && crossesSolid(sol[level], x, y, p.x, p.y)) return `crossed a solid from (${x.toFixed(3)}, ${y.toFixed(3)}) to (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
  return '';
}

const worlds = () => {
  const window_ = createWorld(twoRooms({ sill: 0.6 })); // the door has a sill too high to step over: its gap is solid, like a window
  const doors = createWorld(twoRooms());
  const flat = createWorld(fileModel('examples/flat-1.plan.json')), duplex = createWorld(fileModel('examples/duplex-1.plan.json'));
  return [['two rooms, a window', window_, 0], ['two rooms, the door shut', doors, 1], ['flat-1, doors shut', flat, flat.doors.length], ['duplex-1, doors shut', duplex, duplex.doors.length]]
    .map(([name, w, doorsWanted]) => {
      const shut = shutAllDoors(w);
      assert.equal(shut, doorsWanted, `${name}: ${shut} of ${doorsWanted} doors shut`);
      return [name, w, w.levels.map((_, i) => solidsOf(w, i))];
    });
};

test('the detector sees a move through a wall and lets one through a passage, round the end of a wall and along it', () => {
  const w = createWorld(twoRooms({ sill: 0.6 })), cs = solidsOf(w, 0);
  assert.equal(crossesSolid(cs, 3.6, 0.5, 4.4, 0.5), true, 'through the wall x = 4');
  assert.equal(crossesSolid(cs, 3.6, 1.45, 4.4, 1.45), true, 'through the gap of the window');
  assert.equal(crossesSolid(cs, 3.6, 3.1, 4.4, 3.1), false, 'through the passage');
  assert.equal(crossesSolid(cs, 3.6, 0.5, 3.6, 1.0), false, 'along the wall');
  assert.equal(crossesSolid(cs, 3.6, 2.2, 4.4, 2.55), true, 'a slant through the wall between the window and the passage');
  assert.equal(crossesSolid(cs, 0.5, 0.5, 0.5, -0.5), true, 'out through the outer wall');
  // the walls shut the way a whole attack on this world sees them
  const d = createWorld(twoRooms());
  assert.equal(shutAllDoors(d), 1);
  assert.equal(crossesSolid(solidsOf(d, 0), 3.6, 1.45, 4.4, 1.45), true, 'through the shut door');
  const o = createWorld(twoRooms());
  assert.equal(crossesSolid(solidsOf(o, 0), 3.6, 1.45, 4.4, 1.45), false, 'through the open one');
});

test('thousands of attacks on the walls at 60, 10, 4 and 2 steps a second: nobody gets through, nobody is left inside a solid', () => {
  const dts = [1 / 60, 0.1, 0.25, 0.5];
  let attacks = 0, steps = 0, leaned = 0;
  for (const [name, world, sol] of worlds()) {
    const rnd = rng(20261031 + name.length);
    for (let k = 0; k < 3000; k++) {
      const dt = dts[k % dts.length];
      const { p, input, steps: n } = attack(world, sol, rnd, dt);
      for (let i = 0; i < n; i++) {
        const why = stepChecked(world, sol, p, input, dt);
        assert.equal(why, '', `${name}, attack ${k}, dt ${dt}, step ${i}: ${why}`);
        steps++;
      }
      attacks++;
      if (p.collisions > 0) leaned++;
    }
  }
  assert.equal(attacks, 12000);
  assert.ok(leaned > attacks * 0.5, `the attacks reach the walls: ${leaned} of ${attacks} touched one`);
  assert.ok(steps > 100000, `${steps} steps`);
});

test('the same, through the slices the page cuts a frame into (8 to 100 ms), also on a run', () => {
  const rnd = rng(1031);
  let attacks = 0, leaned = 0;
  for (const [name, world, sol] of worlds()) {
    for (let k = 0; k < 1000; k++) {
      const { p, input } = attack(world, sol, rnd, 1 / 60);
      for (let f = 0; f < 40; f++) {
        for (const dt of substeps(0.008 + rnd() * 0.092)) {
          const why = stepChecked(world, sol, p, input, dt);
          assert.equal(why, '', `${name}, attack ${k}, frame ${f}: ${why}`);
        }
      }
      attacks++;
      if (p.collisions > 0) leaned++;
    }
  }
  assert.ok(leaned > attacks * 0.5, `${leaned} of ${attacks} touched a wall`);
});

test('one large step does not tunnel: a step of 0.25 s or 0.5 s at a run in front of a window stops at the wall', () => {
  // a step of 1.4 m is cut into slices of at most 4 cm inside stepPlayer; with slices of 40 cm the walker jumps the wall (0.3 thick, 0.2 radius)
  const w = createWorld(twoRooms({ sill: 1.2 }));
  let blocked = 0;
  for (const dt of [0.25, 0.5]) {
    for (let k = 0; k < 300; k++) {
      // y 0.45 to 1.65 and a heading within 24 degrees of the wall: the step cannot reach the passage (y 2.6 to 3.6) that is open on purpose
      const p = createPlayer(w, { x: 3.3 + (k % 10) * 0.05, y: 0.45 + (k % 7) * 0.2, yawDeg: ((k % 9) - 4) * 6 });
      stepPlayer(w, p, { forward: 1, run: true }, dt);
      assert.ok(p.x < 3.8, `dt ${dt}, attack ${k}: x = ${p.x.toFixed(3)} is behind the wall`);
      if (p.collisions > 0) blocked++;
    }
  }
  assert.ok(blocked > 300, `${blocked} of 600 steps met the wall`);
});
