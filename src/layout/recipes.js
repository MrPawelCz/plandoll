// Recipes: what goes into each type of room, in order. Sizes, clearances and allowed rooms come from src/furniture/specs.js.
// Every recipe gets the stage R made by engine.js and only asks for placements; R decides whether a spot is free.
import { SPEC_BY_ID } from '../furniture/specs.js';
import { frontOf, axisOf, rotFromFront, freeIntervals, onNorthOrWestWall } from './geometry.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const longest = (e, windows) => freeIntervals(e, { pad: 0.04, windows, minLen: 0.2 })[0]?.reduce((a, b) => b - a) ?? 0;
const centreOf = (p) => [p.x, p.y];

// True when the front of the sofa points at the television within MAX_SOFA_TURN degrees.
const MAX_SOFA_TURN = 24;
function facesTv(sofa, unit) {
  const [fx, fy] = frontOf(sofa.rot);
  const dx = unit.x - sofa.x, dy = unit.y - sofa.y, l = Math.hypot(dx, dy);
  return l < 1e-6 || (fx * dx + fy * dy) / l >= Math.cos((MAX_SOFA_TURN * Math.PI) / 180);
}

function pairScore(e) { return longest(e, true) - 0.8 * e.windows.length - 0.3 * e.doors.length; }

// Chairs around a table (4 or 6), facing it. Returns the chairs placed.
function chairsAround(R, table, n, strict = false) {
  const [ux, uy] = axisOf(table.rot), [fx, fy] = frontOf(table.rot);
  const [w, d] = table.size, cs = SPEC_BY_ID['dining-chair'].size;
  const spots = [];
  for (const side of [1, -1]) for (const k of [-1, 1]) spots.push({ lat: k * w * 0.25, off: side * (d / 2 + cs[1] / 2 + 0.03), face: -side });
  if (n >= 6) for (const side of [1, -1]) spots.push({ lat: side * (w / 2 + cs[1] / 2 + 0.03), off: 0, end: -side });
  const out = [];
  for (const s of spots) {
    let x, y, front;
    if (s.end !== undefined) { x = table.x + ux * s.lat; y = table.y + uy * s.lat; front = [ux * s.end, uy * s.end]; }
    else { x = table.x + ux * s.lat + fx * s.off; y = table.y + uy * s.lat + fy * s.off; front = [fx * s.face, fy * s.face]; }
    const c = R.at('dining-chair', { x, y, rot: rotFromFront(front[0], front[1]), partners: [table], noClear: !strict });
    if (c) out.push(c);
  }
  return out;
}

// With `strict` the table and the chairs also keep out of the free strips in front of the pieces already there (a kitchen run).
function diningSet(R, { chairs, long = 1.6, strict = false }) {
  if (!R.can('dining-table')) return null;
  const rotLong = R.bbox.w >= R.bbox.h ? 0 : 90;
  const minClear = 0.55;
  for (const wTable of [long, 1.4, 1.2]) {
    for (const pt of R.roomyPoints(minClear, 40)) {
      for (const rot of [rotLong, (rotLong + 90) % 360]) {
        const mk = R.mark();
        const table = R.at('dining-table', { x: pt.x, y: pt.y, rot, size: { w: wTable }, noClear: !strict });
        if (!table) continue;
        const cs = chairsAround(R, table, chairs, strict);
        if (cs.length >= Math.min(4, chairs)) {
          R.at('pendant', { x: table.x, y: table.y, rot, noClear: true });
          return { table, chairs: cs };
        }
        R.rollback(mk);
      }
    }
  }
  return null;
}

// Every room where people sit or sleep gets at least one light: when the recipe has not placed a lamp, a standing lamp goes in the
// corner closest to `near` and, if no corner is free, a pendant hangs over the roomiest floor.
const LIGHTS = ['floor-lamp', 'table-lamp', 'pendant'];
function ensureLight(R, near) {
  if (R.mine.some((p) => LIGHTS.includes(p.type))) return;
  const order = near ? (a, b) => (a.v[0] - near[0]) ** 2 + (a.v[1] - near[1]) ** 2 - ((b.v[0] - near[0]) ** 2 + (b.v[1] - near[1]) ** 2) : undefined;
  if (R.corner('floor-lamp', { anyRoom: true, noClear: true, order })) return;
  const pt = R.roomyPoints(0.3, 1)[0] ?? { x: R.bbox.minX + R.bbox.w / 2, y: R.bbox.minY + R.bbox.h / 2 };
  R.at('pendant', { x: pt.x, y: pt.y, rot: 0, noClear: true });
}

