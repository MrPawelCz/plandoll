// The edit parameter of the page: off by default, on only for edit=1, and it switches the merging of meshes off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, buildHash, editHash } from '../../src/app/params.js';

test('edit is off by default and for any value other than 1', () => {
  assert.equal(parseParams('').edit, false);
  assert.equal(parseParams('#amber&edit=0').edit, false);
  assert.equal(parseParams('#edit=true').edit, false);
  assert.equal(parseParams('#edit=').edit, false);
});

test('edit=1 turns the editor on and keeps merging on; merge=0 turns merging off', () => {
  const on = parseParams('#edit=1');
  assert.equal(on.edit, true); assert.equal(on.merge, true);
  assert.equal(parseParams('#edit=1&merge=0').merge, false);
  assert.equal(parseParams('#amber').merge, true);
  assert.equal(parseParams('#merge=0').merge, false);
});

test('buildHash writes edit=1 only when the editor is on, and the hash reads back', () => {
  const plain = parseParams('#clear&t=0.5');
  assert.ok(!buildHash(plain).includes('edit'));
  const on = parseParams('#clear&t=0.5&edit=1');
  assert.ok(buildHash(on).includes('edit=1'));
  assert.equal(parseParams(`#${buildHash(on)}`).edit, true);
  assert.equal(parseParams(`#${buildHash(plain)}`).edit, false);
});

test('a broken percent sequence in the address does not throw and the value is ignored', () => {
  for (const hash of ['#t=%', '#%E0%A4%A', '#amber&q=%zz&seed=%', '#plan=%E0%A4%A&edit=1']) {
    assert.doesNotThrow(() => parseParams(hash), hash);
  }
  assert.equal(parseParams('#t=%').tmSet, true, 'the key is seen');
  assert.ok(Number.isFinite(parseParams('#t=%').t), 't falls back to a number');
  assert.equal(parseParams('#amber&q=%zz&seed=%').preset, 'amber');
  assert.equal(parseParams('#plan=%E0%A4%A&edit=1').edit, true);
});

test('walk=1 opens in Spacer and walk=0 takes its button away; they read back and the editor leaves walk=1 out of the address', () => {
  assert.equal(parseParams('#walk=1').walk, true);
  assert.equal(parseParams('#walk=1').spacer, true);
  assert.equal(parseParams('#walk=0').walk, false);
  assert.equal(parseParams('#walk=0').spacer, false);
  assert.equal(parseParams('').walk, false);
  assert.equal(parseParams('').spacer, true);
  assert.ok(!/walk/.test(editHash('#walk=1&amber', true, { preset: 'amber' })), 'the editor has no Spacer');
  assert.ok(/walk=0/.test(editHash('#walk=0', true, {})));
});
