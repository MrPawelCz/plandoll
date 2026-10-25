// fitView with a list of points (the open shell frames the closed model and every wall lying flat) and openPoints: the points all land in the picture, the fit is
// tighter than the fit of the box round them, and without the list fitView is what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitView, stateFrom, positionOf } from '../../src/app/camera.js';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { foldWalls, openExtent, openPoints, flatFootprint } from '../../src/model/foldwalls.js';

const plan = (name) => { const p = JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8')); for (const lv of p.levels) lv.furniture = []; return p; };
const setup = (name) => { const model = buildModel(modelOf(analyzePlan(plan(name)))), ext = modelExtent(model), walls = foldWalls(model); return { model, ext, walls, open: openExtent(model, ext, walls), pts: openPoints(model, ext, walls) }; };
const STATE = stateFrom([0.5, 0.7, 0.7].map((v) => v * 20), [0, 0, 0]); // the default direction of the page
const RAD = Math.PI / 180;
// where a point lands in the picture for a camera at `distance` from `target`, as tangent fractions of the half picture (x right, y up): { x, y }
function landing(state, target, distance, p, fov, aspect) {
  const az = state.azimuth * RAD, po = state.polar * RAD, sa = Math.sin(az), ca = Math.cos(az), sp = Math.sin(po), cp = Math.cos(po);
  const f = [-sp * sa, -cp, -sp * ca], r = [ca, 0, -sa], u = [-cp * sa, sp, -cp * ca], v = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], th = Math.tan((fov * RAD) / 2), depth = distance + dot(v, f);
  return { x: dot(v, r) / (depth * th * aspect), y: dot(v, u) / (depth * th) };
}

test('openPoints: the eight corners of the closed model and four corners, at two heights, of every wall lying flat', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { model, ext, walls, pts } = setup(name);
    assert.equal(pts.length, 8 + walls.length * 8, name);
    assert.ok(pts.every((p) => p.length === 3 && p.every(Number.isFinite)));
    for (const f of walls) for (const [x, z] of flatFootprint(f)) assert.ok(pts.some((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[2] - z) < 1e-9 && p[1] <= ext.maxY), `${name} ${f.id}`);
    walls.forEach((f, i) => { // the eight points of each wall (two heights of four corners) lie at the foot of its own level, not at the height of the top of the model
      const base = model.levels[f.level].elevation + f.y, mine = pts.slice(8 + i * 8, 16 + i * 8).map((p) => p[1]);
      assert.deepEqual([...new Set(mine.map((y) => +y.toFixed(9)))].sort((a, b) => a - b), [+base.toFixed(9), +(base + f.thickness).toFixed(9)], `${name} ${f.id}`);
    });
    assert.deepEqual(openPoints({ levels: [] }, { minX: 0, maxX: 1, minY: 0, maxY: 2, minZ: 0, maxZ: 3 }).length, 8);
    assert.ok(model);
  }
});

test('fitView with points: every point lands inside the margin, on both sides of the picture, with and without room kept for bars', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { open, pts } = setup(name);
    for (const [aspect, bottom] of [[1.6, 0], [1.6, 0.18], [390 / 844, 0], [390 / 844, 0.3]]) {
      const fit = fitView(STATE, open, { fov: 27, aspect, bottom, points: pts }), k = 1 - 0.08, up = (1 - bottom) * k + bottom, dn = (1 - bottom) * k - bottom;
      for (const p of pts) {
        const q = landing(STATE, fit.target, fit.distance, p, 27, aspect);
        assert.ok(Math.abs(q.x) <= k + 1e-6, `${name} aspect ${aspect.toFixed(2)} x ${q.x.toFixed(3)}`);
        assert.ok(q.y <= up + 1e-6 && q.y >= -dn - 1e-6, `${name} aspect ${aspect.toFixed(2)} bottom ${bottom} y ${q.y.toFixed(3)}`);
      }
      assert.ok(Number.isFinite(fit.distance) && fit.target.every(Number.isFinite));
    }
  }
});

test('the fit of the points is tighter than the fit of the box round them, and never looser', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const { open, pts } = setup(name);
    for (const aspect of [1.6, 390 / 844]) {
      const box = fitView(STATE, open, { fov: 27, aspect }), tight = fitView(STATE, open, { fov: 27, aspect, points: pts });
      assert.ok(tight.distance <= box.distance + 1e-9, `${name} ${aspect}`);
      assert.ok(tight.distance < box.distance * 0.97, `${name} ${aspect.toFixed(2)}: ${tight.distance.toFixed(2)} against ${box.distance.toFixed(2)} for the box`);
    }
  }
});

test('without points, or with points that are unusable, fitView gives what it always gave', () => {
  const { open } = setup('flat-1'), base = fitView(STATE, open, { fov: 27, aspect: 1.6 });
  assert.deepEqual(fitView(STATE, open, { fov: 27, aspect: 1.6, points: undefined }), base);
  assert.deepEqual(fitView(STATE, open, { fov: 27, aspect: 1.6, points: [] }), base);
  assert.deepEqual(fitView(STATE, open, { fov: 27, aspect: 1.6, points: [[NaN, 0, 0], [1, 2], 'x', null] }), base);
  assert.deepEqual(fitView(STATE, open, { fov: 27, aspect: 1.6, points: 'nope' }), base);
  const one = fitView(STATE, open, { fov: 27, aspect: 1.6, points: [[1, 1, 1], [NaN, 0, 0]] });
  assert.ok(Number.isFinite(one.distance), 'a single usable point still gives a number');
  assert.ok(positionOf({ ...STATE, distance: one.distance }, one.target).every(Number.isFinite));
});
