// The run of Spacer (spacerrun.js) against fakes of the page: what begins and ends the walk and in which order the host is called, why it refuses, the keys, the mouse
// under pointer lock, the touch halves, the space bar (jump and doors), the clock and the hooks of the test tools, and that nothing stays listening once it has ended.
// Node only: the host, the window, the document and the canvas are stubs that record what they are asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpacerRun } from '../../src/app/spacerrun.js';
import { defaultSpawn } from '../../src/model/physics.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const flat = fileModel('examples/flat-1.plan.json');
const duplex = fileModel('examples/duplex-1.plan.json');
const BODY = { tagName: 'BODY' };

// an event target that records its listeners and sends events like the browser: a listener that takes the event with stopImmediatePropagation hides it from the rest
function target(extra = {}) {
  const ls = [];
  return Object.assign({
    ls,
    addEventListener(type, fn, o) { ls.push({ type, fn, o }); },
    removeEventListener(type, fn) { const i = ls.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) ls.splice(i, 1); },
    send(type, props = {}) {
      const e = { type, defaultPrevented: false, stopped: false, target: BODY, repeat: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
      for (const l of [...ls]) if (l.type === type && !e.stopped) l.fn(e);
      return e;
    },
    count: () => ls.length,
  }, extra);
}

function rig({ model = flat, refusal = '', touchDevice = false, width = 400 } = {}) {
  const win = target(), canvas = target({ locks: 0, requestPointerLock() { this.locks++; }, getBoundingClientRect: () => ({ left: 0 }), setPointerCapture() {}, releasePointerCapture() {} });
  const doc = target({ pointerLockElement: null, visibilityState: 'visible', exited: 0, exitPointerLock() { this.pointerLockElement = null; this.exited++; } });
  const log = [], paints = [], saved = { marker: 'saved' }, clock = { now: 1000 };
  const o = { model, refusal, touchDevice, width, failBegin: false, doorCalls: [], eyes: [] };
  const host = {
    model: () => o.model,
    refusal: () => o.refusal,
    snapshot: () => { log.push('snapshot'); return saved; },
    begin: () => { log.push('begin'); if (o.failBegin) throw new Error('boom'); },
    end: (s) => { log.push(['end', s]); },
    pose: (e) => { o.eyes.push(e); },
    doors: (list, open) => { log.push(`doors:${open}`); o.doorCalls.push({ list: list.map((d) => ({ ...d })), open }); },
    paint: (f) => { paints.push(f); },
    changed: (on) => { log.push(`changed:${on}`); },
    redraw: () => { log.push('redraw'); },
    now: () => clock.now, width: () => o.width, touchDevice: () => o.touchDevice,
  };
  const run = createSpacerRun({ host, win, doc, canvas });
  const tick = (ms) => { clock.now += ms; run.frame(clock.now); };
  const key = (code, extra = {}) => win.send('keydown', { code, key: extra.key ?? code, ...extra });
  const keyUp = (code, extra = {}) => win.send('keyup', { code, key: code, ...extra });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  return { run, win, doc, canvas, log, paints, saved, clock, o, tick, key, keyUp, dist };
}
const cam = (r) => r.run.state().cam;
const deg = (r) => (r * 180) / Math.PI;

test('it refuses when it may not begin, says why, and leaves the page alone; the reason goes when it begins', () => {
  const r = rig({ refusal: 'edit' });
  assert.equal(r.run.enter(), false);
  assert.equal(r.run.active, false);
  assert.equal(r.run.state().denied, 'edit');
  assert.deepEqual(r.log, [], 'the page was not asked for anything but its reason');
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0);
  for (const why of ['loading', 'no-model']) { r.o.refusal = why; assert.equal(r.run.enter(), false); assert.equal(r.run.state().denied, why); }
  r.o.refusal = '';
  assert.equal(r.run.enter(), true);
  assert.equal(r.run.state().denied, '', 'a walk that began has no reason to refuse');
  assert.equal(r.run.enter(), true, 'begins once: a second call finds it on');
  assert.equal(r.log.filter((l) => l === 'begin').length, 1);
});

