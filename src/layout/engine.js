// Layout engine: model (buildModel output) -> layout (docs/DESIGN.md section 3). Pure functions, no DOM, no three.js, deterministic.
// A room is furnished by its recipe (recipes.js) through the stage `R` made here: every placement is tested by fits(), which knows
// the interior of the room, door zones, window zones, stairs, the pieces already standing and the clear space in front of them.
import { SPEC_BY_ID, SPECS } from '../furniture/specs.js';
import { roomType, roomZones, roomFacts } from './rooms.js';
import { obb, penetration, boxInsidePolygon, frontOf, axisOf, rotFromFront, roomInterior, attachOpenings, freeIntervals, levelZones } from './geometry.js';
import { RECIPES, decorate } from './recipes.js';

export const LIMITS = Object.freeze({ perLevel: 400, total: 1500, fitsPerLevel: 60000, fitsTotal: 200000 });

export function mulberry32(seed) {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultAllowed() { return new Set(SPECS.filter((s) => s.tier <= 2).map((s) => s.id)); }
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Size of a piece: the spec size, with w, d, h overrides clamped to the spec's range (an axis without a range is fixed).
export function sizeOf(spec, o) {
  const out = [spec.size[0], spec.size[1], spec.size[2]];
  if (!o) return out;
  ['w', 'd', 'h'].forEach((k, i) => {
    const r = spec.range[k];
    if (o[k] !== undefined && r && Number.isFinite(o[k])) out[i] = r3(clamp(o[k], r[0], r[1]));
  });
  return out;
}

// Colour palettes: one per room, picked by the seeded generator, so a seed changes the look but never the positions.
const PALETTES = [
  { upholstery: '#b9a58f', cushions: '#c98f6a', bedding: '#e6dfd3', throw: '#b98d6a', fabric: '#c8b49a', border: '#8a7560', curtain: '#e9e2d6', canvas: '#c7b9a5' },
  { upholstery: '#8f9a8d', cushions: '#d2b48c', bedding: '#d9e0da', throw: '#7d8f7a', fabric: '#b6c0b0', border: '#6f7d6c', curtain: '#e3e8e0', canvas: '#a9b8a4' },
  { upholstery: '#7d8b99', cushions: '#e0c48b', bedding: '#dde3e8', throw: '#6b7f93', fabric: '#aab7c4', border: '#5d6f80', curtain: '#e6eaee', canvas: '#9fb0c2' },
  { upholstery: '#a9826a', cushions: '#e3d2b4', bedding: '#ece4d8', throw: '#9c6b52', fabric: '#cdb199', border: '#8c6a55', curtain: '#efe6d8', canvas: '#c9a58c' },
];
const SLOT_KEY = { upholstery: 'upholstery', cushions: 'cushions', cushion: 'cushions', bedding: 'bedding', pillows: 'bedding', throw: 'throw', fabric: 'fabric', border: 'border', canvas: 'canvas' };
function colorsFor(spec, pal) {
  const out = {};
  for (const slot of spec.slots) {
    const key = spec.id === 'curtain' && slot === 'fabric' ? 'curtain' : SLOT_KEY[slot];
    if (key && pal[key]) out[slot] = pal[key];
  }
  return out;
}

function blocks(p, q) {
  if (p.on === q.id || q.on === p.id) return false;
  if (p._flat !== q._flat) return false;
  const z = Math.min(p.elev + p.size[2], q.elev + q.size[2]) - Math.max(p.elev, q.elev);
  if (!(z > 0.002)) return false;
  return penetration(p._obb, q._obb) > 0.003;
}
export { blocks };

function solid(p) { return !p._flat && (p._mode === 'floor' || p._mode === 'corner'); }

function makeStage(lc, room, type, zone, interior) {
  const R = {
    lc, room, type, zone, level: lc.level, ip: interior, edges: interior.edges, area: interior.area, mine: [], rng: lc.rng,
    facts: lc.facts(room),
    minDim: 0,
    palette: PALETTES[Math.floor(lc.rng() * PALETTES.length) % PALETTES.length],
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of interior.poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  R.bbox = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  R.minDim = Math.min(R.bbox.w, R.bbox.h);

  R.can = (t, o = {}) => {
    const s = SPEC_BY_ID[t];
    if (!s || !lc.allow.has(t)) return false;
    if (lc.pieces.length >= LIMITS.perLevel || lc.state.count >= LIMITS.total) return false;
    return o.anyRoom || s.rooms.includes('any') || s.rooms.includes(R.zone) || s.rooms.includes(R.type);
  };
  R.mark = () => ({ n: lc.pieces.length, m: R.mine.length });
  R.rollback = (mk) => { lc.pieces.length = mk.n; R.mine.length = mk.m; };
  R.has = (t) => R.mine.some((p) => p.type === t);
  R.count = (t) => R.mine.filter((p) => p.type === t).length;

  R.edgeScore = (e, windows = true) => (freeIntervals(e, { pad: 0.04, windows, minLen: 0.3 })[0]?.reduce((a, b) => b - a) ?? 0);
  R.edgesBy = (score) => R.edges.map((e, i) => ({ e, i, v: score(e) })).sort((a, b) => b.v - a.v || a.i - b.i).map((x) => x.e);

  function make(t, o) {
    const spec = SPEC_BY_ID[t];
    const size = sizeOf(spec, o.size);
    const mode = spec.place.mode;
    let elev = o.elev;
    if (elev === undefined) {
      elev = mode === 'wall-mount' ? (spec.place.elevation ?? 0) : mode === 'ceiling' ? Math.min(spec.place.elevation ?? 2, lc.level.height - size[2] - 0.05) : 0;
    }
    const x = r3(o.x), y = r3(o.y), rot = r3(((o.rot % 360) + 360) % 360);
    const p = { id: '', type: t, room: R.room.id, x, y, rot, size, elev: r3(elev), on: o.on ?? null, colors: colorsFor(spec, R.palette), _spec: spec, _flat: mode === 'floor-flat', _mode: mode };
    p._obb = obb(x, y, size[0], size[1], rot);
    return p;
  }

  function fits(p, o = {}) {
    const no = (why) => { const d = lc.state.debug; if (d) { const k = `${p.type}:${why}`; d[k] = (d[k] ?? 0) + 1; } return false; };
    if (lc.state.fits >= LIMITS.fitsTotal || lc.fits >= LIMITS.fitsPerLevel) return no(1);
    lc.fits++; lc.state.fits++;
    const box = p._obb, spec = p._spec;
    if (![p.x, p.y, p.rot, p.elev, ...p.size].every(Number.isFinite)) return no(2);
    if (!boxInsidePolygon(box, R.ip.poly)) return no(3);
    const z0 = p.elev, z1 = p.elev + p.size[2];
    for (const dz of lc.zones.doors) if (z0 < dz.top && penetration(box, dz.box) > 0.004) return no(4);
    for (const st of lc.zones.stairs) if (penetration(box, st.box) > 0.004) return no(5);
    if ((spec.tall || p._mode === 'wall-mount') && p._mode !== 'window') {
      for (const wz of lc.zones.windows) if (z1 > wz.sill && z0 < wz.top && penetration(box, wz.box) > 0.004) return no(6);
    }
    for (const q of lc.pieces) if (blocks(p, q)) return no(7);
    const partners = o.partners ?? [];
    let clear = null;
    if (solid(p) && spec.place.clearFront > 0 && !o.noClear) {
      const cf = spec.place.clearFront * (o.clear ?? 1);
      const [fx, fy] = frontOf(p.rot);
      clear = obb(p.x + fx * (p.size[1] / 2 + cf / 2), p.y + fy * (p.size[1] / 2 + cf / 2), p.size[0] * 0.9, cf, p.rot);
      for (const q of lc.pieces) if (q.room === p.room && solid(q) && !partners.includes(q) && penetration(clear, q._obb) > 0.01) return no(8);
    }
    if (solid(p) && !o.noClear) {
      for (const q of lc.pieces) if (q.room === p.room && q._clear && !partners.includes(q) && penetration(box, q._clear) > 0.01) return no(9);
    }
    p._clearBox = clear;
    return true;
  }

  function commit(p, o = {}) {
    lc.state.count++;
    p.id = `p${lc.state.count}`;
    p._clear = p._clearBox ?? null;
    p._partners = o.partners ?? [];
    delete p._clearBox;
    lc.pieces.push(p);
    R.mine.push(p);
    return p;
  }

  // Exact placement. Returns the piece or null.
  R.at = (t, o) => {
    if (!R.can(t, o)) return null;
    const p = make(t, o);
    for (const cf of o.soft ? [1, 0.6, 0.3] : [1]) {
      if (fits(p, { ...o, clear: cf })) { p._edge = o.edge ?? null; return commit(p, o); }
    }
    return null;
  };

  // A piece with its back on edge `e` at s (centre along the edge).
  R.alongEdge = (t, e, s, o = {}) => {
    const spec = SPEC_BY_ID[t];
    const [w, d] = sizeOf(spec, o.size);
    const gap = o.gap ?? (spec.place.mode === 'wall-mount' || spec.place.mode === 'window' ? 0.004 : 0.012);
    const x = e.a[0] + e.t[0] * s + e.n[0] * (d / 2 + gap), y = e.a[1] + e.t[1] * s + e.n[1] * (d / 2 + gap);
    return R.at(t, { ...o, x, y, rot: rotFromFront(e.n[0], e.n[1]), edge: e, s, w, d });
  };

  // Against a wall: tries clearances 1, 0.6, 0.3 and, within each, edges (best first) and the free parts of each edge.
  R.wall = (t, o = {}) => {
    if (!R.can(t, o)) return null;
    const spec = SPEC_BY_ID[t];
    const [w] = sizeOf(spec, o.size);
    const edges = o.edges ?? R.edgesBy(o.score ?? ((e) => R.edgeScore(e, true)));
    const margins = o.margins ?? [o.margin ?? 0.02];
    for (const cf of o.soft === false ? [1] : [1, 0.6, 0.3]) {
      for (const avoid of o.avoidWindows === false ? [false] : o.avoidWindows ? [true] : [true, false]) {
        for (const margin of margins) {
          for (const e of edges) {
            let ivs = freeIntervals(e, { pad: 0.04, windows: avoid, minLen: w + 2 * margin });
            const want = o.around ? (o.around[0] - e.a[0]) * e.t[0] + (o.around[1] - e.a[1]) * e.t[1] : null;
            if (want !== null) ivs = ivs.slice().sort((x, y) => Math.abs(clamp(want, x[0], x[1]) - want) - Math.abs(clamp(want, y[0], y[1]) - want));
            for (const [a, b] of ivs) {
              const lo = a + margin + w / 2, hi = b - margin - w / 2;
              if (hi < lo - 1e-9) continue;
              const mid = (lo + hi) / 2;
              // the preferred spot first, then the free stretch scanned every ~0.2 m (a door zone may cut the first choice)
              const first = want !== null ? clamp(want, lo, hi) : o.align === 'start' ? lo : o.align === 'end' ? hi : mid;
              const spots = [first];
              if (want === null) {
                const steps = Math.min(30, Math.floor((hi - lo) / 0.2));
                const scan = [];
                for (let k = 0; k <= steps; k++) scan.push(lo + (steps ? (k * (hi - lo)) / steps : 0));
                if (o.align !== 'any') scan.sort((x, y) => Math.abs(x - first) - Math.abs(y - first));
                spots.push(...scan);
              }
              for (const s of spots) {
                const gap = o.gap ?? (spec.place.mode === 'wall-mount' ? 0.004 : 0.012);
                const [, d] = sizeOf(spec, o.size);
                const x = e.a[0] + e.t[0] * s + e.n[0] * (d / 2 + gap), y = e.a[1] + e.t[1] * s + e.n[1] * (d / 2 + gap);
                const p = make(t, { ...o, x, y, rot: rotFromFront(e.n[0], e.n[1]) });
                if (fits(p, { ...o, clear: cf })) {
                  p._edge = e; p._s = s;
                  if (!o.accept) return commit(p, o);
                  const mk = R.mark();
                  commit(p, o);
                  if (o.accept(p)) return p;
                  R.rollback(mk);
                }
              }
            }
          }
        }
      }
    }
    return null;
  };

  // In a convex, nearly right angled corner (back on one wall, side to the other).
  R.corner = (t, o = {}) => {
    if (!R.can(t, o)) return null;
    const spec = SPEC_BY_ID[t];
    const [w, d] = sizeOf(spec, o.size);
    const gap = 0.012;
    const corners = o.order ? R.ip.corners.slice().sort(o.order) : R.ip.corners;
    for (const cf of [1, 0.6, 0.3]) {
      for (const c of corners) {
        for (const [e, side] of [[c.e2, 1], [c.e1, -1]]) {
          const x = c.v[0] + side * e.t[0] * (w / 2 + gap) + e.n[0] * (d / 2 + gap), y = c.v[1] + side * e.t[1] * (w / 2 + gap) + e.n[1] * (d / 2 + gap);
          const p = make(t, { ...o, x, y, rot: rotFromFront(e.n[0], e.n[1]) });
          if (fits(p, { ...o, clear: cf })) { p._edge = e; return commit(p, o); }
        }
      }
    }
    return null;
  };

  // Something that sits on a piece (dx across, dy along the front of the parent, both from its centre).
  R.on = (parent, t, o = {}) => {
    if (!parent || !R.can(t, o)) return null;
    const spec = SPEC_BY_ID[t];
    if (!spec.place.onTop?.includes(parent.type)) return null;
    const [fx, fy] = frontOf(parent.rot), [ux, uy] = axisOf(parent.rot);
    const x = parent.x + ux * (o.dx ?? 0) + fx * (o.dy ?? 0), y = parent.y + uy * (o.dx ?? 0) + fy * (o.dy ?? 0);
    const p = make(t, { ...o, x, y, rot: parent.rot + (o.rot ?? 0), elev: parent.elev + parent.size[2], on: parent.id });
    if (!fits(p, { noClear: true })) return null;
    p._edge = parent._edge ?? null;
    return commit(p, o);
  };

  R.pointDistance = (x, y) => {
    let best = Infinity;
    for (const e of R.edges) {
      const t = clamp(((x - e.a[0]) * e.t[0] + (y - e.a[1]) * e.t[1]), 0, e.len);
      best = Math.min(best, Math.hypot(x - (e.a[0] + e.t[0] * t), y - (e.a[1] + e.t[1] * t)));
    }
    return best;
  };
  // Free stretches of an edge for a run of pieces `depth` deep: door and passage zones of every door on the level, stairs and
  // (when `windows`) window spans are cut out. [a, b] pairs, longest first.
  R.zoneFree = (e, depth, { minLen = 0.3, windows = false } = {}) => {
    const n = Math.min(80, Math.max(1, Math.ceil(e.len / 0.05)));
    const step = e.len / n;
    const blocked = new Array(n).fill(false);
    const rot = rotFromFront(e.n[0], e.n[1]);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * step;
      const probe = obb(e.a[0] + e.t[0] * s + e.n[0] * (depth / 2 + 0.012), e.a[1] + e.t[1] * s + e.n[1] * (depth / 2 + 0.012), step, depth, rot);
      for (const dz of lc.zones.doors) if (penetration(probe, dz.box) > 0.004) { blocked[i] = true; break; }
      if (!blocked[i]) for (const st of lc.zones.stairs) if (penetration(probe, st.box) > 0.004) { blocked[i] = true; break; }
      if (!blocked[i] && windows) blocked[i] = e.windows.some((w) => s >= w.s0 - 0.02 && s <= w.s1 + 0.02);
    }
    const out = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && !blocked[i]) { if (start < 0) start = i; continue; }
      if (start >= 0) { const a = start * step, b = i * step; if (b - a >= minLen) out.push([a, b]); start = -1; }
    }
    return out.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
  };
  // Open floor points, most roomy first (clearance from the walls), deterministic grid with a hard cap, spread apart.
  R.roomyPoints = (minClear, limit = 30) => {
    const step = Math.max(0.2, Math.sqrt((R.bbox.w * R.bbox.h) / 1500));
    const pts = [];
    const nx = Math.min(80, Math.floor(R.bbox.w / step)), ny = Math.min(80, Math.floor(R.bbox.h / step));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
      const x = R.bbox.minX + (i + 0.5) * (R.bbox.w / (nx + 1)), y = R.bbox.minY + (j + 0.5) * (R.bbox.h / (ny + 1));
      if (!boxInsidePolygon(obb(x, y, 0.1, 0.1, 0), R.ip.poly)) continue;
      const c = R.pointDistance(x, y);
      if (c >= minClear) pts.push({ x, y, c });
    }
    pts.sort((a, b) => b.c - a.c || a.x - b.x || a.y - b.y);
    const out = [];
    for (const q of pts) {
      if (out.length >= limit) break;
      if (out.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= 0.35)) out.push(q);
    }
    return out;
  };
  return R;
}

