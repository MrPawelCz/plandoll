// Furniture builders are bounded: a size written in centimetres cannot build thousands of meshes (audit case "bookshelf [90, 30]").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPS } from '../../src/core/caps.js';
import { validatePlan } from '../../src/core/validate.js';
import { buildModel, furnitureSize } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { PIECE_MESHES, SCENE_MESHES } from '../../src/furniture/legacy.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const flat = () => JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
const sceneWith = (furniture, look = 'textured') => {
  const p = flat();
  p.levels[0].furniture = furniture;
  const r = validatePlan(p);
  assert.ok(r.normalized, 'plan should normalize');
  return new PlanScene(buildModel(r.normalized), look);
};
const meshesOf = (scene) => {
  const out = [];
  scene.group.traverse((o) => { if (o.name && o.name.startsWith('furniture:')) { let n = 0; o.traverse((c) => { if (c.isMesh) n++; }); out.push({ name: o.name, meshes: n, truncated: !!o.userData.truncated }); } });
  return out;
};

test('furnitureSize clamps every dimension to the span cap and keeps the type defaults', () => {
  assert.deepEqual(furnitureSize({ type: 'bookshelf', size: [90, 30], height: 190 }), { w: CAPS.furnitureSpan, d: CAPS.furnitureSpan, h: CAPS.furnitureSpan });
  assert.deepEqual(furnitureSize({ type: 'bookshelf' }), { w: 0.9, d: 0.3, h: 1.9 });
  assert.deepEqual(furnitureSize({ type: 'sofa', size: [2.2, 1] }), { w: 2.2, d: 1, h: 0.8 });
  for (const type of ['constructor', 'toString', '__proto__']) assert.deepEqual(furnitureSize({ type }), { w: 0.6, d: 0.6, h: 0.6 });
});

test('the audit case, a bookshelf of size [90, 30] (and height 190), builds a bounded number of meshes', () => {
  const small = meshesOf(sceneWith([{ id: 'b0', type: 'bookshelf', center: [2, 2] }]))[0];
  assert.ok(small.meshes > 20 && small.meshes < 150, `default bookshelf: ${small.meshes}`);
  const slip = meshesOf(sceneWith([{ id: 'b1', type: 'bookshelf', center: [2, 2], size: [90, 30] }]))[0];
  assert.ok(slip.meshes <= PIECE_MESHES, `[90, 30]: ${slip.meshes} meshes (was 4,365)`);
  const tall = meshesOf(sceneWith([{ id: 'b2', type: 'bookshelf', center: [2, 2], size: [90, 30], height: 190 }]))[0];
  assert.ok(tall.meshes <= PIECE_MESHES, `[90, 30] x 190: ${tall.meshes} meshes (was 357,870)`);
  assert.equal(tall.truncated, true, 'a piece that hit the limit is marked');
});

test('a whole scene of oversized pieces stays under the scene budget, in both looks', () => {
  const pieces = Array.from({ length: CAPS.furniture }, (_, i) => ({ id: `b${i}`, type: i % 2 ? 'bookshelf' : 'wardrobe', center: [2, 2], size: [90, 30], height: 190 }));
  for (const look of ['textured', 'clay']) {
    const list = meshesOf(sceneWith(pieces, look));
    assert.equal(list.length, CAPS.furniture);
    const total = list.reduce((s, x) => s + x.meshes, 0);
    assert.ok(total <= SCENE_MESHES, `${look}: ${total} meshes`);
    assert.ok(list.filter((x) => x.truncated).length > 0);
  }
});

test('the bundled examples are not truncated', () => {
  for (const f of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json']) {
    const r = validatePlan(JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')));
    const list = meshesOf(new PlanScene(buildModel(r.normalized), 'textured'));
    assert.ok(list.length > 3, f);
    assert.deepEqual(list.filter((x) => x.truncated), [], f);
  }
});
