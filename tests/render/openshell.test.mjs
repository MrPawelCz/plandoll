// The open shell in a real scene graph (no GL): the hinge groups find their walls and openings, a closed shell is today's scene, an open one lays the outer
// walls flat with their windows and doors, and the cutaway lifts the walls that fall to full height. The label canvases need a document stub, as in scene.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { createOpenShell } from '../../src/render/openshell.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { NEAR_DEFAULT, WALL_PART, composeLayout, wallCutHeight } from '../../src/render/compose.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { specOf } from '../../src/furniture/specs.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { pickPiece, slidePoint } from '../../src/app/pick.js';
import { innerFace } from '../../src/model/foldwalls.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (const seed of [401, 405, 409, 412]) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }
const build = (plan) => { const model = buildModel(modelOf(analyzePlan(plan))); return { model, ext: modelExtent(model), ps: new PlanScene(model, 'textured') }; };
const near = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
const box = (o) => new THREE.Box3().setFromObject(o);
const groupsOf = (ps, model, f) => {
  const lg = ps.levelGroups[f.level], out = [lg.children.find((c) => c.name === `wall:${f.id}`)];
  for (const o of model.levels[f.level].openings) if (o.wallId === f.id) out.push(lg.children.find((c) => c.name === `opening:${o.id}`));
  return out;
};

test('every outer wall and its openings get a hinge group; the rest of the scene is left alone', () => {
  for (const [name, plan] of plans) {
    const { model, ps } = build(plan), shell = createOpenShell(ps, model);
    assert.ok(shell.walls.length >= 3, name);
    const hinged = new Set();
    for (const f of shell.walls) {
      const gs = groupsOf(ps, model, f);
      assert.ok(gs.length >= 1 && gs.every(Boolean), `${name} ${f.id} has its groups`);
      for (const g of gs) { assert.equal(g.matrixAutoUpdate, false, `${name} ${f.id} ${g.name}`); hinged.add(g); }
    }
    let others = 0;
    ps.group.traverse((o) => { if (o.isGroup && !hinged.has(o)) { assert.equal(o.matrixAutoUpdate, true, `${name} ${o.name}`); others++; } });
    assert.ok(others > 5, `${name}: ${others} other groups untouched`);
    const interior = model.levels.flatMap((lv, li) => lv.walls.filter((w) => w.kind !== 'exterior').map((w) => ps.levelGroups[li].children.find((c) => c.name === `wall:${w.id}`)));
    assert.ok(interior.length > 0 && interior.every((g) => g.matrixAutoUpdate === true), `${name} partitions are not hinged`);
  }
});

test('a closed shell is the scene of today: the same boxes at the same places, and the same cut as without the shell', () => {
  for (const [name, plan] of plans) {
    const A = build(plan), B = build(plan), shell = createOpenShell(B.ps, B.model);
    const before = box(B.ps.group);
    shell.pose(0); B.ps.group.updateMatrixWorld(true);
    assert.ok(box(B.ps.group).equals(before), `${name} unmoved at clock 0`);
    applyWallCut(A.ps, A.ext, NEAR_DEFAULT); applyWallCut(B.ps, B.ext, NEAR_DEFAULT, { height: shell.heightFor });
    assert.equal(B.ps.cuttables.length, A.ps.cuttables.length);
    A.ps.cuttables.forEach((c, i) => {
      const d = B.ps.cuttables[i];
      assert.equal(d.mesh.visible, c.mesh.visible, `${name} #${i} visible`); near(d.mesh.scale.y, c.mesh.scale.y, 1e-12, `${name} #${i} height`); assert.equal(d.mesh.castShadow, c.mesh.castShadow, `${name} #${i} shadow`);
    });
    assert.equal(shell.active, false);
  }
});

