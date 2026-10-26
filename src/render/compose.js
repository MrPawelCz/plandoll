// Turns a layout (plain data, see docs/DESIGN.md) into three.js objects: one group per piece, standing where the layout says,
// plus the light emitters of the visible lamps in world space. Deterministic: the same model, layout, quality and seed always
// give the same scene. No files, no network, no random numbers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPiece, applyLook } from '../furniture/index.js';
import { hashStr } from '../furniture/kit.js';
import { specOf } from '../furniture/specs.js';
import { contactMesh } from './contact.js';

// Wall heights of the cutaway view: the outer walls that face the camera are low, the other outer walls stay tall, partitions in
// between are half height. `near` says which edges of the plan face the camera ({ north, south, west, east } as booleans, see
// nearSides in src/app/camera.js); the default is the main view of the page, from the south-east.
export const WALL_LOW = 0.62, WALL_PART = 1.0;
export const NEAR_DEFAULT = Object.freeze({ south: true, east: true });
// The edges of the plan that the point (x, z) lies on, within `edge` metres of the extent ([] for the inside).
export function edgeSides(x, z, ext, edge = 0.3) {
  const out = [];
  if (z < ext.minZ + edge) out.push('north');
  if (z > ext.maxZ - edge) out.push('south');
  if (x < ext.minX + edge) out.push('west');
  if (x > ext.maxX - edge) out.push('east');
  return out;
}
export function wallCutHeight(x, z, ext, edge = 0.3, near = NEAR_DEFAULT) {
  const sides = edgeSides(x, z, ext, edge);
  if (!sides.length) return WALL_PART;
  return sides.every((s) => near?.[s]) ? WALL_LOW : Infinity; // a corner stays tall as long as one of its two walls faces away
}

const pieceSeed = (id, seed) => (hashStr(String(id)) ^ Math.imul((Number(seed) | 0) + 0x9e3779b9, 2654435761)) >>> 0;
const finite = (...v) => v.every((n) => Number.isFinite(n));

// composeLayout({ model, layout, quality, look, seed }) -> { group, emitters, pieces }
//   group     THREE.Group with one child per piece (userData.pieceId, userData.levelId, userData.type, userData.elev)
//   emitters  [{ pos: [x, y, z], color, power }] in world space, lamps of visible pieces only
//   pieces    Map pieceId -> piece group (the editor works on this)
export function composeLayout({ model, layout, quality = 'medium', look = 'textured', seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'furnishing';
  const pieces = new Map();
  const floor = new Map((model?.levels ?? []).map((lv) => [lv.id, Number(lv.elevation) || 0]));
  for (const lc of layout?.levels ?? []) {
    const base = floor.get(lc.id) ?? 0;
    for (const p of lc.pieces ?? []) {
      if (!specOf(p.type) || pieces.has(p.id) || !finite(p.x, p.y)) continue;
      const rot = Number.isFinite(p.rot) ? p.rot : 0, elev = Number.isFinite(p.elev) ? p.elev : 0;
      const g = buildPiece(p.type, { size: p.size, colors: p.colors, seed: pieceSeed(p.id, seed), quality });
      applyLook(g, look);
      g.position.set(p.x, base + elev, p.y);
      g.rotation.y = (-rot * Math.PI) / 180;
      g.userData.pieceId = p.id; g.userData.levelId = lc.id; g.userData.elev = elev; g.userData.pieceType = p.type;
      g.name = p.id;
      group.add(g); pieces.set(p.id, g);
    }
  }
  group.updateMatrixWorld(true);
  return { group, emitters: emittersOf(pieces), pieces };
}

// World-space emitters of every visible piece that carries lamps.
export function emittersOf(pieces) {
  const out = [], v = new THREE.Vector3();
  for (const g of pieces.values()) {
    if (!g.visible || !g.userData.emitters?.length) continue;
    g.updateWorldMatrix(true, false);
    for (const e of g.userData.emitters) {
      v.set(e.pos[0], e.pos[1], e.pos[2]).applyMatrix4(g.matrixWorld);
      if (finite(v.x, v.y, v.z)) out.push({ pos: [v.x, v.y, v.z], color: e.color, power: e.power });
    }
  }
  return out;
}

// The same lamps, kept apart by level: Map levelId -> emitters of the visible pieces of that level (in the order of the pieces). The page keeps the lists
// and gives the stage the lamps of the floors on show, so a change of floors needs no new walk over the pieces.
export function emittersByLevel(pieces) {
  const levels = new Map();
  for (const g of pieces.values()) { const lv = g.userData.levelId ?? ''; if (!levels.has(lv)) levels.set(lv, new Map()); }
  for (const [id, g] of pieces) levels.get(g.userData.levelId ?? '').set(id, g);
  return new Map([...levels].map(([lv, part]) => [lv, emittersOf(part)]));
}

// Hides pieces that the cutaway would spoil, and returns how many it hid:
//  - hung pieces (pictures, mirrors, wall cabinets, curtains) whose lower edge is above the wall behind them, which would hang in
//    the air, and curtains behind a low wall;
//  - tall furniture with its back to the viewer (or to a low outer wall): it would show a blank back and cover the room behind it.
//    Lamps stay, their light is part of the picture.
// `view` is the horizontal direction from the model towards the camera (x, z), the default is the main view of the page;
// `near` the edges that face the camera (see wallCutHeight).
export function cutawayPieces(pieces, ext, view = [0.5, 0.7], near = NEAR_DEFAULT) {
  const vl = Math.hypot(view[0], view[1]) || 1, vx = view[0] / vl, vz = view[1] / vl;
  let hidden = 0;
  for (const g of pieces.values()) {
    g.visible = true;
    const spec = specOf(g.userData.pieceType), mode = spec?.place?.mode;
    const hung = mode === 'wall-mount' || mode === 'window';
    const tallBack = (mode === 'floor' || mode === 'corner') && spec.place.against !== 'free' && !spec.emits && g.userData.size[2] >= 1.2;
    if (!hung && !tallBack) continue;
    const size = g.userData.size, back = new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion);
    const reach = size[1] / 2 + 0.08;
    const h = wallCutHeight(g.position.x + back.x * reach, g.position.z + back.z * reach, ext, 0.3, near);
    const away = hung ? g.userData.elev >= h - 0.02 || (mode === 'window' && h < 1.5) : h === WALL_LOW || back.x * vx + back.z * vz > 0.35;
    if (away) { g.visible = false; hidden++; }
  }
  return hidden;
}

