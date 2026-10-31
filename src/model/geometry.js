// Pure geometry builder: normalized plan (metres) -> model. No DOM, no three.js, deterministic.
// The scene, the layout engine, the physics of Spacer and the tests all read the same model, so what you see is what you collide with
// (walls, windows, stairs and shut doors; furniture is not part of the plan model here, and it is walked through).
// Plan point (x, y) at height h maps to world (x, elevation + h, y). Angles are radians here, clockwise on the plan.
import { pointInPolygon, distancePointToSegment, polygonCentroid, bbox } from '../core/geom2d.js';
import { CAPS, hasOwn } from '../core/caps.js';

export const CUT_HEIGHT = 1.2;
export const EXPLODE_FACTOR = 1.2;
export const PLAYER = Object.freeze({ radius: 0.2, eye: 1.6, walk: 1.4, run: 2.8, turnRate: 110 });
export const DOOR_FREE_SILL = 0.35; // door and passage gaps with a lower sill are walkable
export const STAIR_SWITCH = 0.98; // fraction along a stair where the player changes level
export const LEAF_OPEN_DEG = 75;
export const JUMP = Object.freeze({ speed: 3.0, gravity: 9.8 }); // launch speed (m/s) and gravity (m/s2): a jump peaks at 0.46 m and lasts 0.61 s
export const DOOR_REACH = 1.3; // metres from the player to a door that the space bar can still work
export const DOOR_CONE_DEG = 70; // a door counts when it lies within this angle of where the player looks
export const DOOR_SECONDS = 0.45; // time the leaf takes to swing between open and shut

// [width along local x, depth along local y, height]. Local +y (plan down at rotation 0) is the front of an item.
export const FURNITURE_DEFAULTS = Object.freeze({
  sofa: [2.0, 0.9, 0.8],
  'bed-double': [2.0, 1.6, 0.5],
  'bed-single': [2.0, 0.9, 0.5],
  'table-dining': [1.6, 0.9, 0.75],
  'table-coffee': [1.0, 0.6, 0.4],
  chair: [0.45, 0.45, 0.9],
  desk: [1.4, 0.7, 0.75],
  wardrobe: [1.0, 0.6, 2.1],
  'kitchen-counter': [1.2, 0.6, 0.9],
  fridge: [0.6, 0.65, 1.8],
  stove: [0.6, 0.6, 0.9],
  sink: [0.8, 0.55, 0.9],
  bathtub: [1.7, 0.75, 0.55],
  shower: [0.9, 0.9, 2.0],
  toilet: [0.4, 0.7, 0.4],
  basin: [0.6, 0.45, 0.85],
  'tv-unit': [1.5, 0.4, 0.5],
  bookshelf: [0.9, 0.3, 1.9],
  armchair: [0.85, 0.85, 0.85],
  plant: [0.4, 0.4, 1.0],
  rug: [2.0, 1.4, 0.01],
});
const NO_COLLIDE = new Set(['rug', 'plant']);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rad = (d) => (d * Math.PI) / 180;

// A piece is never drawn (or collided with) larger than CAPS.furnitureSpan in any direction, whatever the plan says:
// a size written in centimetres would otherwise build thousands of meshes. The validator warns about it (W112).
export function furnitureSize(f) {
  const d = hasOwn(FURNITURE_DEFAULTS, f.type) ? FURNITURE_DEFAULTS[f.type] : [0.6, 0.6, 0.6];
  const cap = (v) => Math.min(v, CAPS.furnitureSpan);
  return { w: cap(f.size?.[0] ?? d[0]), d: cap(f.size?.[1] ?? d[1]), h: cap(f.height ?? d[2]) };
}

// Vertical offset of each level for an explode factor 0..1 (cumulative, so uneven heights never overlap).
export function levelOffsets(model, explode) {
  const out = [];
  let acc = 0;
  for (const lv of model.levels) {
    out.push(acc * explode * EXPLODE_FACTOR);
    acc += lv.height;
  }
  return out;
}

