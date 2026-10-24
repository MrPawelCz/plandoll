// Room types from names (Polish and English, with and without diacritics, any case, numbers) and from geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { roomType, roomTypeFromName, roomZones, normalizeName, ROOM_TYPES, OTHER } from '../../src/layout/rooms.js';

const NAMES = [
  ['Salon', 'living'], ['salon', 'living'], ['SALON', 'living'], ['Pokój dzienny', 'living'], ['pokoj dzienny', 'living'], ['Living room', 'living'], ['Lounge', 'living'],
  ['Living / Dining', 'living'], ['Salon z aneksem kuchennym', 'living'], ['Studio', 'living'],
  ['Kuchnia', 'kitchen'], ['KUCHNIA 2', 'kitchen'], ['Aneks kuchenny', 'kitchen'], ['Kitchen', 'kitchen'], ['Kitchenette', 'kitchen'],
  ['Sypialnia', 'bedroom'], ['Sypialnia 1', 'bedroom'], ['Bedroom 2', 'bedroom'], ['Master bedroom', 'bedroom'], ['Guest room', 'bedroom'],
  ['Pokój dziecka', 'kids'], ['Pokoj dzieciecy', 'kids'], ['Kids room', 'kids'], ['Nursery', 'kids'],
  ['Łazienka', 'bath'], ['LAZIENKA 2', 'bath'], ['Bathroom', 'bath'], ['Łazienka z WC', 'bath'], ['Ensuite', 'bath'],
  ['WC', 'wc'], ['wc 2', 'wc'], ['Toaleta', 'wc'], ['Toilet', 'wc'], ['Ubikacja', 'wc'],
  ['Przedpokój', 'hall'], ['Przedpokoj', 'hall'], ['Korytarz', 'hall'], ['Hol', 'hall'], ['Hall', 'hall'], ['Entry', 'hall'], ['Landing', 'hall'], ['Corridor', 'hall'],
  ['Gabinet', 'office'], ['Biuro', 'office'], ['Office', 'office'], ['Study', 'office'], ['Home office', 'office'],
  ['Jadalnia', 'dining'], ['Dining room', 'dining'], ['Dining', 'dining'],
  ['Spiżarnia', 'storage'], ['Schowek', 'storage'], ['Garderoba', 'storage'], ['Storage', 'storage'], ['Closet', 'storage'],
  ['Pralnia', 'utility'], ['Utility', 'utility'], ['Laundry', 'utility'],
  ['Balkon', 'balcony'], ['Taras', 'balcony'], ['Balcony', 'balcony'], ['Terrace', 'balcony'], ['Loggia', 'balcony'],
];

test('at least forty names map to the expected type', () => {
  assert.ok(NAMES.length >= 40);
  for (const [name, want] of NAMES) {
    assert.equal(roomTypeFromName(name), want, `${name} -> ${roomTypeFromName(name)}, expected ${want}`);
    assert.ok(ROOM_TYPES.includes(want));
  }
});

test('names that say nothing give no type, hostile names do not throw', () => {
  for (const n of ['', '   ', 'Pokój', 'Room 3', 'xyz', undefined, null, 42, {}, 'a'.repeat(100000), '\u0000‮']) assert.equal(roomTypeFromName(n), null);
  assert.equal(normalizeName('Łódź Żółć'), 'lodz zolc');
});

test('a living room named after a kitchen too gets a second zone', () => {
  const model = { levels: [{ rooms: [], openings: [], wallById: new Map(), walls: [] }] };
  const room = { id: 'r', name: 'Salon z aneksem kuchennym', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] };
  model.levels[0].rooms.push(room);
  assert.deepEqual(roomZones(room, model), ['living', 'kitchen']);
});

function stripped() {
  const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
  for (const lv of plan.levels) for (const r of lv.rooms) { delete r.name; delete r.use; }
  const res = analyzePlan(plan);
  assert.ok(res.ok, JSON.stringify(res.errors?.slice(0, 2)));
  return buildModel(modelOf(res));
}

test('geometry: with no names and no use, the biggest lit room is the living room and a dark small room is a bathroom', () => {
  const model = stripped();
  const lv = model.levels[0];
  const types = Object.fromEntries(lv.rooms.map((r) => [r.id, roomType(r, model)]));
  const biggest = lv.rooms.slice().sort((a, b) => b.area - a.area)[0];
  assert.equal(roomType(biggest, model), 'living', JSON.stringify(types));
  for (const t of Object.values(types)) assert.ok(ROOM_TYPES.includes(t) || t === OTHER);
  assert.ok(Object.values(types).includes('bath') || Object.values(types).includes('wc') || Object.values(types).includes('hall'), JSON.stringify(types));
});

test('use is honoured when the name says nothing', () => {
  const model = { levels: [{ rooms: [], openings: [], wallById: new Map(), walls: [] }] };
  const rooms = [{ id: 'a', name: 'Room 4', use: 'bedroom', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }, { id: 'b', name: '', use: 'bathroom', polygon: [[3, 0], [5, 0], [5, 2], [3, 2]] }];
  model.levels[0].rooms.push(...rooms);
  assert.equal(roomType(rooms[0], model), 'bedroom');
  assert.equal(roomType(rooms[1], model), 'bath');
});
