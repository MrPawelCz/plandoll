// Input and timing of the Spacer (walk) mode: which key does what, when the space bar belongs to Spacer, the mouse look, the two halves of a
// touch screen, how the sources add up, and the clock that steps the walk. Pure: no DOM, no three.js, no physics; main.js passes the events
// in and applies what comes back, tests/app/spacer.test.mjs runs every rule in Node. Words the visitor reads live in ui.js.
// Ported from planwalk viewer/src/main.js and viewer/src/compact.js (MIT, same author), source commit fa1a280 (v0.3.2).

export const PITCH_LIMIT = 1.35; // rad: the head tilts up or down this far, never over the top
export const MOUSE_LOOK = 0.0022; // rad per px of mouse movement under pointer lock
export const TOUCH_LOOK = 0.005; // rad per px of a finger on the right half
export const STICK_PX = 60; // px a finger on the left half travels for full speed
export const TOUCH_HELP_MS = 4000; // the touch zones and their hint stay this long after entering
export const MAX_FRAME_MS = 100; // a frame that took longer (a hidden tab, a stall) counts as this long, so the walk does not jump
export const MAX_STEP = 1 / 60; // s: the largest slice a span of time is cut into before it reaches the physics

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (v) => v || 0; // NaN and -0 become 0, so a result compares equal to a plain 0
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k); // no Object.hasOwn: Safari before 15.4 has none

// ---------- keys ----------
// Code -> [axis, sign]. The arrows left and right TURN (they do not step sideways); A and D step sideways. Shift is the run key, Space and
// Escape are handled apart (spaceAction, keyAction).
export const KEYMAP = Object.freeze({
  KeyW: Object.freeze(['forward', 1]), ArrowUp: Object.freeze(['forward', 1]),
  KeyS: Object.freeze(['forward', -1]), ArrowDown: Object.freeze(['forward', -1]),
  KeyD: Object.freeze(['strafe', 1]), KeyA: Object.freeze(['strafe', -1]),
  ArrowRight: Object.freeze(['turn', 1]), ArrowLeft: Object.freeze(['turn', -1]),
});
export const RUN_KEYS = Object.freeze(['ShiftLeft', 'ShiftRight']);

// { axis, sign } for a key code that moves the walker, else null.
export function keyAxis(code) {
  const k = own(KEYMAP, code) ? KEYMAP[code] : null;
  return k ? { axis: k[0], sign: k[1] } : null;
}

// The keys held now. Held keys are kept by code, so two keys for one direction (W and the arrow up) keep walking until both are up.
export function createKeyState() {
  const held = new Set();
  const tracked = (code) => own(KEYMAP, code) || RUN_KEYS.includes(code);
  const sum = (axis) => {
    let v = 0;
    for (const code of held) if (KEYMAP[code]?.[0] === axis) v += KEYMAP[code][1];
    return clamp(v, -1, 1);
  };
  return {
    // true when the key is one of the movement keys (the caller then keeps the browser from acting on it); Shift is held too but is not.
    down(code) {
      if (!tracked(code)) return false;
      held.add(code);
      return own(KEYMAP, code);
    },
    // Always honoured, also when the key went down somewhere that was not ours: a key must never stay stuck.
    up(code) { held.delete(code); },
    clear() { held.clear(); }, // the window lost focus, Spacer ended: the keyup will not come
    axes() { return { forward: sum('forward'), strafe: sum('strafe'), turn: sum('turn'), run: RUN_KEYS.some((c) => held.has(c)) }; },
  };
}

// ---------- where a key press belongs ----------
// The role-less test of a target by walking up its parents, so a plain object tree is enough in Node and the answer is the same in a page.
function within(target, test) {
  for (let n = target, i = 0; n && i < 100; n = n.parentElement, i++) if (test(n)) return true;
  return false;
}
const tagOf = (n) => String(n.tagName ?? '').toLowerCase();
const roleOf = (n) => String(n.getAttribute?.('role') ?? '').toLowerCase();