function prepareWall(w, walls) {
  const reach = 0.5 * w.thickness + 0.02;
  const touches = (p) => walls.some((o) => o !== w && distancePointToSegment(p, o.from, o.to).dist <= reach);
  return {
    ...w,
    angle: Math.atan2(w.dir[1], w.dir[0]),
    normal: [w.dir[1], -w.dir[0]], // left of travel on the plan (y down)
    ext: [touches(w.from) ? w.thickness / 2 : 0, touches(w.to) ? w.thickness / 2 : 0],
  };
}

function gapOf(w, o) {
  const L = w.length;
  return {
    o,
    a: clamp(o.offset, 0, L),
    b: clamp(o.offset + o.width, 0, L),
    sill: clamp(o.sill, 0, w.height),
    top: clamp(o.sill + o.height, 0, w.height),
  };
}

// Wall solids: full pieces between the gaps, lintels above and (windows) pieces below. u runs along the wall.
function splitWall(w, ops) {
  const L = w.length, H = w.height;
  const ext = (p, q) => [p <= 1e-6 ? p - w.ext[0] : p, q >= L - 1e-6 ? q + w.ext[1] : q];
  const gaps = ops.map((o) => gapOf(w, o)).filter((g) => g.b - g.a > 1e-4 && g.top - g.sill > 1e-4).sort((x, y) => x.a - y.a);
  const pieces = [];
  const add = (part, p, q, y0, y1, openingId) => {
    const [u0, u1] = ext(p, q);
    pieces.push({ part, u0, u1, y0, y1, openingId });
  };
  let cur = 0;
  for (const g of gaps) {
    if (g.a > cur + 1e-4) add('solid', cur, g.a, 0, H);
    cur = Math.max(cur, g.b);
  }
  if (cur < L - 1e-4) add('solid', cur, L, 0, H);
  for (const g of gaps) {
    if (g.sill > 1e-4) add('below', g.a, g.b, 0, g.sill, g.o.id);
    if (g.top < H - 1e-4) add('lintel', g.a, g.b, g.top, H, g.o.id);
  }
  return pieces;
}

// 2D collider spans along a wall: everything except door and passage gaps (windows stay solid).
function colliderSpans(w, ops) {
  const L = w.length;
  const free = ops.filter((o) => (o.type === 'door' || o.type === 'passage') && o.sill <= DOOR_FREE_SILL).map((o) => gapOf(w, o)).filter((g) => g.b - g.a > 1e-4).sort((x, y) => x.a - y.a);
  const spans = [];
  const push = (p, q) => {
    spans.push([p <= 1e-6 ? p - w.ext[0] : p, q >= L - 1e-6 ? q + w.ext[1] : q]);
  };
  let cur = 0;
  for (const g of free) {
    if (g.a > cur + 1e-4) push(cur, g.a);
    cur = Math.max(cur, g.b);
  }
  if (cur < L - 1e-4) push(cur, L);
  return spans;
}

// Oriented box in plan space; wbox positions it in the wall frame (u along, v across, v>0 is the left side).
function wbox(w, u0, u1, v0, v1, y0, y1, mat, name) {
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return {
    name, mat, y0, y1,
    cx: w.from[0] + w.dir[0] * um + w.normal[0] * vm,
    cy: w.from[1] + w.dir[1] * um + w.normal[1] * vm,
    sx: u1 - u0, sz: v1 - v0, angle: w.angle,
  };
}

// Where a door leaf stands for t from 0 (shut, in line with the wall) to 1 (open, the pose that is drawn): hinge point (px, py), the
// direction of the shut leaf, the side it swings to, its length and the open angle. t = 1 gives the pose the leaf was always drawn in.
export function leafPose(h, t) {
  const a = h.open * t;
  const ex = h.closed[0] * Math.cos(a) + h.sn[0] * Math.sin(a), ey = h.closed[1] * Math.cos(a) + h.sn[1] * Math.sin(a);
  return { cx: h.px + (ex * h.wl) / 2, cy: h.py + (ey * h.wl) / 2, angle: Math.atan2(ey, ex) };
}

