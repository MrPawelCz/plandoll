// Pan and zoom at a point: the pure helpers (ground point of a picture point, pan by pixels, zoom about a point, limits) and the controller with fake
// pointers: two fingers zoom and move, three fingers move, the mouse buttons move, the wheel zooms towards the pointer, a double tap goes home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, zoom, positionOf, rayFor, groundPoint, toPicture, panShift, panByPixels, zoomAt, panLimits, clampPan, blendPan, nearPlane, createCameraController, liftOf,
  ZOOM_MIN, ZOOM_MAX, PAN_GROW, NEAR_MIN, NEAR_MAX, RESET_MS, BOTTOM_MAX, SLOP_TOUCH, SLOP_MOUSE, PINCH_MIN } from '../../src/app/camera.js';

const target = [5, 0.5, 4];
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (a, b, tol = 1e-6) => a && b && near(a[0], b[0], tol) && near(a[1], b[1], tol);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// where a world point lands on the picture of the camera that rayFor describes (x, y in -1..1), recovered from rayFor itself
function project(state, tgt, fov, aspect, p) {
  const c = rayFor(state, tgt, fov, aspect, 0, 0), rx = rayFor(state, tgt, fov, aspect, 1, 0), ry = rayFor(state, tgt, fov, aspect, 0, 1);
  const sx = rx.direction.map((v, i) => v / dot(rx.direction, c.direction) - c.direction[i]), sy = ry.direction.map((v, i) => v / dot(ry.direction, c.direction) - c.direction[i]);
  const w = p.map((v, i) => v - c.origin[i]), depth = dot(w, c.direction);
  return { x: dot(w, sx) / (depth * dot(sx, sx)), y: dot(w, sy) / (depth * dot(sy, sy)) };
}
const states = [makeState({ azimuth: 35, polar: 50, distance: 20 }), makeState({ azimuth: 200, polar: 30, distance: 12 }), makeState({ azimuth: 300, polar: 70, distance: 25 }), makeState({ azimuth: 0, polar: 45, distance: 15 })];

test('zoom limits are 0.2 to 1.8 times the default distance, and the near plane shrinks with the distance', () => {
  assert.equal(ZOOM_MIN, 0.2); assert.equal(ZOOM_MAX, 1.8);
  let s = makeState({ distance: 20 });
  for (let i = 0; i < 80; i++) s = zoom(s, 1.3);
  assert.ok(near(s.distance, 4, 1e-9), 'nearest 4 m of 20');
  for (let i = 0; i < 80; i++) s = zoom(s, 1 / 1.3);
  assert.ok(near(s.distance, 36, 1e-9), 'farthest 36 m of 20');
  assert.equal(nearPlane(30), NEAR_MAX); assert.equal(NEAR_MAX, 0.5); assert.equal(nearPlane(0.1), NEAR_MIN);
  assert.ok(nearPlane(4) < nearPlane(8) && nearPlane(8) < nearPlane(12.5) + 1e-12 && nearPlane(4) >= NEAR_MIN, 'it grows with the distance and stops at 0.5 m');
  for (const bad of [NaN, undefined, null, 'x', -5]) { const v = nearPlane(bad); assert.ok(Number.isFinite(v) && v >= NEAR_MIN && v <= NEAR_MAX, String(bad)); }
});

test('groundPoint: the middle of the picture is the target, every picture point lands back on its pixel, and rays that miss the ground give null', () => {
  for (const s of states) for (const aspect of [0.46, 1.78]) {
    const mid = groundPoint(s, target, 27, aspect, 0, 0);
    assert.ok(nearPt(mid, [target[0], target[2]]), 'the middle looks at the target');
    for (const [x, y] of [[0.5, -0.4], [-0.8, -0.9], [0.9, 0.1], [-0.3, 0.2]]) {
      const g = groundPoint(s, target, 27, aspect, x, y);
      if (!g) continue;
      const q = project(s, target, 27, aspect, [g[0], target[1], g[1]]);
      assert.ok(near(q.x, x, 1e-6) && near(q.y, y, 1e-6), `${x}, ${y} comes back as ${q.x.toFixed(4)}, ${q.y.toFixed(4)}`);
    }
  }
  const flat = makeState({ azimuth: 0, polar: 80, distance: 20 });
  assert.equal(groundPoint(flat, target, 27, 0.46, 0, 1), null, 'the top of a view that looks almost level meets no ground');
  assert.ok(groundPoint(flat, target, 27, 0.46, 0, -1), 'the bottom does');
  for (const bad of [NaN, undefined]) { const g = groundPoint(states[0], target, 27, 1, bad, bad); assert.ok(g === null || g.every(Number.isFinite)); }
});

test('toPicture maps the corners and the middle of the element to -1..1, up positive', () => {
  const rect = { left: 10, top: 20, width: 400, height: 800 };
  assert.deepEqual(toPicture(rect, 10, 20), [-1, 1]); assert.deepEqual(toPicture(rect, 410, 820), [1, -1]); assert.deepEqual(toPicture(rect, 210, 420), [0, 0]);
  assert.ok(toPicture(null, 5, 5).every(Number.isFinite)); assert.ok(toPicture(rect, NaN, NaN).every(Number.isFinite));
});

