// Placement rules on three plans: snapping to walls, the 5 cm grid and the 15 degree angle; overlap, outside the room, door zones,
// tall pieces at windows, props without support; soft and strict modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, addPiece, movePiece, rotatePiece, findPiece, placementProblems, placeAt, hardProblems, roomAt, SNAP_DEFAULTS } from '../../src/editor/index.js';
import { roomInterior, levelZones, frontOf, rotFromFront } from '../../src/layout/geometry.js';
import { specOf } from '../../src/furniture/specs.js';
import { checkLayout } from '../../src/layout/index.js';
import { testPlans, smallLayout, clone } from './plans.mjs';

const plans = testPlans();
const piece = (st, id) => findPiece(st.layout, id)?.piece;

for (const { name, model, layout } of plans) {
  test(`plan ${name}: the engine's own pieces raise no hard problems when checked one by one`, () => {
    let checked = 0;
    for (const L of layout.levels) for (const p of L.pieces) {
      const problems = placementProblems(model, layout, L.id, p);
      assert.deepEqual(hardProblems(problems), [], `${p.id} ${p.type}: ${JSON.stringify(problems)}`);
      checked++;
    }
    assert.ok(checked >= 20);
  });

  test(`plan ${name}: a piece pushed away from its wall comes back to a 2 cm gap and the angle of the wall`, () => {
    let tested = 0;
    for (const L of layout.levels) {
      const level = model.levels.find((l) => l.id === L.id);
      for (const p of L.pieces) {
        const spec = specOf(p.type);
        if (tested >= 6 || spec.place.mode !== 'floor' || spec.place.against !== 'back' || p.on) continue;
        const ip = roomInterior(level, level.rooms.find((r) => r.id === p.room));
        const edge = ip.edges.find((e) => Math.abs(rotFromFront(e.n[0], e.n[1]) - p.rot) < 0.01);
        if (!edge) continue;
        const [fx, fy] = frontOf(p.rot);
        // 6 cm further into the room and 4 degrees off; the middle of the span stays on the wall
        const res = placeAt(model, layout, L.id, p, { x: p.x + fx * 0.06, y: p.y + fy * 0.06, rot: p.rot + 4 }, { keepRot: true });
        assert.equal(res.snapped.wall, true, `${p.id} ${p.type}`);
        assert.equal(res.rot, p.rot, 'the piece is turned parallel to the wall again');
        const across = (res.x - edge.a[0]) * edge.n[0] + (res.y - edge.a[1]) * edge.n[1] - p.size[1] / 2;
        assert.ok(Math.abs(across - SNAP_DEFAULTS.wallGap) < 0.002, `${p.id} gap ${across}`);
        tested++;
      }
    }
    assert.ok(tested >= 3, `only ${tested} pieces tested`);
  });

  test(`plan ${name}: moving into another room changes the room; far outside is a hard problem`, () => {
    const L = layout.levels[0], level = model.levels[0];
    const p = L.pieces.find((q) => specOf(q.type).place.mode === 'floor' && !q.on);
    const st = createState(layout);
    const out = movePiece(st, p.id, -40, -40, { model });
    assert.equal(out.ok, true, 'soft mode accepts it');
    assert.ok(out.problems.some((q) => q.kind === 'outside-room'));
    const strict = movePiece(st, p.id, -40, -40, { model, mode: 'strict' });
    assert.equal(strict.ok, false);
    assert.equal(strict.reason, 'outside-room');
    assert.equal(strict.state, st, 'a refused move leaves the state alone');
    const other = level.rooms.find((r) => r.id !== p.room && roomInterior(level, r));
    const ip = roomInterior(level, other);
    const cx = ip.poly.reduce((s, q) => s + q[0], 0) / ip.poly.length, cy = ip.poly.reduce((s, q) => s + q[1], 0) / ip.poly.length;
    const target = roomAt(model, L.id, cx, cy);
    assert.ok(target && target !== p.room, `no second room found for ${p.id}`);
    const moved = movePiece(st, p.id, cx, cy, { model, snap: false });
    assert.equal(piece(moved.state, p.id).room, target, 'the room follows the centre of the piece');
  });
}

test('overlap: soft mode reports it, strict mode refuses it', () => {
  const st = createState(smallLayout());
  const soft = movePiece(st, 'p3', 2.5, 2.2, { snap: false });
  assert.equal(soft.ok, true);
  assert.deepEqual(soft.problems.filter((p) => p.kind === 'overlap').map((p) => p.with), ['p1', 'p2'], 'the table and the vase on it (the sofa is taller than the table top)');
  const strict = movePiece(st, 'p3', 2.5, 2.2, { snap: false, mode: 'strict' });
  assert.equal(strict.ok, false);
  assert.equal(strict.reason, 'overlap');
  assert.deepEqual(strict.problems.filter((p) => p.kind === 'overlap').map((p) => p.with), ['p1', 'p2']);
  const apart = movePiece(st, 'p3', 9, 2, { snap: false, mode: 'strict' });
  assert.equal(apart.ok, true);
  assert.deepEqual(apart.problems, []);
  const turned = rotatePiece(st, 'p3', 90, { snap: false, mode: 'strict' });
  assert.equal(turned.ok, true, 'a turn that stays clear is fine');
});

