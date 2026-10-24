// The point-light pool takes the strongest lamp first and then spreads over the home instead of crowding one room.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { spreadPick, createRig } from '../../src/look/rig.js';

const lamp = (x, z, power = 1) => ({ pos: [x, 1, z], color: '#ffb064', power });

test('spreadPick: strongest first, then the farthest, deterministic', () => {
  const list = [lamp(0, 0, 0.5), lamp(0.5, 0, 1), lamp(1, 0, 0.8), lamp(9, 0, 0.5), lamp(4.5, 6, 0.5)];
  const a = spreadPick(list, 3), b = spreadPick(list, 3);
  assert.deepEqual(a, b);
  assert.equal(a[0], list[1], 'the strongest lamp comes first');
  assert.ok(a.includes(list[3]), 'the far lamp is taken before the neighbours of the first one');
  assert.ok(!a.includes(list[0]) && !a.includes(list[2]), 'the two neighbours stay out');
});

test('spreadPick: small and empty inputs', () => {
  assert.deepEqual(spreadPick([], 3), []);
  assert.deepEqual(spreadPick([lamp(1, 1)], 0), []);
  assert.equal(spreadPick([lamp(1, 1), lamp(2, 2)], 6).length, 2);
});

test('the rig lights the lamps that spread over two storeys', () => {
  const group = new THREE.Group();
  const rig = createRig({ group, quality: 'low' });
  const list = [lamp(1, 1), lamp(1.2, 1), lamp(1.4, 1), lamp(8, 5), lamp(1, 1.3), lamp(1.1, 1.2)];
  list.push({ pos: [4, 4, 3], color: '#ffb064', power: 1 });
  rig.setEmitters(list);
  const on = rig.pool.filter((p) => p.light.visible);
  assert.ok(on.length >= 1);
  assert.ok(on.some((p) => p.light.position.x > 6), 'the far lamp is lit');
});