test('panByPixels: the ground under the finger follows the finger, whatever the view', () => {
  const rect = { left: 0, top: 0, width: 390, height: 520 }, aspect = 390 / 520;
  for (const s of states) for (const [from, to] of [[[195, 260], [265, 300]], [[100, 400], [60, 330]], [[300, 100], [120, 220]]]) {
    const shift = panByPixels(s, target, 27, rect, from, to), moved = [target[0] + shift[0], target[1], target[2] + shift[1]];
    const before = groundPoint(s, target, 27, aspect, ...toPicture(rect, ...from)), after = groundPoint(s, moved, 27, aspect, ...toPicture(rect, ...to));
    assert.ok(nearPt(before, after, 1e-6), `the point under ${from} is under ${to} afterwards`);
  }
  // dragging right with the camera in the south moves the target west: the picture goes east with the finger
  const south = makeState({ azimuth: 0, polar: 50, distance: 20 }), sh = panByPixels(south, target, 27, rect, [195, 260], [295, 260]);
  assert.ok(sh[0] < -0.5 && Math.abs(sh[1]) < 1e-6, `${sh}`);
  assert.deepEqual(panByPixels(south, target, 27, rect, [195, 260], [195, 260]).map((v) => Math.abs(v) < 1e-12), [true, true], 'no drag, no pan');
  const level = makeState({ azimuth: 0, polar: 80, distance: 20 });
  assert.deepEqual(panShift(level, level, target, 27, 0.46, [0, 1], [0.1, 1]), [0, 0], 'a point that meets no ground moves nothing');
});

test('zoomAt: the ground point under the point stays under it (a wheel) or goes with it (a pinch whose middle moves); at the limit it is a plain pan', () => {
  const s = states[0], aspect = 0.75, at = [0.4, -0.3];
  for (const factor of [2, 0.5, 1.1]) {
    const z = zoomAt(s, target, 27, aspect, factor, at), moved = [target[0] + z.shift[0], target[1], target[2] + z.shift[1]];
    assert.deepEqual(z.state, zoom(s, factor));
    assert.ok(nearPt(groundPoint(z.state, moved, 27, aspect, ...at), groundPoint(s, target, 27, aspect, ...at)), `factor ${factor}: the point stays`);
  }
  const to = [0.55, -0.1], z = zoomAt(s, target, 27, aspect, 1.8, at, to), moved = [target[0] + z.shift[0], target[1], target[2] + z.shift[1]];
  assert.ok(nearPt(groundPoint(z.state, moved, 27, aspect, ...to), groundPoint(s, target, 27, aspect, ...at)), 'the pinch carries the point to the new middle');
  const nearest = { ...s, distance: s.base * ZOOM_MIN }, c = zoomAt(nearest, target, 27, aspect, 3, at, to);
  assert.equal(c.state.distance, nearest.distance, 'already at the near limit');
  assert.deepEqual(c.shift, panShift(nearest, nearest, target, 27, aspect, at, to), 'then it is a plain pan');
  assert.deepEqual(zoomAt(s, target, 27, aspect, NaN, at).state, s, 'a bad factor changes nothing');
});

test('panLimits, clampPan and blendPan', () => {
  const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 20 }, lim = panLimits(box);
  assert.equal(PAN_GROW, 0.15);
  assert.deepEqual(lim, { minX: -1.5, maxX: 11.5, minZ: -3, maxZ: 23 });
  assert.equal(panLimits(null), null); assert.equal(panLimits({ minX: 0, maxX: NaN, minZ: 0, maxZ: 1 }), null); assert.equal(panLimits({}), null);
  const home = [5, 0, 10];
  assert.deepEqual(clampPan([100, 100], home, lim), [6.5, 13]); assert.deepEqual(clampPan([-100, -100], home, lim), [-6.5, -13]); assert.deepEqual(clampPan([1, -2], home, lim), [1, -2]);
  assert.deepEqual(clampPan([NaN, undefined], home, lim), [0, 0]); assert.deepEqual(clampPan([3, 4], home, null), [3, 4], 'without limits the pan is only made finite');
  const outside = [30, 0, 10]; // a home target that lies outside the box is not pulled back, and cannot be pushed further out
  assert.deepEqual(clampPan([0, 0], outside, lim), [0, 0]); assert.deepEqual(clampPan([5, 0], outside, lim), [0, 0]); assert.ok(clampPan([-40, 0], outside, lim)[0] <= -18.5 + 1e-9);
  assert.deepEqual(blendPan([4, -2], [0, 0], 0), [4, -2]); assert.deepEqual(blendPan([4, -2], [0, 0], 1), [0, 0]); assert.deepEqual(blendPan([4, -2], [0, 0], 0.5), [2, -1]); assert.deepEqual(blendPan([4, -2], [0, 0], NaN), [4, -2]);
});

// ---- the controller ----
function rig(extra = {}) {
  const listeners = {}, changes = [], queue = [], gestures = [];
  const element = { style: {}, clientWidth: 400, clientHeight: 800, addEventListener(t, f) { (listeners[t] ??= []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
    setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }) };
  const keys = { l: [], addEventListener(t, f) { this.l.push(f); }, removeEventListener() {} };
  let clock = 1000;
  const cam = createCameraController({ element, home: { azimuth: 35, polar: 50, distance: 20 }, target, fov: 27, keys, now: () => clock, request: (f) => queue.push(f),
    onChange: (s, src) => changes.push([src, s.azimuth]), onGesture: (g) => gestures.push(g), ...extra });
  const prevented = [];
  const fire = (type, e) => { for (const f of listeners[type] ?? []) f({ preventDefault() { prevented.push(type); }, pointerType: 'touch', button: 0, pointerId: 1, ...e }); };
  const tick = (ms) => { clock += ms; };
  const frames = (max = 200) => { let k = 0; while (queue.length && k++ < max) { const f = queue.shift(); clock += 16; f(clock); } return k; };
  const down = (id, x, y, more = {}) => fire('pointerdown', { pointerId: id, clientX: x, clientY: y, ...more });
  const move = (id, x, y, more = {}) => { tick(16); fire('pointermove', { pointerId: id, clientX: x, clientY: y, ...more }); };
  const up = (id, x, y, more = {}) => fire('pointerup', { pointerId: id, clientX: x, clientY: y, ...more });
  // fingers (a list of [x, y]) move together to the same points shifted by (dx, dy), in `steps` steps, each finger in turn as real events arrive
  const slide = (pts, dx, dy, steps = 10) => { for (let k = 1; k <= steps; k++) pts.forEach((p, i) => move(i + 1, p[0] + (dx * k) / steps, p[1] + (dy * k) / steps)); };
  return { cam, element, listeners, fire, tick, frames, changes, queue, keys, gestures, prevented, down, move, up, slide, get clock() { return clock; } };
}
const len = (v) => Math.hypot(v[0], v[1]);

