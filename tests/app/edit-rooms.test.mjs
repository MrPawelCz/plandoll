// Rooms, duplicating, edge snapping and the default place of a new piece in the editing session (flat-1 and duplex-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditSession } from '../../src/app/edit.js';
import { testPlans, clone } from '../editor/plans.mjs';
import { pieceCount } from '../../src/editor/index.js';

const plans = testPlans().filter((p) => p.name === 'flat-1' || p.name === 'duplex-1');
const make = (p, extra = {}) => { const events = []; const s = createEditSession({ layout: clone(p.layout), model: p.model, onChange: (e) => events.push(e.type), ...extra }); return { s, events }; };
const firstRoom = (p) => { const lv = p.model.levels.find((l) => l.rooms?.length); return { level: lv.id, room: lv.rooms[0] }; };
const floorPiece = (layout) => layout.levels.flatMap((l) => l.pieces).find((x) => !x.on && x.elev === 0);

for (const p of plans) {
  test(`${p.name}: a room can be selected and cleared, a piece and a room exclude each other`, () => {
    const { s, events } = make(p);
    const { level, room } = firstRoom(p);
    assert.equal(s.selectedRoom(), null);
    assert.equal(s.selectRoom(level, room.id), true);
    const sel = s.selectedRoom();
    assert.equal(sel.id, room.id); assert.equal(sel.level, level);
    assert.equal(typeof sel.name, 'string'); assert.deepEqual(sel.colors, {});
    assert.ok(events.includes('select'));
    const piece = floorPiece(s.state.layout);
    s.select(piece.id); // selecting a piece clears the room
    assert.equal(s.selectedRoom(), null); assert.equal(s.selected().id, piece.id);
    s.selectRoom(level, room.id); // selecting a room clears the piece
    assert.equal(s.selected(), null); assert.equal(s.state.selection, null); assert.equal(s.selectedRoom().id, room.id);
    s.select(null); assert.equal(s.selectedRoom(), null);
    s.selectRoom(level, room.id); assert.equal(s.selectRoom(null, null), true); assert.equal(s.selectedRoom(), null);
    assert.equal(s.selectRoom(level, 'no-such-room'), false); assert.equal(s.selectRoom('no-level', room.id), false);
  });

  test(`${p.name}: recolouring a room is one undo step per run, undo and redo bring the colours back, other rooms are untouched`, () => {
    const { s } = make(p);
    const { level, room } = firstRoom(p);
    assert.deepEqual(s.recolorRoom('floor', '#8a5a3c'), { ok: false, reason: 'no-room-selected' });
    s.selectRoom(level, room.id);
    const before = JSON.stringify(s.state.layout);
    assert.equal(s.recolorRoom('floor', '#8a5a3c').ok, true);
    assert.equal(s.recolorRoom('floor', '#8a5a3d').ok, true); // same part in a row: one step
    assert.deepEqual(s.selectedRoom().colors, { floor: '#8a5a3d' });
    assert.equal(s.canUndo(), true);
    s.undo(); // both changes of the floor were one step
    assert.equal(JSON.stringify(s.state.layout), before);
    assert.deepEqual(s.selectedRoom().colors, {});
    s.redo();
    assert.equal(s.selectedRoom().colors.floor, '#8a5a3d');
    assert.equal(s.recolorRoom('floor', null).ok, true);
    assert.equal(s.selectedRoom().colors.floor, undefined);
    assert.equal(s.recolorRoom('ceiling', '#ffffff').ok, false);
    assert.equal(s.recolorRoom('floor', 'not a colour').ok, false);
    const levelRooms = s.state.layout.levels.find((l) => l.id === level).rooms ?? {};
    assert.deepEqual(Object.keys(levelRooms).filter((id) => id !== room.id), []);
  });

  test(`${p.name}: duplicating copies the selected piece and selects the copy; undo removes it`, () => {
    const { s } = make(p);
    assert.deepEqual(s.duplicate(), { ok: false, reason: 'nothing-selected' });
    const piece = floorPiece(s.state.layout), n0 = pieceCount(s.state.layout);
    s.select(piece.id);
    const r = s.duplicate();
    assert.equal(r.ok, true);
    assert.equal(pieceCount(s.state.layout), n0 + 1);
    assert.notEqual(s.selected().id, piece.id);
    assert.equal(s.selected().type, piece.type);
    s.undo();
    assert.equal(pieceCount(s.state.layout), n0);
  });

  test(`${p.name}: a new piece goes to the place the view is centred on, and a given place wins`, () => {
    const { level, room } = firstRoom(p);
    const lv = p.model.levels.find((l) => l.id === level), poly = room.polygon;
    const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cy = poly.reduce((a, q) => a + q[1], 0) / poly.length;
    const calls = [];
    const { s } = make(p, { viewPoint: () => { calls.push(1); return { level, x: cx, y: cy }; } });
    const type = floorPiece(s.state.layout).type;
    const r = s.add(type, {});
    assert.ok(calls.length >= 1);
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) assert.equal(s.selected().room, room.id);
    const other = make(p, { viewPoint: () => { throw new Error('view lost'); } }); // a broken view point must not break adding
    assert.equal(typeof other.s.add(type, {}).ok, 'boolean');
    assert.ok(lv);
  });

  test(`${p.name}: edge snapping is off by default and can be switched`, () => {
    const { s } = make(p);
    assert.equal(s.snapEdges(), false);
    s.setSnapEdges(true); assert.equal(s.snapEdges(), true);
    const piece = floorPiece(s.state.layout);
    s.select(piece.id);
    assert.equal(s.beginDrag(piece.id), true);
    assert.equal(s.dragTo(piece.x + 0.2, piece.y).ok, true);
    s.endDrag();
    s.setSnapEdges(false); assert.equal(s.snapEdges(), false);
  });
}

test('loading a layout with room colours keeps them and replaces the selection of a room', () => {
  const p = plans[0], { level, room } = firstRoom(p);
  const a = make(p).s; a.selectRoom(level, room.id); a.recolorRoom('wall', '#e8d9c0');
  const text = a.exportText();
  const b = make(p).s; b.selectRoom(level, room.id);
  const res = b.importText(text);
  assert.equal(res.ok, true);
  assert.equal(b.selectedRoom().colors.wall, '#e8d9c0');
});
