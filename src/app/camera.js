// Orbit camera for the page: the model can be looked at from every side, zoomed and moved over the ground. The first part is pure
// (state in degrees and metres, tested in Node); the second part is the controller that listens to pointers, the wheel and the keyboard.
// State: { azimuth, polar, distance, base }. azimuth is the direction of the camera as seen from the target, in degrees: 0 is
// south of the model (looking north), 90 east, 180 north, 270 west. polar is the angle from the vertical (small = from above),
// distance is in metres and base is the default distance that the zoom limits are relative to.
// The pan is not part of the state: it is an offset [x, z] in metres of the target over the ground plane (the height of the target never
// changes), kept by the controller and added to the home target.
export const POLAR_MIN = 12, POLAR_MAX = 80; // degrees from the vertical: never under the table, never straight down
export const ZOOM_MIN = 0.2, ZOOM_MAX = 1.8; // times the default distance
export const PAN_GROW = 0.15; // the target may leave the box of the model by this share of its size on every side
export const HYSTERESIS = 10; // degrees: a wall changes sides only this far past the turning point, so it does not flicker
export const RESET_MS = 400;
export const SLOP_MOUSE = 6, SLOP_TOUCH = 10; // px a pointer may move and still be a tap (a finger is less steady than a mouse; Android's own slop is 8 dp)
export const PINCH_MIN = 24; // px: two fingers closer than this only jitter, they do not zoom
const slopOf = (g) => (g?.type === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH);
export const NEAR_MIN = 0.12, NEAR_MAX = 0.5; // metres: the near plane of the camera shrinks with the distance so that a close view does not cut the model

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
// Pan and zoom at a point. Picture coordinates are x, y in -1..1 with up positive, as in rayFor.

// The point [x, z] of the ground plane (the horizontal plane at the height of the target) under a point of the picture, or null when the ray
// runs level or upward, or meets the plane more than 12 distances away (near the horizon).
export function groundPoint(state, target, fovDegrees, aspect, x, y) {
  const r = rayFor(state, target, fovDegrees, aspect, x, y), dy = r.direction[1];
  if (!(dy < -1e-6)) return null;
  const t = (target[1] - r.origin[1]) / dy;
  if (!(t > 0) || !(t < 12 * Math.max(1, fin(state?.distance, 10)))) return null;
  return [r.origin[0] + r.direction[0] * t, r.origin[2] + r.direction[2] * t];
}

// A client point as a point of the picture, for an element at rect { left, top, width, height }. `lift` is how far above the middle of the element the
// centre of the projection sits, in picture units (the share of the height that bars cover at the bottom, see liftOf): the picture point (0, 0) is then the
// one that the camera looks at, which is the middle of the part of the picture that the bars leave free.
export function toPicture(rect, clientX, clientY, lift = 0) {
  const w = rect?.width || 1, h = rect?.height || 1;
  return [((fin(clientX) - fin(rect?.left)) / w) * 2 - 1, 1 - ((fin(clientY) - fin(rect?.top)) / h) * 2 - fin(lift)];
}

// How far the target has to move over the ground, [dx, dz] in metres, so that the ground point that `before` showed at the picture point `from`
// shows at the picture point `to` once the view is `after` (another distance, the same target). With before equal to after this is a plain pan.
// Zero when either ray misses the ground.
export function panShift(before, after, target, fovDegrees, aspect, from, to) {
  const a = groundPoint(before, target, fovDegrees, aspect, from[0], from[1]), b = groundPoint(after, target, fovDegrees, aspect, to[0], to[1]);
  return a && b ? [a[0] - b[0], a[1] - b[1]] : [0, 0];
}

// Drag by pixels: the ground under the finger at client point `from` follows it to `to`. rect: the element's { left, top, width, height }.
// Returns the shift [dx, dz] of the target in metres. `lift` as in toPicture.
export function panByPixels(state, target, fovDegrees, rect, from, to, lift = 0) {
  const aspect = (rect?.width || 1) / (rect?.height || 1);
  return panShift(state, state, target, fovDegrees, aspect, toPicture(rect, from[0], from[1], lift), toPicture(rect, to[0], to[1], lift));
}

