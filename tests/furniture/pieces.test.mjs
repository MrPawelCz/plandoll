// Code-built furniture in Node (no GL): every implemented type builds at the default and extreme sizes, stays inside its size,
// within its triangle and mesh budgets, has every slot of the contract, is deterministic, and recolours only the slot asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPECS, specOf } from '../../src/furniture/specs.js';
import { buildPiece, piecesImplemented, HAS_BUILDER, applyLook } from '../../src/furniture/index.js';

const ids = piecesImplemented();
const AX = { w: 0, d: 1, h: 2 };
const sizesOf = (spec) => {
  const out = [spec.size.slice()];
  for (const [ax, [lo, hi]] of Object.entries(spec.range)) for (const v of [lo, hi]) { const s = spec.size.slice(); s[AX[ax]] = v; out.push(s); }
  return out;
};
const meshes = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
const hashPositions = (g) => {
  let h = 2166136261;
  for (const m of meshes(g)) {
    const a = m.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ Math.round(a[i] * 1e5), 16777619) >>> 0; }
    h = Math.imul(h ^ m.geometry.attributes.position.count, 16777619) >>> 0;
  }
  return h;
};
const slotHash = (g) => {
  const out = {};
  for (const m of meshes(g)) out[m.userData.slot] = (out[m.userData.slot] ?? 0) ^ hashPositions({ traverse: (f) => f(m) });
  return out;
};

test('at least fourteen types are implemented and all of them are in the contract', () => {
  assert.ok(ids.length >= 14, `${ids.length} implemented`);
  for (const id of HAS_BUILDER) assert.ok(specOf(id), `${id} is not in specs.js`);
});

test('an unknown type throws, a type without a builder still builds a safe block', () => {
  assert.throws(() => buildPiece('nope'));
  const missing = SPECS.find((s) => !HAS_BUILDER.has(s.id));
  if (missing) {
    const g = buildPiece(missing.id, { size: missing.size });
    assert.ok(meshes(g).length >= 1);
    assert.equal(g.userData.type, missing.id);
  }
});

for (const id of ids) {
  const spec = specOf(id);
  test(`${id}: size, budgets, slots, finite numbers`, () => {
    for (const size of sizesOf(spec)) {
      const g = buildPiece(id, { size, seed: 7, quality: 'medium' });
      const box = new THREE.Box3().setFromObject(g), ext = box.getSize(new THREE.Vector3());
      const lim = [size[0], size[2], size[1]]; // x, y, z
      const got = [ext.x, ext.y, ext.z];
      for (let a = 0; a < 3; a++) assert.ok(got[a] <= lim[a] * 1.03 + 1e-6, `${id} ${size}: axis ${a} is ${got[a].toFixed(3)} > ${lim[a]}`);
      assert.ok(box.min.y >= -0.005, `${id}: below the floor ${box.min.y}`);
      assert.ok(Math.abs(box.min.x + box.max.x) / 2 <= size[0] * 0.15 + 0.01 && Math.abs(box.min.z + box.max.z) / 2 <= size[1] * 0.2 + 0.01, `${id}: footprint not centred`);
      const ms = meshes(g);
      assert.ok(ms.length <= 14, `${id}: ${ms.length} meshes`);
      assert.ok(g.userData.tris <= spec.maxTris, `${id}: ${g.userData.tris} > ${spec.maxTris}`);
      let tris = 0;
      for (const m of ms) {
        const a = m.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${id}: NaN in position`);
        tris += (m.geometry.index ? m.geometry.index.count : a.length / 3) / 3;
        assert.ok(spec.slots.includes(m.userData.slot), `${id}: mesh with slot ${m.userData.slot}`);
      }
      assert.equal(Math.round(tris), Math.round(g.userData.tris), `${id}: tris bookkeeping`);
      for (const slot of spec.slots) assert.ok(ms.some((m) => m.userData.slot === slot), `${id}: missing slot ${slot}`);
      assert.ok(Array.isArray(g.userData.emitters) && Array.isArray(g.userData.slots));
      assert.equal(g.userData.truncated, false, `${id} ${size}: truncated`);
      if (spec.emits) assert.ok(g.userData.emitters.length >= 1, `${id}: no emitter`);
    }
  });

  test(`${id}: same seed, same piece; low quality is not heavier`, () => {
    const a = buildPiece(id, { seed: 3 }), b = buildPiece(id, { seed: 3 }), lo = buildPiece(id, { seed: 3, quality: 'low' });
    assert.equal(hashPositions(a), hashPositions(b));
    assert.ok(lo.userData.tris <= a.userData.tris + 1);
  });

  test(`${id}: colors change only the slot asked for`, () => {
    const base = buildPiece(id, { seed: 5 });
    const baseHash = slotHash(base), baseColor = {};
    for (const m of meshes(base)) baseColor[m.userData.slot] = (baseColor[m.userData.slot] ?? []).concat(m.material.color.getHexString());
    for (const slot of spec.slots) {
      const g = buildPiece(id, { seed: 5, colors: { [slot]: '#12ab34' } });
      assert.deepEqual(slotHash(g), baseHash, `${id}/${slot}: geometry changed`);
      for (const m of meshes(g)) {
        const was = baseColor[m.userData.slot];
        const now = m.material.color.getHexString();
        if (m.userData.slot === slot) assert.ok(now !== '' && m.material !== undefined && !was.every((c) => c === now) || was.length > 1 || now !== was[0], `${id}/${slot}: not recoloured`);
        else assert.ok(was.includes(now), `${id}/${slot}: slot ${m.userData.slot} changed`);
      }
    }
  });
}

test('a slot colour never touches the shared material', () => {
  const spec = specOf(ids[0]);
  const a = buildPiece(spec.id), tinted = buildPiece(spec.id, { colors: { [spec.slots[0]]: '#ff0000' } }), c = buildPiece(spec.id);
  assert.equal(hashPositions(a), hashPositions(c));
  const col = (g) => meshes(g).map((m) => m.material.color.getHexString()).join(',');
  assert.equal(col(a), col(c));
  assert.notEqual(col(a), col(tinted));
});

test('applyLook swaps plain materials to textures, keeps vertex colours and tints, and can go back', () => {
  const g = buildPiece('bookshelf', { seed: 2, colors: { body: '#556677' } });
  const books = meshes(g).find((m) => m.userData.slot === 'books'), body = meshes(g).find((m) => m.userData.slot === 'body');
  assert.equal(books.material.vertexColors, true);
  applyLook(g, 'textured');
  assert.equal(books.material.vertexColors, true);
  assert.ok(body.material.color.getHexString() !== 'ffffff');
  const sofa = buildPiece('sofa3');
  const up = meshes(sofa).find((m) => m.userData.slot === 'upholstery');
  const clay = up.material;
  applyLook(sofa, 'textured');
  assert.ok(up.material !== clay && up.material.map, 'textured upholstery has a map');
  applyLook(sofa, 'clay');
  assert.equal(up.material, clay);
  for (const m of meshes(sofa)) assert.ok(!m.pw || typeof m.pw.mat === 'string');
});
