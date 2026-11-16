// The slab round a stair opening has a hole a hair wider than the opening (1.2 cm), so that its cut faces stand inside the walls of the shaft and do not fight them;
// the floor above and the ceiling below keep the exact outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { PlanScene, widenHole } from '../../src/render/scene.js';

const any = () => new Proxy(function stub() {}, { get: (t, k) => (k === 'width' ? 100 : k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : () => any()), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const outer = (p) => [['a', [0, 0], [6, 0]], ['b', [6, 0], [6, 6]], ['c', [6, 6], [0, 6]], ['d', [0, 6], [0, 0]]].map(([id, from, to]) => ({ id: `${p}${id}`, from, to, kind: 'exterior' }));
const plan = () => ({
  version: 1, name: 'slab', units: 'm',
  levels: [
    { id: 'L0', name: 'Ground', height: 2.7, walls: outer('g'), openings: [], rooms: [{ id: 'low', name: 'Hall', use: 'hall', polygon: rect(0, 0, 6, 6), floor: 'wood' }], stairs: [{ id: 's', from: [0.65, 5.4], to: [0.65, 1.65], width: 1.0, steps: 16, to_level: 'L1' }] },
    { id: 'L1', name: 'Upper', height: 2.7, walls: outer('u'), openings: [], rooms: [{ id: 'up', name: 'Gallery', use: 'hall', polygon: rect(0, 0, 6, 6), floor: 'wood' }], stairs: [] },
  ],
});
const area = (p) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2;

test('widenHole moves every edge of a convex outline out by e, in either winding, and keeps the centre', () => {
  for (const poly of [rect(0.15, 1.5, 1.15, 5.5), rect(0.15, 1.5, 1.15, 5.5).reverse(), [[0, 0], [2, 1], [1, 3], [-1, 2]]]) {
    const w = widenHole(poly, 0.1), c = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    assert.equal(w.length, poly.length);
    assert.ok(area(w) > area(poly));
    for (let i = 0; i < poly.length; i++) { // each new edge lies 0.1 outside the old one
      const p = poly[i], q = poly[(i + 1) % poly.length], a = w[i], b = w[(i + 1) % w.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
      const dist = (pt) => Math.abs((pt[0] - p[0]) * dy - (pt[1] - p[1]) * dx) / l;
      assert.ok(Math.abs(dist(a) - 0.1) < 1e-9 && Math.abs(dist(b) - 0.1) < 1e-9, `edge ${i}`);
    }
    if (poly.length === 4 && poly[0][0] === 0.15) assert.ok(Math.abs(c(w)[0] - c(poly)[0]) < 1e-9 && Math.abs(c(w)[1] - c(poly)[1]) < 1e-9);
  }
});

test('the slab cut round the stair is 1.2 cm wider than the opening; the floor plate keeps the opening exactly', () => {
  const model = buildModel(modelOf(analyzePlan(plan()))), ps = new PlanScene(model, 'textured');
  const hole = model.levels[1].rooms[0].floorHoles[0], xs = hole.map((p) => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const span = (name) => { // the x values of the vertices of a mesh that fall near the opening (the outer outline of the room is at 0 and 6)
    let lo = Infinity, hi = -Infinity;
    ps.group.traverse((o) => { if (o.name === name && o.geometry) { const pos = o.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x > 0.05 && x < 1.5) { lo = Math.min(lo, x); hi = Math.max(hi, x); } } } });
    return [lo, hi];
  };
  const [s0, s1] = span('room:up/slab');
  assert.ok(Math.abs(s0 - (x0 - 0.012)) < 1e-4 && Math.abs(s1 - (x1 + 0.012)) < 1e-4, `slab ${s0} ${s1} against ${x0 - 0.012} ${x1 + 0.012}`);
  const [f0, f1] = span('room:up/floor');
  assert.ok(Math.abs(f0 - x0) < 1e-4 && Math.abs(f1 - x1) < 1e-4, `floor ${f0} ${f1} against ${x0} ${x1}`);
});