test('an open shell lays every outer wall flat with its windows and doors, inner face up, outside the plan', () => {
  for (const [name, plan] of plans) {
    const { model, ps } = build(plan), shell = createOpenShell(ps, model);
    shell.pose(1); ps.group.updateMatrixWorld(true);
    assert.equal(shell.active, true);
    for (const f of shell.walls) {
      const lvY = ps.levelGroups[f.level].position.y;
      for (const g of groupsOf(ps, model, f)) g.traverse((o) => {
        if (!o.isMesh || /\/(leaf|handle)$/.test(o.name)) return; // a door leaf stands out of the wall plane; the rest of a wall is a flat slab or a thin frame
        const b = box(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
        assert.ok(size.y <= f.thickness + 0.1, `${name} ${o.name} is flat (${size.y.toFixed(3)} m high)`);
        assert.ok(b.min.y >= lvY + f.y - 0.05, `${name} ${o.name} lies on the foot height (a sill ledge sticks out 4 cm past the outer face)`);
        const outward = (c.x - f.pivot[0]) * f.out[0] + (c.z - f.pivot[1]) * f.out[1];
        assert.ok(outward > -0.05, `${name} ${o.name} lies outside the wall line (${outward.toFixed(3)})`);
        assert.ok(outward < f.reach + 0.1, `${name} ${o.name} does not reach past the folded wall`);
      });
    }
    // an inner face points up: the wall box of the widest solid piece has its +/- local normal; check through the matrix of its group
    const f = shell.walls[0], wg = groupsOf(ps, model, f)[0], up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(wg.matrixWorld));
    near(up.x * f.out[0] + up.z * f.out[1], 1, 1e-9, `${name} the old top now points outward`);
    shell.pose(0); ps.group.updateMatrixWorld(true);
    for (const g of groupsOf(ps, model, f)) near(g.matrix.determinant(), 1, 1e-12);
    assert.equal(shell.active, false);
  }
});

test('the walls follow the clock one after another: the first in the order is further along than the last, and all are flat at the end', () => {
  const { model, ps } = build(plans[0][1]), shell = createOpenShell(ps, model);
  shell.setOrder([0.5, 0.7]);
  shell.pose(0.12);
  const early = shell.state().map((s) => s.deg);
  assert.ok(Math.max(...early) > 5, 'one wall has started');
  assert.ok(Math.min(...early) < Math.max(...early), 'not all walls are at the same angle');
  shell.pose(1);
  shell.state().forEach((s) => near(s.deg, 90, 1e-9));
  shell.pose(0.4); const a = shell.state(); shell.pose(0.4); assert.deepEqual(shell.state(), a, 'the same clock gives the same walls');
  shell.pose(0.4); const g1 = groupsOf(ps, model, shell.walls[0])[0].matrix.toArray(); shell.pose(1); shell.pose(0.4);
  assert.deepEqual(groupsOf(ps, model, shell.walls[0])[0].matrix.toArray(), g1, 'a way back through 0.4 gives the matrix of the way there');
  shell.pose(-5); assert.equal(shell.clock, 0); shell.pose(9); assert.equal(shell.clock, 1); shell.pose(NaN); assert.equal(shell.clock, 0);
});

test('the cutaway lifts the walls that fall to full height as they start to turn, and leaves partitions and the rest alone', () => {
  for (const [name, plan] of plans) {
    const { model, ext, ps } = build(plan), shell = createOpenShell(ps, model);
    applyWallCut(ps, ext, NEAR_DEFAULT, { height: shell.heightFor });
    const low = ps.cuttables.map((c) => (c.mesh.visible ? c.mesh.scale.y : 0));
    shell.pose(1); applyWallCut(ps, ext, NEAR_DEFAULT, { height: shell.heightFor });
    const owned = new Set();
    for (const f of shell.walls) for (const g of groupsOf(ps, model, f)) g.traverse((o) => owned.add(o));
    let lifted = 0;
    ps.cuttables.forEach((c, i) => {
      if (owned.has(c.mesh)) {
        assert.equal(c.mesh.visible, true, `${name} #${i} shows`); near(c.mesh.scale.y, Math.max(1e-4, c.y1 - c.y0), 1e-9, `${name} #${i} full height`);
        if (c.mesh.scale.y > low[i] + 0.01) lifted++;
      } else near(c.mesh.visible ? c.mesh.scale.y : 0, low[i], 1e-12, `${name} #${i} outside the shell is unchanged`);
    });
    assert.ok(lifted > 0, `${name}: some low walls were lifted`);
    shell.pose(0.5); applyWallCut(ps, ext, NEAR_DEFAULT, { height: shell.heightFor });
    ps.cuttables.forEach((c, i) => { if (!owned.has(c.mesh)) near(c.mesh.visible ? c.mesh.scale.y : 0, low[i], 1e-12, `${name} #${i} outside the shell is unchanged half way`); });
    assert.equal(shell.heightFor({}, 1.5), 1.5, 'a box that no wall owns keeps its height');
    assert.equal(shell.heightFor(ps.cuttables.find((c) => owned.has(c.mesh)), Infinity), Infinity);
  }
});

