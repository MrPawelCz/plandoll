// rebuildPiece: a piece rebuilt with another size or colour stands in the same place, keeps its data, changes only what was asked for,
// and leaves no geometry behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { specOf, SPECS } from '../../src/furniture/specs.js';
import { buildPiece, rebuildPiece, applyLook, isSlotColor } from '../../src/furniture/index.js';
import { materialFor, materialCacheSize } from '../../src/furniture/kit.js';
import { clampSize } from '../../src/furniture/catalog.js';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { composeLayout, emittersOf } from '../../src/render/compose.js';

const meshes =(g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
const hashGeometry = (m) => {
  let h = 2166136261;
  const a = m.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ Math.round(a[i] * 1e5), 16777619) >>> 0;
  return h;
};
const bySlot = (g, fn) => { const out = {}; for (const m of meshes(g)) (out[m.userData.slot] ??= []).push(fn(m)); return out; };
const colorsOf = (g) => bySlot(g, (m) => m.material.color.getHexString());
const geometryOf = (g) => bySlot(g, hashGeometry);
const extent = (g) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());

function placed(type, opts = {}) {
  const parent = new THREE.Group();
  const before = new THREE.Group(), after = new THREE.Group();
  const g = buildPiece(type, { seed: 11, ...opts });
  g.position.set(3.2, 0.4, 1.4);
  g.rotation.y = -Math.PI / 2;
  g.scale.set(1, 1, 1);
  g.name = 'p7';
  g.userData.pieceId = 'p7'; g.userData.levelId = 'L0'; g.userData.elev = 0.4; g.userData.pieceType = type;
  parent.add(before, g, after);
  parent.updateMatrixWorld(true);
  return { parent, g, before, after };
}

test('the new piece stands where the old one stood and keeps its data and its place among the siblings', () => {
  const { parent, g, before, after } = placed('sofa2');
  const next = rebuildPiece(g, { size: [1.8, 0.9, 0.85], colors: { upholstery: '#445566' } });
  assert.notEqual(next, g);
  assert.deepEqual(parent.children, [before, next, after], 'same index, old one gone');
  assert.equal(g.parent, null);
  assert.deepEqual(next.position.toArray(), [3.2, 0.4, 1.4]);
  assert.ok(next.quaternion.angleTo(g.quaternion) < 1e-9);
  assert.equal(next.name, 'p7');
  assert.equal(next.userData.pieceId, 'p7');
  assert.equal(next.userData.levelId, 'L0');
  assert.equal(next.userData.elev, 0.4);
  assert.equal(next.userData.pieceType, 'sofa2');
  assert.equal(next.userData.type, 'sofa2');
  assert.deepEqual(next.userData.size, [1.8, 0.9, 0.85]);
  assert.equal(next.userData.seed, 11, 'the seed is kept');
  // the world matrix is current: the front of the sofa (+z) turned to the west, the width runs along z
  const box = new THREE.Box3().setFromObject(next), s = box.getSize(new THREE.Vector3());
  assert.ok(s.z > s.x, `the sofa is turned: ${s.x.toFixed(2)} x ${s.z.toFixed(2)}`);
  assert.ok(Math.abs((box.min.z + box.max.z) / 2 - 1.4) < 0.05);
});

test('with nothing to change the rebuilt piece is the same piece (same seed, same geometry, same colours)', () => {
  const { g } = placed('bookshelf', { colors: { body: '#778899' } });
  const geo = geometryOf(g), col = colorsOf(g);
  const next = rebuildPiece(g, {});
  assert.deepEqual(geometryOf(next), geo);
  assert.deepEqual(colorsOf(next), col);
  assert.deepEqual(next.userData.colors, { body: '#778899' });
});

test('changing the colour of one slot changes the material of that slot only', () => {
  for (const id of ['sofa2', 'bed-double', 'kitchen-sink', 'wardrobe', 'plant-large', 'mirror']) {
    const spec = specOf(id);
    for (const slot of spec.slots) {
      const { g } = placed(id);
      const geo = geometryOf(g), col = colorsOf(g);
      const next = rebuildPiece(g, { colors: { [slot]: '#12ab34' } });
      assert.deepEqual(geometryOf(next), geo, `${id}/${slot}: geometry changed`);
      const now = colorsOf(next);
      for (const other of spec.slots) {
        if (other === slot) assert.notDeepEqual(now[other], col[other], `${id}/${slot}: not recoloured`);
        else assert.deepEqual(now[other], col[other], `${id}/${slot}: slot ${other} changed`);
      }
      assert.deepEqual(next.userData.colors, { [slot]: '#12ab34' });
    }
  }
});

