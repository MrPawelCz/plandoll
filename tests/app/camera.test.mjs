// The orbit camera: pure state functions and the pointer controller, against fake elements and a fake clock (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, orbit, zoom, positionOf, stateFrom, nearSides, sameSides, sidesKey, viewOf, blend, rayFor, wrapDegrees, createCameraController,
  POLAR_MIN, POLAR_MAX, ZOOM_MIN, ZOOM_MAX, HYSTERESIS } from '../../src/app/camera.js';

const target = [5, 0, 4];
const finiteState = (s) => [s.azimuth, s.polar, s.distance, s.base].every(Number.isFinite);
// The pose the page starts with: 0.5, 0.7, 0.7 away from the target.
const homePos = (d) => { const n = Math.hypot(0.5, 0.7, 0.7); return [target[0] + (0.5 / n) * d, target[1] + (0.7 / n) * d, target[2] + (0.7 / n) * d]; };

test('the default view looks at the model from the south and east, and its position round-trips', () => {
  const s = stateFrom(homePos(12), target);
  assert.ok(Math.abs(s.distance - 12) < 1e-9);
  assert.ok(s.azimuth > 30 && s.azimuth < 41, `azimuth ${s.azimuth}`);
  assert.deepEqual(nearSides(s.azimuth), { north: false, south: true, west: false, east: true });
  const back = positionOf(s, target), want = homePos(12);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - want[i]) < 1e-9, `axis ${i}`);
});

test('orbit keeps the polar angle inside its limits, wraps the azimuth and never produces NaN', () => {
  let s = makeState({ azimuth: 35, polar: 50, distance: 10 });
  for (let i = 0; i < 400; i++) s = orbit(s, 7, -9);
  assert.equal(s.polar, POLAR_MAX);
  for (let i = 0; i < 400; i++) s = orbit(s, -3, 9);
  assert.equal(s.polar, POLAR_MIN);
  assert.ok(s.azimuth >= 0 && s.azimuth < 360);
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) assert.ok(finiteState(orbit(s, bad, bad)), String(bad));
  assert.equal(orbit(makeState({ azimuth: 10 }), 30, 0).azimuth, 340, 'dragging right turns the camera towards the west, the way round');
  assert.ok(finiteState(makeState({ azimuth: NaN, polar: NaN, distance: NaN })));
  assert.equal(makeState({ polar: 0 }).polar, POLAR_MIN);
  assert.equal(makeState({ polar: 90 }).polar, POLAR_MAX);
});

test('zoom stays within 0.45 to 1.8 times the default distance and ignores bad factors', () => {
  let s = makeState({ distance: 10 });
  for (let i = 0; i < 100; i++) s = zoom(s, 1.2);
  assert.ok(Math.abs(s.distance - 10 * ZOOM_MIN) < 1e-9);
  for (let i = 0; i < 100; i++) s = zoom(s, 1 / 1.2);
  assert.ok(Math.abs(s.distance - 10 * ZOOM_MAX) < 1e-9);
  const d = s.distance;
  for (const bad of [0, -2, NaN, Infinity, undefined, 'x']) assert.equal(zoom(s, bad).distance, d, String(bad));
  assert.ok(zoom(s, 1.01).distance < d, 'a valid factor does reach the code');
});

test('the camera never goes below the table: the height stays positive for every state', () => {
  for (let polar = POLAR_MIN; polar <= POLAR_MAX; polar += 4) for (let az = 0; az < 360; az += 30) {
    const p = positionOf(makeState({ azimuth: az, polar, distance: 9 }), target);
    assert.ok(p.every(Number.isFinite) && p[1] > target[1] + 1.5, `${az}/${polar}`);
  }
});

test('nearSides: every direction has a near edge, and an edge changes sides only HYSTERESIS degrees past the turning point', () => {
  assert.equal(HYSTERESIS, 10);
  let prev = nearSides(35);
  assert.deepEqual(prev, { north: false, south: true, west: false, east: true }, 'the default azimuth: south and east');
  let southOff = null;
  for (let az = 35; az <= 395; az += 1) { // turning on, once round
    const n = nearSides(az, prev);
    assert.ok(n.north || n.south || n.west || n.east, `some edge is near at ${az}`);
    if (southOff === null && prev.south && !n.south) southOff = az;
    prev = n;
  }
  assert.ok(southOff >= 100 && southOff <= 101, `the south edge drops out at ${southOff}, ten degrees past the turning point at 90`);
  assert.deepEqual(nearSides(35 + 360, prev), nearSides(35), 'once round gives the same set');
  // turning back, it returns only ten degrees before the turning point, so a wall on the line does not flicker
  prev = nearSides(southOff + 30, nearSides(southOff + 30 - 1));
  let southOn = null;
  for (let az = southOff + 30; az >= 0 && southOn === null; az -= 1) {
    const n = nearSides(az, prev);
    assert.ok(n.north || n.south || n.west || n.east, `some edge is near at ${az}`);
    if (!prev.south && n.south) southOn = az;
    prev = n;
  }
  assert.ok(southOn !== null && southOn <= 80 && southOn >= 78, `the south edge returns at ${southOn}`);
  // on the turning point the answer depends on where the camera came from
  assert.notEqual(sidesKey(nearSides(95, nearSides(60))), sidesKey(nearSides(95, nearSides(150))));
  assert.equal(sidesKey(nearSides(NaN)), sidesKey(nearSides(0)), 'a bad angle is treated as 0');
});

