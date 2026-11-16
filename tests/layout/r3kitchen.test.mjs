// The flat kitchen has a real worktop in an L from a corner, and living rooms have no lone armchair on a big rug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadRepo, loadPlan, buildAll, layoutFor } from '../../tools/audit/data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await loadRepo(ROOT);
const lay = (name, seed) => layoutFor(R, buildAll(R, loadPlan(R, name)), { seed });
const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) - Math.max(q.size[0], q.size[1]) / 2; // from the edge of the sofa or table
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const COUNTER = ['kitchen-base', 'kitchen-sink', 'kitchen-hob'];

test('flat-2 kitchen: at least 3 m of worktop in an L that starts in a corner, no lone cabinet', () => {
  for (const seed of [1, 2, 3, 4]) {
    const ps = lay('flat-2', seed).levels[0].pieces.filter((p) => p.room === 'kitchen');
    const run = ps.filter((p) => COUNTER.includes(p.type));
    assert.ok(run.reduce((s, p) => s + p.size[0], 0) >= 3.0, `worktop length, seed ${seed}`);
    assert.ok(new Set(run.map((p) => p.rot)).size >= 2, `an L (two wall directions), seed ${seed}`);
    for (const p of run) {
      const touching = ps.filter((q) => q !== p && [...COUNTER, 'fridge'].includes(q.type) && dist(p, q) < (p.size[0] + q.size[0]) / 2 + 0.7);
      assert.ok(touching.length >= 1, `${p.type} ${p.id} stands alone, seed ${seed}`);
    }
    assert.ok(ps.some((p) => p.type === 'fridge'), 'fridge');
  }
});

test('living rooms: no armchair on its own with a rug, rugs lie under furniture', () => {
  for (const name of ['flat-2', 'duplex-2']) for (const seed of [1, 2, 3, 4]) {
    for (const lv of lay(name, seed).levels) {
      const ps = lv.pieces.filter((p) => p.room === 'living');
      const solid = ps.filter((p) => p.type !== 'rug' && !p.on && (p.elev ?? 0) < 0.3 && p.size[2] > 0.2);
      for (const rug of ps.filter((p) => p.type === 'rug')) {
        const under = solid.some((q) => Math.abs(q.x - rug.x) < rug.size[0] / 2 + 0.2 && Math.abs(q.y - rug.y) < rug.size[0] / 2 + 0.2);
        assert.ok(under, `rug ${rug.id} lies under nothing in ${name} seed ${seed}`);
      }
      const sofas = ps.filter((p) => /^sofa/.test(p.type)), tables = ps.filter((p) => /^coffee-table/.test(p.type));
      const lamps = ps.filter((p) => p.type === 'floor-lamp');
      for (const a of ps.filter((p) => p.type === 'armchair')) {
        const grouped = [...sofas, ...tables].some((q) => near(a, q) <= 1.5);
        const nook = lamps.some((l) => near(a, l) <= 1.6);
        assert.ok(grouped || nook, `armchair ${a.id} is neither in the seating group nor in a corner with a lamp (${name} seed ${seed})`);
      }
      if (ps.length) assert.ok(ps.reduce((n, p) => n + ({ sofa2: 2, sofa3: 3, armchair: 1, pouf: 1, 'sofa-bed': 2 }[p.type] ?? 0), 0) >= 5, `living seats, ${name} seed ${seed}`);
    }
  }
});
