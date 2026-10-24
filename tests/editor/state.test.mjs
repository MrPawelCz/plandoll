// Editor state: every operation (limits, bad numbers, unknown ids), undo and redo (order, merging, the 200 step limit), immutability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, addPiece, movePiece, rotatePiece, turnPiece, deletePiece, resizePiece, recolorPiece, resetToAuto, undo, redo, selectPiece, findPiece, selectedPiece, canUndo, canRedo, pieceAt, HISTORY_LIMIT, MATERIAL_KEYS, loadLayout } from '../../src/editor/index.js';
import { testPlans, clone, deepFreeze, smallLayout } from './plans.mjs';

const OFF = { mode: 'off' };
const piece = (st, id) => findPiece(st.layout, id)?.piece;

test('addPiece: spec size, new unique id, selected, one undo step', () => {
  const st = createState(smallLayout());
  const r = addPiece(st, { type: 'armchair', x: 4, y: 3, rot: 90, level: 'L0', room: 'r' }, OFF);
  assert.equal(r.ok, true);
  assert.equal(r.id, 'p6');
  const p = piece(r.state, 'p6');
  assert.deepEqual(p, { id: 'p6', type: 'armchair', room: 'r', x: 4, y: 3, rot: 90, size: [0.85, 0.85, 0.85], elev: 0, on: null, colors: {} });
  assert.equal(r.state.selection, 'p6');
  assert.equal(r.state.history.past.length, 1);
  assert.equal(st.layout.levels[0].pieces.length, 5, 'the input state is untouched');
  const snappedAdd = addPiece(st, { type: 'armchair', x: 4.012, y: 3.03, level: 'L0', room: 'r' }, {});
  assert.deepEqual([piece(snappedAdd.state, snappedAdd.id).x, piece(snappedAdd.state, snappedAdd.id).y], [4, 3.05], 'a new piece snaps to the grid like a moved one');
  assert.equal(snappedAdd.snapped.grid, true);
  const w = addPiece(r.state, { type: 'mirror', x: 1, y: 1, level: 'L0', room: 'r' }, OFF);
  assert.equal(piece(w.state, w.id).elev, 0.2, 'wall pieces start at their mounting height');
  const sz = addPiece(st, { type: 'sofa3', x: 3, y: 5, level: 'L0', room: 'r', size: { w: 9, d: 5 } }, OFF);
  assert.deepEqual(piece(sz.state, sz.id).size, [2.8, 0.95, 0.85], 'the width is clamped, the fixed depth stays');
  const lv = addPiece(st, { type: 'armchair', x: 4, y: 3, level: 'L1', room: 'r' }, OFF);
  assert.equal(lv.state.layout.levels[1].pieces.length, 1);
  const col = addPiece(st, { type: 'sofa2', x: 3, y: 5, level: 'L0', room: 'r', colors: { upholstery: '#ABCDEF' } }, OFF);
  assert.equal(piece(col.state, col.id).colors.upholstery, '#abcdef');
});

test('addPiece refuses bad input without throwing', () => {
  const st = createState(smallLayout());
  const bad = [
    [{ type: 'no-such-type', x: 1, y: 1 }, 'unknown-type'],
    [{ type: '__proto__', x: 1, y: 1 }, 'unknown-type'],
    [{ type: 'constructor', x: 1, y: 1 }, 'unknown-type'],
    [{ type: 'armchair', x: NaN, y: 1 }, 'bad-number'],
    [{ type: 'armchair', x: 1, y: Infinity }, 'bad-number'],
    [{ type: 'armchair', x: 1, y: 1, rot: 'a' }, 'bad-number'],
    [{ type: 'armchair', x: 1, y: 1, level: 'L9' }, 'unknown-level'],
    [{ type: 'armchair', x: 1, y: 1, size: [NaN, 1, 1] }, 'bad-number'],
    [{ type: 'armchair', x: 1, y: 1, size: 'big' }, 'bad-number'],
    [{ type: 'sofa3', x: 1, y: 1, colors: { nope: '#ffffff' } }, 'bad-slot'],
    [{ type: 'sofa3', x: 1, y: 1, colors: { upholstery: 'red' } }, 'bad-color'],
    [null, 'unknown-type'], [undefined, 'unknown-type'], [42, 'unknown-type'],
  ];
  for (const [req, reason] of bad) {
    const r = addPiece(st, req, OFF);
    assert.equal(r.ok, false, JSON.stringify(req));
    assert.equal(r.reason, reason, JSON.stringify(req));
    assert.equal(r.state, st, 'a refused operation returns the same state');
  }
  const full = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: Array.from({ length: 400 }, (_, i) => ({ id: `p${i + 1}`, type: 'plant-small', room: 'r', x: 1, y: 1, rot: 0, size: [0.25, 0.25, 0.4], elev: 0, on: null, colors: {} })) }] };
  assert.equal(addPiece(createState(full), { type: 'armchair', x: 1, y: 1 }, OFF).reason, 'limit-level');
});

