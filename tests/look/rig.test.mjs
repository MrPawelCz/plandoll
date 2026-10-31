// The point-light pool takes the strongest lamp first and then spreads over the home instead of crowding one room.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { spreadPick, nearPick, createRig } from '../../src/look/rig.js';

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

test('nearPick: the nearest first, as many as asked, nothing for an empty list or none asked', () => {
  const list = [lamp(9, 0), lamp(1, 0), lamp(4, 0), lamp(2, 3)];
  assert.deepEqual(nearPick(list, 2, [0, 1, 0]), [list[1], list[3]]);
  assert.deepEqual(nearPick(list, 9, [10, 1, 0]).map((e) => e.pos[0]), [9, 4, 2, 1]);
  assert.deepEqual(nearPick([], 3, [0, 0, 0]), []);
  assert.deepEqual(nearPick(list, 0, [0, 0, 0]), []);
  assert.deepEqual(nearPick(list, 1, { x: 8.5, y: 1, z: 0 }), [list[0]], 'a point may be an object');
});

test('setFocus: the pool lights the lamps around the walker, follows him in steps of 0.3 m or more, and null gives the spread back', () => {
  const group = new THREE.Group();
  const rig = createRig({ group, quality: 'high' });
  const list = [...Array.from({ length: 8 }, (_, i) => lamp(i * 2, 0)), lamp(30, 0)];
  rig.setEmitters(list);
  const xs = () => rig.pool.filter((p) => p.light.visible).map((p) => p.light.position.x).sort((a, b) => a - b);
  const spread = xs();
  rig.setFocus([0, 1, 0]);
  assert.deepEqual(xs(), [0, 2, 4, 6, 8, 10], 'the six nearest');
  rig.setFocus([13, 1, 0]);
  assert.deepEqual(xs(), [4, 6, 8, 10, 12, 14], 'moved to the walker');
  rig.setFocus([13.1, 1, 0]);
  const stay = xs();
  rig.setFocus([13.2, 1, 0]);
  assert.deepEqual(xs(), stay, 'a step under 0.3 m changes nothing');
  assert.equal(rig.activeLights(), 6, 'the count of lit lamps stays the same, so no shader is rebuilt');
  rig.setFocus(null);
  assert.deepEqual(xs(), spread, 'no focus: the spread over the home is back');
});
