// Reachability on the bundled examples: from where Spacer starts, every room can be reached and every door can be walked up to from both sides.
// Node only, no browser. The model of the page has no furniture, so only the walls, the rails and the stairs narrow the floor.
// Ported (cut down) from planwalk tests/viewer/walk-examples.test.mjs (MIT, same author), source commit fa1a280 (v0.3.2): the checks that count the
// footprints of the furniture (a gap between a coffee table and a sofa) are gone with the furniture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon } from '../../src/core/geom2d.js';
import { PLAYER, roomAt } from '../../src/model/geometry.js';
import { createWorld, createPlayer, stepPlayer, defaultSpawn, maxPenetration } from '../../src/model/physics.js';
import { fileModel } from '../helpers/walk-model.mjs';

const modelOf = fileModel;
const EXAMPLES = ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json'];
const CELL = 0.05, R = PLAYER.radius;

// Where the centre of the player may stand on a level, grown from a seed over cells that share an edge.
function reachable(model, levelIndex, seed) {
  const lv = model.levels[levelIndex], b = model.bounds;
  const nx = Math.ceil((b.maxX - b.minX) / CELL) + 1, ny = Math.ceil((b.maxY - b.minY) / CELL) + 1;
  const cell = (x, y) => [Math.round((x - b.minX) / CELL), Math.round((y - b.minY) / CELL)];
  const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && maxPenetration(lv, b.minX + i * CELL, b.minY + j * CELL, R) <= 1e-3;
  const seen = new Uint8Array(nx * ny);
  // The player who has just climbed a stair stands a few millimetres from a wall, so the cell nearest to the seed can be a hair inside it: start from the nearest free one.
  const [ci, cj] = cell(seed[0], seed[1]);
  let start = null;
  for (let r = 0; r <= 6 && !start; r++) for (let di = -r; di <= r && !start; di++) for (let dj = -r; dj <= r && !start; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(ci + di, cj + dj)) start = [ci + di, cj + dj];
  assert.ok(start, `no free floor within 30 cm of where the player arrives, around (${seed[0].toFixed(2)}, ${seed[1].toFixed(2)})`);
  const stack = [start];
  seen[start[1] * nx + start[0]] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (free(a, c) && !seen[c * nx + a]) { seen[c * nx + a] = 1; stack.push([a, c]); }
  }
  return {
    has: (x, y) => { const [i, j] = cell(x, y); return i >= 0 && j >= 0 && i < nx && j < ny && seen[j * nx + i] === 1; },
    free: (x, y) => { const [i, j] = cell(x, y); return free(i, j); },
  };
}

// One seed per level: where Spacer starts, and where the stair from a level that is already reached arrives (found by walking it).
function seeds(model) {
  const sp = defaultSpawn(model), out = new Map([[sp.level, [sp.x, sp.y]]]), world = createWorld(model);
  for (let pass = 0; pass < model.levels.length; pass++) {
    for (const st of model.stairs) {
      if (!out.has(st.lower) || out.has(st.upper)) continue;
      const p = createPlayer(world, { level: st.lower, x: st.from[0] - st.dir[0] * 0.3, y: st.from[1] - st.dir[1] * 0.3 });
      p.yaw = Math.atan2(st.dir[1], st.dir[0]);
      for (let i = 0; i < 600 && p.level !== st.upper; i++) stepPlayer(world, p, { forward: 1 }, 1 / 60);
      if (p.level === st.upper) { for (let i = 0; i < 30; i++) stepPlayer(world, p, { forward: 1 }, 1 / 60); out.set(st.upper, [p.x, p.y]); }
    }
  }
  return out;
}

for (const file of EXAMPLES) {
  test(`${file}: every room can be reached from where Spacer starts, with the walls and stairs in the way`, () => {
    const m = modelOf(file), seedAt = seeds(m);
    for (const lv of m.levels) {
      const seed = seedAt.get(lv.index);
      assert.ok(seed, `${lv.id}: no way to this level was found`);
      const reach = reachable(m, lv.index, seed);
      for (const room of lv.rooms) {
        const xs = room.polygon.map((q) => q[0]), ys = room.polygon.map((q) => q[1]);
        let free = 0, got = 0;
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += CELL) for (let y = Math.min(...ys); y <= Math.max(...ys); y += CELL) {
          if (!pointInPolygon([x, y], room.polygon) || !reach.free(x, y)) continue;
          free++;
          if (reach.has(x, y)) got++;
        }
        assert.ok(free > 0, `${lv.id}/${room.id}: no free floor at all`);
        const lost = (free - got) * CELL * CELL; // a few cells next to a wall are rounding of the grid, 0.05 m2 or more is a corner that the player cannot get into
        assert.ok(lost < 0.05, `${lv.id}/${room.id}: ${lost.toFixed(2)} m2 of its free floor cannot be reached (${Math.round((100 * got) / free)} % of it can)`);
      }
    }
  });

  test(`${file}: every door can be walked up to from both sides`, () => {
    const m = modelOf(file), seedAt = seeds(m);
    for (const lv of m.levels) {
      const reach = reachable(m, lv.index, seedAt.get(lv.index));
      for (const o of lv.openings.filter((q) => q.type !== 'window')) {
        const w = lv.wallById.get(o.wallId), um = (o.u0 + o.u1) / 2;
        const cx = w.from[0] + w.dir[0] * um, cy = w.from[1] + w.dir[1] * um;
        for (const side of [1, -1]) {
          if (!roomAt(lv, cx + w.normal[0] * side * 0.5, cy + w.normal[1] * side * 0.5)) continue; // the street side of the front door
          // a spot on that side that the player can stand on and walk to: 0.3 to 0.9 m from the door, within 0.3 m of its middle
          let open = false;
          for (let t = 0.3; t <= 0.9 && !open; t += 0.05) for (let d = -0.3; d <= 0.3 && !open; d += 0.1) open = reach.has(cx + w.normal[0] * side * t + w.dir[0] * d, cy + w.normal[1] * side * t + w.dir[1] * d);
          assert.ok(open, `${lv.id}/${o.id}: the walls leave no way up to the door on its ${side > 0 ? 'front' : 'back'} side, around (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
        }
      }
    }
  });
}

// A route through the flat-1 living room into the study: the walk goes round the end of the wall and through the study door, clear of the walls on every step.
test('flat-1: the route from the living room into the study through its door is clear of walls', () => {
  const m = modelOf('examples/flat-1.plan.json'), world = createWorld(m);
  const p = createPlayer(world, { level: 0, x: 2.9, y: 1.6, yawDeg: 0 });
  const goTo = ([tx, ty]) => {
    for (let i = 0; i < 6 * 60; i++) {
      if (Math.hypot(tx - p.x, ty - p.y) < 0.1) return true;
      p.yaw = Math.atan2(ty - p.y, tx - p.x);
      stepPlayer(world, p, { forward: 1 }, 1 / 60);
      assert.ok(maxPenetration(m.levels[0], p.x, p.y, R) <= 1e-3, `the route runs into a wall at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    }
    return false;
  };
  for (const wp of [[3.5, 1.6], [4.55, 1.6], [4.62, 2.6], [4.6, 3.4], [6.0, 4.0]]) assert.ok(goTo(wp), `stuck at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) on the way to (${wp})`);
  assert.equal(roomAt(m.levels[0], p.x, p.y)?.id, 'study');
});
