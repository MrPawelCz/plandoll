// Room colours (levels[].rooms): the recolorRoom operation, undo, reset, and saving and loading them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, recolorRoom, roomColorsOf, resetToAuto, movePiece, deletePiece, undo, redo, canUndo, serializeLayout, parseLayout, ROOM_LIMIT, MATERIAL_KEYS,
} from '../../src/editor/index.js';
import { testPlans, smallLayout, clone, deepFreeze } from './plans.mjs';

const plans = testPlans();
const [flat] = plans;
const L0 = 'L0';
const firstRoom = (p) => p.model.levels[0].rooms[0].id;

test('recolorRoom sets the wall and the floor: hex stored in lower case, material keys accepted, one undo step each', () => {
  const room = firstRoom(flat);
  let st = createState(flat.layout);
  let r = recolorRoom(st, L0, room, 'wall', '#AABBCC', { model: flat.model });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.layout.levels[0].rooms, { [room]: { wall: '#aabbcc' } });
  assert.equal(r.state.history.past.length, 1);
  const key = MATERIAL_KEYS[0];
  r = recolorRoom(r.state, L0, room, 'floor', key, { model: flat.model });
  assert.equal(r.ok, true);
  assert.deepEqual(roomColorsOf(r.state.layout, L0, room), { wall: '#aabbcc', floor: `lib:${key}` });
  assert.equal(r.state.history.past.length, 2);
  assert.equal(st.layout.levels[0].rooms, undefined, 'the input state is untouched');
  const back = undo(r.state).state;
  assert.deepEqual(roomColorsOf(back.layout, L0, room), { wall: '#aabbcc' });
  assert.deepEqual(roomColorsOf(redo(back).state.layout, L0, room), { wall: '#aabbcc', floor: `lib:${key}` });
});

test('recolorRoom with null clears a part; the last part removes the room and then the rooms key', () => {
  const room = firstRoom(flat);
  let st = createState(flat.layout);
  st = recolorRoom(st, L0, room, 'wall', '#112233').state;
  st = recolorRoom(st, L0, room, 'floor', '#445566').state;
  const cleared = recolorRoom(st, L0, room, 'wall', null);
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.state.layout.levels[0].rooms, { [room]: { floor: '#445566' } });
  const empty = recolorRoom(cleared.state, L0, room, 'floor', null);
  assert.equal(empty.ok, true);
  assert.equal('rooms' in empty.state.layout.levels[0], false);
  const again = recolorRoom(empty.state, L0, room, 'floor', null);
  assert.deepEqual([again.ok, again.reason], [false, 'no-change']);
  assert.equal(again.state, empty.state);
  const same = recolorRoom(st, L0, room, 'wall', '#112233');
  assert.deepEqual([same.ok, same.reason], [false, 'no-change']);
});

test('recolorRoom refuses what it cannot do and hands back the same state', () => {
  const room = firstRoom(flat);
  const st = createState(flat.layout);
  const cases = [
    [['nope', room, 'wall', '#112233'], 'unknown-level'],
    [[L0, 'nowhere', 'wall', '#112233'], 'unknown-room'],
    [[L0, '__proto__', 'wall', '#112233'], 'unknown-room'],
    [[L0, 'constructor', 'wall', '#112233'], 'unknown-room'],
    [[L0, room, 'ceiling', '#112233'], 'bad-part'],
    [[L0, room, 'wall', 'red'], 'bad-color'],
    [[L0, room, 'wall', 12], 'bad-color'],
    [[L0, room, 'wall', undefined], 'bad-color'],
  ];
  for (const [args, reason] of cases) {
    const r = recolorRoom(st, ...args, { model: flat.model });
    assert.deepEqual([r.ok, r.reason], [false, reason], JSON.stringify(args));
    assert.equal(r.state, st);
  }
  assert.equal(recolorRoom(null, L0, room, 'wall', '#112233').reason, 'bad-state');
  const upper = plans[1];
  assert.equal(recolorRoom(createState(upper.layout), 'L1', upper.model.levels[1].rooms[0].id, 'floor', '#112233', { model: upper.model }).ok, true, 'a room of the second level');
  assert.equal(recolorRoom(createState(upper.layout), 'L1', upper.model.levels[0].rooms[0].id, 'floor', '#112233', { model: upper.model }).reason, 'unknown-room', 'a room of another level');
});

