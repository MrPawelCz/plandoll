// Orbit camera for the page: the model can be looked at from every side. The first part is pure (state in degrees and metres,
// tested in Node); the second part is the controller that listens to pointers, the wheel and the keyboard.
// State: { azimuth, polar, distance, base }. azimuth is the direction of the camera as seen from the target, in degrees: 0 is
// south of the model (looking north), 90 east, 180 north, 270 west. polar is the angle from the vertical (small = from above),
// distance is in metres and base is the default distance that the zoom limits are relative to.
export const POLAR_MIN = 12, POLAR_MAX = 80; // degrees from the vertical: never under the table, never straight down
export const ZOOM_MIN = 0.45, ZOOM_MAX = 1.8; // times the default distance
export const HYSTERESIS = 10; // degrees: a wall changes sides only this far past the turning point, so it does not flicker
export const RESET_MS = 400;

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const wrapDegrees = (a) => { const r = fin(a) % 360; return r < 0 ? r + 360 : r; }; // into [0, 360)
const angularDistance = (a, b) => { const d = Math.abs(wrapDegrees(a) - wrapDegrees(b)); return d > 180 ? 360 - d : d; };

export function makeState({ azimuth = 0, polar = 50, distance = 10 } = {}) {
  const base = Math.max(1e-3, fin(distance, 10));
  return { azimuth: wrapDegrees(azimuth), polar: clamp(fin(polar, 50), POLAR_MIN, POLAR_MAX), distance: base, base };
}

// Drag by dx, dy degrees of turn (to the right and down are positive): the model follows the finger.
export function orbit(state, dx, dy) {
  return { ...state, azimuth: wrapDegrees(state.azimuth - fin(dx)), polar: clamp(state.polar - fin(dy), POLAR_MIN, POLAR_MAX) };
}

// factor above 1 brings the camera nearer; the distance stays within ZOOM_MIN..ZOOM_MAX times the default.
export function zoom(state, factor) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return { ...state, distance: clamp(state.distance / f, state.base * ZOOM_MIN, state.base * ZOOM_MAX) };
}

// Camera position for a state and the fixed target [x, y, z].
export function positionOf(state, target) {
  const az = state.azimuth * RAD, po = state.polar * RAD, s = Math.sin(po) * state.distance;
  return [target[0] + s * Math.sin(az), target[1] + Math.cos(po) * state.distance, target[2] + s * Math.cos(az)];
}

// The state of a camera that stands at `pos` and looks at `target` (the inverse of positionOf).
export function stateFrom(pos, target) {
  const dx = pos[0] - target[0], dy = pos[1] - target[1], dz = pos[2] - target[2], dist = Math.hypot(dx, dy, dz) || 1;
  return makeState({ azimuth: Math.atan2(dx, dz) / RAD, polar: Math.acos(clamp(dy / dist, -1, 1)) / RAD, distance: dist });
}

const SIDE_NORMAL = { south: 0, east: 90, north: 180, west: 270 }; // azimuth at which the camera looks straight at that edge of the plan
export const DEFAULT_AZIMUTH_NEAR = Object.freeze({ north: false, south: true, west: false, east: true });

// Which edges of the plan face the camera. An edge is near while the camera is within 90 degrees of its outward direction; with
// `previous` given the limit moves by HYSTERESIS degrees in the direction that keeps the old answer.
export function nearSides(azimuth, previous = null) {
  const out = {};
  for (const side of Object.keys(SIDE_NORMAL)) {
    const d = angularDistance(azimuth, SIDE_NORMAL[side]);
    out[side] = previous ? (previous[side] ? d < 90 + HYSTERESIS : d < 90 - HYSTERESIS) : d <= 90;
  }
  return out;
}
export const sidesKey = (n) => ['north', 'south', 'west', 'east'].map((s) => (n?.[s] ? s[0] : '-')).join('');
export const sameSides = (a, b) => sidesKey(a) === sidesKey(b);

// Horizontal unit direction from the model towards the camera as (x, z).
export const viewOf = (state) => [Math.sin(state.azimuth * RAD), Math.cos(state.azimuth * RAD)];

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
// Between two states, k 0..1 with an ease; the azimuth takes the short way round.
export function blend(a, b, k) {
  const e = ease(clamp(fin(k), 0, 1));
  let da = wrapDegrees(b.azimuth) - wrapDegrees(a.azimuth); if (da > 180) da -= 360; else if (da < -180) da += 360;
  return { azimuth: wrapDegrees(a.azimuth + da * e), polar: a.polar + (b.polar - a.polar) * e, distance: a.distance + (b.distance - a.distance) * e, base: b.base };
}

