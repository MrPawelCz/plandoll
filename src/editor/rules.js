// Placement rules for the layout editor: snapping (walls, 5 cm grid, 15 degree angle) and the checks that say whether a place is
// allowed (overlap, outside the room, door and stair zones, tall pieces at windows, props without support). Pure functions on the
// built model (buildModel output) and a layout (docs/DESIGN.md section 3); no DOM, no three.js, bounded loops.
// Pieces are treated as immutable: boxes are cached per piece object.
import { specOf } from '../furniture/specs.js';
import { obb, penetration, boxInsidePolygon, roomInterior, levelZones, rotFromFront, pointInPolygon, frontOf, axisOf } from '../layout/geometry.js';
import { blocks } from '../layout/engine.js';

export const SNAP_DEFAULTS = Object.freeze({
  grid: 0.05,        // metres; 0 switches the grid off
  angle: 15,         // degrees; 0 switches the angle step off
  wallGap: 0.02,     // gap between the back of a floor piece and the wall
  wallGapMounted: 0.004, // the same for pieces that hang on the wall or follow a window
  wallReach: 0.2,    // a wall pulls the back of a piece from this far away
  wallAngle: 20,     // ... and only when the piece is turned at most this far from facing away from the wall
  edges: false,      // true switches on snapping to the sides of neighbouring pieces (off unless asked for)
  edgeReach: 0.15,   // a neighbour pulls a side from this far away (both pieces parallel)
  edgeGap: 0.005,    // the gap left between the two sides (0 to 1 cm)
});
// Problems that strict mode refuses; the others (door zone, stair, tall piece at a window, blocked front) are warnings in every mode.
export const HARD_KINDS = Object.freeze(['overlap', 'outside-room', 'floating-prop']);

const r3 = (v) => Math.round(v * 1000) / 1000;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
export function normRot(deg) {
  const a = r3((((deg % 360) + 360) % 360));
  return a >= 360 ? 0 : a;
}
const angleDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };

// ---- per level caches (a model is built once and never changes) ----
const levelCache = new WeakMap();
function levelCtx(model, levelId) {
  if (!model || !Array.isArray(model.levels)) return null;
  const level = model.levels.find((l) => l && l.id === levelId);
  if (!level) return null;
  let c = levelCache.get(level);
  if (!c) {
    let zones;
    try { zones = levelZones(level, model); } catch { zones = { doors: [], windows: [], stairs: [] }; }
    c = { level, zones, interiors: new Map() };
    levelCache.set(level, c);
  }
  return c;
}
function interiorOf(ctx, roomId) {
  if (ctx.interiors.has(roomId)) return ctx.interiors.get(roomId);
  const room = (ctx.level.rooms ?? []).find((r) => r.id === roomId);
  let ip = null;
  if (room) { try { ip = roomInterior(ctx.level, room); } catch { ip = null; } }
  ctx.interiors.set(roomId, ip);
  return ip;
}

// Id of the room whose floor holds the point (the preferred room wins when it holds it too), or null.
export function roomAt(model, levelId, x, y, prefer = null) {
  const ctx = levelCtx(model, levelId);
  if (!ctx || !fin(x) || !fin(y)) return null;
  if (prefer) { const ip = interiorOf(ctx, prefer); if (ip && pointInPolygon([x, y], ip.poly)) return prefer; }
  for (const r of (ctx.level.rooms ?? []).slice(0, 400)) {
    const ip = interiorOf(ctx, r.id);
    if (ip && pointInPolygon([x, y], ip.poly)) return r.id;
  }
  return null;
}