test('colours are merged, null brings the default back, and invalid values are dropped', () => {
  const { g } = placed('sofa2');
  const base = colorsOf(g);
  let cur = rebuildPiece(g, { colors: { upholstery: '#AA0000' } });
  cur = rebuildPiece(cur, { colors: { legs: '#00aa00' } });
  assert.deepEqual(cur.userData.colors, { upholstery: '#aa0000', legs: '#00aa00' }, 'merged, lower case');
  cur = rebuildPiece(cur, { colors: { upholstery: null } });
  assert.deepEqual(cur.userData.colors, { legs: '#00aa00' });
  assert.deepEqual(colorsOf(cur).upholstery, base.upholstery, 'the default comes back');
  cur = rebuildPiece(cur, { colors: { legs: undefined, cushions: 'red', body: '#123456', nope: '#fff000', upholstery: '#12', throw: 5, seat: {} } });
  assert.deepEqual(cur.userData.colors, {}, 'no valid entry survives: a name that is not a hex colour, an unknown slot, a short hex, a number');
  cur = rebuildPiece(cur, { colors: { legs: 'lib:oak', cushions: 'f:wood' } });
  assert.deepEqual(cur.userData.colors, { legs: 'lib:oak', cushions: 'f:wood' }, 'library and kit materials are accepted');
  assert.ok(meshes(cur).filter((m) => m.userData.slot === 'legs').every((m) => m.userData.look.mat === 'lib:oak'));
  assert.equal(isSlotColor('lib:oak'), true);
  assert.equal(isSlotColor('lib:made-up'), false);
  assert.equal(isSlotColor('f:wall'), false, 'f: names must exist');
  assert.equal(isSlotColor('#abcdef'), true);
  assert.equal(isSlotColor('#abcdeg'), false);
});

test('changing the size changes the outline inside the range and stays inside the triangle budget', () => {
  for (const spec of SPECS.filter((s) => Object.keys(s.range).length)) {
    const { g } = placed(spec.id);
    const small = spec.size.slice(), big = spec.size.slice();
    for (const [ax, [lo, hi]] of Object.entries(spec.range)) { const i = { w: 0, d: 1, h: 2 }[ax]; small[i] = lo; big[i] = hi; }
    const lo = rebuildPiece(g, { size: small }), hi = rebuildPiece(lo, { size: big });
    for (const [piece, want] of [[lo, small], [hi, big]]) {
      assert.deepEqual(piece.userData.size, want, spec.id);
      assert.ok(piece.userData.tris <= spec.maxTris, `${spec.id}: ${piece.userData.tris} triangles`);
      assert.equal(piece.userData.truncated, false, `${spec.id}: truncated`);
      // the outline in the local frame (undo the placement): width along x, depth along z, height along y
      const local = buildPiece(spec.id, { size: want, seed: 11 });
      const a = extent(local), b = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3());
      assert.ok(Math.abs(Math.max(b.x, b.z) - Math.max(a.x, a.z)) < 0.01 && Math.abs(b.y - a.y) < 0.01, `${spec.id}: outline differs from a fresh build`);
    }
    const eLo = extent(lo), eHi = extent(hi);
    assert.ok(eHi.x + eHi.z > eLo.x + eLo.z - 1e-6 && eHi.y >= eLo.y - 1e-6, `${spec.id}: the larger piece is not larger`);
    assert.ok(eHi.x + eHi.z + eHi.y > eLo.x + eLo.z + eLo.y + 0.05, `${spec.id}: the range changes nothing visible`);
  }
});

test('a size outside the range is held inside it, a bad entry keeps the current value, and a fixed axis stays', () => {
  const { g } = placed('sofa2');
  const wide = rebuildPiece(g, { size: [9, 9, 9] });
  assert.deepEqual(wide.userData.size, [1.9, 0.9, 0.85]);
  const keep = rebuildPiece(wide, { size: [NaN, Infinity, 'x'] });
  assert.deepEqual(keep.userData.size, [1.9, 0.9, 0.85], 'non-numbers keep the current size');
  const narrow = rebuildPiece(keep, { size: [0.2] });
  assert.deepEqual(narrow.userData.size, [1.4, 0.9, 0.85], 'a short array only sets the width');
  assert.deepEqual(narrow.userData.size, clampSize('sofa2', [1.4]));
});

test('quality and look carry over, and can be changed', () => {
  const { g } = placed('sofa3', { quality: 'high' });
  applyLook(g, 'textured');
  const same = rebuildPiece(g, { colors: { legs: '#334455' } });
  assert.equal(same.userData.quality, 'high');
  assert.equal(same.userData.lookName, 'textured');
  const up = meshes(same).find((m) => m.userData.slot === 'upholstery');
  assert.ok(up.material.map, 'still textured after the rebuild');
  const low = rebuildPiece(same, { quality: 'low', look: 'clay' });
  assert.equal(low.userData.quality, 'low');
  assert.equal(low.userData.lookName, 'clay');
  assert.ok(low.userData.tris < same.userData.tris, 'low quality is lighter');
  assert.ok(!meshes(low).find((m) => m.userData.slot === 'upholstery').material.map);
});

test('emitters are worked out again for the new piece', () => {
  const { g } = placed('floor-lamp');
  assert.ok(g.userData.emitters.length >= 1);
  g.userData.emitters = []; // stale data on the old group must not be copied
  const next = rebuildPiece(g, { colors: { shade: '#aa8855' } });
  assert.ok(next.userData.emitters.length >= 1);
  assert.ok(next.userData.emitters.every((e) => e.pos.length === 3 && e.pos.every(Number.isFinite)));
  const fresh = buildPiece('floor-lamp', { seed: 11, colors: { shade: '#aa8855' } });
  assert.deepEqual(next.userData.emitters, fresh.userData.emitters);
});