// A key that lands in a text field, a list, an editable region or a dialog belongs to that, never to the walk. The Menu sheet of a phone is a
// div with role="dialog", not a dialog element.
export function isTyping(target) {
  return within(target, (n) => ['input', 'textarea', 'select', 'dialog'].includes(tagOf(n)) || roleOf(n) === 'dialog' || n.isContentEditable === true);
}

// A button or a link answers the space bar (it presses on the key's release). In the page it stays that, so a visitor who tabs to a button
// and presses space presses the button, never jumps.
export function isPressable(target) {
  return within(target, (n) => tagOf(n) === 'button' || (tagOf(n) === 'a' && n.hasAttribute?.('href') === true) || ['button', 'link'].includes(roleOf(n)));
}

// What the space bar does for a key event: 'use' (jump, or shut and open the door in reach; the caller keeps the browser from acting on it),
// 'swallow' (the caller keeps the browser from acting on it, and nothing else happens: a held key repeating, or the release of a taken
// press, which would otherwise scroll the page) or 'pass' (not ours). event: { type, code, repeat, ctrlKey, altKey, metaKey, target }
// as a KeyboardEvent has them; ctx: { active } (Spacer is on).
export function spaceAction(event, ctx) {
  const e = event ?? {};
  if (!ctx?.active || e.code !== 'Space') return 'pass';
  if (e.ctrlKey || e.altKey || e.metaKey) return 'pass';
  if (isTyping(e.target) || isPressable(e.target)) return 'pass';
  return e.type === 'keyup' || e.repeat ? 'swallow' : 'use';
}

// Every other key press (keydown) while walking: 'exit' (Escape), 'move' (a movement key; the caller keeps the browser from acting on it),
// 'run' (Shift) or 'pass'. A key aimed at a field or a dialog is never ours. A button in focus does not matter here: only the space bar
// presses it. keyup does not come here: it always goes to createKeyState().up.
export function keyAction(event, ctx) {
  const e = event ?? {};
  if (!ctx?.active || isTyping(e.target)) return 'pass';
  if (e.code === 'Escape') return 'exit';
  if (keyAxis(e.code)) return 'move';
  if (RUN_KEYS.includes(e.code)) return 'run';
  return 'pass';
}

// ---------- looking ----------
// Turn of the head for a movement of dx, dy px at k rad per px: dyaw to add to the yaw, the new pitch (up is positive, so moving down
// lowers the head) kept within PITCH_LIMIT, and dpitch, what the pitch really changed by.
function look(dx, dy, pitch, k) {
  const from = clamp(num(pitch), -PITCH_LIMIT, PITCH_LIMIT);
  const to = clamp(from - num(dy) * k, -PITCH_LIMIT, PITCH_LIMIT);
  return { dyaw: norm(num(dx) * k), dpitch: norm(to - from), pitch: to };
}

// A movement of the mouse under pointer lock (movementX, movementY in px).
export const lookDelta = (movementX, movementY, pitch) => look(movementX, movementY, pitch, MOUSE_LOOK);