test('sidesKey, viewOf and blend', () => {
  assert.equal(sidesKey({ south: true, east: true }), '-s-e');
  const v = viewOf(makeState({ azimuth: 90 }));
  assert.ok(Math.abs(v[0] - 1) < 1e-9 && Math.abs(v[1]) < 1e-9, 'from the east the view direction is +x');
  const a = makeState({ azimuth: 350, polar: 40, distance: 10 }), b = makeState({ azimuth: 10, polar: 60, distance: 10 });
  assert.equal(Math.round(blend(a, b, 0.5).azimuth), 0, 'the short way round, through the south');
  assert.equal(blend(a, b, 0).azimuth, 350); assert.equal(blend(a, b, 1).azimuth, 10);
  assert.ok(finiteState(blend(a, b, NaN)));
  assert.equal(wrapDegrees(-90), 270); assert.equal(wrapDegrees(725), 5); assert.equal(wrapDegrees(NaN), 0);
});

test('rayFor: the centre ray runs to the target, the edges tilt the right way, directions are unit length', () => {
  const s = makeState({ azimuth: 135, polar: 55, distance: 11 });
  const c = rayFor(s, target, 27, 1.5, 0, 0), o = positionOf(s, target);
  assert.deepEqual(c.origin, o);
  const toTarget = [target[0] - o[0], target[1] - o[1], target[2] - o[2]], l = Math.hypot(...toTarget);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.direction[i] - toTarget[i] / l) < 1e-9);
  const up = rayFor(s, target, 27, 1.5, 0, 1), right = rayFor(s, target, 27, 1.5, 1, 0);
  assert.ok(up.direction[1] > c.direction[1], 'the top of the picture looks higher');
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const side = cross(c.direction, [0, 1, 0]), dot = right.direction.reduce((t, v, i) => t + (v - c.direction[i]) * side[i], 0);
  assert.ok(dot > 0, 'the right of the picture is to the right of the view direction');
  for (const r of [c, up, right, rayFor(s, target, NaN, NaN, NaN, NaN)]) assert.ok(Math.abs(Math.hypot(...r.direction) - 1) < 1e-9 && r.direction.every(Number.isFinite));
});

// ---- controller ----
function rig(extra = {}) {
  const listeners = {}, changes = [], queue = [];
  const element = { style: {}, clientWidth: 400, clientHeight: 800, addEventListener(t, f) { (listeners[t] ??= []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
    setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }) };
  const keys = { l: [], addEventListener(t, f) { this.l.push(f); }, removeEventListener() {} };
  let clock = 1000;
  const cam = createCameraController({ element, home: { azimuth: 35, polar: 50, distance: 10 }, target, fov: 27, keys, now: () => clock, request: (f) => queue.push(f),
    onChange: (s, src) => changes.push([src, s.azimuth]), onGesture: () => { rig.gestures++; }, ...extra });
  const fire = (type, e) => { for (const f of listeners[type] ?? []) f({ preventDefault() {}, pointerType: 'touch', button: 0, pointerId: 1, ...e }); };
  const tick = (ms) => { clock += ms; };
  const frames = (max = 200) => { let k = 0; while (queue.length && k++ < max) { const f = queue.shift(); clock += 16; f(clock); } return k; };
  return { cam, element, listeners, fire, tick, frames, changes, queue, keys, get clock() { return clock; } };
}
rig.gestures = 0;

test('controller: a drag turns the model, the picture is asked for, and nothing runs at rest', () => {
  const r = rig();
  assert.equal(r.element.style.touchAction, 'none');
  r.fire('pointerdown', { clientX: 100, clientY: 300 });
  r.tick(30); r.fire('pointermove', { clientX: 160, clientY: 300 });
  assert.equal(Math.round(r.cam.state.azimuth), 5, '60 px on a 400 px wide canvas is 30 degrees');
  r.tick(400); r.fire('pointerup', { clientX: 160, clientY: 300 });
  assert.ok(r.changes.length >= 1 && r.changes.every((c) => c[0] === 'user'));
  assert.equal(r.queue.length, 0, 'a slow release starts no animation');
  assert.equal(r.cam.busy, false);
  const before = r.changes.length; r.frames(); assert.equal(r.changes.length, before, 'zero frames at rest');
});

