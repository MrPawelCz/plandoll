// Colour palettes for the material slots of the furniture, for an editor that recolours a slot (see `colors` in docs/DESIGN.md).
//
//   PALETTES               the named palettes: { id, label: { en, pl }, colors: [{ hex, name: { en, pl } }] }, 8 to 12 colours each
//   paletteOf(type, slot)  the palette that suits the slot (a copy), or null for an unknown type or slot
//   defaultColorOf(type, slot, look = 'textured')
//                          '#rrggbb', the colour the slot has when `colors` does not mention it in the given look, or null
//   ROOM_PALETTES          { wall: [...], floor: [...] }, 8 to 12 entries each: { value, swatch, name: { en, pl } }
//   roomPalette(kind, lang)  the entries of one list with the name in one language (a copy), or null for an unknown kind
//
// Which palette a slot gets follows the material the builder uses for it (wood, fabric, metal ...), so a new piece needs no entry
// here. The default colour is read from a piece built by the code in ./pieces and, for the textured look, from the table of colours
// that look gives to a few materials (LOOK_COLOR in src/render/materials.js); it is never typed in a second time.
import { specOf } from './specs.js';
import { buildPiece } from './index.js';
import { LOOK_COLOR } from '../render/materials.js';

function palette(id, en, pl, list) {
  return { id, label: { en, pl }, colors: list.map(([hex, nameEn, namePl]) => ({ hex, name: { en: nameEn, pl: namePl } })) };
}

export const PALETTES = {
  fabric: palette('fabric', 'Fabric', 'Tkanina', [
    ['#d9d2c5', 'Oat', 'Owsiany'], ['#c9b8a6', 'Sand', 'Piaskowy'], ['#a89580', 'Camel', 'Karmelowy'], ['#857d72', 'Taupe', 'Szarobeżowy'],
    ['#6e7a6a', 'Moss', 'Mech'], ['#8a9a8b', 'Sage', 'Szałwiowy'], ['#a9bccb', 'Mist blue', 'Mglisty błękit'], ['#5f7a8a', 'Slate blue', 'Błękit łupkowy'],
    ['#b9735a', 'Terracotta', 'Terakota'], ['#8c4a4a', 'Brick', 'Cegła'], ['#c9a35a', 'Mustard', 'Musztarda'], ['#3f4247', 'Graphite', 'Grafit'],
  ]),
  wood: palette('wood', 'Wood', 'Drewno', [
    ['#e3cfae', 'Birch', 'Brzoza'], ['#d4b78f', 'Ash', 'Jesion'], ['#cdb08c', 'Natural oak', 'Dąb naturalny'], ['#b88e5f', 'Honey oak', 'Dąb miodowy'],
    ['#a89a88', 'Grey oak', 'Dąb szary'], ['#a05a3c', 'Cherry', 'Wiśnia'], ['#9c7048', 'Walnut', 'Orzech'], ['#7a5236', 'Dark walnut', 'Orzech ciemny'],
    ['#5e4030', 'Chestnut', 'Kasztan'], ['#3d2e26', 'Wenge', 'Wenge'],
  ]),
  painted: palette('painted', 'Painted', 'Malowane', [
    ['#f3f1ec', 'Chalk', 'Kreda'], ['#e8e3d9', 'Cream', 'Śmietanka'], ['#d8d2c8', 'Linen', 'Len'], ['#e3c9b8', 'Blush', 'Pudrowy róż'],
    ['#d9a58a', 'Peach clay', 'Brzoskwiniowa glina'], ['#b8c4b8', 'Pale sage', 'Jasna szałwia'], ['#8d9c8e', 'Eucalyptus', 'Eukaliptus'], ['#b7c7d1', 'Pale blue', 'Jasny błękit'],
    ['#5d6f7a', 'Slate', 'Łupek'], ['#3f4a52', 'Charcoal', 'Antracyt'], ['#26292d', 'Ink', 'Tusz'],
  ]),
  metal: palette('metal', 'Metal', 'Metal', [
    ['#2a2b2e', 'Black', 'Czarny'], ['#6b7077', 'Gunmetal', 'Grafitowa stal'], ['#8e949a', 'Brushed nickel', 'Nikiel szczotkowany'], ['#c4c8cc', 'Steel', 'Stal'],
    ['#d5dade', 'Chrome', 'Chrom'], ['#f1f1ee', 'Matte white', 'Biel matowa'], ['#e0d6c3', 'Champagne', 'Szampan'], ['#b99654', 'Brass', 'Mosiądz'],
    ['#b87333', 'Copper', 'Miedź'], ['#8a6a43', 'Bronze', 'Brąz'],
  ]),
  ceramic: palette('ceramic', 'Ceramic and gloss', 'Ceramika i lakier', [
    ['#f7f6f2', 'Porcelain', 'Porcelana'], ['#ece7de', 'Bone', 'Kość słoniowa'], ['#d9d4c9', 'Pebble', 'Otoczak'], ['#cdbfae', 'Sand glaze', 'Szkliwo piaskowe'],
    ['#b8c9c4', 'Celadon', 'Seladon'], ['#8aa6a3', 'Sea glaze', 'Szkliwo morskie'], ['#b86f4b', 'Terracotta', 'Terakota'], ['#a8574a', 'Rust', 'Rdza'],
    ['#6e7f90', 'Dusk blue', 'Zmierzch'], ['#44505c', 'Deep slate', 'Głęboki łupek'], ['#2f3338', 'Black glaze', 'Czarne szkliwo'],
  ]),
  foliage: palette('foliage', 'Greens', 'Zieleń', [
    ['#9bb596', 'Pale leaf', 'Jasny liść'], ['#8aa683', 'Soft green', 'Miękka zieleń'], ['#7a9a76', 'Leaf', 'Liść'], ['#78a65e', 'Spring', 'Wiosenna'],
    ['#a7b86a', 'Young shoot', 'Młody pęd'], ['#6b8f71', 'Eucalyptus', 'Eukaliptus'], ['#5f9150', 'Fern', 'Paproć'], ['#4f8043', 'Garden', 'Ogrodowa'],
    ['#7f8c5a', 'Olive', 'Oliwka'], ['#3d6b45', 'Forest', 'Leśna'], ['#2f5238', 'Deep forest', 'Głęboki las'],
  ]),
  glass: palette('glass', 'Glass and screens', 'Szkło i ekrany', [
    ['#f2f6f7', 'Clear', 'Bezbarwne'], ['#e8e2d6', 'Warm clear', 'Ciepłe'], ['#d6e3e8', 'Pale blue', 'Jasnoniebieskie'], ['#a9c6d8', 'Blue tint', 'Błękitne'],
    ['#b8cfcf', 'Green tint', 'Zielonkawe'], ['#9fb4c0', 'Grey blue', 'Szaroniebieskie'], ['#8a9ba6', 'Smoke', 'Dymne'], ['#c9bfb0', 'Bronze tint', 'Brązowawe'],
    ['#6f7a82', 'Dark smoke', 'Ciemne dymne'], ['#3a4755', 'Night blue', 'Nocny błękit'], ['#2b2f33', 'Black', 'Czarne'],
  ]),
  paper: palette('paper', 'Picture tint', 'Odcień obrazu', [
    ['#ffffff', 'As painted', 'Bez zmian'], ['#fff5e6', 'Warm white', 'Ciepła biel'], ['#f4e9d8', 'Cream', 'Śmietanka'], ['#e9dcc6', 'Parchment', 'Pergamin'],
    ['#e8d9b8', 'Light sepia', 'Jasna sepia'], ['#f0d9d0', 'Rose', 'Róż'], ['#d8e6d9', 'Sage mist', 'Szałwiowa mgła'], ['#dfe8ea', 'Cool grey', 'Chłodna szarość'],
    ['#e6e0f0', 'Lavender', 'Lawenda'], ['#c9d4dc', 'Steel mist', 'Stalowa mgła'],
  ]),
};