function livingRecipe(R) {
  const sofaSpecW = SPEC_BY_ID.sofa3.size[0];
  // a living room under 16 m2 gets a sofa bed first (it is also where a guest sleeps); an ordinary sofa is the fallback
  const bedFirst = R.area < 16 && R.can('sofa-bed');
  const sofaOpts = (t) => (t === 'sofa-bed' ? { size: { w: R.area < 12 ? 1.6 : 1.8 } } : {});
  const sofaTypes = (wide) => [...(bedFirst ? ['sofa-bed'] : []), ...(wide ? ['sofa3', 'sofa2'] : ['sofa2'])];
  const tvEdges = R.edgesBy(pairScore).filter((e) => e.len >= 1.8).slice(0, 5);
  let sofa = null, ct = null;
  let firstUnit = null;
  // first pass: the sofa must face the television; second pass: any sofa that fits
  for (const strict of [true, false]) {
    if (sofa) break;
    for (const tvEdge of tvEdges) {
      const mk = R.mark();
      const unit = R.wall('tv-unit', { edges: [tvEdge], align: 'center', soft: false });
      if (!unit) continue;
      if (!firstUnit) firstUnit = { edge: tvEdge };
      R.on(unit, 'tv', { dy: -(unit.size[1] / 2 - SPEC_BY_ID.tv.size[1] / 2 - 0.04) });
      // sofa wall: faces the television wall, as far away as the room allows
      const opposite = R.edges.filter((e) => dot(e.n, tvEdge.n) < -0.9);
      const ordered = opposite.slice().sort((a, b) => pairScore(b) - pairScore(a));
      for (const e of ordered) {
        const dist = Math.abs(dot([e.a[0] - tvEdge.a[0], e.a[1] - tvEdge.a[1]], tvEdge.n));
        if (dist < 2.3) continue;
        const wide = longest(e, false) >= sofaSpecW + 1.3 && R.can('sofa3');
        for (const t of sofaTypes(wide)) {
          sofa = R.wall(t, { edges: [e], around: centreOf(unit), margin: 0.3, margins: [0.3, 0.02], partners: [unit], accept: strict ? (p) => facesTv(p, unit) : undefined, ...sofaOpts(t) });
          if (sofa) break;
        }
        if (sofa) break;
      }
      if (!sofa) {
        // floating sofa facing the television; in the first pass also nearer to it and shifted sideways (never turned away)
        const [fx, fy] = frontOf(unit.rot), [ux, uy] = axisOf(unit.rot);
        float: for (const away of strict ? [2.7, 2.3, 2.0, 1.8] : [2.7, 2.3]) {
          for (const lat of strict ? [0, 0.4, -0.4, 0.8, -0.8] : [0]) {
            const x = unit.x + fx * (unit.size[1] / 2 + away) + ux * lat, y = unit.y + fy * (unit.size[1] / 2 + away) + uy * lat;
            const rot = rotFromFront(-fx, -fy);
            if (!facesTv({ x, y, rot }, unit)) continue;
            for (const t of sofaTypes(false)) { sofa = R.at(t, { x, y, rot, partners: [unit], soft: true, ...sofaOpts(t) }); if (sofa) break float; }
          }
        }
      }
      if (sofa) break;
      R.rollback(mk);
    }
  }
  if (!sofa && firstUnit) {
    const unit = R.wall('tv-unit', { edges: [firstUnit.edge], align: 'center', soft: false });
    if (unit) {
      R.on(unit, 'tv', { dy: -(unit.size[1] / 2 - SPEC_BY_ID.tv.size[1] / 2 - 0.04) });
      for (const t of sofaTypes(false)) { sofa = R.wall(t, { avoidWindows: false, soft: true, partners: [unit], ...sofaOpts(t) }); if (sofa) break; }
    }
  }
  if (!sofa) for (const t of sofaTypes(false)) { sofa = R.wall(t, { soft: true, ...sofaOpts(t) }); if (sofa) break; }
  if (sofa) {
    const [fx, fy] = frontOf(sofa.rot);
    const cts = SPEC_BY_ID['coffee-table'].size;
    outer: for (const size of [undefined, { w: 0.8, d: 0.5 }]) {
      const ch = size ? size.d : cts[1];
      for (const lat of [0, 0.3, -0.3, 0.6, -0.6]) {
        for (const gap of [0.4, 0.3, 0.25]) {
          const [ux0, uy0] = axisOf(sofa.rot);
          const dd = sofa.size[1] / 2 + gap + ch / 2;
          ct = R.at('coffee-table', { x: sofa.x + fx * dd + ux0 * lat, y: sofa.y + fy * dd + uy0 * lat, rot: sofa.rot, size, partners: [sofa], noClear: true });
          if (ct) break outer;
        }
      }
    }
    // rug under the front of the sofa and the table
    let rugDone = false;
    const rugD = ct ? 0.35 + gapTo(sofa, ct) + ct.size[1] + 0.35 : 1.5;
    for (const k of [1, 0.9, 0.8, 0.7, 0.6]) {
      const wRug = clamp(Math.max(sofa.size[0], ct ? ct.size[0] + 0.8 : 1.6) * k, 1.2, 3.4), dRug = clamp(rugD * k, 0.8, 2.6);
      const cx = sofa.x + fx * (sofa.size[1] / 2 - 0.35 + dRug / 2), cy = sofa.y + fy * (sofa.size[1] / 2 - 0.35 + dRug / 2);
      if (R.at('rug', { x: cx, y: cy, rot: sofa.rot, size: { w: wRug, d: dRug }, noClear: true })) { rugDone = true; break; }
    }
    if (!rugDone && ct) {
      for (const k of [1, 0.85, 0.7]) if (R.at('rug', { x: ct.x, y: ct.y, rot: sofa.rot, size: { w: Math.max(1.2, (ct.size[0] + 0.7) * k), d: Math.max(0.8, (ct.size[1] + 0.6) * k) }, noClear: true })) break;
    }
    if (ct) {
      R.on(ct, 'plant-small', { dx: ct.size[0] * 0.28 });
      // armchair at the side of the table, turned to it
      if (R.area >= 14) {
        const [ux, uy] = axisOf(sofa.rot);
        for (const side of [1, -1]) {
          const reach = ct.size[0] / 2 + 0.5 + SPEC_BY_ID.armchair.size[1] / 2;
          const a = R.at('armchair', { x: ct.x + ux * side * reach, y: ct.y + uy * side * reach, rot: rotFromFront(-ux * side, -uy * side), partners: [sofa, ct], noClear: true });
          if (a) break;
        }
      }
    }
    // standing lamp beside the sofa, back on the same wall
    const [ux, uy] = axisOf(sofa.rot);
    for (const side of [1, -1]) {
      const reach = sofa.size[0] / 2 + 0.2;
      const back = sofa.size[1] / 2 - 0.19;
      if (R.at('floor-lamp', { x: sofa.x + ux * side * reach - fx * back, y: sofa.y + uy * side * reach - fy * back, rot: sofa.rot, noClear: true })) break;
    }
  }
  // the sleeping zone of a studio comes before the bookshelf and the plants, which take the walls that are left
  if (R.zones?.includes('sleep')) sleepRecipe(R);
  ensureLight(R, sofa ? centreOf(sofa) : null);
  if (R.area >= 12) R.wall('bookshelf', { avoidWindows: true, align: 'start', size: { w: R.area >= 24 ? 1.2 : 0.9 }, score: (e) => longest(e, true) });
  R.corner('plant-large', { anyRoom: true, order: sofa ? (a, b) => dist2(b.v, sofa) - dist2(a.v, sofa) : undefined });
}
const dist2 = (v, p) => (v[0] - p.x) ** 2 + (v[1] - p.y) ** 2;
const gapTo = (a, b) => Math.max(0.25, Math.hypot(b.x - a.x, b.y - a.y) - a.size[1] / 2 - b.size[1] / 2);