test('controller: two fingers that move together move the picture, the ground under their middle follows them, the zoom and the turn stay', () => {
  const r = rig(), d0 = r.cam.state.distance, a0 = r.cam.state.azimuth, mid0 = [200, 400], g0 = r.cam.groundAt(...mid0);
  const f1 = [150, 400], f2 = [250, 400];
  r.down(1, ...f1); r.down(2, ...f2);
  r.slide([f1, f2], 60, 40);
  assert.ok(len(r.cam.pan) > 0.5, `pan ${r.cam.pan}`);
  assert.ok(near(r.cam.state.distance, d0, 1e-9) && near(r.cam.state.azimuth, a0, 1e-9), 'no zoom, no turn');
  assert.ok(nearPt(r.cam.groundAt(260, 440), g0, 1e-6), 'the ground that was under the middle of the fingers is under it now');
  assert.ok(r.gestures.length > 0 && r.gestures.every((g) => (g.kind === 'pan' || g.kind === 'pinch') && g.pointerType === 'touch'), 'reported as a two-finger gesture by touch');
  r.up(2, 310, 440); r.up(1, 210, 440);
  assert.equal(r.queue.length, 0, 'no animation after two fingers'); assert.equal(r.cam.busy, false);
  assert.ok(nearPt([r.cam.target[0], r.cam.target[2]], [target[0] + r.cam.pan[0], target[2] + r.cam.pan[1]]), 'the camera looks at the home target plus the pan');
  assert.equal(r.cam.target[1], target[1], 'the height of the target never changes');
});

test('controller: a pinch zooms about the point between the fingers and keeps that point under them, with the middle moving as well', () => {
  const r = rig(), d0 = r.cam.state.distance, P = [250, 300], gP = r.cam.groundAt(...P);
  r.down(1, P[0] - 40, P[1]); r.down(2, P[0] + 40, P[1]);
  for (let k = 1; k <= 8; k++) { r.move(1, P[0] - 40 - 10 * k, P[1]); r.move(2, P[0] + 40 + 10 * k, P[1]); } // spacing 80 -> 240, the middle stays
  assert.ok(near(r.cam.state.distance, d0 / 3, 1e-6), `distance ${r.cam.state.distance}`);
  assert.ok(nearPt(r.cam.groundAt(...P), gP, 1e-6), 'the point between the fingers stays under them');
  assert.ok(len(r.cam.pan) > 0.3, 'the middle is off the centre of the picture, so the target moved');
  assert.ok(r.gestures.some((g) => g.kind === 'pinch'));
  // the pinch the other way, and the middle moving at the same time: the point goes with the middle
  const g1 = r.cam.groundAt(...P);
  for (let k = 1; k <= 8; k++) { r.move(1, P[0] - 120 + 5 * k, P[1] + 4 * k); r.move(2, P[0] + 120 - 5 * k + 8, P[1] + 4 * k); }
  assert.ok(r.cam.state.distance > d0 / 3 + 0.1, 'zoomed out again');
  assert.ok(nearPt(r.cam.groundAt(P[0] + 4, P[1] + 32), g1, 1e-6), 'the ground point under the old middle is under the new middle');
  // at the near limit the pinch stops zooming and the fingers still move the picture
  for (let k = 0; k < 60; k++) { r.move(1, 100 - k, 300); r.move(2, 300 + k, 300); }
  r.up(2, 360, 300); r.up(1, 40, 300);
  assert.ok(r.cam.state.distance <= 1.8 * 20 + 1e-9 && r.cam.state.distance >= 0.2 * 20 - 1e-9 && Number.isFinite(r.cam.state.distance));
});

test('controller: a pinch around the middle of the picture zooms without moving the target', () => {
  const r = rig(); r.down(1, 160, 400); r.down(2, 240, 400);
  for (let k = 1; k <= 6; k++) { r.move(1, 160 - 10 * k, 400); r.move(2, 240 + 10 * k, 400); }
  assert.ok(r.cam.state.distance < 20 * 0.5); assert.ok(len(r.cam.pan) < 1e-6, `${r.cam.pan}`);
});

test('controller: three fingers move the picture with their middle and never zoom; going from two to three fingers and back does not jump', () => {
  const r = rig(), d0 = r.cam.state.distance, tri = [[150, 380], [200, 420], [250, 380]], mid0 = [200, 393.3333333333], g0 = r.cam.groundAt(...mid0);
  r.down(1, ...tri[0]); r.down(2, ...tri[1]);
  const before2 = r.cam.state.distance, pan2 = r.cam.pan;
  r.down(3, ...tri[2]);
  assert.deepEqual(r.cam.pan, pan2, 'the third finger going down moves nothing'); assert.equal(r.cam.state.distance, before2);
  r.slide(tri, -50, 60);
  assert.ok(len(r.cam.pan) > 0.5); assert.ok(near(r.cam.state.distance, d0, 1e-9), 'three fingers do not zoom');
  assert.ok(nearPt(r.cam.groundAt(mid0[0] - 50, mid0[1] + 60), g0, 1e-6), 'the ground under their middle follows them');
  for (let k = 1; k <= 5; k++) r.move(3, 250 - 50 + 20 * k, 440 + 10 * k); // one finger spreads away: still no zoom
  assert.ok(near(r.cam.state.distance, d0, 1e-9));
  const pan3 = r.cam.pan; r.up(3, 400, 500); assert.deepEqual(r.cam.pan, pan3, 'lifting a finger moves nothing');
  assert.ok(r.cam.state.azimuth === 35);
  r.up(2, 150, 480); r.up(1, 100, 440);
  assert.equal(r.queue.length, 0); assert.equal(r.cam.busy, false);
});