// Material key (as passed to `add` in the piece builders) -> palette id.
const KEY_PALETTE = {
  'f:wood': 'wood',
  'f:body': 'painted', 'f:top': 'painted', 'f:white': 'painted', 'f:dark': 'painted', 'f:fridge': 'painted',
  'f:fabric': 'fabric', 'f:cushion': 'fabric', 'f:pillow': 'fabric', 'f:blanket': 'fabric', 'f:bedding': 'fabric', 'f:linen': 'fabric',
  'f:soft': 'fabric', 'f:rug': 'fabric', 'f:rug2': 'fabric', 'k:shade': 'fabric',
  'k:brass': 'metal', 'k:black': 'metal', 'k:chrome': 'metal', 'f:steel': 'metal',
  'k:ceramic': 'ceramic', 'f:pot': 'ceramic',
  'f:leaf1': 'foliage', 'f:leaf2': 'foliage', 'f:leaf3': 'foliage',
  'f:glass': 'glass', 'k:mirror': 'glass', 'k:screen': 'glass', 'f:screen': 'glass',
};
// For slots whose material says little ('k:paper' is the plain white under books, fruit and the backing of a mirror; a picture is a
// texture of its own) and as the last guess.
const SLOT_PALETTE = { canvas: 'paper', screen: 'glass', glass: 'glass', leaves: 'foliage', stems: 'foliage', pot: 'ceramic', books: 'fabric', fruit: 'fabric' };

const area = (b) => { const x = b.max.x - b.min.x, y = b.max.y - b.min.y, z = b.max.z - b.min.z; return 2 * (x * y + y * z + x * z); };

