// Furniture catalogue for an editor: pure data and functions, no three.js. It reads src/furniture/specs.js and adds the words a
// person sees (group names, slot names, in English and Polish) plus the size helpers an editor needs.
//
//   catalog(lang)             flat list of entries, ordered by group (the order of GROUPS), tier, id
//   catalogGroups(lang)       the same entries as [{ group, label, items }] for a picker with headings
//   defaultSizeOf(type)       a copy of the default [w, d, h], or null for an unknown type
//   clampSize(type, size)     a size inside the range of the type (millimetre precision); null for an unknown type
//   isResizable(type)         true when at least one axis has a range
//   resizableAxes(type)       the axes that have a range, a subset of ['w', 'd', 'h']
//   slotLabel(type, slot, lang)  the name of a material slot for people
//
// `lang` is 'en' or 'pl' (anything starting with "pl" counts as Polish, everything else as English).
import { SPECS, GROUPS, specOf } from './specs.js';

export const LANGS = ['en', 'pl'];
const langOf = (lang) => (typeof lang === 'string' && lang.toLowerCase().startsWith('pl') ? 'pl' : 'en');

export const GROUP_LABELS = {
  living: { en: 'Living room', pl: 'Salon' },
  dining: { en: 'Dining', pl: 'Jadalnia' },
  sleep: { en: 'Bedroom', pl: 'Sypialnia' },
  work: { en: 'Workspace', pl: 'Miejsce pracy' },
  kitchen: { en: 'Kitchen', pl: 'Kuchnia' },
  bath: { en: 'Bathroom', pl: 'Łazienka' },
  hall: { en: 'Hall', pl: 'Przedpokój' },
  decor: { en: 'Decor and light', pl: 'Dekoracje i światło' },
};

// Names of material slots. A slot name that means something else on one type has an override in TYPE_SLOT_LABELS.
export const SLOT_LABELS = {
  upholstery: { en: 'Upholstery', pl: 'Tapicerka' },
  legs: { en: 'Legs', pl: 'Nogi' },
  cushions: { en: 'Cushions', pl: 'Poduszki ozdobne' },
  cushion: { en: 'Cushion', pl: 'Poduszka' },
  top: { en: 'Top', pl: 'Blat' },
  frame: { en: 'Frame', pl: 'Rama' },
  body: { en: 'Body', pl: 'Korpus' },
  screen: { en: 'Screen', pl: 'Ekran' },
  books: { en: 'Books', pl: 'Książki' },
  fabric: { en: 'Fabric', pl: 'Tkanina' },
  border: { en: 'Border', pl: 'Obszycie' },
  base: { en: 'Base', pl: 'Podstawa' },
  shade: { en: 'Shade', pl: 'Abażur' },
  pot: { en: 'Pot', pl: 'Doniczka' },
  leaves: { en: 'Leaves', pl: 'Liście' },
  canvas: { en: 'Canvas', pl: 'Obraz' },
  glass: { en: 'Glass', pl: 'Szkło' },
  mirror: { en: 'Mirror', pl: 'Lustro' },
  rod: { en: 'Rod', pl: 'Karnisz' },
  cord: { en: 'Cord', pl: 'Przewód' },
  seat: { en: 'Seat', pl: 'Siedzisko' },
  bedding: { en: 'Bedding', pl: 'Pościel' },
  pillows: { en: 'Pillows', pl: 'Poduszki' },
  throw: { en: 'Throw', pl: 'Koc' },
  handles: { en: 'Handles', pl: 'Uchwyty' },
  handle: { en: 'Handle', pl: 'Uchwyt' },
  doors: { en: 'Doors', pl: 'Drzwi' },
  door: { en: 'Door', pl: 'Drzwiczki' },
  fronts: { en: 'Fronts', pl: 'Fronty' },
  worktop: { en: 'Worktop', pl: 'Blat roboczy' },
  basin: { en: 'Basin', pl: 'Umywalka' },
  tap: { en: 'Tap', pl: 'Bateria' },
  hob: { en: 'Hob', pl: 'Płyta grzewcza' },
  ceramic: { en: 'Ceramic', pl: 'Ceramika' },
  vanity: { en: 'Vanity unit', pl: 'Szafka' },
  tray: { en: 'Shower tray', pl: 'Brodzik' },
  fittings: { en: 'Fittings', pl: 'Armatura' },
  shell: { en: 'Tub', pl: 'Wanna' },
  stems: { en: 'Stems', pl: 'Łodygi' },
  bowl: { en: 'Bowl', pl: 'Misa' },
  fruit: { en: 'Fruit', pl: 'Owoce' },
  board: { en: 'Board', pl: 'Listwa' },
  hooks: { en: 'Hooks', pl: 'Haczyki' },
};
const TYPE_SLOT_LABELS = {
  'kitchen-sink/basin': { en: 'Sink bowl', pl: 'Zlew' },
  'tv/frame': { en: 'Bezel', pl: 'Ramka' },
  'art-large/frame': { en: 'Picture frame', pl: 'Rama obrazu' },
  'art-small/frame': { en: 'Picture frame', pl: 'Rama obrazu' },
  'mirror/frame': { en: 'Mirror frame', pl: 'Rama lustra' },
  'fridge/handle': { en: 'Handle', pl: 'Uchwyt' },
};