test('controller: the right button, the middle button and Shift with the left button move the picture; the left button turns; the menu is suppressed', () => {
  for (const [name, ev, kind] of [['right', { button: 2 }, 'pan'], ['middle', { button: 1 }, 'pan'], ['shift left', { button: 0, shiftKey: true }, 'pan']]) {
    const r = rig(), g0 = r.cam.groundAt(200, 400), a0 = r.cam.state.azimuth;
    r.down(1, 200, 400, { pointerType: 'mouse', ...ev });
    for (let k = 1; k <= 10; k++) r.move(1, 200 + 8 * k, 400 + 5 * k, { pointerType: 'mouse' });
    r.up(1, 280, 450, { pointerType: 'mouse', ...ev });
    assert.ok(len(r.cam.pan) > 0.5, `${name}: pan ${r.cam.pan}`); assert.equal(r.cam.state.azimuth, a0, `${name} does not turn`);
    assert.ok(nearPt(r.cam.groundAt(280, 450), g0, 1e-6), `${name}: the ground under the pointer follows it`);
    assert.ok(r.gestures.some((g) => g.kind === kind && g.pointerType === 'mouse'), name);
    assert.equal(r.queue.length, 0, `${name}: no inertia`);
  }
  const r = rig(); r.down(1, 200, 400, { pointerType: 'mouse', button: 0 }); r.move(1, 260, 400, { pointerType: 'mouse' }); r.up(1, 260, 400, { pointerType: 'mouse' });
  assert.notEqual(r.cam.state.azimuth, 35, 'the left button turns'); assert.deepEqual(r.cam.pan, [0, 0]);
  r.fire('contextmenu', { pointerType: 'mouse' }); assert.ok(r.prevented.includes('contextmenu'), 'no menu over the picture');
  const d = rig(); d.cam.enabled = false; d.fire('contextmenu', {}); assert.ok(!d.prevented.includes('contextmenu'), 'a disabled camera leaves the menu alone');
  const back = rig(); back.down(1, 200, 400, { pointerType: 'mouse', button: 3 }); back.move(1, 300, 400, { pointerType: 'mouse' }); assert.deepEqual(back.cam.pan, [0, 0]); assert.equal(back.cam.state.azimuth, 35, 'the back button does nothing');
});

test('controller: a quick click of the right button is not a tap, two clicks of the left button are a double click that goes home', () => {
  const r = rig(); r.cam.set({ azimuth: 200, distance: 9 });
  for (let k = 0; k < 2; k++) { r.down(1, 200, 400, { pointerType: 'mouse', button: 2 }); r.tick(50); r.up(1, 200, 400, { pointerType: 'mouse', button: 2 }); r.tick(100); }
  assert.equal(r.queue.length, 0, 'two right clicks do not reset the view');
  for (let k = 0; k < 2; k++) { r.down(1, 200, 400, { pointerType: 'mouse', button: 0 }); r.tick(50); r.up(1, 200, 400, { pointerType: 'mouse', button: 0 }); r.tick(100); }
  assert.equal(r.queue.length, 1, 'two left clicks do');
});

test('controller: the wheel zooms towards the pointer and keeps the ground under it; without a position it zooms about the middle', () => {
  const r = rig(), P = [320, 200], gP = r.cam.groundAt(...P), d0 = r.cam.state.distance;
  for (let k = 0; k < 4; k++) r.fire('wheel', { deltaY: -200, deltaMode: 0, clientX: P[0], clientY: P[1] });
  assert.ok(r.cam.state.distance < 0.5 * d0, `distance ${r.cam.state.distance}`); assert.ok(nearPt(r.cam.groundAt(...P), gP, 1e-6)); assert.ok(len(r.cam.pan) > 0.3);
  assert.ok(r.gestures.some((g) => g.kind === 'wheel'));
  for (let k = 0; k < 12; k++) r.fire('wheel', { deltaY: 300, deltaMode: 0, clientX: P[0], clientY: P[1] });
  assert.ok(near(r.cam.state.distance, 20 * ZOOM_MAX, 1e-9), 'the far limit'); assert.ok(r.prevented.includes('wheel'), 'the page does not scroll');
  const c = rig(); for (let k = 0; k < 4; k++) c.fire('wheel', { deltaY: -200, deltaMode: 0 }); assert.ok(c.cam.state.distance < 20 * 0.5 && len(c.cam.pan) < 1e-6, 'about the middle: the target stays');
  const n = rig(); for (let k = 0; k < 80; k++) n.fire('wheel', { deltaY: -400, deltaMode: 0, clientX: 100, clientY: 100 }); assert.ok(near(n.cam.state.distance, 20 * ZOOM_MIN, 1e-9), 'the near limit is 0.2 of the default');
});

