// The spelling of colours in a layout. One form everywhere a colour is stored (piece slots and room walls and floors):
//   '#rrggbb'     a flat colour, stored in lower case
//   'lib:<key>'   a material of the surface library (the keys of MATERIAL_DEFS)
//   'f:<key>'     a material of the furniture kit (pieces only, never rooms)
// A bare library key ('oak', the spelling of older files) is accepted and read as 'lib:oak'; everything that is written uses the
// full form. Pure module: no three.js, no DOM, so the editor core can use it in Node.
import { MATERIAL_DEFS } from '../render/matgen.js';

export const MATERIAL_KEYS = Object.freeze(Object.keys(MATERIAL_DEFS));
const MATERIAL_SET = new Set(MATERIAL_KEYS);

// Keys of the furniture kit materials ('f:' entries of PALETTE in src/render/materials.js, which imports three.js and so cannot be
// imported here); a test keeps this list equal to that table.
export const FURNITURE_COLOR_KEYS = Object.freeze([
  'f:body', 'f:fabric', 'f:cushion', 'f:linen', 'f:soft', 'f:dark', 'f:wood', 'f:white', 'f:steel', 'f:screen', 'f:fridge', 'f:top',
  'f:bedding', 'f:pillow', 'f:blanket', 'f:bathfloor', 'f:pot', 'f:soil', 'f:leaf1', 'f:leaf2', 'f:leaf3', 'f:rug', 'f:rug2',
  'f:book0', 'f:book1', 'f:book2', 'f:book3', 'f:book4', 'f:book5',
]);
const FURNITURE_SET = new Set(FURNITURE_COLOR_KEYS);
const HEX = /^#[0-9a-fA-F]{6}$/;

// readColor(value, kind, materialKeys) -> { value, bare } or null.
//   kind          'piece' (default; hex, lib: and f:) or 'room' (hex and lib: only)
//   materialKeys  Set or array of library keys (default: the keys of MATERIAL_DEFS)
//   value         the colour in its full form; bare is true when the input was a library key without 'lib:'
export function readColor(v, kind = 'piece', materialKeys = MATERIAL_SET) {
  if (typeof v !== 'string' || v.length > 80) return null;
  if (HEX.test(v)) return { value: v.toLowerCase(), bare: false };
  const keys = materialKeys instanceof Set ? materialKeys : new Set(materialKeys ?? []);
  if (v.startsWith('lib:')) return keys.has(v.slice(4)) ? { value: v, bare: false } : null;
  if (v.startsWith('f:')) return kind === 'piece' && FURNITURE_SET.has(v) ? { value: v, bare: false } : null;
  return keys.has(v) ? { value: `lib:${v}`, bare: true } : null;
}

// The colour of a piece slot in its full form, or null.
export const cleanColor = (v, materialKeys) => readColor(v, 'piece', materialKeys)?.value ?? null;
// The colour of a room wall or floor in its full form (no furniture materials), or null.
export const cleanRoomColor = (v, materialKeys) => readColor(v, 'room', materialKeys)?.value ?? null;
