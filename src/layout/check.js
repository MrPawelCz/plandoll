// checkLayout(model, layout, { allowedTypes }) -> list of violations. Used by the tests and by tools/layout-svg.mjs.
// A violation is { kind, level, piece, other?, room?, detail }. Kinds: unknown-type, size-range, bad-number, outside-room, overlap,
// door-zone, stair, tall-before-window, floating-prop, missing-set, too-many-pieces.
import { SPEC_BY_ID } from '../furniture/specs.js';
import { roomType } from './rooms.js';
import { obb, penetration, boxInsidePolygon, roomInterior, levelZones } from './geometry.js';
import { blocks, defaultAllowed, LIMITS } from './engine.js';

// What a finished room of each type must hold (any of the listed ids counts for one entry, `min` pieces of the group).
const SETS = {
  living: { minArea: 8, need: [['sofa2', 'sofa3'], ['tv-unit'], ['coffee-table'], ['rug']] },
  bedroom: { minArea: 6, need: [['bed-double', 'bed-single', 'bed-king']], bigNeed: [10, [['wardrobe']]], wideNeed: [2.4, [['nightstand']]] },
  kitchen: { minArea: 5, need: [['fridge'], ['kitchen-sink'], ['kitchen-hob'], ['kitchen-base']] },
  bath: { minArea: 2.5, need: [['toilet'], ['washbasin']], bigNeed: [3.5, [['shower', 'bathtub']]] },
  wc: { minArea: 1.0, need: [['toilet'], ['washbasin']] },
  dining: { minArea: 6, need: [['dining-table'], ['dining-chair', 'dining-chair', 'dining-chair', 'dining-chair']] },
  office: { minArea: 5, need: [['desk'], ['desk-chair']] },
};
export const REQUIRED_SETS = SETS;

export function checkLayout(model, layout, { allowedTypes } = {}) {
  const out = [];
  const allow = allowedTypes ? new Set(allowedTypes) : defaultAllowed();
  const total = layout.levels.reduce((n, l) => n + l.pieces.length, 0);
  if (total > LIMITS.total) out.push({ kind: 'too-many-pieces', detail: `${total} pieces` });
  for (const L of layout.levels) {
    const level = model.levels.find((l) => l.id === L.id);
    if (!level) { out.push({ kind: 'outside-room', level: L.id, detail: 'unknown level' }); continue; }
    if (L.pieces.length > LIMITS.perLevel) out.push({ kind: 'too-many-pieces', level: L.id, detail: `${L.pieces.length} pieces` });
    const zones = levelZones(level, model);
    const interiors = new Map();
    for (const r of level.rooms) { let ip = null; try { ip = roomInterior(level, r); } catch { ip = null; } interiors.set(r.id, ip); }
    const items = [];
    for (const p of L.pieces) {
      const spec = SPEC_BY_ID[p.type];
      if (!spec) { out.push({ kind: 'unknown-type', level: L.id, piece: p.id, detail: String(p.type) }); continue; }
      if (![p.x, p.y, p.rot, p.elev, ...(p.size ?? [])].every(Number.isFinite) || !Array.isArray(p.size) || p.size.length !== 3) { out.push({ kind: 'bad-number', level: L.id, piece: p.id }); continue; }
      ['w', 'd', 'h'].forEach((k, i) => {
        const r = spec.range[k];
        const lo = r ? r[0] : spec.size[i], hi = r ? r[1] : spec.size[i];
        if (p.size[i] < lo - 1e-4 || p.size[i] > hi + 1e-4) out.push({ kind: 'size-range', level: L.id, piece: p.id, detail: `${p.type} ${k}=${p.size[i]} outside ${lo}..${hi}` });
      });
      const q = { ...p, _spec: spec, _flat: spec.place.mode === 'floor-flat', _mode: spec.place.mode, _obb: obb(p.x, p.y, p.size[0], p.size[1], p.rot) };
      items.push(q);
      const ip = interiors.get(p.room);
      if (!ip || !boxInsidePolygon(q._obb, ip.poly)) out.push({ kind: 'outside-room', level: L.id, piece: p.id, room: p.room, detail: `${p.type} at ${p.x},${p.y}` });
      const z0 = p.elev, z1 = p.elev + p.size[2];
      for (const dz of zones.doors) if (z0 < dz.top && penetration(q._obb, dz.box) > 0.004) out.push({ kind: 'door-zone', level: L.id, piece: p.id, detail: `${p.type} near ${dz.o.id}` });
      for (const st of zones.stairs) if (penetration(q._obb, st.box) > 0.004) out.push({ kind: 'stair', level: L.id, piece: p.id, detail: p.type });
      if ((spec.tall || q._mode === 'wall-mount') && q._mode !== 'window') {
        for (const wz of zones.windows) if (z1 > wz.sill && z0 < wz.top && penetration(q._obb, wz.box) > 0.004) out.push({ kind: 'tall-before-window', level: L.id, piece: p.id, detail: `${p.type} at ${wz.o.id}` });
      }
    }
    const byId = new Map(items.map((q) => [q.id, q]));
    const ids = new Set();
    for (const q of items) {
      if (ids.has(q.id)) out.push({ kind: 'bad-number', level: L.id, piece: q.id, detail: 'duplicate id' });
      ids.add(q.id);
      if (q.on) {
        const par = byId.get(q.on);
        if (!par || !q._spec.place.onTop?.includes(par.type) || Math.abs(q.elev - (par.elev + par.size[2])) > 0.02 || Math.hypot(q.x - par.x, q.y - par.y) > Math.max(par.size[0], par.size[1]) / 2) out.push({ kind: 'floating-prop', level: L.id, piece: q.id, detail: `${q.type} on ${q.on}` });
      }
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) if (blocks(items[i], items[j])) out.push({ kind: 'overlap', level: L.id, piece: items[i].id, other: items[j].id, detail: `${items[i].type} / ${items[j].type}` });
    }
    for (const r of level.rooms) {
      const ip = interiors.get(r.id);
      if (!ip) continue;
      const type = roomType(r, model);
      const set = SETS[type];
      if (!set || ip.area < set.minArea) continue;
      const mine = items.filter((q) => q.room === r.id);
      const used = new Set();
      let minDim = Infinity;
      { const xs = ip.poly.map((q) => q[0]), ys = ip.poly.map((q) => q[1]); minDim = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }
      const groups = [...set.need, ...(set.bigNeed && ip.area >= set.bigNeed[0] ? set.bigNeed[1] : []), ...(set.wideNeed && minDim >= set.wideNeed[0] ? set.wideNeed[1] : [])];
      for (const group of groups) {
        const hit = group.find((id) => allow.has(id) && mine.some((q, k) => q.type === id && !used.has(k + id)));
        if (!group.some((id) => allow.has(id))) continue;
        if (!hit) { out.push({ kind: 'missing-set', level: L.id, room: r.id, detail: `${type} lacks ${group[0]}` }); continue; }
        const need = group.length > 1 && group.every((g) => g === group[0]) ? group.length : 1;
        if (mine.filter((q) => q.type === hit).length < need) out.push({ kind: 'missing-set', level: L.id, room: r.id, detail: `${type} needs ${need} x ${hit}` });
      }
    }
  }
  return out;
}

export function countsByRoom(layout) {
  const out = {};
  for (const L of layout.levels) for (const p of L.pieces) out[`${L.id}/${p.room}`] = (out[`${L.id}/${p.room}`] ?? 0) + 1;
  return out;
}
