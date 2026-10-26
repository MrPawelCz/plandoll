// Drawing only some floors, in Node (no GL): a level hidden takes its walls, floors, panes and window light with it; the merged furniture and the footprints are cut to the
// stretch of the levels on show by the draw range alone (nothing is merged again, no extra mesh); the lamps are kept apart by level; the hung pieces of a hidden floor stay
// hidden whatever their wall does; and the stage lifts its base for an upper floor that stands alone, lamps and all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { createOpenShell } from '../../src/render/openshell.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { composeLayout, cutawayPieces, emittersOf, emittersByLevel, mergeByMaterial, showMergedLevels, NEAR_DEFAULT } from '../../src/render/compose.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { createStage } from '../../src/look/stage.js';
import { floorLift } from '../../src/app/floors.js';

// a canvas stand-in whose every call answers with something that can be called again (gradients, textures), as the stage draws its backdrop and base with them
const any = () => new Proxy(function stub() {}, { get: (t, k) => (k === 'width' ? 100 : k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : () => any()), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const example = (name) => { const p = JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8')); for (const lv of p.levels) lv.furniture = []; return p; };
const setup = () => {
  const model = buildModel(modelOf(analyzePlan(example('duplex-1')))), ext = modelExtent(model), layout = autoFurnish(model, { seed: 1, allowedTypes: piecesImplemented() });
  return { model, ext, layout, ps: new PlanScene(model, 'textured'), furn: composeLayout({ model, layout, quality: 'low', look: 'textured', seed: 1 }) };
};
const drawn = (o) => { let n = 0; o.updateWorldMatrix(true, false); o.traverse((m) => { if (m.isMesh && visibleChain(m)) n++; }); return n; };
const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
// triangles that the renderer would draw for the meshes of a group: the draw range cuts the index (or the vertices when there is no index)
const trianglesDrawn = (group) => {
  let n = 0;
  group.traverse((m) => {
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry, total = g.index ? g.index.count : g.attributes.position.count, r = g.drawRange;
    n += Math.max(0, Math.min(total, r.start + r.count) - r.start) / 3;
  });
  return n;
};
const onlyLevel = (c, id) => ({ group: c.group, pieces: new Map([...c.pieces].filter(([, g]) => g.userData.levelId === id)) });

test('setLevelVisible hides a level with everything on it and brings it back', () => {
  const { ps, model } = setup();
  const all = drawn(ps.group);
  ps.setLevelVisible((i) => i === 0);
  assert.equal(ps.levelGroups[0].visible, true); assert.equal(ps.levelGroups[1].visible, false);
  const ground = drawn(ps.group);
  ps.setLevelVisible((i) => i === 1);
  const upper = drawn(ps.group);
  assert.ok(ground > 20 && upper > 20 && ground + upper <= all + 2, `${ground} + ${upper} of ${all}`);
  assert.deepEqual(ps.levelOn, [false, true]);
  ps.setLevelVisible(() => true);
  assert.equal(drawn(ps.group), all, 'back to what it was'); assert.deepEqual(ps.levelOn, [true, true]);
  assert.equal(model.levels.length, 2);
});

test('the window light of a hidden level goes with it, and stays off when the walls are cut again', () => {
  const { ps, ext } = setup();
  const patch = ps.sunPatch, attr = patch.geometry.attributes.aInfo, n = patch.userData.patches;
  const on = () => { let k = 0; for (let i = 0; i < n; i++) if (attr.getW(i * 4) === 1) k++; return k; };
  applyWallCut(ps, ext, NEAR_DEFAULT);
  const before = on();
  assert.ok(before >= 4, `${before} patches lit`);
  ps.setLevelVisible((i) => i === 0);
  const ground = on();
  assert.ok(ground > 0 && ground < before, `${ground} of ${before} with the upper level hidden`);
  applyWallCut(ps, ext, NEAR_DEFAULT); // the page cuts the walls again whenever the camera turns across a side
  assert.equal(on(), ground, 'the cut does not light the panes of a hidden level');
  ps.setLevelVisible((i) => i === 1);
  const upper = on();
  assert.ok(upper > 0 && upper < before && ground + upper === before, `${ground} + ${upper} = ${before}`);
  ps.setLevelVisible(() => true);
  assert.equal(on(), before, 'all back');
});

test('the lamps are kept by level and together they are the lamps of the pieces', () => {
  const { furn } = setup();
  cutawayPieces(furn.pieces, modelExtent(buildModel(modelOf(analyzePlan(example('duplex-1'))))));
  const by = emittersByLevel(furn.pieces), all = emittersOf(furn.pieces);
  assert.deepEqual([...by.keys()], ['L0', 'L1']);
  assert.ok(by.get('L0').length > 0 && by.get('L1').length > 0, 'a lamp on each floor');
  assert.deepEqual([...by.values()].flat(), all, 'in the order of the pieces');
  assert.equal(emittersByLevel(new Map()).size, 0);
});

test('merged meshes know their levels: the draw range shows one level, then the other, then all, with no extra mesh and nothing merged again', () => {
  const { furn } = setup();
  const merged = mergeByMaterial(furn), meshes = merged.meshes;
  const total = trianglesDrawn(merged.group);
  const only = (id) => trianglesDrawn(mergeByMaterial(onlyLevel(furn, id)).group);
  const g = only('L0'), u = only('L1');
  assert.ok(g > 1000 && u > 1000, `${g} and ${u} triangles on the floors`);
  assert.equal(g + u, total, 'the two floors make the whole');
  for (const m of merged.group.children) {
    const r = m.userData.levelRanges;
    assert.ok(Array.isArray(r) && r.length >= 1, m.name);
    assert.equal(r.reduce((s, x) => s + x.count, 0), m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count, `${m.name}: the stretches cover the mesh`);
    r.forEach((x, i) => { if (i) assert.equal(x.start, r[i - 1].start + r[i - 1].count, 'one after the other'); else assert.equal(x.start, 0); });
  }
  showMergedLevels(merged.group, new Set(['L0']));
  assert.equal(trianglesDrawn(merged.group), g, 'only the ground floor');
  showMergedLevels(merged.group, new Set(['L1']));
  assert.equal(trianglesDrawn(merged.group), u, 'only the upper floor');
  showMergedLevels(merged.group, null);
  assert.equal(trianglesDrawn(merged.group), total, 'all of it again');
  assert.equal(merged.group.children.length, meshes, 'the same meshes the whole time');
  showMergedLevels(merged.group, new Set(['L9']));
  assert.equal(trianglesDrawn(merged.group), 0, 'a level that is not there leaves nothing');
  showMergedLevels(merged.group, undefined);
  assert.equal(trianglesDrawn(merged.group), total);
});

test('the footprints on the floor are one mesh and are cut to the floors on show too', () => {
  const { furn } = setup();
  const merged = mergeByMaterial(furn), contacts = merged.group.children.filter((m) => m.name === 'contact-shadows');
  assert.equal(contacts.length, 1, 'still one extra draw call for the whole house');
  const r = contacts[0].userData.levelRanges;
  assert.deepEqual(r.map((x) => x.level), ['L0', 'L1']);
  assert.equal(r[0].start, 0); assert.equal(r[1].start, r[0].count); assert.equal(r[0].count + r[1].count, contacts[0].geometry.index.count);
  showMergedLevels(merged.group, new Set(['L1']));
  assert.equal(contacts[0].geometry.drawRange.start, r[1].start); assert.equal(contacts[0].geometry.drawRange.count, r[1].count);
});

test('merging a house with one level, or pieces that name no level, is the merge it always was', () => {
  const group = new THREE.Group(), pieces = new Map(), material = new THREE.MeshStandardMaterial();
  for (const id of ['a', 'b']) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)); group.add(g); pieces.set(id, g); }
  const merged = mergeByMaterial({ group, pieces });
  assert.equal(merged.meshes, 1); assert.equal(merged.group.children[0].userData.levelRanges.length, 1);
  showMergedLevels(merged.group, new Set(['L0']));
  assert.equal(merged.group.children[0].visible, false, 'a mesh with nothing on show is not drawn');
  showMergedLevels(merged.group, null);
  assert.equal(merged.group.children[0].visible, true);
});

