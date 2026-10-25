// Duplicating a piece, resizing with the back on a wall, the blocked-front warning and snapping to the sides of neighbours.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, addPiece, movePiece, resizePiece, duplicatePiece, undo, findPiece, placementProblems, pieceCount, placeAt, HARD_KINDS, clearBox,
} from '../../src/editor/index.js';
import { roomInterior, rotFromFront } from '../../src/layout/geometry.js';
import { checkLayout } from '../../src/layout/index.js';
import { testPlans, smallLayout, clone, deepFreeze } from './plans.mjs';

const plans = testPlans();
const [flat] = plans;
const piece = (st, id) => findPiece(st.layout, id)?.piece;
const mk = (id, type, x, y, extra = {}) => ({ id, type, room: 'r', x, y, rot: 0, size: [0.6, 0.6, 0.9], elev: 0, on: null, colors: {}, ...extra });
const emptyOf = (model) => ({ version: 1, seed: 1, levels: model.levels.map((l) => ({ id: l.id, pieces: [] })) });

// ---- duplicatePiece ----
test('duplicatePiece: a copy 0.3 m to the right and 0.3 m in front, new id, selected, own colours, one undo step, props not copied', () => {
  const l = smallLayout();
  l.levels[0].pieces[0].colors = { top: '#a0522d' };
  const st = createState(l);
  const r = duplicatePiece(st, 'p1', {});
  assert.equal(r.ok, true);
  assert.equal(r.id, 'p6');
  const copy = piece(r.state, 'p6');
  assert.deepEqual([copy.x, copy.y, copy.rot, copy.type, copy.on], [2.3, 2.3, 0, 'dining-table', null]);
  assert.deepEqual(copy.colors, { top: '#a0522d' });
  assert.notEqual(copy.colors, piece(st, 'p1').colors);
  assert.notEqual(copy.size, piece(st, 'p1').size);
  assert.equal(r.state.selection, 'p6');
  assert.equal(pieceCount(r.state.layout), pieceCount(st.layout) + 1, 'the vase on the table was not copied');
  assert.equal(r.state.history.past.length, 1);
  assert.equal(undo(r.state).state.layout, st.layout);
  assert.ok(r.problems.some((p) => p.kind === 'overlap' && p.with === 'p1'), 'the copy overlaps the original and says so');
});

test('duplicatePiece follows the direction the piece faces', () => {
  const l = smallLayout();
  l.levels[0].pieces[0].rot = 90;
  const r = duplicatePiece(createState(l), 'p1', {});
  const copy = piece(r.state, r.id);
  assert.deepEqual([copy.x, copy.y, copy.rot], [1.7, 2.3, 90], 'right of a piece turned 90 degrees is down the plan, in front of it is to the left');
});

test('duplicatePiece: strict mode refuses an overlapping copy, soft accepts it; mode off does not snap', () => {
  const st = createState(smallLayout());
  const strict = duplicatePiece(st, 'p3', { mode: 'strict' });
  assert.deepEqual([strict.ok, strict.reason], [false, 'overlap']);
  assert.equal(strict.state, st);
  assert.equal(duplicatePiece(st, 'p3', {}).ok, true);
  const off = duplicatePiece(st, 'p3', { mode: 'off' });
  assert.equal(off.ok, true);
  assert.deepEqual(off.problems, []);
});

test('duplicatePiece: a prop copied onto the same table stands on it; refusals hand back the same state', () => {
  const st = createState(smallLayout());
  const r = duplicatePiece(st, 'p2', {});
  assert.equal(r.ok, true);
  const copy = piece(r.state, r.id);
  assert.deepEqual([copy.on, copy.elev], ['p1', 0.75]);
  assert.equal(piece(r.state, 'p2').on, 'p1');
  for (const [id, reason] of [['nope', 'unknown-id'], [undefined, 'unknown-id'], [null, 'unknown-id']]) {
    const bad = duplicatePiece(st, id, {});
    assert.deepEqual([bad.ok, bad.reason], [false, reason]);
    assert.equal(bad.state, st);
  }
  assert.equal(duplicatePiece(null, 'p1').reason, 'bad-state');
  const full = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: Array.from({ length: 400 }, (_, i) => mk(`q${i}`, 'plant-small', 0.5 + (i % 20) * 0.7, 0.5 + Math.floor(i / 20) * 0.7, { size: [0.25, 0.25, 0.4] })) }] };
  assert.equal(duplicatePiece(createState(full), 'q0', {}).reason, 'limit-level');
});

