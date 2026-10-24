// 2D helpers for the layout engine. Metres, plan space (x right, y down). Pure functions, bounded loops.
import { pointInPolygon, polygonArea, polygonSelfIntersection, segmentCrossing } from '../core/geom2d.js';

export const DEG = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;
// A piece with rot (degrees clockwise on the plan) looks along front(rot); its width runs along axis(rot).
export const frontOf = (rot) => [-Math.sin(rot * DEG), Math.cos(rot * DEG)];
export const axisOf = (rot) => [Math.cos(rot * DEG), Math.sin(rot * DEG)];
export function rotFromFront(fx, fy) {
  const a = (Math.atan2(-fx, fy) / DEG + 360) % 360;
  return r3(a >= 359.9995 ? 0 : a);
}

// Oriented box: centre, size along the axis (w) and along the front (d), rotation in degrees. pts are the corners.
export function obb(cx, cy, w, d, rot) {
  const [ux, uy] = axisOf(rot), [fx, fy] = frontOf(rot);
  const hw = w / 2, hd = d / 2;
  const pts = [[cx - ux * hw - fx * hd, cy - uy * hw - fy * hd], [cx + ux * hw - fx * hd, cy + uy * hw - fy * hd], [cx + ux * hw + fx * hd, cy + uy * hw + fy * hd], [cx - ux * hw + fx * hd, cy - uy * hw + fy * hd]];
  return boxOf(pts, cx, cy, ux, uy, fx, fy, hw, hd);
}
function boxOf(pts, cx, cy, ux, uy, fx, fy, hw, hd) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  return { cx, cy, ux, uy, fx, fy, hw, hd, pts, minX, minY, maxX, maxY };
}
// A box along a wall: centre on the wall line, u along the wall, f across it.
export function boxAlong(cx, cy, ux, uy, hw, hd) {
  const fx = -uy, fy = ux;
  const pts = [[cx - ux * hw - fx * hd, cy - uy * hw - fy * hd], [cx + ux * hw - fx * hd, cy + uy * hw - fy * hd], [cx + ux * hw + fx * hd, cy + uy * hw + fy * hd], [cx - ux * hw + fx * hd, cy - uy * hw + fy * hd]];
  return boxOf(pts, cx, cy, ux, uy, fx, fy, hw, hd);
}

// Penetration depth of two convex boxes (separating axis); > 0 means they overlap by that much, <= 0 means apart.
export function penetration(a, b) {
  if (a.minX >= b.maxX || b.minX >= a.maxX || a.minY >= b.maxY || b.minY >= a.maxY) return -1;
  let best = Infinity;
  for (const box of [a, b]) {
    for (const [ax, ay] of [[box.ux, box.uy], [box.fx, box.fy]]) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of a.pts) { const v = p[0] * ax + p[1] * ay; if (v < a0) a0 = v; if (v > a1) a1 = v; }
      for (const p of b.pts) { const v = p[0] * ax + p[1] * ay; if (v < b0) b0 = v; if (v > b1) b1 = v; }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return o;
      if (o < best) best = o;
    }
  }
  return best;
}

// Corners of the box pulled in by `tol` on every side (so a piece touching a wall counts as inside).
function shrunk(box, tol) {
  const hw = Math.max(1e-4, box.hw - tol), hd = Math.max(1e-4, box.hd - tol);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [box.cx + box.ux * hw * sx + box.fx * hd * sy, box.cy + box.uy * hw * sx + box.fy * hd * sy]);
}

// The whole box lies inside the polygon: corners inside and no outline edge crosses the box (matters for L shaped rooms).
export function boxInsidePolygon(box, poly, tol = 0.003) {
  const c = shrunk(box, tol);
  for (const p of c) if (!pointInPolygon(p, poly)) return false;
  const n = poly.length;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    for (let j = 0; j < n; j++) if (segmentCrossing(a, b, poly[j], poly[(j + 1) % n])) return false;
  }
  return true;
}

function lineIntersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

function distToLine(p, a, t) { return Math.abs((p[0] - a[0]) * t[1] - (p[1] - a[1]) * t[0]); }

