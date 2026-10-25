// composeLayout in Node (no GL): every one of the fourteen plans is furnished by the layout engine and composed into a scene
// graph; the group holds exactly the pieces of the layout, nothing is NaN, the result is repeatable, hung pieces are hidden
// where the cutaway walls are too low for them, and lamp shades follow the time of day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { specOf } from '../../src/furniture/specs.js';
import { composeLayout, emittersOf, cutawayPieces, focusRoom, mergeByMaterial, setLampGlow, wallCutHeight, WALL_LOW, WALL_PART, NEAR_DEFAULT } from '../../src/render/compose.js';
import { generatePlan } from '../../tools/gen-plans.mjs';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }

function modelOfPlan(plan) {
  const p = JSON.parse(JSON.stringify(plan));
  for (const lv of p.levels) lv.furniture = [];
  return buildModel(modelOf(analyzePlan(p)));
}
const furnish = (model, seed = 1) => autoFurnish(model, { seed, allowedTypes: piecesImplemented() });
const countOf = (layout) => layout.levels.reduce((n, lv) => n + lv.pieces.length, 0);
const hashScene = (c) => {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ Math.round(v * 1e4), 16777619) >>> 0; };
  c.group.traverse((o) => {
    if (o.isMesh) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 7) mix(a[i]); mix(a.length); }
    else if (o.parent === c.group) { mix(o.position.x); mix(o.position.y); mix(o.position.z); mix(o.rotation.y); }
  });
  for (const e of c.emitters) for (const v of e.pos) mix(v);
  return h;
};
const finiteScene = (c) => {
  let ok = true;
  c.group.updateMatrixWorld(true);
  c.group.traverse((o) => { if (!o.matrixWorld.elements.every(Number.isFinite)) ok = false; });
  for (const e of c.emitters) if (!e.pos.every(Number.isFinite) || !Number.isFinite(e.power)) ok = false;
  return ok;
};

for (const [name, plan] of plans) {
  test(`plan ${name}: layout composes into one group per piece, finite and repeatable`, () => {
    const model = modelOfPlan(plan);
    const layout = furnish(model);
    const a = composeLayout({ model, layout, quality: 'low', look: 'clay', seed: 1 });
    assert.equal(a.group.children.length, countOf(layout), 'one group per layout piece');
    assert.equal(a.pieces.size, countOf(layout));
    assert.ok(finiteScene(a), 'no NaN');
    for (const lv of layout.levels) {
      const elevation = model.levels.find((l) => l.id === lv.id).elevation;
      for (const p of lv.pieces) {
        const g = a.pieces.get(p.id);
        assert.ok(g, `piece ${p.id} present`);
        assert.equal(g.userData.levelId, lv.id);
        assert.equal(g.userData.pieceId, p.id);
        assert.ok(Math.abs(g.position.y - (elevation + (p.elev ?? 0))) < 1e-9, 'standing on its level');
        assert.ok(Math.abs(g.rotation.y + (p.rot * Math.PI) / 180) < 1e-9, 'rotation follows the plan angle');
      }
    }
    const b = composeLayout({ model, layout: furnish(model), quality: 'low', look: 'clay', seed: 1 });
    assert.equal(hashScene(a), hashScene(b), 'same layout, same scene');
  });
}

test('the compose seed leaves the positions of the pieces alone', () => {
  const model = modelOfPlan(plans[0][1]), layout = furnish(model);
  const a = composeLayout({ model, layout, quality: 'low', look: 'clay', seed: 1 }), b = composeLayout({ model, layout, quality: 'low', look: 'clay', seed: 2 });
  assert.equal(a.group.children.length, b.group.children.length);
  assert.deepEqual(a.group.children.map((g) => [g.position.x, g.position.z]), b.group.children.map((g) => [g.position.x, g.position.z]));
});

test('textured look builds with the document stub and keeps the piece count', () => {
  const model = modelOfPlan(plans[0][1]), layout = furnish(model);
  const c = composeLayout({ model, layout, quality: 'medium', look: 'textured' });
  assert.equal(c.group.children.length, countOf(layout));
  assert.ok(finiteScene(c));
});