// Ray through a point of the picture (x, y in -1..1, up is positive) for a camera in this state: { origin, direction } with a unit
// direction. The editor uses it to pick pieces.
export function rayFor(state, target, fovDegrees, aspect, x, y) {
  const o = positionOf(state, target);
  let f = [target[0] - o[0], target[1] - o[1], target[2] - o[2]]; const fl = Math.hypot(...f) || 1; f = f.map((v) => v / fl);
  let r = [-f[2], 0, f[0]]; const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl); // forward x up; never zero because the polar angle stays off the vertical
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const th = Math.tan((fin(fovDegrees, 27) * RAD) / 2), sx = fin(x) * th * fin(aspect, 1), sy = fin(y) * th;
  const d = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy], dl = Math.hypot(...d) || 1;
  return { origin: o, direction: d.map((v) => v / dl) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Controller. One finger or the mouse turns, two fingers and the wheel zoom, a double tap or double click goes back to the home
// view (400 ms), arrow keys turn by 15 degrees. A frame is asked for (onChange) only while something moves; at rest nothing is
// queued. No storage, no network.
//   options: { element, home, target, fov, onChange(state, source), onGesture(), request, now, keys }
export function createCameraController(options) {
  const { element, target, fov = 27, onChange = () => {}, onGesture = () => {}, request = (f) => requestAnimationFrame(f), now = () => performance.now() } = options;
  let home = makeState(options.home);
  const start = options.initial ?? {};
  let state = { ...home, azimuth: wrapDegrees(fin(start.azimuth, home.azimuth)), polar: clamp(fin(start.polar, home.polar), POLAR_MIN, POLAR_MAX) };
  let enabled = true, queued = false, anim = null, spin = null, tap = null, gesture = null;
  const pointers = new Map();
  const perPixel = () => 200 / Math.max(240, Math.min(element.clientWidth || 800, element.clientHeight || 800)); // degrees of turn per pixel dragged

  const emit = (source) => onChange(state, source);
  function schedule() { if (!queued) { queued = true; request(frame); } }
  function frame(ts) {
    queued = false;
    const t = Number.isFinite(ts) ? ts : now();
    if (anim) {
      const k = (t - anim.t0) / RESET_MS;
      state = blend(anim.from, anim.to, k); if (k >= 1) { state = anim.to; anim = null; }
      emit('animation');
    } else if (spin) {
      const dt = clamp(t - spin.last, 1, 50); spin.last = t;
      state = orbit(state, spin.vx * dt, spin.vy * dt);
      const decay = Math.exp(-dt / 260); spin.vx *= decay; spin.vy *= decay;
      if (Math.hypot(spin.vx, spin.vy) < 0.004) spin = null;
      emit('animation');
    }
    if (anim || spin) schedule();
  }
  const stopMotion = () => { anim = null; spin = null; };

  function reset(animate = true) {
    stopMotion();
    if (!animate) { state = home; emit('reset'); return; }
    anim = { from: state, to: home, t0: now() }; schedule();
  }
  function set(next, source = 'api') {
    stopMotion();
    state = { ...state, azimuth: wrapDegrees(fin(next.azimuth, state.azimuth)), polar: clamp(fin(next.polar, state.polar), POLAR_MIN, POLAR_MAX), distance: clamp(fin(next.distance, state.distance), state.base * ZOOM_MIN, state.base * ZOOM_MAX) };
    emit(source);
  }

  // A new default distance (the window changed shape): the turn stays, the zoom keeps its ratio to the default.
  function rehome(next) {
    const h = makeState(next), ratio = h.base / state.base;
    home = h; state = { ...state, base: h.base, distance: clamp(state.distance * ratio, h.base * ZOOM_MIN, h.base * ZOOM_MAX) };
    if (anim) anim = { ...anim, to: home };
  }

  // pointers
  const onDown =(e) => {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    stopMotion();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { element.setPointerCapture(e.pointerId); } catch {}
    const t = now();
    if (pointers.size === 1) gesture = { t0: t, x0: e.clientX, y0: e.clientY, moved: 0, last: t, vx: 0, vy: 0, pinch: 0 };
    else if (gesture) { const [a, b] = [...pointers.values()]; gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y); gesture.moved = 99; }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId); if (!p || !enabled || !gesture) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.pinch > 0 && d > 0) { state = zoom(state, d / gesture.pinch); onGesture(); emit('user'); }
      gesture.pinch = d; return;
    }
    gesture.moved += Math.hypot(dx, dy);
    if (gesture.moved < 6) return; // a tap is not a drag
    const k = perPixel(), t = now(), dt = Math.max(1, t - gesture.last); gesture.last = t;
    state = orbit(state, dx * k, dy * k);
    gesture.vx = 0.6 * gesture.vx + 0.4 * ((dx * k) / dt); gesture.vy = 0.6 * gesture.vy + 0.4 * ((dy * k) / dt);
    onGesture(); emit('user');
  };
  const onUp = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    try { element.releasePointerCapture(e.pointerId); } catch {}
    const g = gesture, t = now();
    if (pointers.size > 0) { if (g) g.pinch = 0; return; }
    gesture = null; if (!g || !enabled) return;
    if (g.moved < 6 && t - g.t0 < 350) { // a tap: two close taps are a double tap
      if (tap && t - tap.t < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) { tap = null; reset(true); } else tap = { t, x: e.clientX, y: e.clientY };
    } else if (g.moved >= 6 && g.moved < 99 && t - g.last < 80 && Math.hypot(g.vx, g.vy) > 0.02) { spin = { vx: g.vx, vy: g.vy, last: t }; schedule(); }
  };
  const onCancel = (e) => { pointers.delete(e.pointerId); if (!pointers.size) gesture = null; };
  const onWheel = (e) => {
    if (!enabled) return;
    e.preventDefault();
    const dy = (e.deltaMode === 1 ? 16 : 1) * fin(e.deltaY), step = e.ctrlKey ? 0.01 : 0.0012; // a pinch on a trackpad arrives as ctrl + wheel
    stopMotion(); state = zoom(state, Math.exp(-clamp(dy, -400, 400) * step)); onGesture(); emit('user');
  };

  // keys: arrows turn by 15 degrees (up and down tilt by 10), + and - zoom, 0 goes home; Shift + arrow is left to the page.
  const onKey = (e) => {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey) return false;
    const tag = String(e.target?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
    const arrows = e.key.startsWith('Arrow');
    if (arrows && e.shiftKey) return false;
    let next = null;
    if (e.key === 'ArrowLeft') next = orbit(state, -15, 0); else if (e.key === 'ArrowRight') next = orbit(state, 15, 0); // an arrow drags the model that way
    else if (e.key === 'ArrowUp') next = orbit(state, 0, -10); else if (e.key === 'ArrowDown') next = orbit(state, 0, 10);
    else if (e.key === '+' || e.key === '=') next = zoom(state, 1.15); else if (e.key === '-' || e.key === '_') next = zoom(state, 1 / 1.15);
    else if (e.key === '0') { reset(true); e.preventDefault?.(); return true; }
    if (!next) return false;
    stopMotion(); state = next; e.preventDefault?.(); onGesture(); emit('user'); return true;
  };

  element.style.touchAction = 'none'; element.style.userSelect = 'none'; element.style.webkitUserSelect = 'none';
  element.addEventListener('pointerdown', onDown); element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp); element.addEventListener('pointercancel', onCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  const keyHost = options.keys ?? (typeof window !== 'undefined' ? window : null);
  keyHost?.addEventListener('keydown', onKey);

  return {
    get state() { return state; },
    get home() { return home; },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!enabled) { stopMotion(); pointers.clear(); gesture = null; } },
    get busy() { return queued || !!anim || !!spin; },
    position: () => positionOf(state, target),
    reset, set, rehome,
    // The ray under a pointer event, for picking: { origin, direction } in world space.
    pointerToRay(event) {
      const r = element.getBoundingClientRect(), w = r.width || 1, h = r.height || 1;
      return rayFor(state, target, fov, w / h, ((event.clientX - r.left) / w) * 2 - 1, 1 - ((event.clientY - r.top) / h) * 2);
    },
    key: onKey,
    dispose() {
      stopMotion(); element.removeEventListener('pointerdown', onDown); element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp); element.removeEventListener('pointercancel', onCancel); element.removeEventListener('wheel', onWheel);
      keyHost?.removeEventListener('keydown', onKey);
    },
  };
}
