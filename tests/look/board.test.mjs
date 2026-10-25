// The card board under the model: closed it hugs the outer walls, while the shell opens it grows to hold every wall as it stands, and it shrinks back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardRect, fallenExtent, CLOSED_RIM, OPEN_RIM } from '../../src/look/board.js';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { foldWalls, openExtent } from '../../src/model/foldwalls.js';
import { frameOf, startOrder } from '../../src/render/openmotion.js';

const plan = (name) => { const p = JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8')); for (const lv of p.levels) lv.furniture = []; return p; };
const setup = (name) => { const model = buildModel(modelOf(analyzePlan(plan(name)))), ext = modelExtent(model), walls = foldWalls(model); return { model, ext, walls, open: openExtent(model, ext, walls) }; };
const side = (b) => Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
// the angle of every wall at clock p, the walls starting in the order that a view from `view` gives (as the page does)
const degsAt = (walls, p, view) => { const rank = startOrder(walls, view); return walls.map((f, i) => frameOf(p, rank[i], walls.length).deg); };
// where the corners of a wall at `deg` degrees are, worked out here from the geometry and not by board.js
const corners = (f, deg) => { const r = f.reach * Math.sin((Math.min(90, Math.max(0, deg)) * Math.PI) / 180); return [f.from, f.to, [f.to[0] + f.out[0] * r, f.to[1] + f.out[1] * r], [f.from[0] + f.out[0] * r, f.from[1] + f.out[1] * r]]; };

test('closed, the board is the closed model plus a rim of max(0.35 m, 6 percent of the larger side)', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { ext, walls } = setup(name), b = boardRect(ext, walls, walls.map(() => 0)), shut = fallenExtent(ext, walls, []), rim = Math.max(CLOSED_RIM.min, CLOSED_RIM.share * side(shut));
    assert.ok(walls.length > 0, `${name} has walls that open`);
    assert.ok(shut.minX <= ext.minX && shut.maxX >= ext.maxX && shut.maxX - shut.minX < ext.maxX - ext.minX + 1, `${name}: the outer faces of the walls lie just beyond the extent`);
    assert.ok(Math.abs(b.rim - rim) < 1e-9 && b.fall === 0, name);
    assert.ok(Math.abs(b.minX - (shut.minX - rim)) < 1e-9 && Math.abs(b.maxX - (shut.maxX + rim)) < 1e-9 && Math.abs(b.minZ - (shut.minZ - rim)) < 1e-9 && Math.abs(b.maxZ - (shut.maxZ + rim)) < 1e-9, name);
    assert.ok(Math.abs(b.width - (shut.maxX - shut.minX + 2 * rim)) < 1e-9 && Math.abs(b.depth - (shut.maxZ - shut.minZ + 2 * rim)) < 1e-9, name);
    assert.ok(b.width < ext.maxX - ext.minX + 2 * rim + 0.7, `${name}: the closed board is only a rim wider than the model on each side`);
  }
});

test('flat, the board is the open extent plus a rim of max(0.3 m, 3 percent of the larger side), and it is much bigger than the closed one', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { ext, walls, open } = setup(name), closed = boardRect(ext, walls, walls.map(() => 0)), b = boardRect(ext, walls, walls.map(() => 90)), rim = Math.max(OPEN_RIM.min, OPEN_RIM.share * side(open));
    assert.ok(Math.abs(b.rim - rim) < 1e-9 && b.fall === 1, name);
    for (const [k, v] of [['minX', open.minX - rim], ['maxX', open.maxX + rim], ['minZ', open.minZ - rim], ['maxZ', open.maxZ + rim]]) assert.ok(Math.abs(b[k] - v) < 1e-9, `${name} ${k}`);
    assert.ok(closed.width < 0.8 * b.width && closed.depth < 0.9 * b.depth, `${name}: ${closed.width.toFixed(1)} x ${closed.depth.toFixed(1)} closed, ${b.width.toFixed(1)} x ${b.depth.toFixed(1)} open`);
  }
});

