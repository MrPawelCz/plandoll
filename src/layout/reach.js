// Reachability guard of a room (docs/DESIGN.md section 3): a disc of 0.8 m (0.9 m in a hall) must get between every pair of doors of the
// room and to the front of every piece that needs a way to it. The engine asks `ok(p)` before it commits a piece; a piece that would cut
// a path that was open before is refused. Pure functions on a coarse grid; any trouble with a room's geometry turns the guard off.
import { pointInPolygon } from './geometry.js';

// pieces whose front must stay reachable: the disc may stand anywhere within 1.4 m of the front (a table or a chair before it does not matter)
const NEEDS_FRONT = new Set(['wardrobe', 'wardrobe-small', 'fridge', 'kitchen-sink', 'kitchen-hob', 'toilet', 'washbasin', 'shower', 'bathtub', 'washing-machine', 'bookshelf', 'dresser', 'shoe-cabinet']);
// a piece is also asked for its own front when it is placed (a sofa, a desk and a table are not asked again when something else is placed: a bed in a studio stands before them)
const SELF_FRONT = new Set([...NEEDS_FRONT, 'sofa2', 'sofa3', 'sofa-bed', 'desk', 'dining-table']);
const STEP = 0.05;
const MARGIN = -0.01; // the disc is a hair smaller than the rule, which absorbs the rounding of the grid

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Distance from a point to a rectangle (centre, half sizes, unit axis of the width).
function boxDist(px, py, b) {
  const dx = px - b.cx, dy = py - b.cy;
  const lx = Math.abs(dx * b.ux + dy * b.uy) - b.hw, ly = Math.abs(-dx * b.uy + dy * b.ux) - b.hd;
  return Math.hypot(lx > 0 ? lx : 0, ly > 0 ? ly : 0);
}

const boxOf = (p) => {
  const rad = (p.rot * Math.PI) / 180;
  return { cx: p.x, cy: p.y, hw: p.size[0] / 2, hd: p.size[1] / 2, ux: Math.cos(rad), uy: Math.sin(rad) };
};

export function makeReach(R, solid) {
  let g = null;
  try { g = build(R); } catch { g = null; }
  if (!g) return { ok: () => true, dirty() {} };
  const state = { base: null, fails: null };
  const block = (p, into) => {
    const b = boxOf(p), r = g.r + MARGIN;
    const ext = Math.hypot(b.hw, b.hd) + r + STEP;
    const i0 = Math.max(0, Math.floor((p.x - ext - g.x0) / STEP)), i1 = Math.min(g.nx - 1, Math.ceil((p.x + ext - g.x0) / STEP));
    const j0 = Math.max(0, Math.floor((p.y - ext - g.y0) / STEP)), j1 = Math.min(g.ny - 1, Math.ceil((p.y + ext - g.y0) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * g.nx + i;
      if (g.cell[k] && boxDist(g.x0 + (i + 0.5) * STEP, g.y0 + (j + 0.5) * STEP, b) < r) into[k] = 1;
    }
  };
  // the keys of what cannot be reached with `extra` (a candidate piece) added
  function failures(extra, base, all = false) {
    let occ = base;
    if (extra) { occ = base.slice(); block(extra, occ); }
    const free = (k) => g.cell[k] && !occ[k];
    const fails = new Set();
    const comp = new Uint8Array(g.nx * g.ny);
    const near = (x, y, maxD) => {
      const ci = Math.round((x - g.x0) / STEP - 0.5), cj = Math.round((y - g.y0) / STEP - 0.5), n = Math.ceil(maxD / STEP);
      let best = -1, bd = Infinity;
      for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        const k = j * g.nx + i;
        if (!free(k)) continue;
        const d = Math.hypot(i - ci, j - cj) * STEP;
        if (d <= maxD && d < bd) { bd = d; best = k; }
      }
      return best;
    };
    const starts = [];
    g.doors.forEach((d, n) => { const k = near(d[0], d[1], 0.9); if (k < 0) fails.add(`d${n}`); else starts.push([n, k]); });
    if (!starts.length) return fails;
    const queue = [starts[0][1]];
    comp[starts[0][1]] = 1;
    for (let h = 0; h < queue.length; h++) {
      const k = queue[h], i = k % g.nx, j = (k - i) / g.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
        const kk = jj * g.nx + ii;
        if (comp[kk] || !free(kk)) continue;
        if (di && dj && !(free(j * g.nx + ii) && free(jj * g.nx + i))) continue; // no squeezing between two corners
        comp[kk] = 1; queue.push(kk);
      }
    }
    for (const [n, k] of starts.slice(1)) if (!comp[k]) fails.add(`d${n}`);
    const touches = (x, y, maxD) => {
      const ci = Math.round((x - g.x0) / STEP - 0.5), cj = Math.round((y - g.y0) / STEP - 0.5), n = Math.ceil(maxD / STEP);
      for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        if (comp[j * g.nx + i] && Math.hypot(i - ci, j - cj) * STEP <= maxD) return true;
      }
      return false;
    };
    const test = (q, key, set) => {
      if (!set.has(q.type)) return;
      const rad = (q.rot * Math.PI) / 180, ux = Math.cos(rad), uy = Math.sin(rad), fx = -Math.sin(rad), fy = Math.cos(rad);
      for (let a = -(q.size[0] / 2 + 0.3); a <= q.size[0] / 2 + 0.3; a += 0.1) for (let d = 0.05; d <= 1.4; d += 0.1) {
        if (touches(q.x + ux * a + fx * (q.size[1] / 2 + d), q.y + uy * a + fy * (q.size[1] / 2 + d), 0.04)) return;
      }
      fails.add(key);
    };
    for (const q of R.mine) if (solid(q)) test(q, q.id, all ? SELF_FRONT : NEEDS_FRONT);
    if (extra && solid(extra)) test(extra, 'cand', SELF_FRONT);
    return fails;
  }
  return {
    // `all`: the fronts of sofas, desks and tables are kept too (a seat added late must not cut the way to them)
    ok(p, all = false) {
      if (!solid(p)) return true;
      if (!state.base) {
        const base = new Uint8Array(g.nx * g.ny);
        for (const q of R.mine) if (solid(q)) block(q, base);
        state.base = base;
        state.fails = failures(null, base);
        state.failsAll = null;
      }
      for (const k of failures(p, state.base)) if (!state.fails.has(k)) return false;
      if (all) {
        state.failsAll ??= failures(null, state.base, true);
        for (const k of failures(p, state.base, true)) if (!state.failsAll.has(k)) return false;
      }
      return true;
    },
    dirty() { state.base = null; },
  };
}