test('the old geometries are disposed, 200 rebuilds in a row leave none behind, and the cache of materials stays bounded', () => {
  const { parent, g } = placed('kitchen-sink');
  let live = g;
  const watched = [];
  const watch = (piece) => { for (const m of meshes(piece)) { const rec = { disposed: 0 }; m.geometry.addEventListener('dispose', () => { rec.disposed++; }); watched.push({ rec, piece }); } };
  watch(live);
  const spec = specOf('kitchen-sink'), slots = spec.slots, palette = ['#a1b2c3', '#334455', '#99aa88', '#c0a080', '#112233'];
  for (let i = 0; i < 200; i++) {
    const size = [spec.range.w[0] + ((i * 37) % 17) * 0.05, 0.6, spec.range.h[0] + ((i * 13) % 4) * 0.05];
    live = rebuildPiece(live, { size, colors: { [slots[i % slots.length]]: palette[i % palette.length] }, look: i % 2 ? 'clay' : 'textured' });
    assert.equal(live.parent, parent);
    assert.ok(live.userData.tris <= spec.maxTris);
    watch(live);
  }
  assert.equal(parent.children.length, 3, 'one piece among the siblings');
  const dead = watched.filter((w) => w.piece !== live), alive = watched.filter((w) => w.piece === live);
  assert.ok(dead.length >= 200 * 4, `${dead.length} old geometries watched`);
  assert.ok(dead.every((w) => w.rec.disposed === 1), 'every old geometry was disposed exactly once');
  assert.ok(alive.length >= 4 && alive.every((w) => w.rec.disposed === 0), 'the live piece keeps its geometry');
  for (let i = 0; i < 3000; i++) materialFor('f:wood', `#${(0x100000 + i * 37).toString(16).padStart(6, '0')}`);
  assert.ok(materialCacheSize() <= 1500 + 1, `${materialCacheSize()} cached materials`);
  assert.ok(materialFor('f:wood', '#101010').color.getHexString() === '101010', 'a dropped clone is rebuilt on demand');
});

test('in a composed flat a rebuilt piece keeps its place and look, and the light list can be made again from the pieces', () => {
  const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
  for (const lv of plan.levels) lv.furniture = [];
  const model = buildModel(modelOf(analyzePlan(plan)));
  const layout = autoFurnish(model, { seed: 1 });
  const c = composeLayout({ model, layout, quality: 'medium', look: 'textured', seed: 1 });
  const lamps = [...c.pieces].filter(([, g]) => g.userData.emitters.length);
  assert.ok(lamps.length >= 1 && c.pieces.size >= 10, 'the flat has lamps and furniture');
  const before = emittersOf(c.pieces), round = (list) => list.map((e) => [...e.pos.map((v) => Math.round(v * 1e4) / 1e4), e.color, e.power]);
  assert.ok(before.length >= 1);
  for (const [id, old] of lamps.slice(0, 2)) {
    const at = old.position.toArray(), turn = old.quaternion.clone(), pieceId = old.userData.pieceId, index = c.group.children.indexOf(old);
    const next = rebuildPiece(old, { colors: { shade: '#336699' } });
    c.pieces.set(id, next);
    assert.equal(next.parent, c.group);
    assert.equal(c.group.children.indexOf(next), index, 'same place among the pieces');
    assert.deepEqual(next.position.toArray(), at);
    assert.ok(next.quaternion.angleTo(turn) < 1e-9, 'same orientation');
    assert.equal(next.userData.pieceId, pieceId);
    assert.equal(next.userData.lookName, 'textured', 'the look applied by composeLayout is remembered');
    assert.equal(meshes(next).find((m) => m.userData.slot === 'shade').userData.look.tint, '#336699');
  }
  assert.deepEqual(round(emittersOf(c.pieces)), round(before), 'recolouring a shade moves no light');
  // a bigger piece in the same flat: the size changes, the number of lights does not
  const [sofaId, sofa] = [...c.pieces].find(([, g]) => g.userData.type === 'sofa3' || g.userData.type === 'sofa2');
  const wider = rebuildPiece(sofa, { size: [sofa.userData.size[0] + 0.2, 9, 9] });
  c.pieces.set(sofaId, wider);
  assert.ok(wider.userData.size[0] > sofa.userData.size[0] - 1e-9);
  assert.equal(emittersOf(c.pieces).length, before.length);
});

test('a group that is not a piece throws, and so does a piece of an unknown type', () => {
  assert.throws(() => rebuildPiece(null), /not a furniture piece/);
  assert.throws(() => rebuildPiece(new THREE.Group()), /not a furniture piece/);
  const g = buildPiece('rug'); g.userData.type = 'nope'; delete g.userData.pieceType;
  assert.throws(() => rebuildPiece(g, {}), /not a furniture piece/);
  const free = buildPiece('rug', { seed: 5 });
  const next = rebuildPiece(free, { colors: { fabric: '#445566' } });
  assert.equal(next.parent, null, 'a piece without a parent is rebuilt without one');
});