// Zoom by `factor` (above 1 is nearer) about the picture point `at`, which moves to `to` (the same point for a wheel, the next midpoint of the fingers
// for a pinch). Returns { state, shift }: the zoomed state (inside the zoom limits) and the shift of the target that keeps the ground point under the fingers.
export function zoomAt(state, target, fovDegrees, aspect, factor, at, to = at) {
  const next = zoom(state, factor);
  return { state: next, shift: panShift(state, next, target, fovDegrees, aspect, at, to) };
}

// The box that the target may move in: the box { minX, maxX, minZ, maxZ } of the model grown on every side by `grow` times its size.
export function panLimits(box, grow = PAN_GROW) {
  if (!box || !['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(box[k]))) return null;
  const gx = Math.max(0, box.maxX - box.minX) * grow, gz = Math.max(0, box.maxZ - box.minZ) * grow;
  return { minX: box.minX - gx, maxX: box.maxX + gx, minZ: box.minZ - gz, maxZ: box.maxZ + gz };
}

// The pan [x, z] limited so that home + pan stays inside `limits` (as panLimits gives them); a pan of zero is always allowed, so a home target outside the box
// is not moved. Without limits the pan is only made finite.
export function clampPan(pan, home, limits) {
  const x = fin(pan?.[0]), z = fin(pan?.[1]);
  if (!limits) return [x, z];
  return [clamp(x, Math.min(0, limits.minX - home[0]), Math.max(0, limits.maxX - home[0])), clamp(z, Math.min(0, limits.minZ - home[2]), Math.max(0, limits.maxZ - home[2]))];
}

// The pan on the way between two pans, with the same ease as blend.
export function blendPan(a, b, k) {
  const e = ease(clamp(fin(k), 0, 1));
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
}

// The near plane for a camera at this distance: a close view needs a nearer plane so that the model is not cut, a far one keeps the depth precision.
export const nearPlane = (distance) => clamp(fin(distance, 10) * 0.04, NEAR_MIN, NEAR_MAX);

// ---------------------------------------------------------------------------------------------------------------------------
// Fit. The distance and target that bring a whole box into the picture for a given turn and tilt, so that every azimuth shows the
// model whole (a wide plan seen end-on needs another distance than the same plan seen from the side).
const FIT_MIN = 0.5, FIT_MAX = 500; // metres
const BOX_KEYS = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// bounds: { minX, maxX, minY, maxY, minZ, maxZ } in metres, all storeys; the 8 corners of the box are fitted. state: only azimuth and
// polar are used. options: fov (vertical, degrees), aspect (width / height of the picture), margin (share of the half picture kept
// free on every side), points (optional list of [x, y, z] that is fitted instead of the eight corners of `bounds`), iterations (centring passes), bottom (share of the picture height, from the bottom edge, that bars cover, 0 to
// BOTTOM_MAX: the box is then fitted into the part above them), lift (true when the centre of the projection has been moved up to the middle of that
// free part, see liftOf: the target is then the middle of the box and the box is fitted into the free part around the centre, instead of the target being
// lowered below the box to push it up the picture). Returns { distance, target } with the distance within 0.5..500 m. Bad
// input gives the centre of whatever bounds are usable (else the origin) and the state's own distance: never NaN.
export const BOTTOM_MAX = 0.4;
// How far the centre of the projection is moved up for bars that cover this share of the picture height at the bottom, in picture units (half pictures):
// the free part then runs from -1 + 2 * lift to 1 and its middle, the point the camera looks at, sits `lift` above the centre of the picture.
export const liftOf = (cover) => clamp(fin(cover), 0, BOTTOM_MAX);
export function fitView(state, bounds, options) {
  const o = options ?? {}, b = bounds ?? {};
  const th = Math.tan((clamp(fin(o.fov, 27), 1, 150) * RAD) / 2), asp = clamp(Number.isFinite(o.aspect) && o.aspect > 0 ? o.aspect : 1.78, 0.1, 10);
  const k = 1 - clamp(fin(o.margin, 0.08), 0, 0.5), passes = clamp(Math.round(fin(o.iterations, 4)), 0, 12);
  // The free part of the picture runs from -1 + 2 * bt to 1 (y up, in half pictures): its middle sits bt above the centre. `up` and `dn` are how far a
  // point may go above and below the centre line once the margin is taken off. With the lift the centre line is the middle of the free part: up and dn are equal.
  const bt = clamp(fin(o.bottom, 0), 0, BOTTOM_MAX), lifted = !!o.lift;
  const up = lifted ? (1 - bt) * k : (1 - bt) * k + bt, dn = Math.max(0.02, lifted ? (1 - bt) * k : (1 - bt) * k - bt);
  const mid = (lo, hi) => (Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : 0);
  const centre = [mid(b.minX, b.maxX), mid(b.minY, b.maxY), mid(b.minZ, b.maxZ)];
  const fallback = { distance: clamp(fin(state?.distance, 10), FIT_MIN, FIT_MAX), target: centre };
  if (!BOX_KEYS.every((key) => Number.isFinite(b[key])) || b.minX > b.maxX || b.minY > b.maxY || b.minZ > b.maxZ) return fallback;

  // The camera axes exactly as rayFor builds them: forward f (towards the target), right r, up u.
  const az = wrapDegrees(state?.azimuth) * RAD, po = clamp(fin(state?.polar, 50), POLAR_MIN, POLAR_MAX) * RAD;
  const sa = Math.sin(az), ca = Math.cos(az), sp = Math.sin(po), cp = Math.cos(po);
  const f = [-sp * sa, -cp, -sp * ca], r = [ca, 0, -sa], u = [-cp * sa, sp, -cp * ca];
  const corners = [];
  const own = Array.isArray(o.points) ? o.points.filter((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) : [];
  if (own.length) corners.push(...own); // a list of points fitted instead of the eight corners (the open shell: the closed model and every wall lying flat)
  else for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) corners.push([x, y, z]);

  // For a target t: the smallest distance D at which every corner is inside the frame. A corner at v = c - t has the camera-space
  // offsets (v.r, v.u) and the depth D + v.f, and it fits while |v.r| <= k * depth * th * asp and |v.u| <= k * depth * th. Also where
  // the extent of the projected corners sits on the picture (mx, my, as tangents), for centring.
  const solve = (t) => {
    const local = corners.map((c) => { const v = [c[0] - t[0], c[1] - t[1], c[2] - t[2]]; return [dot3(v, r), dot3(v, u), dot3(v, f)]; });
    const need = Math.max(0, ...local.map(([x, y, z]) => Math.max(Math.abs(x) / (k * th * asp), y / (up * th), -y / (dn * th)) - z));
    const distance = clamp(need, FIT_MIN, FIT_MAX);
    if (!Number.isFinite(distance)) return null;
    if (local.some((p) => distance + p[2] < 1e-6)) return { distance, mx: 0, my: 0 }; // limited to 500 m, a corner is behind the camera: nothing to centre
    const xs = local.map((p) => p[0] / (distance + p[2])), ys = local.map((p) => p[1] / (distance + p[2]));
    return { distance, mx: (Math.min(...xs) + Math.max(...xs)) / 2, my: (Math.min(...ys) + Math.max(...ys)) / 2 - (lifted ? 0 : bt * th) }; // my: from the middle of the free part
  };

  // Start at the centre of the box; after each solve move the target across the picture by the offset of the extent's middle (at the
  // depth of the box centre) and solve again. Every pass is a valid fit, so the smallest distance seen is returned.
  let t = centre.slice(), best = null;
  for (let i = 0; i <= passes; i++) {
    const s = solve(t);
    if (!s) break;
    if (!best || s.distance < best.distance) best = { distance: s.distance, target: t };
    if (i === passes) break;
    const depth = s.distance + dot3([centre[0] - t[0], centre[1] - t[1], centre[2] - t[2]], f);
    if (!(depth > 1e-6)) break;
    t = [0, 1, 2].map((a) => t[a] + r[a] * s.mx * depth + u[a] * s.my * depth);
    if (!t.every(Number.isFinite)) break;
  }
  return best ? best : fallback;
}

// Where the lowest corner of a box lands on the picture for a camera in this state looking at `target`: -1 is the bottom edge, 1 the top
// (the vertical field of view does not matter for the answer except through fov). A box that cannot be projected gives -Infinity.
export function lowestOnPicture(state, target, bounds, fov = 27) {
  const b = bounds ?? {};
  if (!BOX_KEYS.every((key) => Number.isFinite(b[key])) || !target || target.length !== 3) return -Infinity;
  const az = wrapDegrees(state?.azimuth) * RAD, po = clamp(fin(state?.polar, 50), POLAR_MIN, POLAR_MAX) * RAD;
  const sa = Math.sin(az), ca = Math.cos(az), sp = Math.sin(po), cp = Math.cos(po);
  const f = [-sp * sa, -cp, -sp * ca], u = [-cp * sa, sp, -cp * ca], eye = positionOf({ azimuth: state.azimuth, polar: po / RAD, distance: fin(state.distance, 10) }, target);
  const th = Math.tan((clamp(fin(fov, 27), 1, 150) * RAD) / 2);
  let low = Infinity;
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
    const v = [x - eye[0], y - eye[1], z - eye[2]], depth = dot3(v, f);
    if (!(depth > 1e-6)) return -Infinity; // a corner behind the camera
    low = Math.min(low, dot3(v, u) / (depth * th));
  }
  return low;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Controller. Touch: one finger turns; two fingers zoom and move (the ground under the fingers stays under them); three fingers move. Mouse: the left
// button turns; the right or middle button, or Shift with the left button, moves; the wheel zooms towards the pointer. A double tap or double click goes back
// to the home view, the move included (400 ms); arrow keys turn by 15 degrees. A frame is asked for (onChange) only while something moves; at rest nothing is
// queued. The move (pan) is an offset of the target over the ground, limited to the box of the model grown by PAN_GROW. No storage, no network.
//   options: { element, home, target, fov, limits ({ minX, maxX, minZ, maxZ }), grow (share of the limits box that the target may go past it, PAN_GROW), lift (see toPicture), initial: { azimuth, polar, distance }, onChange(state, source),
//   onGesture({ kind: 'orbit' | 'pinch' | 'pan' | 'wheel' | 'key', pointerType }), request, now, keys }
export function createCameraController(options) {
  const { element, fov = 27, onChange = () => {}, onGesture = () => {}, request = (f) => requestAnimationFrame(f), now = () => performance.now() } = options;
  let target = options.target; // the home target: the point the camera looks at without a pan; setTarget moves it
  let home = makeState(options.home);
  let growBy = Number.isFinite(options.grow) ? options.grow : PAN_GROW; // how far past the box of `limits` the target may go, as a share of its size
  let limits = panLimits(options.limits, growBy); // where the target may be
  let lift = liftOf(options.lift); // how far above the middle of the element the centre of the projection sits (the camera looks at the middle of the free part)
  const pic = (rect, x, y) => toPicture(rect, x, y, lift);
  let pan = [0, 0]; // metres over the ground, added to the home target
  const start = options.initial ?? {};
  let state = { ...home, azimuth: wrapDegrees(fin(start.azimuth, home.azimuth)), polar: clamp(fin(start.polar, home.polar), POLAR_MIN, POLAR_MAX),
    distance: clamp(fin(start.distance, home.distance), home.base * ZOOM_MIN, home.base * ZOOM_MAX) }; // the start distance obeys the zoom limits
  let enabled = true, queued = false, anim = null, spin = null, tap = null, gesture = null;
  const pointers = new Map();
  const perPixel = () => 200 / Math.max(240, Math.min(element.clientWidth || 800, element.clientHeight || 800)); // degrees of turn per pixel dragged
  const eye = () => [target[0] + pan[0], target[1], target[2] + pan[1]]; // the point the camera looks at now: the home target and the pan
  const aspectOf = (rect) => (rect.width || 1) / (rect.height || 1);

  const emit = (source) => onChange(state, source);
  function schedule() { if (!queued) { queued = true; request(frame); } }
  function frame(ts) {
    queued = false;
    const t = Number.isFinite(ts) ? ts : now();
    if (anim) {
      const k = (t - anim.t0) / RESET_MS;
      state = blend(anim.from, anim.to, k); pan = blendPan(anim.pan, [0, 0], k);
      if (k >= 1) { state = anim.to; pan = [0, 0]; anim = null; }
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

  function reset(animate = true) { // back to the home view: the turn, the zoom and the pan
    stopMotion();
    if (!animate) { state = home; pan = [0, 0]; emit('reset'); return; }
    anim = { from: state, to: home, pan: pan.slice(), t0: now() }; schedule();
  }
  function set(next, source = 'api') {
    stopMotion();
    state = { ...state, azimuth: wrapDegrees(fin(next.azimuth, state.azimuth)), polar: clamp(fin(next.polar, state.polar), POLAR_MIN, POLAR_MAX), distance: clamp(fin(next.distance, state.distance), state.base * ZOOM_MIN, state.base * ZOOM_MAX) };
    emit(source);
  }

  // Look at another point (a refitted view): three finite numbers, else nothing changes and false comes back. It does not ask for a
  // frame: the caller redraws.
  function setTarget(next) {
    if (!next || next.length !== 3 || ![0, 1, 2].every((i) => Number.isFinite(next[i]))) return false;
    target = [next[0], next[1], next[2]]; pan = clampPan(pan, target, limits); return true;
  }

  // The box that the target may go to: this box grown by `grow` (PAN_GROW unless given, and then kept) of its size on every side. Bad input takes the limit away.
  // A view that is past the new limit is brought back at once; the caller moves the three.js camera when `target` changed.
  function setLimits(box, grow) { if (Number.isFinite(grow)) growBy = grow; limits = panLimits(box, growBy); pan = clampPan(pan, target, limits); }

  // A new default distance (the window changed shape): the turn stays, the zoom keeps its ratio to the default, the pan stays as it was from the new home.
  function rehome(next) {
    const h = makeState(next), ratio = h.base / state.base;
    home = h; state = { ...state, base: h.base, distance: clamp(state.distance * ratio, h.base * ZOOM_MIN, h.base * ZOOM_MAX) };
    if (anim) anim = { ...anim, to: home };
  }

  // One step of a gesture: zoom by `factor` about the picture point `from`, which moves to `to`; the ground under it follows. Asks for a frame through onChange.
  function view(factor, from, to, aspect, info) {
    const next = factor !== 1 ? zoom(state, factor) : state;
    const shift = panShift(state, next, eye(), fov, aspect, from, to);
    pan = clampPan([pan[0] + shift[0], pan[1] + shift[1]], target, limits); state = next;
    onGesture(info); emit('user');
  }

  // pointers: the reference of a multi-finger gesture (the middle of the fingers and the distance of two) is taken again whenever a finger goes down or up
  const middle = () => { const a = [...pointers.values()]; return { x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length }; };
  const refer = () => {
    if (!gesture) return;
    gesture.mid = middle();
    const a = [...pointers.values()]; gesture.pinch = a.length === 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
  };
  const onDown = (e) => {
    const mouse = e.pointerType === 'mouse';
    if (!enabled || (mouse && e.button > 2)) return;
    stopMotion();
    if (e.isPrimary) { // a first finger (or the mouse) cannot go down while another pointer of its kind is: whatever is kept from before is stale (a missed pointerup)
      for (const [id, p] of pointers) if (p.type === e.pointerType) pointers.delete(id);
      if (!pointers.size) gesture = null;
    }
    if (mouse && e.button !== 0) e.preventDefault?.(); // no autoscroll on the middle button
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { element.setPointerCapture(e.pointerId); } catch {}
    const t = now();
    if (pointers.size === 1) gesture = { t0: t, x0: e.clientX, y0: e.clientY, moved: 0, last: t, vx: 0, vy: 0, pinch: 0, mid: null, multi: false, type: e.pointerType, pan: mouse && (e.button !== 0 || !!e.shiftKey) };
    else if (gesture) gesture.multi = true; // a second finger: never a tap or a flick, and the finger that stays after the others lift does not turn the model
    refer();
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId); if (!p || !enabled || !gesture) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, rect = element.getBoundingClientRect(), aspect = aspectOf(rect); p.x = e.clientX; p.y = e.clientY;
    if (pointers.size >= 2) { // two fingers zoom and move, three or more move with their middle
      const mid = middle(), a = [...pointers.values()], two = a.length === 2, d = two ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
      const factor = two && gesture.pinch >= PINCH_MIN && d > 0 ? d / gesture.pinch : 1, from = gesture.mid; // fingers closer than PINCH_MIN only jitter: no zoom from them
      gesture.pinch = d; gesture.mid = mid;
      if (factor !== 1 || mid.x !== from.x || mid.y !== from.y) view(factor, pic(rect, from.x, from.y), pic(rect, mid.x, mid.y), aspect, { kind: factor !== 1 ? 'pinch' : 'pan', pointerType: gesture.type });
      return;
    }
    if (gesture.multi) return; // the one finger that is left of a multi-finger gesture does nothing until it is lifted
    gesture.moved += Math.hypot(dx, dy);
    if (gesture.pan) { // the mouse moves the model: the ground under the pointer follows it, from the first pixel (no click ever resets or turns)
      view(1, pic(rect, e.clientX - dx, e.clientY - dy), pic(rect, e.clientX, e.clientY), aspect, { kind: 'pan', pointerType: gesture.type });
      return;
    }
    if (gesture.moved < slopOf(gesture)) return; // a tap is not a drag
    const k = perPixel(), t = now(), dt = Math.max(1, t - gesture.last); gesture.last = t;
    state = orbit(state, dx * k, dy * k);
    gesture.vx = 0.6 * gesture.vx + 0.4 * ((dx * k) / dt); gesture.vy = 0.6 * gesture.vy + 0.4 * ((dy * k) / dt);
    onGesture({ kind: 'orbit', pointerType: gesture.type }); emit('user');
  };
  const onUp = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    try { element.releasePointerCapture(e.pointerId); } catch {}
    const g = gesture, t = now();
    if (pointers.size > 0) { refer(); return; }
    gesture = null; if (!g || !enabled || g.pan) return;
    if (!g.multi && g.moved < slopOf(g) && t - g.t0 < 350) { // a tap: two close taps are a double tap
      if (tap && t - tap.t < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) { tap = null; reset(true); } else tap = { t, x: e.clientX, y: e.clientY };
    } else if (!g.multi && g.moved >= slopOf(g) && t - g.last < 80 && Math.hypot(g.vx, g.vy) > 0.02) { spin = { vx: g.vx, vy: g.vy, last: t }; schedule(); }
  };
  const onCancel = (e) => { pointers.delete(e.pointerId); if (!pointers.size) gesture = null; else refer(); };
  const onWheel = (e) => { // zooms towards the pointer: the ground point under it stays under it
    if (!enabled) return;
    e.preventDefault();
    const dy = (e.deltaMode === 1 ? 16 : 1) * fin(e.deltaY), step = e.ctrlKey ? 0.01 : 0.0012; // a pinch on a trackpad arrives as ctrl + wheel
    const rect = element.getBoundingClientRect(), at = pic(rect, fin(e.clientX, rect.left + (rect.width || 0) / 2), fin(e.clientY, rect.top + (rect.height || 0) / 2));
    stopMotion(); view(Math.exp(-clamp(dy, -400, 400) * step), at, at, aspectOf(rect), { kind: 'wheel', pointerType: 'mouse' });
  };
  const onContext = (e) => { if (enabled) e.preventDefault?.(); }; // the right button moves the model: no menu over the picture

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
    stopMotion(); state = next; e.preventDefault?.(); onGesture({ kind: 'key' }); emit('user'); return true;
  };

  element.style.touchAction = 'none'; element.style.userSelect = 'none'; element.style.webkitUserSelect = 'none';
  element.addEventListener('pointerdown', onDown); element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp); element.addEventListener('pointercancel', onCancel);
  element.addEventListener('wheel', onWheel, { passive: false }); element.addEventListener('contextmenu', onContext);
  const keyHost = options.keys ?? (typeof window !== 'undefined' ? window : null);
  keyHost?.addEventListener('keydown', onKey);
  // A finger whose pointerup or pointercancel never came (a system gesture, a switch to another app) would stay in `pointers` for good and turn every later
  // one-finger drag into a two-finger one: the window losing the focus or the page going to the background lets go of all of them.
  const win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null;
  const dropPointers = () => { if (pointers.size || gesture) { pointers.clear(); gesture = null; } };
  const onHide = () => { if (doc?.visibilityState === 'hidden') dropPointers(); };
  win?.addEventListener('blur', dropPointers); doc?.addEventListener('visibilitychange', onHide);

  return {
    get state() { return state; },
    get home() { return home; },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!enabled) { stopMotion(); pointers.clear(); gesture = null; } },
    get busy() { return queued || !!anim || !!spin; },
    get target() { return eye(); }, // what the camera looks at now: the home target and the pan
    get homeTarget() { return [...target]; },
    get pan() { return [...pan]; }, // metres [x, z] over the ground
    get limits() { return limits ? { ...limits } : null; },
    get lift() { return lift; },
    // The centre of the projection moved (the bars changed size, the window changed shape): the caller moves the projection of its camera by the same amount and redraws.
    setLift(next) { lift = liftOf(next); },
    position: () => positionOf(state, eye()),
    reset, set, rehome, setTarget, setLimits,
    // The ray under a pointer event, for picking: { origin, direction } in world space.
    pointerToRay(event) {
      const r = element.getBoundingClientRect(), p = pic(r, event.clientX, event.clientY);
      return rayFor(state, eye(), fov, aspectOf(r), p[0], p[1]);
    },
    // The ground point [x, z] under a client point (null near the horizon): for picking and for test tools.
    groundAt(clientX, clientY) {
      const r = element.getBoundingClientRect(), p = pic(r, clientX, clientY);
      return groundPoint(state, eye(), fov, aspectOf(r), p[0], p[1]);
    },
    key: onKey,
    dispose() {
      stopMotion(); element.removeEventListener('pointerdown', onDown); element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp); element.removeEventListener('pointercancel', onCancel); element.removeEventListener('wheel', onWheel); element.removeEventListener('contextmenu', onContext);
      keyHost?.removeEventListener('keydown', onKey); win?.removeEventListener('blur', dropPointers); doc?.removeEventListener('visibilitychange', onHide);
    },
  };
}

// A multiplier (1 to 1.3) for the fill light by the azimuth of the view: exactly 1 for views from the south side (the default view included) and growing
// to 1.3 when the model is seen from the north, where the inside of the far wall faces away from the sun.
export function fillBoost(azimuth) {
  const c = Math.cos(((Number(azimuth) || 0) - 180) * Math.PI / 180), x = Math.min(1, Math.max(0, (c - 0.3) / 0.6));
  return 1 + 0.3 * x * x * (3 - 2 * x);
}
