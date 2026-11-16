// The built-in examples (flat-2 and duplex-2, opened as Flat and Duplex) and the old ones (flat-1, duplex-1): valid, furnished the same way
// twice, and held to the rules of docs/DESIGN.md 3.4 with a checker of their own (no helper of the engine): nothing overlaps or leaves its
// room (A1, A2), nothing stands in a door zone of 0.9 m (A3), nothing stands at the foot or the head of a stair (A5), every room and every
// piece that needs a way to it can be reached by a disc of 0.7 m from the front door, also between the floors (B3), and the stair of the
// house is a stair one can climb (C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish, checkLayout } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { SPEC_BY_ID } from '../../src/furniture/specs.js';
import { levelZones, obb, boxAlong, penetration } from '../../src/layout/geometry.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const modelOfPlan = (plan) => { const res = analyzePlan(plan); assert.ok(res.ok, JSON.stringify(res.errors)); return buildModel(modelOf(res)); };
const NAMES = ['flat-2', 'duplex-2', 'flat-1', 'duplex-1'];
const NEW = ['flat-2', 'duplex-2'];
const furnish = (model, seed = 1) => autoFurnish(model, { seed, allowedTypes: piecesImplemented() });

const FRONT_NEEDED = new Set(['wardrobe', 'wardrobe-small', 'fridge', 'kitchen-sink', 'kitchen-hob', 'toilet', 'washbasin', 'shower', 'bathtub', 'washing-machine', 'bookshelf', 'dresser', 'desk']);
const solid = (spec) => (spec.place.mode === 'floor' || spec.place.mode === 'corner') && spec.id !== 'rug' && spec.id !== 'rug-runner';

// ---- an own grid: discs of 0.7 m between walls and pieces
function rectDist(px, py, c, ux, uy, hw, hd) {
  const dx = px - c[0], dy = py - c[1];
  const lx = Math.abs(dx * ux + dy * uy) - hw, ly = Math.abs(-dx * uy + dy * ux) - hd;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}
function wallRects(level) {
  const out = [];
  for (const w of level.walls) {
    const gaps = level.openings.filter((o) => o.wallId === w.id && (o.type === 'door' || o.type === 'passage')).map((o) => [o.u0, o.u1]).sort((a, b) => a[0] - b[0]);
    let cur = -w.thickness / 2;
    const cut = (a, b) => { if (b - a > 0.01) out.push({ c: [w.from[0] + w.dir[0] * (a + b) / 2, w.from[1] + w.dir[1] * (a + b) / 2], ux: w.dir[0], uy: w.dir[1], hw: (b - a) / 2, hd: w.thickness / 2 }); };
    for (const [a, b] of gaps) { cut(cur, a); cur = Math.max(cur, b); }
    cut(cur, w.length + w.thickness / 2);
  }
  return out;
}
function grid(model, layout, li, r) {
  const level = model.levels[li];
  const b = model.bounds, step = 0.05;
  const nx = Math.ceil((b.width + 0.4) / step), ny = Math.ceil((b.height + 0.4) / step), x0 = b.minX - 0.2, y0 = b.minY - 0.2;
  const rects = wallRects(level);
  const L = layout.levels.find((l) => l.id === level.id);
  for (const p of L.pieces) {
    const spec = SPEC_BY_ID[p.type];
    if (!solid(spec) || p.elev > 0.5) continue;
    const rad = (p.rot * Math.PI) / 180;
    rects.push({ c: [p.x, p.y], ux: Math.cos(rad), uy: Math.sin(rad), hw: p.size[0] / 2, hd: p.size[1] / 2 });
  }
  const free = new Uint8Array(nx * ny);
  const holes = level.rooms.flatMap((rm) => rm.floorHoles ?? []);
  const inPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside; return inside; };
  const rooms = level.rooms.filter((rm) => rm.polygon.length >= 3);
  const lowerStairs = model.stairs.filter((s) => s.lower === li);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * step, y = y0 + (j + 0.5) * step;
    if (!rooms.some((rm) => inPoly(x, y, rm.polygon))) continue;
    if (holes.some((h) => inPoly(x, y, h))) continue;
    if (lowerStairs.some((s) => inPoly(x, y, s.footprint))) { free[j * nx + i] = 1; continue; }
    let ok = true;
    for (const q of rects) if (rectDist(x, y, q.c, q.ux, q.uy, q.hw, q.hd) < r) { ok = false; break; }
    free[j * nx + i] = ok ? 1 : 0;
  }
  const at = (x, y) => { const i = Math.round((x - x0) / step - 0.5), j = Math.round((y - y0) / step - 0.5); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const near = (x, y, maxD) => {
    const k0 = at(x, y), n = Math.ceil(maxD / step);
    if (k0 < 0) return -1;
    const ci = k0 % nx, cj = (k0 - ci) / nx;
    let best = -1, bd = Infinity;
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= ny || !free[j * nx + i]) continue;
      const d = Math.hypot(i - ci, j - cj) * step;
      if (d <= maxD && d < bd) { bd = d; best = j * nx + i; }
    }
    return best;
  };
  const flood = (seeds, comp = new Uint8Array(nx * ny)) => {
    const q = [];
    for (const k of seeds) if (k >= 0 && !comp[k]) { comp[k] = 1; q.push(k); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx, j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        if (!free[kk] || comp[kk]) continue;
        if (di && dj && !(free[j * nx + ii] && free[jj * nx + i])) continue; // no squeezing through the corner of two obstacles
        comp[kk] = 1; q.push(kk);
      }
    }
    return comp;
  };
  return { at, near, flood, nx, step, x0, y0 };
}

