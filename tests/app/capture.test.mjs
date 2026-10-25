import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRequest, FRAME_LIMITS } from '../../src/app/capture.js';
import { editHash, parseParams } from '../../src/app/params.js';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/app/camera.js';

test('frameRequest keeps usable values and clamps the ranges', () => {
  const r = frameRequest({ preset: 'clear', t: 1.7, az: 725, pol: 30, dist: 9, size: { w: 5000, h: 100 } });
  assert.equal(r.preset, 'clear');
  assert.equal(r.t, 1);
  assert.equal(r.az, 725);
  assert.equal(r.pol, 30);
  assert.equal(r.dist, ZOOM_MAX);
  assert.deepEqual(r.size, { w: FRAME_LIMITS.maxW, h: FRAME_LIMITS.minH });
  assert.equal(frameRequest({ dist: 0.01 }).dist, ZOOM_MIN);
  assert.deepEqual(frameRequest({ size: { w: 1280.4, h: 719.6 } }).size, { w: 1280, h: 720 });
});

test('frameRequest drops what cannot be used', () => {
  assert.deepEqual(frameRequest(undefined), {});
  assert.deepEqual(frameRequest(null), {});
  assert.deepEqual(frameRequest('x'), {});
  const r = frameRequest({ preset: 'nope', t: NaN, az: Infinity, pol: '30', dist: -1, size: { w: 800 } });
  assert.deepEqual(r, {});
  assert.equal('t' in frameRequest({ t: undefined }), false);
});

test('editHash switches edit on and off and keeps the rest of the address', () => {
  const on = editHash('#amber&btn=1&az=40', true, { preset: 'clear', t: 0.25, q: 'high', lang: 'pl' });
  const p = parseParams(on, {});
  assert.equal(p.edit, true); assert.equal(p.btn, true); assert.equal(p.preset, 'clear'); assert.equal(p.t, 0.25); assert.equal(p.q, 'high'); assert.equal(p.lang, 'pl'); assert.equal(p.az, 40);
  assert.equal(on.includes('amber'), false);
  const off = editHash(on, false, { preset: 'clear', t: 0.25, q: 'auto', lang: 'pl' });
  const o = parseParams(off, {});
  assert.equal(o.edit, false); assert.equal(o.btn, true); assert.equal(o.az, 40); assert.equal(off.includes('q='), false);
  assert.equal(parseParams('', {}).btn, true); assert.equal(parseParams('#btn=0', {}).btn, false);
});