test('duplicatePiece on a plan: the copy lands in a room of the plan and does not change the input', () => {
  const { model, layout } = flat;
  const frozen = deepFreeze(clone(layout));
  const sofa = frozen.levels[0].pieces.find((p) => p.type === 'sofa3');
  const r = duplicatePiece(createState(frozen), sofa.id, { model });
  assert.equal(r.ok, true);
  const copy = piece(r.state, r.id);
  assert.ok(model.levels[0].rooms.some((room) => room.id === copy.room));
  assert.ok(Array.isArray(r.problems));
  assert.equal(frozen.levels[0].pieces.length, layout.levels[0].pieces.length);
});

// ---- resizePiece keeps the back on the wall ----
function backGap(ip, p) {
  let best = null;
  for (const e of ip.edges) {
    const dr = Math.abs((((p.rot - rotFromFront(e.n[0], e.n[1])) % 360) + 540) % 360 - 180);
    if (dr > 1) continue;
    const along = (p.x - e.a[0]) * e.t[0] + (p.y - e.a[1]) * e.t[1];
    if (along < 0 || along > e.len) continue;
    const gap = (p.x - e.a[0]) * e.n[0] + (p.y - e.a[1]) * e.n[1] - p.size[1] / 2;
    if (best === null || Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}
function bedAtWall(model, distance) {
  const level = model.levels[0], room = level.rooms.find((r) => r.id === 'living');
  const ip = roomInterior(level, room);
  const e = ip.edges.reduce((a, b) => (b.len > a.len ? b : a));
  const d = 2.0, at = d / 2 + distance;
  const added = addPiece(createState(emptyOf(model)), {
    type: 'bed-double', x: e.a[0] + e.t[0] * e.len / 2 + e.n[0] * at, y: e.a[1] + e.t[1] * e.len / 2 + e.n[1] * at, rot: rotFromFront(e.n[0], e.n[1]), level: 'L0', room: 'living',
  }, { model, snap: false });
  assert.equal(added.ok, true);
  return { st: added.state, id: added.id, ip };
}

test('resizePiece: a piece with its back on a wall keeps its back on the wall when the depth grows or shrinks', () => {
  const { model } = flat;
  const { st, id, ip } = bedAtWall(model, 0.02);
  assert.ok(Math.abs(backGap(ip, piece(st, id)) - 0.02) < 0.002);
  const grown = resizePiece(st, id, { d: 2.1 }, { model });
  assert.equal(grown.ok, true);
  assert.equal(grown.snapped.wall, true);
  assert.equal(piece(grown.state, id).size[1], 2.1);
  assert.ok(Math.abs(backGap(ip, piece(grown.state, id)) - 0.02) < 0.002, `${backGap(ip, piece(grown.state, id))}`);
  const shrunk = resizePiece(grown.state, id, { d: 1.9 }, { model });
  assert.ok(Math.abs(backGap(ip, piece(shrunk.state, id)) - 0.02) < 0.002);
  const p0 = piece(st, id), wider = piece(resizePiece(st, id, { w: 1.8 }, { model }).state, id);
  assert.deepEqual([wider.x, wider.y], [p0.x, p0.y], 'a change of width moves nothing');
  const raw = resizePiece(st, id, { d: 2.1 }, { model, snap: false });
  assert.equal(raw.snapped.wall, false);
  assert.ok(Math.abs(backGap(ip, piece(raw.state, id)) - (0.02 - 0.05)) < 0.002, 'without snapping it grows around the centre as before');
  assert.equal(shrunk.state.history.past.length, 3, 'adding and each resize are one undo step');
});

test('resizePiece: a piece that stands free in the room is not pulled to a wall', () => {
  const { model } = flat;
  const { st, id } = bedAtWall(model, 1.0);
  const p0 = piece(st, id);
  const r = resizePiece(st, id, { d: 2.1 }, { model });
  assert.equal(r.ok, true);
  assert.deepEqual([piece(r.state, id).x, piece(r.state, id).y], [p0.x, p0.y]);
  assert.equal(r.snapped.wall, false);
});

// ---- front-blocked ----
test('front-blocked: the free strip in front of a piece reaches another piece of the room (soft problem, not hard)', () => {
  const l = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [
    mk('sofa', 'sofa3', 6, 2, { size: [2.1, 0.95, 0.85] }),
    mk('chair', 'armchair', 6, 3.1, { size: [0.85, 0.85, 0.85] }),
    mk('far', 'armchair', 9, 3.1, { size: [0.85, 0.85, 0.85] }),
    mk('rug', 'rug', 6, 3.0, { size: [2.4, 1.7, 0.015] }),
  ] }] };
  const sofa = l.levels[0].pieces[0];
  const kinds = placementProblems(null, l, 'L0', sofa);
  assert.ok(kinds.some((p) => p.kind === 'front-blocked' && p.with === 'chair'), JSON.stringify(kinds));
  assert.ok(!HARD_KINDS.includes('front-blocked'));
  const free = placementProblems(null, { ...l, levels: [{ id: 'L0', pieces: [sofa, l.levels[0].pieces[2], l.levels[0].pieces[3]] }] }, 'L0', sofa);
  assert.ok(!free.some((p) => p.kind === 'front-blocked'), 'a rug does not block and a far piece does not either');
  const strict = movePiece(createState(l), 'sofa', 6.2, 2, { mode: 'strict', snap: false });
  assert.equal(strict.ok, true, 'strict mode does not refuse a blocked front');
  assert.ok(strict.problems.some((p) => p.kind === 'front-blocked'));
  assert.equal(clearBox(mk('x', 'rug', 1, 1)), null, 'rugs keep no strip');
  assert.equal(clearBox({ type: 'nope' }), null);
});