test('begin saves the view first, then puts the eyes on; leave opens every door and gives back exactly what was saved', () => {
  const r = rig();
  r.run.enter();
  const order = ['snapshot', 'begin', 'doors:false', 'changed:true', 'redraw'].map((l) => r.log.indexOf(l));
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `in this order: ${r.log}`);
  assert.equal(r.o.eyes.length > 0, true, 'the camera was put at the eyes');
  assert.equal(r.paints.length > 0, true, 'the map was drawn');
  assert.equal(r.run.state().active, true);
  r.log.length = 0;
  assert.equal(r.run.leave(), true);
  assert.equal(r.run.active, false);
  const end = r.log.find((l) => Array.isArray(l));
  assert.equal(end[1], r.saved, 'the host gets the very snapshot it made');
  assert.ok(r.log.indexOf('doors:true') < r.log.indexOf(end), 'the leaves are open before the view is given back');
  assert.ok(r.log.indexOf(end) < r.log.indexOf('changed:false'));
  assert.equal(r.run.leave(), false, 'leaving a walk that is not on does nothing');
  assert.equal(r.run.state().active, false);
  assert.equal(r.run.state().cam, null);
});

test('the eyes stand 1.6 m over the floor of the start, looking along the longest view, on the level and in the room of defaultSpawn', () => {
  for (const model of [flat, duplex]) {
    const r = rig({ model });
    r.run.enter();
    const s = defaultSpawn(model), st = r.run.state();
    assert.equal(st.level, model.levels[s.level].id);
    assert.equal(st.room, s.roomId);
    assert.ok(Math.abs(st.cam.x - s.x) < 1e-3 && Math.abs(st.cam.z - s.y) < 1e-3);
    assert.ok(Math.abs(st.cam.y - (model.levels[s.level].elevation + 1.6)) < 1e-3, 'eye height');
    assert.ok(Math.abs(((st.cam.yaw - s.yawDeg + 540) % 360) - 180) < 0.01, 'the way it looks');
    const eye = r.o.eyes.at(-1);
    assert.deepEqual([eye.x, eye.z], [st.cam.x, st.cam.z], 'plan y is the z of the scene');
    assert.ok(Math.abs(eye.y - st.cam.y) < 1e-3);
  }
});

test('nothing listens after the walk: every listener of the window, the document and the picture is removed, also when it ends by Escape', () => {
  const r = rig();
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0, 'nothing before');
  r.run.enter();
  assert.ok(r.win.count() >= 3 && r.doc.count() >= 3 && r.canvas.count() >= 5, 'it listens while it runs');
  r.run.leave();
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0);
  r.run.enter(); r.key('Escape', { key: 'Escape' });
  assert.equal(r.run.active, false);
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0, 'Escape took them away too');
  for (let i = 0; i < 5; i++) { r.run.enter(); r.run.leave(); }
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0, 'and a hundred rounds leave none behind');
});

test('a page that fails to put the eyes on is given its view back and the walk does not begin; a model that cannot be walked never touches the page', () => {
  const r = rig();
  r.o.failBegin = true;
  assert.equal(r.run.enter(), false);
  assert.equal(r.run.active, false);
  assert.equal(r.run.state().denied, 'error');
  assert.equal(r.log.find((l) => Array.isArray(l))[1], r.saved, 'the snapshot goes back');
  assert.equal(r.win.count() + r.doc.count() + r.canvas.count(), 0);
  r.o.failBegin = false; r.log.length = 0;
  assert.equal(r.run.enter(), true, 'and it can begin again');
  const bad = rig({ model: { levels: [{ id: 'L0', doors: [], colliders: [] }] } });
  assert.equal(bad.run.enter(), false);
  assert.equal(bad.run.state().denied, 'error');
  assert.ok(!bad.log.includes('snapshot') && !bad.log.includes('begin'), 'the page was not touched');
});