test('the window light goes with the wall and comes back when the shell is closed', () => {
  const { model, ext, ps } = build(plans[0][1]), shell = createOpenShell(ps, model);
  if (!ps.sunPatch) return; // a plan without patches has nothing to switch
  const on = () => { const a = ps.sunPatch.geometry.attributes.aInfo; let n = 0; for (let i = 0; i < a.count; i += 4) if (a.getW(i) === 1) n++; return n; };
  applyWallCut(ps, ext, { north: true, west: true }, { height: shell.heightFor }); // north and west cut low: windows there are cut, the others lit
  const lit = on();
  shell.pose(1); applyWallCut(ps, ext, NEAR_DEFAULT, { height: shell.heightFor }); shell.hidePatches();
  assert.equal(on(), 0, 'no window light while the shell is open');
  shell.pose(0); applyWallCut(ps, ext, { north: true, west: true }, { height: shell.heightFor }); shell.hidePatches();
  assert.equal(on(), lit, 'the same light as before when it is closed again');
});

test('dispose gives the groups their own matrices back', () => {
  const { model, ps } = build(plans[0][1]), shell = createOpenShell(ps, model);
  shell.pose(1); shell.dispose(); ps.group.updateMatrixWorld(true);
  for (const f of shell.walls) for (const g of groupsOf(ps, model, f)) { assert.equal(g.matrixAutoUpdate, true); near(g.matrix.determinant(), 1, 1e-12); assert.deepEqual(g.matrix.toArray(), new THREE.Matrix4().toArray()); }
});

test('a model without outer walls makes a shell that does nothing', () => {
  const { model, ext, ps } = build(plans[0][1]);
  for (const lv of model.levels) for (const w of lv.walls) w.kind = 'interior';
  const shell = createOpenShell(ps, model);
  assert.equal(shell.walls.length, 0);
  shell.pose(1); shell.setOrder([0, 1]); shell.hidePatches(); applyWallCut(ps, ext, NEAR_DEFAULT, { height: shell.heightFor });
  assert.equal(shell.adopt(new THREE.Group(), new Map(), () => Infinity).size, 0, 'nothing to adopt');
});

// the pieces hung on the outer walls (pictures, mirrors, curtains) turn with them
const furnished = (plan) => {
  const built = build(plan), layout = autoFurnish(built.model, { seed: 1, allowedTypes: piecesImplemented() });
  const furn = composeLayout({ model: built.model, layout, quality: 'low', look: 'textured', seed: 1 });
  return { ...built, layout, furn, shell: createOpenShell(built.ps, built.model) };
};
const isHung = (g) => ['wall-mount', 'window'].includes(specOf(g.userData.pieceType)?.place?.mode);

test('adopt moves the pieces hung on outer walls into hinge groups, release puts them back, and nothing else moves', () => {
  let adopted = 0;
  for (const [name, plan] of plans) {
    const { ext, ps, furn, shell } = furnished(plan);
    const closed = (x, z) => wallCutHeight(x, z, ext, 0.3, NEAR_DEFAULT);
    const before = new Map([...furn.pieces].map(([id, g]) => [id, g.position.toArray().join()]));
    const ids = shell.adopt(furn.group, furn.pieces, closed);
    for (const id of ids) { const g = furn.pieces.get(id); assert.ok(isHung(g), `${name} ${id} is a hung piece`); assert.equal(g.parent.name.startsWith('hung:'), true, `${name} ${id} sits in a hinge group`); assert.equal(g.parent.parent, furn.group); assert.equal(g.parent.matrixAutoUpdate, false); }
    for (const [id, g] of furn.pieces) { if (!ids.has(id)) assert.equal(g.parent, furn.group, `${name} ${id} is not adopted and stays`); assert.equal(g.position.toArray().join(), before.get(id), `${name} ${id} keeps its own position`); }
    adopted += ids.size;
    shell.pose(0); ps.group.updateMatrixWorld(true); furn.group.updateMatrixWorld(true);
    for (const id of ids) { const g = furn.pieces.get(id); const w = g.getWorldPosition(new THREE.Vector3()); near(w.x, g.position.x, 1e-9, `${name} ${id} closed: world = own x`); near(w.z, g.position.z, 1e-9); }
    shell.release();
    for (const [id, g] of furn.pieces) assert.equal(g.parent, furn.group, `${name} ${id} is back in the furnishing group`);
    assert.equal(furn.group.children.filter((c) => c.name.startsWith('hung:')).length, 0, `${name} no hinge groups left`);
  }
  assert.ok(adopted > 5, `${adopted} hung pieces were adopted over the plans`);
});

