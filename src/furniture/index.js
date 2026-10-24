// Furniture registry: buildPiece(type, { size, colors, seed, quality }) -> THREE.Group.
// Types without a code-built builder yet fall back to a plain rounded block with the slots of the spec, so a scene never breaks.
import { specOf } from './specs.js';
import { pieceBuilder, applyLook, materialFor } from './kit.js';
import { builders as living } from './pieces/living.js';
import { builders as sleep } from './pieces/sleep.js';
import { builders as dining } from './pieces/dining.js';
import { builders as decor } from './pieces/decor.js';
import { builders as kitchen } from './pieces/kitchen.js';
import { builders as extras } from './pieces/extras.js';

const BUILDERS = { ...living, ...sleep, ...dining, ...decor, ...kitchen, ...extras };
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

export function buildPiece(type, opts = {}) {
  const spec = specOf(type);
  if (!spec) throw new Error(`unknown furniture type "${type}"`);
  const b = pieceBuilder(spec, opts);
  (BUILDERS[type] ?? fallback)(b);
  const g = b.finish();
  g.userData.builder = BUILDERS[type] ? 'code' : 'fallback';
  return g;
}

