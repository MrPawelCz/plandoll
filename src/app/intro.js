// The intro of the plain page: when the page has drawn its first frame the first model builds itself in front of the visitor. The plan is empty, the walls rise, the windows
// and the doors come, then the furniture drops in room by room, and the camera comes down from above to the view the page starts with. Pure functions, no DOM and
// no three.js, tested in Node; src/render/buildup.js moves the scene by them and src/app/introview.js draws the line to skip and takes the skip.
// Everything is a function of the time t in seconds since the intro began (never of the number of frames drawn), so a slow device shows the same story, not a longer one.
// The whole intro lasts at most INTRO.maxS seconds; a plan with fewer or more pieces than the example scales the furniture part, between a floor and a ceiling.

export const INTRO = Object.freeze({
  maxS: 8, // the longest an intro may last, whatever the plan
  minS: 4.2, // and the shortest, so that a plan with little furniture does not flash by
  failsafeS: 15, // the page ends the intro by itself after this many seconds, whatever went wrong
  hintS: 3.5, // how long "Tap to skip" stays
  fadeS: 0.35, // the control bar fades in over the last this many seconds of the intro
  minFps: 15, // below this many frames a second over a second the intro jumps to its end
  azSweep: 24, // degrees the camera turns round the model on its way down
  fromPolar: 13, // the first view looks almost straight down (the camera keeps 12 degrees at least)
  fromZoom: 0.9, // and starts a little nearer than the view it ends in
  walls: Object.freeze({ start: 0.25, wave: 1.0, dur: 1.1, power: 2.6 }),
  openings: Object.freeze({ start: 1.6, wave: 0.7, dur: 0.4 }),
  furnitureStart: 2.3,
  perPiece: 0.1029, // seconds of the furniture part for each piece (35 pieces take 3.6 s)
  furnitureMin: 1.3, furnitureMax: 4.6,
  piece: Object.freeze({ dropH: 0.9, fall: 0.22, bounce: 0.16, pop: 0.3, roomGap: 0.1, accel: 0.45 }),
  hold: 1.0, // seconds the finished model rests before the end
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
export const easeOut = (k, p = 3) => 1 - Math.pow(1 - clamp01(k), p);
export const backOut = (k, s = 1.70158) => { const u = clamp01(k) - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
export const smooth = (k) => { const u = clamp01(k); return u * u * (3 - 2 * u); };
export const sine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(k));

// ---------- whether the intro runs at all ----------
// The intro belongs to a plain page that opens with a picture of its own: not the editor (edit=1), not a picture without controls (ui=0, the pages that tools and films
// shoot), not live=1 (frames drawn only on request, as a film capture does), not when the address says intro=0, and not when the visitor asked the system for less motion.
// env: { reducedMotion }. Returns { run, why } where why names the reason for not running ('off', 'editor', 'no-ui', 'live', 'reduced-motion') or is ''.
export function introWanted(params, env = {}) {
  const why = !params?.intro ? 'off' : params.edit ? 'editor' : !params.ui ? 'no-ui' : params.live ? 'live' : env.reducedMotion ? 'reduced-motion' : '';
  return { run: why === '', why };
}

// ---------- the words ----------
// Two lines only: "Tap to skip" and the label of the loading icon. The picture carries no caption of its own: the names of the stages (EMPTY PLAN, WALLS, WINDOWS AND DOORS,
// FURNITURE, READY) and the counter ("piece 7 of 35") of the first version were taken away on request (27 October 2026): everybody sees what is being built, and the words
// only took the eye off it.
export const INTRO_TEXT = Object.freeze({
  en: Object.freeze({ skip: 'Tap to skip', loading: 'Loading' }),
  pl: Object.freeze({ skip: 'Dotknij, aby pominąć', loading: 'Wczytywanie' }),
});
export const introText = (lang) => INTRO_TEXT[lang === 'pl' ? 'pl' : 'en'];

// ---------- the timeline ----------
// pieces: how many pieces of furniture the picture shows when the intro is over. Returns the times (seconds) of every stage:
//   walls / openings: { start, wave, dur, power } as in INTRO (a wall starts at start + wave * its place in the wave and takes dur to rise),
//   furniture: { start, end } (end is when the last piece has landed),
//   readyAt: when the camera has arrived and the model stands complete, total: when the intro ends (INTRO.minS to INTRO.maxS).
export function introTimeline(pieces) {
  const n = Math.max(0, Math.floor(Number(pieces)) || 0);
  const W = INTRO.walls, O = INTRO.openings, fStart = INTRO.furnitureStart;
  const span = n ? clamp(n * INTRO.perPiece, INTRO.furnitureMin, INTRO.furnitureMax) : 0;
  const fEnd = n ? fStart + span : fStart;
  const readyAt = n ? fEnd + 0.1 : O.start + O.wave + O.dur + 0.1;
  const total = clamp(readyAt + INTRO.hold, INTRO.minS, INTRO.maxS);
  return { pieces: n, walls: { ...W }, openings: { ...O }, furniture: { start: fStart, end: fEnd }, readyAt, total };
}

// The "Tap to skip" line: there for the first INTRO.hintS seconds, faded in and out.
export const hintOpacity = (t) => clamp01(t / 0.4) * clamp01((INTRO.hintS - t) / 0.4);
// 0 before the intro ends, 1 after: how far the control bar has come back (it fades in over the last INTRO.fadeS seconds of the intro).
export const barOpacity = (t, tl) => clamp01((t - (tl.total - INTRO.fadeS)) / INTRO.fadeS);

// ---------- the walls ----------
// The height of a wall at time t as a share of its full height: 0 until its time, then it rises with a soft stop.
export const wallRise = (t, t0, dur, power) => easeOut((t - t0) / dur, power);
// Where a wall stands in the wave that runs across the plan from the north-west corner to the south-east one: 0 to 1.
export function waveOf(x, z, ext) {
  const w = ext.maxX - ext.minX || 1, d = ext.maxZ - ext.minZ || 1;
  return clamp01(((x - ext.minX) / w + (z - ext.minZ) / d) / 2);
}

// ---------- the furniture ----------
// starts: the time every piece lands, in the order of the pieces. first[i] is true for the first piece of a room (a little pause before it). The spacing shrinks along the
// sequence, so the pieces come faster and faster; the last piece lands at furniture.end.
export function pieceStarts(first, tl) {
  const n = first.length, P = INTRO.piece;
  if (!n) return [];
  const { start, end } = tl.furniture, span = Math.max(0.1, end - start - (P.fall + P.bounce)), unit = span / n;
  const weights = first.map((f, i) => (i === 0 ? 0 : 1 + P.accel - (2 * P.accel * i) / Math.max(1, n - 1) + (f ? P.roomGap / unit : 0)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => { acc += w; return start + (span * acc) / sum; });
}
// How a piece looks u seconds after its time: { on, dy, sx, sy, sz }. A piece that stands on the floor (drop) falls from INTRO.piece.dropH metres, squashes a little
// and settles; a hung or flat piece grows in with a small overshoot (flat: only along the floor). From fall + bounce seconds on it is exactly at rest: dy 0, scale 1.
export function pieceMotion(u, drop, flat = false) {
  const P = INTRO.piece;
  if (!(u >= 0)) return { on: false, dy: 0, sx: 1, sy: 1, sz: 1 };
  if (drop) {
    if (u < P.fall) { const k = u / P.fall, s = 0.7 + 0.3 * smooth(k / 0.5); return { on: true, dy: P.dropH * (1 - k * k), sx: s, sy: s, sz: s }; }
    const v = clamp01((u - P.fall) / P.bounce), r = Math.pow(1 - v, 3);
    return { on: true, dy: 0.07 * 4 * v * (1 - v), sx: 1 + 0.05 * r, sy: 1 - 0.1 * r, sz: 1 + 0.05 * r };
  }
  const s = Math.max(0.001, backOut(u / P.pop, 1.9));
  return flat ? { on: true, dy: 0, sx: s, sy: 1, sz: s } : { on: true, dy: 0, sx: s, sy: s, sz: s };
}
// In what order a piece comes: what lies flat first, then what stands, what stands on it, what hangs on a wall, and last what hangs in a window (mode: the placement mode of
// the piece, see furniture/specs.js).
export function pieceRank(mode) {
  return mode === 'floor-flat' ? 0 : mode === 'floor' || mode === 'corner' ? 1 : mode === 'surface' ? 2 : mode === 'wall-mount' ? 3 : mode === 'window' ? 4 : 5;
}
// The pieces are dealt out by room: the room with the most pieces first (ties by name), and in each room by rank, then by the larger footprint, then by id.
// items: [{ id, room, rank, area }]; returns the ids in the order of the intro and, for each, whether it opens a room.
export function pieceOrder(items) {
  const rooms = new Map();
  for (const it of items) { if (!rooms.has(it.room)) rooms.set(it.room, []); rooms.get(it.room).push(it); }
  const keys = [...rooms.keys()].sort((a, b) => rooms.get(b).length - rooms.get(a).length || (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (const k of keys) {
    const list = rooms.get(k).slice().sort((a, b) => a.rank - b.rank || b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    list.forEach((it, i) => out.push({ id: it.id, room: k, first: i === 0 }));
  }
  return out;
}

// ---------- the camera ----------
// The view at time t, from `from` to `to` (both { azimuth, polar, distance }): the turn and the zoom move together over the whole way, the tilt a little sooner, so that
// the last moments rest in the view the page starts with. At readyAt the camera is exactly at `to`.
export function cameraAt(t, tl, from, to) {
  const k = clamp01(t / tl.readyAt), kp = clamp01(t / (tl.readyAt * 0.9));
  if (k >= 1) return { azimuth: to.azimuth, polar: to.polar, distance: to.distance };
  return { azimuth: from.azimuth + (to.azimuth - from.azimuth) * sine(k), polar: from.polar + (to.polar - from.polar) * sine(kp), distance: from.distance + (to.distance - from.distance) * k };
}
// How far the picture has been moved up to leave room for the control bar, as a share of what the page's starting view has (0 to 1): the control bar is not there while the intro plays, so the model
// stands in the middle of the window, and it glides up into its place in the second half of the way down, as the bar is about to come back. It is exactly 1 when the camera has arrived.
export function liftAt(t, tl) {
  return smooth((t - tl.readyAt * 0.5) / (tl.readyAt * 0.5));
}
// The view the camera starts in for a view it ends in.
export function cameraFrom(to) {
  return { azimuth: to.azimuth - INTRO.azSweep, polar: INTRO.fromPolar, distance: to.distance * INTRO.fromZoom };
}

// ---------- slow devices ----------
// Feed it the time of every frame (ms). It says true once the frames come slower than minFps over the last second, after a short grace period, and then the page jumps to the end.
export function createFpsGuard({ minFps = INTRO.minFps, windowMs = 1000, graceMs = 600 } = {}) {
  const stamps = []; let first = null;
  return {
    push(ts) {
      if (first === null) first = ts;
      stamps.push(ts);
      while (stamps.length > 1 && ts - stamps[0] > windowMs) stamps.shift();
      if (ts - first < graceMs + windowMs) return false;
      const span = ts - stamps[0];
      return span >= windowMs * 0.8 && ((stamps.length - 1) * 1000) / span < minFps;
    },
  };
}

// ---------- the skip ----------
// A key skips the intro, except the modifier keys on their own and any key with Ctrl, Cmd or Alt (a browser shortcut stays the browser's).
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super']);
export function skipKey(e) {
  return !!e && !e.ctrlKey && !e.metaKey && !e.altKey && typeof e.key === 'string' && !MODIFIERS.has(e.key);
}

// Keys that belong to the browser or the system: F1 to F24 (reload, full screen, the tools), Tab (the focus), the menu and print keys, the media, volume and browser keys, and the keys that a layout or a phone's
// keyboard reports without a name (dead keys, composition). They still end the intro (the visitor is here and doing something) but the page does not take them: F5 reloads, F12 opens the tools, Tab moves the focus.
const OWN_KEYS = /^(F([1-9]|1\d|2[0-4])|Tab|ContextMenu|PrintScreen|Dead|Process|Unidentified|Audio\w+|Volume\w+|Media\w+|Browser\w+|Launch\w+)$/;
export function keyLeftAlone(e) {
  return !!e && typeof e.key === 'string' && OWN_KEYS.test(e.key);
}