test('recolorRoom without a model takes any valid room id, up to the limit of rooms per level', () => {
  let st = createState(smallLayout());
  for (let i = 0; i < ROOM_LIMIT; i++) st = recolorRoom(st, L0, `r${i}`, 'floor', '#123456').state;
  assert.equal(Object.keys(st.layout.levels[0].rooms).length, ROOM_LIMIT);
  const over = recolorRoom(st, L0, 'r-extra', 'floor', '#123456');
  assert.deepEqual([over.ok, over.reason], [false, 'limit-rooms']);
  assert.equal(recolorRoom(st, L0, 'r0', 'wall', '#123456').ok, true, 'a room that is already there can still get its other part');
  assert.equal(recolorRoom(st, L0, 'bad id', 'wall', '#123456').reason, 'unknown-room');
});

test('a series with the same coalesceKey is one undo step', () => {
  const room = firstRoom(flat);
  let st = createState(flat.layout);
  for (const c of ['#101010', '#202020', '#303030']) st = recolorRoom(st, L0, room, 'wall', c, { model: flat.model, coalesceKey: `room:${room}:wall` }).state;
  assert.equal(st.history.past.length, 1);
  assert.equal(roomColorsOf(st.layout, L0, room).wall, '#303030');
  assert.equal(roomColorsOf(undo(st).state.layout, L0, room).wall, undefined);
  assert.equal(canUndo(undo(st).state), false);
});

test('other operations keep the room colours, and a reset to the automatic layout clears them (one undo step brings them back)', () => {
  const room = firstRoom(flat);
  let st = createState(flat.layout);
  st = recolorRoom(st, L0, room, 'wall', '#112233').state;
  const p = st.layout.levels[0].pieces.find((q) => !q.on && q.type === 'sofa3');
  st = movePiece(st, p.id, p.x + 0.4, p.y, { model: flat.model }).state;
  st = deletePiece(st, st.layout.levels[0].pieces[0].id).state;
  assert.deepEqual(roomColorsOf(st.layout, L0, room), { wall: '#112233' });
  const before = st.history.past.length;
  const reset = resetToAuto(st, flat.model);
  assert.equal(reset.ok, true);
  assert.equal('rooms' in reset.state.layout.levels[0], false);
  assert.equal(reset.state.history.past.length, before + 1);
  assert.deepEqual(roomColorsOf(undo(reset.state).state.layout, L0, room), { wall: '#112233' });
});

test('saving: stable text, rooms sorted, empty ones left out, no rooms key when there are none', () => {
  const l = clone(smallLayout());
  const plain = serializeLayout(l);
  assert.ok(!plain.includes('"rooms"'), 'a layout without room colours has the same text as before');
  l.levels[0].rooms = { zeta: { floor: '#000000', wall: '#ffffff' }, alpha: { wall: '#ABCDEF' }, empty: {}, junk: 5, bad: { wall: 'red' } };
  const text = serializeLayout(l);
  assert.ok(text.includes('"rooms": {\n        "alpha": {"wall":"#abcdef"},\n        "zeta": {"wall":"#ffffff","floor":"#000000"}\n      }'), text);
  assert.ok(!text.includes('"empty"') && !text.includes('"junk"') && !text.includes('"bad"'));
  JSON.parse(text);
  const swapped = clone(l);
  swapped.levels[0].rooms = { alpha: { wall: '#abcdef' }, zeta: { wall: '#ffffff', floor: '#000000' } };
  assert.equal(serializeLayout(swapped), text, 'the order of keys in memory does not matter');
  l.levels[1].rooms = { r: { floor: 'nope' } };
  assert.ok(!serializeLayout(l).split('"id": "L1"')[1].includes('rooms'), 'a level whose colours are all invalid gets no rooms key');
});

for (const { name, model, layout } of plans) {
  test(`plan ${name}: room colours survive save and load, with the same text again`, () => {
    let st = createState(layout);
    let n = 0;
    for (const lv of model.levels) {
      for (const r of lv.rooms.slice(0, 3)) {
        st = recolorRoom(st, lv.id, r.id, n % 2 ? 'wall' : 'floor', n % 3 ? '#c0a080' : MATERIAL_KEYS[n % MATERIAL_KEYS.length], { model }).state;
        n++;
      }
    }
    assert.ok(n >= 3);
    const text = serializeLayout(st.layout);
    const back = parseLayout(text, model);
    assert.deepEqual([back.ok, back.warnings], [true, []]);
    assert.deepEqual(back.layout.levels.map((l) => l.rooms ?? null), st.layout.levels.map((l) => l.rooms ?? null));
    assert.equal(serializeLayout(back.layout), text);
    const noModel = parseLayout(text);
    assert.equal(noModel.ok, true);
    assert.equal(serializeLayout(noModel.layout), text, 'without a plan the colours are kept too');
  });
}

