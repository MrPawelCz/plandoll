// Pan and zoom at a point: the pure helpers (ground point of a picture point, pan by pixels, zoom about a point, limits) and the controller with fake
// pointers: two fingers zoom and move, three fingers move, the mouse buttons move, the wheel zooms towards the pointer, a double tap goes home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, zoom, positionOf, rayFor, groundPoint, toPicture, panShift, panByPixels, zoomAt, panLimits, clampPan, blendPan, nearPlane, createCameraController,
  ZOOM_MIN, ZOOM_MAX, PAN_GROW, NEAR_MIN, NEAR_MAX, RESET_MS } from '../../src/app/camera.js';

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