// the entrance: the door named `front`, or else a door on an exterior wall; the walker starts 0.5 m inside it
function entrance(model) {
  const level = model.levels[0];
  const door = level.openings.find((o) => o.id === 'front') ?? level.openings.find((o) => o.type === 'door' && level.wallById.get(o.wallId).kind === 'exterior');
  const w = level.wallById.get(door.wallId), um = (door.u0 + door.u1) / 2;
  return [w.from[0] + w.dir[0] * um + w.normal[0] * 0.5, w.from[1] + w.dir[1] * um + w.normal[1] * 0.5];
}

for (const name of NAMES) {
  test(`${name}: valid, furnished the same way twice, no violation of the engine's own check`, () => {
    const plan = example(name);
    const model = modelOfPlan(plan);
    const a = furnish(model, 5), b = furnish(model, 5);
    assert.deepEqual(a, b);
    const bad = checkLayout(model, a, { allowedTypes: piecesImplemented() }).filter((v) => v.kind !== 'missing-set');
    assert.deepEqual(bad, []);
  });
}

for (const name of NEW) {
  for (const seed of [1, 2, 3, 4]) {
    test(`${name}, seed ${seed}: A1, A2, A3 (0.9 m door zones) and A5 hold`, () => {
      const model = modelOfPlan(example(name));
      const layout = furnish(model, seed);
      // A1 and A2 through the engine's check, A3 and A5 with the strict zones of 0.9 m and 0.95 m
      const bad = checkLayout(model, layout, { allowedTypes: piecesImplemented() }).filter((v) => ['overlap', 'outside-room'].includes(v.kind));
      assert.deepEqual(bad, []);
      const rules = [];
      for (const L of layout.levels) {
        const level = model.levels.find((l) => l.id === L.id);
        const zones = levelZones(level, model, 0.9);
        for (const p of L.pieces) {
          const spec = SPEC_BY_ID[p.type];
          if (!solid(spec) && spec.place.mode !== 'wall-mount') continue;
          if (p.type === 'rug') continue;
          const box = obb(p.x, p.y, p.size[0], p.size[1], p.rot);
          for (const d of zones.doors) if (p.elev < d.top && penetration(box, d.box) > 0.004) rules.push(`${L.id} ${p.type} in the zone of ${d.o.id}`);
          for (const s of zones.stairs) if (penetration(box, s.box) > 0.004) rules.push(`${L.id} ${p.type} on the stair`);
        }
      }
      assert.deepEqual(rules, []);
    });

    test(`${name}, seed ${seed}: every room and every piece that needs a way to it is reached by a disc of 0.7 m from the front door (B3)`, () => {
      const model = modelOfPlan(example(name));
      const layout = furnish(model, seed);
      const miss = [];
      model.levels.forEach((level, li) => {
        const g = grid(model, layout, li, 0.31);
        let comp;
        if (li === 0) comp = g.flood([g.near(...entrance(model), 0.6)]);
        else {
          const st = model.stairs.find((s) => s.upper === li);
          assert.ok(st, 'a level above the first one needs a stair');
          const top = [st.to[0] + st.dir[0] * (st.run / 2 + 0.5), st.to[1] + st.dir[1] * (st.run / 2 + 0.5)];
          comp = g.flood([g.near(top[0], top[1], 0.6)]);
        }
        const touches = (x, y, d) => { const k = g.near(x, y, d); return k >= 0 && comp[k]; };
        const L = layout.levels.find((l) => l.id === level.id);
        for (const room of level.rooms) {
          const xs = room.polygon.map((p) => p[0]), ys = room.polygon.map((p) => p[1]);
          const doors = level.openings.filter((o) => (o.type === 'door' || o.type === 'passage'));
          const ok = doors.some((o) => { const w = level.wallById.get(o.wallId), um = (o.u0 + o.u1) / 2, cx = w.from[0] + w.dir[0] * um, cy = w.from[1] + w.dir[1] * um; return cx >= Math.min(...xs) - 0.2 && cx <= Math.max(...xs) + 0.2 && cy >= Math.min(...ys) - 0.2 && cy <= Math.max(...ys) + 0.2 && [1, -1].some((s) => touches(cx + w.normal[0] * s * 0.5, cy + w.normal[1] * s * 0.5, 0.15)); });
          if (!ok) miss.push(`${level.id} room ${room.id}: no door reached`);
        }
        for (const p of L.pieces) {
          if (!FRONT_NEEDED.has(p.type) || p.elev > 0.5) continue;
          // the disc may stand anywhere within 1.4 m of the front of the piece
          const rad = (p.rot * Math.PI) / 180, ux = Math.cos(rad), uy = Math.sin(rad), fx = -Math.sin(rad), fy = Math.cos(rad);
          let hit = false;
          for (let a = -(p.size[0] / 2 + 0.3); a <= p.size[0] / 2 + 0.3 && !hit; a += 0.1) for (let d = 0.05; d <= 1.4 && !hit; d += 0.1) {
            if (touches(p.x + ux * a + fx * (p.size[1] / 2 + d), p.y + uy * a + fy * (p.size[1] / 2 + d), 0.04)) hit = true;
          }
          if (!hit) miss.push(`${level.id} ${p.type} ${p.id} in ${p.room}: front not reached`);
        }
      });
      assert.deepEqual(miss, []);
    });
  }
}

