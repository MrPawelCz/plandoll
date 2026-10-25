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
//   pad -> metres added around every box so that thin pieces (rugs, pictures) can still be hit (default 0.02).
export function pickPiece(layout, ray, options = {}) {
  const r = rayOf(ray);
  if (!r || !Array.isArray(layout?.levels)) return null;
  const { levelBase = () => 0, skip = null } = options, pad = fin(options.pad) ? options.pad : 0.02;
  let best = null;
  for (const lv of layout.levels) {
    if (!lv || !Array.isArray(lv.pieces)) continue;
    const b = Number(levelBase(lv.id));
    const base = fin(b) ? b : 0;
    for (const p of lv.pieces) {
      if (!p || !fin(p.x) || !fin(p.y) || !fin(p.rot) || !fin(p.elev) || !Array.isArray(p.size) || p.size.length !== 3 || !p.size.every(fin)) continue;
      if (skip && skip(p.id)) continue;
      const t = boxT(r, p, base, pad);
      if (t !== null && (!best || t < best.t)) best = { id: p.id, level: lv.id, t, point: [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t] };
    }
  }
  return best;
}