test('pieces of the levels in a mixed order are laid out level by level in the merged mesh', () => {
  const group = new THREE.Group(), pieces = new Map(), material = new THREE.MeshStandardMaterial();
  [['a', 'L0'], ['b', 'L1'], ['c', 'L0'], ['d', 'L1']].forEach(([id, lv], i) => {
    const g = new THREE.Group(); g.position.set(i * 2, 0, 0); g.userData.levelId = lv;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)); group.add(g); pieces.set(id, g);
  });
  const merged = mergeByMaterial({ group, pieces }), m = merged.group.children[0], r = m.userData.levelRanges;
  assert.deepEqual(r.map((x) => x.level), ['L0', 'L1']); assert.equal(r[0].count, 2 * 36); assert.equal(r[1].count, 2 * 36);
  showMergedLevels(merged.group, new Set(['L1']));
  assert.equal(trianglesDrawn(merged.group), 24);
  const xs = new Set(); const pos = m.geometry.attributes.position; for (let i = 0; i < pos.count; i++) xs.add(Math.round(pos.getX(i)));
  assert.ok(xs.has(2) && xs.has(6) && xs.has(0) && xs.has(4), 'every piece is in the mesh');
});

test('hung pieces of a hidden floor stay hidden while the shell moves, and come back with the floor', () => {
  const { model, ext, ps, furn } = setup();
  const shell = createOpenShell(ps, model);
  applyWallCut(ps, ext, {}, { height: shell.heightFor });
  const hung = shell.adopt(furn.group, furn.pieces, () => Infinity);
  assert.ok(hung.size > 0, 'pieces hang on the outer walls');
  const level = (id) => furn.pieces.get(id).userData.levelId;
  shell.setLevels([true, false]);
  for (const id of hung) if (level(id) === 'L1') assert.equal(furn.pieces.get(id).visible, false, `${id} on the hidden floor`);
  shell.pose(0.5); shell.pose(1);
  for (const id of hung) if (level(id) === 'L1') assert.equal(furn.pieces.get(id).visible, false, `${id} stays hidden with the wall open`);
  assert.ok([...hung].some((id) => level(id) === 'L0' && furn.pieces.get(id).visible), 'those of the floor on show are drawn');
  shell.setLevels(null);
  for (const id of hung) assert.equal(furn.pieces.get(id).visible, true, `${id} is back`);
  shell.release();
});