// ---------- touch ----------
// The canvas is cut in two at half its width (x counted from its left edge). A finger on the left half is the stick: the first one down steers,
// 60 px from where it landed is full speed. A finger on the right half turns the head by how far it moves. Fingers are told apart by pointerId,
// so one on each half works at once. Only touch pointers belong here (the caller filters on pointerType).
// down, move and up answer what changed: { side: 'left', forward, strafe } (the stick, as it stands now), { side: 'right', dyaw, dpitch,
// pitch } (a turn of the head, move only; pass the current pitch as the fourth argument) or null when the pointer is not known or is a
// second finger on the left half, which does not steer.
export function createTouch({ width = 0 } = {}) {
  let half = num(width) / 2;
  const ptr = new Map(); // pointerId -> { side, x, y, ox, oy }, in the order the fingers came down
  const stick = () => { for (const p of ptr.values()) if (p.side === 'left') return p; return null; };
  const axesOf = (p) => (p ? { forward: norm(clamp(-(p.y - p.oy) / STICK_PX, -1, 1)), strafe: norm(clamp((p.x - p.ox) / STICK_PX, -1, 1)) } : { forward: 0, strafe: 0 });
  const drop = (id) => {
    const p = ptr.get(id);
    if (!p) return null;
    const owner = p === stick();
    ptr.delete(id);
    const next = stick();
    if (owner && next) { next.ox = next.x; next.oy = next.y; } // the next finger takes over from where it is, so the walker does not lurch
    return p;
  };
  return {
    setWidth(w) { half = num(w) / 2; },
    down(id, x, y) {
      drop(id);
      const side = num(x) < half ? 'left' : 'right';
      ptr.set(id, { side, x: num(x), y: num(y), ox: num(x), oy: num(y) });
      return { side };
    },
    move(id, x, y, pitch = 0) {
      const p = ptr.get(id);
      if (!p) return null;
      const nx = Number.isFinite(x) ? x : p.x, ny = Number.isFinite(y) ? y : p.y; // a reading that is not a number leaves the finger where it was
      const dx = nx - p.x, dy = ny - p.y;
      p.x = nx; p.y = ny;
      if (p.side === 'right') return { side: 'right', ...look(dx, dy, pitch, TOUCH_LOOK) };
      return p === stick() ? { side: 'left', ...axesOf(p) } : null;
    },
    up(id) {
      const p = drop(id);
      if (!p) return null;
      return p.side === 'left' ? { side: 'left', ...axesOf(stick()) } : { side: 'right' };
    },
    clear() { ptr.clear(); }, // pointercancel, Spacer ended
    axes() { return axesOf(stick()); },
    get count() { return ptr.size; },
  };
}

// The sources of a walking input add up and are cut to [-1, 1]: keys (createKeyState().axes()), the stick (createTouch().axes(), no turn)
// and the test hook of the page (api), which takes the same shape. Running is any source asking for it. A missing or odd value counts as 0.
export function effectiveInput({ keys, touch, api } = {}) {
  const sum = (a, withTouch) => clamp(num(keys?.[a]) + (withTouch ? num(touch?.[a]) : 0) + num(api?.[a]), -1, 1);
  return { forward: sum('forward', true), strafe: sum('strafe', true), turn: sum('turn', false), run: !!(keys?.run || api?.run) };
}

// ---------- time ----------
// One frame of the clock. now and last in ms (performance.now); manual stops the clock for tests, which then advance time by hand
// (the page's advanceTime). Returns { dt, last }: dt in s, 0 for a manual clock, a first frame or a clock that went back, and never over
// MAX_FRAME_MS; last is the value to pass in next time.
export function stepClock({ now, last, manual = false } = {}) {
  const t = Number.isFinite(now) ? now : last;
  if (manual || !Number.isFinite(now) || !Number.isFinite(last)) return { dt: 0, last: t };
  return { dt: Math.min(MAX_FRAME_MS, Math.max(0, now - last)) / 1000, last: t };
}

// A span of time in s cut into slices of at most MAX_STEP, the way the physics wants it (fast steps never skip a wall). A span that is
// not a finite positive number gives no slices.
export function* substeps(seconds) {
  let left = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  while (left > 1e-9) {
    const dt = Math.min(left, MAX_STEP);
    yield dt;
    left -= dt;
  }
}

// ---------- touch help ----------
// The two zones and their hint show for TOUCH_HELP_MS after Spacer was entered on a touch device, and only when a model is up.
// elapsedMs: ms since entering, or null/undefined when not entered.
export function touchHelpVisible({ touchDevice, mode, hasModel, elapsedMs } = {}) {
  return !!touchDevice && mode === 'walk' && !!hasModel && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < TOUCH_HELP_MS;
}
