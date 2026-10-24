// normalizePlan: returns a deep, normalized copy of a plan. Lengths in metres, defaults applied,
// elevations resolved, derived wall fields added. It does NOT validate (see validate.js).
import { unitFactor } from './units.js';
import { bbox, polygonArea } from './geom2d.js';
import { hasOwn } from './caps.js';

export const DEFAULTS = Object.freeze({
  levelHeight: 2.7,
  slab: 0.2,
  thickness: Object.freeze({ exterior: 0.3, interior: 0.12, partition: 0.08 }),
  opening: Object.freeze({
    door: Object.freeze({ height: 2.05, sill: 0 }),
    window: Object.freeze({ height: 1.2, sill: 0.9 }),
    passage: Object.freeze({ height: 2.1, sill: 0 }),
  }),
});

const pt = (p, f) => [p[0] * f, p[1] * f];
const len = (v, f, dflt) => (v === undefined ? dflt : v * f);

export function normalizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('plan must be a JSON object');
  const sourceUnits = input.units ?? 'm';
  const f = unitFactor(sourceUnits);
  const out = { version: input.version ?? 1, name: input.name ?? '', units: 'm', sourceUnits, meta: input.meta ?? {}, levels: [] };
  let nextElevation = 0;
  for (const lv of Array.isArray(input.levels) ? input.levels : []) {
    const height = len(lv.height, f, DEFAULTS.levelHeight);
    const slab = len(lv.slab, f, DEFAULTS.slab);
    const elevation = len(lv.elevation, f, nextElevation);
    nextElevation = elevation + height + slab;
    const walls = (lv.walls ?? []).map((w) => {
      const kind = w.kind ?? 'interior';
      const from = pt(w.from, f), to = pt(w.to, f);
      const dx = to[0] - from[0], dy = to[1] - from[1];
      const length = Math.hypot(dx, dy);
      return {
        id: w.id, kind, from, to, length,
        dir: length > 0 ? [dx / length, dy / length] : [1, 0],
        thickness: len(w.thickness, f, hasOwn(DEFAULTS.thickness, kind) ? DEFAULTS.thickness[kind] : DEFAULTS.thickness.interior),
        height: len(w.height, f, height),
      };
    });
    const openings = (lv.openings ?? []).map((o) => {
      const d = hasOwn(DEFAULTS.opening, o.type) ? DEFAULTS.opening[o.type] : DEFAULTS.opening.door;
      return {
        id: o.id, wall: o.wall, type: o.type,
        offset: o.offset * f, width: o.width * f,
        height: len(o.height, f, d.height), sill: len(o.sill, f, d.sill),
        hinge: o.hinge ?? 'start', opens_to: o.opens_to ?? 'left',
      };
    });
    const rooms = (lv.rooms ?? []).map((r) => {
      const polygon = (r.polygon ?? []).map((p) => pt(p, f));
      return {
        id: r.id, name: r.name ?? r.id, use: r.use ?? 'other', floor: r.floor ?? 'wood', ceiling: r.ceiling ?? true,
        polygon, area: polygon.length >= 3 ? Math.abs(polygonArea(polygon)) : 0,
        declaredArea: r.area === undefined ? undefined : r.area * f * f,
      };
    });
    const stairs = (lv.stairs ?? []).map((s) => ({ id: s.id, from: pt(s.from, f), to: pt(s.to, f), width: s.width * f, steps: s.steps, to_level: s.to_level, rise: s.rise === undefined ? undefined : s.rise * f }));
    const furniture = (lv.furniture ?? []).map((m) => ({
      id: m.id, type: m.type, center: pt(m.center, f),
      size: m.size ? pt(m.size, f) : undefined, rotation: m.rotation ?? 0, height: m.height === undefined ? undefined : m.height * f,
    }));
    out.levels.push({ id: lv.id, name: lv.name ?? lv.id, elevation, height, slab, walls, openings, rooms, stairs, furniture });
  }
  const pts = out.levels.flatMap((l) => l.walls.flatMap((w) => [w.from, w.to]));
  out.bounds = pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return out;
}