// The rooms of a level, in plan order: [{ id, name, use, area, polygon, interior }] (at most 400). `polygon` is the room as drawn in
// the plan, `interior` the floor inside the walls (the area roomAt tests), both as copies of [x, y] pairs; `interior` is null when the
// room has no usable floor. An unknown level, or a model that is not a model, gives [].
export function roomsOf(model, levelId) {
  const ctx = levelCtx(model, levelId);
  if (!ctx) return [];
  const out = [];
  for (const r of (ctx.level.rooms ?? []).slice(0, 400)) {
    if (!r || typeof r.id !== 'string' || !Array.isArray(r.polygon)) continue;
    const ip = interiorOf(ctx, r.id);
    out.push({
      id: r.id, name: typeof r.name === 'string' && r.name ? r.name : r.id, use: typeof r.use === 'string' ? r.use : null,
      area: fin(r.area) ? r.area : null, polygon: r.polygon.map((q) => [q[0], q[1]]), interior: ip ? ip.poly.map((q) => [q[0], q[1]]) : null,
    });
  }
  return out;
}

// The room record (as roomsOf lists it) whose floor holds the point, or null (the preferred room wins when it holds it too).
export function roomInfoAt(model, levelId, x, y, prefer = null) {
  const id = roomAt(model, levelId, x, y, prefer);
  return id ? roomsOf(model, levelId).find((r) => r.id === id) ?? null : null;
}

const adaptCache = new WeakMap();
function finitePiece(p) {
  return p && typeof p === 'object' && Array.isArray(p.size) && p.size.length === 3 && [p.x, p.y, p.rot, p.elev, ...p.size].every(fin);
}
function adapt(p) {
  let a = adaptCache.get(p);
  if (!a) {
    a = { id: p.id, on: p.on ?? null, elev: p.elev, size: p.size, _obb: obb(p.x, p.y, p.size[0], p.size[1], p.rot), _flat: specOf(p.type)?.place.mode === 'floor-flat' };
    adaptCache.set(p, a);
  }
  return a;
}
const levelOf = (layout, levelId) => (layout && Array.isArray(layout.levels) ? layout.levels.find((l) => l && l.id === levelId) : null);

// The top piece under the point that this spec may sit on (type listed in place.onTop, point inside its footprint and within the
// reach checkLayout allows), or null. `selfId` is left out.
export function supportAt(layout, levelId, spec, selfId, x, y) {
  const level = levelOf(layout, levelId);
  if (!level || !spec.place.onTop || !fin(x) || !fin(y)) return null;
  let best = null;
  for (const q of level.pieces) {
    if (q.id === selfId || !spec.place.onTop.includes(q.type) || !finitePiece(q)) continue;
    const b = adapt(q)._obb;
    const dx = x - q.x, dy = y - q.y;
    const u = dx * b.ux + dy * b.uy, f = dx * b.fx + dy * b.fy;
    if (Math.abs(u) > b.hw || Math.abs(f) > b.hd) continue;
    if (Math.hypot(dx, dy) > Math.max(q.size[0], q.size[1]) / 2) continue;
    if (!best || q.elev + q.size[2] > best.elev + best.size[2]) best = q;
  }
  return best;
}