test('W and S walk, Shift runs, the arrows turn and A and D step aside; letting go stops, at the speeds of the walk', () => {
  const r = rig();
  r.run.enter();
  const a = { ...cam(r) };
  r.key('KeyW'); for (let i = 0; i < 30; i++) r.tick(20);
  const b = { ...cam(r) };
  assert.ok(Math.abs(r.dist(a, b) - 0.84) < 0.03, `0.6 s at 1.4 m/s: ${r.dist(a, b)}`);
  r.keyUp('KeyW'); r.tick(20); const c = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), c, 'stops with the key');
  r.key('KeyW'); r.key('ShiftLeft'); const d0 = { ...cam(r) }; for (let i = 0; i < 20; i++) r.tick(20);
  assert.ok(Math.abs(r.dist(d0, cam(r)) - 1.12) < 0.05, `0.4 s at 2.8 m/s: ${r.dist(d0, cam(r))}`);
  r.keyUp('KeyW'); r.keyUp('ShiftLeft');
  const yaw0 = cam(r).yaw; r.key('ArrowRight'); for (let i = 0; i < 25; i++) r.tick(20); r.keyUp('ArrowRight');
  const turned = ((cam(r).yaw - yaw0 + 540) % 360) - 180;
  assert.ok(Math.abs(turned - 55) < 3, `0.5 s at 110 deg/s: ${turned}`);
  const e0 = { ...cam(r) }; r.key('KeyD'); for (let i = 0; i < 15; i++) r.tick(20); r.keyUp('KeyD');
  assert.ok(r.dist(e0, cam(r)) > 0.3 && Math.abs(cam(r).yaw - e0.yaw) < 1e-9, 'a step aside does not turn');
});