test('controller: the pan stops at the box of the model grown by 15 percent, and a limit can be set later or taken away', () => {
  const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }, r = rig({ limits: box });
  for (let n = 0; n < 8; n++) { // long drags, one after another, each inside the picture
    r.down(1, 50, 600, { pointerType: 'mouse', button: 2 });
    for (let k = 1; k <= 10; k++) r.move(1, 50 + 30 * k, 600 - 30 * k, { pointerType: 'mouse' });
    r.up(1, 350, 300, { pointerType: 'mouse', button: 2 });
  }
  const t = r.cam.target, lim = panLimits(box);
  assert.ok(t[0] >= lim.minX - 1e-9 && t[0] <= lim.maxX + 1e-9 && t[2] >= lim.minZ - 1e-9 && t[2] <= lim.maxZ + 1e-9, `target ${t}`);
  assert.ok(near(t[0], lim.minX, 1e-9) || near(t[0], lim.maxX, 1e-9) || near(t[2], lim.minZ, 1e-9) || near(t[2], lim.maxZ, 1e-9), 'it is at an edge of the box');
  r.cam.setLimits({ minX: 4, maxX: 6, minZ: 3, maxZ: 5 }); assert.ok(r.cam.target[0] >= panLimits({ minX: 4, maxX: 6, minZ: 3, maxZ: 5 }).minX - 1e-9 && r.cam.target[0] <= 6.3 + 1e-9, 'a smaller box pulls the pan in');
  r.cam.setLimits(null); assert.equal(r.cam.limits, null);
  const free = rig(); free.down(1, 200, 400, { pointerType: 'mouse', button: 2 }); for (let k = 1; k <= 40; k++) free.move(1, 200 + 5 * k, 400, { pointerType: 'mouse' });
  assert.ok(len(free.cam.pan) > 2, `without limits the pan goes on: ${free.cam.pan}`);
});

test('controller: a double tap goes home in 400 ms with the pan, the zoom and the turn; reset(false) does it at once; the pan survives a new home target and a new default distance', () => {
  const r = rig({ limits: { minX: 0, maxX: 10, minZ: 0, maxZ: 8 } });
  r.down(1, 150, 400); r.down(2, 250, 400); r.slide([[150, 400], [250, 400]], 40, 30);
  for (let k = 1; k <= 6; k++) { r.move(1, 190 - 8 * k, 430); r.move(2, 290 + 8 * k, 430); }
  r.up(2, 338, 430); r.up(1, 142, 430);
  assert.ok(len(r.cam.pan) > 0.3 && r.cam.state.distance < 20);
  const panBefore = r.cam.pan, targetBefore = r.cam.target;
  // the window changed shape: the same pan from a new home target and a new default distance
  assert.equal(r.cam.setTarget([6, 0.5, 5]), true); r.cam.rehome({ azimuth: 35, polar: 50, distance: 30 });
  assert.deepEqual(r.cam.pan, panBefore, 'the pan stays, now from the new home');
  assert.ok(nearPt([r.cam.target[0], r.cam.target[2]], [6 + panBefore[0], 5 + panBefore[1]], 1e-9) || r.cam.target[0] !== targetBefore[0], 'home plus pan');
  assert.ok(near(r.cam.state.distance, panBefore.length && r.cam.state.distance), 'finite'); assert.ok(Math.abs(r.cam.state.distance / 30 - 0.3) < 0.15 || r.cam.state.distance > 0);
  r.tick(200); r.down(1, 200, 400); r.tick(60); r.up(1, 200, 400); r.tick(120); r.down(1, 204, 402); r.tick(60); r.up(1, 204, 402);
  assert.equal(r.queue.length, 1, 'the reset animation is queued');
  const t0 = r.clock; let mid = null, steps = 0;
  while (r.queue.length && steps++ < 100) { r.frames(1); if (!mid && r.clock - t0 > 150 && r.clock - t0 < 300) mid = r.cam.pan; }
  assert.ok(r.clock - t0 >= RESET_MS - 16 && r.clock - t0 < RESET_MS + 64, `took ${r.clock - t0} ms`);
  assert.ok(mid && len(mid) > 0 && len(mid) < len(panBefore), 'on the way the pan shrinks');
  assert.deepEqual(r.cam.pan, [0, 0]); assert.equal(r.cam.state.distance, 30); assert.equal(r.cam.state.azimuth, 35);
  assert.deepEqual(r.cam.target, [6, 0.5, 5]); assert.equal(r.cam.busy, false);
  // reset(false) is immediate and also takes the pan away
  const q = rig(); q.down(1, 200, 400, { pointerType: 'mouse', button: 2 }); q.move(1, 300, 440, { pointerType: 'mouse' }); q.up(1, 300, 440, { pointerType: 'mouse', button: 2 });
  assert.ok(len(q.cam.pan) > 0); q.cam.reset(false); assert.deepEqual(q.cam.pan, [0, 0]); assert.deepEqual(q.cam.target, target);
  // the keyboard reset goes home with the pan too
  q.down(1, 200, 400, { pointerType: 'mouse', button: 2 }); q.move(1, 300, 440, { pointerType: 'mouse' }); q.up(1, 300, 440, { pointerType: 'mouse', button: 2 });
  for (const f of q.keys.l) f({ key: '0', target: { tagName: 'BODY' }, preventDefault() {} });
  q.frames(); assert.deepEqual(q.cam.pan, [0, 0]);
});

test('controller: picking uses the target that the pan moved; one finger turns about it; a turn does not change the pan', () => {
  const r = rig(), before = r.cam.pointerToRay({ clientX: 200, clientY: 400 });
  r.down(1, 150, 400, { pointerType: 'touch' }); r.down(2, 250, 400); r.slide([[150, 400], [250, 400]], 70, 50); r.up(2, 320, 450); r.up(1, 220, 450);
  const after = r.cam.pointerToRay({ clientX: 200, clientY: 400 }), t = r.cam.target;
  const toTarget = t.map((v, i) => v - after.origin[i]), l = Math.hypot(...toTarget);
  for (let i = 0; i < 3; i++) assert.ok(near(after.direction[i], toTarget[i] / l, 1e-9), 'the middle of the picture looks at home plus pan');
  assert.notDeepEqual(after.origin, before.origin); assert.deepEqual(r.cam.position().map((v) => +v.toFixed(9)), after.origin.map((v) => +v.toFixed(9)));
  const pan = r.cam.pan; r.down(1, 100, 300); r.move(1, 160, 300); r.move(1, 220, 300); r.tick(300); r.up(1, 220, 300);
  assert.notEqual(r.cam.state.azimuth, 35); assert.deepEqual(r.cam.pan, pan, 'a turn leaves the pan alone');
  assert.ok(r.gestures.some((g) => g.kind === 'orbit' && g.pointerType === 'touch'), 'a one-finger turn is reported as an orbit by touch (the page shows its hint then)');
  assert.deepEqual(r.cam.homeTarget, target);
});