// The room to look at from close by: the one with the most pieces (ties go to the larger room).
// Returns { cx, cz, r, y } (centre of its bounding box in plan metres, half diagonal, floor height) or null.
export function focusRoom(model, layout) {
  const count = new Map();
  for (const lc of layout?.levels ?? []) for (const p of lc.pieces ?? []) { const k = `${lc.id}|${p.room}`; count.set(k, (count.get(k) ?? 0) + 1); }
  let best = null;
  for (const lv of model?.levels ?? []) for (const r of lv.rooms ?? []) {
    const poly = r.polygon;
    if (!Array.isArray(poly) || poly.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!finite(x0, x1, z0, z1)) continue;
    const n = count.get(`${lv.id}|${r.id}`) ?? 0, area = (x1 - x0) * (z1 - z0);
    if (!best || n > best.n || (n === best.n && area > best.area)) best = { n, area, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2, y: Number(lv.elevation) || 0 };
  }
  return best && { cx: best.cx, cz: best.cz, r: best.r, y: best.y };
}

// Lamp shades glow as the evening comes on: the emissive intensity of every shade material is scaled from its own base value.
export function setLampGlow(root, k) {
  const seen = new Set(), f = 0.35 + 1.5 * Math.min(1, Math.max(0, Number(k) || 0));
  root.traverse((o) => {
    if (!o.isMesh || o.userData.slot !== 'shade') return;
    const m = o.material;
    if (!m || !('emissiveIntensity' in m) || seen.has(m)) return;
    seen.add(m);
    if (m.userData.baseGlow === undefined) m.userData.baseGlow = m.emissiveIntensity;
    m.emissiveIntensity = m.userData.baseGlow * f;
  });
}

