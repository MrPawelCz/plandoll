// The selection outline: which colour it takes for which problems, and that it follows the piece (position, angle, size).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutline, createRoomOutline, outlineKind, OUTLINE_COLORS } from '../../src/render/outline.js';

test('colour kind: red for hard problems, yellow for the rest, light when there are none', () => {
  assert.equal(outlineKind([]), 'ok');
  assert.equal(outlineKind(undefined), 'ok');
  assert.equal(outlineKind([{ kind: 'overlap', with: 'p2' }]), 'bad');
  assert.equal(outlineKind([{ kind: 'outside-room' }]), 'bad');
  assert.equal(outlineKind([{ kind: 'floating-prop' }]), 'bad');
  assert.equal(outlineKind([{ kind: 'door-zone' }]), 'warn');
  assert.equal(outlineKind([{ kind: 'stair' }, { kind: 'tall-before-window' }]), 'warn');
  assert.equal(outlineKind([{ kind: 'door-zone' }, { kind: 'overlap' }]), 'bad');
  assert.equal(outlineKind([null, {}]), 'warn');
});

test('the outline sits on the piece, turns with it and takes the colour of the problem', () => {
  const o = createOutline();
  assert.equal(o.visible, false);
  o.set({ x: 2, y: 3, rot: 90, elev: 0.5, size: [2, 1, 0.8] }, 3, 'bad');
  assert.equal(o.visible, true);
  assert.ok(Math.abs(o.group.position.x - 2) < 1e-9 && Math.abs(o.group.position.z - 3) < 1e-9);
  assert.ok(Math.abs(o.group.position.y - (3 + 0.5 + 0.006)) < 1e-9, 'on the floor of its level, at the foot of the piece');
  assert.ok(Math.abs(o.group.rotation.y + Math.PI / 2) < 1e-9, 'same turn as the piece group');
  assert.equal(o.kindColor, OUTLINE_COLORS.bad);
  o.set({ x: 2, y: 3, rot: 0, elev: 0, size: [2, 1, 0.8] }, 0, 'warn');
  assert.equal(o.kindColor, OUTLINE_COLORS.warn);
  o.set({ x: 2, y: 3, rot: 0, elev: 0, size: [2, 1, 0.8] }, 0, 'nonsense');
  assert.equal(o.kindColor, OUTLINE_COLORS.ok);
  o.hide();
  assert.equal(o.visible, false);
  o.dispose();
});

test('a broken piece hides the outline instead of throwing', () => {
  const o = createOutline();
  o.set({ x: 1, y: 1, rot: 0, elev: 0, size: [1, 1, 1] }, 0, 'ok');
  assert.equal(o.visible, true);
  for (const bad of [null, undefined, { x: NaN, y: 0, rot: 0, elev: 0, size: [1, 1, 1] }, { x: 0, y: 0, rot: 0, elev: 0, size: [1, 1] }, { x: 0, y: 0, rot: 0, elev: 0 }]) {
    o.set(bad, 0, 'ok');
    assert.equal(o.visible, false);
    o.set({ x: 1, y: 1, rot: 0, elev: 0, size: [1, 1, 1] }, 0, 'ok');
  }
  o.set({ x: 1, y: 1, rot: 0, elev: 0, size: [1, 1, 1] }, NaN, 'ok');
  assert.equal(o.visible, false);
});

test('the outline is drawn on top: no depth test, high render order, no shadows', () => {
  const o = createOutline();
  o.group.traverse((m) => {
    if (m === o.group) return;
    assert.equal(m.material.depthTest, false);
    assert.ok(m.renderOrder >= 1000);
    assert.equal(m.castShadow, false);
  });
});

