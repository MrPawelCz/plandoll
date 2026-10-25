// "Open the shell" in the scene: every outer wall, with its windows and doors, hangs from a hinge group that turns about the foot line
// of the wall's outer face, so the wall falls outward and lies flat with its inner face up. The groups already exist (PlanScene makes one per
// wall and one per opening, both at the level's origin); here they get a matrix of their own, so the positions of the boxes inside stay as
// they were and the cutaway keeps working on them. The pieces hung on those walls (pictures, mirrors, curtains) are moved into hinge groups of
// their own that turn with the same matrix. Nothing is drawn and nothing is stored here; the page asks for a frame after every change.
import * as THREE from 'three';
import { foldWalls, hingeMatrix, hostWall, innerFace } from '../model/foldwalls.js';
import { specOf } from '../furniture/specs.js';
import { frameOf, startOrder } from './openmotion.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const HUNG = new Set(['wall-mount', 'window']);

// ps: a PlanScene; model: the model it was made from. Returns the shell: { walls, clock, active, setOrder(view), pose(p), heightFor(c, h), adopt(group, pieces, closedHeight),
// release(), hostMatrix(id), hostOf(id), hidePatches(), state(), dispose() }.
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
  let hinges = new Map(), hosted = [], hostById = new Map(), turned = new Map(); // hinge groups of the hung pieces by wall; the pieces on them: { id, g, wall, elev, window, h0 }; the same by piece id; the matrix of each hinge group by wall

  const lift = (i, h) => { const gr = live[i].grow; return h === Infinity || !(gr > 0) ? h : gr >= 1 ? Infinity : h + (top + 0.01 - h) * gr; }; // the height a wall that was cut at h stands at now
  // The matrix of a wall as the hung pieces see it: they live in world coordinates, the wall in its level, so the foot line is raised by the level's height.
  const worldMatrix = (i, deg) => hingeMatrix({ ...walls[i], y: walls[i].y + ps.levelGroups[walls[i].level].position.y }, deg);
  function moveHung() {
    turned = new Map();
    for (const [i, hg] of hinges) { const m = worldMatrix(i, live[i].deg); turned.set(i, m); hg.matrix.fromArray(m); hg.matrixWorldNeedsUpdate = true; }
    for (const e of hosted) { // a piece shows once the wall it hangs on has risen above its lower edge (the closed view cuts the near walls low)
      const wallTop = lift(e.wall, e.h0);
      e.g.visible = wallTop === Infinity || (e.elev < wallTop - 0.02 && !(e.window && wallTop < 1.5));
    }
  }

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
      moveHung();
    },
    // For applyWallCut: the height the cutaway cuts a box of an outer wall at. The wall rises from its low cut to its full height while it starts to turn;
    // at the end of that it is not cut at all. Boxes of other walls, and walls that are not cut, keep the height they were given.
    heightFor(c, h) { const i = owner.get(c); return i === undefined ? h : lift(i, h); },
    // Moves the pieces hung on the outer walls out of `group` (the furnishing, its pieces: Map id -> piece group in world coordinates) into hinge groups that turn
    // with those walls, and returns their ids. closedHeight(x, z) is the height the closed view cuts the wall at that point. Call it again after the furnishing is rebuilt.
    adopt(group, pieces, closedHeight) {
      this.release(); hinges = new Map(); hosted = [];
      for (const [id, g] of pieces) {
        const mode = specOf(g.userData.pieceType)?.place?.mode;
        if (!HUNG.has(mode)) continue;
        const back = new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion), reach = g.userData.size[1] / 2 + 0.08;
        const bx = g.position.x + back.x * reach, bz = g.position.z + back.z * reach, wi = hostWall(walls, g.userData.levelId, bx, bz);
        if (wi < 0) continue;
        let hg = hinges.get(wi);
        if (!hg) { hg = new THREE.Group(); hg.name = `hung:${walls[wi].id}`; hg.matrixAutoUpdate = false; group.add(hg); hinges.set(wi, hg); }
        hg.add(g);
        hosted.push({ id, g, wall: wi, elev: g.userData.elev ?? 0, window: mode === 'window', h0: closedHeight(bx, bz) });
      }
      hostById = new Map(hosted.map((e) => [e.id, e]));
      moveHung();
      return new Set(hosted.map((e) => e.id));
    },
    // Puts the hung pieces back into the furnishing group and drops the hinge groups.
    release() {
      for (const hg of hinges.values()) { const host = hg.parent; if (host) for (const g of [...hg.children]) host.add(g); hg.removeFromParent(); }
      hinges = new Map(); hosted = []; hostById = new Map(); turned = new Map();
    },
    // Where the piece `id` is drawn: the 4 x 4 matrix (column-major, world coordinates) that carries it from the place the plan gives it to the place its wall has
    // turned it to, or null for a piece that no wall holds (every piece while the shell is closed). The same array is returned until the walls move again.
    hostMatrix(id) { const e = hostById.get(id); return (e && turned.get(e.wall)) || null; },
    // The wall that holds the piece `id` now, for dragging it along that wall: { wall: the id of the wall, matrix: as hostMatrix, plane: the inner face of the wall in its
    // closed place ({ point, normal }, see foldwalls.js innerFace) }, or null.
    hostOf(id) {
      const e = hostById.get(id), matrix = e && turned.get(e.wall);
      return matrix ? { wall: walls[e.wall].id, matrix, plane: innerFace(walls[e.wall]) } : null;
    },
    // The window light on the floor goes with the wall: no patches while the shell is not closed (applyWallCut switches them on again).
    hidePatches() { if (clock > 0) for (const m of panes) ps.sunPatch?.userData.show(m, false); },
    state: () => walls.map((f, i) => ({ id: f.id, level: f.levelId, deg: live[i].deg, grow: live[i].grow })),
    dispose() {
      this.release();
      for (const gs of groups) for (const g of gs) { g.matrixAutoUpdate = true; g.matrix.identity(); g.updateMatrix(); g.matrixWorldNeedsUpdate = true; }
    },
  };
}