// Sleeping zone of a studio: a bed along a wall away from the sofa, with nightstands and lamps when they fit. A smaller bed, and at
// last a sofa bed, stand in when the room is tight; a room that already has a sofa bed or a bed is left as it is.
function sleepRecipe(R) {
  if (R.mine.some((p) => p.type.startsWith('bed-') || p.type === 'sofa-bed')) return;
  const sofa = R.mine.find((p) => ['sofa2', 'sofa3', 'sofa-bed'].includes(p.type));
  const doorPts = R.edges.flatMap((e) => e.doors.map((d) => [e.a[0] + e.t[0] * (d.s0 + d.s1) / 2, e.a[1] + e.t[1] * (d.s0 + d.s1) / 2]));
  const far = (e) => (doorPts.length ? Math.min(...doorPts.map((p) => Math.hypot(p[0] - (e.a[0] + e.b[0]) / 2, p[1] - (e.a[1] + e.b[1]) / 2))) : 0);
  const apart = (e) => (sofa ? Math.hypot(sofa.x - (e.a[0] + e.b[0]) / 2, sofa.y - (e.a[1] + e.b[1]) / 2) : 0);
  const score = (e) => longest(e, true) - 3 * e.windows.length - 2 * e.doors.length + 0.25 * far(e) + 0.4 * apart(e) - (onNorthOrWestWall(e) ? 0.5 : 0);
  const nightstands = (bed) => {
    const [ux, uy] = axisOf(bed.rot), [fx, fy] = frontOf(bed.rot);
    const ns = SPEC_BY_ID.nightstand.size;
    for (const side of [1, -1]) {
      const reach = bed.size[0] / 2 + 0.03 + ns[0] / 2, back = bed.size[1] / 2 - ns[1] / 2;
      const stand = R.at('nightstand', { anyRoom: true, x: bed.x + ux * side * reach - fx * back, y: bed.y + uy * side * reach - fy * back, rot: bed.rot, partners: [bed], noClear: true });
      if (stand) R.on(stand, 'table-lamp');
    }
    return true;
  };
  const kinds = [['bed-double', 1.6], ['bed-double', 1.4], ['bed-single', 0.9], ['sofa-bed', 1.6]];
  let bed = null;
  for (const avoidWindows of [true, false]) {
    for (const [t, w] of kinds) {
      bed = R.wall(t, { anyRoom: true, size: { w }, score, avoidWindows, align: 'center', margins: [0.5, 0.25, 0.02], accept: nightstands });
      if (bed) break;
    }
    if (bed) break;
  }
  if (!bed) return;
  const [fx, fy] = frontOf(bed.rot);
  for (const kk of [1, 0.85, 0.7]) {
    const wRug = clamp((bed.size[0] + 0.9) * kk, 1.2, 3.4), dRug = clamp(1.7 * kk, 0.8, 2.6);
    const cx = bed.x + fx * (bed.size[1] / 2 - 0.9 + dRug / 2 - 0.15), cy = bed.y + fy * (bed.size[1] / 2 - 0.9 + dRug / 2 - 0.15);
    if (R.at('rug', { x: cx, y: cy, rot: bed.rot, size: { w: wRug, d: dRug }, noClear: true })) break;
  }
}

function diningRecipe(R) {
  diningSet(R, { chairs: R.area >= 14 ? 6 : 4, long: R.area >= 14 ? 2.0 : 1.6 });
  if (R.type === 'dining') {
    R.wall('sideboard', { avoidWindows: true });
    R.corner('plant-large', { anyRoom: true });
  }
}