// Draw-call saver: the visible meshes of all pieces that share a material and shadow flags become one mesh in world space.
// The per-piece groups stay untouched in `composed` (hide `composed.group` when you draw the merged group); call it again after
// the layout or the visibility of pieces changes. Geometry that cannot be merged with its neighbours stays as it is.
// `skip` (a Set of piece ids) leaves those pieces out: the editor keeps the piece being dragged as its own object.
//
// The geometry of each merged mesh is laid out level by level (the pieces come in that order, and a bucket is sorted by level when they do not), and the mesh
// remembers which stretch of its index (or of its vertices when it has no index) belongs to which level: `mesh.userData.levelRanges = [{ level, start, count }]`.
// showMergedLevels(group, shown) then draws only the stretch of the levels on show by setting the draw range, with no new merge and no extra draw call.
export function mergeByMaterial(composed, skip = null) {
  const out = new THREE.Group(); out.name = 'furnishing-merged';
  const buckets = new Map(), rank = new Map();
  composed.group.updateMatrixWorld(true);
  for (const [id, g] of composed.pieces) {
    if (!g.visible || skip?.has(id)) continue;
    const level = g.userData.levelId ?? '';
    if (!rank.has(level)) rank.set(level, rank.size);
    g.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry, names = Object.keys(geo.attributes).sort().join(',');
      const key = `${o.material.uuid}|${+o.castShadow}${+o.receiveShadow}|${geo.index ? 'i' : 'n'}|${names}`;
      let b = buckets.get(key);
      if (!b) { b = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, geoms: [], meshes: [], levels: [] }; buckets.set(key, b); }
      b.geoms.push(geo.clone().applyMatrix4(o.matrixWorld)); b.meshes.push(o); b.levels.push(level);
    });
  }
  let meshes = 0;
  for (const b of buckets.values()) {
    const at = b.geoms.map((_, i) => i);
    if (b.levels.some((lv, i) => i && rank.get(lv) < rank.get(b.levels[i - 1]))) at.sort((p, q) => rank.get(b.levels[p]) - rank.get(b.levels[q]) || p - q); // the levels must follow each other
    const geoms = at.map((i) => b.geoms[i]), mine = at.map((i) => b.meshes[i]), levels = at.map((i) => b.levels[i]);
    const sizeOf = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count);
    const levelRanges = []; // consecutive pieces of one level are one stretch
    geoms.forEach((geo, i) => {
      const n = sizeOf(geo), last = levelRanges[levelRanges.length - 1];
      if (last && last.level === levels[i]) last.count += n; else levelRanges.push({ level: levels[i], start: last ? last.start + last.count : 0, count: n });
    });
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) { // not mergeable: draw the single meshes as they are
      mine.forEach((o, i) => {
        const m = new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), b.material); m.castShadow = b.cast; m.receiveShadow = b.receive;
        m.userData.levelRanges = [{ level: levels[i], start: 0, count: sizeOf(m.geometry) }];
        out.add(m); meshes++;
      });
      continue;
    }
    if (geoms.length > 1) geoms.forEach((x) => x.dispose());
    const m = new THREE.Mesh(merged, b.material); m.castShadow = b.cast; m.receiveShadow = b.receive; m.name = `merged:${b.material.name || meshes}`;
    m.userData.levelRanges = levelRanges;
    out.add(m); meshes++;
  }
  const contact = contactMesh(composed.pieces, skip); // one soft footprint patch per piece standing on the floor
  if (contact) { out.add(contact); meshes++; }
  return { group: out, meshes };
}

// Draws only the levels in `shown` (a Set of level ids; null or undefined for all of them) out of the meshes that mergeByMaterial made: the draw range of each mesh
// is cut to the stretch of those levels, and a mesh with nothing on show is hidden. Nothing is rebuilt. The levels on show must follow each other in the order of
// the pieces (all of them, or one, as the page uses it): the stretch between the first and the last of them is drawn.
export function showMergedLevels(group, shown) {
  group.traverse((o) => {
    const ranges = o.userData?.levelRanges;
    if (!o.isMesh || !ranges) return;
    if (!shown) { o.visible = true; o.geometry.setDrawRange(0, Infinity); return; }
    const hit = ranges.filter((r) => shown.has(r.level));
    if (!hit.length) { o.visible = false; return; }
    const start = Math.min(...hit.map((r) => r.start)), end = Math.max(...hit.map((r) => r.start + r.count));
    o.visible = true; o.geometry.setDrawRange(start, end - start);
  });
}

// Frees the geometry of a composed group (materials are shared and stay).
export function disposeComposed(...groups) {
  for (const group of groups) {
    if (!group) continue;
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    group.removeFromParent();
  }
}
