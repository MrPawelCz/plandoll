// Recipes: what goes into each type of room, in order. Sizes, clearances and allowed rooms come from src/furniture/specs.js.
// Every recipe gets the stage R made by engine.js and only asks for placements; R decides whether a spot is free.
import { SPEC_BY_ID } from '../furniture/specs.js';
import { roomType, roomFacts } from './rooms.js';
import { frontOf, axisOf, rotFromFront, freeIntervals, onNorthOrWestWall, pointInPolygon, obb, penetration, boxInsidePolygon } from './geometry.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const longest = (e, windows) => freeIntervals(e, { pad: 0.04, windows, minLen: 0.2 })[0]?.reduce((a, b) => b - a) ?? 0;
const centreOf = (p) => [p.x, p.y];

// True when the front of the sofa points at the television within MAX_SOFA_TURN degrees.
const MAX_SOFA_TURN = 24;
const MAX_TV_GAP = 4.0; // sofa front to television unit, in metres
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
    if (!c) continue;
    const back = backRoom(R, c, table);
    if (back) { c._back = back; out.push(c); } else R.rollback({ n: R.mark().n - 1, m: R.mark().m - 1 }); // later pieces keep out of the strip behind a chair
  }
  return out;
}

// A seated person needs 0.70 m behind the chair to push it back: free of walls and of standing pieces (other chairs and the table do not count).
function backRoom(R, chair, table) {
  const [fx, fy] = frontOf(chair.rot), [w, d] = chair.size, need = 0.7;
  const strip = obb(chair.x - fx * (d / 2 + need / 2), chair.y - fy * (d / 2 + need / 2), w, need, chair.rot);
  if (!boxInsidePolygon(strip, R.ip.poly)) return null;
  for (const q of R.mine) if (q !== chair && q !== table && q.type !== 'dining-chair' && !q._flat && !q.on && q.elev < 0.5 && penetration(strip, q._obb) > 0.01) return null;
  return strip;
}

// The middle of the opening that leads from this room to a kitchen (a passage first, then a door), or null: a dining table stands close to it.
function kitchenDoor(R) {
  const { level, lc, room } = R;
  const mine = roomFacts(level, room).open;
  for (const o of [...mine.passages, ...mine.doors]) {
    const w = level.wallById?.get?.(o.wallId);
    if (!w || !level.rooms.some((r) => r !== room && roomType(r, lc.model) === 'kitchen' && [...roomFacts(level, r).open.doors, ...roomFacts(level, r).open.passages].includes(o))) continue;
    const u = (o.u0 + o.u1) / 2;
    return [w.from[0] + w.dir[0] * u, w.from[1] + w.dir[1] * u];
  }
  return null;
}