test('overlap uses the turned rectangles, not their bounding boxes', () => {
  const l = smallLayout();
  // a narrow shelf turned 45 degrees leaves the corner next to it free
  l.levels[0].pieces.push({ id: 'p9', type: 'bookshelf', room: 'r', x: 9, y: 9, rot: 45, size: [1.8, 0.32, 1.9], elev: 0, on: null, colors: {} });
  const st = createState(l);
  const clear = placementProblems(null, st.layout, 'L0', { id: 'q', type: 'armchair', room: 'r', x: 9.9, y: 8.2, rot: 0, size: [0.4, 0.4, 0.85], elev: 0, on: null, colors: {} });
  assert.deepEqual(clear, [], 'the bounding box of the shelf covers this point, the shelf itself does not');
  const hit = placementProblems(null, st.layout, 'L0', { id: 'q', type: 'armchair', room: 'r', x: 9.3, y: 8.7, rot: 0, size: [0.4, 0.4, 0.85], elev: 0, on: null, colors: {} });
  assert.deepEqual(hit.map((p) => p.kind), ['overlap']);
});

test('props: a vase dropped on another table moves onto it; on the bare floor it has no support', () => {
  const l = smallLayout();
  l.levels[0].pieces.push({ id: 'p6', type: 'dining-table', room: 'r', x: 9, y: 6, rot: 0, size: [1.6, 0.9, 0.75], elev: 0, on: null, colors: {} });
  const st = createState(l);
  const onto = movePiece(st, 'p2', 9.1, 6, { snap: false, mode: 'strict' });
  assert.equal(onto.ok, true);
  assert.equal(piece(onto.state, 'p2').on, 'p6');
  assert.equal(piece(onto.state, 'p2').elev, 0.75);
  const floor = movePiece(st, 'p2', 12, 12, { snap: false, mode: 'strict' });
  assert.equal(floor.ok, false);
  assert.equal(floor.reason, 'floating-prop');
  assert.ok(movePiece(st, 'p2', 12, 12, { snap: false }).problems.some((p) => p.kind === 'floating-prop'), 'soft mode warns');
  const added = addPiece(st, { type: 'vase', x: 9, y: 6.1, level: 'L0', room: 'r' }, { snap: false });
  assert.equal(piece(added.state, added.id).on, 'p6', 'a new prop finds the table under it');
  assert.equal(addPiece(st, { type: 'vase', x: 12, y: 12, level: 'L0', room: 'r' }, { mode: 'strict' }).reason, 'floating-prop');
});

for (const { name, model, layout } of plans) {
  test(`plan ${name}: door zones, stairs and windows are reported`, () => {
    let doors = 0, windows = 0;
    for (const level of model.levels) {
      const zones = levelZones(level, model);
      const room = level.rooms.find((r) => roomInterior(level, r));
      for (const dz of zones.doors.slice(0, 3)) {
        const probe = { id: 'probe', type: 'coffee-table', room: room.id, x: dz.box.cx, y: dz.box.cy, rot: 0, size: [1.1, 0.6, 0.4], elev: 0, on: null, colors: {} };
        assert.ok(placementProblems(model, layout, level.id, probe).some((p) => p.kind === 'door-zone' && p.with === dz.o.id), `door ${dz.o.id}`);
        doors++;
      }
      for (const wz of zones.windows.slice(0, 3)) {
        const probe = { id: 'probe', type: 'wardrobe', room: room.id, x: wz.box.cx, y: wz.box.cy, rot: 0, size: [1.8, 0.6, 2.2], elev: 0, on: null, colors: {} };
        assert.ok(placementProblems(model, layout, level.id, probe).some((p) => p.kind === 'tall-before-window' && p.with === wz.o.id), `window ${wz.o.id}`);
        windows++;
      }
    }
    assert.ok(doors >= 1 && windows >= 1, `doors ${doors}, windows ${windows}`);
  });
}