function placeRun(R, e, items, a, b, dir, opts = {}) {
  // items: [{ t, w }] laid along edge e inside [a, b], from the a end (dir 1) or the b end (dir -1)
  let s = dir > 0 ? a : b;
  const placed = [];
  for (const it of items) {
    const sc = s + dir * it.w / 2;
    const p = R.alongEdge(it.t, e, sc, { size: { w: it.w }, soft: true, margin: 0 });
    if (p) placed.push(p);
    s += dir * it.w;
  }
  return placed;
}

function kitchenRecipe(R) {
  const order = R.edgesBy((e) => longest(e, false) + (e.windows.length ? 0.8 : 0) - 0.4 * e.doors.length).filter((e) => longest(e, false) >= 1.7);
  let main = null, mainPieces = [];
  for (const e of order.slice(0, 4)) {
    const [a, b] = R.zoneFree(e, 0.62, { minLen: 1.7 })[0] ?? [];
    if (a === undefined) continue;
    const L = b - a;
    const base = (w) => ({ t: 'kitchen-base', w });
    let seq;
    if (L >= 4.2) seq = [{ t: 'fridge', w: 0.6 }, base(0.6), { t: 'kitchen-hob', w: 0.6 }, base(0.6), { t: 'kitchen-sink', w: 1.2 }, base(Math.min(1.2, 0.6 + (L - 4.2) / 2))];
    else if (L >= 3.0) seq = [{ t: 'fridge', w: 0.6 }, { t: 'kitchen-hob', w: 0.6 }, base(0.6), { t: 'kitchen-sink', w: Math.min(1.2, L - 1.8) }];
    else if (L >= 2.4) seq = [{ t: 'fridge', w: 0.6 }, { t: 'kitchen-sink', w: 1.0 }, { t: 'kitchen-hob', w: 0.6 }];
    else seq = [{ t: 'kitchen-sink', w: 0.8 }, { t: 'kitchen-hob', w: 0.6 }];
    const win = e.windows[0];
    const sinkOffset = (reverse) => {
      const items = reverse ? seq.slice().reverse() : seq;
      let s = a, c = 0;
      for (const it of items) { if (it.t === 'kitchen-sink') c = s + it.w / 2; s += it.w; }
      const start = reverse ? b - (s - a) : a;
      return win ? Math.abs(start + (c - a) - (win.s0 + win.s1) / 2) : 0;
    };
    const doorNear = e.doors[0] ? (e.doors[0].s0 + e.doors[0].s1) / 2 : a;
    const tryOrder = [false, true].sort((x, y) => (win ? sinkOffset(x) - sinkOffset(y) : (Math.abs((x ? b : a) - doorNear) - Math.abs((y ? b : a) - doorNear))));
    for (const rev of tryOrder) {
      const mk = R.mark();
      const items = rev ? seq.slice().reverse() : seq;
      const total = items.reduce((s, it) => s + it.w, 0);
      const start = rev ? b - total : a;
      const placed = placeRun(R, e, items, start, start + total, 1);
      if (placed.some((p) => p.type === 'kitchen-sink') && placed.some((p) => p.type === 'kitchen-hob') && placed.some((p) => p.type === 'fridge')) { main = e; mainPieces = placed; break; }
      R.rollback(mk);
    }
    if (main) break;
  }
  if (!main) {
    // fall back: every needed piece anywhere on a wall
    // the sink goes first, under a window when there is one; the rest fills what is left
    const winEdge = R.edges.find((e) => e.windows.length && e.len >= 1.0);
    const around = winEdge ? [winEdge.a[0] + winEdge.t[0] * (winEdge.windows[0].s0 + winEdge.windows[0].s1) / 2, winEdge.a[1] + winEdge.t[1] * (winEdge.windows[0].s0 + winEdge.windows[0].s1) / 2] : null;
    for (const w of [1.2, 0.8]) if (R.wall('kitchen-sink', { soft: true, align: 'any', size: { w }, avoidWindows: false, ...(around ? { edges: [winEdge], around } : {}) }) || R.wall('kitchen-sink', { soft: true, align: 'any', size: { w }, avoidWindows: false })) break;
    for (const t of ['kitchen-hob', 'fridge', 'kitchen-base']) R.wall(t, { soft: true, align: 'any' });
  }
  // second run along another wall, starting beside the first run
  if (main && R.area >= 7) {
    for (const e of R.edgesBy((x) => longest(x, false)).filter((x) => x !== main && longest(x, false) >= 1.9).slice(0, 3)) {
      const [a, b] = R.zoneFree(e, 0.62, { minLen: 1.9 })[0] ?? [];
      if (a === undefined) continue;
      const near = mainPieces[0] ?? { x: main.a[0], y: main.a[1] };
      const fromA = Math.hypot(e.a[0] + e.t[0] * a - near.x, e.a[1] + e.t[1] * a - near.y) <= Math.hypot(e.a[0] + e.t[0] * b - near.x, e.a[1] + e.t[1] * b - near.y);
      const mid = mainPieces[mainPieces.length - 1] ?? near;
      const closer = Math.min(Math.hypot(e.a[0] + e.t[0] * a - mid.x, e.a[1] + e.t[1] * a - mid.y), Math.hypot(e.a[0] + e.t[0] * b - mid.x, e.a[1] + e.t[1] * b - mid.y));
      if (closer > 1.0 && !fromA && false) continue;
      const lead = 0.64;
      const n = Math.min(4, Math.floor((b - a - lead) / 0.6));
      if (n < 2) continue;
      const items = Array.from({ length: n }, () => ({ t: 'kitchen-base', w: 0.6 }));
      const dir = fromA ? 1 : -1;
      const placed = placeRun(R, e, items, fromA ? a + lead : a, fromA ? b : b - lead, dir);
      if (placed.length >= 2) { mainPieces.push(...placed); break; }
    }
  }
  // wall cabinets above the runs, never above a window, a fridge or a door
  for (const p of R.mine.slice()) {
    if (!['kitchen-base', 'kitchen-hob', 'kitchen-sink'].includes(p.type) || !p._edge) continue;
    R.alongEdge('kitchen-upper', p._edge, p._s, { size: { w: p.size[0] }, soft: false, noClear: true });
  }
  if (R.area >= 11 && R.zone === 'kitchen' && R.type === 'kitchen') diningSet(R, { chairs: 4, long: 1.4, strict: true });
  if (R.area >= 8) R.wall('washing-machine', { soft: true, align: 'end' });
}

