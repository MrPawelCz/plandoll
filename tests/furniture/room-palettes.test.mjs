// Palettes for walls and floors of a room: names in both languages, valid values, no repeats, no long dashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_PALETTES, roomPalette } from '../../src/furniture/palettes.js';
import { MATERIAL_KEYS } from '../../src/render/library.js';

const HEX = /^#[0-9a-f]{6}$/;
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

test('walls and floors have 8 to 12 distinct entries with valid values and names in both languages', () => {
  assert.deepEqual(Object.keys(ROOM_PALETTES).sort(), ['floor', 'wall']);
  for (const [kind, list] of Object.entries(ROOM_PALETTES)) {
    assert.ok(list.length >= 8 && list.length <= 12, `${kind}: ${list.length} entries`);
    assert.equal(new Set(list.map((e) => e.value)).size, list.length, `${kind}: repeated value`);
    assert.equal(new Set(list.map((e) => e.name.en)).size, list.length, `${kind}: repeated English name`);
    assert.equal(new Set(list.map((e) => e.name.pl)).size, list.length, `${kind}: repeated Polish name`);
    for (const e of list) {
      assert.ok(HEX.test(e.value) || (e.value.startsWith('lib:') && MATERIAL_KEYS.includes(e.value.slice(4))), `${kind}: value ${e.value}`);
      assert.match(e.swatch, HEX, `${kind}/${e.value}: swatch`);
      for (const n of [e.name.en, e.name.pl]) assert.ok(typeof n === 'string' && n.length > 0 && !LONG_DASH.test(n), `${kind}/${e.value}: name "${n}"`);
    }
  }
});

test('roomPalette gives names in one language as a copy, and null for an unknown kind', () => {
  const pl = roomPalette('wall', 'pl'), en = roomPalette('wall', 'en'), floor = roomPalette('floor', 'pl-PL');
  assert.equal(pl.length, ROOM_PALETTES.wall.length);
  assert.equal(pl[0].name, ROOM_PALETTES.wall[0].name.pl);
  assert.equal(en[0].name, ROOM_PALETTES.wall[0].name.en);
  assert.equal(floor[0].name, ROOM_PALETTES.floor[0].name.pl);
  assert.equal(roomPalette('wall').at(-1).name, ROOM_PALETTES.wall.at(-1).name.en, 'English by default');
  assert.equal(roomPalette('ceiling', 'en'), null);
  assert.equal(roomPalette('toString', 'en'), null);
  pl[0].value = '#000000'; pl.pop();
  assert.notEqual(roomPalette('wall', 'pl')[0].value, '#000000');
  assert.equal(roomPalette('wall', 'pl').length, ROOM_PALETTES.wall.length);
});

test('no floor value is also a wall value', () => {
  const walls = new Set(ROOM_PALETTES.wall.map((e) => e.value));
  for (const e of ROOM_PALETTES.floor) assert.ok(!walls.has(e.value), `${e.value} appears on both lists`);
});
