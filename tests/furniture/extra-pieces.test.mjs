// The small wardrobe, the sofa bed, the wall shelf and the bathroom cabinet: what makes each of them that piece, beyond the generic checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { specOf } from '../../src/furniture/specs.js';
import { buildPiece, HAS_BUILDER } from '../../src/furniture/index.js';
import { catalog } from '../../src/furniture/catalog.js';
import { paletteOf, defaultColorOf } from '../../src/furniture/palettes.js';

const slotMesh = (g, slot) => { const out = []; g.traverse((o) => { if (o.isMesh && o.userData.slot === slot) out.push(o); }); return out; };
const boxOf = (g, slot) => { const b = new THREE.Box3(); for (const m of slotMesh(g, slot)) b.union(new THREE.Box3().setFromObject(m)); return b; };
const verts = (g, slot) => slotMesh(g, slot).reduce((n, m) => n + m.geometry.attributes.position.count, 0);
const TYPES = ['wardrobe-small', 'sofa-bed', 'shelf-wall', 'bathroom-cabinet'];

test('the four extra types are in the contract as tier 3, are built by code, and are in the catalogue with palettes', () => {
  const list = catalog('pl');
  for (const id of TYPES) {
    const spec = specOf(id);
    assert.equal(spec.tier, 3, id);
    assert.ok(HAS_BUILDER.has(id), `${id}: no builder`);
    assert.equal(buildPiece(id).userData.builder, 'code');
    const e = list.find((x) => x.id === id);
    assert.ok(e && e.label && e.groupLabel, id);
    for (const slot of spec.slots) { assert.ok(paletteOf(id, slot).colors.length >= 8, `${id}/${slot}`); assert.match(defaultColorOf(id, slot), /^#[0-9a-f]{6}$/); }
  }
  assert.equal(specOf('shelf-wall').place.mode, 'wall-mount');
  assert.equal(specOf('bathroom-cabinet').place.mode, 'wall-mount');
  assert.equal(catalog('en').find((x) => x.id === 'bathroom-cabinet').elevation, 1.2);
});

test('wardrobe-small: the number of doors follows the width, and a handle sits on every door', () => {
  const door = (w) => { const g = buildPiece('wardrobe-small', { size: [w, 0.55, 1.9] }); return [verts(g, 'doors'), verts(g, 'handles')]; };
  const [d1, h1] = door(0.6), [d2, h2] = door(0.9), [d3, h3] = door(1.2);
  assert.ok(d1 > 0 && h1 > 0);
  assert.equal(d2, d1 * 2, 'two doors at 0.9 m');
  assert.equal(d3, d1 * 3, 'three doors at 1.2 m');
  assert.equal(h2, h1 * 2);
  assert.equal(h3, h1 * 3);
  const tall = buildPiece('wardrobe-small', { size: [0.9, 0.55, 2.2] }), low = buildPiece('wardrobe-small', { size: [0.9, 0.55, 1.5] });
  assert.ok(boxOf(tall, 'doors').max.y > boxOf(low, 'doors').max.y + 0.5, 'the height range changes the doors');
});

test('the standard wardrobe is unchanged by sharing its code: two doors at the smallest width, six at the largest', () => {
  const doors = (w) => verts(buildPiece('wardrobe', { size: [w, 0.6, 2.2] }), 'doors');
  assert.equal(doors(0.9) * 3, doors(3.2), 'two doors at 0.9 m, six at 3.2 m');
  assert.equal(doors(2.7) * 2, doors(0.9) * 5, 'five doors at 2.7 m');
  const g = buildPiece('wardrobe', { size: [1.8, 0.6, 2.2] });
  const h = slotMesh(g, 'handles')[0].geometry.boundingBox;
  assert.ok(Math.abs(h.max.y - h.min.y - 0.34) < 0.02, 'the handle is 0.34 m long on the standard wardrobe');
});

test('sofa-bed: the front panel of the base stands proud of the seat, and the seats follow the width', () => {
  const spec = specOf('sofa-bed'), bed = buildPiece('sofa-bed'), sofa = buildPiece('sofa3', { size: [1.9, 0.95, 0.85] });
  assert.ok(boxOf(bed, 'upholstery').max.z > spec.size[1] / 2 + 0.005, 'the panel reaches past the plain seat base');
  assert.ok(boxOf(sofa, 'upholstery').max.z < spec.size[1] / 2, 'a plain sofa does not');
  assert.ok(boxOf(bed, 'upholstery').max.z <= spec.size[1] / 2 * 1.03, 'but it stays inside the size of the contract');
  const cush = (w) => verts(buildPiece('sofa-bed', { size: [w, 0.95, 0.85], quality: 'low' }), 'cushions');
  assert.ok(cush(2.4) > cush(1.6) * 1.2, 'a wider sofa bed has more cushions');
});

test('shelf-wall: two boards at the bottom and the top, books in between, nothing below the bottom edge', () => {
  const spec = specOf('shelf-wall'), g = buildPiece('shelf-wall', { seed: 4 });
  const boards = boxOf(g, 'board'), books = boxOf(g, 'books');
  assert.ok(Math.abs(boards.min.y) < 0.002 && Math.abs(boards.max.y - spec.size[2]) < 0.002, 'the boards span the whole height');
  assert.ok(books.min.y >= 0.029 && books.max.y < spec.size[2] - 0.029, `books between the boards: ${books.min.y.toFixed(3)} to ${books.max.y.toFixed(3)}`);
  assert.ok(Math.abs(boards.max.x - boards.min.x - spec.size[0]) < 0.01);
  const wide = buildPiece('shelf-wall', { size: [1.6, 0.2, 0.5], seed: 4 });
  assert.ok(verts(wide, 'books') > verts(g, 'books'), 'a wider shelf holds more books');
});

test('bathroom-cabinet: the mirror is on the front, inside the door, with the handle in front of it, all inside the depth', () => {
  const spec = specOf('bathroom-cabinet'), g = buildPiece('bathroom-cabinet');
  const mirror = boxOf(g, 'mirror'), body = boxOf(g, 'body'), handle = boxOf(g, 'handle'), all = new THREE.Box3().setFromObject(g);
  assert.ok(mirror.max.z > body.max.z - 0.01, 'the mirror is on the front face');
  assert.ok(mirror.max.x - mirror.min.x < spec.size[0] - 0.03 && mirror.max.y - mirror.min.y < spec.size[2] - 0.03, 'a rim of the door shows around the mirror');
  assert.ok(handle.max.z > mirror.max.z, 'the handle stands in front of the mirror');
  assert.ok(all.max.z - all.min.z <= spec.size[1] * 1.03 && Math.abs(all.min.y) < 0.002 && Math.abs(all.max.y - spec.size[2]) < 0.002);
  const tall = buildPiece('bathroom-cabinet', { size: [0.6, 0.15, 0.9] }), small = buildPiece('bathroom-cabinet', { size: [0.6, 0.15, 0.5] });
  assert.ok(verts(tall, 'body') > verts(small, 'body'), 'the inner shelf appears on a tall cabinet only');
});