function bedroomRecipe(R) {
  const kids = R.type === 'kids';
  const small = kids || R.area < 9 || R.minDim < 2.8;
  const bedType = small && R.can('bed-single') ? 'bed-single' : 'bed-double';
  const doorPts = R.edges.flatMap((e) => e.doors.map((d) => [e.a[0] + e.t[0] * (d.s0 + d.s1) / 2, e.a[1] + e.t[1] * (d.s0 + d.s1) / 2]));
  const far = (e) => (doorPts.length ? Math.min(...doorPts.map((p) => Math.hypot(p[0] - (e.a[0] + e.b[0]) / 2, p[1] - (e.a[1] + e.b[1]) / 2))) : 0);
  // the bed is low, so it leaves the north and west walls to the tall pieces when the room has other walls to offer
  const score = (e) => longest(e, true) - 3 * e.windows.length - 2 * e.doors.length + 0.25 * far(e) - (onNorthOrWestWall(e) ? 1.5 : 0);
  const ww = R.area >= 16 ? [2.4, 1.8, 1.2, 0.9] : R.area >= 11 ? [1.8, 1.2, 0.9] : [1.2, 0.9];
  const wardrobe = () => {
    for (const w of ww) { const p = R.wall('wardrobe', { size: { w }, avoidWindows: true, align: 'start', score: (e) => longest(e, true) - 2 * e.doors.length }); if (p) return p; }
    // no room for a big one: a small wardrobe still gives the room somewhere to put clothes
    for (const w of [1.2, 0.9, 0.6]) { const p = R.wall('wardrobe-small', { size: { w }, avoidWindows: true, align: 'start', score: (e) => longest(e, true) - 2 * e.doors.length }); if (p) return p; }
    return null;
  };
  const nightstands = (bed) => {
    const [ux, uy] = axisOf(bed.rot), [fx, fy] = frontOf(bed.rot);
    const ns = SPEC_BY_ID.nightstand.size;
    let n = 0;
    for (const side of [1, -1]) {
      const reach = bed.size[0] / 2 + 0.03 + ns[0] / 2, back = bed.size[1] / 2 - ns[1] / 2;
      const stand = R.at('nightstand', { x: bed.x + ux * side * reach - fx * back, y: bed.y + uy * side * reach - fy * back, rot: bed.rot, partners: [bed], noClear: true });
      if (stand) { n++; R.on(stand, 'table-lamp'); }
    }
    return n;
  };
  const strictBed = () => R.wall(bedType, { score, avoidWindows: true, align: 'center', margins: [0.5, 0.25, 0.02], accept: nightstands });
  const looseBed = () => R.wall(bedType, { score, avoidWindows: false, align: 'center', margins: [0.02] });
  // the wardrobe is the pickier piece (tall, not before a window): it goes first; if the bed then has no room, the bed goes first;
  // a bed without nightstands is the last resort
  let bed = null;
  const mk = R.mark();
  for (const [first, place] of [['w', strictBed], ['b', strictBed], ['w', looseBed], ['b', looseBed]]) {
    R.rollback(mk);
    if (first === 'w') { wardrobe(); bed = place(); } else { bed = place(); if (bed) wardrobe(); }
    if (bed) break;
  }
  if (bed) {
    const [fx, fy] = frontOf(bed.rot);
    for (const kk of [1, 0.85, 0.7]) {
      const wRug = clamp((bed.size[0] + 0.9) * kk, 1.2, 3.4), dRug = clamp(1.7 * kk, 0.8, 2.6);
      const cx = bed.x + fx * (bed.size[1] / 2 - 0.9 + dRug / 2 - 0.15), cy = bed.y + fy * (bed.size[1] / 2 - 0.9 + dRug / 2 - 0.15);
      if (R.at('rug', { x: cx, y: cy, rot: bed.rot, size: { w: wRug, d: dRug }, noClear: true })) break;
    }
  }
  if (kids || R.area >= 14) {
    const desk = R.wall('desk', { avoidWindows: false, score: (e) => longest(e, true) + 0.8 * e.windows.length });
    if (desk) {
      const [fx, fy] = frontOf(desk.rot);
      R.at('desk-chair', { x: desk.x + fx * (desk.size[1] / 2 + 0.28), y: desk.y + fy * (desk.size[1] / 2 + 0.28), rot: rotFromFront(-fx, -fy), partners: [desk], noClear: true });
    }
  }
  if (!kids && R.area >= 13) R.wall('dresser', { avoidWindows: true });
  if (!kids && R.area >= 16) R.corner('armchair', { noClear: true });
  ensureLight(R, bed ? centreOf(bed) : null);
  R.corner('plant-large', { anyRoom: true });
}