test('front-blocked: pieces that belong in front of another one do not count as blocking it', () => {
  const at = (id, type, x, y, extra = {}) => mk(id, type, x, y, extra);
  const l = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [
    at('sofa', 'sofa3', 6, 2, { size: [2.1, 0.95, 0.85] }), at('table', 'coffee-table', 6, 3.1, { size: [1.1, 0.6, 0.4] }),
    at('desk', 'desk', 2, 2, { size: [1.3, 0.65, 0.75] }), at('seat', 'desk-chair', 2, 2.9, { size: [0.5, 0.5, 0.9] }),
    at('tv', 'tv-unit', 6, 7, { size: [1.6, 0.4, 0.5], rot: 180 }), at('couch', 'sofa3', 6, 5.6, { size: [2.1, 0.95, 0.85] }),
  ] }] };
  const has = (id) => placementProblems(null, l, 'L0', l.levels[0].pieces.find((q) => q.id === id)).some((p) => p.kind === 'front-blocked');
  assert.equal(has('sofa'), false, 'a coffee table in front of a sofa');
  assert.equal(has('desk'), false, 'the chair at its desk');
  assert.equal(has('tv'), false, 'the sofa in front of the television unit');
  l.levels[0].pieces.push(at('wardrobe', 'wardrobe', 2, 3.2, { size: [1.8, 0.6, 2.2] }));
  assert.equal(has('desk'), true, 'but a wardrobe in front of the desk does');
});

test('front-blocked: a piece that faces a close wall is flagged, with its back on the wall it is not', () => {
  const { model } = flat;
  const level = model.levels[0], room = level.rooms.find((r) => r.id === 'living');
  const ip = roomInterior(level, room);
  const e = ip.edges.reduce((a, b) => (b.len > a.len ? b : a));
  const at = (dist, face) => {
    const n = face ? [-e.n[0], -e.n[1]] : e.n;
    const across = 0.95 / 2 + dist;
    return addPiece(createState(emptyOf(model)), {
      type: 'sofa3', x: e.a[0] + e.t[0] * e.len / 2 + e.n[0] * across, y: e.a[1] + e.t[1] * e.len / 2 + e.n[1] * across, rot: rotFromFront(n[0], n[1]), level: 'L0', room: 'living',
    }, { model, snap: false });
  };
  const facing = at(0.3, true);
  assert.ok(facing.problems.some((p) => p.kind === 'front-blocked' && p.with === undefined), JSON.stringify(facing.problems));
  const backed = at(0.02, false);
  assert.ok(!backed.problems.some((p) => p.kind === 'front-blocked'), JSON.stringify(backed.problems));
});