test('flat-2: one level of 85 to 105 m2 with the rooms of a flat, and every name is recognised', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  const model = modelOfPlan(example('flat-2'));
  assert.equal(model.levels.length, 1);
  const area = model.bounds.width * model.bounds.height;
  assert.ok(area >= 85 && area <= 105, `${area} m2`);
  const types = model.levels[0].rooms.map((r) => roomType(r, model));
  for (const t of ['hall', 'living', 'kitchen', 'bedroom', 'bath', 'wc']) assert.ok(types.includes(t), t);
  assert.ok(types.filter((t) => t === 'bedroom').length >= 2);
  assert.ok(model.levels[0].openings.filter((o) => o.type === 'window').length >= 8);
});

test('duplex-2: two levels of 170 to 200 m2 with a straight stair that can be climbed (C)', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  const model = modelOfPlan(example('duplex-2'));
  assert.equal(model.levels.length, 2);
  const area = model.bounds.width * model.bounds.height * 2;
  assert.ok(area >= 170 && area <= 200, `${area} m2`);
  assert.equal(model.stairs.length, 1);
  const st = model.stairs[0];
  assert.equal(st.lower, 0); assert.equal(st.upper, 1);
  assert.ok(st.width >= 0.9, `width ${st.width}`);
  assert.ok(st.riser >= 0.16 && st.riser <= 0.19, `riser ${st.riser}`);
  assert.ok(st.run >= 0.25, `tread ${st.run}`);
  assert.ok(2 * st.riser + st.run >= 0.59 && 2 * st.riser + st.run <= 0.65, `2h+s ${2 * st.riser + st.run}`);
  assert.ok(st.steps >= 16, `${st.steps} risers`);
  // the opening in the ceiling below and in the floor above covers the whole stair, so there is 2.0 m of headroom wherever the ceiling is lower
  const lowerRooms = model.levels[0].rooms.filter((r) => (r.ceilingHoles ?? []).length), upperRooms = model.levels[1].rooms.filter((r) => (r.floorHoles ?? []).length);
  assert.equal(lowerRooms.length, 1); assert.equal(upperRooms.length, 1);
  assert.ok(model.levels[1].elevation - model.levels[1].slab >= 2.0 + 0.0, 'the ceiling below the upper floor is at least 2.0 m up');
  // at least 0.9 m free at the foot and at the head, on the axis of the stair, inside a room
  const foot = [st.from[0] - st.dir[0] * (st.run / 2 + 0.9), st.from[1] - st.dir[1] * (st.run / 2 + 0.9)];
  const head = [st.to[0] + st.dir[0] * (st.run / 2 + 0.9), st.to[1] + st.dir[1] * (st.run / 2 + 0.9)];
  const inside = (p, room) => { let c = false; const poly = room.polygon; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  assert.ok(model.levels[0].rooms.some((r) => inside(foot, r)), 'room at the foot');
  assert.ok(model.levels[1].rooms.some((r) => inside(head, r)), 'room at the head');
  // no door leaf reaches onto the steps: the door zones of both levels stay off the footprint
  for (const [li, L] of model.levels.entries()) {
    const zones = levelZones(L, model, 0.9);
    const stairBox = boxAlong((st.from[0] + st.to[0]) / 2, (st.from[1] + st.to[1]) / 2, st.dir[0], st.dir[1], (st.length + st.run) / 2, st.width / 2);
    // the passage at the foot of the stair is the way onto it, so only doors are held off the steps
    for (const d of zones.doors) if (d.o.type !== 'passage') assert.ok(penetration(stairBox, d.box) < 0.01, `${d.o.id} on level ${li}`);
  }
  const types = model.levels.flatMap((l) => l.rooms.map((r) => roomType(r, model)));
  for (const t of ['hall', 'living', 'kitchen', 'bedroom', 'bath', 'wc', 'office']) assert.ok(types.includes(t), t);
});

