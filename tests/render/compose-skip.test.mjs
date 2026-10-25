// Merging by material with some pieces left out (the editor keeps the piece being dragged as its own object).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeByMaterial } from '../../src/render/compose.js';

function composedOf(ids) {
  const group = new THREE.Group(), pieces = new Map(), material = new THREE.MeshStandardMaterial();
  ids.forEach((id, i) => {
    const g = new THREE.Group(); g.position.set(i * 2, 0, 0);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    group.add(g); pieces.set(id, g);
  });
  return { group, pieces };
}
const vertices = (merged) => merged.group.children.reduce((n, m) => n + m.geometry.attributes.position.count, 0);

test('every visible piece goes into the merged meshes by default', () => {
  const c = composedOf(['a', 'b', 'c']);
  const m = mergeByMaterial(c);
  assert.equal(m.meshes, 1); assert.equal(vertices(m), 3 * 24);
});

test('pieces in skip stay out of the merged meshes, hidden ones too', () => {
  const c = composedOf(['a', 'b', 'c']);
  assert.equal(vertices(mergeByMaterial(c, new Set(['b']))), 2 * 24);
  c.pieces.get('c').visible = false;
  assert.equal(vertices(mergeByMaterial(c, new Set(['b']))), 24);
  assert.equal(vertices(mergeByMaterial(c, new Set())), 2 * 24);
  assert.equal(mergeByMaterial(c, new Set(['a', 'b'])).meshes, 0);
});