test('every bar of a piece outline has a darker, wider bar under it, and the box edges follow the size', () => {
  const o = createOutline();
  o.set({ x: 2, y: 3, rot: 0, elev: 0, size: [2, 1, 0.8] }, 0, 'ok');
  const bars = o.group.children.filter((m) => m.geometry.type === 'BoxGeometry');
  assert.equal(bars.length, 24); // twelve edges, each with its dark under-bar
  const light = bars.filter((m) => m.material.color.getHexString() !== '3b2410'), dark = bars.filter((m) => m.material.color.getHexString() === '3b2410');
  assert.equal(light.length, 12); assert.equal(dark.length, 12);
  assert.ok(Math.max(...dark.map((m) => Math.min(m.scale.x, m.scale.y, m.scale.z))) > Math.max(...light.map((m) => Math.min(m.scale.x, m.scale.y, m.scale.z))));
  const longest = (axis) => Math.max(...light.map((m) => m.scale[axis]));
  assert.ok(longest('x') > 2 && longest('y') > 0.8 && longest('z') > 1);
  assert.ok(light.every((m) => Math.min(m.scale.x, m.scale.y, m.scale.z) >= 0.02)); // thick enough to read on a phone
});

test('the room outline follows a polygon (also a concave one), hides for bad input and never throws', () => {
  const o = createRoomOutline();
  assert.equal(o.visible, false);
  o.set([[0, 0], [4, 0], [4, 3], [0, 3]], 0);
  assert.equal(o.visible, true);
  const count = (i) => o.group.children[i].geometry.getAttribute('position')?.count ?? 0;
  assert.equal(count(0), 6); // the fill: two triangles
  assert.equal(count(1), 24); assert.equal(count(2), 24); // the dark and the light rim: a quad per edge
  o.set([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]], 2.8); // concave
  assert.equal(o.visible, true); assert.ok(count(0) >= 9);
  o.set([[0, 0], [1, 1]], 0); assert.equal(o.visible, false);
  o.set([[0, 0], [NaN, 1], [1, 2]], 0); assert.equal(o.visible, false);
  o.set(null, 0); assert.equal(o.visible, false);
  o.set([[0, 0], [4, 0], [4, 3]], Infinity); assert.equal(o.visible, false);
  o.hide(); o.dispose();
});

test('the outline frame gives the outline the matrix of a turned wall and takes it away again', async () => {
  const THREE = await import('three');
  const { createOutlineFrame } = await import('../../src/render/outline.js');
  const o = createOutline(), frame = createOutlineFrame(o);
  assert.equal(o.group.parent, frame.group, 'the outline rides in the frame');
  assert.equal(frame.group.matrixAutoUpdate, false);
  o.set({ x: 2, y: 3, rot: 0, elev: 0.5, size: [1, 0.2, 0.4] }, 0, 'ok');
  const scene = new THREE.Scene(); scene.add(frame.group);
  const spot = () => { scene.updateMatrixWorld(true); return o.group.getWorldPosition(new THREE.Vector3()); };
  const here = spot();
  assert.ok(Math.abs(here.x - 2) < 1e-9 && Math.abs(here.y - 0.506) < 1e-9 && Math.abs(here.z - 3) < 1e-9, 'no matrix: where the piece stands');
  const turn = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.5, 0);
  frame.follow(turn.toArray());
  const moved = spot(), want = new THREE.Vector3(2, 0.506, 3).applyMatrix4(turn);
  assert.ok(moved.distanceTo(want) < 1e-9, `the outline is where the wall has put it: ${moved.toArray()} vs ${want.toArray()}`);
  assert.ok(moved.distanceTo(here) > 1, 'and not where it was');
  frame.follow(null); assert.ok(spot().distanceTo(here) < 1e-9, 'null puts it back');
  frame.follow(turn.toArray()); frame.follow([1, 2, 3]); assert.ok(spot().distanceTo(here) < 1e-9, 'a matrix that is not valid puts it back');
  frame.follow(turn.toArray()); frame.follow(new Array(16).fill(NaN)); assert.ok(spot().distanceTo(here) < 1e-9, 'so does one with numbers that are not finite');
  frame.follow(undefined); assert.ok(spot().distanceTo(here) < 1e-9);
  frame.dispose(); assert.equal(frame.group.parent, null);
  o.dispose();
});