function buildOpening(w, o) {
  const top = o.sill + o.height, fj = 0.05;
  const parts = [];
  let leaf = null, arc = null, swing = null;
  if (o.type === 'door') {
    const fd = w.thickness + 0.03;
    parts.push(wbox(w, o.u0, o.u0 + fj, -fd / 2, fd / 2, o.sill, top, 'frame', `opening:${o.id}/jamb-a`));
    parts.push(wbox(w, o.u1 - fj, o.u1, -fd / 2, fd / 2, o.sill, top, 'frame', `opening:${o.id}/jamb-b`));
    parts.push(wbox(w, o.u0 + fj, o.u1 - fj, -fd / 2, fd / 2, top - fj, top, 'frame', `opening:${o.id}/head`));
    const wl = Math.max(0.2, o.u1 - o.u0 - 2 * fj - 0.01);
    const side = o.opens_to === 'right' ? -1 : 1;
    const sn = [w.normal[0] * side, w.normal[1] * side];
    const startHinge = o.hinge !== 'end';
    const up = startHinge ? o.u0 + fj : o.u1 - fj;
    const px = w.from[0] + w.dir[0] * up + sn[0] * (w.thickness / 2 - 0.02);
    const py = w.from[1] + w.dir[1] * up + sn[1] * (w.thickness / 2 - 0.02);
    const closed = startHinge ? w.dir : [-w.dir[0], -w.dir[1]];
    const open = rad(LEAF_OPEN_DEG);
    swing = { px, py, closed, sn, wl, open };
    leaf = { name: `opening:${o.id}/leaf`, mat: 'leaf', ...leafPose(swing, 1), y0: o.sill + 0.01, y1: top - fj, sx: wl, sz: 0.04 };
    const cross = closed[0] * sn[1] - closed[1] * sn[0];
    arc = { cx: px, cy: py, r: wl, a0: Math.atan2(closed[1], closed[0]), sweep: (cross >= 0 ? 1 : -1) * open };
    parts.push(leaf);
  } else if (o.type === 'window') {
    const fw = 0.05, dv = 0.08;
    parts.push(wbox(w, o.u0, o.u0 + fw, -dv / 2, dv / 2, o.sill, top, 'frame', `opening:${o.id}/jamb-a`));
    parts.push(wbox(w, o.u1 - fw, o.u1, -dv / 2, dv / 2, o.sill, top, 'frame', `opening:${o.id}/jamb-b`));
    parts.push(wbox(w, o.u0 + fw, o.u1 - fw, -dv / 2, dv / 2, top - fw, top, 'frame', `opening:${o.id}/head`));
    parts.push(wbox(w, o.u0 + fw, o.u1 - fw, -dv / 2, dv / 2, o.sill, o.sill + fw, 'frame', `opening:${o.id}/rail`));
    if (o.u1 - o.u0 > 1.5) {
      const m = (o.u0 + o.u1) / 2;
      parts.push(wbox(w, m - 0.02, m + 0.02, -dv / 2, dv / 2, o.sill + fw, top - fw, 'frame', `opening:${o.id}/mullion`));
    }
    parts.push(wbox(w, o.u0 + fw, o.u1 - fw, -0.008, 0.008, o.sill + fw, top - fw, 'glass', `opening:${o.id}/glass`));
    parts.push(wbox(w, o.u0 - 0.03, o.u1 + 0.03, -(w.thickness / 2 + 0.04), w.thickness / 2 + 0.04, o.sill - 0.03, o.sill, 'frame', `opening:${o.id}/ledge`));
  }
  return { parts, leaf, arc, swing };
}

