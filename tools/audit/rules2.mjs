// Audit rules S1..S4 (stairwell), E1..E7 (kitchen, dining, seating, storage, decor, windows, bedroom mirror), P1..P6 (plan quality, door leaves).
// Spec: docs/DESIGN.md, the section on the audit. Own geometry only (geom.mjs); the repository supplies data.
import { piecePoly, overlap, pip, distPointSeg, DEG } from './geom.mjs';

export const HARD2 = new Set(['S1', 'S2', 'S3', 'S4', 'E1', 'E2', 'E3', 'E4', 'P1', 'P2', 'P5']);
export const RULES2 = ['S1', 'S2', 'S3', 'S4', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const r3 = (v) => Math.round(v * 1000) / 1000;
const hyp = Math.hypot;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const signedArea = (poly) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const area = (poly) => Math.abs(signedArea(poly));
const SITS = { 'dining-chair': 1, 'desk-chair': 1, armchair: 1, sofa2: 2, sofa3: 3, 'sofa-bed': 2, 'bar-stool': 1, 'bed-double': 2, 'bed-king': 2, 'bed-single': 1 };
const COUNTERS = ['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'kitchen-island'];
const RUN_TYPES = ['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'fridge', 'washing-machine'];
const STORE = ['wardrobe', 'wardrobe-small', 'bookshelf', 'dresser', 'sideboard', 'shoe-cabinet', 'nightstand', 'tv-unit'];
const DECOR = ['art-large', 'art-small', 'mirror', 'shelf-wall'];
const DECOR_ROOMS = ['living', 'dining', 'bedroom', 'kids', 'office', 'hall'];
const STAIR_NAME = /stairwell|stair well|stairs? shaft|klatk\w* schod\w*|szyb\w* schod\w*|^\s*(stairs?|schody)\s*$/;
const norm = (s) => String(s ?? '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const MAIN_BED = /\b(main|master|glown\w*|rodzic\w*)\b/;
const DRESS = /\b(dressing|garderob\w*|walk in|closet)\b/;
const USE_OK = { living: ['living', 'dining', 'kitchen'], dining: ['dining', 'living', 'kitchen'], bedroom: ['bedroom', 'kids'], kitchen: ['kitchen'], bathroom: ['bath', 'wc'], hall: ['hall', 'stair'], balcony: ['balcony'], storage: ['storage', 'utility'], office: ['office'] };

// ---- small geometry helpers (own code)
function offsetPoly(poly, ts) {
  const s = Math.sign(signedArea(poly)) || 1, n = poly.length;
  const L = poly.map((a, i) => { const b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = hyp(dx, dy) || 1, nx = -dy / l * s, ny = dx / l * s; return { p: [a[0] + nx * ts[i], a[1] + ny * ts[i]], d: [dx / l, dy / l] }; });
  return poly.map((_, i) => {
    const A = L[(i + n - 1) % n], B = L[i], den = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    if (Math.abs(den) < 1e-9) return B.p;
    const t = ((B.p[0] - A.p[0]) * B.d[1] - (B.p[1] - A.p[1]) * B.d[0]) / den;
    return [A.p[0] + A.d[0] * t, A.p[1] + A.d[1] * t];
  });
}
function minRectRatio(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], l = hyp(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], v = [-u[1], u[0]];
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of poly) { const x = dot(p, u), y = dot(p, v); u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y); }
    const w = u1 - u0, h = v1 - v0;
    if (!best || w * h < best.a) best = { a: w * h, long: Math.max(w, h), short: Math.min(w, h) };
  }
  return best ? { long: best.long, short: best.short, ratio: best.long / Math.max(best.short, 1e-6) } : { long: 0, short: 0, ratio: 1 };
}
const rectAt = (o, u, v, a0, a1, h) => [[o[0] + u[0] * a0 - v[0] * h, o[1] + u[1] * a0 - v[1] * h], [o[0] + u[0] * a1 - v[0] * h, o[1] + u[1] * a1 - v[1] * h], [o[0] + u[0] * a1 + v[0] * h, o[1] + u[1] * a1 + v[1] * h], [o[0] + u[0] * a0 + v[0] * h, o[1] + u[1] * a0 + v[1] * h]];
const dPoly = (p, poly) => (pip(p, poly) ? 0 : Math.min(...poly.map((v, i) => distPointSeg(p, v, poly[(i + 1) % poly.length]))));
const polyDist = (A, B) => (overlap(A, B) > 0 ? 0 : Math.min(...A.map((p) => dPoly(p, B)), ...B.map((p) => dPoly(p, A))));