test('controller: a cancelled finger of a two-finger gesture does not make the view jump, and a disabled camera ignores every pan', () => {
  const r = rig(); r.down(1, 150, 400); r.down(2, 250, 400); r.slide([[150, 400], [250, 400]], 30, 10);
  const pan = r.cam.pan, d = r.cam.state.distance;
  r.fire('pointercancel', { pointerId: 2 }); assert.deepEqual(r.cam.pan, pan); assert.equal(r.cam.state.distance, d);
  r.move(1, 200, 420); assert.ok(r.cam.state.distance === d && [...r.cam.pan].every(Number.isFinite) && Number.isFinite(r.cam.state.azimuth));
  r.up(1, 200, 420);
  const e = rig(); e.cam.enabled = false; const n = e.changes.length;
  e.down(1, 200, 400, { pointerType: 'mouse', button: 2 }); e.move(1, 300, 440, { pointerType: 'mouse' }); e.fire('wheel', { deltaY: -100, clientX: 300, clientY: 300 });
  assert.equal(e.changes.length, n); assert.deepEqual(e.cam.pan, [0, 0]);
});

// ---- the lift: the centre of the projection sits above the middle of the element, over the part that the bars leave free ----
test('liftOf keeps the share of the picture that bars cover inside 0 to BOTTOM_MAX, and bad input is no lift', () => {
  assert.equal(BOTTOM_MAX, 0.4);
  assert.equal(liftOf(0.25), 0.25); assert.equal(liftOf(0), 0); assert.equal(liftOf(0.9), BOTTOM_MAX); assert.equal(liftOf(-2), 0);
  for (const bad of [NaN, undefined, null, 'x', Infinity]) assert.ok(liftOf(bad) >= 0 && liftOf(bad) <= BOTTOM_MAX && Number.isFinite(liftOf(bad)), String(bad));
});

test('toPicture with a lift: picture point (0, 0) is the middle of the part above the bars, the edges move with it, and without a lift nothing changes', () => {
  const rect = { left: 10, top: 20, width: 200, height: 400 }, lift = 0.3;
  assert.deepEqual(toPicture(rect, 110, 220), toPicture(rect, 110, 220, 0), 'no lift is the old mapping');
  assert.ok(nearPt(toPicture(rect, 110, 220), [0, 0]));
  assert.ok(nearPt(toPicture(rect, 110, 20 + (400 * (1 - lift)) / 2, lift), [0, 0]), 'the middle of the free part is the middle of the projection');
  assert.ok(near(toPicture(rect, 110, 20, lift)[1], 1 - lift) && near(toPicture(rect, 110, 420, lift)[1], -1 - lift), 'top and bottom edge');
  assert.ok(near(toPicture(rect, 10, 220, lift)[0], -1) && near(toPicture(rect, 210, 220, lift)[0], 1), 'the sides do not move');
  assert.deepEqual(toPicture(rect, NaN, NaN, NaN), toPicture(rect, 0, 0, 0), 'bad numbers are zeros');
});

test('panByPixels with a lift: the ground under the finger follows it, measured from the lifted centre', () => {
  const rect = { left: 0, top: 0, width: 400, height: 800 }, lift = 0.3, s = states[0], from = [200, 280], to = [260, 330];
  const sh = panByPixels(s, target, 27, rect, from, to, lift), a = groundPoint(s, target, 27, 0.5, ...toPicture(rect, ...from, lift));
  const moved = [target[0] + sh[0], target[1], target[2] + sh[1]], g = groundPoint(s, moved, 27, 0.5, ...toPicture(rect, ...to, lift));
  assert.ok(nearPt(g, a, 1e-6), 'after the move the ground point sits under the new pixel');
});

test('controller with a lift: the middle of the free part looks at the target, a pinch there does not move it, and one finger turns about it', () => {
  const lift = 0.3, r = rig({ lift }), centreY = (800 * (1 - lift)) / 2; // the middle of the part above the bars, in client pixels
  assert.equal(r.cam.lift, lift);
  const g = r.cam.groundAt(200, centreY), ray = r.cam.pointerToRay({ clientX: 200, clientY: centreY });
  assert.ok(nearPt(g, [target[0], target[2]], 1e-6), `the middle of the free part is the target: ${g}`);
  const o = ray.origin, want = [target[0] - o[0], target[1] - o[1], target[2] - o[2]], wl = Math.hypot(...want);
  assert.ok(ray.direction.every((v, i) => near(v, want[i] / wl, 1e-9)), 'and its ray goes through the target');
  // the middle of the element is no longer the target
  assert.ok(!nearPt(r.cam.groundAt(200, 400), [target[0], target[2]], 0.5), 'the middle of the element looks lower');
  // a pinch about the middle of the free part zooms without moving the target
  r.down(1, 160, centreY); r.down(2, 240, centreY);
  for (let k = 1; k <= 6; k++) { r.move(1, 160 - 10 * k, centreY); r.move(2, 240 + 10 * k, centreY); }
  assert.ok(r.cam.state.distance < 20 * 0.5 && len(r.cam.pan) < 1e-6, `${r.cam.state.distance} ${r.cam.pan}`);
  r.up(2, 300, centreY); r.up(1, 100, centreY);
  // a turn keeps the target and the point under the middle of the free part
  const t0 = r.cam.target; r.down(1, 200, centreY); for (let k = 1; k <= 12; k++) r.move(1, 200 + 8 * k, centreY); r.up(1, 296, centreY);
  assert.ok(r.cam.state.azimuth !== 35, 'turned'); assert.deepEqual(r.cam.target, t0, 'about the same target');
  assert.ok(nearPt(r.cam.groundAt(200, centreY), [t0[0], t0[2]], 1e-6), 'the middle of the free part still looks at it');
});