test('the movement keys are taken from the page, the others are left to it: 1 to 3 pass, a key in a field is not Spacer\'s', () => {
  const r = rig();
  r.run.enter();
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft']) { const e = r.key(k); assert.ok(e.defaultPrevented && e.stopped, k); r.keyUp(k); }
  for (const [code, key] of [['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['KeyR', 'r']]) { const e = r.key(code, { key }); assert.ok(!e.defaultPrevented && !e.stopped, `${key} goes on to the page`); }
  const shiftArrow = r.key('ArrowRight', { shiftKey: true });
  assert.ok(shiftArrow.defaultPrevented, 'Shift with an arrow is a run and a turn, never the time of day');
  r.keyUp('ArrowRight');
  const field = r.key('KeyW', { target: { tagName: 'INPUT' } });
  assert.ok(!field.defaultPrevented && !field.stopped, 'typing goes to the field');
  r.tick(20); r.tick(20);
  const still = { ...cam(r) }; r.tick(100);
  assert.deepEqual(cam(r), still, 'and the walker does not move for it');
  r.key('KeyW'); r.tick(20); r.keyUp('KeyW', { target: { tagName: 'INPUT' } });
  const before = { ...cam(r) }; r.tick(100);
  assert.deepEqual(cam(r), before, 'a key up always counts, so nothing sticks');
});

test('Escape ends the walk and is taken; in a field it is the field\'s', () => {
  const r = rig();
  r.run.enter();
  const field = r.key('Escape', { key: 'Escape', target: { tagName: 'TEXTAREA' } });
  assert.ok(!field.stopped && r.run.active);
  const e = r.key('Escape', { key: 'Escape' });
  assert.ok(e.defaultPrevented && e.stopped, 'taken, so the shell and the card never see it');
  assert.equal(r.run.active, false);
  assert.ok(r.log.some(Array.isArray), 'the page got its view back');
});

test('the space bar jumps once, is taken, and does nothing on a button, in a field or with Ctrl; a held key does not jump again', () => {
  const r = rig();
  r.run.enter();
  assert.equal(r.run.state().jump.active, false);
  const e = r.key('Space', { key: ' ' });
  assert.ok(e.defaultPrevented && e.stopped);
  assert.equal(r.run.state().jump.active, true);
  r.tick(100);
  assert.ok(r.run.state().jump.height > 0.1, 'rising');
  for (let i = 0; i < 12; i++) r.tick(100);
  assert.equal(r.run.state().jump.active, false, 'landed after 0.6 s');
  assert.equal(r.run.state().cam.y, flat.levels[0].elevation + 1.6);
  const held = r.key('Space', { key: ' ', repeat: true });
  assert.ok(held.defaultPrevented && !r.run.state().jump.active, 'a repeat is swallowed and does not jump');
  for (const t of [{ tagName: 'BUTTON' }, { tagName: 'INPUT' }, { tagName: 'A', hasAttribute: () => true }]) {
    const p = r.key('Space', { key: ' ', target: t });
    assert.ok(!p.defaultPrevented && !r.run.state().jump.active, `${t.tagName} keeps it`);
  }
  const ctrl = r.key('Space', { key: ' ', ctrlKey: true });
  assert.ok(!ctrl.defaultPrevented && !r.run.state().jump.active);
  const up = r.keyUp('Space', { key: ' ' });
  assert.ok(up.defaultPrevented, 'the release of a taken press is taken too');
  assert.equal(r.run.use(), 'jump');
  assert.equal(r.run.use(), 'none', 'in the air with no door in reach');
});

test('the space bar shuts the door in reach and opens it again; the leaf swings in 0.45 s and the shut door stops the walker', () => {
  const r = rig({ model: twoRooms() });
  r.run.enter();
  assert.equal(r.run.walkTo(3, 1.45, 'L0', 0, 0), true);
  assert.ok(r.run.state().doors.every((d) => d.open && d.t === 1), 'open at the start');
  const e = r.key('Space', { key: ' ' });
  assert.ok(e.defaultPrevented);
  const d = () => r.run.state().doors[0];
  assert.equal(d().open, false);
  assert.equal(r.run.state().jump.active, false, 'it shut the door and did not jump');
  r.o.doorCalls.length = 0; r.tick(100);
  assert.ok(d().t < 1 && d().t > 0.5 && r.o.doorCalls.length > 0, `swinging: ${d().t}`);
  assert.ok(r.o.doorCalls.every((c) => c.open === false && c.list[0].id === 'd1'), 'the host is told the state of the leaves');
  for (let i = 0; i < 4; i++) r.tick(100);
  assert.equal(d().t, 0, 'shut after 0.45 s');
  r.run.walkInput({ forward: 1 }); r.tick(100); r.tick(100); r.tick(100); r.tick(100); r.tick(100); r.tick(100);
  assert.ok(r.run.state().cam.x < 4 - 0.2 + 1e-6 && r.run.state().collisions > 0, 'stopped by the shut door');
  r.run.walkInput({});
  assert.equal(r.run.use(), 'open');
  for (let i = 0; i < 6; i++) r.tick(100);
  assert.deepEqual([d().open, d().t], [true, 1]);
  r.run.walkInput({ forward: 1 }); for (let i = 0; i < 15; i++) r.tick(100);
  assert.ok(r.run.state().cam.x > 4.2, 'and walks through the open one');
});

test('leaving shuts nothing behind: the doors are open and at rest, a jump is over, and the host gets the leaves in the open pose', () => {
  const r = rig({ model: twoRooms() });
  r.run.enter(); r.run.walkTo(3, 1.45, 'L0', 0, 0);
  r.run.use(); r.tick(100); r.run.walkInput({ jump: true });
  r.o.doorCalls.length = 0;
  r.run.leave();
  const last = r.o.doorCalls.at(-1);
  assert.equal(last.open, true);
  assert.ok(last.list.every((d) => d.closed === false && d.t === 1), 'the list is already all open');
  r.run.enter();
  assert.ok(r.run.state().doors.every((d) => d.open && d.t === 1), 'a new walk starts with open doors');
  assert.equal(r.run.state().jump.active, false);
});

test('the mouse looks only under pointer lock, 0.0022 rad per pixel, and the head stops at 1.35 rad up and down', () => {
  const r = rig();
  r.run.enter();
  const y0 = cam(r).yaw;
  r.doc.send('mousemove', { movementX: 300, movementY: 0 });
  assert.equal(cam(r).yaw, y0, 'no lock, no look');
  r.doc.pointerLockElement = r.canvas;
  r.doc.send('mousemove', { movementX: 100, movementY: -50 });
  const turned = ((cam(r).yaw - y0 + 540) % 360) - 180;
  assert.ok(Math.abs(turned - deg(0.22)) < 0.01, `100 px: ${turned}`);
  assert.ok(Math.abs(cam(r).pitch - deg(0.11)) < 0.01, 'up is negative movementY');
  r.doc.send('mousemove', { movementX: 0, movementY: -100000 });
  assert.ok(Math.abs(cam(r).pitch - deg(1.35)) < 0.01);
  r.doc.send('mousemove', { movementX: 0, movementY: 100000 });
  assert.ok(Math.abs(cam(r).pitch + deg(1.35)) < 0.01);
  r.doc.send('mousemove', { movementX: Number.NaN, movementY: undefined });
  assert.ok(Number.isFinite(cam(r).yaw) && Number.isFinite(cam(r).pitch), 'a reading that is no number turns nothing');
});

test('a click on the picture asks for the pointer lock, a touch does not; pointer lock lost lets every key go', () => {
  const r = rig();
  r.run.enter();
  r.canvas.send('click', { pointerType: 'mouse' });
  r.canvas.send('click', {});
  assert.equal(r.canvas.locks, 2);
  r.canvas.send('click', { pointerType: 'touch' });
  assert.equal(r.canvas.locks, 2, 'a touch is a stick and a look');
  r.key('KeyW'); r.doc.pointerLockElement = r.canvas;
  r.doc.pointerLockElement = null; r.doc.send('pointerlockchange');
  const before = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), before, 'the key that was held when the lock went is let go');
  r.key('KeyW'); r.win.send('blur'); const b2 = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), b2, 'and so is one held when the window loses the focus');
  r.key('KeyW'); r.doc.visibilityState = 'hidden'; r.doc.send('visibilitychange'); const b3 = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), b3, 'or the tab goes to the background');
});

