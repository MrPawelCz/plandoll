// The geometry of "open the shell" (see render/openshell.js): which walls fall outward, to which side, round which line, and where they lie when
// they are flat. Pure: no three.js, no DOM. A plan point (x, y) is the world point (x, z); heights are local to the level (0 is its floor).
import { pointInPolygon, distancePointToSegment } from '../core/geom2d.js';

export const FOLD_KIND = 'exterior'; // the walls that open are the ones the plan marks as outer walls
const ALONG = [0.2, 0.5, 0.8]; // points along a wall used to find which side the rooms are on
const NEAR_WALL = 0.2; // metres beyond half the thickness within which a point still counts as hanging on a wall

// The unit normal (plan x, y) of a wall that points away from the rooms. Rooms on one side only settle it; rooms on both sides or on neither
// (a plan with a stray wall) fall back to the side that faces away from the middle of the level's walls.
export function outwardNormal(level, w) {
  const n = w.normal ?? [w.dir[1], -w.dir[0]], off = w.thickness / 2 + 0.12;
  let plus = 0, minus = 0;
  for (const room of level.rooms ?? []) {
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) continue;
    for (const s of ALONG) {
      const px = w.from[0] + w.dir[0] * w.length * s, py = w.from[1] + w.dir[1] * w.length * s;
      if (pointInPolygon([px + n[0] * off, py + n[1] * off], room.polygon)) plus++;
      if (pointInPolygon([px - n[0] * off, py - n[1] * off], room.polygon)) minus++;
    }
  }
  let sign;
  if (plus !== minus) sign = plus > minus ? -1 : 1;
  else {
    let cx = 0, cy = 0, k = 0;
    for (const o of level.walls ?? []) { cx += o.from[0] + o.to[0]; cy += o.from[1] + o.to[1]; k += 2; }
    if (k) { cx /= k; cy /= k; }
    const mx = (w.from[0] + w.to[0]) / 2, my = (w.from[1] + w.to[1]) / 2;
    sign = (mx - cx) * n[0] + (my - cy) * n[1] >= 0 ? 1 : -1;
  }
  return [n[0] * sign, n[1] * sign];
}

// Every wall that opens, in the order of the model: { index, level, levelId, id, out: [x, y], dir: [x, y], from, to (the ends of the outer face line,
// corner extensions included), thickness, height, slab, y (the height of the foot line in the level), reach (how far the top lies from the foot line
// once the wall is flat), pivot: [x, y] a point on the foot line }.
export function foldWalls(model) {
  const out = [];
  (model?.levels ?? []).forEach((level, li) => {
    for (const w of level.walls ?? []) {
      if (w.kind !== FOLD_KIND || !(w.length > 1e-6) || !w.dir || !w.from) continue;
      const nrm = outwardNormal(level, w), t = w.thickness, e0 = w.ext?.[0] ?? 0, e1 = w.ext?.[1] ?? 0, h = Number(w.height) || Number(level.height) || 2.6;
      const slab = Number(level.slab) || 0;
      const a = [w.from[0] - w.dir[0] * e0 + nrm[0] * t / 2, w.from[1] - w.dir[1] * e0 + nrm[1] * t / 2];
      const b = [w.to[0] + w.dir[0] * e1 + nrm[0] * t / 2, w.to[1] + w.dir[1] * e1 + nrm[1] * t / 2];
      out.push({
        index: out.length, level: li, levelId: level.id, id: w.id, out: nrm, dir: w.dir, from: a, to: b, thickness: t, height: h, slab,
        y: -slab, reach: h + slab, pivot: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      });
    }
  });
  return out;
}

// The four corners (plan x, y) of a wall lying flat: the foot line and the line its top edge reaches.
export function flatFootprint(f) {
  const r = f.reach;
  return [f.from, f.to, [f.to[0] + f.out[0] * r, f.to[1] + f.out[1] * r], [f.from[0] + f.out[0] * r, f.from[1] + f.out[1] * r]];
}

// The extent (like modelExtent) of the closed model together with every wall lying flat: the box the camera has to keep in the picture.
export function openExtent(model, ext, walls = foldWalls(model)) {
  const e = { ...ext };
  for (const f of walls) for (const [x, y] of flatFootprint(f)) {
    e.minX = Math.min(e.minX, x); e.maxX = Math.max(e.maxX, x);
    e.minZ = Math.min(e.minZ, y); e.maxZ = Math.max(e.maxZ, y);
  }
  return e;
}

// The points the camera keeps in the picture with the shell: the eight corners of the closed model and the corners of every wall lying flat (at the height of its
// foot line and of its inner face). Fitting these is tighter than fitting the box round them, which also holds the empty air above the flat walls.
export function openPoints(model, ext, walls = foldWalls(model)) {
  const pts = [];
  for (const x of [ext.minX, ext.maxX]) for (const y of [ext.minY, ext.maxY]) for (const z of [ext.minZ, ext.maxZ]) pts.push([x, y, z]);
  for (const f of walls) {
    const base = (Number(model.levels[f.level]?.elevation) || 0) + f.y;
    for (const [x, z] of flatFootprint(f)) { pts.push([x, base, z]); pts.push([x, base + f.thickness, z]); }
  }
  return pts;
}

// The matrix (4 x 4, column-major, as THREE.Matrix4.fromArray reads it) that turns a wall by `deg` degrees about its foot line towards the
// outside, in level space. 0 gives the identity; 90 lays the wall flat with its inner face up.
export function hingeMatrix(f, deg) {
  const a = (Number.isFinite(deg) ? deg : 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = f.dir[0], dz = f.dir[1];
  const sn = ((-dz * f.out[0] + dx * f.out[1]) >= 0 ? 1 : -1) * s; // the sense that takes "up" to the outside
  const k = 1 - c;
  const r00 = c + k * dx * dx, r01 = -sn * dz, r02 = k * dx * dz;
  const r10 = sn * dz, r11 = c, r12 = -sn * dx;
  const r20 = k * dx * dz, r21 = sn * dx, r22 = c + k * dz * dz;
  const px = f.pivot[0], py = f.y, pz = f.pivot[1];
  const tx = px - (r00 * px + r01 * py + r02 * pz), ty = py - (r10 * px + r11 * py + r12 * pz), tz = pz - (r20 * px + r21 * py + r22 * pz);
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1];
}

// The index of the folding wall that a point (plan x, y) on a level hangs on (within half the wall's thickness and a little more), or -1.
export function hostWall(walls, levelId, x, y) {
  let best = -1, bestD = Infinity;
  for (const f of walls) {
    if (f.levelId !== levelId) continue;
    const d = distancePointToSegment([x + f.out[0] * f.thickness / 2, y + f.out[1] * f.thickness / 2], f.from, f.to).dist - f.thickness / 2; // from the middle line of the wall
    if (d <= NEAR_WALL && d < bestD) { best = f.index; bestD = d; }
  }
  return best;
}