test('controller: a fast flick keeps turning for a moment and then stops by itself', () => {
  const r = rig();
  r.fire('pointerdown', { clientX: 100, clientY: 300 });
  for (let k = 1; k <= 4; k++) { r.tick(10); r.fire('pointermove', { clientX: 100 + 20 * k, clientY: 300 }); }
  const turned = r.cam.state.azimuth;
  r.tick(10); r.fire('pointerup', { clientX: 180, clientY: 300 });
  assert.equal(r.queue.length, 1, 'the flick asks for an animation frame');
  const n = r.frames();
  assert.ok(n > 3 && n < 120, `${n} frames`);
  assert.ok(r.cam.state.azimuth < turned, 'it kept turning in the same direction');
  assert.equal(r.queue.length, 0); assert.equal(r.cam.busy, false);
});

test('controller: two fingers zoom within the limits, the wheel zooms, keys turn by 15 degrees', () => {
  const r = rig(); const d0 = r.cam.state.distance;
  r.fire('pointerdown', { pointerId: 1, clientX: 150, clientY: 400 }); r.fire('pointerdown', { pointerId: 2, clientX: 250, clientY: 400 });
  r.fire('pointermove', { pointerId: 2, clientX: 350, clientY: 400 });
  assert.ok(r.cam.state.distance < d0, 'spreading the fingers brings the camera nearer');
  r.fire('pointerup', { pointerId: 2 }); r.fire('pointerup', { pointerId: 1 });
  for (let i = 0; i < 40; i++) r.fire('wheel', { deltaY: 400, deltaMode: 0 });
  assert.ok(Math.abs(r.cam.state.distance - 10 * ZOOM_MAX) < 1e-9, 'the wheel stops at the far limit');
  r.cam.reset(false);
  const a0 = r.cam.state.azimuth;
  for (const f of r.keys.l) f({ key: 'ArrowLeft', target: { tagName: 'BODY' }, preventDefault() {} });
  assert.equal(Math.round(wrapDegrees(r.cam.state.azimuth - a0)), 15);
  for (const f of r.keys.l) f({ key: 'ArrowRight', shiftKey: true, target: { tagName: 'BODY' }, preventDefault() {} });
  assert.equal(Math.round(wrapDegrees(r.cam.state.azimuth - a0)), 15, 'Shift + arrow is left to the page (time of day)');
  for (const f of r.keys.l) f({ key: 'ArrowRight', target: { tagName: 'INPUT' }, preventDefault() {} });
  assert.equal(Math.round(wrapDegrees(r.cam.state.azimuth - a0)), 15, 'arrows inside a form control belong to the control');
});

test('controller: a double tap goes back to the home view in 400 ms; a disabled camera ignores input', () => {
  const r = rig();
  r.cam.set({ azimuth: 200, polar: 30, distance: 5 });
  r.fire('pointerdown', { clientX: 200, clientY: 400 }); r.tick(60); r.fire('pointerup', { clientX: 200, clientY: 400 });
  r.tick(120);
  r.fire('pointerdown', { clientX: 204, clientY: 402 }); r.tick(60); r.fire('pointerup', { clientX: 204, clientY: 402 });
  assert.equal(r.queue.length, 1, 'the reset animation is queued');
  const t0 = r.clock; let last = r.cam.state.azimuth, steps = 0;
  while (r.queue.length && steps++ < 100) { r.frames(1); assert.ok(r.cam.state.azimuth !== undefined && Number.isFinite(r.cam.state.azimuth)); }
  assert.ok(r.clock - t0 >= 400 - 16 && r.clock - t0 < 400 + 64, `took ${r.clock - t0} ms`);
  assert.equal(r.cam.state.azimuth, 35); assert.equal(r.cam.state.polar, 50); assert.equal(r.cam.state.distance, 10);
  assert.equal(r.queue.length, 0);
  assert.notEqual(last, 35);
  r.cam.enabled = false; const n = r.changes.length;
  r.fire('pointerdown', { clientX: 100, clientY: 300 }); r.tick(20); r.fire('pointermove', { clientX: 200, clientY: 300 });
  r.fire('wheel', { deltaY: 100 }); for (const f of r.keys.l) f({ key: 'ArrowLeft', target: { tagName: 'BODY' }, preventDefault() {} });
  assert.equal(r.changes.length, n, 'nothing changes while the camera is disabled');
});

test('controller: pointerToRay gives a finite unit ray through the touched point, and rehome keeps the turn', () => {
  const r = rig();
  const ray = r.cam.pointerToRay({ clientX: 200, clientY: 400 });
  assert.ok(ray.origin.every(Number.isFinite) && Math.abs(Math.hypot(...ray.direction) - 1) < 1e-9);
  const toTarget = target.map((v, i) => v - ray.origin[i]), l = Math.hypot(...toTarget);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(ray.direction[i] - toTarget[i] / l) < 1e-9, 'the middle of the canvas looks at the target');
  r.cam.set({ azimuth: 120, distance: 15 });
  r.cam.rehome({ azimuth: 35, polar: 50, distance: 20 });
  assert.equal(r.cam.state.azimuth, 120); assert.ok(Math.abs(r.cam.state.distance - 20 * 1.5) < 1e-9, 'the zoom keeps its ratio to the new default');
  assert.equal(r.cam.home.distance, 20);
});