test('lamps give world-space emitters at the right level, and hidden pieces give none', () => {
  const model = modelOfPlan(plans[1][1]), layout = furnish(model);
  const c = composeLayout({ model, layout, quality: 'low', look: 'clay' });
  const lamps = [...c.pieces.values()].filter((g) => g.userData.emitters?.length);
  assert.ok(lamps.length > 0, 'the duplex has lamps');
  assert.equal(c.emitters.length, lamps.reduce((n, g) => n + g.userData.emitters.length, 0));
  const g = lamps[0], e = g.userData.emitters[0], lv = model.levels.find((l) => l.id === g.userData.levelId);
  const world = new THREE.Vector3(...e.pos).applyMatrix4(g.matrixWorld);
  assert.ok(Math.abs(world.y - (lv.elevation + g.userData.elev + e.pos[1])) < 1e-6);
  g.visible = false;
  assert.equal(emittersOf(c.pieces).length, c.emitters.length - g.userData.emitters.length);
});

test('cutaway: hung pieces whose lower edge is above the wall behind them are hidden, the rest stay', () => {
  const ext = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 };
  assert.equal(wallCutHeight(5, 0.1, ext), Infinity, 'north edge stays tall');
  assert.equal(wallCutHeight(0.1, 4, ext), Infinity, 'west edge stays tall');
  assert.equal(wallCutHeight(5, 7.9, ext), WALL_LOW, 'south edge is low');
  assert.equal(wallCutHeight(9.9, 4, ext), WALL_LOW, 'east edge is low');
  assert.equal(wallCutHeight(5, 4, ext), WALL_PART, 'partitions are half height');
  const model = modelOfPlan(plans[0][1]), layout = furnish(model), mext = modelExtent(model);
  const c = composeLayout({ model, layout, quality: 'low', look: 'clay' });
  const before = c.emitters.length;
  const hidden = cutawayPieces(c.pieces, mext);
  assert.equal([...c.pieces.values()].filter((g) => !g.visible).length, hidden);
  for (const g of c.pieces.values()) if (!g.visible) assert.ok(['wall-mount', 'window'].includes(specOf(g.userData.pieceType).place.mode) || g.userData.size[2] >= 1.2, 'only hung or tall pieces are hidden');
  assert.ok(emittersOf(c.pieces).length <= before);
  assert.equal(cutawayPieces(c.pieces, mext), hidden, 'repeatable');
});

test('setLampGlow scales the shade materials from their base value and never compounds', () => {
  const model = modelOfPlan(plans[0][1]), layout = furnish(model);
  const c = composeLayout({ model, layout, quality: 'low', look: 'clay' });
  const shades = [];
  c.group.traverse((o) => { if (o.isMesh && o.userData.slot === 'shade') shades.push(o.material); });
  assert.ok(shades.length > 0, 'the flat has lamp shades');
  setLampGlow(c.group, 0);
  const dim = shades.map((m) => m.emissiveIntensity);
  setLampGlow(c.group, 1);
  const lit = shades.map((m) => m.emissiveIntensity);
  setLampGlow(c.group, 0);
  shades.forEach((m, i) => { assert.ok(lit[i] > dim[i]); assert.ok(Math.abs(m.emissiveIntensity - dim[i]) < 1e-9, 'back to the dim value'); });
});

test('cutaway by hand: a wardrobe that turns its back to the viewer or to a low wall and a picture on a low wall go, the same pieces on tall walls stay', () => {
  const ext = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 };
  const model = { levels: [{ id: 'L0', elevation: 0 }] };
  const piece = (id, type, x, y, rot, size, elev = 0) => ({ id, type, room: 'r', x, y, rot, size, elev, on: null, colors: {} });
  const layout = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [
    piece('wardrobe-east', 'wardrobe', 9.7, 4, 90, [1.8, 0.6, 2.2]),
    piece('wardrobe-west', 'wardrobe', 0.4, 4, 270, [1.8, 0.6, 2.2]),
    piece('picture-south', 'art-small', 5, 7.9, 180, [0.5, 0.03, 0.7], 1.1),
    piece('picture-north', 'art-small', 5, 0.1, 0, [0.5, 0.03, 0.7], 1.1),
    piece('lamp-east', 'floor-lamp', 9.7, 2, 0, [0.35, 0.35, 1.6]),
    piece('wardrobe-partition-away', 'wardrobe', 5, 4, 180, [1.8, 0.6, 2.2]),
    piece('wardrobe-partition-toward', 'wardrobe', 5, 5, 0, [1.8, 0.6, 2.2]),
  ] }] };
  const c = composeLayout({ model, layout, quality: 'low', look: 'clay' });
  assert.equal(cutawayPieces(c.pieces, ext), 3);
  const shown = (id) => c.pieces.get(id).visible;
  assert.deepEqual(['wardrobe-east', 'wardrobe-west', 'picture-south', 'picture-north', 'lamp-east', 'wardrobe-partition-away', 'wardrobe-partition-toward'].map(shown), [false, true, false, true, true, false, true]);
  assert.equal(emittersOf(c.pieces).length, 1, 'the floor lamp keeps its light');
});