// Pieces that stand on the floor and keep their front free (the layout engine's definition of solid).
const solidSpec = (spec) => spec.place.mode === 'floor' || spec.place.mode === 'corner';
// Pieces that are meant to stand in front of another one: they do not count as blocking its front.
const SEATS = ['sofa2', 'sofa3', 'sofa-bed', 'armchair'];
const LOW_TABLES = ['coffee-table', 'coffee-table-round'];
// Fixtures of one run share their open floor: the fronts of kitchen units meet at the corner of an L or U shaped run, and bathroom
// fixtures face the same middle of the room, so those strips may cross each other.
const KITCHEN_RUN = ['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'fridge', 'washing-machine'];
const BATH_FIXTURES = ['toilet', 'washbasin', 'shower', 'bathtub', 'washing-machine'];
const FRONT_COMPANIONS = new Map([...SEATS.map((t) => [t, LOW_TABLES]), ['desk', ['desk-chair']], ['tv-unit', [...SEATS, ...LOW_TABLES]]]);
for (const group of [KITCHEN_RUN, BATH_FIXTURES]) for (const t of group) FRONT_COMPANIONS.set(t, [...new Set([...(FRONT_COMPANIONS.get(t) ?? []), ...group])]);

// The strip in front of a piece that has to stay free (`place.clearFront` deep, 90% of the width), as a box, or null.
export function clearBox(piece) {
  const spec = piece ? specOf(piece.type) : null;
  if (!spec || !solidSpec(spec) || !(spec.place.clearFront > 0) || !finitePiece(piece)) return null;
  const cf = spec.place.clearFront, [fx, fy] = frontOf(piece.rot);
  return obb(piece.x + fx * (piece.size[1] / 2 + cf / 2), piece.y + fy * (piece.size[1] / 2 + cf / 2), piece.size[0] * 0.9, cf, piece.rot);
}

// Everything wrong with the piece as it stands: [{ kind, with? }]. Kinds: unknown-type, bad-number, outside-room, door-zone, stair,
// tall-before-window, overlap, floating-prop, front-blocked. The room checks need the model; overlaps and props only need the layout.
// `front-blocked` (soft): the free strip in front of the piece reaches another piece of the same room (`with`) or the wall (no `with`).
// checkLayout does not report it; the layout engine uses the same strip when it places pieces.
export function placementProblems(model, layout, levelId, piece) {
  const spec = piece ? specOf(piece.type) : null;
  if (!spec) return [{ kind: 'unknown-type' }];
  if (!finitePiece(piece)) return [{ kind: 'bad-number' }];
  const out = [];
  const box = obb(piece.x, piece.y, piece.size[0], piece.size[1], piece.rot);
  const ctx = levelCtx(model, levelId);
  if (ctx) {
    const ip = interiorOf(ctx, piece.room);
    if (!ip || !boxInsidePolygon(box, ip.poly)) out.push({ kind: 'outside-room' });
    const z0 = piece.elev, z1 = piece.elev + piece.size[2];
    for (const dz of ctx.zones.doors) if (z0 < dz.top && penetration(box, dz.box) > 0.004) out.push({ kind: 'door-zone', with: dz.o.id });
    for (const st of ctx.zones.stairs) if (penetration(box, st.box) > 0.004) out.push({ kind: 'stair' });
    if ((spec.tall || spec.place.mode === 'wall-mount') && spec.place.mode !== 'window') {
      for (const wz of ctx.zones.windows) if (z1 > wz.sill && z0 < wz.top && penetration(box, wz.box) > 0.004) out.push({ kind: 'tall-before-window', with: wz.o.id });
    }
  }
  const level = levelOf(layout, levelId);
  if (level) {
    const me = { id: piece.id, on: piece.on ?? null, elev: piece.elev, size: piece.size, _obb: box, _flat: spec.place.mode === 'floor-flat' };
    for (const q of level.pieces) {
      if (q.id === piece.id || !finitePiece(q)) continue;
      if (blocks(me, adapt(q))) out.push({ kind: 'overlap', with: q.id });
    }
    if (piece.on || spec.place.mode === 'surface') {
      const par = piece.on ? level.pieces.find((q) => q.id === piece.on) : null;
      const ok = par && finitePiece(par) && spec.place.onTop?.includes(par.type) && Math.abs(piece.elev - (par.elev + par.size[2])) <= 0.02
        && Math.hypot(piece.x - par.x, piece.y - par.y) <= Math.max(par.size[0], par.size[1]) / 2;
      if (!ok) out.push({ kind: 'floating-prop', ...(piece.on ? { with: piece.on } : {}) });
    }
    const strip = piece.on ? null : clearBox(piece);
    if (strip) {
      let hit = null;
      for (const q of level.pieces) {
        if (q.id === piece.id || q.room !== piece.room || !finitePiece(q)) continue;
        const qs = specOf(q.type);
        if (qs && solidSpec(qs) && !q.on && !FRONT_COMPANIONS.get(piece.type)?.includes(q.type) && penetration(strip, adapt(q)._obb) > 0.01) { hit = q.id; break; }
      }
      if (hit) out.push({ kind: 'front-blocked', with: hit });
      else if (ctx) { const ip = interiorOf(ctx, piece.room); if (ip && !boxInsidePolygon(strip, ip.poly, 0.01)) out.push({ kind: 'front-blocked' }); }
    }
  }
  return out;
}

export function hardProblems(problems, kinds = HARD_KINDS) {
  return problems.filter((p) => kinds.includes(p.kind));
}

// Pull the back of a piece to the nearest wall of the room it stands in: the piece must be close to the wall (wallReach), turned at
// most wallAngle degrees from facing away from it, and its centre must lie along the wall. Returns { x, y, rot } or null.
function wallSnap(ip, spec, x, y, rot, size, sn) {
  const mode = spec.place.mode, against = spec.place.against;
  const wants = mode === 'wall-mount' || mode === 'window' || ((mode === 'floor' || mode === 'corner') && (against === 'back' || against === 'back-or-free'));
  if (!wants) return null;
  const gap = mode === 'wall-mount' || mode === 'window' ? sn.wallGapMounted : sn.wallGap;
  const d = size[1];
  let best = null;
  for (const e of ip.edges) {
    const wallRot = rotFromFront(e.n[0], e.n[1]);
    const dr = angleDiff(rot, wallRot);
    if (dr > sn.wallAngle) continue;
    const along = (x - e.a[0]) * e.t[0] + (y - e.a[1]) * e.t[1];
    if (along < 0 || along > e.len) continue;
    const across = (x - e.a[0]) * e.n[0] + (y - e.a[1]) * e.n[1];
    const off = across - d / 2 - gap;
    if (Math.abs(off) > sn.wallReach) continue;
    const score = Math.abs(off) + dr * 0.002;
    if (!best || score < best.score) best = { score, x: x - e.n[0] * off, y: y - e.n[1] * off, rot: wallRot };
  }
  return best;
}

// Pull a side of the piece to the side of a close neighbour (floor pieces only, both turned the same way modulo 90 degrees, the
// neighbour closer than edgeReach, the pieces side by side with some overlap along the shared side). One shift, the smallest.
// Returns { x, y } or null.
function edgeSnap(layout, levelId, piece, x, y, rot, sn) {
  const level = levelOf(layout, levelId), spec = specOf(piece.type);
  if (!level || !spec || !solidSpec(spec) || piece.on) return null;
  let best = null;
  for (const q of level.pieces) {
    if (q.id === piece.id || q.room !== piece.room || q.on || !finitePiece(q)) continue;
    const qs = specOf(q.type);
    if (!qs || !solidSpec(qs)) continue;
    const dr = angleDiff(rot, q.rot) % 90;
    if (Math.min(dr, 90 - dr) > 0.5) continue;
    const swap = Math.abs(((((rot - q.rot) % 180) + 180) % 180) - 90) < 45;
    const mu = (swap ? piece.size[1] : piece.size[0]) / 2, mf = (swap ? piece.size[0] : piece.size[1]) / 2;
    const [ux, uy] = axisOf(q.rot), [fx, fy] = frontOf(q.rot);
    const du = (x - q.x) * ux + (y - q.y) * uy, df = (x - q.x) * fx + (y - q.y) * fy;
    const hw = q.size[0] / 2, hd = q.size[1] / 2;
    const gu = Math.abs(du) - (hw + mu), gf = Math.abs(df) - (hd + mf);
    const cands = [];
    if (Math.abs(df) < hd + mf && gu >= 0 && gu <= sn.edgeReach) cands.push([gu - sn.edgeGap, Math.sign(du) || 1, ux, uy]);
    if (Math.abs(du) < hw + mu && gf >= 0 && gf <= sn.edgeReach) cands.push([gf - sn.edgeGap, Math.sign(df) || 1, fx, fy]);
    for (const [shift, sgn, ax, ay] of cands) if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { shift, x: x - sgn * shift * ax, y: y - sgn * shift * ay };
  }
  return best;
}

// A piece that stands with its back on a wall keeps its back there when its depth changes: returns the new { x, y } or null.
// `before` and `after` are the piece with its old and new size; the back counts as on the wall within 3 cm of the usual gap.
export function keepBackOnWall(model, levelId, before, after, snap = {}) {
  const spec = before ? specOf(before.type) : null, ctx = levelCtx(model, levelId);
  if (!spec || !ctx || !finitePiece(before) || !finitePiece(after)) return null;
  const ip = interiorOf(ctx, after.room);
  if (!ip) return null;
  const sn = { ...SNAP_DEFAULTS, ...(snap && typeof snap === 'object' ? snap : {}) };
  if (!wallSnap(ip, spec, before.x, before.y, before.rot, before.size, { ...sn, wallReach: 0.03, wallAngle: 1 })) return null;
  const w = wallSnap(ip, spec, after.x, after.y, after.rot, after.size, { ...sn, wallReach: 0.2, wallAngle: 1 });
  return w ? { x: r3(w.x), y: r3(w.y) } : null;
}

// Snap a wanted place and say what is wrong with it. `piece` is the piece being placed (type, size, room, id, on, elev, rot);
// `want` is { x, y, rot? }. Options: snap (false, or { grid, angle, wallGap, wallReach, wallAngle } overrides), keepRot (the angle
// step is skipped: used by moves, so a piece turned to 17 degrees stays at 17).
// Result: { x, y, rot, room, on, elev, snapped: { grid, angle, wall }, problems }.
export function placeAt(model, layout, levelId, piece, want, opts = {}) {
  const spec = specOf(piece.type);
  const sn = opts.snap === false ? null : { ...SNAP_DEFAULTS, ...(opts.snap && typeof opts.snap === 'object' ? opts.snap : {}) };
  const snapped = { grid: false, angle: false, wall: false };
  let x = want.x, y = want.y, rot = fin(want.rot) ? want.rot : piece.rot;
  if (sn) {
    if (sn.angle > 0 && !opts.keepRot) { const a = Math.round(rot / sn.angle) * sn.angle; snapped.angle = Math.abs(a - rot) > 1e-9; rot = a; }
    if (sn.grid > 0) {
      const gx = Math.round(x / sn.grid) * sn.grid, gy = Math.round(y / sn.grid) * sn.grid;
      snapped.grid = Math.abs(gx - x) > 1e-9 || Math.abs(gy - y) > 1e-9;
      x = gx; y = gy;
    }
  }
  rot = normRot(rot);
  const ctx = levelCtx(model, levelId);
  let room = piece.room;
  if (ctx) { const r = roomAt(model, levelId, x, y, piece.room); if (r) room = r; }
  if (sn && sn.edges === true && spec) {
    snapped.edge = false;
    const e = edgeSnap(layout, levelId, { ...piece, room }, x, y, rot, sn);
    if (e) { x = e.x; y = e.y; snapped.edge = true; }
  }
  if (sn && ctx) {
    const ip = interiorOf(ctx, room);
    const w = ip && spec ? wallSnap(ip, spec, x, y, rot, piece.size, sn) : null;
    if (w) { x = w.x; y = w.y; rot = w.rot; snapped.wall = true; }
  }
  x = r3(x); y = r3(y); rot = normRot(rot);
  let on = piece.on ?? null, elev = piece.elev;
  if (spec && spec.place.mode === 'surface') {
    const sup = supportAt(layout, levelId, spec, piece.id, x, y);
    if (sup) { on = sup.id; elev = r3(sup.elev + sup.size[2]); room = sup.room; }
  }
  const problems = placementProblems(model, layout, levelId, { ...piece, x, y, rot, room, on, elev });
  return { x, y, rot, room, on, elev, snapped, problems };
}