// Floor space of a room: the outline runs along wall centre lines, so every edge moves in by half the thickness of the wall
// along it. Returns null when the outline is unusable (too few points, too small, self-crossing, collapsed).
export function roomInterior(level, room) {
  const poly = room.polygon;
  const n = poly?.length ?? 0;
  if (n < 3 || n > 120) return null;
  for (const p of poly) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const area = polygonArea(poly);
  if (!(Math.abs(area) > 0.05)) return null;
  if (polygonSelfIntersection(poly)) return null;
  const sgn = area > 0 ? 1 : -1;
  const dirs = [], norms = [], insets = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return null;
    const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    dirs.push(t);
    norms.push(sgn > 0 ? [-t[1], t[0]] : [t[1], -t[0]]);
    let th = 0;
    for (const w of level.walls) {
      if (distToLine(w.from, a, t) > 0.09 || distToLine(w.to, a, t) > 0.09) continue;
      const s0 = (w.from[0] - a[0]) * t[0] + (w.from[1] - a[1]) * t[1], s1 = (w.to[0] - a[0]) * t[0] + (w.to[1] - a[1]) * t[1];
      if (Math.min(len, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) < 0.05) continue;
      if (w.thickness > th) th = w.thickness;
    }
    insets.push((th > 0 ? th : 0.1) / 2 + 0.004);
  }
  const ip = [];
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    const p1 = [poly[h][0] + norms[h][0] * insets[h], poly[h][1] + norms[h][1] * insets[h]];
    const p2 = [poly[i][0] + norms[i][0] * insets[i], poly[i][1] + norms[i][1] * insets[i]];
    let v = lineIntersect(p1, dirs[h], p2, dirs[i]);
    if (!v || Math.hypot(v[0] - poly[i][0], v[1] - poly[i][1]) > 6 * Math.max(insets[h], insets[i]) + 0.5) v = [p2[0], p2[1]];
    ip.push(v);
  }
  const iarea = polygonArea(ip);
  if (!(Math.abs(iarea) > 0.04) || Math.sign(iarea) !== sgn || Math.abs(iarea) > Math.abs(area) + 1e-6) return null;
  if (polygonSelfIntersection(ip)) return null;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = ip[i], b = ip[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    edges.push({ index: i, a, b, len, t, n: sgn > 0 ? [-t[1], t[0]] : [t[1], -t[0]], doors: [], windows: [], passages: [], outline: [poly[i], poly[(i + 1) % n]] });
  }
  // convex corners that are close to a right angle
  const corners = [];
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[(i + edges.length - 1) % edges.length], e2 = edges[i];
    if (e1.b[0] !== e2.a[0] || e1.b[1] !== e2.a[1]) continue;
    const cross = e1.t[0] * e2.t[1] - e1.t[1] * e2.t[0];
    const dot = e1.t[0] * e2.t[0] + e1.t[1] * e2.t[1];
    if (Math.sign(cross) === sgn && Math.abs(dot) < 0.14) corners.push({ v: e2.a, e1, e2 });
  }
  return { poly: ip, outline: poly, edges, corners, area: Math.abs(iarea), sgn };
}

function onSeg(p, a, b, tol) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return false;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tol;
}

// Attach the openings that lie along each interior edge: s0..s1 is the opening's span measured along the edge from edge.a.
export function attachOpenings(level, interior) {
  for (const o of level.openings) {
    const w = level.wallById.get(o.wallId);
    if (!w) continue;
    const pa = [w.from[0] + w.dir[0] * o.u0, w.from[1] + w.dir[1] * o.u0], pb = [w.from[0] + w.dir[0] * o.u1, w.from[1] + w.dir[1] * o.u1];
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    const tol = Math.max(0.08, w.thickness / 2 + 0.03);
    for (const e of interior.edges) {
      if (!onSeg(mid, e.outline[0], e.outline[1], tol)) continue;
      const s0 = (pa[0] - e.a[0]) * e.t[0] + (pa[1] - e.a[1]) * e.t[1], s1 = (pb[0] - e.a[0]) * e.t[0] + (pb[1] - e.a[1]) * e.t[1];
      const span = { s0: Math.max(0, Math.min(s0, s1)), s1: Math.min(e.len, Math.max(s0, s1)), o };
      if (span.s1 - span.s0 < 0.02) continue;
      (o.type === 'window' ? e.windows : o.type === 'passage' ? e.passages : e.doors).push(span);
    }
  }
}

// Free parts of an edge: [s0, s1] pairs with doors and passages cut out (padded by `pad`); windows too when `windows` is true.
export function freeIntervals(edge, { pad = 0.04, windows = false, minLen = 0.2 } = {}) {
  const cuts = [...edge.doors, ...edge.passages, ...(windows ? edge.windows : [])].map((c) => [c.s0 - pad, c.s1 + pad]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = 0;
  for (const [a, b] of cuts) {
    if (a > cur) out.push([cur, Math.min(a, edge.len)]);
    cur = Math.max(cur, b);
  }
  if (cur < edge.len) out.push([cur, edge.len]);
  return out.filter(([a, b]) => b - a >= minLen).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
}

// Zones that must stay empty on a whole level: door and passage zones (0.8 m each side plus the leaf swing, which a box of the
// door width covers), window zones (for tall pieces), stair footprints. Boxes are in plan space with a height limit `top`.
export function levelZones(level, model = null) {
  const doors = [], windows = [], stairs = [];
  for (const o of level.openings) {
    const w = level.wallById.get(o.wallId);
    if (!w || !(o.u1 - o.u0 > 0.05)) continue;
    const um = (o.u0 + o.u1) / 2, hw = (o.u1 - o.u0) / 2 + 0.05;
    const cx = w.from[0] + w.dir[0] * um, cy = w.from[1] + w.dir[1] * um;
    if (o.type === 'window') windows.push({ o, box: boxAlong(cx, cy, w.dir[0], w.dir[1], hw, w.thickness / 2 + 0.55), sill: o.sill, top: o.sill + o.height });
    else doors.push({ o, box: boxAlong(cx, cy, w.dir[0], w.dir[1], hw, (o.type === 'passage' ? 0.8 : Math.max(0.8, o.u1 - o.u0)) + w.thickness / 2), top: Math.min(o.height ?? 2.05, 2.1) });
  }
  const seen = new Set();
  const stairList = [...(level.stairs ?? []), ...(model ? (model.stairs ?? []).filter((st) => st.lower === level.index || st.upper === level.index) : [])];
  for (const st of stairList) {
    if (seen.has(st)) continue;
    seen.add(st);
    const ex = st.run / 2 + 0.3, hw = st.width / 2 + 0.3;
    const a = [st.from[0] - st.dir[0] * ex, st.from[1] - st.dir[1] * ex], b = [st.to[0] + st.dir[0] * ex, st.to[1] + st.dir[1] * ex];
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    stairs.push({ box: boxAlong(cx, cy, st.dir[0], st.dir[1], Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, hw) });
  }
  return { doors, windows, stairs };
}

export { polygonArea, pointInPolygon };
