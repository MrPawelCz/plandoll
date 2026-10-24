// Editor state: { layout, selection, history } with immutable updates. Every operation returns { state, ok, reason?, problems? } and
// never throws; when it fails, `state` is the input state itself. Pure functions: no DOM, no three.js, no storage.
//
// Options shared by the operations that place a piece (addPiece, movePiece, rotatePiece, resizePiece):
//   model         built plan model; without it only the layout based checks run (overlap, props)
//   mode          'soft' (default: snap, report problems, accept), 'strict' (also refuse hard problems: overlap, outside the room,
//                 prop without support) or 'off' (no snapping and no checks)
//   snap          false, or overrides for the snapping steps (see rules.js)
//   coalesceKey   operations with the same key in a row share one undo step (a drag of one piece)
import { specOf } from '../furniture/specs.js';
import { LIMITS, autoFurnish } from '../layout/engine.js';
import { MATERIAL_DEFS } from '../render/matgen.js';
import { placeAt, placementProblems, hardProblems, roomAt, normRot } from './rules.js';

export const HISTORY_LIMIT = 200;
export const MATERIAL_KEYS = Object.freeze(Object.keys(MATERIAL_DEFS));
const MATERIAL_SET = new Set(MATERIAL_KEYS);
const HEX = /^#[0-9a-fA-F]{6}$/;

const r3 = (v) => Math.round(v * 1000) / 1000;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- construction and queries ----
export function emptyLayout(seed = 1) { return { version: 1, seed: fin(seed) ? seed : 1, levels: [] }; }
function validLayout(l) { return isObj(l) && Array.isArray(l.levels) && l.levels.every((lv) => isObj(lv) && Array.isArray(lv.pieces)); }
function validState(s) { return isObj(s) && validLayout(s.layout) && isObj(s.history) && Array.isArray(s.history.past) && Array.isArray(s.history.future); }

export function createState(layout) {
  return { layout: validLayout(layout) ? layout : emptyLayout(), selection: null, history: { past: [], future: [], key: null } };
}
export function findPiece(layout, id) {
  if (!validLayout(layout)) return null;
  for (let li = 0; li < layout.levels.length; li++) {
    const ps = layout.levels[li].pieces;
    for (let pi = 0; pi < ps.length; pi++) if (ps[pi] && ps[pi].id === id) return { li, pi, level: layout.levels[li], piece: ps[pi] };
  }
  return null;
}
export function selectedPiece(state) { return validState(state) && state.selection ? findPiece(state.layout, state.selection)?.piece ?? null : null; }
export const canUndo = (state) => validState(state) && state.history.past.length > 0;
export const canRedo = (state) => validState(state) && state.history.future.length > 0;
export function pieceCount(layout) { return validLayout(layout) ? layout.levels.reduce((n, l) => n + l.pieces.length, 0) : 0; }

// Topmost piece under a plan point on a level (props over the furniture they stand on), or null. For tap and click picking.
export function pieceAt(layout, levelId, x, y) {
  if (!validLayout(layout) || !fin(x) || !fin(y)) return null;
  const level = layout.levels.find((l) => l.id === levelId);
  if (!level) return null;
  let best = null;
  for (const q of level.pieces) {
    if (![q.x, q.y, q.rot, q.elev, ...(q.size ?? [])].every(fin) || q.size.length !== 3) continue;
    const a = q.rot * Math.PI / 180, dx = x - q.x, dy = y - q.y;
    const u = dx * Math.cos(a) + dy * Math.sin(a), f = -dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(u) > q.size[0] / 2 || Math.abs(f) > q.size[1] / 2) continue;
    const top = q.elev + q.size[2];
    if (!best || top > best.elev + best.size[2]) best = q;
  }
  return best;
}