test('door and window problems are warnings in strict mode, overlap and outside are not', () => {
  const { model, layout } = plans[0];
  const level = model.levels[0];
  const dz = levelZones(level, model).doors[0];
  const room = level.rooms.find((r) => roomInterior(level, r));
  const probe = { id: 'probe', type: 'coffee-table', room: room.id, x: dz.box.cx, y: dz.box.cy, rot: 0, size: [1.1, 0.6, 0.4], elev: 0, on: null, colors: {} };
  const kinds = placementProblems(model, layout, level.id, probe).map((p) => p.kind);
  assert.ok(kinds.includes('door-zone'));
  assert.ok(!hardProblems([{ kind: 'door-zone' }, { kind: 'stair' }, { kind: 'tall-before-window' }]).length);
  assert.equal(hardProblems([{ kind: 'overlap' }, { kind: 'outside-room' }, { kind: 'floating-prop' }]).length, 3);
});

test('snapping can be switched off or tuned, and results are rounded to millimetres', () => {
  const st = createState(smallLayout());
  const raw = movePiece(st, 'p3', 6.0123456, 2.0612345, { snap: false });
  assert.deepEqual([piece(raw.state, 'p3').x, piece(raw.state, 'p3').y], [6.012, 2.061]);
  const coarse = movePiece(st, 'p3', 6.12, 2.07, { snap: { grid: 0.5 } });
  assert.deepEqual([piece(coarse.state, 'p3').x, piece(coarse.state, 'p3').y], [6, 2]);
  const fine = rotatePiece(st, 'p3', 47, { snap: { angle: 5 } });
  assert.equal(piece(fine.state, 'p3').rot, 45);
  const res = placeAt(null, st.layout, 'L0', piece(st, 'p3'), { x: 6.03, y: 2.02, rot: 8 }, {});
  assert.deepEqual([res.x, res.y, res.rot], [6.05, 2, 15]);
  assert.deepEqual(res.snapped, { grid: true, angle: true, wall: false });
});

test('rules never throw on hostile pieces', () => {
  const { model, layout } = plans[0];
  const junk = [null, undefined, {}, { type: 'sofa3' }, { type: 'sofa3', x: NaN, y: 0, rot: 0, size: [1, 1, 1], elev: 0 }, { type: 'sofa3', x: 1, y: 1, rot: 0, size: 'big', elev: 0 }, { type: '__proto__', x: 1, y: 1, rot: 0, size: [1, 1, 1], elev: 0 }];
  for (const j of junk) assert.doesNotThrow(() => placementProblems(model, layout, 'L0', j));
  assert.doesNotThrow(() => placementProblems(model, layout, 'nope', clone(layout.levels[0].pieces[0])));
  assert.doesNotThrow(() => placementProblems(null, null, 'L0', clone(layout.levels[0].pieces[0])));
  assert.equal(roomAt(model, 'L0', NaN, 0), null);
  assert.equal(roomAt(null, 'L0', 0, 0), null);
});

test('1000 moves of one piece take under a second', () => {
  const { model, layout } = plans[1];
  const p = layout.levels[0].pieces.find((q) => specOf(q.type).place.mode === 'floor' && !q.on);
  let st = createState(layout);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) st = movePiece(st, p.id, p.x + (i % 17) * 0.013, p.y + (i % 11) * 0.017, { model, coalesceKey: 'drag' }).state;
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
  assert.equal(st.history.past.length, 1);
  assert.notEqual(piece(st, p.id).x, p.x);
});

// The rules and the layout checker must agree: after a move, the problems of the moved piece are the violations checkLayout reports for it.
const KIND = { 'outside-room': 'outside-room', overlap: 'overlap', 'door-zone': 'door-zone', stair: 'stair', 'tall-before-window': 'tall-before-window', 'floating-prop': 'floating-prop' };
for (const { name, model, layout } of plans) {
  test(`plan ${name}: the problems of a moved piece are the ones checkLayout finds`, () => {
    const st = createState(layout);
    const level = layout.levels[0];
    const movable = level.pieces.filter((p) => !p.on && !level.pieces.some((q) => q.on === p.id)).slice(0, 14);
    let compared = 0, withProblems = 0;
    for (const p of movable) {
      for (const [dx, dy] of [[0.35, 0.2], [-0.5, 0.4], [0.9, -0.7]]) {
        const r = movePiece(st, p.id, p.x + dx, p.y + dy, { model, snap: false });
        if (!r.ok) continue;
        const moved = piece(r.state, p.id);
        const found = checkLayout(model, r.state.layout).filter((v) => KIND[v.kind] && (v.piece === p.id || v.other === p.id));
        const want = [...new Set(found.map((v) => v.kind))].sort();
        const got = [...new Set(r.problems.map((q) => q.kind))].sort();
        assert.deepEqual(got, want, `${p.id} ${p.type} moved to ${moved.x},${moved.y}`);
        compared++;
        if (got.length) withProblems++;
      }
    }
    assert.ok(compared >= 20, `only ${compared} moves compared`);
    assert.ok(withProblems >= 3, `only ${withProblems} moves had problems, the comparison proves little`);
  });
}