test('the lock is let go when the walk ends', () => {
  const r = rig();
  r.run.enter(); r.doc.pointerLockElement = r.canvas;
  r.run.leave();
  assert.equal(r.doc.exited, 1);
  const q = rig(); q.run.enter(); q.run.leave();
  assert.equal(q.doc.exited, 0, 'and not asked for when there was none');
});

test('the left half of a touch screen walks (60 px is full speed), the right half looks (0.005 rad per px); a mouse pointer is not a finger', () => {
  const r = rig({ touchDevice: true });
  r.run.enter();
  const down = (id, x, y) => r.canvas.send('pointerdown', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const move = (id, x, y) => r.canvas.send('pointermove', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const up = (id) => r.canvas.send('pointerup', { pointerType: 'touch', pointerId: id });
  const a = { ...cam(r) };
  down(1, 100, 500); move(1, 100, 440);
  for (let i = 0; i < 30; i++) r.tick(20);
  assert.ok(Math.abs(r.dist(a, cam(r)) - 0.84) < 0.03, `a full push: ${r.dist(a, cam(r))}`);
  up(1); r.tick(20); const stopped = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), stopped, 'the finger lifts, the walker stops');
  const y0 = cam(r).yaw;
  down(2, 300, 300); move(2, 400, 280);
  const turned = ((cam(r).yaw - y0 + 540) % 360) - 180;
  assert.ok(Math.abs(turned - deg(0.5)) < 0.01, `100 px right: ${turned}`);
  assert.ok(Math.abs(cam(r).pitch - deg(0.1)) < 0.01, '20 px up');
  up(2);
  const m = { ...cam(r) };
  r.canvas.send('pointerdown', { pointerType: 'mouse', pointerId: 7, clientX: 100, clientY: 500 });
  r.canvas.send('pointermove', { pointerType: 'mouse', pointerId: 7, clientX: 100, clientY: 400 });
  r.tick(100);
  assert.deepEqual(cam(r), m, 'a mouse does not steer the stick');
  r.o.width = 1000; r.run.resize();
  down(3, 300, 500); move(3, 300, 440);
  r.tick(100);
  assert.ok(cam(r).x !== m.x || cam(r).z !== m.z, 'after a resize the halves follow the new width: x = 300 is the left half of 1000');
});

test('the touch hint is due for 4 s after the walk began on a touch device, never on a computer; the map is told when the mouse is captured', () => {
  const r = rig({ touchDevice: true });
  r.run.enter();
  assert.equal(r.paints.at(-1).help, true);
  assert.equal(r.paints.at(-1).touch, true);
  r.tick(3900); assert.equal(r.paints.at(-1).help, true);
  r.tick(200); assert.equal(r.paints.at(-1).help, false);
  const c = rig();
  c.run.enter(); assert.equal(c.paints.at(-1).help, false); assert.equal(c.paints.at(-1).touch, false);
  assert.equal(c.paints.at(-1).locked, false);
  c.doc.pointerLockElement = c.canvas; c.tick(16);
  assert.equal(c.paints.at(-1).locked, true);
  const p = c.paints.at(-1);
  assert.ok(p.model === flat && p.world && p.player, 'the view gets the model, the world and the walker to draw the map');
});

