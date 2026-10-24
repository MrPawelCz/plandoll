// Room type detection: first by name (Polish and English, case and diacritics insensitive), then by the plan's `use`,
// then by geometry (area, windows, doors, neighbours). Pure functions, no DOM, no three.js.
import { ROOM_TYPES } from '../furniture/specs.js';
import { polygonArea } from '../core/geom2d.js';

export { ROOM_TYPES };
export const OTHER = 'other'; // returned when nothing matches: the engine adds only a plant and a picture

export function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.slice(0, 120).toLowerCase().replace(/ł/g, 'l').replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+&/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Order matters: the first rule that matches wins. "Lazienka z WC" is a bathroom, "WC" alone a toilet.
const NAME_RULES = [
  ['bath', /\b(lazienk\w*|bathroom\w*|bath|ensuite|en suite|washroom|shower\w*|prysznic\w*|wc ?\+ ?lazienka)\b/],
  ['wc', /\b(wc|toalet\w*|toilet\w*|ubikacj\w*|lavatory|restroom|powder room|cloakroom|sanitariat\w*)\b/],
  ['kids', /\b(dziec\w*|kids?|child\w*|nursery|junior|nastolat\w*|teen\w*|play ?room|pokoj mlodego)\b/],
  ['kitchen', /\b(kuchni\w*|kuchen\w*|aneks\w*|kitchen\w*|cuisine|cooking)\b/],
  ['dining', /\b(jadaln\w*|dining\w*|diner|eat in)\b/],
  ['living', /\b(salon\w*|dzienn\w*|living\w*|lounge|sitting|family room|reception|great room|studio|garsonier\w*|kawaler\w*|apartament\w*|main room)\b/],
  ['bedroom', /\b(sypialn\w*|bedroom\w*|bed room|master|guest|gosc\w*|sleeping|suite|sypialka)\b/],
  ['office', /\b(gabinet\w*|biur\w*|office|study|workroom|work room|pracown\w*|home office|library|biblioteka)\b/],
  ['hall', /\b(przedpok\w*|korytarz\w*|hol|hall\w*|entry|entrance|foyer|wiatrolap\w*|corridor|landing|passage|lobby|vestibule|podest\w*|klatk\w*|stairs?|schod\w*)\b/],
  ['utility', /\b(pralni\w*|utility|laundry|gospodarcz\w*|kotlowni\w*|technical|techniczn\w*|boiler|plant room)\b/],
  ['balcony', /\b(balkon\w*|taras\w*|balcony|terrace|patio|loggia|logia|veranda|deck)\b/],
  ['storage', /\b(schowek\w*|schowk\w*|storage|garderob\w*|closet|walk in|spizarni\w*|pantry|komork\w*|dressing|box room|cupboard)\b/],
];
const KITCHEN_WORD = /\b(kuchni\w*|kuchen\w*|aneks\w*|kitchen\w*)\b/;
const LIVING_WORD = /\b(salon\w*|dzienn\w*|living\w*|lounge)\b/;

export function roomTypeFromName(name) {
  const n = normalizeName(name);
  if (!n) return null;
  // "salon z aneksem kuchennym" is a living room with a kitchen zone, not a kitchen.
  if (LIVING_WORD.test(n) && (KITCHEN_WORD.test(n) || /\b(jadaln\w*|dining\w*)\b/.test(n))) return 'living';
  for (const [type, re] of NAME_RULES) if (re.test(n)) return type;
  return null;
}

const USE_MAP = { living: 'living', bedroom: 'bedroom', kitchen: 'kitchen', bathroom: 'bath', hall: 'hall', balcony: 'balcony', storage: 'storage', office: 'office', dining: 'dining' };

export function roomTypeFromUse(use) {
  return typeof use === 'string' && Object.prototype.hasOwnProperty.call(USE_MAP, use) ? USE_MAP[use] : null;
}

// ---- facts about a room that the geometry rules and the engine share ----
const factsCache = new WeakMap();

function onSegment(p, a, b, tol) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= tol;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tol;
}

// Openings whose centre lies on the room's outline: { doors, windows, passages } (opening objects of the model level).
export function openingsOfRoom(level, room) {
  const out = { doors: [], windows: [], passages: [] };
  const poly = room.polygon;
  if (!poly || poly.length < 3) return out;
  const wallById = level.wallById;
  for (const o of level.openings) {
    const w = wallById?.get?.(o.wallId);
    if (!w) continue;
    const um = (o.u0 + o.u1) / 2;
    const c = [w.from[0] + w.dir[0] * um, w.from[1] + w.dir[1] * um];
    const tol = Math.max(0.08, w.thickness / 2 + 0.03);
    let on = false;
    for (let i = 0; i < poly.length && !on; i++) on = onSegment(c, poly[i], poly[(i + 1) % poly.length], tol);
    if (!on) continue;
    if (o.type === 'window') out.windows.push(o);
    else if (o.type === 'passage') out.passages.push(o);
    else out.doors.push(o);
  }
  return out;
}