test('front-blocked is a soft rule of the editor that checkLayout does not have (a conscious difference)', () => {
  const { model } = flat;
  const level = model.levels[0], room = level.rooms.find((r) => r.id === 'living');
  const e = roomInterior(level, room).edges.reduce((a, b) => (b.len > a.len ? b : a));
  const put = (st, type, dist, dx) => addPiece(st, {
    type, x: e.a[0] + e.t[0] * (e.len / 2 + dx) + e.n[0] * dist, y: e.a[1] + e.t[1] * (e.len / 2 + dx) + e.n[1] * dist, rot: rotFromFront(e.n[0], e.n[1]), level: 'L0', room: 'living',
  }, { model, snap: false });
  const a = put(createState(emptyOf(model)), 'sofa3', 0.95 / 2 + 0.02, 0);
  const b = put(a.state, 'armchair', 0.95 + 0.02 + 0.4 + 0.85 / 2, 0);
  const sofaProblems = placementProblems(model, b.state.layout, 'L0', piece(b.state, a.id));
  assert.ok(sofaProblems.some((p) => p.kind === 'front-blocked' && p.with === b.id), JSON.stringify(sofaProblems));
  const violations = checkLayout(model, b.state.layout).filter((v) => v.piece === a.id || v.other === a.id);
  assert.ok(!violations.some((v) => v.kind === 'front-blocked' || v.kind === 'overlap'), JSON.stringify(violations));
});

// ---- snapping to the sides of neighbours ----
test('snap.edges: a side is pulled to the side of a close parallel neighbour; off by default', () => {
  const two = () => ({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [mk('a', 'kitchen-base', 2, 2), mk('b', 'kitchen-base', 4, 2)] }] });
  const on = { snap: { edges: true } };
  const r = movePiece(createState(two()), 'b', 2.7, 2, on);
  assert.equal(r.ok, true);
  assert.deepEqual([piece(r.state, 'b').x, piece(r.state, 'b').y], [2.605, 2]);
  assert.equal(r.snapped.edge, true);
  assert.equal(piece(movePiece(createState(two()), 'b', 2.7, 2, {}).state, 'b').x, 2.7, 'off unless asked for');
  assert.equal(piece(movePiece(createState(two()), 'b', 2.8, 2, on).state, 'b').x, 2.8, 'a neighbour 20 cm away does not pull');
  assert.equal(piece(movePiece(createState(two()), 'b', 2.7, 3, on).state, 'b').x, 2.7, 'no overlap along the shared side, no pull');
  const front = movePiece(createState(two()), 'b', 2, 2.7, on);
  assert.deepEqual([piece(front.state, 'b').x, piece(front.state, 'b').y], [2, 2.605], 'the front and the back count too');
});

test('snap.edges: not for turned neighbours, for pieces turned a quarter turn, or for a piece standing on another', () => {
  const l = () => ({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [mk('a', 'kitchen-base', 2, 2), mk('b', 'sideboard', 4, 2, { size: [1.6, 0.42, 0.8], rot: 90 }), mk('c', 'kitchen-base', 4, 5, { rot: 30 })] }] });
  const on = { snap: { edges: true } };
  const quarter = movePiece(createState(l()), 'b', 2.6, 2, on);
  assert.equal(quarter.snapped.edge, true);
  assert.equal(piece(quarter.state, 'b').x, 2.515, 'the depth of the turned sideboard counts as its width along the neighbour');
  assert.equal(movePiece(createState(l()), 'c', 2.7, 2, on).snapped.edge, false, 'a piece at 30 degrees is not parallel');
  const res = placeAt(null, smallLayout(), 'L0', mk('v', 'vase', 2.3, 2.3, { size: [0.15, 0.15, 0.3], on: 'p1', elev: 0.75 }), { x: 2.3, y: 2.3 }, { snap: { edges: true } });
  assert.equal(res.snapped.edge, false, 'props do not snap to sides');
});