test('movePiece: exact when snapping is off, the pieces on top come along, bad input refused', () => {
  const st = createState(smallLayout());
  const r = movePiece(st, 'p1', 3.123, 2.456, { snap: false });
  assert.equal(r.ok, true);
  assert.deepEqual([piece(r.state, 'p1').x, piece(r.state, 'p1').y], [3.123, 2.456]);
  assert.deepEqual([piece(r.state, 'p2').x, piece(r.state, 'p2').y], [3.423, 2.456], 'the vase keeps its place on the table');
  assert.equal(movePiece(st, 'nope', 1, 1).reason, 'unknown-id');
  assert.equal(movePiece(st, '__proto__', 1, 1).reason, 'unknown-id');
  assert.equal(movePiece(st, 'p1', NaN, 1).reason, 'bad-number');
  assert.equal(movePiece(st, 'p1', 1, 'x').reason, 'bad-number');
  assert.equal(movePiece(st, 'p1', 2, 2, OFF).reason, 'no-change');
  const grid = movePiece(st, 'p3', 6.012, 2.037, {});
  assert.deepEqual([piece(grid.state, 'p3').x, piece(grid.state, 'p3').y], [6, 2.05], 'the 5 cm grid');
});

test('rotatePiece and turnPiece: angle step of 15 degrees, the pieces on top turn around the centre', () => {
  const st = createState(smallLayout());
  const r = rotatePiece(st, 'p1', 90, OFF);
  assert.equal(piece(r.state, 'p1').rot, 90);
  const v = piece(r.state, 'p2');
  assert.deepEqual([v.x, v.y, v.rot], [2, 2.3, 90], 'the vase was 0.3 m to the right of the centre, now 0.3 m below it');
  assert.equal(piece(rotatePiece(st, 'p3', 47, {}).state, 'p3').rot, 45);
  assert.equal(piece(rotatePiece(st, 'p3', 53, {}).state, 'p3').rot, 60);
  assert.equal(piece(rotatePiece(st, 'p3', 47, { snap: false }).state, 'p3').rot, 47);
  assert.equal(piece(rotatePiece(st, 'p3', -90, {}).state, 'p3').rot, 270);
  assert.equal(piece(rotatePiece(st, 'p3', 810, {}).state, 'p3').rot, 90);
  assert.equal(piece(turnPiece(st, 'p3', 90, {}).state, 'p3').rot, 90);
  const rotOnly = rotatePiece(st, 'p3', 90, {});
  assert.equal(piece(rotOnly.state, 'p3').x, 6, 'a turn does not move the piece onto the grid');
  assert.equal(rotatePiece(st, 'p3', NaN).reason, 'bad-number');
  assert.equal(rotatePiece(st, 'zz', 90).reason, 'unknown-id');
  assert.equal(rotatePiece(st, 'p3', 360, {}).reason, 'no-change');
  assert.equal(turnPiece(st, 'p3', Infinity, {}).reason, 'bad-number');
  assert.equal(turnPiece(st, 'zz', 90, {}).reason, 'unknown-id');
});