test('mergeByMaterial keeps every triangle and the same outline with far fewer meshes', () => {
  const model = modelOfPlan(plans[1][1]), layout = furnish(model);
  const c = composeLayout({ model, layout, quality: 'medium', look: 'clay' });
  cutawayPieces(c.pieces, modelExtent(model));
  const stats = (roots) => {
    let tris = 0, meshes = 0; const box = new THREE.Box3();
    for (const root of roots) { root.updateMatrixWorld(true); root.traverse((o) => { if (!o.isMesh || o.name === 'contact-shadows') return; meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; box.union(new THREE.Box3().setFromObject(o)); }); }
    return { tris, meshes, box };
  };
  const before = stats([...c.pieces.values()].filter((g) => g.visible)), merged = mergeByMaterial(c), after = stats([merged.group]);
  assert.equal(after.tris, before.tris, 'no triangle lost');
  assert.ok(after.meshes < before.meshes / 2, `${after.meshes} merged meshes from ${before.meshes}`);
  const contact = merged.group.getObjectByName('contact-shadows');
  assert.ok(contact, 'the standing pieces share one soft footprint mesh');
  assert.equal(merged.meshes, after.meshes + 1, 'the footprints are one extra draw call');
  for (const k of ['x', 'y', 'z']) { assert.ok(Math.abs(after.box.min[k] - before.box.min[k]) < 1e-5 && Math.abs(after.box.max[k] - before.box.max[k]) < 1e-5, `outline ${k}`); }
  assert.equal(c.pieces.size, countOf(layout), 'the per-piece map is untouched');
});

test('focusRoom picks the room with the most pieces and stays inside the plan', () => {
  for (const [name, plan] of plans.slice(0, 6)) {
    const model = modelOfPlan(plan), layout = furnish(model), f = focusRoom(model, layout), ext = modelExtent(model);
    assert.ok(f, `${name}: a focus room`);
    assert.ok(f.cx > ext.minX && f.cx < ext.maxX && f.cz > ext.minZ && f.cz < ext.maxZ && f.r > 0.5, `${name}: inside the model`);
    const counts = new Map();
    for (const lv of layout.levels) for (const p of lv.pieces) counts.set(`${lv.id}|${p.room}`, (counts.get(`${lv.id}|${p.room}`) ?? 0) + 1);
    assert.ok(Math.max(...counts.values()) >= 3, `${name}: furnished rooms`);
  }
  assert.equal(focusRoom({ levels: [] }, { levels: [] }), null);
});

test('cutaway for another side: the default near set changes nothing, the opposite set hides pieces on the other walls', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const model = modelOfPlan(example(name)), layout = furnish(model), mext = modelExtent(model);
    const c = composeLayout({ model, layout, quality: 'low', look: 'clay' });
    const hiddenIds = (view, near) => { cutawayPieces(c.pieces, mext, view, near); return [...c.pieces].filter(([, g]) => !g.visible).map(([id]) => id).sort(); };
    const main = hiddenIds(undefined, undefined);
    assert.deepEqual(hiddenIds([0.5, 0.7], NEAR_DEFAULT), main, `${name}: the default set is the main view`);
    const north = hiddenIds([-0.5, -0.7], { north: true, west: true });
    assert.ok(main.length > 0 && north.length > 0, `${name}: pieces are hidden in both views`);
    assert.notDeepEqual(north, main, `${name}: another side hides other pieces`);
    for (const id of north) { const g = c.pieces.get(id), spec = specOf(g.userData.pieceType); assert.ok(['wall-mount', 'window', 'floor', 'corner'].includes(spec.place.mode), id); }
    assert.deepEqual(hiddenIds(undefined, undefined), main, `${name}: going back gives the first answer again`);
  }
});