function facts(level, room) {
  const hit = factsCache.get(room);
  if (hit && hit.level === level) return hit;
  const poly = room.polygon ?? [];
  const area = poly.length >= 3 ? Math.abs(polygonArea(poly)) : 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  const o = openingsOfRoom(level, room);
  const f = {
    level, area: Number.isFinite(area) ? area : 0,
    minDim: poly.length >= 3 ? Math.min(maxX - minX, maxY - minY) : 0,
    windows: o.windows.length, doors: o.doors.length + o.passages.length, passages: o.passages.length,
    exteriorDoor: o.doors.some((d) => level.wallById?.get?.(d.wallId)?.kind === 'exterior'),
    open: o,
  };
  factsCache.set(room, f);
  return f;
}

export function roomFacts(level, room) { return facts(level, room); }

function levelOf(model, room) {
  for (const lv of model.levels) if (lv.rooms.includes(room)) return lv;
  return null;
}

const geoCache = new WeakMap(); // level -> Map(room -> type)

// Geometry only: used when the name says nothing and `use` is missing or "other".
function typeByGeometry(level, room) {
  let map = geoCache.get(level);
  if (!map) {
    map = new Map();
    geoCache.set(level, map);
    const rooms = level.rooms.filter((r) => r.polygon && r.polygon.length >= 3);
    const fs = new Map(rooms.map((r) => [r, facts(level, r)]));
    const assigned = new Map();
    const unnamed = rooms.filter((r) => !roomTypeFromName(r.name) && !roomTypeFromUse(r.use));
    const named = rooms.filter((r) => roomTypeFromName(r.name) || roomTypeFromUse(r.use)).map((r) => roomTypeFromName(r.name) ?? roomTypeFromUse(r.use));
    // smallest windowless rooms are bathrooms (or a toilet when tiny)
    const dark = unnamed.filter((r) => fs.get(r).windows === 0).sort((a, b) => fs.get(a).area - fs.get(b).area);
    for (const r of dark) {
      const f = fs.get(r);
      if (f.doors >= 3 || f.minDim < 1.2 || f.area > 9) { assigned.set(r, 'hall'); continue; }
      if (f.area < 2.8) assigned.set(r, 'wc');
      else if (f.area <= 7) assigned.set(r, named.includes('bath') || [...assigned.values()].includes('bath') ? 'storage' : 'bath');
      else assigned.set(r, 'storage');
    }
    const lit = unnamed.filter((r) => !assigned.has(r)).sort((a, b) => fs.get(b).area - fs.get(a).area);
    let haveLiving = named.includes('living');
    for (const r of lit) {
      const f = fs.get(r);
      if (f.exteriorDoor && f.area <= 10 && f.windows === 0) { assigned.set(r, 'hall'); continue; }
      if (!haveLiving && f.area >= 10) { assigned.set(r, 'living'); haveLiving = true; continue; }
      if (f.area < 3) assigned.set(r, 'storage');
      else if (f.area <= 22) assigned.set(r, 'bedroom');
      else assigned.set(r, 'living');
    }
    for (const r of unnamed) map.set(r, assigned.get(r) ?? OTHER);
  }
  return map.get(room) ?? OTHER;
}

// roomType(room, model) -> one of ROOM_TYPES, or 'other' when nothing fits.
export function roomType(room, model) {
  const byName = roomTypeFromName(room?.name);
  if (byName) return byName;
  const lv = model ? levelOf(model, room) : null;
  const byUse = roomTypeFromUse(room?.use);
  if (byUse) {
    // The generator of plans names a studio "living"; a use of living stays living.
    return byUse;
  }
  if (lv) return typeByGeometry(lv, room);
  return OTHER;
}

// Zones of a room: a living room that is named after a kitchen too, or is joined to a kitchen by an open passage, gets a second zone.
export function roomZones(room, model) {
  const type = roomType(room, model);
  const zones = [type];
  const n = normalizeName(room?.name);
  if (type === 'living') {
    const lv = model ? levelOf(model, room) : null;
    let kitchenZone = KITCHEN_WORD.test(n);
    if (!kitchenZone && lv) {
      const mine = facts(lv, room).open.passages;
      for (const other of lv.rooms) {
        if (other === room || other.polygon?.length < 3) continue;
        if (roomTypeFromName(other.name) !== 'kitchen' && roomTypeFromUse(other.use) !== 'kitchen') continue;
        const theirs = facts(lv, other).open.passages;
        if (mine.some((p) => theirs.includes(p))) kitchenZone = false; // a separate kitchen room keeps its own recipe
      }
    }
    if (kitchenZone) zones.push('kitchen');
    if (/\b(jadaln\w*|dining)\b/.test(n)) zones.push('dining');
  }
  return zones;
}