test('the clock: a frame is at most 100 ms, a manual clock stands still and only advanceTime moves the walk, the same way every time', () => {
  const r = rig();
  r.run.enter();
  r.key('KeyW'); const a = { ...cam(r) };
  r.tick(5000);
  assert.ok(r.dist(a, cam(r)) <= 0.141, `a stall of 5 s counts as 100 ms: ${r.dist(a, cam(r))}`);
  const go = () => {
    const q = rig(); q.run.enter(); q.run.manualClock(true); q.run.walkInput({ forward: 1 });
    const s = { ...q.run.state().cam };
    q.tick(5000); assert.deepEqual(q.run.state().cam, s, 'a manual clock does not move the walk');
    q.run.advanceTime(500);
    return [s, q.run.state().cam, q];
  };
  const [s1, e1, q1] = go(), [, e2] = go();
  assert.ok(Math.abs(q1.dist(s1, e1) - 0.7) < 0.03, `500 ms at 1.4 m/s: ${q1.dist(s1, e1)}`);
  assert.deepEqual(e1, e2, 'deterministic');
  assert.ok(q1.log.filter((l) => l === 'redraw').length >= 2, 'and the picture is asked for');
  q1.run.manualClock(false); assert.equal(q1.run.manual, false);
  const idle = rig(); idle.run.advanceTime(1000); assert.equal(idle.run.state().active, false, 'advanceTime on a walk that is off does nothing');
});

test('walkTo puts the walker down: a level by id, the way it looks in degrees; a bad point or a walk that is off changes nothing', () => {
  const r = rig({ model: duplex });
  assert.equal(r.run.walkTo(1, 1), false, 'off');
  r.run.enter();
  const upper = duplex.levels[1];
  assert.equal(r.run.walkTo(2.1, 3.2, upper.id, 90, -30), true);
  let st = r.run.state();
  assert.equal(st.level, upper.id);
  assert.ok(Math.abs(st.cam.y - (upper.elevation + 1.6)) < 1e-3);
  assert.ok(Math.abs(st.cam.yaw - 90) < 1e-6 && Math.abs(st.cam.pitch + 30) < 1e-6);
  assert.equal(r.o.eyes.at(-1).z, 3.2);
  assert.equal(r.run.walkTo(Number.NaN, 1), false);
  assert.equal(r.run.walkTo('x', 1, 'L-none'), false);
  assert.equal(r.run.walkTo(2.1, 3.2, 'no-such-level'), true, 'a level that does not exist leaves the walker on its own');
  assert.equal(r.run.state().level, upper.id);
  r.run.walkTo(2.1, 3.2, upper.id, 0, 200);
  assert.ok(Math.abs(r.run.state().cam.pitch - deg(1.35)) < 0.01, 'the head stops at 1.35 rad');
  r.run.walkTo(2.1, 3.2, upper.id, 270, null);
  assert.ok(Math.abs(r.run.state().cam.yaw + 90) < 1e-6, 'degrees come back as -180 to 180');
});

test('walkInput holds an input until another is set (jump: one jump from the floor), and the state has the shape the tools read', () => {
  const r = rig();
  r.run.enter();
  r.run.walkInput({ forward: 1, run: true }); const a = { ...cam(r) };
  for (let i = 0; i < 10; i++) r.tick(20);
  assert.ok(Math.abs(r.dist(a, cam(r)) - 0.56) < 0.03, 'run speed');
  r.run.walkInput({ jump: true });
  assert.equal(r.run.state().jump.active, true);
  assert.deepEqual(Object.keys(r.run.state()).sort(), ['active', 'cam', 'collisions', 'denied', 'doors', 'jump', 'level', 'room']);
  assert.deepEqual(Object.keys(r.run.state().cam), ['x', 'y', 'z', 'yaw', 'pitch']);
  assert.deepEqual(Object.keys(r.run.state().jump), ['active', 'height']);
  assert.deepEqual(Object.keys(r.run.state().doors[0]), ['id', 'level', 'open', 't']);
  assert.equal(r.run.state().doors.length, flat.levels.flatMap((l) => l.doors).length);
  assert.equal(r.run.walkInput({ jump: true }), undefined);
  r.run.leave();
  r.run.walkInput({ forward: 1 }); r.run.enter();
  const b = { ...cam(r) }; r.tick(200);
  assert.deepEqual(cam(r), b, 'a new walk starts with no input held');
  assert.equal(rig().run.use(), 'none', 'the space bar of a walk that is off does nothing');
});

test('no word of the source gives away a network, a storage or a way into the page', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['spacerrun.js', 'spacerview.js']) {
    const src = readFileSync(new URL(`../../src/app/${f}`, import.meta.url), 'utf8');
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|import\(/.test(src), f);
    assert.ok(!/[–—]/.test(src), `${f} has no long dash`);
  }
});