function bathRecipe(R) {
  const wc = R.type === 'wc';
  const anyScore = (e) => longest(e, true) + 0.2 * longest(e, false);
  const wet = () => {
    if (wc) return true;
    let done = null;
    if (R.area >= 4.5 && R.can('bathtub')) done = R.wall('bathtub', { align: 'start', score: (e) => longest(e, false), avoidWindows: false });
    if (!done) done = R.corner('shower', { order: (a, b) => (b.e1.windows.length + b.e2.windows.length) - (a.e1.windows.length + a.e2.windows.length), size: { w: 0.8, d: 0.8 } });
    if (!done && R.can('shower')) done = R.wall('shower', { align: 'any', size: { w: 0.8, d: 0.8 } });
    return !!done;
  };
  const dry = () => {
    const toilet = R.wall('toilet', { score: anyScore, align: 'any', margins: [0.15, 0.02] });
    const basin = R.wall('washbasin', { score: (e) => anyScore(e) + (toilet && e === toilet._edge ? -0.5 : 0), align: 'any', size: { w: wc ? 0.45 : 0.65 }, partners: toilet ? [toilet] : [] });
    return { toilet, basin };
  };
  // wet corner first; if toilet and basin then do not both fit, start again with them first
  const mk = R.mark();
  let ok = wet();
  let { toilet, basin } = dry();
  if (!ok || !toilet || !basin) {
    R.rollback(mk);
    ({ toilet, basin } = dry());
    ok = wet();
  }
  let cabinet = null;
  if (basin && R.can('bathroom-cabinet')) {
    cabinet = R.wall('bathroom-cabinet', { edges: basin._edge ? [basin._edge] : undefined, around: [basin.x, basin.y], size: { w: clamp(basin.size[0], 0.4, 1.0) }, soft: false, noClear: true });
  }
  if (basin && !cabinet && R.can('mirror')) {
    const mw = clamp(Math.max(0.6, basin.size[0]), 0.4, 1.2);
    R.wall('mirror', { edges: basin._edge ? [basin._edge] : undefined, around: [basin.x, basin.y], size: { w: mw, h: 0.8 }, elev: 1.1, soft: false, noClear: true });
  }
  if (!wc && R.area >= 4) R.wall('washing-machine', { align: 'end', score: anyScore });
  if (basin && R.can('plant-small')) R.on(basin, 'plant-small', { dx: 0 });
}

function hallRecipe(R) {
  if (R.minDim >= 1.2) R.wall('mirror', { avoidWindows: true, soft: false, noClear: true, align: 'center', score: (e) => longest(e, true) });
  if (R.minDim >= 2.3 && R.area >= 7) R.wall('wardrobe', { avoidWindows: true, size: { w: 1.2 }, align: 'start' });
  else if (R.minDim >= 1.5 && R.area >= 3.5 && R.wall('wardrobe-small', { avoidWindows: true, align: 'start' })) { /* placed */ }
  else if (R.minDim >= 1.9 && R.area >= 5) R.wall('dresser', { avoidWindows: true, align: 'start' });
  if (R.can('shoe-cabinet')) R.wall('shoe-cabinet', { avoidWindows: true, align: 'end' });
  if (R.can('bench') && R.minDim >= 2.0) R.wall('bench', { avoidWindows: true, align: 'end' });
  if (R.minDim >= 1.6 && R.area >= 5) R.corner('plant-large', { anyRoom: true });
}

function officeRecipe(R) {
  const desk = R.wall('desk', { avoidWindows: false, score: (e) => longest(e, true) + 1.0 * e.windows.length, align: 'center' });
  if (desk) {
    const [fx, fy] = frontOf(desk.rot);
    R.at('desk-chair', { x: desk.x + fx * (desk.size[1] / 2 + 0.28), y: desk.y + fy * (desk.size[1] / 2 + 0.28), rot: rotFromFront(-fx, -fy), partners: [desk], noClear: true });
    R.on(desk, 'table-lamp', { dx: desk.size[0] * 0.35 });
  }
  ensureLight(R, desk ? centreOf(desk) : null);
  R.wall('bookshelf', { avoidWindows: true, align: 'start', size: { w: R.area >= 10 ? 1.2 : 0.9 } });
  if (R.area >= 12) R.corner('armchair', { noClear: true });
  R.corner('plant-large', { anyRoom: true });
}

function utilityRecipe(R) { R.wall('washing-machine', { align: 'any' }); }
function balconyRecipe(R) { R.corner('plant-large', { anyRoom: true }); }
function otherRecipe(R) { R.corner('plant-large', { anyRoom: true }); }

