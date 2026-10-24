// Contact sheet of code-built furniture pieces. Hash options: types=a,b,c (default: all implemented), cols, cell (m), q (quality),
// look (clay or textured), az, el, fov, frames; see tools/sheet-studio.js for the page contract. Build with tools/pieces-sheet.mjs.
import { runSheet, layoutGrid } from './sheet-studio.js';
import { buildPiece, piecesImplemented, applyLook } from '../src/furniture/index.js';
import { SPEC_BY_ID } from '../src/furniture/specs.js';

runSheet(({ scene, opt }) => {
  const types = (opt.types ? opt.types.split(',') : piecesImplemented()).filter((t) => SPEC_BY_ID[t]);
  const look = opt.look ?? 'textured', quality = opt.q ?? 'high';
  const items = types.map((t, i) => {
    const object = buildPiece(t, { seed: 11 + i, quality });
    applyLook(object, look);
    const spec = SPEC_BY_ID[t];
    // wall-mounted and hanging pieces get a height so that they show next to the others
    if (spec.place.mode === 'wall-mount') object.position.y = Math.max(0.5, spec.place.elevation);
    if (spec.place.mode === 'ceiling') object.position.y = 1.4;
    return { object, label: `${t}  ${object.userData.tris} tris`, size: [spec.size[0], spec.size[1]] };
  });
  const cols = Number(opt.cols ?? Math.min(5, Math.max(1, items.length)));
  return layoutGrid(scene, items, { cols, cell: Number(opt.cell ?? 2.5) });
});
