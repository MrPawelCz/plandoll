// Contact shadows: one merged mesh of soft footprints under the pieces that stand on the floor; none under hung pieces, rugs,
// lifted pieces or skipped ones; repeatable, flat, never picked, and the texture is the same bytes every time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { specOf } from '../../src/furniture/specs.js';
import { composeLayout } from '../../src/render/compose.js';
import { contactMesh, contactMaterial, setContactLook, castsContact, footprintOf, CONTACT_PAD } from '../../src/render/contact.js';
import { sample } from '../../src/look/timeofday.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
for (const lv of plan.levels) lv.furniture = [];
const model = buildModel(modelOf(analyzePlan(plan)));
const layout = autoFurnish(model);
const composed = () => composeLayout({ model, layout, quality: 'medium', look: 'clay' });

test('one mesh covers every piece that stands on the floor, and nothing else', () => {
  const c = composed(), mesh = contactMesh(c.pieces);
  assert.ok(mesh, 'a furnished flat has footprints');
  const standing = [...c.pieces.values()].filter((g) => castsContact(g) && footprintOf(g));
  assert.equal(mesh.userData.pieces, standing.length);
  assert.equal(mesh.geometry.attributes.position.count, standing.length * 16);
  assert.equal(mesh.geometry.index.count, standing.length * 54);
  for (const g of c.pieces.values()) {
    const mode = specOf(g.userData.pieceType).place.mode;
    if (mode !== 'floor' && mode !== 'corner') assert.equal(castsContact(g), false, `${g.userData.pieceType} (${mode}) casts none`);
  }
});

test('the patches lie flat just above the floor, are finite and can never be picked', () => {
  const mesh = contactMesh(composed().pieces), p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
    assert.ok(p.getY(i) > 0 && p.getY(i) < 0.05, 'just above the floor');
  }
  const nm = mesh.geometry.attributes.normal;
  assert.ok(nm && nm.count === p.count, 'every vertex has a normal (the occlusion pass reads them)');
  for (let i = 0; i < nm.count; i++) assert.deepEqual([nm.getX(i), nm.getY(i), nm.getZ(i)], [0, 1, 0]);
  const hits = []; mesh.raycast(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), hits);
  assert.equal(hits.length, 0);
  assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
});

test('skipped and hidden pieces leave the patch out, a footprint is a little larger than the piece', () => {
  const c = composed(), all = contactMesh(c.pieces).userData.pieces;
  const first = [...c.pieces.entries()].find(([, g]) => castsContact(g) && footprintOf(g));
  assert.ok(first);
  assert.equal(contactMesh(c.pieces, new Set([first[0]])).userData.pieces, all - 1);
  first[1].visible = false;
  assert.equal(contactMesh(c.pieces).userData.pieces, all - 1);
  const f = footprintOf(first[1]);
  assert.ok(f.x1 > f.x0 && f.z1 > f.z0 && CONTACT_PAD > 0.05 && CONTACT_PAD < 0.3);
});

test('the same layout gives the same bytes, and the look follows the time of day', () => {
  const a = contactMesh(composed().pieces), b = contactMesh(composed().pieces);
  assert.deepEqual([...a.geometry.attributes.position.array], [...b.geometry.attributes.position.array]);
  const tex = contactMaterial().map.image.data;
  assert.equal(tex.length, 32 * 32 * 4);
  assert.ok(tex[(16 * 32 + 16) * 4 + 3] >= 250, 'solid in the middle');
  assert.equal(tex[3], 0, 'clear at the outer corner');
  setContactLook(sample(0.4)); const day = contactMaterial().opacity;
  setContactLook(sample(0.98)); const night = contactMaterial().opacity;
  assert.ok(day > 0.25 && day < 0.8 && night > 0.25 && night < 0.8 && night >= day);
});