// With `strict` the table and the chairs also keep out of the free strips in front of the pieces already there (a kitchen run).
function diningSet(R, { chairs, long = 1.6, strict = false }) {
  if (!R.can('dining-table')) return null;
  const rotLong = R.bbox.w >= R.bbox.h ? 0 : 90;
  const minClear = 0.55;
  const door = R.type !== 'kitchen' ? kitchenDoor(R) : null;
  const near = (pts) => { // points 1.3 to 2.8 m from the kitchen opening come first, the nearest to 1.6 m before the rest
    if (!door) return pts;
    const d = (q) => Math.hypot(q.x - door[0], q.y - door[1]);
    const ok = pts.filter((q) => d(q) >= 1.3 && d(q) <= 2.8).sort((a, b) => Math.abs(d(a) - 1.6) - Math.abs(d(b) - 1.6));
    return [...ok, ...pts.filter((q) => !ok.includes(q))];
  };
  for (const wTable of [long, 1.4, 1.2]) {
    for (const pt of near(R.roomyPoints(minClear, 100))) {
      // the table's front faces the middle of the room, so the free floor is on its front side
      const mid = [R.bbox.minX + R.bbox.w / 2 - pt.x, R.bbox.minY + R.bbox.h / 2 - pt.y];
      const toMid = (r) => { const [fx, fy] = frontOf(r); return fx * mid[0] + fy * mid[1]; };
      for (const rot of [rotLong, (rotLong + 90) % 360].flatMap((r) => [r, (r + 180) % 360].sort((x, y) => toMid(y) - toMid(x)))) {
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
      let tooFar = false;
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
        if (!R.zones?.includes('sleep') && dist - unit.size[1] - SPEC_BY_ID.sofa3.size[1] > MAX_TV_GAP - 0.1) { tooFar = true; continue; } // a sofa on that wall would sit too far from the television: it floats nearer instead
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
        float: for (const away of [...(tooFar ? [MAX_TV_GAP - 0.2 + SPEC_BY_ID.sofa3.size[1] / 2] : []), ...(strict ? [2.7, 2.3, 2.0, 1.8] : [2.7, 2.3])]) {
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
  } else if (R.area >= 22 && R.has('dining-table')) {
    // a large living room with a dining table keeps a sideboard near it
    const t = R.mine.find((q) => q.type === 'dining-table');
    R.wall('sideboard', { avoidWindows: true, around: [t.x, t.y], size: { w: 1.4 } });
  }
}

function placeRun(R, e, items, a, b, dir, opts = {}) {
  // items: [{ t, w }] laid along edge e inside [a, b], from the a end (dir 1) or the b end (dir -1)
  let s = dir > 0 ? a : b;
  const placed = [];
  for (const it of items) {
    const sc = s + dir * it.w / 2;
    const p = R.alongEdge(it.t, e, sc, { size: { w: it.w }, soft: true, margin: 0, ...(opts.noClear ? { noClear: true } : {}), ...(opts.underWindow && it.t === 'kitchen-sink' ? { underWindow: true } : {}) });
    if (p) placed.push(p);
    s += dir * it.w;
  }
  return placed;
}

// Put `t` touching the run `chain` (within 0.05 m): beside a piece along its wall, or on the next wall past a corner.
function extendRun(R, t, chain, w) {
  const touches = (p) => { const f = obb(p.x, p.y, p.size[0] + 0.1, p.size[1] + 0.1, p.rot); return chain.some((q) => penetration(f, q._obb) > 0); };
  const spots = [];
  for (const q of chain) if (q._edge) for (const dir of [1, -1]) spots.push([q._edge, q._s + dir * (q.size[0] / 2 + w / 2)]);
  for (const e of R.edges) spots.push([e, 0.62 + w / 2], [e, e.len - 0.62 - w / 2]);
  for (const [e, s] of spots) {
    if (!touches({ x: e.a[0] + e.t[0] * s + e.n[0] * 0.31, y: e.a[1] + e.t[1] * s + e.n[1] * 0.31, size: [w, 0.62], rot: rotFromFront(e.n[0], e.n[1]) })) continue; // cheap test first: a placement costs the level's budget
    const mk = R.mark();
    const p = R.alongEdge(t, e, s, { size: { w }, soft: true, margin: 0 });
    if (p && touches(p)) return p;
    R.rollback(mk);
  }
  return null;
}

// The wall that meets edge `main` at corner `v`, and how far a run can go along it from that corner (0 when there is none).
function cornerWall(R, main, v) {
  const e = R.edges.find((x) => x !== main && Math.abs(dot(x.t, main.t)) < 0.1 && (Math.hypot(x.a[0] - v[0], x.a[1] - v[1]) < 0.1 || Math.hypot(x.b[0] - v[0], x.b[1] - v[1]) < 0.1));
  const [a, b] = (e && R.zoneFree(e, 0.62, { minLen: 1.2 })[0]) || [];
  const fromA = !!e && Math.hypot(e.a[0] - v[0], e.a[1] - v[1]) < 0.1;
  const ok = a !== undefined && !(fromA ? a > 0.1 : b < e.len - 0.1);
  return { e, fromA, a, b, free: ok ? (fromA ? b : e.len - a) : 0 };
}

// A short run (2.2 to 3.4 m) keeps the corner for an L: a wide base at one end (the second run stands in front of it), then the sink, the
// fridge at the far end; the hob goes first on the second run, where its front stays free.
function cornerRun(items, len) {
  if (items.length > 3 || len < 2.2 || len > 2.8) return null;
  return [{ t: 'kitchen-base', w: len - 1.6 }, { t: 'kitchen-sink', w: 1.0 }, { t: 'fridge', w: 0.6 }];
}

const KITCHEN = new Set(['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'fridge']);
function kitchenRecipe(R) {
  const order = R.edgesBy((e) => longest(e, false) + (e.windows.length ? 0.8 : 0) - 0.4 * e.doors.length).filter((e) => longest(e, false) >= 1.7);
  let main = null, mainPieces = [];
  // the sink keeps off the windows (its tap is higher than a sill); only when no run works that way may it stand under one
  const tryRuns = (underWindow, full = true) => { for (const e of order.slice(0, 4)) {
    const [a, b] = R.zoneFree(e, 0.62, { minLen: 1.7 })[0] ?? [];
    if (a === undefined) continue;
    const L = b - a;
    const base = (w) => ({ t: 'kitchen-base', w });
    let seq0;
    if (L >= 4.2) seq0 = [{ t: 'fridge', w: 0.6 }, base(0.6), { t: 'kitchen-hob', w: 0.6 }, base(0.6), { t: 'kitchen-sink', w: 1.2 }, base(Math.min(1.2, 0.6 + (L - 4.2) / 2))];
    else if (L >= 3.0) seq0 = [{ t: 'fridge', w: 0.6 }, { t: 'kitchen-hob', w: 0.6 }, base(0.6), { t: 'kitchen-sink', w: Math.min(1.2, L - 1.8) }];
    else if (L >= 2.4) seq0 = [{ t: 'fridge', w: 0.6 }, { t: 'kitchen-sink', w: 1.0 }, { t: 'kitchen-hob', w: 0.6 }];
    else seq0 = [{ t: 'kitchen-sink', w: 0.8 }, { t: 'kitchen-hob', w: 0.6 }];
    const sk = seq0.find((it) => it.t === 'kitchen-sink'), mid = seq0.filter((it) => it !== sk);
    mid.splice(2, 0, sk); // the sink at the end of the run, the other end, or in the middle
    for (const seq of [seq0, mid]) {
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
      let corner = R.area < 11 ? cornerRun(items, b - a) : null; // from 11 m2 a dining set follows, which needs the room around the hob
      if (corner && cornerWall(R, e, e.a).free < cornerWall(R, e, e.b).free) corner.reverse(); // the base goes to the corner with the longer free wall
      const padded = corner ?? items, total = padded.reduce((s, it) => s + it.w, 0), start = corner ? a : rev ? b - total : a;
      const placed = placeRun(R, e, padded, start, start + total, 1, { underWindow });
      const has = (t) => placed.some((p) => p.type === t);
      if (has('kitchen-sink') && has('kitchen-hob') && !has('fridge') && !full) { const f = extendRun(R, 'fridge', placed, 0.6); if (f) placed.push(f); } // the fridge stands at the end of the run, not elsewhere
      if (has('kitchen-sink') && has('fridge') && (has('kitchen-hob') || (corner && cornerWall(R, e, e.a).free + cornerWall(R, e, e.b).free >= 1.8))) { main = e; mainPieces = placed; break; }
      R.rollback(mk);
    }
    if (main) break;
    }
    if (main) break;
  } };
  const scatter = (underWindow) => { // last resort: the sink goes first, near a window when there is one; the rest is laid against it in one run
    const winEdge = R.edges.find((e) => e.windows.length && e.len >= 1.0);
    const around = winEdge ? [winEdge.a[0] + winEdge.t[0] * (winEdge.windows[0].s0 + winEdge.windows[0].s1) / 2, winEdge.a[1] + winEdge.t[1] * (winEdge.windows[0].s0 + winEdge.windows[0].s1) / 2] : null;
    let sink = null;
    for (const w of [1.2, 0.8]) if ((sink = R.wall('kitchen-sink', { soft: true, align: 'any', size: { w }, avoidWindows: false, underWindow, ...(around ? { edges: [winEdge], around } : {}) }) || R.wall('kitchen-sink', { soft: true, align: 'any', size: { w }, avoidWindows: false, underWindow }))) break;
    if (!sink) return;
    const chain = [sink];
    for (const t of ['kitchen-hob', 'fridge', 'kitchen-base']) { const p = extendRun(R, t, chain, 0.6); if (p) chain.push(p); }
    main = sink._edge; mainPieces = chain;
  };
  const complete = () => ['kitchen-sink', 'kitchen-hob', 'fridge'].every((t) => R.has(t));
  tryRuns(false);
  if (!main) tryRuns(false, false);
  if (!main) {
    const mk = R.mark();
    scatter(false);
    if (!complete()) { R.rollback(mk); main = null; mainPieces = []; tryRuns(true); if (!main) tryRuns(true, false); if (!main) { R.rollback(mk); scatter(true); } }
  }
  // second run: only on the wall that meets the first run in a corner it reaches, so the two form one L
  if (main && R.area >= 7) {
    const on = mainPieces.filter((p) => p._edge === main);
    const lo = Math.min(...on.map((p) => p._s - p.size[0] / 2)), hi = Math.max(...on.map((p) => p._s + p.size[0] / 2));
    const lead = 0.62;
    const ends = [[lo <= 0.1, main.a], [hi >= main.len - 0.1, main.b]];
    for (const [reach, v] of ends) {
      if (!reach || !on.length) continue;
      const { e, fromA, a, b, free } = cornerWall(R, main, v);
      if (!free) continue;
      const n = Math.min(4, Math.floor((fromA ? b - lead : e.len - lead - a) / 0.6));
      if (n < 2) continue;
      const items = Array.from({ length: n }, (_, k) => ({ t: !k && !R.has('kitchen-hob') ? 'kitchen-hob' : 'kitchen-base', w: 0.6 }));
      const mk = R.mark(), hadBase = R.has('kitchen-base');
      const placed = placeRun(R, e, items, fromA ? lead : a, fromA ? b : e.len - lead, fromA ? 1 : -1, { noClear: items[0].t === 'kitchen-hob' }); // the hob stands in front of the corner cabinet of the L
      if (placed.length >= 2 && (Math.abs(placed[0]._s - (fromA ? lead + 0.3 : e.len - lead - 0.3)) < 0.05 || !hadBase)) { mainPieces.push(...placed); break; } // the run starts at the corner; only a kitchen without any base takes it where it fits
      R.rollback(mk);
    }
  }
  if (main && !R.has('kitchen-base')) extendRun(R, 'kitchen-base', R.mine.filter((p) => p._edge && KITCHEN.has(p.type)), 0.6);
  // wall cabinets above the runs, never above a window, a fridge or a door
  for (const p of R.mine.slice()) {
    if (!['kitchen-base', 'kitchen-hob', 'kitchen-sink'].includes(p.type) || !p._edge) continue;
    R.alongEdge('kitchen-upper', p._edge, p._s, { size: { w: p.size[0] }, soft: false, noClear: true });
  }
  if (main) kitchenIsland(R, main, mainPieces);
  if (R.area >= 8 && main) extendRun(R, 'washing-machine', R.mine.filter((p) => p._edge && KITCHEN.has(p.type)), 0.6); // at the end of a run only; before the dining set, which keeps off its free front
  if (R.area >= 11 && R.zone === 'kitchen' && R.type === 'kitchen') diningSet(R, { chairs: 4, long: 1.4, strict: true });
}

// An island facing the main run, 1.0 m clear between them, with stools on its far side; only in a roomy kitchen.
function kitchenIsland(R, main, run) {
  if (!R.can('kitchen-island') || R.area < 13 || R.minDim < 3.3) return;
  const on = run.filter((p) => p._edge === main).map((p) => p._s);
  if (!on.length) return;
  const mid = on.reduce((a, b) => a + b, 0) / on.length;
  const rot = rotFromFront(-main.n[0], -main.n[1]);
  for (const dist of [2.2, 2.3, 2.4]) {
    for (const w of [2.0, 1.6, 1.2]) {
      let isl = null;
      for (const shift of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) {
        const s = clamp(mid + shift, w / 2 + 0.4, main.len - w / 2 - 0.4);
        const x = main.a[0] + main.t[0] * s + main.n[0] * dist, y = main.a[1] + main.t[1] * s + main.n[1] * dist;
        isl = R.at('kitchen-island', { x, y, rot, size: { w } });
        if (isl) break;
      }
      if (!isl) continue;
      const [ux, uy] = axisOf(isl.rot), [fx, fy] = frontOf(isl.rot);
      const n = w >= 1.9 ? 3 : w >= 1.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * 0.6;
        R.at('bar-stool', { x: isl.x + ux * off - fx * (isl.size[1] / 2 + 0.3), y: isl.y + uy * off - fy * (isl.size[1] / 2 + 0.3), rot: isl.rot, partners: [isl], noClear: true });
      }
      return;
    }
  }
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
    // the full 0.9 m in front first, even if that means a narrower wardrobe; a squeezed front is the fallback
    for (const w of ww) { const p = R.wall('wardrobe', { size: { w }, avoidWindows: true, align: 'start', soft: false, score: (e) => longest(e, true) - 2 * e.doors.length }); if (p) return p; }
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
    deskSet(R, { avoidWindows: false, score: (e) => longest(e, true) + 0.8 * e.windows.length });
  }
  ensureSeats(R); // before the dresser: a seat is wanted, a dresser is not
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
    if (R.area >= 4.5 && R.can('bathtub')) done = R.wall('bathtub', { align: 'start', score: (e) => longest(e, false) + (R.minDim < 2.4 && e.len >= 1.7 && e.len <= 2.3 ? 5 : 0), avoidWindows: false }); // in a narrow room the tub takes an end wall and leaves the length of the room as the way in
    if (!done) done = R.corner('shower', { order: (a, b) => (b.e1.windows.length + b.e2.windows.length) - (a.e1.windows.length + a.e2.windows.length), size: { w: 0.8, d: 0.8 } });
    if (!done && R.can('shower')) done = R.wall('shower', { align: 'any', size: { w: 0.8, d: 0.8 } });
    return !!done;
  };
  const dry = () => {
    const toilet = R.wall('toilet', { score: anyScore, align: 'any', margins: [0.15, 0.02] });
    const bo = { score: (e) => anyScore(e) + (toilet && e === toilet._edge ? -0.5 : 0), align: 'any', size: { w: wc ? 0.45 : 0.65 } };
    const basin = R.wall('washbasin', bo) || (toilet && R.wall('washbasin', { ...bo, partners: [toilet] })); // out of the toilet's front first; in a room too small for that, as near as it must be
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
  if (R.can('shoe-cabinet') && R.minDim >= 1.6) R.wall('shoe-cabinet', { avoidWindows: true, align: 'end' });
  if (R.can('bench') && R.minDim >= 2.0) R.wall('bench', { avoidWindows: true, align: 'end' });
  if (R.minDim >= 1.6 && R.area >= 5) R.corner('plant-large', { anyRoom: true });
}

// A desk with its chair, only where 0.80 m stays free behind the chair (walls and standing pieces count); otherwise no desk.
function deskSet(R, opts) {
  const mk = R.mark();
  const desk = R.wall('desk', opts);
  if (!desk) return null;
  const [fx, fy] = frontOf(desk.rot), near = desk.size[1] / 2 + 0.28, len = near + SPEC_BY_ID['desk-chair'].size[1] / 2 + 0.8;
  const chair = R.at('desk-chair', { x: desk.x + fx * near, y: desk.y + fy * near, rot: rotFromFront(-fx, -fy), partners: [desk], noClear: true });
  const strip = obb(desk.x + fx * (desk.size[1] / 2 + len / 2), desk.y + fy * (desk.size[1] / 2 + len / 2), desk.size[0], len, desk.rot);
  if (chair && boxInsidePolygon(strip, R.ip.poly) && !R.mine.some((q) => q !== desk && q !== chair && !q._flat && !q.on && q.elev < 0.5 && penetration(strip, q._obb) > 0.01)) { desk._strip = strip; return desk; }
  R.rollback(mk);
  return null;
}

function officeRecipe(R) {
  const desk = deskSet(R, { avoidWindows: false, score: (e) => longest(e, true) + 1.0 * e.windows.length, align: 'center' });
  if (desk) R.on(desk, 'table-lamp', { dx: desk.size[0] * 0.35 });
  ensureLight(R, desk ? centreOf(desk) : null);
  if (desk && R.area >= 9 && R.minDim < 2.7) { // a tight office seats its second person at a wall, before the shelf and the plant take the places, and keeps the strip behind the desk chair free of later seats
    desk._deskBack = desk._strip;
    R.wall('armchair', { anyRoom: true, allFronts: true, avoidWindows: true, noClear: true });
  }
  R.wall('bookshelf', { avoidWindows: true, align: 'start', size: { w: R.area >= 10 ? 1.2 : 0.9 } });
  R.corner('plant-large', { anyRoom: true });
}

function utilityRecipe(R) {
  R.wall('washing-machine', { align: 'any' });
  if (R.area >= 2.5) R.wall('shelf-wall', { anyRoom: true, avoidWindows: true, elev: 1.4, noClear: true, soft: false });
}
// Pantry, dressing room, walk-in closet: wardrobes along the walls, a shelf, a mirror when there is room.
function storageRecipe(R) {
  if (R.area < 1.8) return;
  if (/pantry|spi[zż]arn|larder/i.test(R.room.name ?? '')) {
    // a pantry: shelving along the walls instead of clothes
    let k = 0;
    for (const w of [1.2, 1.2, 0.9]) if (R.wall('bookshelf', { anyRoom: true, size: { w }, avoidWindows: true, align: 'start' }) && ++k >= 3) break;
    if (R.area >= 3) R.wall('shelf-wall', { anyRoom: true, avoidWindows: true, elev: 1.4, noClear: true, soft: false });
    return;
  }
  let n = 0;
  for (const w of R.area >= 4 ? [1.2, 1.2, 0.9] : [1.2, 0.9]) {
    if (R.wall('wardrobe', { anyRoom: true, size: { w }, avoidWindows: true, align: 'start' }) || R.wall('wardrobe-small', { anyRoom: true, size: { w }, avoidWindows: true, align: 'start' })) n++;
    if (n >= 3) break;
  }
  if (R.area >= 3) R.wall('shelf-wall', { anyRoom: true, avoidWindows: true, elev: 1.4, noClear: true, soft: false });
  if (R.area >= 3.5) R.wall('mirror', { anyRoom: true, avoidWindows: true, soft: false, noClear: true, elev: 0.9, size: { w: 0.6, h: 1.4 } });
}
function balconyRecipe(R) { R.corner('plant-large', { anyRoom: true }); }
function otherRecipe(R) { R.corner('plant-large', { anyRoom: true }); }

export const RECIPES = {
  living: livingRecipe, sleep: sleepRecipe, dining: diningRecipe, kitchen: kitchenRecipe, bedroom: bedroomRecipe, kids: bedroomRecipe,
  bath: bathRecipe, wc: bathRecipe, hall: hallRecipe, office: officeRecipe, utility: utilityRecipe, balcony: balconyRecipe, storage: storageRecipe, other: otherRecipe,
};

// ---- additions that come from the plan itself: pictures, curtains ----
// The mirror of a bedroom hangs on the wall right over the chest of drawers, centred on it, a hand above its top.
function mirrorOverDresser(R) {
  const [w, , H] = SPEC_BY_ID.mirror.size, a = R.mine.find((p) => p.type === 'dresser' && p._edge);
  if (!a) return;
  const elev = a.size[2] + 0.15, h = Math.min(H, R.level.height - 0.1 - elev);
  const m = h >= 1 && R.alongEdge('mirror', a._edge, a._s, { size: { w, h }, elev, noClear: true });
  if (m) m._obb = obb(m.x, m.y, m.size[0] + 0.12, m.size[1], m.rot);
}

function hangArt(R) {
  const art = (t, anchor, elev) => R.wall(t, { edges: anchor._edge ? [anchor._edge] : undefined, around: [anchor.x, anchor.y], elev, soft: false, noClear: true, avoidWindows: false });
  const level = R.level;
  const ceil = level.height - 0.25;
  const anchors = R.mine.filter((p) => ['sofa2', 'sofa3', 'sofa-bed', 'bed-double', 'bed-single', 'dresser', 'sideboard', 'desk', 'shoe-cabinet'].includes(p.type) && p._edge);
  const shelfSpec = SPEC_BY_ID['shelf-wall'];
  if ((R.type === 'bedroom' || R.type === 'kids') && !R.has('mirror')) mirrorOverDresser(R);
  for (const a of anchors.slice(0, 3)) {
    const top = a.elev + a.size[2];
    if (a.type === 'dresser' && R.mine.some((m) => m.type === 'mirror' && m._edge === a._edge)) continue;
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

// ---- open floor in the middle of a room ----
// Furniture and props hug the walls, which can leave a roomy stretch of floor in the middle. The stretch is found on a grid: cells
// further than `reach` metres (0.8) from every piece standing on the floor and 0.15 m from the walls, joined edge to edge. The biggest group
// of at least 1.6 m2 gets a rug, then an armchair facing its middle with a small round table beside it. Placements go through R.at,
// so every rule of the layout (overlap, door zones, clear fronts, room outline) holds as for any other piece.
const FLOOR_ROOMS = ['living', 'bedroom', 'office', 'other', 'kids'];
const CELL = 0.2;
const standing = (p) => !p._flat && !p.on && (p._mode === 'floor' || p._mode === 'corner');
function boxGap(x, y, b) {
  const dx = x - b.cx, dy = y - b.cy;
  return Math.hypot(Math.max(Math.abs(dx * b.ux + dy * b.uy) - b.hw, 0), Math.max(Math.abs(dx * b.fx + dy * b.fy) - b.hd, 0));
}
const RING = [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]];
export function openFloor(R, reach = 0.8, minArea = 1.6) {
  const { minX, minY, maxX, maxY } = R.bbox;
  const nx = Math.ceil((maxX - minX) / CELL), ny = Math.ceil((maxY - minY) / CELL);
  if (!(nx > 0 && ny > 0) || nx * ny > 6000) return null;
  const boxes = R.mine.filter(standing).map((p) => p._obb);
  const open = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * CELL, y = minY + (j + 0.5) * CELL;
      if (RING.every(([dx, dy]) => pointInPolygon([x + dx, y + dy], R.ip.poly)) && boxes.every((b) => boxGap(x, y, b) > reach)) open[j * nx + i] = 1;
    }
  }
  const seen = new Uint8Array(nx * ny);
  let best = null;
  for (let first = 0; first < open.length; first++) {
    if (!open[first] || seen[first]) continue;
    const stack = [first], cells = [];
    seen[first] = 1;
    for (let guard = 0; stack.length && guard < open.length + 1; guard++) {
      const c = stack.pop();
      cells.push(c);
      const i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const k = b * nx + a;
        if (open[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  if (!best || best.length * CELL * CELL < minArea) return null;
  let sx = 0, sy = 0, i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1;
  for (const c of best) {
    const i = c % nx, j = (c - i) / nx;
    sx += i; sy += j; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  const mx = sx / best.length, my = sy / best.length;
  let pick = best[0], dm = Infinity;
  for (const c of best) {
    const i = c % nx, j = (c - i) / nx, d = Math.hypot(i - mx, j - my);
    if (d < dm) { dm = d; pick = c; }
  }
  const pi = pick % nx, pj = (pick - pi) / nx;
  return { x: minX + (pi + 0.5) * CELL, y: minY + (pj + 0.5) * CELL, w: (i1 - i0 + 1) * CELL, h: (j1 - j0 + 1) * CELL, area: best.length * CELL * CELL };
}

// A living room that still lacks seats gets armchairs around the coffee table, turned to it, 0.75 m clear of it (a 0.7 m disc passes).
function seatByTable(R) {
  const sofa = R.mine.find((p) => /^sofa/.test(p.type)), ct = R.mine.find((p) => /^coffee-table/.test(p.type));
  if (R.type !== 'living' || R.area < 16 || !sofa || !ct) return;
  const [ux, uy] = axisOf(ct.rot);
  for (const r of [0, 0.15]) for (const a of [0, 180, 40, -40, 140, 220, 65, -65, 115, 245, 90, 270]) {
    if (seatsOf(R) >= 5) return;
    const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180), d = ct.size[0] / 2 + 1.175 + r;
    const dx = ux * c - uy * s, dy = uy * c + ux * s;
    R.at('armchair', { x: ct.x + dx * d, y: ct.y + dy * d, rot: rotFromFront(-dx, -dy), partners: [sofa, ct], noClear: true, soft: true, anyRoom: true, allFronts: true });
  }
}

// No rug of its own and no armchair on its own in the middle: a living room that still lacks a seat, or a room with open floor and no armchair,
// gets a reading corner (armchair, lamp, small table).
function fillFloor(R) {
  seatByTable(R);
  const lacking = R.type === 'living' && R.area >= 15.5 && seatsOf(R) < 5;
  if (!FLOOR_ROOMS.includes(R.type) || R.area < 9 || (R.mine.some((p) => p.type === 'armchair') && !lacking) || (!lacking && !openFloor(R))) return;
  const mk = R.mark(), ct = R.mine.find((p) => /^coffee-table/.test(p.type));
  let chair = R.corner('armchair', { anyRoom: true, noClear: true, allFronts: true }) ?? (lacking && R.corner('armchair', { anyRoom: true, noClear: true })) ?? null;
  for (const reach of lacking && !chair ? [0.8, 0.6, 0.4] : []) { // a seat still lacking: on the open floor, turned to the table
    const sp = openFloor(R, reach, 0.8);
    for (let n = 0; sp && n < 16 && !chair; n++) {
      const a = ((n % 8) * 45 * Math.PI) / 180, r = n < 8 ? 0.55 : 0.9, x = sp.x + Math.cos(a) * r, y = sp.y + Math.sin(a) * r;
      chair = R.at('armchair', { x, y, rot: rotFromFront((ct?.x ?? sp.x) - x, (ct?.y ?? sp.y) - y), anyRoom: true, allFronts: true });
    }
  }
  if (!chair) return;
  if (inDeskBack(R, chair)) { R.rollback(mk); return; }
  const [ux, uy] = axisOf(chair.rot);
  if (!R.mine.some((p) => p.type === 'floor-lamp' && Math.hypot(p.x - chair.x, p.y - chair.y) <= 1.6)) [1, -1].some((k) => R.at('floor-lamp', { x: chair.x + ux * k * 0.65, y: chair.y + uy * k * 0.65, rot: 0, anyRoom: true, noClear: true }));
}

// A seat added after the desk keeps out of the strip behind the desk chair.
const inDeskBack = (R, p) => R.mine.some((q) => q._deskBack && penetration(p._obb, q._deskBack) > 0.01);
const SEAT_N = { pouf: 1, 'dining-chair': 1, 'desk-chair': 1, armchair: 1, sofa2: 2, sofa3: 3, 'sofa-bed': 2, 'bar-stool': 1, 'bed-double': 2, 'bed-king': 2, 'bed-single': 1 };
const seatsOf = (R, beds = true) => R.mine.reduce((n, p) => n + (!beds && /^bed-/.test(p.type) ? 0 : (SEAT_N[p.type] ?? (p.type === 'bench' ? Math.floor(p.size[0] / 0.5) : 0))), 0);

// Somewhere to sit where people stay: a living room seats 5, an office 2 from 9 m2, a bedroom from 12 m2 has a seat besides the bed, a hall
// from 6 m2 and a dressing room from 5 m2 have a bench or a chair, and no room from 6 m2 is all cupboards. Armchair in a corner, else a bench.
function ensureSeats(R) {
  const t = R.type, a = t === 'hall' ? R.area : Math.max(R.area, R.facts?.area ?? 0) + 0.05, dressing = t === 'storage' && /dress|garder/i.test(R.room.name ?? '');
  let want = 0;
  if (t === 'living') want = R.zones?.includes('sleep') ? 0 : 5; // a studio keeps its floor for the bed
  else if (t === 'office') want = a >= 9 ? 2 : 1;
  else if (t === 'bedroom' || t === 'kids') want = a >= 12 ? 1 : 0;
  else if ((t === 'hall' && a >= 6) || (dressing && a >= 5)) want = 1;
  else if (['dining', 'storage'].includes(t) && a >= 6) want = 1;
  if (!want) return;
  const away = R.edges.flatMap((e) => [...e.doors, ...e.passages].map((d) => [e.a[0] + e.t[0] * (d.s0 + d.s1) / 2, e.a[1] + e.t[1] * (d.s0 + d.s1) / 2]));
  const have = () => (t === 'bedroom' || t === 'kids' ? seatsOf(R, false) : seatsOf(R));
  const place = (awayR, kinds) => { const mkp = R.mark(), got = place0(awayR, kinds); if (got && inDeskBack(R, got)) { R.rollback(mkp); return null; } return got; };
  const place0 = (awayR, kinds) => { // far from the doors first; a crowded room may come closer; an armchair or bench before a pouf
    const o = { anyRoom: true, allFronts: true, away, awayR };
    if (kinds === 'pouf') return R.corner('pouf', o) || R.wall('pouf', { ...o, avoidWindows: true });
    return (dressing || ['hall', 'bedroom', 'kids'].includes(t)) && [1.0, 0.6].reduce((got, w) => got || R.wall('bench', { ...o, avoidWindows: true, size: { w } }), null) || (!dressing && (R.corner('armchair', o) || R.wall('armchair', { ...o, avoidWindows: true }))); // a bench first where it is shallow enough to be wanted
  };
  const radii = t === 'hall' ? [1.0, 0.9, 0.6] : t === 'living' ? [1.7, 1.5] : [1.7, 1.5, 1.1];
  for (let k = 0; k < 3 && have() < want; k++) if (!['chair', 'pouf'].some((kind) => radii.some((r) => place(r, kind)))) break;
}

export function decorate(R) {
  if (R.type === 'stair') return; // a stairwell stays bare
  if (['living', 'dining', 'bedroom', 'kids', 'hall', 'office', 'other'].includes(R.type)) hangArt(R);
  if (['living', 'dining', 'bedroom', 'kids', 'office', 'kitchen', 'hall'].includes(R.type) && R.facts.windows > 0) hangCurtains(R);
  dressTops(R);
  hangMore(R);
  morePlants(R);
  moreRugs(R);
  fillFloor(R);
  ensureSeats(R); // last, so the floor step keeps its rug and armchair; a seat the room lacks still gets a place
}
