// Which floors of a plan are on show. A plan with two or more levels gets a row of buttons: one per level and a last one for all of them. The choice is
// 'all' (the default, every level drawn) or the index of one level (0 is the lowest). Pure functions, no DOM and no three.js: tested in Node. main.js
// applies the choice (visibility of the level groups, the merged furniture, the lamps, the frame of the camera, the board under the house).
import { ALL } from './params.js';

export { ALL, parseFloorParam, floorHash } from './params.js'; // the address side of the choice lives with the other parameters

// The choice for a plan with `count` levels: a plan with fewer than two levels has nothing to choose from, and a level that does not exist is 'all'.
export function resolveFloor(sel, count) {
  if (!(count >= 2)) return ALL;
  return Number.isInteger(sel) && sel >= 0 && sel < count ? sel : ALL;
}

// Whether each of `count` levels is drawn: all of them, or only the chosen one.
export function visibleFlags(sel, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0)), pick = resolveFloor(sel, n);
  return Array.from({ length: n }, (_, i) => pick === ALL || i === pick);
}
export const visibleIndices = (sel, count) => visibleFlags(sel, count).flatMap((on, i) => (on ? [i] : []));
export const allShown = (flags) => flags.every(Boolean);

// ---------- the words on the buttons ----------
const PL_NAMES = new Map([
  ['ground floor', 'Parter'], ['upper floor', 'Piętro'], ['first floor', 'Piętro'], ['second floor', 'Drugie piętro'], ['third floor', 'Trzecie piętro'],
  ['basement', 'Piwnica'], ['attic', 'Poddasze'], ['loft', 'Poddasze'],
]);
const SHORT = 18; // characters on a button; the full name stays in the title

// The name of a level as a button shows it. English names are kept, in Polish the common general ones are translated and foreign ones are left alone.
// A level without a name of its own (the name is empty or equals the id) is called Level N / Poziom N (N counts from 1).
export function levelLabel(name, index, lang, id) {
  const raw = String(name ?? '').trim();
  if (!raw || (id !== undefined && raw === String(id))) return lang === 'pl' ? `Poziom ${index + 1}` : `Level ${index + 1}`;
  return lang === 'pl' ? (PL_NAMES.get(raw.toLowerCase()) ?? raw) : raw;
}
const shorten = (s) => (s.length > SHORT ? `${s.slice(0, SHORT - 1).trimEnd()}…` : s);

// The buttons of the row: [{ key, label, title }] with key 0, 1, ... for the levels and 'all' last, or [] when the plan has fewer than two levels.
// names: the level names of the model (or objects with name and id); the last button reads Both / Oba for two levels and All / Wszystkie for more.
export function floorChoices(names, lang) {
  const list = Array.isArray(names) ? names : [];
  if (list.length < 2) return [];
  const pl = lang === 'pl';
  const out = list.map((n, i) => {
    const full = levelLabel(typeof n === 'object' && n ? n.name : n, i, lang, typeof n === 'object' && n ? n.id : undefined);
    return { key: i, label: shorten(full), title: pl ? `Pokaż tylko: ${full}` : `Show only: ${full}` };
  });
  out.push(list.length === 2
    ? { key: ALL, label: pl ? 'Oba' : 'Both', title: pl ? 'Pokaż oba piętra naraz' : 'Show both floors at once' }
    : { key: ALL, label: pl ? 'Wszystkie' : 'All', title: pl ? 'Pokaż wszystkie piętra naraz' : 'Show all floors at once' });
  return out;
}

// ---------- geometry of the choice ----------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// The height at which the bottom of a level's slab lies.
const slabBottom = (lv) => num(lv.elevation) - num(lv.slab);

// How far the base of the house rises for the chosen floors: the bottom of the lowest slab on show above the bottom of the lowest slab of the house. With a lower
// floor on show (or all) it is 0; with only an upper floor the board comes up to stand under it, so the floor does not hang in the air.
export function floorLift(model, flags) {
  const levels = model?.levels ?? [];
  if (!levels.length || flags.length !== levels.length || allShown(flags)) return 0;
  const shown = levels.filter((_, i) => flags[i]);
  if (!shown.length) return 0;
  return Math.max(0, +(Math.min(...shown.map(slabBottom)) - Math.min(...levels.map(slabBottom))).toFixed(4));
}

// The box of the floors on show, like modelExtent: x and z from the end points of their walls (as the plan bounds are made), y from the bottom of their
// lowest slab to the top of the highest level (and of a stair that leaves its level). `floorY` is the height of the lowest floor on show, which the camera aims
// at when a single storey is framed. With every level on show the box of the whole model comes back untouched (the same object).
export function visibleExtent(model, full, flags) {
  const levels = model?.levels ?? [];
  if (!levels.length || flags.length !== levels.length || allShown(flags) || !flags.some(Boolean)) return full;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity, floorY = Infinity;
  levels.forEach((lv, i) => {
    if (!flags[i]) return;
    for (const w of lv.walls ?? []) for (const p of [w.from, w.to]) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    minY = Math.min(minY, slabBottom(lv)); maxY = Math.max(maxY, num(lv.elevation) + num(lv.height)); floorY = Math.min(floorY, num(lv.elevation));
  });
  for (const st of model.looseStairs ?? []) {
    if (!flags[st.owner]) continue;
    const lv = levels[st.owner];
    if (st.down) minY = Math.min(minY, num(lv.elevation) - num(st.delta)); else maxY = Math.max(maxY, num(lv.elevation) + num(st.delta));
  }
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return { ...full, minY, maxY, floorY };
  return { minX, maxX, minZ, maxZ, minY, maxY, floorY };
}

// Do two boxes cover the same ground (to a millimetre)? When they do, the walls need no new cut for a change of floors.
export function sameGround(a, b) {
  return !!a && !!b && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Math.abs(num(a[k]) - num(b[k])) < 1e-3);
}