// ---- the plans against the quality rules (P1 to P3, S2, S3, E6), with an own measure (clear areas, faces of the walls)
const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1]) && pt[0] < ((poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
function wallAt(lv, pt) {
  let best = null, bd = 1e9;
  for (const w of lv.walls) {
    const t = Math.max(0, Math.min(w.length, (pt[0] - w.from[0]) * w.dir[0] + (pt[1] - w.from[1]) * w.dir[1]));
    const d = Math.hypot(pt[0] - (w.from[0] + w.dir[0] * t), pt[1] - (w.from[1] + w.dir[1] * t));
    if (d < bd) { bd = d; best = w; }
  }
  return bd < 0.05 ? best : null;
}
// the polygon of a room moved in to the faces of its walls
function clearPoly(lv, poly) {
  const ccw = poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) > 0;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], w = wallAt(lv, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), h = (w?.thickness ?? 0.12) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    return { p: [a[0] + ((ccw ? -dy : dy) / l) * h, a[1] + ((ccw ? dx : -dx) / l) * h], d: [dx / l, dy / l] };
  });
  return poly.map((_, i) => {
    const A = lines[(i + lines.length - 1) % lines.length], B = lines[i], det = A.d[0] * -B.d[1] + A.d[1] * B.d[0];
    const t = ((B.p[0] - A.p[0]) * -B.d[1] + (B.p[1] - A.p[1]) * B.d[0]) / det;
    return [A.p[0] + A.d[0] * t, A.p[1] + A.d[1] * t];
  });
}
const bbox = (p) => { const xs = p.map((a) => a[0]), ys = p.map((a) => a[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const centreOf = (lv, o) => { const w = lv.wallById.get(o.wallId), um = (o.u0 + o.u1) / 2; return { w, c: [w.from[0] + w.dir[0] * um, w.from[1] + w.dir[1] * um] }; };

test('the examples: hall and corridor take at most 15 percent of each floor (P1)', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  for (const name of NEW) {
    const model = modelOfPlan(example(name));
    for (const lv of model.levels) {
      const rooms = lv.rooms.map((r) => ({ r, a: area(clearPoly(lv, r.polygon)), type: roomType(r, model) }));
      const hole = lv.rooms.flatMap((r) => r.floorHoles ?? []).reduce((s, h) => s + area(h), 0);
      const floor = rooms.reduce((s, x) => s + x.a, 0) - hole;
      const hall = rooms.filter((x) => x.type === 'hall').reduce((s, x) => s + x.a, 0) - hole;
      assert.ok(hall / floor <= 0.15, `${name} ${lv.id}: ${(100 * hall / floor).toFixed(1)} %`);
    }
  }
});

test('the examples: proportions, sizes and a window in every living room (P3, E6)', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  for (const name of NEW) {
    const model = modelOfPlan(example(name));
    const min = { living: name === 'flat-2' ? 18 : 20, kitchen: 9, bedroom: 9, bath: 4, wc: 1.6 };
    let kitchenWin = 0, livingWin = 0;
    for (const lv of model.levels) for (const r of lv.rooms) {
      const type = roomType(r, model), cp = clearPoly(lv, r.polygon), a = area(cp);
      const [x0, y0, x1, y1] = bbox(cp), ratio = Math.max(x1 - x0, y1 - y0) / Math.min(x1 - x0, y1 - y0);
      if (['living', 'dining', 'kitchen', 'bedroom', 'kids', 'office'].includes(type)) {
        assert.ok(ratio <= 2.2, `${name} ${r.name}: ratio ${ratio.toFixed(2)}`);
        const wins = lv.openings.filter((o) => o.type === 'window').filter((o) => { const { w, c } = centreOf(lv, o); return w.kind === 'exterior' && [1, -1].some((s) => inPoly([c[0] + w.normal[0] * 0.3 * s, c[1] + w.normal[1] * 0.3 * s], r.polygon)); });
        assert.ok(wins.length >= 1, `${name} ${r.name}: no window`);
        if (type === 'kitchen') kitchenWin += wins.reduce((s, o) => s + o.width, 0);
        if (type === 'living') livingWin += wins.reduce((s, o) => s + o.width, 0);
      }
      if (min[type]) assert.ok(a >= min[type], `${name} ${r.name}: ${a.toFixed(1)} m2`);
      if (type === 'storage') assert.ok(a <= 8, `${name} ${r.name}: ${a.toFixed(1)} m2`);
      if (r.name === 'Main bedroom') assert.ok(a >= 14, `${name} ${r.name}: ${a.toFixed(1)} m2`);
    }
    assert.ok(kitchenWin + livingWin >= 2.0, `${name}: kitchen and living windows ${kitchenWin + livingWin}`);
  }
});

test('the examples: every room is entered from a hall, a living room, a dining room or a kitchen (P2), and the flat has no pantry of shelves only', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  for (const name of NEW) {
    const model = modelOfPlan(example(name));
    for (const lv of model.levels) {
      const rooms = lv.rooms.map((r) => ({ r, type: roomType(r, model) }));
      const hub = new Set(['hall', 'living', 'dining', 'kitchen']);
      for (const x of rooms) {
        if (!['living', 'dining', 'kitchen', 'bedroom', 'kids', 'office', 'bath', 'wc', 'utility'].includes(x.type)) continue;
        const from = [];
        for (const o of lv.openings) {
          if (o.type === 'window') continue;
          const { w, c } = centreOf(lv, o), n = [w.dir[1], -w.dir[0]];
          const a = rooms.find((q) => inPoly([c[0] + n[0] * 0.3, c[1] + n[1] * 0.3], q.r.polygon)), b = rooms.find((q) => inPoly([c[0] - n[0] * 0.3, c[1] - n[1] * 0.3], q.r.polygon));
          if (a === x && b) from.push(b.type); else if (b === x && a) from.push(a.type);
        }
        const ensuite = x.type === 'bath' && /ensuite/i.test(x.r.name);
        assert.ok(from.some((t) => hub.has(t)) || (ensuite && from.includes('bedroom')), `${name} ${x.r.name}: reached from ${from.join(',') || 'nowhere'}`);
      }
    }
  }
});

