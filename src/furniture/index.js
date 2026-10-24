// Furniture registry: buildPiece(type, { size, colors, seed, quality }) -> THREE.Group, and rebuildPiece(group, changes) for an editor.
// Types without a code-built builder yet fall back to a plain rounded block with the slots of the spec, so a scene never breaks.
import { specOf } from './specs.js';
import { pieceBuilder, applyLook, materialFor } from './kit.js';
import { clampSize } from './catalog.js';
import { MATERIAL_KEYS } from '../render/library.js';
import { PALETTE } from '../render/materials.js';
import { builders as living } from './pieces/living.js';
import { builders as sleep } from './pieces/sleep.js';
import { builders as dining } from './pieces/dining.js';
import { builders as decor } from './pieces/decor.js';
import { builders as kitchen } from './pieces/kitchen.js';
import { builders as bath } from './pieces/bath.js';
import { builders as extras } from './pieces/extras.js';

const BUILDERS = { ...living, ...sleep, ...dining, ...decor, ...kitchen, ...bath, ...extras };
export const HAS_BUILDER = new Set(Object.keys(BUILDERS));
export const piecesImplemented = () => [...HAS_BUILDER].filter((id) => specOf(id)).sort();
export { applyLook, materialFor };

function fallback(b) {
  const { w, d, h, spec } = b;
  const slots = spec.slots.length ? spec.slots : ['body'];
  const keys = ['f:body', 'f:wood', 'f:top', 'f:dark'];
  const hh = h / slots.length;
  slots.forEach((slot, i) => b.box(slot, keys[i % keys.length], [0, hh * (i + 0.5), 0], [w - 0.002 * i, hh, d - 0.002 * i], Math.min(0.01, hh / 3)));
}

function make(type, opts, build) {
  const spec = specOf(type);
  if (!spec) throw new Error(`unknown furniture type "${type}"`);
  const b = pieceBuilder(spec, opts);
  build(b);
  const g = b.finish();
  g.userData.builder = build === fallback ? 'fallback' : 'code';
  // What the piece was built from, so that rebuildPiece can start from it.
  g.userData.seed = b.seed;
  g.userData.quality = ['low', 'medium', 'high'][b.ql];
  g.userData.colors = Object.fromEntries(Object.entries(b.colors).filter(([, v]) => typeof v === 'string'));
  return g;
}

export const buildPiece = (type, opts = {}) => make(type, opts, BUILDERS[type] ?? fallback);
// The plain block of the spec size with every slot, for any type (used when a builder is missing or fails).
export const buildFallbackPiece = (type, opts = {}) => make(type, opts, fallback);

// ---- rebuilding a piece on request ----
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const LIB_KEYS = new Set(MATERIAL_KEYS.map((k) => `lib:${k}`));
// A slot colour is '#rrggbb', a material of the library ('lib:oak'), or one of the furniture materials of the kit ('f:wood').
export const isSlotColor = (v) => typeof v === 'string' && (HEX6.test(v) || LIB_KEYS.has(v) || (v.startsWith('f:') && Object.prototype.hasOwnProperty.call(PALETTE, v)));

// Builder-owned fields of group.userData: a rebuild replaces them and keeps every other field (pieceId, levelId, elev, ...).
const BUILT_FIELDS = ['type', 'size', 'tris', 'slots', 'emitters', 'truncated', 'builder', 'seed', 'quality', 'colors', 'lookName'];

// The slot colours after a change: `change` is merged into `current`; a slot set to null, undefined or '' goes back to its default;
// a slot that the type does not have and a value that is not a valid colour are dropped.
function mergeColors(spec, current, change) {
  const out = {};
  for (const [slot, v] of Object.entries(current ?? {})) if (spec.slots.includes(slot) && isSlotColor(v)) out[slot] = v;
  for (const [slot, v] of Object.entries(change ?? {})) {
    if (!spec.slots.includes(slot)) continue;
    if (v === null || v === undefined || v === '') delete out[slot];
    else if (isSlotColor(v)) out[slot] = HEX6.test(v) ? v.toLowerCase() : v;
  }
  return out;
}

// rebuildPiece(group, { size, colors, quality, look }) -> the new group.
//   size     [w, d, h]; an entry that is not a finite number keeps the current value; the result is held inside the range of the type
//   colors   { slot: '#rrggbb' | 'lib:key' | 'f:key' | null } merged into the colours the piece has; null brings the default back
//   quality  'low' | 'medium' | 'high' (default: as built)
//   look     'clay' | 'textured' (default: the look the piece was last dressed in with applyLook)
// The new group stands where the old one stood (position, rotation, scale, visibility, name, place among the children of its parent)
// and keeps the rest of userData (pieceId and so on); size, slots, emitters and tris describe the new piece. The old group is taken
// out of its parent and its geometries are disposed (materials are shared and stay). Children that a caller added to the old group
// are not carried over. A world-space light list built from the old group has to be built again from the new one.
export function rebuildPiece(group, changes = {}) {
  const old = group?.userData ?? {};
  const type = old.type ?? old.pieceType, spec = specOf(type);
  if (!group?.isObject3D || !spec) throw new Error('rebuildPiece: not a furniture piece');
  const asked = Array.isArray(changes.size) ? changes.size : [];
  const current = Array.isArray(old.size) ? old.size : spec.size;
  const size = clampSize(type, current.map((v, i) => (typeof asked[i] === 'number' && Number.isFinite(asked[i]) ? asked[i] : v)));
  const colors = mergeColors(spec, old.colors, changes.colors);
  const quality = changes.quality ?? old.quality;
  const look = changes.look ?? old.lookName;
  const next = buildPiece(type, { size, colors, seed: Number.isFinite(old.seed) ? old.seed : 1, quality });
  if (look) applyLook(next, look);
  const keep = { ...old };
  for (const k of BUILT_FIELDS) delete keep[k];
  Object.assign(next.userData, keep);
  next.name = group.name;
  next.visible = group.visible;
  next.renderOrder = group.renderOrder;
  next.position.copy(group.position);
  next.quaternion.copy(group.quaternion);
  next.scale.copy(group.scale);
  const parent = group.parent;
  if (parent) {
    const at = parent.children.indexOf(group);
    parent.remove(group);
    parent.add(next);
    parent.children.pop();
    parent.children.splice(at, 0, next); // same place among the siblings
    next.updateMatrixWorld(true);
  }
  group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return next;
}