export const RECIPES = {
  living: livingRecipe, sleep: sleepRecipe, dining: diningRecipe, kitchen: kitchenRecipe, bedroom: bedroomRecipe, kids: bedroomRecipe,
  bath: bathRecipe, wc: bathRecipe, hall: hallRecipe, office: officeRecipe, utility: utilityRecipe, balcony: balconyRecipe, storage: () => {}, other: otherRecipe,
};

// ---- additions that come from the plan itself: pictures, curtains ----
function hangArt(R) {
  const art = (t, anchor, elev) => R.wall(t, { edges: anchor._edge ? [anchor._edge] : undefined, around: [anchor.x, anchor.y], elev, soft: false, noClear: true, avoidWindows: false });
  const level = R.level;
  const ceil = level.height - 0.25;
  const anchors = R.mine.filter((p) => ['sofa2', 'sofa3', 'sofa-bed', 'bed-double', 'bed-single', 'dresser', 'sideboard', 'desk', 'shoe-cabinet'].includes(p.type) && p._edge);
  const shelfSpec = SPEC_BY_ID['shelf-wall'];
  for (const a of anchors.slice(0, 3)) {
    const top = a.elev + a.size[2];
    if (['dresser', 'sideboard', 'desk', 'shoe-cabinet'].includes(a.type) && R.can('shelf-wall')) {
      // a wall shelf above the chest or desk, a hand's width narrower than it and clear of windows and doors
      const elevS = Math.max(shelfSpec.place.elevation, top + 0.45);
      if (elevS + shelfSpec.size[2] <= ceil && R.wall('shelf-wall', { edges: [a._edge], around: [a.x, a.y], size: { w: clamp(a.size[0] - 0.1, 0.5, 1.4) }, elev: elevS, soft: false, noClear: true, avoidWindows: true, align: 'any' })) continue;
    }
    const big = SPEC_BY_ID['art-large'].size[2];
    const elev = Math.max(SPEC_BY_ID['art-large'].place.elevation, top + (a.type.startsWith('bed') ? 0.7 : 0.25));
    if (a.type !== 'desk' && a.type !== 'dresser' && elev + big <= ceil && art('art-large', a, elev)) continue;
    const e2 = Math.max(SPEC_BY_ID['art-small'].place.elevation, top + 0.3);
    if (e2 + SPEC_BY_ID['art-small'].size[2] <= ceil) art('art-small', a, e2);
  }
  if (R.type === 'hall' && R.can('shelf-wall') && !R.has('shelf-wall') && shelfSpec.place.elevation + shelfSpec.size[2] <= ceil) {
    R.wall('shelf-wall', { elev: shelfSpec.place.elevation, soft: false, noClear: true, avoidWindows: true, align: 'any', score: (e) => longest(e, true) });
  }
  const extra = R.type === 'living' ? 2 : R.type === 'hall' || R.type === 'bedroom' || R.type === 'office' || R.type === 'dining' ? 1 : R.type === 'other' ? 1 : 0;
  for (let i = 0; i < extra; i++) {
    const t = i === 0 && R.area > 12 && R.type === 'living' ? 'art-large' : 'art-small';
    const elev = t === 'art-large' ? 1.0 : 1.2;
    if (elev + SPEC_BY_ID[t].size[2] > ceil) continue;
    if (!R.wall(t, { elev, soft: false, noClear: true, avoidWindows: true, align: 'any', score: (e) => longest(e, true) })) break;
  }
}

function hangCurtains(R) {
  const ch = clamp(R.level.height - 0.15, 1.0, 2.6);
  for (const e of R.edges) {
    for (const win of e.windows) {
      const wc = (win.s0 + win.s1) / 2, ww = win.s1 - win.s0;
      for (const extra of [0.5, 0.2, 0.05]) {
        const left = Math.max(0, wc - ww / 2 - extra / 2), right = Math.min(e.len, wc + ww / 2 + extra / 2);
        const cw = clamp(right - left, 0.6, 4.0);
        if (R.alongEdge('curtain', e, (left + right) / 2, { size: { w: cw, h: ch }, noClear: true, elev: 0 })) break;
      }
    }
  }
}

// ---- density: small things on furniture, more pictures and mirrors on the wall that is left, a second plant, more rugs ----
// What stands on a chest, a table or a desk: [type, offset across the top as a share of its width], tried in this order. R.on refuses a spot
// that is taken, so a lamp or a plant placed earlier is never covered.
const TOP_ITEMS = {
  sideboard: [['vase', -0.32], ['plant-small', 0.36], ['books-stack', 0.04]],
  dresser: [['plant-small', -0.34], ['vase', 0.34], ['books-stack', 0]],
  'tv-unit': [['vase', 0.36], ['plant-small', -0.4]],
  desk: [['books-stack', -0.36], ['plant-small', 0.05]],
  'dining-table': [['centerpiece', 0]],
  'coffee-table': [['books-stack', -0.3]],
};
const PROP_ROOMS = ['living', 'dining', 'bedroom', 'kids', 'hall', 'office', 'other'];

function dressTops(R) {
  let left = R.area >= 16 ? 4 : R.area >= 9 ? 3 : 2;
  for (const parent of R.mine.slice()) {
    const list = TOP_ITEMS[parent.type];
    if (!list || parent.on) continue;
    for (const [t, share] of list) {
      if (left <= 0) return;
      if (R.on(parent, t, { dx: share * parent.size[0] })) left--;
    }
  }
}

