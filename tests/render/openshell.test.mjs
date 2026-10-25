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
import { NEAR_DEFAULT, WALL_PART } from '../../src/render/compose.js';
import { generatePlan } from '../../tools/gen-plans.mjs';

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
    for (const c of ps.cuttables) if (!owned.has(c.mesh) && c.mesh.visible && c.mesh.scale.y <= WALL_PART + 1e-9) assert.ok(c.mesh.scale.y <= WALL_PART + 1e-9);
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
  assert.equal(shell.hosts('x', 0, 0), false);
});
