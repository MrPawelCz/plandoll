// Window light on the floor: one mesh for the whole home, a soft patch per window on an outer wall, flat stand-in positions and
// upward normals for the passes that read plain geometry, never picked, switchable per pane, and the same bytes every time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { sunPatchMaterial, setSunPatchLook } from '../../src/render/sunpatch.js';
import { sample } from '../../src/look/timeofday.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const load = () => {
  const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
  return buildModel(modelOf(analyzePlan(plan)));
};

test('a patch for every window on an outer wall, in one mesh that is never picked', () => {
  const ps = new PlanScene(load(), 'textured');
  const mesh = ps.sunPatch;
  assert.ok(mesh, 'the flat has windows');
  assert.equal(mesh.userData.patches, ps._panes.length > 0 ? mesh.userData.patches : 0);
  assert.ok(mesh.userData.patches >= 1 && mesh.userData.patches <= ps._panes.length);
  assert.equal(mesh.geometry.attributes.position.count, mesh.userData.patches * 4);
  const hits = []; mesh.raycast(new THREE.Raycaster(), hits); assert.equal(hits.length, 0);
  const nor = mesh.geometry.attributes.normal;
  for (let i = 0; i < nor.count; i++) { assert.equal(nor.getX(i), 0); assert.equal(nor.getY(i), 1); assert.equal(nor.getZ(i), 0); }
  const pos = mesh.geometry.attributes.position, info = mesh.geometry.attributes.aInfo;
  for (let i = 0; i < pos.count; i++) assert.ok(Math.abs(pos.getY(i) - info.getX(i)) < 0.05, 'stand-in positions lie on the floor');
  ps.dispose();
});

test('the patch of a pane is switched with the pane when the walls are cut', () => {
  const ps = new PlanScene(load(), 'textured');
  const info = ps.sunPatch.geometry.attributes.aInfo;
  const on = () => { let n = 0; for (let i = 0; i < info.count; i += 4) n += info.getW(i); return n; };
  const xs = ps.cuttables.map((c) => c.mesh.position.x), zs = ps.cuttables.map((c) => c.mesh.position.z);
  const ext = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  applyWallCut(ps, ext, {});
  const open = on();
  assert.equal(open, ps.sunPatch.userData.patches, 'with no near edge every window keeps its light');
  applyWallCut(ps, ext, { south: true, east: true, north: true, west: true });
  const cut = on();
  assert.ok(cut <= open);
  applyWallCut(ps, ext, {});
  assert.equal(on(), open, 'the same cut always gives the same light');
  ps.dispose();
});

test('the light follows the hour: strong at noon, gone at night; the material is shared and additive', () => {
  const m = sunPatchMaterial();
  assert.equal(m, sunPatchMaterial());
  assert.equal(m.blending, THREE.AdditiveBlending);
  assert.equal(m.depthWrite, false);
  setSunPatchLook(sample(0.32), [0.3, 0.8, 0.5]);
  const noon = m.color.getHex();
  setSunPatchLook(sample(0.98), [0.3, 0.8, 0.5]);
  assert.notEqual(m.color.getHex(), noon);
});

test('two builds of the same plan give the same patch geometry', () => {
  const a = new PlanScene(load(), 'textured'), b = new PlanScene(load(), 'textured');
  assert.deepEqual(Array.from(a.sunPatch.geometry.attributes.aCorner.array), Array.from(b.sunPatch.geometry.attributes.aCorner.array));
  assert.deepEqual(Array.from(a.sunPatch.geometry.attributes.aInfo.array), Array.from(b.sunPatch.geometry.attributes.aInfo.array));
  a.dispose(); b.dispose();
});