function labelPoint(poly) {
  const c = polygonCentroid(poly);
  const edgeDist = (p) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, distancePointToSegment(p, poly[i], poly[(i + 1) % poly.length]).dist);
    return d;
  };
  const bb = bbox(poly);
  // The grid has at most maxSamples points (fewer for a polygon with many edges, each point is tested against all of them)
  // and at most 200 columns or rows, so a long thin room or one far flung vertex cannot make this long.
  const maxSamples = Math.min(2500, Math.max(150, Math.floor(40000 / poly.length)));
  const step = Math.max(0.05, Math.min(bb.width, bb.height) / 24, Math.max(bb.width, bb.height) / 200, Math.sqrt((bb.width * bb.height) / maxSamples));
  let best = null, bestD = -1;
  // Counted loops: far from the origin a float step can fall below the spacing of the numbers and `x += step` would never advance.
  const nx = Math.ceil((bb.maxX - bb.minX - step / 2) / step), ny = Math.ceil((bb.maxY - bb.minY - step / 2) / step);
  for (let i = 0; i < nx; i++) {
    const x = bb.minX + step / 2 + i * step;
    for (let j = 0; j < ny; j++) {
      const y = bb.minY + step / 2 + j * step;
      if (!pointInPolygon([x, y], poly)) continue;
      const d = edgeDist([x, y]);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
  }
  if (pointInPolygon(c, poly) && edgeDist(c) >= bestD * 0.85) return c;
  return best ?? c;
}

function rectCollider(id, kind, cx, cy, hx, hy, ux, uy) {
  const ex = Math.abs(ux) * hx + Math.abs(uy) * hy, ey = Math.abs(uy) * hx + Math.abs(ux) * hy;
  return { id, kind, cx, cy, hx, hy, ux, uy, minX: cx - ex, maxX: cx + ex, minY: cy - ey, maxY: cy + ey };
}

function stairFootprint(st) {
  const ext = st.run / 2, hw = st.width / 2;
  const [dx, dy] = st.dir, px = -dy, py = dx;
  const a = [st.from[0] - dx * ext, st.from[1] - dy * ext];
  const b = [st.to[0] + dx * ext, st.to[1] + dy * ext];
  return [[a[0] + px * hw, a[1] + py * hw], [b[0] + px * hw, b[1] + py * hw], [b[0] - px * hw, b[1] - py * hw], [a[0] - px * hw, a[1] - py * hw]];
}