export function slotLabel(type, slot, lang = 'en') {
  const L = langOf(lang), s = String(slot);
  const own = TYPE_SLOT_LABELS[`${type}/${s}`] ?? SLOT_LABELS[s];
  if (own) return own[L];
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]+/g, ' '); // unknown slot: its plain name
}

const AX = { w: 0, d: 1, h: 2 };
const mm = (v) => Math.round(v * 1000) / 1000;

export function defaultSizeOf(type) {
  const spec = specOf(type);
  return spec ? spec.size.slice() : null;
}

export function resizableAxes(type) {
  const spec = specOf(type);
  return spec ? Object.keys(AX).filter((ax) => spec.range[ax] && spec.range[ax][0] < spec.range[ax][1]) : [];
}
export const isResizable = (type) => resizableAxes(type).length > 0;

// Every axis with a range is rounded to the millimetre and held inside it; an axis without a range keeps the default; a value that is
// not a finite number (NaN, Infinity, a string, null, a missing entry) is replaced by the default of that axis. The input is not changed.
export function clampSize(type, size) {
  const spec = specOf(type);
  if (!spec) return null;
  const out = spec.size.slice(), src = Array.isArray(size) ? size : [];
  for (const [ax, r] of Object.entries(spec.range)) {
    const i = AX[ax], v = src[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[i] = Math.min(r[1], Math.max(r[0], mm(v)));
  }
  return out;
}

function entry(spec, L) {
  const range = {};
  for (const [ax, r] of Object.entries(spec.range)) range[ax] = [r[0], r[1]];
  return {
    id: spec.id,
    group: spec.group,
    groupLabel: GROUP_LABELS[spec.group][L],
    tier: spec.tier,
    label: spec.label[L],
    size: spec.size.slice(),
    range,
    slots: spec.slots.map((name) => ({ name, label: slotLabel(spec.id, name, L) })),
    rooms: spec.rooms.slice(),
    mode: spec.place.mode,
    elevation: spec.place.elevation ?? 0, // height of the bottom edge for wall-mounted and hanging pieces
    onTop: (spec.place.onTop ?? []).slice(), // ids of the pieces a surface piece may sit on
  };
}

const rank = (g) => GROUPS.indexOf(g);
const byOrder = (a, b) => rank(a.group) - rank(b.group) || a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// The table has a builder for every type (tests/furniture/catalog.test.mjs checks the list against piecesImplemented()).
export function catalog(lang = 'en') {
  const L = langOf(lang);
  return SPECS.slice().sort(byOrder).map((spec) => entry(spec, L));
}

export function catalogGroups(lang = 'en') {
  const L = langOf(lang), items = catalog(L), out = [];
  for (const group of GROUPS) {
    const list = items.filter((e) => e.group === group);
    if (list.length) out.push({ group, label: GROUP_LABELS[group][L], items: list });
  }
  return out;
}