// Builds the piece once (default size, low quality, clay look) and notes, per slot, the biggest mesh: its material key and its colour.
// A mesh with a material object of its own (the face of a picture) is the one a person looks at, so it wins over a bigger plain mesh.
const probes = new Map();
function probe(type) {
  if (probes.has(type)) return probes.get(type);
  if (!specOf(type)) return null;
  const g = buildPiece(type, { seed: 1, quality: 'low' }), out = {};
  g.traverse((o) => {
    if (!o.isMesh) return;
    const slot = o.userData.slot, a = area(o.geometry.boundingBox) * (o.userData.look ? 1 : 1000);
    if (out[slot] && out[slot].area >= a) return;
    const base = o.material.color.clone(), c = base.clone(), col = o.geometry.attributes.color;
    let vc = null;
    if (col) { // vertex colours multiply the material colour: the average of both is the colour the slot has on the whole
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < col.count; i++) { r += col.getX(i); gg += col.getY(i); b += col.getZ(i); }
      const n = Math.max(1, col.count);
      vc = [r / n, gg / n, b / n];
      c.setRGB(c.r * vc[0], c.g * vc[1], c.b * vc[2]);
    }
    out[slot] = { area: a, key: o.userData.look?.mat ?? null, base, vc, hex: `#${c.getHexString()}` };
  });
  g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  probes.set(type, out);
  return out;
}

const hasSlot = (type, slot) => !!specOf(type)?.slots.includes(slot);
const copy = (p) => ({ id: p.id, label: { ...p.label }, colors: p.colors.map((c) => ({ hex: c.hex, name: { ...c.name } })) });

export function paletteOf(type, slot) {
  if (!hasSlot(type, slot)) return null;
  const key = probe(type)?.[slot]?.key;
  return copy(PALETTES[KEY_PALETTE[key] ?? SLOT_PALETTE[slot] ?? 'painted']);
}

// The clay look keeps the flat colour of the builder; any other look uses the colour the textured look gives the material (when the
// table has one), multiplied with the average vertex colour of the slot like the flat colour is.
export function defaultColorOf(type, slot, look = 'textured') {
  if (!hasSlot(type, slot)) return null;
  const p = probe(type)?.[slot];
  if (!p) return null;
  const own = look === 'clay' ? undefined : LOOK_COLOR[p.key];
  if (!own) return p.hex;
  const c = p.base.clone().set(own);
  if (p.vc) c.setRGB(c.r * p.vc[0], c.g * p.vc[1], c.b * p.vc[2]);
  return `#${c.getHexString()}`;
}

// Walls and floors of a room. `value` is what a layout stores ('#rrggbb', or a key of the material library as 'lib:<key>'),
// `swatch` is the colour to draw in a picker. The scene applies a value to the room; nothing here touches three.js.
function swatches(list) {
  return list.map(([value, en, pl, swatch]) => ({ value, swatch: swatch ?? value, name: { en, pl } }));
}
export const ROOM_PALETTES = {
  wall: swatches([
    ['#f4f0e8', 'Chalk white', 'Kredowa biel'], ['#ece4d4', 'Warm linen', 'Ciepły len'], ['#e3d3b8', 'Dune', 'Wydma'], ['#dcc2ad', 'Clay blush', 'Glinkowy róż'],
    ['#cf9f82', 'Baked clay', 'Wypalona glina'], ['#c3cfc0', 'Sage mist', 'Szałwiowa mgiełka'], ['#a9bdb3', 'Eucalyptus', 'Eukaliptus'], ['#b9c9d6', 'Morning blue', 'Poranny błękit'],
    ['#d7d4ce', 'Pebble', 'Otoczak'], ['#7f8b72', 'Olive grove', 'Gaj oliwny'], ['#5b6670', 'Slate', 'Łupek'], ['#3f464d', 'Night slate', 'Nocny łupek'],
  ]),
  floor: swatches([
    ['#dcc59f', 'Pale oak', 'Dąb jasny'], ['#c7a67a', 'Natural oak', 'Dąb naturalny'], ['#a9825a', 'Warm oak', 'Dąb ciepły'], ['#8a6446', 'Walnut', 'Orzech'],
    ['#5e4636', 'Smoked oak', 'Dąb wędzony'], ['#d9d3c7', 'Pale stone', 'Jasny kamień'], ['#a2a29e', 'Concrete', 'Beton'], ['#ebe7de', 'White tile', 'Biała płytka'],
    ['#76878a', 'Slate tile', 'Płytka łupkowa'], ['#bba892', 'Oat carpet', 'Wykładzina owsiana'], ['#8b8f93', 'Grey carpet', 'Wykładzina szara'],
  ]),
};

export function roomPalette(kind, lang = 'en') {
  const list = Object.hasOwn(ROOM_PALETTES, kind) ? ROOM_PALETTES[kind] : null;
  if (!list) return null;
  const L = typeof lang === 'string' && lang.toLowerCase().startsWith('pl') ? 'pl' : 'en';
  return list.map((e) => ({ value: e.value, swatch: e.swatch, name: e.name[L] }));
}