test('a file from before room colours (no rooms key) is still valid', () => {
  const old = serializeLayout(flat.layout);
  const r = parseLayout(old, flat.model);
  assert.deepEqual([r.ok, r.warnings], [true, []]);
  assert.ok(r.layout.levels.every((l) => !('rooms' in l)));
});

test('loading: wrong rooms, wrong colours, wrong parts and dangerous names are left out with a message', () => {
  const room = firstRoom(flat);
  const doc = (rooms) => JSON.stringify({ version: 1, seed: 1, levels: [{ id: L0, pieces: [], rooms }] });
  let r = parseLayout(doc({ [room]: { wall: '#112233', floor: 'red', ceiling: '#ffffff', extra: 1 }, nowhere: { wall: '#112233' } }), flat.model);
  assert.equal(r.ok, true);
  assert.deepEqual(r.layout.levels[0].rooms, { [room]: { wall: '#112233' } });
  assert.ok(r.warnings.length >= 3 && r.warnings.every((w) => typeof w === 'string'));
  const hostile = '{"version":1,"seed":1,"levels":[{"id":"L0","pieces":[],"rooms":{"__proto__":{"wall":"#112233"},"constructor":{"wall":"#112233"},"' + room + '":{"__proto__":{"floor":"#112233"},"wall":"#445566"}}}]}';
  r = parseLayout(hostile, flat.model);
  assert.equal(r.ok, true);
  assert.deepEqual(r.layout.levels[0].rooms, { [room]: { wall: '#445566' } });
  assert.equal({}.wall, undefined);
  assert.equal(Object.getPrototypeOf(r.layout.levels[0].rooms), Object.prototype);
  for (const bad of [5, 'x', [], [{ wall: '#112233' }], true]) {
    const q = parseLayout(doc(bad), flat.model);
    assert.equal(q.ok, true);
    assert.equal('rooms' in q.layout.levels[0], false);
  }
  assert.equal(parseLayout(doc(null), flat.model).warnings.length, 0, 'null means none');
  assert.equal(parseLayout(doc({ [room]: 'oak' }), flat.model).layout.levels[0].rooms, undefined);
  assert.equal(parseLayout(doc({ [room]: { wall: '#12345' } }), flat.model).layout.levels[0].rooms, undefined);
  const strict = parseLayout(doc({ nowhere: { wall: '#112233' } }), flat.model, { strict: true });
  assert.equal(strict.ok, false);
});

test('loading: more than the limit of rooms keeps the first ones and says so; the parser stays fast', () => {
  const rooms = {};
  for (let i = 0; i < 5000; i++) rooms[`r${i}`] = { wall: '#112233', floor: 'x'.repeat(50) };
  const text = JSON.stringify({ version: 1, seed: 1, levels: [{ id: L0, pieces: [], rooms }] });
  const t0 = performance.now();
  const r = parseLayout(text);
  const ms = performance.now() - t0;
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.layout.levels[0].rooms).length, ROOM_LIMIT);
  assert.ok(r.warnings.length <= 60 && r.warnings.some((w) => w.includes(String(ROOM_LIMIT))));
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
});

test('room colours do not mutate a frozen layout and the helpers survive junk', () => {
  const room = firstRoom(flat);
  const frozen = deepFreeze(clone(flat.layout));
  const r = recolorRoom(createState(frozen), L0, room, 'wall', '#112233', { model: flat.model });
  assert.equal(r.ok, true);
  assert.equal(frozen.levels[0].rooms, undefined);
  for (const junk of [null, undefined, 5, {}, { levels: 5 }, { levels: [null] }]) assert.deepEqual(roomColorsOf(junk, L0, room), {});
  assert.deepEqual(roomColorsOf(r.state.layout, L0, '__proto__'), {});
  assert.deepEqual(roomColorsOf(r.state.layout, 'nope', room), {});
  assert.equal(serializeLayout({ version: 1, levels: [{ id: L0, pieces: [], rooms: 5 }] }).includes('rooms'), false);
});