test('the stage lifts its base for an upper floor that stands alone and the lamps follow it', () => {
  const stage = createStage({ bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6.4, minY: -0.2, maxY: 5.4 }, quality: 'low' });
  const lamp = { pos: [3, 1.2, 4], color: '#ffb064', power: 1 }, lit = () => stage.rig.pool.filter((p) => p.light.visible).map((p) => p.light.position.toArray());
  stage.setEmitters([lamp]);
  assert.deepEqual(lit(), [[3, 1.2, 4]]); assert.equal(stage.group.position.y, 0); assert.equal(stage.lift(), 0);
  assert.equal(stage.setLift(2.7), 2.7);
  assert.equal(stage.group.position.y, 2.7, 'the base comes up');
  const wasHere = lit()[0], world = wasHere[1] + stage.group.position.y;
  assert.ok(Math.abs(world - 1.2) < 1e-9, `the lamp is still where the lamp is in the world: ${world}`);
  stage.setEmitters([{ ...lamp, pos: [3, 4.2, 4] }]);
  assert.ok(Math.abs(lit()[0][1] + 2.7 - 4.2) < 1e-9, 'a new list is lowered too');
  assert.equal(stage.setLift(0), 0); assert.equal(stage.group.position.y, 0);
  assert.ok(Math.abs(lit()[0][1] - 4.2) < 1e-9, 'and back');
  assert.equal(stage.setLift(NaN), 0); assert.equal(stage.setLift(-3), 0, 'a nonsense lift is none');
  assert.equal(stage.lift(), 0);
  stage.dispose();
});

test('the lift for the duplex is the height of one storey and the board comes up to it', () => {
  const { model } = setup();
  const lift = floorLift(model, [false, true]);
  const stage = createStage({ bounds: { minX: 0, maxX: 9, minZ: 0, maxZ: 6.4, minY: -0.2, maxY: 5.4 }, quality: 'low' });
  stage.setLift(lift);
  const board = stage.group.getObjectByName('board');
  const topWorld = board.position.y + board.geometry.parameters.height / 2 + stage.group.position.y;
  const slabBottom = model.levels[1].elevation - model.levels[1].slab;
  assert.ok(Math.abs(topWorld - (slabBottom - 0.004)) < 1e-6, `the board top ${topWorld} is just under the slab at ${slabBottom}`);
  stage.dispose();
});
