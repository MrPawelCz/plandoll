// The motion of "open the shell" (#shell=1): the outer walls fall outward round their foot line like the sides of a paper model.
// This file is the clock and the curves only: when each wall starts, how far it has turned, how tall it stands while it turns, and the order
// the walls go in. One clock p (0 closed, 1 open) runs forward to open and backward to close, so closing is the same motion in reverse.
// Pure: no scene, no DOM, no timers; tested in Node.

export const TOTAL_MS = 3000; // from the first wall starting to the last wall at rest
export const OPEN_DEG = 90; // a wall lies flat
export const OVERSHOOT_DEG = 4; // it swings this far past flat before it settles back
export const STAGGER_MIN_MS = 80; // gap between the starts of two walls that go one after the other
export const STAGGER_MAX_MS = 150;
const SPREAD_TARGET_MS = 600; // the gaps of all walls add up to about this
const SPREAD_MAX_MS = 1200; // and never to more than this, however many walls there are
export const GROW_END = 0.4; // a wall that the cutaway holds low stands at full height by this share of its own time
const PEAK = 0.78; // the share of a wall's own time at which the overshoot is greatest

const clamp = (v, a, b) => (Number.isNaN(v) ? a : Math.min(b, Math.max(a, v)));
const smooth = (x) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };

// The gap in ms between the starts of two walls that follow each other, for n walls.
export function staggerGap(n) {
  if (!(n > 1)) return 0;
  return Math.min(clamp(SPREAD_TARGET_MS / (n - 1), STAGGER_MIN_MS, STAGGER_MAX_MS), SPREAD_MAX_MS / (n - 1));
}

// The time of one wall as 0..1, from the clock p (0..1) and the rank of the wall (0 starts first) among n walls.
export function wallTime(p, rank, n) {
  const gap = staggerGap(n), spread = gap * Math.max(0, n - 1), each = TOTAL_MS - spread;
  return clamp((clamp(p, 0, 1) * TOTAL_MS - rank * gap) / each, 0, 1);
}

// How far a wall has turned as a share of OPEN_DEG: a cubic ease-out that runs past 1 by the overshoot, then eases back to exactly 1.
export function turnFraction(k) {
  const x = clamp(k, 0, 1), o = OVERSHOOT_DEG / OPEN_DEG;
  if (x <= PEAK) return (1 + o) * (1 - Math.pow(1 - x / PEAK, 3));
  return 1 + o * (1 - smooth((x - PEAK) / (1 - PEAK)));
}

// How far a wall that is held low has grown towards its full height, 0..1.
export const growFraction = (k) => smooth(clamp(k, 0, 1) / GROW_END);

// Everything one wall needs at clock p: its time, its angle in degrees (0 closed, 90 flat) and its growth.
export function frameOf(p, rank, n) {
  const k = wallTime(p, rank, n);
  return { k, deg: turnFraction(k) * OPEN_DEG, grow: growFraction(k) };
}

// The clock moves towards its target (1 open, 0 closed) by dtMs of the whole motion; a stalled or negative step changes nothing.
export function stepClock(p, target, dtMs) {
  const goal = target ? 1 : 0, d = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0, step = d / TOTAL_MS;
  const now = clamp(Number.isFinite(p) ? p : 0, 0, 1);
  return now < goal ? Math.min(goal, now + step) : now > goal ? Math.max(goal, now - step) : now;
}

// 'closed', 'opening', 'open' or 'closing', from the clock and the target.
export function modeOf(p, target) {
  if (!target) return p > 0 ? 'closing' : 'closed';
  return p < 1 ? 'opening' : 'open';
}

// The order the walls start in: the walls that face the camera first, then the sides, then the far ones. walls: [{ out: [x, z], level, id }];
// view: the horizontal direction from the model towards the camera as [x, z]. Returns the rank of every wall (0 first) in the order of `walls`.
export function startOrder(walls, view) {
  const vx = Number.isFinite(view?.[0]) ? view[0] : 0, vz = Number.isFinite(view?.[1]) ? view[1] : 1;
  const keyed = walls.map((w, i) => ({ i, d: Math.round((w.out[0] * vx + w.out[1] * vz) * 1000), level: w.level ?? 0, id: String(w.id ?? i) }));
  keyed.sort((a, b) => b.d - a.d || a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.i - b.i);
  const rank = new Array(walls.length);
  keyed.forEach((e, r) => { rank[e.i] = r; });
  return rank;
}