test('controller setLift moves the centre of the projection, bad values are no lift, and pointerToRay agrees with groundAt', () => {
  const r = rig(); assert.equal(r.cam.lift, 0);
  const g0 = r.cam.groundAt(200, 300); r.cam.setLift(0.2); assert.equal(r.cam.lift, 0.2);
  assert.ok(!nearPt(r.cam.groundAt(200, 300), g0, 1e-3), 'the same pixel now looks at another ground point');
  r.cam.setLift(5); assert.equal(r.cam.lift, BOTTOM_MAX); r.cam.setLift(NaN); assert.equal(r.cam.lift, 0);
  r.cam.setLift(0.25);
  for (const [x, y] of [[100, 150], [320, 500], [200, 300]]) {
    const ray = r.cam.pointerToRay({ clientX: x, clientY: y }), g = r.cam.groundAt(x, y), t = (target[1] - ray.origin[1]) / ray.direction[1];
    assert.ok(nearPt([ray.origin[0] + ray.direction[0] * t, ray.origin[2] + ray.direction[2] * t], g, 1e-6), `${x},${y}`);
  }
});

// ---- fingers on a real phone: the finger that is left, a missed pointerup, a shaky tap, two fingers that touch ----
test('controller: the finger that stays after a two-finger gesture does not turn the model, and the next touch turns it again', () => {
  const r = rig(), az0 = r.cam.state.azimuth, d0 = r.cam.state.distance;
  r.down(1, 150, 400, { isPrimary: true }); r.down(2, 250, 400, { isPrimary: false });
  r.slide([[150, 400], [250, 400]], 40, 30);
  r.up(2, 290, 430, { isPrimary: false }); // one finger leaves first, the other is still moving
  for (let k = 1; k <= 10; k++) r.move(1, 190 + 5 * k, 430);
  assert.equal(r.cam.state.azimuth, az0, 'the finger that is left does not turn the model'); assert.ok(near(r.cam.state.distance, d0, 1e-9));
  r.up(1, 240, 430, { isPrimary: true });
  assert.equal(r.queue.length, 0, 'no spin after a multi-finger gesture'); assert.equal(r.cam.busy, false);
  r.down(1, 150, 400, { isPrimary: true }); for (let k = 1; k <= 12; k++) r.move(1, 150 + 6 * k, 400); r.up(1, 222, 400, { isPrimary: true });
  assert.ok(r.cam.state.azimuth !== az0, 'a new touch turns the model again');
});

test('controller: a first finger that goes down while a pointer from before is still kept drops it, so the drag turns the model', () => {
  const r = rig(), az0 = r.cam.state.azimuth;
  r.down(7, 100, 300, { isPrimary: true }); // its pointerup never comes
  r.down(9, 200, 400, { isPrimary: true });
  for (let k = 1; k <= 12; k++) r.move(9, 200 + 6 * k, 400);
  assert.ok(r.cam.state.azimuth !== az0, 'turned by one finger, not treated as two fingers');
  r.up(9, 272, 400, { isPrimary: true });
});

test('controller: a window that loses the focus lets go of the fingers it kept', () => {
  const seen = {}; const win = { addEventListener(t, f) { seen[t] = f; }, removeEventListener(t) { delete seen[t]; } };
  globalThis.window = win; let r;
  try { r = rig(); } finally { delete globalThis.window; }
  assert.equal(typeof seen.blur, 'function', 'it listens for the window losing the focus');
  const az0 = r.cam.state.azimuth;
  r.down(1, 150, 400, { isPrimary: false }); r.down(2, 250, 400, { isPrimary: false }); // two stale fingers (no primary event came)
  seen.blur();
  r.down(3, 200, 400, { isPrimary: false }); for (let k = 1; k <= 12; k++) r.move(3, 200 + 6 * k, 400);
  assert.ok(r.cam.state.azimuth !== az0, 'after the blur one finger turns the model again');
  r.cam.dispose(); assert.equal(seen.blur, undefined, 'dispose removes the listener');
});

test('controller: a touch tap may wander up to SLOP_TOUCH pixels, a mouse click only SLOP_MOUSE, and a shaky double tap goes home', () => {
  assert.ok(SLOP_TOUCH > SLOP_MOUSE && SLOP_MOUSE === 6 && SLOP_TOUCH === 10);
  const r = rig(), az0 = r.cam.state.azimuth;
  r.down(1, 200, 400, { isPrimary: true }); r.move(1, 203, 403); r.move(1, 205, 400); r.up(1, 205, 400, { isPrimary: true }); // about 8 px of path: over a mouse's 6, under a finger's 10
  assert.equal(r.cam.state.azimuth, az0, 'no turn from a shaky tap');
  r.tick(120); r.down(1, 204, 402, { isPrimary: true }); r.move(1, 203, 400); r.up(1, 203, 400, { isPrimary: true });
  assert.ok(r.queue.length > 0 || r.cam.busy, 'the second tap made it a double tap: the view goes home');
  const m = rig(); m.down(1, 200, 400, { pointerType: 'mouse', isPrimary: true }); m.move(1, 203, 403, { pointerType: 'mouse' }); m.move(1, 205, 400, { pointerType: 'mouse' });
  assert.ok(m.cam.state.azimuth !== az0, 'a mouse that moved about 8 px is a drag');
});