test('a hung piece lies flat on its fallen wall, and shows only once the wall has risen above its lower edge', () => {
  const { ext, ps, furn, shell } = furnished(plans[0][1]);
  const ids = shell.adopt(furn.group, furn.pieces, (x, z) => wallCutHeight(x, z, ext, 0.3, NEAR_DEFAULT));
  assert.ok(ids.size > 0);
  shell.pose(1); ps.group.updateMatrixWorld(true); furn.group.updateMatrixWorld(true);
  for (const id of ids) {
    const g = furn.pieces.get(id), b = new THREE.Box3().setFromObject(g);
    assert.equal(g.visible, true, `${id} shows when the shell is open`);
    const hang = g.userData.elev ?? 0;
    assert.ok(b.max.y < 1.2 + 0.001 * hang, `${id} lies low once folded (${b.max.y.toFixed(2)} m, it hung at ${hang.toFixed(2)} m)`);
  }
  shell.pose(0.001); // the walls have hardly started: a piece hung above the low cut of a near wall is still hidden
  const hidden = [...ids].filter((id) => !furn.pieces.get(id).visible);
  const farHigh = [...ids].filter((id) => furn.pieces.get(id).visible);
  assert.ok(hidden.length + farHigh.length === ids.size);
  assert.ok(hidden.length > 0, 'some pieces on the walls held low wait for their wall');
  shell.pose(1); for (const id of ids) assert.equal(furn.pieces.get(id).visible, true);
});

test('adopting twice does not lose or duplicate a piece', () => {
  const { ext, furn, shell } = furnished(plans[0][1]);
  const closed = (x, z) => wallCutHeight(x, z, ext, 0.3, NEAR_DEFAULT), count = () => { let n = 0; furn.group.traverse((o) => { if (o.userData?.pieceId !== undefined) n++; }); return n; };
  const n0 = count(), a = shell.adopt(furn.group, furn.pieces, closed), b = shell.adopt(furn.group, furn.pieces, closed);
  assert.deepEqual([...a].sort(), [...b].sort()); assert.equal(count(), n0);
  assert.equal(furn.group.children.filter((c) => c.name.startsWith('hung:')).length, new Set([...b].map((id) => furn.pieces.get(id).parent.name)).size);
  shell.dispose(); assert.equal(count(), n0);
});

// ---- editing with the shell open: where a hung piece is drawn, how a ray finds it there, and how it is dragged along its wall ----
const baseOf = (model) => (id) => Number(model.levels.find((l) => l.id === id)?.elevation) || 0;
const adoptAll = (f) => f.shell.adopt(f.furn.group, f.furn.pieces, (x, z) => wallCutHeight(x, z, f.ext, 0.3, NEAR_DEFAULT));
const settled = (f, clock) => { f.shell.pose(clock); f.ps.group.updateMatrixWorld(true); f.furn.group.updateMatrixWorld(true); };

test('hostMatrix and hostOf say where the wall has put a hung piece, and say nothing for the other pieces and for a released shell', () => {
  let checked = 0;
  for (const [name, plan] of plans) {
    const f = furnished(plan), ids = adoptAll(f);
    for (const clock of [0, 0.3, 1]) {
      settled(f, clock);
      for (const [id, g] of f.furn.pieces) {
        const m = f.shell.hostMatrix(id);
        if (!ids.has(id)) { assert.equal(m, null, `${name} ${id} is not hung`); assert.equal(f.shell.hostOf(id), null); continue; }
        assert.ok(Array.isArray(m) && m.length === 16 && m.every(Number.isFinite), `${name} ${id} has a matrix`);
        assert.deepEqual(m, g.parent.matrix.toArray(), `${name} ${id} the matrix is the one of its hinge group`);
        const want = g.position.clone().applyMatrix4(new THREE.Matrix4().fromArray(m)), got = g.getWorldPosition(new THREE.Vector3());
        near(got.x, want.x, 1e-9, `${name} ${id} x`); near(got.y, want.y, 1e-9, `${name} ${id} y`); near(got.z, want.z, 1e-9, `${name} ${id} z`);
        const h = f.shell.hostOf(id);
        assert.deepEqual(h.matrix, m); assert.equal(typeof h.wall, 'string'); assert.ok(f.shell.walls.some((w) => w.id === h.wall));
        near(Math.hypot(...h.plane.normal), 1, 1e-9, `${name} ${id} unit normal`); assert.equal(h.plane.normal[1], 0, 'a vertical plane');
        checked++;
      }
    }
    f.shell.release();
    for (const id of ids) { assert.equal(f.shell.hostMatrix(id), null, 'released'); assert.equal(f.shell.hostOf(id), null); }
    assert.equal(f.shell.hostMatrix('nope'), null); assert.equal(f.shell.hostOf(undefined), null);
  }
  assert.ok(checked > 20, `${checked} hung pieces checked`);
});