// Span of a piece along a wall (from its footprint), to keep a gap between neighbours on the same wall.
function spanOn(e, p) {
  const [ux, uy] = axisOf(p.rot), [fx, fy] = frontOf(p.rot);
  const s = (p.x - e.a[0]) * e.t[0] + (p.y - e.a[1]) * e.t[1];
  const h = (Math.abs(ux * e.t[0] + uy * e.t[1]) * p.size[0] + Math.abs(fx * e.t[0] + fy * e.t[1]) * p.size[1]) / 2;
  return [s - h, s + h];
}

// One wall piece on the free stretch of wall with the widest gap to its neighbours (at least `minGap`), longest free walls first.
function hangOne(R, t, elev, { anyRoom = false, minGap = 0.35 } = {}) {
  const spec = SPEC_BY_ID[t];
  if (!spec || !R.can(t, { anyRoom }) || elev + spec.size[2] > R.level.height - 0.25) return null;
  const w = spec.size[0];
  for (const e of R.edgesBy((x) => R.edgeScore(x, true))) {
    const taken = R.mine.filter((p) => p._edge === e && p._mode === 'wall-mount').map((p) => spanOn(e, p));
    for (const [a, b] of freeIntervals(e, { pad: 0.04, windows: true, minLen: w + 0.3 })) {
      const spots = [];
      for (let s = a + 0.15 + w / 2; s <= b - 0.15 - w / 2 + 1e-9; s += 0.15) {
        const gap = Math.min(99, ...taken.map(([x, y]) => Math.max(x - (s + w / 2), s - w / 2 - y)));
        if (gap >= minGap) spots.push({ s, gap: Math.min(gap, 1.5) });
      }
      spots.sort((p, q) => q.gap - p.gap || p.s - q.s);
      for (const sp of spots.slice(0, 6)) {
        const p = R.alongEdge(t, e, sp.s, { elev, noClear: true, anyRoom });
        if (p) return p;
      }
    }
  }
  return null;
}

// Pictures in proportion to the free wall of the room, and a mirror in bedrooms and larger living rooms.
function hangMore(R) {
  if (!PROP_ROOMS.includes(R.type)) return;
  const free = R.edges.reduce((sum, e) => sum + R.edgeScore(e, true), 0);
  const cap = R.type === 'living' ? 5 : 4;
  const want = clamp(Math.round(free / 2.4), 1, cap);
  let have = R.mine.filter((p) => p.type === 'art-large' || p.type === 'art-small').length;
  for (let k = 0; have < want && k < 6; k++) {
    const big = R.area >= 12 && k % 2 === 0 && R.type !== 'hall' && R.type !== 'office';
    if (!(big ? hangOne(R, 'art-large', 1.0) || hangOne(R, 'art-small', 1.2) : hangOne(R, 'art-small', 1.2))) break;
    have++;
  }
  if ((R.type === 'bedroom' || R.type === 'kids') && !R.has('mirror')) hangOne(R, 'mirror', 0.2);
  else if (R.type === 'living' && R.area >= 16 && !R.has('mirror')) hangOne(R, 'mirror', 0.3, { anyRoom: true });
}

// A second plant in a free corner of a roomy room, a third in a large one.
function morePlants(R) {
  if (!PROP_ROOMS.includes(R.type)) return;
  const want = R.area >= 22 ? 3 : R.area >= 12 ? 2 : 1;
  for (let i = R.count('plant-large'); i < want; i++) if (!R.corner('plant-large', { anyRoom: true })) break;
}

// A rug under the dining table, a runner along a hall.
function moreRugs(R) {
  const table = R.mine.find((p) => p.type === 'dining-table');
  if (table && R.can('rug')) {
    for (const k of [1, 0.85, 0.7]) {
      const size = { w: clamp((table.size[0] + 1.1) * k, 1.2, 3.4), d: clamp((table.size[1] + 1.1) * k, 0.8, 2.6) };
      if (R.at('rug', { x: table.x, y: table.y, rot: table.rot, size, noClear: true })) break;
    }
  }
  const length = Math.max(R.bbox.w, R.bbox.h);
  if (R.type === 'hall' && R.can('rug-runner') && R.minDim >= 1.1 && length >= 2.6) {
    const rot = R.bbox.w >= R.bbox.h ? rotFromFront(1, 0) : 0;
    for (const k of [1, 0.8, 0.65]) {
      const size = { w: clamp(R.minDim - 0.5, 0.6, 1.0), d: clamp((length - 1.0) * k, 1.2, 3.2) };
      if (R.at('rug-runner', { x: (R.bbox.minX + R.bbox.maxX) / 2, y: (R.bbox.minY + R.bbox.maxY) / 2, rot, size, noClear: true })) break;
    }
  }
}

export function decorate(R) {
  if (['living', 'dining', 'bedroom', 'kids', 'hall', 'office', 'other'].includes(R.type)) hangArt(R);
  if (['living', 'dining', 'bedroom', 'kids', 'office', 'kitchen', 'hall'].includes(R.type) && R.facts.windows > 0) hangCurtains(R);
  dressTops(R);
  hangMore(R);
  morePlants(R);
  moreRugs(R);
}