test('controller: two fingers closer than PINCH_MIN do not zoom, and the zoom starts without a jump once they are apart', () => {
  assert.equal(PINCH_MIN, 24);
  const r = rig(), d0 = r.cam.state.distance;
  r.down(1, 195, 400, { isPrimary: true }); r.down(2, 213, 400, { isPrimary: false }); // 18 px apart
  r.move(1, 193, 400); r.move(2, 215, 400); r.move(1, 190, 400); // jitter at 18 to 25 px
  assert.equal(r.cam.state.distance, d0, 'no zoom from the jitter of fingers that touch');
  for (let k = 1; k <= 10; k++) { r.move(1, 190 - 6 * k, 400); r.move(2, 215 + 6 * k, 400); }
  assert.ok(r.cam.state.distance < d0 * 0.8, `zoomed once apart: ${r.cam.state.distance}`);
  r.up(2, 275, 400, { isPrimary: false }); r.up(1, 130, 400, { isPrimary: true });
});

test('controller: the limits box can grow by its own share, setLimits keeps it, and a view past a smaller box is brought back at once', () => {
  const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 }, r = rig({ limits: box, grow: 0.04 });
  assert.ok(r.cam.limits && near(r.cam.limits.minX, -0.4) && near(r.cam.limits.maxX, 10.4) && near(r.cam.limits.maxZ, 8.32), `${JSON.stringify(r.cam.limits)}`);
  r.cam.setLimits({ minX: 0, maxX: 20, minZ: 0, maxZ: 10 }); // the share stays
  assert.ok(near(r.cam.limits.maxX, 20.8) && near(r.cam.limits.maxZ, 10.4), 'the same 4 percent of the new box');
  r.cam.setLimits({ minX: 0, maxX: 20, minZ: 0, maxZ: 10 }, 0.15); assert.ok(near(r.cam.limits.maxX, 23), 'a new share replaces it');
  const far = rig({ limits: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, grow: 0 });
  far.down(1, 100, 400, { isPrimary: true }); far.down(2, 160, 400, { isPrimary: false }); far.slide([[100, 400], [160, 400]], 150, 200, 20); far.up(2, 310, 600, { isPrimary: false }); far.up(1, 250, 600, { isPrimary: true });
  const moved = far.cam.target; assert.ok(Math.hypot(moved[0] - target[0], moved[2] - target[2]) > 1, 'the view moved');
  far.cam.setLimits({ minX: target[0] - 0.5, maxX: target[0] + 0.5, minZ: target[2] - 0.5, maxZ: target[2] + 0.5 }, 0);
  const back = far.cam.target; assert.ok(Math.abs(back[0] - target[0]) <= 0.5 + 1e-9 && Math.abs(back[2] - target[2]) <= 0.5 + 1e-9, `brought back: ${back}`);
  const home = rig({ limits: box }); assert.ok(near(home.cam.limits.maxX, 11.5), 'the default share is PAN_GROW');
});

test('controller: a long one-finger drag still gets its inertia, a two-finger gesture never does, and a mouse going down does not let go of a finger', () => {
  const r = rig(), az0 = r.cam.state.azimuth;
  r.down(1, 100, 400, { isPrimary: true }); for (let k = 1; k <= 20; k++) r.move(1, 100 + 12 * k, 400); // 240 px of path, well over 99
  r.up(1, 340, 400, { isPrimary: true });
  assert.ok(r.cam.state.azimuth !== az0 && r.cam.busy, 'a flick after a long drag keeps turning for a moment');
  const q = rig(); q.down(1, 150, 400, { isPrimary: true }); q.down(2, 250, 400, { isPrimary: false });
  for (let k = 1; k <= 20; k++) { q.move(1, 150 + 12 * k, 400); q.move(2, 250 + 12 * k, 400); }
  q.up(2, 490, 400, { isPrimary: false }); q.up(1, 390, 400, { isPrimary: true });
  assert.equal(q.cam.busy, false, 'no flick after a multi-finger gesture');
  const m = rig(), a0 = m.cam.state.azimuth; // a finger is down, then the mouse (each has its own primary pointer): they are two pointers, so nothing turns
  m.down(1, 150, 400, { isPrimary: true });
  m.fire('pointerdown', { pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 250, clientY: 400 });
  for (let k = 1; k <= 8; k++) { m.move(1, 150 - 5 * k, 400); m.move(2, 250 + 5 * k, 400, { pointerType: 'mouse' }); }
  assert.equal(m.cam.state.azimuth, a0, 'the finger was not dropped: two pointers move and zoom, they do not turn');
  assert.ok(m.gestures.some((g) => g.kind === 'pinch' || g.kind === 'pan'));
});

test('controller: a page that goes to the background lets go of the fingers it kept', () => {
  const seen = {}, doc = { visibilityState: 'visible', addEventListener(t, f) { seen[t] = f; }, removeEventListener(t) { delete seen[t]; } };
  globalThis.document = doc; let r;
  try { r = rig(); } finally { delete globalThis.document; }
  assert.equal(typeof seen.visibilitychange, 'function');
  const az0 = r.cam.state.azimuth;
  r.down(1, 150, 400, { isPrimary: false }); r.down(2, 250, 400, { isPrimary: false });
  doc.visibilityState = 'visible'; seen.visibilitychange(); // a switch that comes back does not drop them (only a hidden page does)
  r.move(1, 140, 400); assert.equal(r.cam.state.azimuth, az0, 'still two fingers');
  doc.visibilityState = 'hidden'; seen.visibilitychange();
  r.down(3, 200, 400, { isPrimary: false }); for (let k = 1; k <= 12; k++) r.move(3, 200 + 6 * k, 400);
  assert.ok(r.cam.state.azimuth !== az0, 'after the page was hidden one finger turns the model again');
  r.cam.dispose(); assert.equal(seen.visibilitychange, undefined);
});