test('duplex-2: the stair stands in a closed stairwell (S2) and ends at a gallery with one open side (S3)', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  const model = modelOfPlan(example('duplex-2'));
  const st = model.stairs[0], lo = model.levels[st.lower], up = model.levels[st.upper];
  const near = (lv, pt, nrm) => {
    let best = 9;
    for (const w of lv.walls) {
      if (Math.abs(w.dir[0] * st.dir[0] + w.dir[1] * st.dir[1]) < 0.99) continue;
      const along = (pt[0] - w.from[0]) * w.dir[0] + (pt[1] - w.from[1]) * w.dir[1];
      if (along < -0.2 || along > w.length + 0.2) continue;
      const g = Math.abs((pt[0] - w.from[0]) * nrm[0] + (pt[1] - w.from[1]) * nrm[1]) - w.thickness / 2;
      if (g > -0.05 && g < best) best = g;
    }
    return best;
  };
  const nrm = [-st.dir[1], st.dir[0]], fp = st.footprint;
  const m1 = [(fp[0][0] + fp[1][0]) / 2, (fp[0][1] + fp[1][1]) / 2], m2 = [(fp[2][0] + fp[3][0]) / 2, (fp[2][1] + fp[3][1]) / 2];
  const shaft = lo.rooms.find((r) => fp.every((p) => inPoly(p, r.polygon)));
  assert.equal(roomType(shaft, model), 'stair');
  assert.ok(near(lo, m1, nrm) <= 0.03 && near(lo, m2, nrm) <= 0.03, 'both long edges at the walls below');
  assert.ok(area(clearPoly(lo, shaft.polygon)) <= 1.3 * area(fp), 'no empty space in the shaft');
  // the foot opens to the hall through a passage as wide as the stair
  const foot = [st.from[0] - st.dir[0] * st.run / 2, st.from[1] - st.dir[1] * st.run / 2];
  const pass = lo.openings.find((o) => o.type === 'passage' && o.width >= st.width - 0.01 && Math.hypot(...centreOf(lo, o).c.map((v, i) => v - foot[i])) < 0.4);
  assert.ok(pass, 'a passage at the foot');
  // the head end is shut: a wall crosses the axis behind the last tread
  const head = [st.to[0] + st.dir[0] * (st.run / 2 + 0.06), st.to[1] + st.dir[1] * (st.run / 2 + 0.06)];
  assert.ok(lo.walls.some((w) => Math.abs(w.dir[0] * st.dir[0] + w.dir[1] * st.dir[1]) < 0.01 && wallAt(lo, head) === w), 'a wall behind the head');
  // above: one long edge at a wall, the other open; the foot end of the opening is shut by a wall, the head end is open
  const touching = (near(up, m1, nrm) <= 0.05) + (near(up, m2, nrm) <= 0.05);
  assert.equal(touching, 1);
  const hole = up.rooms.find((r) => (r.floorHoles ?? []).length);
  assert.equal(roomType(hole, model), 'hall');
  assert.ok(wallAt(up, foot) || wallAt(up, [foot[0] - st.dir[0] * 0.04, foot[1] - st.dir[1] * 0.04]), 'the lower end of the opening is shut by a wall');
  assert.ok(!wallAt(up, head), 'the head end is open to the landing');
  const beyond = [st.to[0] + st.dir[0] * (st.run / 2 + 0.5), st.to[1] + st.dir[1] * (st.run / 2 + 0.5)];
  assert.ok(inPoly(beyond, hole.polygon), 'a landing behind the head');
});

test('duplex-2: nothing stands or hangs in the stairwell (S4; the 0.9 m at both ends is held by the stair test above)', async () => {
  const { roomType } = await import('../../src/layout/rooms.js');
  const model = modelOfPlan(example('duplex-2'));
  for (const seed of [1, 2, 3, 7]) {
    const layout = furnish(model, seed);
    for (const L of layout.levels) {
      const lv = model.levels.find((l) => l.id === L.id);
      for (const p of L.pieces) {
        const room = lv.rooms.find((r) => inPoly([p.x, p.y], r.polygon));
        assert.notEqual(room && roomType(room, model), 'stair', `${p.type} in the stairwell (seed ${seed})`);
      }
    }
  }
});