class Heap {
  constructor() { this.a = []; }
  push(d, i) { const a = this.a; a.push([d, i]); let k = a.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (a[p][0] <= a[k][0]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
}
function distField(g, mask, srcCells) {
  const D = new Float64Array(g.n).fill(Infinity), H = new Heap();
  for (const s of srcCells) if (mask[s]) { D[s] = 0; H.push(0, s); }
  const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, -1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142]];
  while (H.size) {
    const [d, id] = H.pop();
    if (d > D[id]) continue;
    const i = id % g.nx, j = (id - i) / g.nx;
    for (const [di, dj, w] of N) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.ny) continue;
      const nid = nj * g.nx + ni;
      if (!mask[nid]) continue;
      if (di && dj && !(mask[j * g.nx + ni] && mask[nj * g.nx + i])) continue;
      const nd = d + w * g.cell;
      if (nd < D[nid]) { D[nid] = nd; H.push(nd, nid); }
    }
  }
  return D;
}

// ---- main entry: called by auditModel with the per-level grid helpers in L._audit
export function auditRules2(model, layout, specs, ex = {}) {
  const V = [];
  const roomsApi = ex.rooms ?? null;
  const add = (rule, o) => V.push({ rule, hard: HARD2.has(rule), ...o });
  const specOf = (t) => specs.SPEC_BY_ID[t] ?? null;
  const kindOf = (p, spec) => { if (p.on) return 'surface'; const m = spec?.place?.mode; return m === 'floor' || m === 'corner' ? 'floor' : m === 'floor-flat' ? 'flat' : m === 'wall-mount' ? 'wall' : m === 'window' ? 'window' : m === 'ceiling' ? 'ceiling' : 'surface'; };
  const nLevels = model.levels.length;
  const typeOf = (room) => {
    if (STAIR_NAME.test(norm(room.name))) return 'stair';
    if (roomsApi?.roomType) { const t = roomsApi.roomType(room, model); if (t && t !== 'other') return t; }
    const u = { bathroom: 'bath', living: 'living', bedroom: 'bedroom', kitchen: 'kitchen', hall: 'hall', balcony: 'balcony', storage: 'storage', office: 'office', dining: 'dining' }[room.use];
    return u ?? 'other';
  };
  const info = model.levels.map((L, li) => {
    const wallBy = new Map(L.walls.map((w) => [w.id, w]));
    const wallPt = (w, u, v) => [w.from[0] + w.dir[0] * u + w.normal[0] * v, w.from[1] + w.dir[1] * u + w.normal[1] * v];
    const wallRects = L.walls.map((w) => ({ w, poly: [wallPt(w, -w.thickness / 2, -w.thickness / 2), wallPt(w, w.length + w.thickness / 2, -w.thickness / 2), wallPt(w, w.length + w.thickness / 2, w.thickness / 2), wallPt(w, -w.thickness / 2, w.thickness / 2)] }));
    const half = (a, b) => {
      let t = 0;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], el = hyp(b[0] - a[0], b[1] - a[1]) || 1;
      for (const w of L.walls) {
        const cr = Math.abs((b[0] - a[0]) * w.dir[1] - (b[1] - a[1]) * w.dir[0]) / el;
        if (cr > 0.01) continue;
        const rel = [mid[0] - w.from[0], mid[1] - w.from[1]], along = dot(rel, w.dir), off = Math.abs(rel[0] * w.dir[1] - rel[1] * w.dir[0]);
        if (off < 0.03 && along > -0.01 && along < w.length + 0.01) t = Math.max(t, w.thickness);
      }
      return t / 2;
    };
    const rooms = L.rooms.map((r) => {
      const ts = r.polygon.map((a, i) => half(a, r.polygon[(i + 1) % r.polygon.length]));
      const face = offsetPoly(r.polygon, ts);
      const holes = (r.floorHoles ?? []);
      const holeA = holes.reduce((s, h) => s + area(h), 0);
      return { r, id: r.id, type: typeOf(r), face, area: area(face), holeA, name: r.name };
    });
    const roomAt = (p) => rooms.find((x) => pip(p, x.r.polygon)) ?? null;
    const LL = layout.levels.find((x) => x.id === L.id);
    const pieces = (LL?.pieces ?? []).map((p) => { const spec = specOf(p.type); return { ...p, kind: kindOf(p, spec), spec, poly: piecePoly(p.x, p.y, p.size[0], p.size[1], p.rot), f: [-Math.sin(p.rot * DEG), Math.cos(p.rot * DEG)], u: [Math.cos(p.rot * DEG), Math.sin(p.rot * DEG)] }; });
    const ops = L.openings.map((o) => {
      const w = wallBy.get(o.wallId), c = [w.from[0] + w.dir[0] * (o.u0 + o.u1) / 2, w.from[1] + w.dir[1] * (o.u0 + o.u1) / 2], d = w.thickness / 2 + 0.3;
      const a = roomAt([c[0] + w.normal[0] * d, c[1] + w.normal[1] * d]), b = roomAt([c[0] - w.normal[0] * d, c[1] - w.normal[1] * d]);
      return { o, w, c, plus: a, minus: b };
    });
    return { L, li, wallRects, rooms, roomAt, pieces, ops, wallBy };
  });
  const rep = (I, p) => ({ room: p.room, piece: `${p.type}#${p.id}`, type: p.type, level: I.L.id, at: [r3(p.x), r3(p.y)] });
  const wallDist = (I, p) => { let d = Infinity; for (const { poly } of I.wallRects) d = Math.min(d, dPoly(p, poly)); return d; };

  // ================= S1..S4 =================
  for (const st of model.stairs ?? []) {
    const lo = info[st.lower], up = info[st.upper];
    if (!lo || !up) continue;
    const dir = st.dir, nrm = [-dir[1], dir[0]], len = st.length, hw = st.width / 2, run = st.run, riser = st.riser;
    const id = st.id, sum = 2 * riser + run;
    const bad = [];
    if (st.steps !== 16 || Math.abs(riser - 0.18125) > 0.002) bad.push(`riser ${riser.toFixed(4)} x ${st.steps}`);
    if (run < 0.25 - 1e-6 || run > 0.27 + 1e-6) bad.push(`run ${run.toFixed(3)}`);
    if (st.width < 1.0 - 1e-6 || st.width > 1.1 + 1e-6) bad.push(`width ${st.width}`);
    if (sum < 0.59 - 1e-6 || sum > 0.65 + 1e-6) bad.push(`2h+s ${sum.toFixed(3)}`);
    if (bad.length) add('S1', { room: '-', piece: id, type: 'stair', level: lo.L.id, value: r3(sum), unit: '2h+s', detail: `stair ${id}: ${bad.join(', ')}` });
    const P = (a, v) => [st.from[0] + dir[0] * a + nrm[0] * v, st.from[1] + dir[1] * a + nrm[1] * v];
    const a0 = -run / 2, a1 = len + run / 2, foot = P(a0, 0), fp = st.footprint, fpA = area(fp);
    const samples = (a, b, v) => { const out = []; const n = Math.max(2, Math.ceil(Math.abs(b - a) / 0.05)); for (let k = 0; k <= n; k++) out.push(P(a + (b - a) * k / n, v)); return out; };
    const cover = (I, pts, tol) => { let c = 0, mx = 0; for (const p of pts) { const d = wallDist(I, p); if (d <= tol) c++; mx = Math.max(mx, d); } return { frac: c / pts.length, maxGap: mx }; };
    // S2 lower level
    const host = lo.roomAt(P(len / 2, 0));
    const isStairRoom = host?.type === 'stair';
    const issues = [];
    if (!isStairRoom) issues.push(`the run stands in ${host ? `"${host.name}" (${host.type})` : 'no room'}, not in a stair room`);
    for (const [side, v] of [['left', -hw], ['right', hw]]) {
      const c = cover(lo, samples(a0, a1, v), 0.03);
      if (c.frac < 0.9) issues.push(`${side} long edge touches a wall on ${(c.frac * 100).toFixed(0)} % of its length, widest gap ${c.maxGap.toFixed(2)} m`);
    }
    if (host && isStairRoom && host.area > 1.3 * fpA + 1e-6) issues.push(`stair room ${host.area.toFixed(1)} m2 > 1.3 x run ${fpA.toFixed(1)} m2`);
    else if (host && !isStairRoom && host.area > 1.3 * fpA + 1e-6) issues.push(`room ${host.area.toFixed(1)} m2 holds a run of ${fpA.toFixed(1)} m2`);
    const hc = cover(lo, Array.from({ length: 21 }, (_, k) => P(a1, -hw + st.width * k / 20)), 0.05);
    if (hc.frac < 0.9) issues.push(`head end not closed by a wall (${(hc.frac * 100).toFixed(0)} %)`);
    // passage at the foot, in a cross wall right behind the first step
    let footWall = null;
    for (const op of lo.ops) {
      const w = op.w;
      if (op.o.type !== 'passage' || Math.abs(dot(w.dir, dir)) > 0.1) continue;
      const rel = [op.c[0] - foot[0], op.c[1] - foot[1]], along = dot(rel, dir), lat = dot(rel, nrm);
      if (Math.abs(along) <= 0.8 && Math.abs(lat) <= 0.35) footWall = { op, along };
    }
    if (!footWall) issues.push('no passage in the cross wall at the foot');
    else if (footWall.op.o.width < st.width - 0.05) issues.push(`foot passage ${footWall.op.o.width} m narrower than the run`);
    const aw = footWall ? a0 + footWall.along - footWall.op.w.thickness / 2 : a0;
    const footRect = rectAt(P(0, 0), dir, nrm, aw - 0.9 + 0, aw + 0, hw);
    const footRectOK = [P(aw - 0.45, 0), P(aw - 0.88, 0), P(aw - 0.88, hw - 0.05), P(aw - 0.88, -hw + 0.05)].every((p) => { const r = lo.roomAt(p); return r && r.type !== 'stair'; });
    if (!footRectOK) issues.push('less than 0.9 m of floor in front of the foot');
    if (issues.length) add('S2', { room: host?.id ?? '-', piece: id, type: 'stair', level: lo.L.id, value: issues.length, unit: 'issues', detail: `stair ${id}: ${issues.join('; ')}`, at: foot.map(r3) });
    // S3 upper level
    const s3 = [];
    let open = 0;
    for (const [side, v] of [['left', -hw], ['right', hw]]) {
      const c = cover(up, samples(a0, a1, v), 0.05);
      if (c.frac < 0.9) { open++; s3.push(`${side} long edge open (wall on ${(c.frac * 100).toFixed(0)} %)`); }
    }
    const headRect = rectAt(P(0, 0), dir, nrm, a1, a1 + 1.0, 0.45);
    const headOK = [P(a1 + 0.5, 0), P(a1 + 0.95, 0.4), P(a1 + 0.95, -0.4), P(a1 + 0.1, 0.4), P(a1 + 0.1, -0.4)].every((p) => { const r = up.roomAt(p); return r && r.type !== 'stair'; });
    const blocked = up.wallRects.some(({ poly }) => overlap(headRect, poly) > 0.01);
    if (open > 1) add('S3', { room: '-', piece: id, type: 'stair', level: up.L.id, value: open, unit: 'open long edges', detail: `stair ${id}: ${open} open long edges (${s3.join('; ')})`, at: P(len / 2, 0).map(r3) });
    if (!headOK || blocked) add('S3', { room: '-', piece: id, type: 'stair', level: up.L.id, value: 0, unit: 'head area', detail: `stair ${id}: head has no free 0.9 x 1.0 m landing${blocked ? ' (wall in the way)' : ''}`, at: P(a1 + 0.5, 0).map(r3) });
    // S4: nothing in a stair room, no furniture in the foot and head areas
    for (const I of [lo, up]) {
      for (const p of I.pieces) {
        if (p.kind === 'ceiling') continue;
        const r = I.roomAt([p.x, p.y]);
        if (r?.type === 'stair') add('S4', { ...rep(I, p), value: 0, detail: `${p.type} stands or hangs in stair room ${r.id}` });
        if (p.kind === 'floor' && ((I === lo && overlap(p.poly, footRect) > 0.01) || (I === up && overlap(p.poly, headRect) > 0.01))) add('S4', { ...rep(I, p), value: r3(overlap(p.poly, I === lo ? footRect : headRect)), unit: 'm overlap', detail: `${p.type} inside the 0.9 m area ${I === lo ? 'in front of the foot' : 'behind the head'} of ${id}` });
      }
    }
    st._decorZone = { lo, up, P, a0, a1, hw };
  }

  // ================= per level E and P rules =================
  for (const I of info) {
    const { L, rooms, pieces } = I;
    const g = L._audit?.g, freeMask = L._audit?.freeMask;
    const inRoom = (rm) => pieces.filter((p) => p.room === rm.id);
    const kitchens = rooms.filter((x) => x.type === 'kitchen' || pieces.some((p) => p.room === x.id && (p.type === 'kitchen-sink' || p.type === 'kitchen-hob')));
    // ---- E1 kitchen runs
    for (const K of kitchens) {
      const el = inRoom(K).filter((p) => RUN_TYPES.includes(p.type) && !p.on);
      const par = el.map((_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < el.length; i++) for (let j = i + 1; j < el.length; j++) {
        const a = el[i], b = el[j];
        if (polyDist(a.poly, b.poly) > 0.03) continue;
        const parallel = Math.abs(dot(a.f, b.f)) > 0.98;
        if (parallel && Math.abs(dot([b.x - a.x, b.y - a.y], a.f)) > 0.35) continue;
        par[find(i)] = find(j);
      }
      const comps = new Map();
      el.forEach((p, i) => { const k = find(i); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(p); });
      const runs = [...comps.values()].map((m) => ({ m, len: m.reduce((s, p) => s + p.size[0], 0) }));
      for (const r of runs) {
        if (r.m.length === 1) add('E1', { ...rep(I, r.m[0]), value: 1, unit: 'lone unit', detail: `${r.m[0].type} stands alone in ${K.id}, not part of a run` });
        else if (r.len < 1.8 - 1e-6) add('E1', { ...rep(I, r.m[0]), value: r3(r.len), unit: 'm run', detail: `run of ${r.m.map((p) => p.type).join('+')} is ${r.len.toFixed(2)} m, under 1.8 m` });
      }
      if (runs.length > 3) add('E1', { room: K.id, piece: K.id, type: 'kitchen', level: L.id, value: runs.length, unit: 'runs', detail: `${runs.length} separate runs in ${K.id} (max 3)` });
      const sinks = el.filter((p) => p.type === 'kitchen-sink'), hobs = el.filter((p) => p.type === 'kitchen-hob');
      if (sinks.length && hobs.length) {
        const best = Math.min(...sinks.flatMap((s) => hobs.map((h) => polyDist(s.poly, h.poly))));
        if (best > 2.5) add('E1', { room: K.id, piece: sinks[0].id, type: 'kitchen-sink', level: L.id, value: r3(best), unit: 'm', detail: `sink and hob are ${best.toFixed(2)} m apart (max 2.5)` });
      }
    }
    // ---- E2 dining table next to the kitchen
    const doorLinks = (a, b) => I.ops.some((x) => (x.o.type === 'door' || x.o.type === 'passage') && ((x.plus?.id === a.id && x.minus?.id === b.id) || (x.plus?.id === b.id && x.minus?.id === a.id)));
    for (const t of pieces.filter((p) => p.type === 'dining-table' && !p.on)) {
      const chairs = pieces.filter((p) => p.type === 'dining-chair' && polyDist(p.poly, t.poly) < 0.35).length;
      if (chairs < 4) continue;
      const tr = rooms.find((x) => x.id === t.room);
      const ks = kitchens.filter((K) => K.id === tr?.id || (tr && doorLinks(K, tr)));
      if (!ks.length) { add('E2', { ...rep(I, t), value: 0, unit: 'no kitchen', detail: `dining table (${chairs} chairs) in ${t.room} is neither in the kitchen nor joined to it by a door or passage` }); continue; }
      const fronts = pieces.filter((p) => ks.some((K) => K.id === p.room) && COUNTERS.includes(p.type) && !p.on);
      if (!fronts.length) continue;
      const line = Math.min(...fronts.map((p) => polyDist(t.poly, p.poly)));
      let path = Infinity;
      if (g && freeMask) {
        const mask = freeMask(0.35), near = (poly, r) => { const out = []; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = j * g.nx + i; if (mask[k] && dPoly(g.center(i, j), poly) <= r) out.push(k); } return out; };
        const src = fronts.flatMap((p) => near(p.poly, 0.6)), D = distField(g, mask, src);
        const tn = near(t.poly, 0.6); for (const k of tn) path = Math.min(path, D[k]);
      }
      if (line > 3.5 || path > 5.0) add('E2', { ...rep(I, t), value: r3(line), unit: 'm', detail: `dining table is ${line.toFixed(2)} m (straight) and ${Number.isFinite(path) ? path.toFixed(2) : 'no'} m (path) from the kitchen fronts, limits 3.5 and 5.0` });
    }
    // ---- E3 seats, E4 storage-only rooms
    for (const R of rooms) {
      const mine = inRoom(R);
      const seat = (p) => (p.type === 'bench' ? Math.floor(p.size[0] / 0.5 + 1e-6) : SITS[p.type] ?? 0);
      const seats = mine.reduce((s, p) => s + seat(p), 0), chairs = mine.filter((p) => p.type === 'dining-chair').length;
      const loose = mine.filter((p) => ['armchair', 'dining-chair', 'desk-chair', 'bench', 'bar-stool'].includes(p.type)).reduce((s, p) => s + seat(p), 0);
      const nm = norm(R.name), A = R.area;
      let need = null;
      if (R.type === 'living') need = seats < 5 ? `${seats} seats, needs 5` : null;
      else if (R.type === 'dining') need = chairs < 4 ? `${chairs} chairs, needs 4` : null;
      else if (R.type === 'office') { const n = A >= 9 ? 2 : 1; need = seats < n ? `${seats} seats, needs ${n}` : null; }
      else if (R.type === 'bedroom' || R.type === 'kids') need = A >= 12 && loose < 1 ? 'no seat besides the bed in a room of 12 m2 or more' : null;
      else if (R.type === 'hall' && A >= 6 && !(R.holeA > 0) && minRectRatio(R.face).short >= 1.8) need = mine.some((p) => p.type === 'bench' || p.type === 'armchair') ? null : 'no bench or armchair in a hall of 6 m2 or more and 1.8 m across'; // a gallery round a stair opening and a narrow spine are walkways: a seat there would block them
      else if (R.type === 'storage' && DRESS.test(nm) && A >= 5) need = mine.some((p) => p.type === 'bench') ? null : 'no bench in a dressing room of 5 m2 or more';
      if (need) add('E3', { room: R.id, piece: R.id, type: R.type, level: L.id, value: seats, unit: 'seats', detail: `${R.id} (${R.name}, ${A.toFixed(1)} m2): ${need}` });
      if (A >= 6 && !['bath', 'wc', 'utility', 'stair', 'balcony'].includes(R.type)) {
        const store = mine.filter((p) => STORE.includes(p.type));
        const other = mine.filter((p) => !p.on && p.kind !== 'wall' && p.kind !== 'flat' && p.kind !== 'ceiling' && p.kind !== 'window' && !STORE.includes(p.type) && !['plant-large', 'floor-lamp'].includes(p.type));
        if (store.length && !other.length) add('E4', { room: R.id, piece: R.id, type: R.type, level: L.id, value: r3(A), unit: 'm2', detail: `${R.id} (${R.name}, ${A.toFixed(1)} m2) has only storage pieces (${[...new Set(store.map((p) => p.type))].join(', ')}) and nothing to sit, sleep or work at` });
      }
      if (R.type === 'storage') {
        const lim = DRESS.test(nm) ? 8 : 4.5;
        if (A > lim) add('E4', { room: R.id, piece: R.id, type: 'storage', level: L.id, value: r3(A), unit: 'm2', detail: `${R.id} (${R.name}) is ${A.toFixed(1)} m2, limit ${lim}` });
      }
    }
    // ---- E5 wall decoration
    const levelStairs = (model.stairs ?? []).filter((s) => s.lower === I.li || s.upper === I.li);
    for (const R of rooms) {
      const decor = inRoom(R).filter((p) => DECOR.includes(p.type));
      if (!decor.length) continue;
      const okRoom = DECOR_ROOMS.includes(R.type);
      const wallLen = R.face.reduce((s, a, i) => s + hyp(R.face[(i + 1) % R.face.length][0] - a[0], R.face[(i + 1) % R.face.length][1] - a[1]), 0);
      const opw = I.ops.filter((x) => x.plus?.id === R.id || x.minus?.id === R.id).reduce((s, x) => s + (x.o.u1 - x.o.u0), 0);
      const free = Math.max(0, (wallLen - opw) * 2.7), cap = Math.floor(free / 2.5 + 1e-6);
      for (const p of decor) if (!okRoom && !(p.type === 'mirror' && (R.type === 'bath' || R.type === 'wc' || (R.type === 'storage' && DRESS.test(norm(R.name)))))) add('E5', { ...rep(I, p), value: 0, detail: `${p.type} hangs in a ${R.type} room (${R.id})` });
      const kept = decor.filter((p) => DECOR_ROOMS.includes(R.type));
      if (kept.length > cap) add('E5', { room: R.id, piece: R.id, type: 'decor', level: L.id, value: kept.length, unit: 'pieces', detail: `${kept.length} wall decorations in ${R.id}, at most ${cap} for ${free.toFixed(1)} m2 of free wall` });
      for (const p of decor) {
        for (const s of levelStairs) {
          const z = s._decorZone; if (!z) continue;
          const hostRoom = I.roomAt([s.from[0] + s.dir[0] * s.length / 2, s.from[1] + s.dir[1] * s.length / 2]);
          if (!hostRoom || (hostRoom.id !== R.id && R.type !== 'stair')) continue;
          const [x, y] = [p.x - s.from[0], p.y - s.from[1]], a = dot([x, y], s.dir), v = dot([x, y], [-s.dir[1], s.dir[0]]);
          if (a > z.a0 - 0.9 && a < z.a1 + 1.0 && Math.abs(v) < z.hw + 1.1) add('E5', { ...rep(I, p), value: r3(Math.abs(v)), unit: 'm from the run axis', detail: `${p.type} hangs within 1.1 m of stair ${s.id}` });
        }
      }
    }
    // ---- E6 windows on exterior walls
    for (const R of rooms) {
      if (!['living', 'dining', 'kitchen', 'bedroom', 'kids', 'office'].includes(R.type)) continue;
      const wins = I.ops.filter((x) => x.o.type === 'window' && x.w.kind === 'exterior' && (x.plus?.id === R.id || x.minus?.id === R.id));
      const wsum = wins.reduce((s, x) => s + (x.o.u1 - x.o.u0), 0);
      if (!wins.length) add('E6', { room: R.id, piece: R.id, type: R.type, level: L.id, value: 0, unit: 'windows', detail: `${R.id} (${R.name}) has no window in an exterior wall` });
      else if ((R.type === 'living' || R.type === 'kitchen') && wsum < 2.0 - 1e-6) add('E6', { room: R.id, piece: R.id, type: R.type, level: L.id, value: r3(wsum), unit: 'm', detail: `${R.id} (${R.name}) has ${wsum.toFixed(2)} m of windows, needs 2.0` });
    }
    // ---- E7 a bedroom with a chest of drawers: the mirror hangs right over it, nothing covers the mirror
    for (const R of rooms) {
      if (R.type !== 'bedroom' && R.type !== 'kids') continue;
      const mine = inRoom(R), dressers = mine.filter((p) => p.type === 'dresser' && !p.on);
      if (!dressers.length) continue;
      const mirrors = mine.filter((p) => p.type === 'mirror'), why = [];
      const rotEq = (a, b) => Math.abs((((a.rot - b.rot) % 360) + 540) % 360 - 180) < 1;
      const good = dressers.some((d) => mirrors.some((m) => {
        const rel = [m.x - d.x, m.y - d.y], along = dot(rel, d.u), depth = dot(rel, d.f);
        const top = d.elev + d.size[2];
        const ok = rotEq(m, d) && Math.abs(along) <= 0.15 + 1e-6 && Math.abs(depth) <= 0.6 && m.elev >= top + 0.1 - 1e-6;
        if (!ok) { why.push(`mirror ${m.id} is ${Math.abs(along).toFixed(2)} m beside the chest, bottom edge ${(m.elev - top).toFixed(2)} m over it`); return false; }
        const cover = mine.find((q) => q !== m && q.kind === 'wall' && ['shelf-wall', 'art-large', 'art-small'].includes(q.type) && rotEq(q, m) && Math.abs(dot([q.x - m.x, q.y - m.y], d.f)) <= 0.3 && Math.abs(dot([q.x - m.x, q.y - m.y], d.u)) < (q.size[0] + m.size[0]) / 2 - 0.02 && q.elev < m.elev + m.size[2] && q.elev + q.size[2] > m.elev);
        if (cover) { why.push(`${cover.type} ${cover.id} covers mirror ${m.id}`); return false; }
        return true;
      }));
      if (!good) add('E7', { room: R.id, piece: dressers[0].id, type: 'mirror', level: L.id, value: mirrors.length, unit: 'mirrors', detail: `${R.id} (${R.name}) has a chest of drawers but no mirror over it${why.length ? ` (${why[0]})` : mirrors.length ? '' : ' (no mirror in the room)'}`, at: [r3(dressers[0].x), r3(dressers[0].y)] });
    }
    // ---- P1 circulation share
    const floorA = rooms.reduce((s, x) => s + x.area - x.holeA, 0);
    const hallA = rooms.filter((x) => x.type === 'hall').reduce((s, x) => s + x.area - x.holeA, 0);
    if (floorA > 0 && hallA / floorA > 0.15 + 1e-6) add('P1', { room: '-', piece: '-', type: 'hall', level: L.id, value: r3(hallA / floorA), unit: 'share', detail: `circulation ${hallA.toFixed(1)} m2 of ${floorA.toFixed(1)} m2 = ${(100 * hallA / floorA).toFixed(0)} % on ${L.id} (max 15 %)` });
    // ---- P2 access
    const NEED = ['living', 'dining', 'kitchen', 'bedroom', 'kids', 'office', 'bath', 'wc', 'utility'], HUBS = ['hall', 'living', 'dining', 'kitchen'];
    const nb = new Map(rooms.map((x) => [x.id, new Set()]));
    for (const x of I.ops) if ((x.o.type === 'door' || x.o.type === 'passage') && x.plus && x.minus && x.plus !== x.minus) { nb.get(x.plus.id).add(x.minus.id); nb.get(x.minus.id).add(x.plus.id); }
    const byId = new Map(rooms.map((x) => [x.id, x]));
    const hubAccess = (x) => [...nb.get(x.id)].some((n) => HUBS.includes(byId.get(n).type) || byId.get(n).type === 'stair');
    for (const R of rooms) {
      if (!NEED.includes(R.type) || hubAccess(R)) continue;
      const beds = [...nb.get(R.id)].map((n) => byId.get(n)).filter((n) => n.type === 'bedroom' || n.type === 'kids');
      const ensuiteOK = ['bath', 'wc', 'storage'].includes(R.type) || DRESS.test(norm(R.name));
      if (beds.length && ensuiteOK && beds.some((b) => hubAccess(b))) continue;
      add('P2', { room: R.id, piece: R.id, type: R.type, level: L.id, value: nb.get(R.id).size, unit: 'links', detail: `${R.id} (${R.name}) is reached ${beds.length ? 'only through a bedroom' : nb.get(R.id).size ? 'only through rooms that are not a hall, living, dining or kitchen' : 'by no door or passage'}` });
    }
    // ---- P3 proportions and sizes
    for (const R of rooms) {
      const nm = norm(R.name), multi = nLevels > 1;
      if (['living', 'dining', 'kitchen', 'bedroom', 'kids', 'office'].includes(R.type)) {
        const mr = minRectRatio(R.face);
        if (mr.ratio > 2.2 + 1e-6) add('P3', { room: R.id, piece: R.id, type: R.type, level: L.id, value: r3(mr.ratio), unit: 'ratio', detail: `${R.id} (${R.name}) is ${mr.long.toFixed(1)} x ${mr.short.toFixed(1)} m, ratio ${mr.ratio.toFixed(2)} > 2.2` });
      }
      const lim = R.type === 'bedroom' ? (MAIN_BED.test(nm) ? 14 : 9) : R.type === 'kids' ? 9 : R.type === 'living' ? (multi ? 20 : 18) : R.type === 'kitchen' ? 9 : R.type === 'bath' ? 4 : R.type === 'wc' ? 1.6 : 0;
      if (lim && R.area < lim - 1e-6) add('P3', { room: R.id, piece: R.id, type: R.type, level: L.id, value: r3(R.area), unit: 'm2', detail: `${R.id} (${R.name}) is ${R.area.toFixed(1)} m2, min ${lim}` });
    }
    // ---- P4 doors
    for (const x of I.ops) {
      if (x.o.type !== 'door') continue;
      const w = x.w, o = x.o, wd = o.u1 - o.u0, small = [x.plus, x.minus].some((r) => r && ['wc', 'utility', 'storage'].includes(r.type));
      const minW = small ? 0.7 : 0.8;
      if (wd < minW - 1e-6) add('P4', { room: x.plus?.id ?? x.minus?.id ?? '-', piece: o.id, type: 'door', level: L.id, value: r3(wd), unit: 'm', detail: `door ${o.id} is ${wd.toFixed(2)} m wide, min ${minW}`, at: x.c.map(r3) });
            const swing = (o.opens_to === 'right' ? x.minus : x.plus), other = (o.opens_to === 'right' ? x.plus : x.minus);
      if (swing && other && swing.area < 0.8 * other.area && !['bath', 'wc', 'storage', 'utility', 'stair'].includes(swing.type)) add('P4', { room: swing.id, piece: o.id, type: 'door', level: L.id, value: r3(swing.area), unit: 'm2', detail: `door ${o.id} swings into ${swing.id} (${swing.area.toFixed(1)} m2) from the larger ${other.id} (${other.area.toFixed(1)} m2)`, at: x.c.map(r3) });
      for (const s of levelStairs) {
        const sn = o.opens_to === 'right' ? -1 : 1, nn = [w.normal[0] * sn, w.normal[1] * sn], c0 = x.c;
        const sect = rectAt([c0[0] + nn[0] * (w.thickness / 2 + wd / 2), c0[1] + nn[1] * (w.thickness / 2 + wd / 2)], w.dir, nn, -wd / 2, wd / 2, wd / 2);
        if (overlap(sect, s.footprint) > 0.02) add('P4', { room: swing?.id ?? '-', piece: o.id, type: 'door', level: L.id, value: 0, detail: `door ${o.id} swings onto stair ${s.id}`, at: c0.map(r3) });
      }
    }
    // ---- P6 an inner door whose other jamb has a wall within 0.6 m but whose hinge has none: the open leaf stands in the room instead of lying by the wall
    for (const x of I.ops) {
      const o = x.o, w = x.w, sw = o.swing;
      if (o.type !== 'door' || !sw || w.kind === 'exterior') continue;
      const others = I.wallRects.filter((r) => r.w !== w && Math.abs(dot(r.w.dir, w.dir)) < 0.2);
      const reach = (from, away) => { for (let t = 0; t <= 0.6 + 1e-9; t += 0.02) if (others.some((r) => pip([from[0] + away[0] * t + sw.sn[0] * 0.4, from[1] + away[1] * t + sw.sn[1] * 0.4], r.poly))) return t; return Infinity; };
      const wd = o.u1 - o.u0, h = [sw.px, sw.py], far = [sw.px + sw.closed[0] * (wd - 0.1), sw.py + sw.closed[1] * (wd - 0.1)];
      const gh = reach(h, [-sw.closed[0], -sw.closed[1]]), go = reach(far, sw.closed);
      if (go <= 0.6 && gh > 0.6) {
        const sr = (o.u0 + o.u1) / 2 > 0 ? (x.plus?.id ?? x.minus?.id ?? '-') : '-';
        add('P6', { room: sr, piece: o.id, type: 'door', level: L.id, value: r3(go), unit: 'm', detail: `door ${o.id}: the hinge has no wall within 0.6 m, the other jamb has one ${go.toFixed(2)} m away; the open leaf stands in the room`, at: x.c.map(r3) });
      }
    }
    // ---- P5 room names and use
    for (const R of rooms) {
      const named = STAIR_NAME.test(norm(R.name)) || (roomsApi?.roomTypeFromName ? !!roomsApi.roomTypeFromName(R.name) : true);
      const okUse = !R.r.use || R.r.use === 'other' || !USE_OK[R.r.use] || USE_OK[R.r.use].includes(R.type);
      if (!named) add('P5', { room: R.id, piece: R.id, type: R.type, level: L.id, value: 0, detail: `room name "${R.name}" is not recognised by name, type falls back to ${R.type}` });
      else if (!okUse) add('P5', { room: R.id, piece: R.id, type: R.type, level: L.id, value: 0, detail: `room "${R.name}" is typed ${R.type} but its use is ${R.r.use}` });
    }
  }
  for (const st of model.stairs ?? []) delete st._decorZone;
  return V;
}
