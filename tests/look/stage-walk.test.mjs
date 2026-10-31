// What the stage does for Spacer: the base of the house goes (the lights stay), the glow under the ceilings goes out with the day, and the fill light rises at night while the walker is inside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage } from '../../src/look/stage.js';
import { mat } from '../../src/render/materials.js';

// a canvas stand-in whose every call answers with something that can be called again (gradients, textures), as the stage draws its backdrop and base with them
const any = () => new Proxy(function stub() {}, { get: (t, k) => (k === 'width' ? 100 : k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : () => any()), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const make = () => createStage({ bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 6, minY: -0.2, maxY: 2.7 }, quality: 'low' });
const BASE = ['board', 'board-under', 'tabletop', 'contact-shadow'];

test('setBase(false) takes the card board, the board under it, the tabletop and the contact shadow away and setBase(true) gives them back; the lights stay', () => {
  const stage = make();
  const shown = () => BASE.map((n) => stage.group.getObjectByName(n).visible);
  assert.deepEqual(shown(), [true, true, true, true]);
  stage.setBase(false);
  assert.deepEqual(shown(), [false, false, false, false]);
  assert.ok(stage.rig.sun.parent === stage.group, 'the sun is still in the group');
  stage.setBase(true);
  assert.deepEqual(shown(), [true, true, true, true]);
  stage.dispose();
});

test('the glow under a ceiling is full by day and nearly out at night', () => {
  const stage = make(), ceiling = mat('ceiling', 'textured');
  stage.applyTime(0.32);
  assert.equal(ceiling.emissiveIntensity, 1, 'day');
  stage.applyTime(0.98);
  assert.ok(ceiling.emissiveIntensity < 0.2, `night: ${ceiling.emissiveIntensity}`);
  stage.applyTime(0.32);
  assert.equal(ceiling.emissiveIntensity, 1, 'and the day brings it back');
  stage.dispose();
});

test('with the base down the fill light follows how dark it is (a room with no lamp is not black), with the base up it is left to the page', () => {
  const stage = make(), hemi = stage.rig.hemi;
  stage.applyTime(0.98);
  const plain = hemi.intensity;
  stage.setBase(false);
  assert.ok(hemi.intensity > plain * 1.4, `raised at night: ${hemi.intensity} against ${plain}`);
  stage.applyTime(0.32);
  const day = hemi.intensity;
  stage.setBase(true); stage.applyTime(0.32);
  assert.equal(hemi.intensity, day, 'by day nothing is raised');
  stage.applyTime(0.98);
  assert.equal(hemi.intensity, plain, 'the base up again: night is as the view from above has it');
  stage.dispose();
});

test('the raise of the fill light goes the moment the base comes back, not when the page next sets its own', () => {
  const stage = make(), hemi = stage.rig.hemi;
  stage.applyTime(0.98);
  const plain = hemi.intensity;
  stage.setBase(false);
  const raised = hemi.intensity;
  assert.ok(raised > plain * 1.4, `raised at night: ${raised} against ${plain}`);
  stage.setBase(true);
  assert.equal(hemi.intensity, plain, 'the base up: back on the footing of the view from above, with no time change in between');
  stage.setBase(false);
  assert.equal(hemi.intensity, raised, 'and down again: raised again');
  stage.dispose();
});