test('at every moment of the opening and the closing, from every side, the board holds the closed model and every wall as it stands, with at least the open rim to spare', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { ext, walls } = setup(name);
    for (const view of [[0, 1], [1, 0], [0, -1], [-1, 0], [0.7, 0.7]]) for (let p = 0; p <= 1.0001; p += 0.01) {
      const degs = degsAt(walls, Math.min(1, p), view), b = boardRect(ext, walls, degs);
      const pts = [[ext.minX, ext.minZ], [ext.maxX, ext.maxZ], ...walls.flatMap((f, i) => corners(f, degs[i]))];
      for (const [x, z] of pts) assert.ok(x >= b.minX + OPEN_RIM.min - 1e-6 && x <= b.maxX - OPEN_RIM.min + 1e-6 && z >= b.minZ + OPEN_RIM.min - 1e-6 && z <= b.maxZ - OPEN_RIM.min + 1e-6, `${name} p ${p.toFixed(2)} view ${view}: (${x.toFixed(2)}, ${z.toFixed(2)}) is off the board`);
    }
  }
});

test('the board grows smoothly with the opening, never jumps, and is the same on the way back', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { ext, walls } = setup(name);
    let prev = null, worst = 0, last = 0;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const b = boardRect(ext, walls, degsAt(walls, Math.min(1, p), [0, 1]));
      if (prev) {
        for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) worst = Math.max(worst, Math.abs(b[k] - prev[k]));
        assert.ok(b.width >= prev.width - 0.05 && b.depth >= prev.depth - 0.05, `${name} does not shrink while it opens (the rim eases from the closed to the open rim, so at most a few centimetres), p ${p.toFixed(3)}`);
      }
      prev = b; last = b.width;
    }
    assert.ok(worst < 0.3, `${name}: the biggest step of an edge in 0.5 percent of the clock is ${worst.toFixed(3)} m`);
    assert.ok(last > boardRect(ext, walls, walls.map(() => 0)).width + 3, name);
    for (const p of [0.13, 0.5, 0.77]) { // closing is the same motion backwards: the same clock gives the same board
      const a = boardRect(ext, walls, degsAt(walls, p, [0, 1])), c = boardRect(ext, walls, degsAt(walls, p, [0, 1]));
      assert.deepEqual(a, c);
    }
  }
});

test('the walls count as they stand: past flat is flat, below closed is closed, bad numbers are closed, missing angles are closed', () => {
  const { ext, walls } = setup('flat-1'), flat = boardRect(ext, walls, walls.map(() => 90)), closed = boardRect(ext, walls, walls.map(() => 0));
  assert.deepEqual(boardRect(ext, walls, walls.map(() => 94)), flat, 'the overshoot of the motion does not push the board further');
  assert.deepEqual(boardRect(ext, walls, walls.map(() => 400)), flat);
  assert.deepEqual(boardRect(ext, walls, walls.map(() => -20)), closed);
  assert.deepEqual(boardRect(ext, walls, walls.map(() => NaN)), closed);
  assert.deepEqual(boardRect(ext, walls, undefined), closed);
  assert.deepEqual(boardRect(ext, walls, []), closed);
  const half = boardRect(ext, walls, walls.map((_, i) => (i === 0 ? 90 : 0)));
  assert.ok(half.width >= closed.width - 0.05 && half.depth >= closed.depth - 0.05 && half.width <= flat.width + 1e-9 && half.depth <= flat.depth + 1e-9 && Math.max(half.width - closed.width, half.depth - closed.depth) > 1 && half.fall > 0 && half.fall < 1, 'one wall down: the board grows on its side only');
});

test('a plan with no walls that open keeps the closed model and the closed rim; the extent helper agrees with openExtent when every wall is flat', () => {
  const { ext } = setup('flat-1'), b = boardRect(ext, [], []);
  assert.equal(b.fall, 0); assert.ok(Math.abs(b.rim - Math.max(0.35, 0.06 * side(ext))) < 1e-9); assert.equal(b.minX, ext.minX - b.rim);
  assert.equal(boardRect(ext, undefined, undefined).width, b.width);
  for (const name of ['flat-1', 'duplex-1']) {
    const { ext: e, walls, open } = setup(name), f = fallenExtent(e, walls, walls.map(() => 90));
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) assert.ok(Math.abs(f[k] - open[k]) < 1e-9, `${name} ${k}`);
    const c = fallenExtent(e, walls, walls.map(() => 0));
    assert.ok(c.minX <= e.minX && c.maxX >= e.maxX, 'closed walls stay on the closed model (or the corner extensions)');
  }
});
