// Colour palettes: every slot of every type has a palette and a default colour, all values are well formed, and the default is the
// colour the builder really paints the slot with.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPECS } from '../../src/furniture/specs.js';
import { buildPiece } from '../../src/furniture/index.js';
import { PALETTES, paletteOf, defaultColorOf } from '../../src/furniture/palettes.js';

const HEX = /^#[0-9a-f]{6}$/;
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // en dash and em dash
const meshes = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test('every palette has 8 to 12 distinct, well formed colours with names in both languages', () => {
  const ids = Object.keys(PALETTES);
  assert.ok(ids.length >= 6, `${ids.length} palettes`);
  for (const [id, p] of Object.entries(PALETTES)) {
    assert.equal(p.id, id);
    assert.ok(p.label.en && p.label.pl && p.label.en !== p.label.pl || p.label.en === 'Metal', `${id}: label`);
    assert.ok(p.colors.length >= 8 && p.colors.length <= 12, `${id}: ${p.colors.length} colours`);
    assert.equal(new Set(p.colors.map((c) => c.hex)).size, p.colors.length, `${id}: repeated colour`);
    assert.equal(new Set(p.colors.map((c) => c.name.en)).size, p.colors.length, `${id}: repeated English name`);
    for (const c of p.colors) {
      assert.match(c.hex, HEX, `${id}: ${c.hex}`);
      for (const n of [c.name.en, c.name.pl, p.label.en, p.label.pl]) assert.ok(typeof n === 'string' && n.length > 0 && !LONG_DASH.test(n), `${id}/${c.hex}: name "${n}"`);
    }
  }
});

test('every slot of every type has a palette and a default colour', () => {
  let slots = 0;
  for (const spec of SPECS) {
    for (const slot of spec.slots) {
      slots++;
      const p = paletteOf(spec.id, slot), d = defaultColorOf(spec.id, slot);
      assert.ok(p && PALETTES[p.id], `${spec.id}/${slot}: no palette`);
      assert.deepEqual(p, PALETTES[p.id], `${spec.id}/${slot}: not the palette it names`);
      assert.ok(p.colors.length >= 8, `${spec.id}/${slot}: short palette`);
      assert.match(d, HEX, `${spec.id}/${slot}: default colour ${d}`);
    }
  }
  assert.ok(slots >= 100, `${slots} slots checked`);
});

test('the default colour is the colour of the biggest mesh of the slot in a freshly built piece', () => {
  // the biggest mesh by surface of its bounding box; a mesh with a material object of its own (a picture) counts a thousand times more
  const area = (m) => { const b = m.geometry.boundingBox; const x = b.max.x - b.min.x, y = b.max.y - b.min.y, z = b.max.z - b.min.z; return 2 * (x * y + y * z + x * z) * (m.userData.look ? 1 : 1000); };
  for (const spec of SPECS) {
    const g = buildPiece(spec.id, { seed: 9, quality: 'high' });
    for (const slot of spec.slots) {
      const ms = meshes(g).filter((m) => m.userData.slot === slot);
      assert.ok(ms.length >= 1, `${spec.id}/${slot}: no mesh`);
      const big = ms.reduce((a, b) => (area(b) > area(a) ? b : a));
      if (big.geometry.attributes.color) continue; // vertex colours (books, leaves): the default is the average, see the next test
      assert.equal(defaultColorOf(spec.id, slot), `#${big.material.color.getHexString()}`, `${spec.id}/${slot}`);
    }
  }
  assert.equal(defaultColorOf('toilet', 'ceramic'), '#ece7de', 'a known builder colour comes through');
  assert.equal(defaultColorOf('sofa2', 'upholstery'), '#d8d2c8');
});

test('a slot with vertex colours gets the average of its material and its vertex colours', () => {
  const g = buildPiece('bookshelf', { seed: 1, quality: 'low' }), books = meshes(g).find((m) => m.userData.slot === 'books');
  assert.ok(books.geometry.attributes.color, 'the books carry vertex colours');
  const col = books.geometry.attributes.color, n = col.count, sum = [0, 0, 0];
  for (let i = 0; i < n; i++) { sum[0] += col.getX(i); sum[1] += col.getY(i); sum[2] += col.getZ(i); }
  const want = new THREE.Color(books.material.color.r * sum[0] / n, books.material.color.g * sum[1] / n, books.material.color.b * sum[2] / n);
  assert.equal(defaultColorOf('bookshelf', 'books'), `#${want.getHexString()}`);
  assert.notEqual(defaultColorOf('bookshelf', 'books'), '#ffffff');
});

test('the palette follows the material of the slot, and every palette is used', () => {
  assert.equal(paletteOf('sofa2', 'upholstery').id, 'fabric');
  assert.equal(paletteOf('sofa2', 'legs').id, 'wood');
  assert.equal(paletteOf('toilet', 'ceramic').id, 'ceramic');
  assert.equal(paletteOf('kitchen-sink', 'tap').id, 'metal');
  assert.equal(paletteOf('plant-large', 'leaves').id, 'foliage');
  assert.equal(paletteOf('art-large', 'canvas').id, 'paper');
  assert.equal(paletteOf('mirror', 'glass').id, 'glass');
  const used = new Set();
  for (const spec of SPECS) for (const slot of spec.slots) used.add(paletteOf(spec.id, slot).id);
  assert.deepEqual([...used].sort(), Object.keys(PALETTES).sort(), 'a palette nobody uses, or a slot with no palette');
});

test('unknown types and slots give null, and the answers are copies', () => {
  assert.equal(paletteOf('nope', 'body'), null);
  assert.equal(paletteOf('sofa2', 'nope'), null);
  assert.equal(defaultColorOf('nope', 'body'), null);
  assert.equal(defaultColorOf('sofa2', 'nope'), null);
  assert.equal(paletteOf('sofa2', 'body'), null, 'a slot of another type');
  const p = paletteOf('sofa2', 'upholstery');
  p.colors[0].hex = '#000000'; p.colors.pop(); p.label.en = 'x';
  const q = paletteOf('sofa2', 'upholstery');
  assert.notEqual(q.colors[0].hex, '#000000');
  assert.ok(q.colors.length >= 8);
  assert.notEqual(q.label.en, 'x');
  assert.deepEqual(paletteOf('sofa2', 'upholstery'), q, 'deterministic');
});

test('a palette colour can be used for a slot: it changes only that slot', () => {
  const pick = paletteOf('sofa2', 'upholstery').colors[5].hex;
  const base = buildPiece('sofa2', { seed: 2 }), tinted = buildPiece('sofa2', { seed: 2, colors: { upholstery: pick } });
  const hexOf = (g, slot) => meshes(g).filter((m) => m.userData.slot === slot).map((m) => m.material.color.getHexString());
  assert.deepEqual(hexOf(tinted, 'upholstery'), [pick.slice(1)]);
  assert.notDeepEqual(hexOf(base, 'upholstery'), hexOf(tinted, 'upholstery'));
  assert.deepEqual(hexOf(base, 'legs'), hexOf(tinted, 'legs'));
  assert.deepEqual(hexOf(base, 'cushions'), hexOf(tinted, 'cushions'));
});
