// Room areas as the page shows them (the room labels). No DOM and no three.js, so Node tests reach it.
// A room polygon runs along the wall centrelines, which is 10 to 25% more than the floor you can see. So the area shown is
// what the drawing declares, or, when the plan carries none, an estimate net of the walls (the validator's netArea).
import { netArea, netAreaCost, AREA_TOL, NET_AREA_TOL } from '../core/validate.js';
import { getLang } from './i18n.js';

// The net estimate checks every edge of a room against every wall, which a plan inside all the caps can make slow (150 rooms of
// 120 points among 600 walls). So a level may spend NET_BUDGET wall checks on it (the validator's whole budget is 12 million);
// a room that does not fit is shown at its polygon area, marked as an estimate, and counted in `skipped`. Each room is worked
// out once and kept, so the scene and the labels never repeat it.
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

// The area of the room as drawn, net of its walls, within the budget of its level: { m2, skipped? } (a room that does not fit the budget is left at its polygon area).
function netEstimate(room, walls) {
  const used = spent.get(walls) || 0, cost = netAreaCost(room.polygon, walls.length);
  if (used + cost > NET_BUDGET) return { m2: room.area, skipped: true };
  spent.set(walls, used + cost);
  const net = netArea(room.polygon, walls);
  return { m2: Number.isFinite(net) && net > 0 ? net : room.area };
}

function measure(room, walls) {
  const declared = room.declaredArea;
  if (Number.isFinite(declared) && declared > 0) return { m2: declared, estimated: false };
  return { ...netEstimate(room, walls), estimated: true };
}

// The area that the list of rooms shows. The figure that the drawing declares is the one people expect (it is what the architect printed), but a plan made from a
// picture can declare an area that its own polygon contradicts (a wall left out, a wrong scale), and a list beside the model that says 13.4 m² for a room that visibly
// encloses 6.1 would be believed over the model. So the declared figure is shown only when it agrees with the room as drawn, by the test of the validator (W102): within
// AREA_TOL of the polygon along the wall centrelines, or within NET_AREA_TOL of the polygon net of its walls. Otherwise the area is worked out from the polygon, net of the
// walls, and marked as an estimate. { m2, estimated, declared?, skipped? }: estimated false is the declared figure; with estimated true, `declared` (when the plan had one)
// is the figure that was left out. Each room is worked out once and kept.
// A room whose net estimate does not fit the budget of its level (a big plan) cannot be tested against its walls. Its declared figure then stands when a net area could be it,
// that is when it is not above the polygon along the centrelines and not below NET_LOW of it (walls take a tenth to a quarter of a room), and `skipped` says that it went
// unchecked; without that, the rooms that come after the budget is gone would be shown at the polygon along the centrelines, 10 to 25% too large, beside rooms that are not.
export const NET_LOW = 0.65;
const listed = new WeakMap(); // room -> { walls, area }
export function listedArea(room, walls) {
  const hit = listed.get(room);
  if (hit && hit.walls === walls) return hit.area;
  const area = judge(room, walls);
  listed.set(room, { walls, area });
  return area;
}

function judge(room, walls) {
  const declared = Number.isFinite(room.declaredArea) && room.declaredArea > 0 ? room.declaredArea : null;
  const centre = Number.isFinite(room.area) && room.area > 0 ? room.area : null;
  if (declared !== null && centre !== null && Math.abs(declared - centre) / centre <= AREA_TOL) return { m2: declared, estimated: false };
  const net = netEstimate(room, walls);
  if (declared !== null && net.skipped && centre !== null && declared >= centre * NET_LOW && declared <= centre) return { m2: declared, estimated: false, skipped: true };
  // the second window of W102 exists only where there is a net area to compare with: a wall along an edge takes something off the polygon (no walls, or none along the room: the same figure)
  const withNet = !net.skipped && centre !== null && net.m2 > 0 && net.m2 < centre * 0.995;
  if (declared !== null && withNet && Math.abs(declared - net.m2) / net.m2 <= NET_AREA_TOL) return { m2: declared, estimated: false };
  return { m2: net.m2, estimated: true, ...(declared !== null ? { declared } : {}), ...(net.skipped ? { skipped: true } : {}) };
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
