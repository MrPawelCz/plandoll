// Editing session for the page: holds the editor state (src/editor), forwards the operations of the interface to it and tells the page
// what to redraw. Pure logic (no DOM, no three.js): tested in Node on the example plans.
//   createEditSession({ layout, model, onChange, allowedTypes }) -> session
//   onChange({ type }) is called after every change of the state: 'structure' (pieces added, removed, resized, recoloured, turned,
//   undone, loaded: the page re-composes what changed), 'drag' (a piece is being dragged: only move its group), 'dragend' (the drag
//   is over: refresh lights and shadows), 'select' (only the selection changed). subscribe(fn) gets fn({ type: 'change' | 'select' }).
//   Rooms: selectRoom(levelId, roomId | null) / selectedRoom() -> { level, id, name, colors: { wall?, floor? } } | null, recolorRoom(part, color | null);
//   a piece and a room are never selected together. duplicate() copies the selected piece. snapEdges() / setSnapEdges(on) switch the
//   snapping of a dragged piece to the sides of its neighbours (off by default).
import { specOf } from '../furniture/specs.js';
import {
  createState, findPiece, selectPiece, addPiece, movePiece, turnPiece, deletePiece, resizePiece, recolorPiece, resetToAuto, loadLayout,
  undo, redo, canUndo, canRedo, placeAt, placementProblems, roomAt, serializeLayout, parseLayout, duplicatePiece, recolorRoom, roomColorsOf,
} from '../editor/index.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const CLEAN = (problems) => !problems.some((p) => ['overlap', 'outside-room', 'door-zone', 'stair', 'floating-prop'].includes(p.kind));
const MAX_CANDIDATES = 600, STEP = 0.4;

// Would the piece `id` stand clean with its centre at plan point (x, y) on its own level (no overlap, inside a room, outside the door zones, not on a stair, not
// floating)? Pure: the layout is not touched and nothing is dragged. Returns { ok, problems } with the problem list of the editor rules; an unknown id or
// a number that is not finite gives { ok: false, problems: [{ kind: 'unknown-piece' | 'bad-number' }] }.
export function placeCheck(model, layout, id, x, y) {
  const f = findPiece(layout, id);
  if (!f) return { ok: false, problems: [{ kind: 'unknown-piece' }] };
  if (!fin(x) || !fin(y)) return { ok: false, problems: [{ kind: 'bad-number' }] };
  const room = roomAt(model, f.level.id, x, y, f.piece.room); // the room under the new place; outside every room it keeps the old one and the rules report it
  const problems = placementProblems(model, layout, f.level.id, { ...f.piece, x, y, room: room ?? f.piece.room });
  return { ok: CLEAN(problems), problems };
}

