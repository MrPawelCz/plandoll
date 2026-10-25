// The selection outline: which colour it takes for which problems, and that it follows the piece (position, angle, size).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutline, outlineKind, OUTLINE_COLORS } from '../../src/render/outline.js';

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