// ---- internals ----
const fail = (state, reason, extra = {}) => ({ state, ok: false, reason, ...extra });
const optsOf = (o) => (isObj(o) ? o : {});
function guarded(fn) {
  return (state, ...args) => {
    try {
      if (!validState(state)) return { state, ok: false, reason: 'bad-state' };
      return fn(state, ...args);
    } catch (e) {
      return { state, ok: false, reason: 'internal-error', error: String(e && e.message).slice(0, 200) };
    }
  };
}

function withPieces(layout, li, pieces) {
  const levels = layout.levels.slice();
  levels[li] = { ...layout.levels[li], pieces };
  return { ...layout, levels };
}
function replacePieces(layout, changes) { // changes: Map(id -> piece or null to delete)
  const levels = layout.levels.map((lv) => {
    if (!lv.pieces.some((p) => changes.has(p.id))) return lv;
    const pieces = [];
    for (const p of lv.pieces) { if (!changes.has(p.id)) pieces.push(p); else if (changes.get(p.id)) pieces.push(changes.get(p.id)); }
    return { ...lv, pieces };
  });
  return { ...layout, levels };
}
// All pieces standing on `id`, directly or through other pieces (bounded, cycle safe).
function descendants(level, id) {
  const out = [], seen = new Set([id]);
  for (let i = 0, queue = [id]; i < queue.length && i < 2000; i++) {
    for (const p of level.pieces) if (p.on === queue[i] && !seen.has(p.id)) { seen.add(p.id); out.push(p); queue.push(p.id); }
  }
  return out;
}
function nextId(layout) {
  let max = 0;
  const ids = new Set();
  for (const lv of layout.levels) for (const p of lv.pieces) {
    ids.add(p.id);
    const m = typeof p.id === 'string' ? /^p(\d{1,9})$/.exec(p.id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (ids.has(`p${n}`) && n < max + 5000) n++;
  return `p${n}`;
}
function commit(state, layout, o = {}) {
  const h = state.history;
  const merge = o.key != null && h.key === o.key && h.past.length > 0;
  let past = h.past;
  if (!merge) { past = past.concat([state.layout]); if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT); }
  const selection = o.selection !== undefined ? o.selection : state.selection;
  return { layout, selection: selection && findPiece(layout, selection) ? selection : null, history: { past, future: [], key: o.key ?? null } };
}
function modeOf(o) { return o.mode === 'strict' || o.mode === 'off' ? o.mode : 'soft'; }

// Size from a base size and a request ([w, d, h], { w, d, h } or a partial of those), clamped to the spec's range. An axis without a
// range keeps its base value. Returns { size, clamped } or null when the request holds a non-finite number.
export function sizeFrom(spec, base, req) {
  const want = Array.isArray(req) ? { w: req[0], d: req[1], h: req[2] } : isObj(req) ? req : {};
  const size = [base[0], base[1], base[2]];
  let clamped = false;
  for (const [i, k] of ['w', 'd', 'h'].entries()) {
    if (want[k] === undefined || want[k] === null) continue;
    if (!fin(want[k])) return null;
    const r = spec.range[k];
    if (!r) { if (Math.abs(want[k] - base[i]) > 1e-9) clamped = true; continue; }
    const v = r3(Math.min(r[1], Math.max(r[0], want[k])));
    if (Math.abs(v - want[k]) > 1e-9) clamped = true;
    size[i] = v;
  }
  return { size, clamped };
}

// Colour value of a slot: `#rrggbb` (stored lower case) or a key of the material library. Returns the value or null.
export function cleanColor(v, materialKeys = MATERIAL_SET) {
  if (typeof v !== 'string') return null;
  if (HEX.test(v)) return v.toLowerCase();
  const keys = materialKeys instanceof Set ? materialKeys : new Set(materialKeys ?? []);
  return keys.has(v) ? v : null;
}

function judge(state, res, o) {
  if (modeOf(o) !== 'strict') return null;
  const hard = hardProblems(res.problems);
  return hard.length ? fail(state, hard[0].kind, { problems: res.problems }) : null;
}
function placeOpts(o, extra = {}) {
  if (modeOf(o) === 'off' || o.snap === false) return { snap: false };
  return { snap: { ...(isObj(o.snap) ? o.snap : {}), ...extra } };
}
const levelIdAt = (layout, li) => layout.levels[li].id;

// ---- operations ----
export const selectPiece = guarded((state, id) => {
  if (id === null || id === undefined) return { state: { ...state, selection: null }, ok: true };
  if (!findPiece(state.layout, id)) return fail(state, 'unknown-id');
  return { state: { ...state, selection: id }, ok: true };
});

// addPiece(state, { type, x, y, rot?, level?, room?, size?, colors?, elev? }, opts)
export const addPiece = guarded((state, req, opts) => {
  const o = optsOf(opts), a = isObj(req) ? req : {};
  const spec = specOf(a.type);
  if (!spec) return fail(state, 'unknown-type');
  const rot0 = a.rot === undefined ? 0 : a.rot;
  if (!fin(a.x) || !fin(a.y) || !fin(rot0)) return fail(state, 'bad-number');
  let li = -1;
  if (a.level !== undefined) li = state.layout.levels.findIndex((l) => l.id === a.level);
  else { const f = state.selection ? findPiece(state.layout, state.selection) : null; li = f ? f.li : state.layout.levels.length ? 0 : -1; }
  if (li < 0) return fail(state, 'unknown-level');
  const levelId = levelIdAt(state.layout, li);
  if (state.layout.levels[li].pieces.length >= LIMITS.perLevel) return fail(state, 'limit-level');
  if (pieceCount(state.layout) >= LIMITS.total) return fail(state, 'limit-total');
  if (a.size !== undefined && !Array.isArray(a.size) && !isObj(a.size)) return fail(state, 'bad-number');
  const sz = sizeFrom(spec, spec.size, a.size);
  if (!sz) return fail(state, 'bad-number');
  const mode = modeOf(o);
  const lvModel = o.model?.levels?.find?.((l) => l.id === levelId);
  let elev = a.elev;
  if (elev !== undefined && !fin(elev)) return fail(state, 'bad-number');
  if (elev === undefined) {
    const pm = spec.place.mode;
    elev = pm === 'wall-mount' ? (spec.place.elevation ?? 0) : pm === 'ceiling' ? Math.min(spec.place.elevation ?? 2, (lvModel?.height ?? 2.7) - sz.size[2] - 0.05) : 0;
  }
  const colors = {};
  if (a.colors !== undefined) {
    if (!isObj(a.colors)) return fail(state, 'bad-color');
    for (const k of Object.keys(a.colors)) {
      if (!spec.slots.includes(k)) return fail(state, 'bad-slot');
      const c = cleanColor(a.colors[k], o.materialKeys);
      if (!c) return fail(state, 'bad-color');
      colors[k] = c;
    }
  }
  let room = typeof a.room === 'string' ? a.room : null;
  if (o.model) { const r = roomAt(o.model, levelId, a.x, a.y, room); if (r) room = r; if (!room) return fail(state, 'no-room'); }
  const base = { id: nextId(state.layout), type: spec.id, room: room ?? '', x: a.x, y: a.y, rot: normRot(rot0), size: sz.size, elev: r3(elev), on: null, colors };
  let piece = base, problems = [], snapped = null;
  if (mode !== 'off') {
    const res = placeAt(o.model, state.layout, levelId, base, { x: a.x, y: a.y, rot: rot0 }, placeOpts(o));
    const bad = judge(state, res, o);
    if (bad) return bad;
    piece = { ...base, x: res.x, y: res.y, rot: res.rot, room: res.room ?? base.room, on: res.on, elev: res.elev };
    problems = res.problems;
    snapped = res.snapped;
  } else piece = { ...base, x: r3(a.x), y: r3(a.y) };
  const layout = withPieces(state.layout, li, state.layout.levels[li].pieces.concat([piece]));
  return { state: commit(state, layout, { selection: piece.id, key: o.coalesceKey }), ok: true, id: piece.id, problems, snapped };
});

// movePiece(state, id, x, y, opts): the pieces standing on it move along (and turn with it when a wall straightens it).
export const movePiece = guarded((state, id, x, y, opts) => {
  const o = optsOf(opts);
  const f = findPiece(state.layout, id);
  if (!f) return fail(state, 'unknown-id');
  if (!fin(x) || !fin(y)) return fail(state, 'bad-number');
  return placeFound(state, f, { x, y, rot: f.piece.rot }, o, { keepRot: true });
});

// rotatePiece(state, id, deg, opts): the new angle in degrees clockwise (any real number; turnPiece adds to the current angle).
export const rotatePiece = guarded((state, id, deg, opts) => {
  const o = optsOf(opts);
  const f = findPiece(state.layout, id);
  if (!f) return fail(state, 'unknown-id');
  if (!fin(deg)) return fail(state, 'bad-number');
  return placeFound(state, f, { x: f.piece.x, y: f.piece.y, rot: deg }, o, { keepRot: false, noGrid: true });
});
export function turnPiece(state, id, delta, opts) {
  const f = validState(state) ? findPiece(state.layout, id) : null;
  if (!f) return fail(state, validState(state) ? 'unknown-id' : 'bad-state');
  if (!fin(delta)) return fail(state, 'bad-number');
  return rotatePiece(state, id, f.piece.rot + delta, opts);
}

function placeFound(state, f, want, o, flags) {
  const levelId = f.level.id, piece = f.piece, mode = modeOf(o);
  let res;
  if (mode === 'off') res = { x: r3(want.x), y: r3(want.y), rot: normRot(want.rot), room: piece.room, on: piece.on, elev: piece.elev, snapped: {}, problems: [] };
  else res = placeAt(o.model, state.layout, levelId, piece, want, { ...placeOpts(o, flags.noGrid ? { grid: 0 } : {}), keepRot: flags.keepRot });
  const bad = judge(state, res, o);
  if (bad) return bad;
  if (res.x === piece.x && res.y === piece.y && res.rot === normRot(piece.rot) && res.room === piece.room && res.on === piece.on && res.elev === piece.elev) return fail(state, 'no-change', { problems: res.problems });
  const changes = new Map();
  const moved = { ...piece, x: res.x, y: res.y, rot: res.rot, room: res.room ?? piece.room, on: res.on, elev: res.elev };
  changes.set(piece.id, moved);
  const drot = moved.rot - piece.rot, a = drot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const dTop = (moved.elev + moved.size[2]) - (piece.elev + piece.size[2]);
  for (const c of descendants(f.level, piece.id)) {
    const dx = c.x - piece.x, dy = c.y - piece.y;
    changes.set(c.id, { ...c, x: r3(moved.x + dx * cs - dy * sn), y: r3(moved.y + dx * sn + dy * cs), rot: normRot(c.rot + drot), room: moved.room, elev: r3(c.elev + dTop) });
  }
  return { state: commit(state, replacePieces(state.layout, changes), { selection: piece.id, key: o.coalesceKey }), ok: true, problems: res.problems, snapped: res.snapped };
}

// deletePiece: the pieces standing on the deleted one go with it (one undo step brings them all back).
export const deletePiece = guarded((state, id) => {
  const f = findPiece(state.layout, id);
  if (!f) return fail(state, 'unknown-id');
  const changes = new Map([[id, null]]);
  for (const c of descendants(f.level, id)) changes.set(c.id, null);
  return { state: commit(state, replacePieces(state.layout, changes), { selection: state.selection && changes.has(state.selection) ? null : state.selection }), ok: true, removed: [...changes.keys()] };
});

// resizePiece(state, id, size, opts): size is [w, d, h] or a partial { w, d, h }; values are clamped to the spec's range and the
// footprint grows around the centre.
export const resizePiece = guarded((state, id, size, opts) => {
  const o = optsOf(opts);
  const f = findPiece(state.layout, id);
  if (!f) return fail(state, 'unknown-id');
  const spec = specOf(f.piece.type);
  if (!spec) return fail(state, 'unknown-type');
  const sz = sizeFrom(spec, f.piece.size, size);
  if (!sz) return fail(state, 'bad-number');
  if (sz.size.every((v, i) => Math.abs(v - f.piece.size[i]) < 1e-9)) return fail(state, sz.clamped ? 'fixed-size' : 'no-change');
  const next = { ...f.piece, size: sz.size };
  let problems = [];
  if (modeOf(o) !== 'off') {
    problems = placementProblems(o.model, state.layout, f.level.id, next);
    if (modeOf(o) === 'strict') { const hard = hardProblems(problems); if (hard.length) return fail(state, hard[0].kind, { problems }); }
  }
  const changes = new Map([[next.id, next]]);
  const dTop = (next.elev + next.size[2]) - (f.piece.elev + f.piece.size[2]);
  if (Math.abs(dTop) > 1e-9) for (const c of descendants(f.level, next.id)) changes.set(c.id, { ...c, elev: r3(c.elev + dTop) });
  return { state: commit(state, replacePieces(state.layout, changes), { selection: next.id, key: o.coalesceKey }), ok: true, clamped: sz.clamped, problems };
});

// recolorPiece(state, id, slot, color, opts): color is `#rrggbb`, a material library key, or null to go back to the piece's default.
export const recolorPiece = guarded((state, id, slot, color, opts) => {
  const o = optsOf(opts);
  const f = findPiece(state.layout, id);
  if (!f) return fail(state, 'unknown-id');
  const spec = specOf(f.piece.type);
  if (!spec || typeof slot !== 'string' || !spec.slots.includes(slot)) return fail(state, 'bad-slot');
  const colors = { ...f.piece.colors };
  if (color === null) { if (!own(colors, slot)) return fail(state, 'no-change'); delete colors[slot]; }
  else {
    const c = cleanColor(color, o.materialKeys);
    if (!c) return fail(state, 'bad-color');
    if (colors[slot] === c) return fail(state, 'no-change');
    colors[slot] = c;
  }
  return { state: commit(state, replacePieces(state.layout, new Map([[id, { ...f.piece, colors }]])), { selection: id, key: o.coalesceKey }), ok: true };
});

// resetToAuto(state, model, { seed?, allowedTypes? }): the layout engine furnishes the plan again (one undo step).
export const resetToAuto = guarded((state, model, opts) => {
  const o = optsOf(opts);
  let layout;
  try { layout = autoFurnish(model, { seed: fin(o.seed) ? o.seed : state.layout.seed, allowedTypes: o.allowedTypes }); } catch { return fail(state, 'engine-error'); }
  if (!validLayout(layout)) return fail(state, 'engine-error');
  return { state: commit(state, layout, { selection: null }), ok: true };
});

// Replace the whole layout (a loaded file): one undo step.
export const loadLayout = guarded((state, layout) => {
  if (!validLayout(layout)) return fail(state, 'bad-layout');
  return { state: commit(state, layout, { selection: null }), ok: true };
});

export const undo = guarded((state) => {
  const h = state.history;
  if (!h.past.length) return fail(state, 'nothing-to-undo');
  const layout = h.past[h.past.length - 1];
  return { state: { layout, selection: state.selection && findPiece(layout, state.selection) ? state.selection : null, history: { past: h.past.slice(0, -1), future: h.future.concat([state.layout]), key: null } }, ok: true };
});
export const redo = guarded((state) => {
  const h = state.history;
  if (!h.future.length) return fail(state, 'nothing-to-redo');
  const layout = h.future[h.future.length - 1];
  return { state: { layout, selection: state.selection && findPiece(layout, state.selection) ? state.selection : null, history: { past: h.past.concat([state.layout]), future: h.future.slice(0, -1), key: null } }, ok: true };
});