export function buildModel(plan) {
  const levelIndex = new Map(plan.levels.map((l, i) => [l.id, i]));
  const levels = plan.levels.map((lv, index) => {
    const walls = lv.walls.map((w) => prepareWall(w, lv.walls));
    const wallById = new Map(walls.map((w) => [w.id, w]));
    const byWall = new Map();
    const openings = [];
    for (const raw of lv.openings) {
      const w = wallById.get(raw.wall);
      if (!w) continue;
      const o = { ...raw, wallId: w.id, u0: clamp(raw.offset, 0, w.length), u1: clamp(raw.offset + raw.width, 0, w.length) };
      if (!byWall.has(w.id)) byWall.set(w.id, []);
      byWall.get(w.id).push(o);
      Object.assign(o, buildOpening(w, o));
      openings.push(o);
    }
    const colliders = [];
    for (const w of walls) {
      const ops = byWall.get(w.id) ?? [];
      w.pieces = splitWall(w, ops);
      w.spans = colliderSpans(w, ops);
      for (const [p, q] of w.spans) {
        const um = (p + q) / 2;
        colliders.push(rectCollider(w.id, 'wall', w.from[0] + w.dir[0] * um, w.from[1] + w.dir[1] * um, (q - p) / 2, w.thickness / 2, w.dir[0], w.dir[1]));
      }
    }
    // A door that can be walked through (its gap is free above) can also be shut: a collider across the whole gap. It stays out of
    // `colliders` because it only counts while the door is shut (see the world in physics.js); gap holds the two ends of the opening.
    const doors = [];
    for (const o of openings) {
      if (o.type !== 'door' || o.sill > DOOR_FREE_SILL) continue;
      const w = wallById.get(o.wallId), g = gapOf(w, o);
      if (g.b - g.a <= 1e-4) continue;
      const p = g.a <= 1e-6 ? g.a - w.ext[0] : g.a, q = g.b >= w.length - 1e-6 ? g.b + w.ext[1] : g.b, um = (p + q) / 2;
      const at = (u) => [w.from[0] + w.dir[0] * u, w.from[1] + w.dir[1] * u];
      doors.push({ id: o.id, wallId: w.id, level: index, swing: o.swing, gap: [at(g.a), at(g.b)], collider: rectCollider(o.id, 'door', ...at(um), (q - p) / 2, w.thickness / 2, w.dir[0], w.dir[1]) });
    }
    const rooms = lv.rooms.map((r) => ({ ...r, label: r.polygon.length >= 3 ? labelPoint(r.polygon) : [0, 0], ceilingHoles: [], floorHoles: [] }));
    // A furniture piece of a model that carries any has a collider, but Spacer walks through it (see the world in physics.js); the page builds its model without furniture.
    const furniture = lv.furniture.map((f) => {
      const s = furnitureSize(f);
      const rot = rad(f.rotation ?? 0);
      const collides = !NO_COLLIDE.has(f.type);
      if (collides) colliders.push(rectCollider(f.id, 'furniture', f.center[0], f.center[1], s.w / 2, s.d / 2, Math.cos(rot), Math.sin(rot)));
      return { id: f.id, type: f.type, center: f.center, w: s.w, d: s.d, h: s.h, rotation: rot, collides };
    });
    return { index, id: lv.id, name: lv.name, elevation: lv.elevation, height: lv.height, slab: lv.slab, walls, wallById, openings, doors, rooms, furniture, colliders, stairs: [] };
  });

  // Stairs always ascend: a stair pointing down is stored on the lower level with swapped ends.
  // A stair without to_level leaves the plan (a drawing of one floor): its steps climb from the owner's floor by `rise`
  // (default one storey, negative for a stair that goes down) and connect to nothing. They are drawn and block the walk,
  // with a hole in the ceiling (up) or the floor (down) when a whole room contains them; they are not part of `stairs`.
  const stairs = [];
  const looseStairs = [];
  plan.levels.forEach((lv, ownerIdx) => {
    for (const s of lv.stairs) {
      const loose = s.to_level === undefined;
      const target = loose ? undefined : levelIndex.get(s.to_level);
      if (!loose && (target === undefined || target === ownerIdx)) continue;
      const rise = loose ? (s.rise ?? lv.height + lv.slab) : levels[target].elevation - levels[ownerIdx].elevation;
      if (loose && Math.abs(rise) < 0.01) continue; // the validator rejects it (E012)
      const down = rise < 0;
      let lower = ownerIdx, upper = loose ? -1 : target, from = s.from, to = s.to;
      if (down) { lower = loose ? -1 : target; upper = ownerIdx; from = s.to; to = s.from; }
      const dx = to[0] - from[0], dy = to[1] - from[1];
      const length = Math.hypot(dx, dy);
      const delta = loose ? Math.abs(rise) : levels[upper].elevation - levels[lower].elevation;
      const base = loose && down ? -delta : 0; // height of the lowest step line above the owner's floor
      const st = {
        id: s.id, lower, upper, from, to, length, dir: length > 0 ? [dx / length, dy / length] : [1, 0],
        width: s.width, steps: s.steps, delta, riser: delta / s.steps, run: s.steps > 1 ? length / (s.steps - 1) : length,
      };
      st.angle = Math.atan2(st.dir[1], st.dir[0]);
      st.footprint = stairFootprint(st);
      st.boxes = [];
      for (let i = 0; i < st.steps; i++) {
        const sdist = i * st.run;
        st.boxes.push({ name: `stair:${st.id}/step${i}`, mat: 'stair', cx: from[0] + st.dir[0] * sdist, cy: from[1] + st.dir[1] * sdist, y0: base, y1: base + (i + 1) * st.riser, sx: st.run, sz: st.width, angle: st.angle });
      }
      const mid = [from[0] + dx / 2, from[1] + dy / 2];
      const inside = (room) => st.footprint.every((p) => pointInPolygon(p, room.polygon));
      if (loose) {
        looseStairs.push({ id: st.id, owner: ownerIdx, down, delta });
        levels[ownerIdx].stairs.push(st);
        levels[ownerIdx].colliders.push(rectCollider(st.id, 'stair', mid[0], mid[1], (length + st.run) / 2, st.width / 2, st.dir[0], st.dir[1]));
        for (const r of levels[ownerIdx].rooms) if (inside(r)) (down ? r.floorHoles : r.ceilingHoles).push(st.footprint);
        continue;
      }
      stairs.push(st);
      levels[lower].stairs.push(st);
      // Side rails keep the player on the ramp (both levels); the ends stay open.
      const px = -st.dir[1], py = st.dir[0];
      for (const li of [lower, upper]) {
        for (const sg of [1, -1]) {
          const off = sg * (st.width / 2 + 0.02);
          levels[li].colliders.push(rectCollider(st.id, 'rail', mid[0] + px * off, mid[1] + py * off, length / 2, 0.02, st.dir[0], st.dir[1]));
        }
      }
      // Holes in ceilings (lower level) and floors (upper level) where the stair footprint lies inside a room.
      for (const r of levels[lower].rooms) if (inside(r)) r.ceilingHoles.push(st.footprint);
      for (const r of levels[upper].rooms) if (inside(r)) r.floorHoles.push(st.footprint);
    }
  });

  let solids = 0, wallPieces = 0;
  for (const lv of levels) {
    for (const w of lv.walls) wallPieces += w.pieces.length;
    for (const o of lv.openings) solids += o.parts.length;
  }
  for (const st of stairs) solids += st.boxes.length;
  solids += wallPieces;

  return {
    name: plan.name, bounds: plan.bounds, levels, stairs, looseStairs, levelIndex,
    counts: {
      levels: levels.length,
      walls: levels.reduce((n, l) => n + l.walls.length, 0),
      openings: levels.reduce((n, l) => n + l.openings.length, 0),
      rooms: levels.reduce((n, l) => n + l.rooms.length, 0),
      furniture: levels.reduce((n, l) => n + l.furniture.length, 0),
      stairs: stairs.length + looseStairs.length,
    },
    stats: { wallPieces, solids },
  };
}

export function roomAt(level, x, y) {
  for (const r of level.rooms) if (r.polygon.length >= 3 && pointInPolygon([x, y], r.polygon)) return r;
  return null;
}

// Overall 3D extent of the exploded model: { minX, maxX, minY, maxY, minZ, maxZ } in world metres.
export function modelExtent(model, explode = 0) {
  const b = model.bounds;
  const off = levelOffsets(model, explode);
  let minY = Infinity, maxY = -Infinity;
  model.levels.forEach((lv, i) => {
    minY = Math.min(minY, lv.elevation - lv.slab + off[i]);
    maxY = Math.max(maxY, lv.elevation + lv.height + off[i]);
  });
  for (const st of model.looseStairs) {
    const lv = model.levels[st.owner];
    if (st.down) minY = Math.min(minY, lv.elevation - st.delta + off[st.owner]);
    else maxY = Math.max(maxY, lv.elevation + st.delta + off[st.owner]);
  }
  if (!model.levels.length) { minY = 0; maxY = 3; }
  return { minX: b.minX, maxX: b.maxX, minZ: b.minY, maxZ: b.maxY, minY, maxY };
}