test('deletePiece: what stands on the piece goes with it, one undo step brings everything back', () => {
  const st = createState(smallLayout());
  const r = deletePiece(selectPiece(st, 'p1').state, 'p1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed.sort(), ['p1', 'p2']);
  assert.equal(r.state.layout.levels[0].pieces.length, 3);
  assert.equal(r.state.selection, null);
  const back = undo(r.state);
  assert.deepEqual(back.state.layout, st.layout);
  assert.equal(deletePiece(st, 'nope').reason, 'unknown-id');
  assert.equal(deletePiece(st, undefined).reason, 'unknown-id');
});

test('resizePiece: clamped to the range, fixed axes stay, pieces on top follow the height', () => {
  const st = createState(smallLayout());
  const r = resizePiece(st, 'p3', [9, 9, 9], OFF);
  assert.equal(r.ok, true);
  assert.equal(r.clamped, true);
  assert.deepEqual(piece(r.state, 'p3').size, [2.8, 0.95, 0.85]);
  assert.deepEqual(piece(resizePiece(st, 'p3', { w: 0.1 }, OFF).state, 'p3').size, [1.9, 0.95, 0.85]);
  assert.equal(resizePiece(st, 'p3', { d: 2 }, OFF).reason, 'fixed-size');
  assert.equal(resizePiece(st, 'p3', { w: 2.1 }, OFF).reason, 'no-change');
  assert.equal(resizePiece(st, 'p3', [NaN, 1, 1], OFF).reason, 'bad-number');
  assert.equal(resizePiece(st, 'nope', [1, 1, 1], OFF).reason, 'unknown-id');
  const tall = resizePiece(st, 'p4', { h: 2.4 }, OFF);
  assert.equal(piece(tall.state, 'p4').size[2], 2.4);
  assert.equal(piece(tall.state, 'p5').elev, 2.4, 'the plant on the shelf rises with it');
  assert.equal(piece(resizePiece(st, 'p4', { h: 0.2 }, OFF).state, 'p4').size[2], 1.2);
});

test('recolorPiece: hex colours, material keys, reset, refusals', () => {
  const st = createState(smallLayout());
  const r = recolorPiece(st, 'p3', 'cushions', '#AA00BB');
  assert.equal(piece(r.state, 'p3').colors.cushions, '#aa00bb');
  assert.equal(piece(r.state, 'p3').colors.upholstery, '#7d8b99', 'other slots are kept');
  const key = MATERIAL_KEYS[0];
  assert.equal(piece(recolorPiece(st, 'p3', 'upholstery', key).state, 'p3').colors.upholstery, key);
  assert.deepEqual(piece(recolorPiece(st, 'p3', 'upholstery', null).state, 'p3').colors, {});
  assert.equal(recolorPiece(st, 'p3', 'upholstery', '#7d8b99').reason, 'no-change');
  assert.equal(recolorPiece(st, 'p3', 'legs', null).reason, 'no-change');
  for (const bad of ['red', '#12345', '#gggggg', '', 5, {}, [], undefined, 'not-a-material']) assert.equal(recolorPiece(st, 'p3', 'upholstery', bad).reason, 'bad-color', String(bad));
  assert.equal(recolorPiece(st, 'p3', 'nope', '#ffffff').reason, 'bad-slot');
  assert.equal(recolorPiece(st, 'p3', '__proto__', '#ffffff').reason, 'bad-slot');
  assert.equal(recolorPiece(st, 'p3', 7, '#ffffff').reason, 'bad-slot');
  assert.equal(recolorPiece(st, 'zz', 'upholstery', '#ffffff').reason, 'unknown-id');
});

test('undo and redo: order, a new step clears the redo list, selection survives', () => {
  let st = createState(smallLayout());
  const states = [st];
  for (const [id, x] of [['p3', 7], ['p4', 8], ['p1', 3]]) { st = movePiece(st, id, x, 3, { snap: false }).state; states.push(st); }
  assert.equal(st.history.past.length, 3);
  assert.equal(canUndo(st), true);
  assert.equal(canRedo(st), false);
  for (let i = 2; i >= 0; i--) { st = undo(st).state; assert.deepEqual(st.layout, states[i].layout); }
  assert.equal(canUndo(st), false);
  assert.equal(undo(st).ok, false);
  assert.equal(undo(st).reason, 'nothing-to-undo');
  st = redo(st).state; st = redo(st).state;
  assert.deepEqual(st.layout, states[2].layout);
  const other = movePiece(st, 'p3', 1, 1, { snap: false }).state;
  assert.equal(canRedo(other), false, 'a new operation clears redo');
  assert.equal(redo(other).reason, 'nothing-to-redo');
  const sel = selectPiece(createState(smallLayout()), 'p1').state;
  assert.equal(selectedPiece(sel).id, 'p1');
  assert.equal(selectedPiece(deletePiece(sel, 'p1').state), null, 'deleting the selected piece clears the selection');
  const picked = selectPiece(movePiece(createState(smallLayout()), 'p3', 7, 3, { snap: false }).state, 'p3').state;
  assert.equal(undo(picked).state.selection, 'p3', 'the selected piece still exists after undo');
  assert.equal(selectPiece(picked, 'zz').reason, 'unknown-id');
  assert.equal(selectPiece(picked, null).state.selection, null);
});

test('coalesceKey merges a drag into one undo step; another key, no key, or an undo ends the series', () => {
  let st = createState(smallLayout());
  const start = st.layout;
  for (let i = 1; i <= 10; i++) st = movePiece(st, 'p3', 6 + i * 0.1, 2, { snap: false, coalesceKey: 'drag:p3' }).state;
  assert.equal(st.history.past.length, 1);
  assert.equal(piece(st, 'p3').x, 7);
  st = movePiece(st, 'p3', 7.5, 2, { snap: false, coalesceKey: 'drag:p4' }).state;
  assert.equal(st.history.past.length, 2, 'a different key starts a new step');
  st = movePiece(st, 'p3', 7.6, 2, { snap: false, coalesceKey: 'drag:p4' }).state;
  st = movePiece(st, 'p3', 7.7, 2, { snap: false }).state;
  st = movePiece(st, 'p3', 7.8, 2, { snap: false, coalesceKey: 'drag:p4' }).state;
  assert.equal(st.history.past.length, 4, 'a step without a key in between ends the series');
  const u = undo(st).state;
  const again = movePiece(u, 'p3', 7.9, 2, { snap: false, coalesceKey: 'drag:p4' }).state;
  assert.equal(again.history.past.length, u.history.past.length + 1, 'after an undo the next move is a new step');
  let s2 = st;
  for (let i = 0; i < 4; i++) s2 = undo(s2).state;
  assert.deepEqual(s2.layout, start);
});

test(`history is limited to ${HISTORY_LIMIT} steps`, () => {
  let st = createState(smallLayout());
  const snapshots = [st.layout];
  for (let i = 1; i <= 250; i++) { st = movePiece(st, 'p3', 6 + i * 0.01, 2, { snap: false }).state; snapshots.push(st.layout); }
  assert.equal(st.history.past.length, HISTORY_LIMIT);
  let n = 0;
  while (canUndo(st)) { st = undo(st).state; n++; }
  assert.equal(n, HISTORY_LIMIT);
  assert.deepEqual(st.layout, snapshots[250 - HISTORY_LIMIT], 'the oldest 50 steps are gone');
  assert.equal(st.history.future.length, HISTORY_LIMIT);
});

test('operations do not mutate their input (frozen layout) and nothing throws on a broken state', () => {
  const frozen = deepFreeze(createState(smallLayout()));
  let st = frozen;
  const steps = [
    (s) => addPiece(s, { type: 'armchair', x: 4, y: 3, level: 'L0', room: 'r' }),
    (s) => movePiece(s, 'p1', 3, 3), (s) => rotatePiece(s, 'p1', 90), (s) => resizePiece(s, 'p4', { h: 2.2 }),
    (s) => recolorPiece(s, 'p3', 'cushions', '#102030'), (s) => deletePiece(s, 'p1'), (s) => undo(s), (s) => redo(s),
  ];
  for (const step of steps) { const r = step(st); assert.equal(r.ok, true, r.reason + (r.error ?? '')); st = r.state; }
  assert.deepEqual(frozen.layout, smallLayout());
  for (const broken of [null, undefined, 5, 'x', {}, { layout: null }, { layout: { levels: [] } }, { layout: { levels: [{}] }, history: {} }]) {
    for (const r of [addPiece(broken, { type: 'armchair', x: 1, y: 1 }), movePiece(broken, 'a', 1, 1), rotatePiece(broken, 'a', 1), deletePiece(broken, 'a'), resizePiece(broken, 'a', [1, 1, 1]), recolorPiece(broken, 'a', 's', '#ffffff'), undo(broken), redo(broken), selectPiece(broken, 'a'), resetToAuto(broken, {}), loadLayout(broken, {})]) {
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'bad-state');
    }
  }
  assert.equal(createState('garbage').layout.levels.length, 0);
  assert.deepEqual(createState(null).layout, { version: 1, seed: 1, levels: [] });
});

