// Dynamic cutaway of the walls: the outer walls that face the camera are cut low, the others stay tall, partitions are half
// height. The page calls applyWallCut once for the first view and again whenever the set of near edges changes (not on every
// frame of a turn). Works on a PlanScene (its `cuttables`); no drawing happens here.
import { setBoxUV } from './uv.js';
import { edgeSides, wallCutHeight, WALL_PART, NEAR_DEFAULT } from './compose.js';

// Moves a wall box so it spans y0..y1 (level space) and keeps its texture frame in step.
function place(m, y0, y1) {
  m.position.y = (y0 + y1) / 2; m.scale.y = Math.max(1e-4, y1 - y0);
  const f = m.pw?.uv;
  if (f) setBoxUV(m.geometry, f.u, (y0 + y1) / 2, f.w, f.sx, y1 - y0, f.sz, f.k, f.swap);
}

// applyWallCut(ps, ext, near, { edge }) -> number of wall boxes that changed height or visibility.
//  - walls on a near edge are cut at WALL_LOW, the others on the outside stay full height, partitions are cut at WALL_PART;
//  - a long low partition does not cast a sun shadow (it would drown the rooms behind it);
//  - a full-height outer wall on the south or east edge does not cast one either: the sun stands on that side, so its shadow
//    would fall into the rooms. The walls that cast in the main view keep doing so.
// Idempotent: the same `near` gives the same result whatever the previous one was.
// `height`, when given, is called as height(cuttable, h) with the height worked out above and returns the height to cut at instead (the open
// shell lets the walls that fall rise to their full height this way); without it nothing changes.
export function applyWallCut(ps, ext, near = NEAR_DEFAULT, { edge = 0.3, height = null } = {}) {
  ps.cutH = 1.1; // textured look: the dark wall tops show while the walls are cut
  let changed = 0;
  for (const c of ps.cuttables) {
    const m = c.mesh, x = m.position.x, z = m.position.z;
    if (c.cast0 === undefined) c.cast0 = m.castShadow;
    const h0 = wallCutHeight(x, z, ext, edge, near), h = height ? height(c, h0) : h0, top = c.y0 >= h - 1e-4 ? null : Math.min(c.y1, h);
    const was = `${m.visible}|${m.scale.y.toFixed(5)}`;
    // a window pane that the cut leaves as a thin strip would glow like a light bar: it goes away with the wall above it
    const strip = m.pw?.pane === true && top !== null && top < c.y1 - 1e-4;
    if (top === null || strip) m.visible = false; else { place(m, c.y0, top); m.visible = true; }
    if (m.pw?.pane === true) ps.sunPatch?.userData.show(m, m.visible); // the light of a window goes with the window
    if (was !== `${m.visible}|${m.scale.y.toFixed(5)}`) changed++;
    const sides = edgeSides(x, z, ext, edge), sunSide = sides.length > 0 && sides.every((s) => s === 'south' || s === 'east'); // corner pieces that also touch a north or west edge keep their shadow
    const longPartition = h === WALL_PART && Math.max(m.scale.x, m.scale.z) > 3.5;
    m.castShadow = c.cast0 && !longPartition && !(h === Infinity && sunSide);
    ps._placeCap(c);
  }
  return changed;
}
