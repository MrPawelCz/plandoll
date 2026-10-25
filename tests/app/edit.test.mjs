// The editing session on the real example plans (flat-1 and duplex-1) with their automatic layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditSession } from '../../src/app/edit.js';
import { testPlans, clone } from '../editor/plans.mjs';
import { autoFurnish } from '../../src/layout/index.js';
import { pieceCount } from '../../src/editor/index.js';

const plans = testPlans().filter((p) => p.name === 'flat-1' || p.name === 'duplex-1');
const floorPiece = (layout) => layout.levels.flatMap((l) => l.pieces).find((p) => !p.on && p.elev === 0 && ['sofa3', 'bed-double', 'dining-table'].includes(p.type)) ?? layout.levels.flatMap((l) => l.pieces).find((p) => !p.on && p.elev === 0);
const make = (p) => { const events = []; const s = createEditSession({ layout: clone(p.layout), model: p.model, onChange: (e) => events.push(e.type) }); return { s, events }; };

for (const p of plans) {
  test(`${p.name}: select, selection survives, deselect, unknown id is refused`, () => {
    const { s, events } = make(p);
    const piece = floorPiece(p.layout);
    assert.equal(s.selected(), null);
    assert.equal(s.select(piece.id), true);
    assert.equal(s.selected().id, piece.id);
    assert.deepEqual(events, ['select']);
    assert.equal(s.select('nope'), false);
    assert.equal(s.selected().id, piece.id);
    s.select(null);
    assert.equal(s.selected(), null);
    assert.ok(Array.isArray(s.problems()));
  });

  test(`${p.name}: turn changes the angle, remove deletes with what stands on it, undo and redo bring them back`, () => {
    const { s } = make(p);
    const piece = floorPiece(p.layout), n0 = pieceCount(s.state.layout), json0 = JSON.stringify(s.state.layout);
    assert.deepEqual(s.turn(), { ok: false, reason: 'nothing-selected' });
    s.select(piece.id);
    const rot0 = s.selected().rot;
    assert.equal(s.turn(90).ok, true);
    assert.notEqual(s.selected().rot, rot0);
    assert.equal(s.canUndo(), true);
    s.undo();
    assert.equal(s.selected().rot, rot0);
    assert.equal(JSON.stringify(s.state.layout), json0);
    const r = s.remove();
    assert.equal(r.ok, true);
    assert.ok(pieceCount(s.state.layout) < n0);
    assert.equal(s.selected(), null);
    s.undo();
    assert.equal(pieceCount(s.state.layout), n0);
    assert.equal(s.canRedo(), true);
    s.redo();
    assert.ok(pieceCount(s.state.layout) < n0);
    assert.equal(s.canRedo(), false);
  });

  test(`${p.name}: add puts a new piece in a room and selects it`, () => {
    const { s, events } = make(p);
    const n0 = pieceCount(s.state.layout);
    const r = s.add('plant-small');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(pieceCount(s.state.layout), n0 + 1);
    assert.equal(s.selected().id, r.id);
    assert.ok(s.selected().room);
    assert.ok(events.includes('structure'));
    assert.equal(s.add('no-such-type').ok, false);
  });

  test(`${p.name}: a drag is one undo step, cancel puts everything back`, () => {
    const { s, events } = make(p);
    const piece = floorPiece(p.layout), json0 = JSON.stringify(s.state.layout);
    assert.equal(s.dragTo(1, 1).ok, false, 'no drag yet');
    assert.equal(s.beginDrag(piece.id), true);
    assert.equal(s.beginDrag(piece.id), false, 'one drag at a time');
    assert.equal(s.dragging, piece.id);
    let moved = 0;
    for (let i = 1; i <= 6; i++) if (s.dragTo(piece.x + 0.1 * i, piece.y + 0.05 * i).ok) moved++;
    assert.ok(moved >= 3);
    assert.ok(events.filter((e) => e === 'drag').length >= 3);
    assert.notEqual(JSON.stringify(s.state.layout), json0);
    assert.equal(s.endDrag(), true);
    assert.equal(s.dragging, null);
    assert.equal(events.at(-1), 'dragend');
    s.undo();
    assert.equal(JSON.stringify(s.state.layout), json0, 'the whole drag undone in one step');
    assert.equal(s.canUndo(), false);
    // second drag of the same piece is a separate step
    s.beginDrag(piece.id); s.dragTo(piece.x + 0.5, piece.y); s.endDrag();
    const afterFirst = { x: s.selected().x, y: s.selected().y };
    s.beginDrag(piece.id); s.dragTo(piece.x + 0.5, piece.y + 0.5); s.endDrag();
    assert.notDeepEqual({ x: s.selected().x, y: s.selected().y }, afterFirst);
    s.undo();
    assert.deepEqual({ x: s.selected().x, y: s.selected().y }, afterFirst, 'the second drag is undone alone');
    assert.equal(s.canUndo(), true, 'two drags are two steps');
    // cancel
    const before = s.state;
    s.beginDrag(piece.id); s.dragTo(piece.x - 0.3, piece.y); assert.notEqual(s.state, before);
    assert.equal(s.cancelDrag(), true);
    assert.equal(s.state, before);
    assert.equal(s.cancelDrag(), false);
  });

  test(`${p.name}: automatic layout equals the engine's, export and import round-trip, hostile text is refused`, () => {
    const { s } = make(p);
    const piece = floorPiece(p.layout);
    s.select(piece.id); s.turn(); s.remove();
    const edited = s.exportText();
    assert.equal(typeof edited, 'string');
    assert.equal(s.reset().ok, true);
    assert.equal(JSON.stringify(s.state.layout), JSON.stringify(autoFurnish(p.model, { seed: p.layout.seed })));
    assert.equal(s.selected(), null);
    const imp = s.importText(edited);
    assert.equal(imp.ok, true, JSON.stringify(imp.errors));
    assert.equal(s.exportText(), edited);
    const keep = s.state;
    for (const bad of ['', 'not json', '{"version":2}', '[]', 'x'.repeat(10), null, 42]) assert.equal(s.importText(bad).ok, false);
    assert.equal(s.state, keep, 'a refused import changes nothing');
  });
}

test('subscribe reports changes and selections, and the returned function unsubscribes', () => {
  const p = plans[0], { s } = make(p);
  const seen = [];
  const off = s.subscribe((e) => seen.push(e.type));
  const piece = floorPiece(p.layout);
  s.select(piece.id); s.turn(); s.undo();
  assert.deepEqual(seen, ['select', 'change', 'change']);
  off();
  s.remove();
  assert.equal(seen.length, 3);
});

test('a throwing listener does not break the session', () => {
  const p = plans[0];
  const s = createEditSession({ layout: clone(p.layout), model: p.model, onChange: () => { throw new Error('boom'); } });
  s.subscribe(() => { throw new Error('boom'); });
  const piece = floorPiece(p.layout);
  assert.equal(s.select(piece.id), true);
  assert.equal(s.remove().ok, true);
});