test('pieceAt picks the topmost piece under a point', () => {
  const l = smallLayout();
  assert.equal(pieceAt(l, 'L0', 2.3, 2).id, 'p2', 'the vase, not the table under it');
  assert.equal(pieceAt(l, 'L0', 1.5, 2.3).id, 'p1');
  assert.equal(pieceAt(l, 'L0', 0, 0), null);
  assert.equal(pieceAt(l, 'L9', 2, 2), null);
  assert.equal(pieceAt(l, 'L0', NaN, 2), null);
  assert.equal(pieceAt(null, 'L0', 2, 2), null);
});

test('resetToAuto: the engine furnishes again as one undo step; loadLayout replaces the layout', () => {
  const { model, layout } = testPlans()[0];
  let st = createState(layout);
  const first = layout.levels[0].pieces[0].id;
  st = deletePiece(st, first).state;
  const r = resetToAuto(st, model, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.layout, layout, 'same seed, same layout');
  assert.deepEqual(undo(r.state).state.layout, st.layout);
  const seeded = resetToAuto(st, model, { seed: 9 });
  assert.equal(seeded.state.layout.seed, 9);
  assert.equal(resetToAuto(st, null, {}).ok, false);
  assert.equal(resetToAuto(st, { levels: 5 }, {}).ok, false);
  const l = loadLayout(st, clone(layout));
  assert.equal(l.ok, true);
  assert.equal(loadLayout(st, { nope: 1 }).reason, 'bad-layout');
});
