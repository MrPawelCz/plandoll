// Picking pieces with a ray: every piece of a layout is an oriented box (centre x, y on the plan, angle rot in degrees as in
// docs/DESIGN.md section 2, size [w, d, h], standing from elev up to elev + h on a level whose floor is at `levelBase(levelId)`).
// Pure functions in metres, no DOM and no three.js: tested in Node. A ray is { origin: [x, y, z], direction: [x, y, z] } (the
// short name `dir` is accepted too); plan y is world z.
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v) => (Array.isArray(v) && v.length === 3 && v.every(fin) ? v : null);
const rayOf = (ray) => { const o = vec3(ray?.origin), d = vec3(ray?.direction ?? ray?.dir); return o && d && Math.hypot(...d) > 1e-12 ? { o, d } : null; };

// Where the ray meets the horizontal plane at height y: [x, y, z], or null when the ray runs parallel to it or the plane is behind.
export function floorHit(ray, y = 0) {
  const r = rayOf(ray);
  if (!r || !fin(y)) return null;
  if (Math.abs(r.d[1]) < 1e-9) return null;
  const t = (y - r.o[1]) / r.d[1];
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return [r.o[0] + r.d[0] * t, y, r.o[2] + r.d[2] * t];
}

// A matrix that only turns and shifts (4 x 4, column-major, like the hinge matrices of the open shell) is valid when it holds 16 finite numbers.
const rigidOf = (m) => (Array.isArray(m) && m.length === 16 && m.every(fin) ? m : null);

// The ray as seen from the place a turned piece came from: the inverse of the matrix `m` (a turn and a shift, see foldwalls.js hingeMatrix) applied to the ray.
// A piece that hangs on a wall which has turned is drawn at m * (its place in the plan); this ray meets the piece's box at its place in the plan, at the same
// distance t as the original ray meets the drawn piece, because the matrix keeps lengths. Returns a ray in { origin, direction } form, or null for a bad ray or matrix.
export function rayInFrame(ray, m) {
  const r = rayOf(ray), k = rigidOf(m);
  if (!r || !k) return null;
  const back = (v, shift) => [0, 1, 2].map((i) => k[i * 4] * (v[0] - (shift ? k[12] : 0)) + k[i * 4 + 1] * (v[1] - (shift ? k[13] : 0)) + k[i * 4 + 2] * (v[2] - (shift ? k[14] : 0)));
  return { origin: back(r.o, true), direction: back(r.d, false) };
}

// Where the ray meets the plane through `point` with the normal `normal`: [x, y, z], or null when the ray runs (nearly) parallel to it or the plane is behind.
export function planeHit(ray, point, normal) {
  const r = rayOf(ray), p = vec3(point), n = vec3(normal);
  if (!r || !p || !n) return null;
  const den = r.d[0] * n[0] + r.d[1] * n[1] + r.d[2] * n[2];
  if (Math.abs(den) < 1e-9 * Math.hypot(...r.d) * Math.hypot(...n)) return null;
  const t = ((p[0] - r.o[0]) * n[0] + (p[1] - r.o[1]) * n[1] + (p[2] - r.o[2]) * n[2]) / den;
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];
}

// Where a ray meets the surface that a piece slides over while it is dragged, as a plan point [x, y], or null. Normally that is the floor plane at `height` (the
// foot of the piece). A piece that hangs on an outer wall that has turned slides over the inner face of that wall instead: `host` is { matrix, plane } as
// openshell.hostOf gives it (the hinge matrix of the wall and the plane of its inner face in the wall's closed place), the ray is taken back through the matrix and
// meets the plane there, so for a finger on the fallen wall the result is the place on the wall (along it) that the finger points at, at any angle of the wall.
export function slidePoint(ray, host, height) {
  if (host) {
    const back = rayInFrame(ray, host.matrix), q = back && planeHit(back, host.plane?.point, host.plane?.normal);
    return q ? [q[0], q[2]] : null;
  }
  const fh = floorHit(ray, height);
  return fh ? [fh[0], fh[2]] : null;
}

// Entry distance of a ray into the oriented box of one piece (slab method in the frame of the piece), or null.
function boxT(r, p, base, pad) {
  const a = (p.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = r.o[0] - p.x, dz = r.o[2] - p.y;
  const o = [dx * c + dz * s, r.o[1], -dx * s + dz * c], d = [r.d[0] * c + r.d[2] * s, r.d[1], -r.d[0] * s + r.d[2] * c];
  const lo = [-p.size[0] / 2 - pad, base + p.elev - pad, -p.size[1] / 2 - pad], hi = [p.size[0] / 2 + pad, base + p.elev + p.size[2] + pad, p.size[1] / 2 + pad];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let a1 = (lo[i] - o[i]) / d[i], a2 = (hi[i] - o[i]) / d[i];
    if (a1 > a2) { const x = a1; a1 = a2; a2 = x; }
    if (a1 > t0) t0 = a1;
    if (a2 < t1) t1 = a2;
    if (t0 > t1) return null;
  }
  return t0;
}

// The nearest piece in front of the camera that the ray meets: { id, level, t, point } or null.
//   options: levelBase(levelId) -> height of the floor of that level (default 0), skip(id) -> true for pieces that are hidden,
//   pad -> metres added around every box so that thin pieces (rugs, pictures) can still be hit (default 0.02),
//   frameOf(id) -> the matrix that carries a piece from its place in the layout to where it is drawn now (a wall that has turned takes the pieces hung on it with it),
//   or null for a piece that is drawn where the layout puts it. A piece with a matrix is tested with the ray taken back through that matrix (rayInFrame); a matrix
//   that is not valid leaves the piece out. `point` is always a point of the original ray.
export function pickPiece(layout, ray, options = {}) {
  const r = rayOf(ray);
  if (!r || !Array.isArray(layout?.levels)) return null;
  const { levelBase = () => 0, skip = null, frameOf = null } = options, pad = fin(options.pad) ? options.pad : 0.02;
  const rays = new Map(); // the ray in each frame that was asked for (the pieces on one wall share a matrix)
  const rayFor = (m) => {
    if (!rays.has(m)) { const q = rayInFrame(ray, m); rays.set(m, q && rayOf(q)); }
    return rays.get(m);
  };
  let best = null;
  for (const lv of layout.levels) {
    if (!lv || !Array.isArray(lv.pieces)) continue;
    const b = Number(levelBase(lv.id));
    const base = fin(b) ? b : 0;
    for (const p of lv.pieces) {
      if (!p || !fin(p.x) || !fin(p.y) || !fin(p.rot) || !fin(p.elev) || !Array.isArray(p.size) || p.size.length !== 3 || !p.size.every(fin)) continue;
      if (skip && skip(p.id)) continue;
      const m = frameOf ? frameOf(p.id) : null, ray2 = m == null ? r : rayFor(m);
      if (!ray2) continue;
      const t = boxT(ray2, p, base, pad);
      if (t !== null && (!best || t < best.t)) best = { id: p.id, level: lv.id, t, point: [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t] };
    }
  }
  return best;
}