// viewPoint() -> { level, x, y } | null is the place the view is centred on: the default for add().
export function createEditSession({ layout, model, onChange = () => {}, allowedTypes, viewPoint = null } = {}) {
  let state = createState(layout), drag = null, dragSeq = 0, roomSel = null, edges = false;
  const subs = new Set();
  function emit(type) {
    try { onChange({ type }); } catch { /* the page must not break the session */ }
    for (const fn of [...subs]) { try { fn({ type: type === 'select' ? 'select' : 'change' }); } catch { /* same */ } }
  }
  const found = (id) => (id ? findPiece(state.layout, id) : null);
  const selectedFound = () => found(state.selection);
  // Applies the result of an editor operation; the failure reason goes back to the caller.
  function apply(res, type = 'structure') {
    if (!res.ok) return { ok: false, reason: res.reason };
    state = res.state;
    if (state.selection) roomSel = null;
    emit(type);
    return { ok: true, id: res.id, problems: res.problems };
  }

  // The best free place for a new piece: candidate points of the room, nearest to `want` first, the first without a hard problem wins.
  function freePlace(levelId, spec, want) {
    const level = model?.levels?.find?.((l) => l.id === levelId);
    const rooms = (level?.rooms ?? []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3);
    if (!rooms.length) return null;
    const hit = want && roomAt(model, levelId, want.x, want.y);
    const bboxOf = (r) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of r.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1, area: (x1 - x0) * (y1 - y0) }; };
    const room = rooms.find((r) => r.id === hit) ?? rooms.map((r) => ({ r, a: bboxOf(r).area })).sort((p, q) => q.a - p.a)[0].r;
    const bb = bboxOf(room), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, tx = want && hit === room.id ? want.x : cx, ty = want && hit === room.id ? want.y : cy;
    const cands = [];
    for (let x = bb.x0 + STEP / 2; x < bb.x1 && cands.length < 4 * MAX_CANDIDATES; x += STEP) for (let y = bb.y0 + STEP / 2; y < bb.y1; y += STEP) cands.push({ x, y, d: Math.hypot(x - tx, y - ty) });
    cands.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
    const elev = spec.place.mode === 'wall-mount' ? (spec.place.elevation ?? 0) : 0;
    const probe = { id: '__new', type: spec.id, room: room.id, rot: 0, size: spec.size, elev, on: null, colors: {} };
    for (const c of cands.slice(0, MAX_CANDIDATES)) {
      if (roomAt(model, levelId, c.x, c.y, room.id) !== room.id) continue;
      for (const rot of [0, 90, 180, 270]) {
        const res = placeAt(model, state.layout, levelId, probe, { x: c.x, y: c.y, rot });
        if (CLEAN(res.problems)) return { x: res.x, y: res.y, rot: res.rot, room: room.id, clean: true };
      }
    }
    return { x: cx, y: cy, rot: 0, room: room.id, clean: false };
  }

  const session = {
    get state() { return state; },
    layout: () => state.layout,
    selected: () => selectedFound()?.piece ?? null,
    levelOf: (id) => found(id)?.level.id ?? null,
    pieceById: (id) => found(id)?.piece ?? null,
    problems() {
      const f = selectedFound();
      return f ? placementProblems(model, state.layout, f.level.id, f.piece) : [];
    },
    select(id) {
      const hadRoom = !!roomSel; roomSel = null; // a piece and a room are never selected together
      if ((id ?? null) === state.selection) { if (hadRoom) emit('select'); return true; }
      const res = selectPiece(state, id ?? null);
      if (!res.ok) return false;
      state = res.state; emit('select'); return true;
    },
    // A room of the plan (levelId, roomId), or null for none. Clears the selected piece.
    selectRoom(levelId, roomId = null) {
      if (roomId === null || roomId === undefined) { if (!roomSel) return true; roomSel = null; emit('select'); return true; }
      const room = model?.levels?.find?.((l) => l.id === levelId)?.rooms?.find?.((r) => r.id === roomId);
      if (!room) return false;
      if (state.selection) { const r = selectPiece(state, null); if (r.ok) state = r.state; }
      roomSel = { level: levelId, id: roomId }; emit('select'); return true;
    },
    selectedRoom() {
      if (!roomSel) return null;
      const room = model?.levels?.find?.((l) => l.id === roomSel.level)?.rooms?.find?.((r) => r.id === roomSel.id);
      if (!room) { roomSel = null; return null; }
      return { level: roomSel.level, id: roomSel.id, name: room.name || room.id, colors: roomColorsOf(state.layout, roomSel.level, roomSel.id) };
    },
    // The selection now as something to put back later: { piece: id | null, room: { level, id } | null } (never both). restoreSelection(snap) puts it back; a pinch that
    // starts on a piece takes the selection that its first finger made back, and the room that was picked before (picking the piece cleared it) comes back with it.
    selectionNow() { return { piece: state.selection ?? null, room: roomSel ? { level: roomSel.level, id: roomSel.id } : null }; },
    restoreSelection(snap) {
      if (snap?.piece) return session.select(snap.piece) || session.select(null);
      if (snap?.room) return session.selectRoom(snap.room.level, snap.room.id) || session.select(null);
      return session.select(null);
    },
    // part 'wall' | 'floor', color '#rrggbb' | 'lib:<key>' | null (back to the default look); a run of changes of one part is one undo step.
    recolorRoom(part, color) {
      if (!roomSel) return { ok: false, reason: 'no-room-selected' };
      return apply(recolorRoom(state, roomSel.level, roomSel.id, part, color ?? null, { model, coalesceKey: `room:${roomSel.id}:${part}` }));
    },
    duplicate() {
      if (!state.selection) return { ok: false, reason: 'nothing-selected' };
      return apply(duplicatePiece(state, state.selection, { model }));
    },
    snapEdges: () => edges,
    setSnapEdges(on) { edges = !!on; },
    // A new piece in the best free place of a room, selected. `at` is { level?, x?, y? }: the level and the plan point the view is centred on.
    add(type, at = {}) {
      const spec = specOf(type);
      if (!spec) return { ok: false, reason: 'unknown-type' };
      let view = null; try { view = viewPoint?.() ?? null; } catch { view = null; }
      at = { ...(view ?? {}), ...at };
      const levelId = at.level ?? selectedFound()?.level.id ?? state.layout.levels.find((l) => l.pieces.length)?.id ?? state.layout.levels[0]?.id;
      if (!levelId) return { ok: false, reason: 'unknown-level' };
      const spot = freePlace(levelId, spec, fin(at.x) && fin(at.y) ? { x: at.x, y: at.y } : null);
      if (!spot) return { ok: false, reason: 'no-room' };
      const res = apply(addPiece(state, { type, x: spot.x, y: spot.y, rot: spot.rot, level: levelId, room: spot.room }, { model }));
      return res.ok ? { ...res, clean: spot.clean } : res;
    },
    turn(deg = 90) {
      if (!state.selection) return { ok: false, reason: 'nothing-selected' };
      return apply(turnPiece(state, state.selection, deg, { model }));
    },
    remove() {
      if (!state.selection) return { ok: false, reason: 'nothing-selected' };
      return apply(deletePiece(state, state.selection));
    },
    resize(size) {
      if (!state.selection) return { ok: false, reason: 'nothing-selected' };
      return apply(resizePiece(state, state.selection, size, { model }));
    },
    recolor(slot, color) {
      if (!state.selection) return { ok: false, reason: 'nothing-selected' };
      return apply(recolorPiece(state, state.selection, slot, color, {}));
    },
    undo() { return apply(undo(state)); },
    redo() { return apply(redo(state)); },
    canUndo: () => canUndo(state),
    canRedo: () => canRedo(state),
    reset() { return apply(resetToAuto(state, model, { allowedTypes })); },
    exportText: () => serializeLayout(state.layout),
    importText(text) {
      const r = parseLayout(text, model);
      if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
      const res = apply(loadLayout(state, r.layout));
      return { ok: res.ok, errors: r.errors, warnings: r.warnings };
    },
    // Dragging one piece: beginDrag selects it, dragTo places it (with snapping, one undo step for the whole drag), endDrag keeps the
    // result, cancelDrag puts everything back as it was before beginDrag.
    get dragging() { return drag ? drag.id : null; },
    beginDrag(id) {
      if (drag || !found(id)) return false;
      drag = { start: state, id, key: `drag:${id}:${++dragSeq}` };
      roomSel = null;
      if (state.selection !== id) { const r = selectPiece(state, id); if (r.ok) { state = r.state; emit('select'); } }
      return true;
    },
    dragTo(x, y) {
      if (!drag) return { ok: false, reason: 'not-dragging' };
      const res = movePiece(state, drag.id, x, y, edges ? { model, coalesceKey: drag.key, snap: { edges: true } } : { model, coalesceKey: drag.key });
      if (!res.ok) return { ok: false, reason: res.reason };
      state = res.state; emit('drag');
      return { ok: true, problems: res.problems };
    },
    endDrag() {
      if (!drag) return false;
      drag = null; emit('dragend'); return true;
    },
    cancelDrag() {
      if (!drag) return false;
      state = drag.start; drag = null; emit('structure'); return true;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  return session;
}