function build(R) {
  const lc = R.lc;
  const r = R.type === 'hall' ? 0.45 : 0.4;
  const poly = R.ip.poly, b = R.bbox;
  const nx = Math.ceil(b.w / STEP) + 1, ny = Math.ceil(b.h / STEP) + 1;
  if (nx * ny > 90000) return null;
  const x0 = b.minX, y0 = b.minY;
  // wall segments of the room outline without the door and passage gaps; a start point just inside every door
  const segs = [], doors = [];
  for (const e of R.edges) {
    const gaps = [...e.doors, ...e.passages].map((d) => [d.s0, d.s1]).sort((u, v) => u[0] - v[0]);
    let cur = 0;
    for (const [s0, s1] of gaps) {
      if (s0 > cur) segs.push([e.a[0] + e.t[0] * cur, e.a[1] + e.t[1] * cur, e.a[0] + e.t[0] * s0, e.a[1] + e.t[1] * s0]);
      cur = Math.max(cur, s1);
      const m = (s0 + s1) / 2;
      doors.push([e.a[0] + e.t[0] * m + e.n[0] * 0.45, e.a[1] + e.t[1] * m + e.n[1] * 0.45]);
    }
    if (cur < e.len) segs.push([e.a[0] + e.t[0] * cur, e.a[1] + e.t[1] * cur, e.b[0], e.b[1]]);
  }
  // the floor holes of an upper level are obstacles, the stair of a lower level is walkable
  const holes = R.room.floorHoles ?? [];
  for (const h of holes) for (let i = 0; i < h.length; i++) segs.push([h[i][0], h[i][1], h[(i + 1) % h.length][0], h[(i + 1) % h.length][1]]); // a hole is an obstacle: keep the disc off its edge
  const forced = (lc.level.stairs ?? []).filter((st) => st.lower === lc.level.index).map((st) => st.footprint);
  const cell = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * STEP, y = y0 + (j + 0.5) * STEP;
    if (!pointInPolygon([x, y], poly)) continue;
    if (holes.some((h) => pointInPolygon([x, y], h))) continue;
    if (forced.some((f) => pointInPolygon([x, y], f))) { cell[j * nx + i] = 1; continue; }
    let d = Infinity;
    for (const s of segs) { d = Math.min(d, segDist(x, y, s[0], s[1], s[2], s[3])); if (d < r + MARGIN) break; }
    if (d >= r + MARGIN) cell[j * nx + i] = 1;
  }
  return { nx, ny, x0, y0, r, cell, doors };
}
