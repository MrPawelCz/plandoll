// The run of Spacer, the mode that walks the flat at eye height. It owns what the visitor does (keys, mouse, touch), the world and the walker of model/physics.js,
// the clock that steps them and the hooks of the test tools. Everything that touches the page (the camera, the scene, the controls, the map) is handed in as `host`,
// so tests/app/spacerrun.test.mjs runs it in Node against fakes; main.js makes the host and the one instance. The rules of the input live in spacer.js.
// Ported in part from planwalk viewer/src/main.js (MIT, same author), source commit fa1a280 (v0.3.2).
//
// deps: { host, win, doc, canvas } with
//   win, doc      the window and the document (addEventListener, removeEventListener; doc.pointerLockElement, doc.exitPointerLock, doc.visibilityState)
//   canvas        the picture (addEventListener, requestPointerLock, setPointerCapture, getBoundingClientRect)
//   host.model()        the model now (the page replaces it when a plan is loaded)
//   host.refusal()      '' when Spacer may start, else why not ('edit', 'loading', 'no-model')
//   host.snapshot()     everything the page has to get back, as the page likes it (opaque here)
//   host.begin()        the page puts on the eyes: the shell shut, every floor on show, the walls full height, the ceilings on, the camera of the eyes
//   host.end(saved)     the exact reverse, from what snapshot gave
//   host.pose(eye)      the camera of the eyes: { x, y, z, yaw, pitch } (plan x and y are x and z of the scene; angles in radians)
//   host.doors(list, open)   the leaves follow world.doors (open: all of them in the open pose)
//   host.paint({ model, world, player, touch, help, locked })   the map and the hints for this frame (touch: a touch device; help: its hint is due; locked: the mouse is captured)
//   host.changed(active)     the controls follow (the button becomes Exit)
//   host.redraw(), host.now() (ms), host.width() (px of the picture), host.touchDevice()
import { PLAYER, roomAt } from '../model/geometry.js';
import { createWorld, createPlayer, teleport, jump, stepPlayer, stepDoors, useSpace, openAllDoors, defaultSpawn } from '../model/physics.js';
import { PITCH_LIMIT, createKeyState, createTouch, spaceAction, keyAction, lookDelta, effectiveInput, stepClock, substeps, touchHelpVisible } from './spacer.js';

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const r3 = (v) => Math.round(v * 1000) / 1000;
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export function createSpacerRun({ host, win, doc, canvas }) {
  const keys = createKeyState(), touch = createTouch();
  const hook = { forward: 0, strafe: 0, turn: 0, run: false }; // walkInput: the input a test tool holds, added to keys and touch
  let active = false, denied = '', world = null, player = null, saved = null, last = 0, enteredAt = 0, manual = false;

  // ---------- listeners: on while Spacer runs, all gone when it ends ----------
  const bound = [];
  const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); bound.push([target, type, fn, options]); };
  const unbind = () => { for (const [target, type, fn, options] of bound.splice(0)) target.removeEventListener(type, fn, options); };
  const take = (e) => { e.preventDefault?.(); e.stopImmediatePropagation?.(); }; // Spacer has the key: the shell, the editor and the camera never see it
  const clearInput = () => { keys.clear(); touch.clear(); }; // the keyup or the pointerup of a lost window never comes

  const eye = () => ({ x: player.x, y: player.floor + PLAYER.eye + player.jumpH, z: player.y, yaw: player.yaw, pitch: player.pitch });
  const place = () => host.pose(eye());
  const paint = (now) => {
    const touchDevice = !!host.touchDevice();
    host.paint({ model: host.model(), world, player, touch: touchDevice, help: touchHelpVisible({ touchDevice, mode: 'walk', hasModel: true, elapsedMs: now - enteredAt }), locked: doc.pointerLockElement === canvas });
  };

  function use() {
    if (!active) return 'none';
    return useSpace(world, player).action; // 'close', 'open', 'blocked', 'jump' or 'none'; the leaf follows in the next frames (stepDoors)
  }

  function onKeyDown(e) {
    const space = spaceAction(e, { active });
    if (space !== 'pass') { take(e); if (space === 'use') use(); return; }
    const act = keyAction(e, { active });
    if (act === 'exit') { take(e); leave(); } else if (act === 'move') { keys.down(e.code); take(e); } else if (act === 'run') keys.down(e.code);
  }
  function onKeyUp(e) {
    keys.up(e.code); // always, whatever the target: a key must never stay stuck
    if (spaceAction(e, { active }) === 'swallow') e.preventDefault?.();
  }
  function onMouseMove(e) {
    if (!player || doc.pointerLockElement !== canvas) return;
    const d = lookDelta(e.movementX, e.movementY, player.pitch);
    player.yaw = wrap(player.yaw + d.dyaw); player.pitch = d.pitch;
  }
  function onClick(e) {
    if (e.pointerType === 'touch') return; // a touch is the stick and the look, never a request for the mouse
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* no lock: the keys and the touch still work */ }
  }
  const left = (e) => num(e.clientX) - num(canvas.getBoundingClientRect?.().left);
  function onPointerDown(e) {
    if (e.pointerType !== 'touch') return;
    touch.setWidth(host.width());
    touch.down(e.pointerId, left(e), num(e.clientY));
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* the finger is followed without capture */ }
  }
  function onPointerMove(e) {
    if (e.pointerType !== 'touch' || !player) return;
    const r = touch.move(e.pointerId, left(e), num(e.clientY), player.pitch);
    if (r?.side === 'right') { player.yaw = wrap(player.yaw + r.dyaw); player.pitch = r.pitch; }
  }
  function onPointerEnd(e) {
    if (e.pointerType !== 'touch') return;
    touch.up(e.pointerId);
    try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
  }

  // ---------- stepping ----------
  function stepOnce(dt) {
    stepPlayer(world, player, effectiveInput({ keys: keys.axes(), touch: touch.axes(), api: hook }), dt);
    if (stepDoors(world, dt)) host.doors(world.doors, false);
  }
  const advance = (seconds) => { for (const dt of substeps(seconds)) stepOnce(dt); };
  // One drawn frame: the clock steps the walk, the camera goes where the eyes are, the map follows.
  function frame(now = host.now()) {
    if (!active) return;
    const c = stepClock({ now, last, manual });
    last = c.last;
    advance(c.dt); place(); paint(now);
  }
  // Test hook: ms of walking at once, whatever the clock; the picture follows (the page draws it).
  function advanceTime(ms) {
    if (!active) return;
    advance(Math.max(0, num(ms)) / 1000); place(); paint(host.now()); host.redraw();
  }

  // ---------- in and out ----------
  function enter() {
    if (active) return true;
    const why = host.refusal();
    if (why) { denied = why; return false; }
    const model = host.model();
    try { // the world and the start are made before the page is touched, so a model that cannot be walked leaves it as it was
      world = createWorld(model);
      const s = defaultSpawn(model);
      player = createPlayer(world, { level: s.level, x: s.x, y: s.y, yawDeg: s.yawDeg });
    } catch { world = null; player = null; denied = 'error'; return false; }
    denied = '';
    saved = host.snapshot();
    try { host.begin(); } catch { try { host.end(saved); } catch { /* the page shows what it can */ } saved = null; world = null; player = null; denied = 'error'; return false; }
    host.doors(world.doors, false);
    active = true;
    clearInput(); hook.forward = hook.strafe = hook.turn = 0; hook.run = false;
    last = enteredAt = host.now(); touch.setWidth(host.width());
    on(win, 'keydown', onKeyDown, true); on(win, 'keyup', onKeyUp, true); on(win, 'blur', clearInput);
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') clearInput(); });
    on(doc, 'pointerlockchange', () => { if (doc.pointerLockElement !== canvas) clearInput(); }); // the lock is gone: no key it was holding comes up
    on(doc, 'mousemove', onMouseMove);
    on(canvas, 'click', onClick);
    on(canvas, 'pointerdown', onPointerDown); on(canvas, 'pointermove', onPointerMove); on(canvas, 'pointerup', onPointerEnd); on(canvas, 'pointercancel', onPointerEnd);
    place(); paint(enteredAt); host.changed(true); host.redraw();
    return true;
  }

  function leave() {
    if (!active) return false;
    unbind();
    if (doc.pointerLockElement === canvas) doc.exitPointerLock?.();
    clearInput();
    openAllDoors(world); // the doors are open again for the view from above, the way the page has always drawn them (the walker goes with the walk, so a jump ends with it)
    host.doors(world.doors, true);
    active = false; manual = false;
    const was = saved; saved = null; world = null; player = null;
    try { host.end(was); } finally { host.changed(false); host.redraw(); }
    return true;
  }

  // ---------- hooks of the test tools (window.__spacer) ----------
  function state() {
    if (!active) return { active: false, denied, cam: null, level: null, room: null, collisions: 0, jump: { active: false, height: 0 }, doors: [] };
    const model = host.model(), lv = model.levels[player.level];
    return {
      active: true, denied,
      cam: { x: r3(player.x), y: r3(eye().y), z: r3(player.y), yaw: r3(deg(player.yaw)), pitch: r3(deg(player.pitch)) },
      level: lv.id, room: roomAt(lv, player.x, player.y)?.id ?? null, collisions: player.collisions,
      jump: { active: player.jumpH > 0 || player.jumpV > 0, height: r3(player.jumpH) },
      doors: world.doors.map((d) => ({ id: d.id, level: model.levels[d.level].id, open: !d.closed, t: r3(d.t) })),
    };
  }
  // Puts the walker at plan point (x, y) of a floor (by id; the floor it is on when none is named), looking along yaw and pitch in degrees. false when Spacer is off or the point is no number.
  function walkTo(x, y, levelId, yawDeg, pitchDeg) {
    if (!active || !Number.isFinite(+x) || !Number.isFinite(+y)) return false;
    const levels = host.model().levelIndex, li = levelId != null && levels.has(levelId) ? levels.get(levelId) : player.level;
    teleport(world, player, +x, +y, li);
    if (yawDeg != null && Number.isFinite(+yawDeg)) player.yaw = wrap(rad(+yawDeg));
    if (pitchDeg != null && Number.isFinite(+pitchDeg)) player.pitch = clamp(rad(+pitchDeg), -PITCH_LIMIT, PITCH_LIMIT);
    place(); paint(host.now()); host.redraw();
    return true;
  }
  // The input a tool holds until it sets another (jump: true makes one jump from the floor, a held flag is not a held key).
  function walkInput(input = {}) {
    hook.forward = num(input.forward); hook.strafe = num(input.strafe); hook.turn = num(input.turn); hook.run = !!input.run;
    if (input.jump && active) jump(world, player);
  }
  const manualClock = (v) => { manual = !!v; last = host.now(); };

  return {
    enter, leave, state, walkTo, walkInput, advanceTime, manualClock, frame, use,
    get active() { return active; },
    get denied() { return denied; },
    get manual() { return manual; },
  };
}