export function autoFurnish(model, { seed = 1, allowedTypes, debug = false } = {}) {
  const allow = allowedTypes ? new Set(allowedTypes) : defaultAllowed();
  const state = { count: 0, fits: 0, debug: debug ? {} : null };
  const out = { version: 1, seed: Number.isFinite(seed) ? seed : 1, levels: [] };
  const rng = mulberry32(out.seed);
  for (const level of model.levels ?? []) {
    const lc = { level, model, allow, rng, state, pieces: [], fits: 0, zones: null, facts: (r) => roomFacts(level, r) };
    try { lc.zones = levelZones(level, model); } catch { lc.zones = { doors: [], windows: [], stairs: [] }; }
    const rooms = (level.rooms ?? []).slice(0, 150);
    const stages = [];
    for (const room of rooms) {
      let interior = null;
      try { interior = roomInterior(level, room); } catch { interior = null; }
      if (!interior) continue;
      try { attachOpenings(level, interior); } catch { continue; }
      const type = roomType(room, model);
      const zones = roomZones(room, model);
      const R = makeStage(lc, room, type, type, interior);
      stages.push(R);
      for (const z of zones) {
        R.zone = z;
        const recipe = RECIPES[z];
        if (recipe) recipe(R);
      }
      R.zone = type;
    }
    for (const R of stages) { try { decorate(R); } catch { /* a bad room must not stop the others */ } }
    out.levels.push({ id: level.id, pieces: lc.pieces.map(clean) });
  }
  if (debug) out.debug = state.debug;
  return out;
}

function clean(p) {
  return { id: p.id, type: p.type, room: p.room, x: p.x, y: p.y, rot: p.rot, size: p.size, elev: p.elev, on: p.on, colors: p.colors };
}
