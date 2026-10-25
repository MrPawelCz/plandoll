// "Open the shell" in the scene (#shell=1): every outer wall, with its windows and doors, hangs from a hinge group that turns about the foot line
// of the wall's outer face, so the wall falls outward and lies flat with its inner face up. The groups already exist (PlanScene makes one per
// wall and one per opening, both at the level's origin); here they get a matrix of their own, so the positions of the boxes inside stay as they
// were and the cutaway keeps working on them. Nothing is drawn and nothing is stored here; the page asks for a frame after every change.
import { foldWalls, hingeMatrix, hostWall } from '../model/foldwalls.js';
import { frameOf, startOrder } from './openmotion.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

// ps: a PlanScene; model: the model it was made from. Returns the shell: { walls, clock, pose(p), setOrder(view), heightFor(c, h), hosts(levelId, x, z),
// hidePatches(), state(), dispose() }.
export function createOpenShell(ps, model) {
  const walls = foldWalls(model);
  const byName = ps.levelGroups.map((lg) => { const m = new Map(); for (const c of lg.children) if (c.name) m.set(c.name, c); return m; });
  const groups = walls.map((f) => {
    const names = byName[f.level], list = [];
    const wall = names?.get(`wall:${f.id}`);
    if (wall) list.push(wall);
    for (const o of model.levels[f.level].openings ?? []) if (o.wallId === f.id) { const og = names?.get(`opening:${o.id}`); if (og) list.push(og); }
    return list;
  });
  for (const gs of groups) for (const g of gs) { g.matrixAutoUpdate = false; g.matrix.identity(); g.matrixWorldNeedsUpdate = true; }

  // which wall each cuttable box (a wall piece, a frame, a pane, a leaf) belongs to
  const meshWall = new Map();
  groups.forEach((gs, i) => gs.forEach((g) => g.traverse((o) => { if (o.isMesh) meshWall.set(o, i); })));
  const owner = new Map(), panes = [];
  let top = 0;
  for (const c of ps.cuttables) {
    const i = meshWall.get(c.mesh);
    if (i === undefined) continue;
    owner.set(c, i); top = Math.max(top, c.y1);
    if (c.mesh.pw?.pane === true) panes.push(c.mesh);
  }

  let clock = 0, rank = walls.map((_, i) => i);
  const live = walls.map(() => ({ deg: 0, grow: 0 }));

  return {
    walls,
    get clock() { return clock; },
    get active() { return clock > 0; },
    // The order the walls start in is chosen when the opening begins (view: horizontal direction from the model to the camera) and kept until it is closed.
    setOrder(view) { rank = startOrder(walls, view); },
    // Puts every wall where the clock p (0 closed, 1 open) says: the hinge matrices and the growth of the walls that were held low.
    pose(p) {
      clock = clamp01(p);
      walls.forEach((f, i) => {
        const fr = frameOf(clock, rank[i], walls.length);
        live[i].deg = fr.deg; live[i].grow = fr.grow;
        const m = hingeMatrix(f, fr.deg);
        for (const g of groups[i]) { g.matrix.fromArray(m); g.matrixWorldNeedsUpdate = true; }
      });
    },
    // For applyWallCut: the height the cutaway cuts a box of an outer wall at. The wall rises from its low cut to its full height while it starts to turn;
    // at the end of that it is not cut at all. Boxes of other walls, and walls that are not cut, keep the height they were given.
    heightFor(c, h) {
      const i = owner.get(c);
      if (i === undefined || h === Infinity) return h;
      const g = live[i].grow;
      if (!(g > 0)) return h;
      return g >= 1 ? Infinity : h + (top + 0.01 - h) * g;
    },
    // Is the point (x, z) on a level the back of a piece hung on a folding wall?
    hosts: (levelId, x, z) => hostWall(walls, levelId, x, z) >= 0,
    // The window light on the floor goes with the wall: no patches while the shell is not closed (applyWallCut switches them on again).
    hidePatches() { if (clock > 0) for (const m of panes) ps.sunPatch?.userData.show(m, false); },
    state: () => walls.map((f, i) => ({ id: f.id, level: f.levelId, deg: live[i].deg, grow: live[i].grow })),
    dispose() { for (const gs of groups) for (const g of gs) { g.matrixAutoUpdate = true; g.matrix.identity(); g.updateMatrix(); g.matrixWorldNeedsUpdate = true; } },
  };
}