test('the inner face plane of the wall that holds a piece lies just behind the piece, in the closed place of the wall', () => {
  for (const [name, plan] of plans) {
    const f = furnished(plan), ids = adoptAll(f);
    for (const id of ids) {
      const h = f.shell.hostOf(id), g = f.furn.pieces.get(id), wall = f.shell.walls.find((w) => w.id === h.wall);
      const face = innerFace(wall), across = (g.position.x - face.point[0]) * face.normal[0] + (g.position.z - face.point[2]) * face.normal[2];
      assert.ok(across < 0.05 && across > -0.35, `${name} ${id}: the centre of the piece stands ${(-across).toFixed(3)} m inside the face of its wall`);
    }
  }
});

test('a ray at a hung piece on a fallen wall finds the piece with the matrix of its wall, and a ray at the place of the closed wall no longer finds it', () => {
  let hung = 0, found = 0, foundWithout = 0, ghostWith = 0, ghostWithout = 0;
  for (const [, plan] of plans) {
    const f = furnished(plan), ids = adoptAll(f), levelBase = baseOf(f.model);
    settled(f, 1);
    const frameOf = (id) => f.shell.hostMatrix(id);
    for (const id of ids) {
      const g = f.furn.pieces.get(id), h = g.userData.size[2];
      hung++;
      const drawn = g.localToWorld(new THREE.Vector3(0, h / 2, 0)); // the centre of the box where the wall has put it
      const above = { origin: [drawn.x, drawn.y + 5, drawn.z], direction: [0, -1, 0] };
      if (pickPiece(f.layout, above, { levelBase, pad: 0.02, frameOf })?.id === id) found++;
      if (pickPiece(f.layout, above, { levelBase, pad: 0.02 })?.id === id) foundWithout++;
      // a ray at the centre of the box in the plan, along the front of the piece: where it hung before the wall fell
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion), c = [g.position.x, g.position.y + h / 2, g.position.z];
      const closed = { origin: [c[0] + front.x * 3, c[1], c[2] + front.z * 3], direction: [-front.x, 0, -front.z] };
      if (pickPiece(f.layout, closed, { levelBase, pad: 0.02, frameOf })?.id === id) ghostWith++;
      if (pickPiece(f.layout, closed, { levelBase, pad: 0.02 })?.id === id) ghostWithout++;
    }
  }
  assert.ok(hung > 20, `${hung} hung pieces`);
  assert.ok(found >= hung * 0.9, `with the matrix ${found} of ${hung} hung pieces are found where they are drawn`);
  assert.ok(foundWithout <= hung * 0.2, `without it only ${foundWithout} of ${hung} are (picking in the closed place was the defect)`);
  assert.ok(ghostWithout >= hung * 0.5, `the closed place answered for ${ghostWithout} of ${hung} before (furniture in front of a wall blocks the rest)`);
  assert.ok(ghostWith <= hung * 0.1, `and answers for ${ghostWith} now`);
});

test('a finger that moves along a fallen wall moves the piece by the same distance along the wall, whatever the piece, the plan and the angle of the wall', () => {
  let checked = 0;
  for (const [name, plan] of plans) {
    const f = furnished(plan), ids = adoptAll(f);
    for (const clock of [1, 0.85]) {
      settled(f, clock);
      for (const id of ids) {
        const g = f.furn.pieces.get(id), host = f.shell.hostOf(id), h = g.userData.size[2], rot = (-g.rotation.y * 180) / Math.PI;
        const at = (d) => { const p = g.localToWorld(new THREE.Vector3(d, h / 2, 0)); return slidePoint({ origin: [p.x, p.y + 5, p.z], direction: [0, -1, 0] }, host, 0); };
        const a = at(0), b = at(0.5);
        if (!a || !b) continue; // a wall that has hardly started to turn is seen edge on from above
        const along = [Math.cos((rot * Math.PI) / 180) * 0.5, Math.sin((rot * Math.PI) / 180) * 0.5];
        near(b[0] - a[0], along[0], 1e-6, `${name} ${id} clock ${clock} x`); near(b[1] - a[1], along[1], 1e-6, `${name} ${id} clock ${clock} y`);
        checked++;
      }
    }
  }
  assert.ok(checked > 40, `${checked} drags checked`);
});
