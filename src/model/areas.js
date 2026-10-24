// Room areas as the viewer shows them (labels, About sheet, GLB node data). No DOM and no three.js, so Node tests reach it.
// A room polygon runs along the wall centrelines, which is 10 to 25% more than the floor you can see. So the area shown is
// what the drawing declares, or, when the plan carries none, an estimate net of the walls (the validator's netArea).
import { netArea, netAreaCost } from '../core/validate.js';
import { getLang } from './i18n.js';

// The net estimate checks every edge of a room against every wall, which a plan inside all the caps can make slow (150 rooms of
// 120 points among 600 walls). So a level may spend NET_BUDGET wall checks on it (the validator's whole budget is 12 million);
// a room that does not fit is shown at its polygon area, marked as an estimate, and counted in `skipped`. Each room is worked
// out once and kept, so the scene, the labels and the About sheet never repeat it.
export const NET_BUDGET = 3000000;
const spent = new WeakMap(); // walls of a level -> wall checks spent so far
const shown = new WeakMap(); // room -> { walls, area }

// { m2, estimated } for a room of a model level (metres) and the walls of that level; skipped: true when the budget was used up.
export function roomArea(room, walls) {
  const hit = shown.get(room);
  if (hit && hit.walls === walls) return hit.area;
  const area = measure(room, walls);
  shown.set(room, { walls, area });
  return area;
}

function measure(room, walls) {
  const declared = room.declaredArea;
  if (Number.isFinite(declared) && declared > 0) return { m2: declared, estimated: false };
  const used = spent.get(walls) || 0, cost = netAreaCost(room.polygon, walls.length);
  if (used + cost > NET_BUDGET) return { m2: room.area, estimated: true, skipped: true };
  spent.set(walls, used + cost);
  const net = netArea(room.polygon, walls);
  return { m2: Number.isFinite(net) && net > 0 ? net : room.area, estimated: true };
}

// "12,3 m²" in Polish, "12.3 m²" in English; an estimate gets a leading "~".
export function formatArea(m2, estimated = false, lang = getLang()) {
  return `${estimated ? '~' : ''}${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(m2)} m²`;
}

export function areaText(room, walls, lang) {
  const a = roomArea(room, walls);
  return formatArea(a.m2, a.estimated, lang);
}

// Sum over all rooms of a built model: { m2, estimated, rooms, skipped }; estimated as soon as one room has no declared area,
// skipped counts the rooms whose estimate was left out for size.
export function totalArea(model) {
  let m2 = 0, estimated = false, rooms = 0, skipped = 0;
  for (const lv of model.levels) {
    for (const r of lv.rooms) {
      if (r.polygon.length < 3) continue;
      const a = roomArea(r, lv.walls);
      m2 += a.m2; estimated = estimated || a.estimated; rooms++;
      if (a.skipped) skipped++;
    }
  }
  return { m2, estimated, rooms, skipped };
}
