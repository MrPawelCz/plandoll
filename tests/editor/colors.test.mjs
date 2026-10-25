// One spelling for colours: '#rrggbb', 'lib:<key>' and (pieces only) 'f:<key>'; a bare library key is read as 'lib:<key>'.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanColor, cleanRoomColor, readColor, FURNITURE_COLOR_KEYS, MATERIAL_KEYS, createState, addPiece, recolorPiece, recolorRoom, roomColorsOf,
  serializeLayout, parseLayout,
} from '../../src/editor/index.js';
import { isSlotColor } from '../../src/furniture/index.js';
import { PALETTE } from '../../src/render/materials.js';
import { PALETTES, ROOM_PALETTES, paletteOf } from '../../src/furniture/palettes.js';
import { SPECS } from '../../src/furniture/specs.js';
import { testPlans, smallLayout, clone } from './plans.mjs';

test('the list of furniture kit colours equals the f: materials of the kit', () => {
  const kit = Object.keys(PALETTE).filter((k) => k.startsWith('f:')).sort();
  assert.deepEqual([...FURNITURE_COLOR_KEYS].sort(), kit);
});

test('cleanColor: full forms are kept, hex goes to lower case, a bare library key gets lib:, the rest is refused', () => {
  const key = MATERIAL_KEYS[0];
  assert.equal(cleanColor('#AABBCC'), '#aabbcc');
  assert.equal(cleanColor(`lib:${key}`), `lib:${key}`);
  assert.equal(cleanColor(key), `lib:${key}`);
  assert.equal(cleanColor('f:wood'), 'f:wood');
  assert.deepEqual(readColor(key), { value: `lib:${key}`, bare: true });
  assert.deepEqual(readColor(`lib:${key}`), { value: `lib:${key}`, bare: false });
  for (const bad of ['lib:made-up', 'lib:', 'f:made-up', 'f:', 'LIB:oak', 'red', '#12345', '#1234567', '#ggg000', '', 'x'.repeat(200), 5, null, undefined, {}, [], 'lib:__proto__', '__proto__']) {
    assert.equal(cleanColor(bad), null, String(bad));
  }
  assert.equal(cleanColor(key, ['other']), null, 'the allowed keys can be overridden');
  assert.equal(cleanColor('lib:other', ['other']), 'lib:other');
});

test('room colours never take furniture kit materials', () => {
  assert.equal(cleanRoomColor('f:wood'), null);
  assert.equal(cleanRoomColor('#ABCDEF'), '#abcdef');
  assert.equal(cleanRoomColor(MATERIAL_KEYS[1]), `lib:${MATERIAL_KEYS[1]}`);
  const { model, layout } = testPlans()[0];
  const room = model.levels[0].rooms[0].id;
  assert.equal(recolorRoom(createState(layout), 'L0', room, 'wall', 'f:wood', { model }).reason, 'bad-color');
  const ok = recolorRoom(createState(layout), 'L0', room, 'floor', MATERIAL_KEYS[1], { model });
  assert.deepEqual(roomColorsOf(ok.state.layout, 'L0', room), { floor: `lib:${MATERIAL_KEYS[1]}` });
});

test('everything the editor accepts for a piece slot is accepted by the piece builder', () => {
  const values = ['#000000', '#FFFFFF', '#a1b2c3', ...MATERIAL_KEYS, ...MATERIAL_KEYS.map((k) => `lib:${k}`), ...FURNITURE_COLOR_KEYS];
  for (const v of values) {
    const c = cleanColor(v);
    assert.ok(c, v);
    assert.equal(isSlotColor(c), true, `${v} -> ${c}`);
    assert.equal(cleanColor(c), c, `${c} is stable`);
  }
  const st = createState(smallLayout());
  for (const v of values.slice(0, 40)) {
    const r = recolorPiece(st, 'p3', 'upholstery', v);
    if (r.ok) assert.equal(isSlotColor(r.state.layout.levels[0].pieces[2].colors.upholstery), true, v);
  }
});

test('every palette entry is a colour the editor accepts', () => {
  for (const pal of Object.values(PALETTES)) for (const c of pal.colors) assert.equal(cleanColor(c.hex), c.hex.toLowerCase(), `${pal.id} ${c.hex}`);
  for (const kind of ['wall', 'floor']) for (const e of ROOM_PALETTES[kind]) assert.equal(cleanRoomColor(e.value), e.value.toLowerCase(), `${kind} ${e.value}`);
  let slots = 0;
  for (const spec of SPECS) for (const slot of spec.slots) {
    const pal = paletteOf(spec.id, slot);
    if (!pal) continue;
    slots++;
    for (const c of pal.colors) assert.ok(cleanColor(c.hex), `${spec.id}.${slot} ${c.hex}`);
  }
  assert.ok(slots > 50, `${slots} slots checked`);
});

test('addPiece and recolorPiece store the full form', () => {
  const { model } = testPlans()[0];
  const lv = model.levels[0], r = lv.rooms[0];
  const key = MATERIAL_KEYS[2];
  const a = addPiece(createState({ version: 1, seed: 1, levels: [{ id: lv.id, pieces: [] }] }), { type: 'sofa3', x: r.label[0], y: r.label[1], colors: { upholstery: key, legs: 'f:dark' } }, { model, mode: 'off' });
  assert.equal(a.ok, true, a.reason);
  assert.deepEqual(a.state.layout.levels[0].pieces[0].colors, { upholstery: `lib:${key}`, legs: 'f:dark' });
});

test('saving writes the full form and loading an old file with bare keys says so', () => {
  const key = MATERIAL_KEYS[0];
  const layout = clone(smallLayout());
  layout.levels[0].pieces[2].colors = { upholstery: key, cushions: '#ABCDEF', legs: 'f:dark' };
  layout.levels[0].rooms = { r: { wall: key, floor: '#112233' } };
  const text = serializeLayout(layout);
  assert.ok(text.includes(`"upholstery":"lib:${key}"`), 'a bare key is written in the full form');
  assert.ok(text.includes('"cushions":"#abcdef"'));
  assert.ok(!text.includes(`"${key}"`));
  const old = JSON.stringify({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [{ id: 'a', type: 'sofa3', room: 'r', x: 1, y: 1, rot: 0, size: [2.1, 0.95, 0.85], elev: 0, on: null, colors: { upholstery: key } }], rooms: { r: { floor: key } } }] });
  const res = parseLayout(old);
  assert.equal(res.ok, true);
  assert.equal(res.layout.levels[0].pieces[0].colors.upholstery, `lib:${key}`);
  assert.deepEqual(res.layout.levels[0].rooms, { r: { floor: `lib:${key}` } });
  assert.equal(res.warnings.filter((w) => w.includes(`lib:${key}`)).length, 2, res.warnings.join(' | '));
  const again = parseLayout(serializeLayout(res.layout));
  assert.equal(again.ok, true);
  assert.deepEqual(again.warnings, [], 'the new form raises no warning');
  assert.deepEqual(again.layout, res.layout);
});

test('a room colour in a file may not use furniture kit materials', () => {
  const text = JSON.stringify({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [], rooms: { r: { wall: 'f:wood', floor: 'lib:' + MATERIAL_KEYS[0] } } }] });
  const res = parseLayout(text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.layout.levels[0].rooms, { r: { floor: `lib:${MATERIAL_KEYS[0]}` } });
  assert.ok(res.warnings.some((w) => /wall colour is not valid/.test(w)));
});
