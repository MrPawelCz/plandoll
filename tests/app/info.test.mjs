// The card of a tapped piece and the list of rooms (info.js): neutral data first, then the words in both languages. Pure logic, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { specOf } from '../../src/furniture/specs.js';
import { pieceInfo, cardView, roomsData, roomsView, INFO_TEXT } from '../../src/app/info.js';

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const plan = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
function build(name, edit) {
  const p = plan(name);
  for (const lv of p.levels) lv.furniture = [];
  edit?.(p);
  const model = buildModel(modelOf(analyzePlan(p)));
  return { model, layout: autoFurnish(model, { seed: 1, allowedTypes: piecesImplemented() }) };
}
const pieces = (layout) => layout.levels.flatMap((lc) => lc.pieces.map((p) => ({ p, level: lc.id })));
const sofa = (layout) => pieces(layout).find((x) => x.p.type.startsWith('sofa'));
const eachString = (o, fn) => { for (const v of Object.values(o)) if (typeof v === 'string') fn(v); else if (v && typeof v === 'object') eachString(v, fn); };

test('both languages carry every word, and none of them has a long dash', () => {
  assert.deepEqual(Object.keys(INFO_TEXT.en).sort(), Object.keys(INFO_TEXT.pl).sort());
  assert.deepEqual(Object.keys(INFO_TEXT.en.dims), ['w', 'd', 'h']);
  assert.deepEqual(Object.keys(INFO_TEXT.pl.dims), ['w', 'd', 'h']);
  for (const lang of ['en', 'pl']) eachString(INFO_TEXT[lang], (s) => { assert.ok(s.length > 0); assert.doesNotMatch(s, LONG_DASH, s); });
});

test('pieceInfo: the size in whole millimetres, the room and the floor it stands in', () => {
  const { model, layout } = build('flat-1'), { p, level } = sofa(layout);
  const info = pieceInfo(p, level, model);
  assert.deepEqual(info.mm, p.size.map((v) => Math.round(v * 1000)));
  assert.ok(info.mm.every(Number.isInteger));
  assert.deepEqual(info.size, p.size);
  assert.notEqual(info.size, p.size, 'a copy: the card does not hold the layout\'s own array');
  assert.equal(info.type, p.type);
  assert.equal(info.room, model.levels[0].rooms.find((r) => r.id === p.room).name);
  assert.deepEqual(info.level, { id: 'L0', name: 'Flat', index: 0 });
  assert.equal(info.levels, 1);
});

test('pieceInfo: something that is not a piece with a size gives null, and an unknown room or floor just leaves the line out', () => {
  const { model, layout } = build('flat-1'), { p, level } = sofa(layout);
  for (const bad of [null, undefined, {}, { size: [1, 1] }, { size: [1, 1, NaN] }, { size: 'x' }]) assert.equal(pieceInfo(bad, level, model), null);
  const lost = pieceInfo({ ...p, room: 'nowhere' }, 'nowhere', model);
  assert.equal(lost.room, null);
  assert.equal(lost.level, null);
  assert.equal(cardView(lost, 'en').where, '');
});

test('cardView: the name from the catalogue in the language of the page, width depth height, and the whole card in one line for a screen reader', () => {
  const { model, layout } = build('flat-1'), { p, level } = sofa(layout), info = pieceInfo(p, level, model), spec = specOf(p.type);
  const en = cardView(info, 'en'), pl = cardView(info, 'pl');
  assert.equal(en.title, spec.label.en);
  assert.equal(pl.title, spec.label.pl);
  assert.deepEqual(en.dims.map((d) => d.key), ['w', 'd', 'h']);
  assert.deepEqual(en.dims.map((d) => d.label), ['width', 'depth', 'height']);
  assert.deepEqual(pl.dims.map((d) => d.label), ['szer.', 'głęb.', 'wys.']);
  assert.deepEqual(en.dims.map((d) => d.value), info.mm.map(String));
  assert.equal(en.unit, 'mm');
  assert.equal(en.where, info.room, 'one floor: the room only');
  assert.ok(en.text.includes(spec.label.en) && en.text.includes(`depth ${info.mm[1]}`) && en.text.endsWith('mm'), en.text);
  assert.ok(pl.text.includes(`wys. ${info.mm[2]}`), pl.text);
  for (const v of [en, pl]) assert.doesNotMatch(JSON.stringify(v), LONG_DASH);
});

test('cardView: on a plan with two floors the card names the floor too, in the words of the floor buttons', () => {
  const { model, layout } = build('duplex-1'), up = pieces(layout).find((x) => x.level === 'L1'), down = pieces(layout).find((x) => x.level === 'L0');
  assert.match(cardView(pieceInfo(up.p, up.level, model), 'en').where, /, Upper floor$/);
  assert.match(cardView(pieceInfo(up.p, up.level, model), 'pl').where, /, Piętro$/);
  assert.match(cardView(pieceInfo(down.p, down.level, model), 'pl').where, /, Parter$/);
});

test('cardView: a type the catalogue does not know is named by its id, and a card is never empty', () => {
  const { model } = build('flat-1');
  const v = cardView(pieceInfo({ id: 'x', type: 'mystery-box', room: 'living', size: [0.5, 0.4, 0.3] }, 'L0', model), 'pl');
  assert.equal(v.title, 'mystery-box');
  assert.deepEqual(v.dims.map((d) => d.value), ['500', '400', '300']);
});

test('roomsData: every room of the plan with its area, and the total (the example flat adds up to 42 m2, all of it declared)', () => {
  const { model } = build('flat-1'), d = roomsData(model);
  assert.equal(d.groups.length, 1);
  assert.equal(d.rooms, 5);
  assert.deepEqual(d.groups[0].rooms.map((r) => r.id), ['living', 'bedroom', 'hall', 'bath', 'study']);
  assert.deepEqual(d.groups[0].rooms.map((r) => r.m2), [13.4, 7.8, 5, 5.2, 10.6]);
  assert.ok(Math.abs(d.m2 - 42) < 1e-9);
  assert.equal(d.estimated, false);
  assert.equal(d.balconies, 0);
  assert.equal(d.groups[0].rooms[0].name, 'Living room');
});

test('roomsData: a plan with two floors has a group for each, and only the floors on show are listed', () => {
  const { model } = build('duplex-1');
  const all = roomsData(model);
  assert.deepEqual(all.groups.map((g) => g.level.id), ['L0', 'L1']);
  assert.equal(all.levels, 2);
  assert.ok(Math.abs(all.m2 - 102.6) < 1e-9);
  const up = roomsData(model, [false, true]);
  assert.deepEqual(up.groups.map((g) => g.level.id), ['L1']);
  assert.ok(Math.abs(up.m2 - (3.6 + 11.9 + 17.9 + 17.9)) < 1e-9);
  assert.equal(up.levels, 2, 'the plan still has two floors, so the heading stays');
  assert.deepEqual(roomsData(model, [false, false]).groups, []);
});

test('roomsData: an area that the drawing contradicts is worked out from the drawing and marked, in the room and in the total', () => {
  const { model } = build('flat-1', (p) => { for (const r of p.levels[0].rooms) if (r.id === 'living') r.area = 30; });
  const d = roomsData(model), living = d.groups[0].rooms[0];
  assert.equal(living.estimated, true);
  assert.ok(Math.abs(living.m2 - 13.36) < 0.05, `${living.m2}`);
  assert.equal(d.groups[0].rooms[1].estimated, false);
  assert.equal(d.estimated, true);
  assert.ok(d.m2 < 45 && d.m2 > 41, `the total adds the drawn area, not the declared 30: ${d.m2}`);
});

test('roomsData: a balcony is listed but left out of the total, and a plan with no rooms gives an empty list', () => {
  const { model } = build('flat-1', (p) => { for (const r of p.levels[0].rooms) if (r.id === 'hall') r.use = 'balcony'; });
  const d = roomsData(model);
  assert.equal(d.groups[0].rooms.length, 5, 'still listed');
  assert.equal(d.groups[0].rooms[2].balcony, true);
  assert.equal(d.balconies, 1);
  assert.ok(Math.abs(d.m2 - 37) < 1e-9, `42 without the 5 of the hall: ${d.m2}`);
  const none = roomsData({ levels: [{ id: 'L0', name: 'Flat', rooms: [], walls: [] }] });
  assert.equal(none.rooms, 0);
  assert.deepEqual(none.groups, []);
  assert.equal(roomsView(none, 'en').empty, true);
  assert.equal(roomsView(none, 'en').total, '');
  assert.equal(roomsView(none, 'en').emptyText, INFO_TEXT.en.empty, 'a plan with no rooms says so for the plan');
  assert.deepEqual(roomsData(null).groups, []);
});

test('roomsView: a floor with no rooms among floors that have some says so for the floor, not for the plan', () => {
  const two = { levels: [
    { id: 'L0', name: 'Ground floor', walls: [], rooms: [{ id: 'a', name: 'Hall', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], area: 12, declaredArea: 12 }] },
    { id: 'L1', name: 'Roof', walls: [], rooms: [] },
  ] };
  const roof = roomsData(two, [false, true]);
  assert.equal(roof.rooms, 0);
  assert.equal(roof.shown, 1);
  assert.equal(roof.levels, 2);
  assert.equal(roomsView(roof, 'en').empty, true);
  assert.equal(roomsView(roof, 'en').emptyText, INFO_TEXT.en.emptyFloor);
  assert.equal(roomsView(roof, 'pl').emptyText, INFO_TEXT.pl.emptyFloor);
  assert.equal(INFO_TEXT.pl.emptyFloor, 'Na tym piętrze nie ma pokoi.');
  const all = roomsData(two, null);
  assert.equal(all.shown, 2);
  assert.equal(roomsView(all, 'en').empty, false, 'both floors on show and one has rooms: the list is not empty');
  const bare = { levels: [{ id: 'L0', name: 'A', walls: [], rooms: [] }, { id: 'L1', name: 'B', walls: [], rooms: [] }] };
  assert.equal(roomsView(roomsData(bare, null), 'en').emptyText, INFO_TEXT.en.empty, 'every floor on show and none has rooms: no rooms in the plan');
  assert.equal(roomsView(roomsData(bare, [true, false]), 'en').emptyText, INFO_TEXT.en.emptyFloor);
});

test('roomsData: a room without a polygon, or with no area, is left out', () => {
  const m = { levels: [{ id: 'L0', name: 'Flat', walls: [], rooms: [{ id: 'a', name: 'No shape', polygon: [[0, 0], [1, 1]], area: 1 }, { id: 'b', name: 'Flat line', polygon: [[0, 0], [1, 0], [2, 0]], area: 0, declaredArea: 4 }] }] };
  assert.equal(roomsData(m).rooms, 0);
});

test('roomsView: the areas in the number format of the language, a heading per floor only when there are two or more, and the notes once', () => {
  const flat = roomsView(roomsData(build('flat-1').model), 'pl');
  assert.deepEqual(flat.groups[0].rooms.map((r) => r.area), ['13,4 m²', '7,8 m²', '5 m²', '5,2 m²', '10,6 m²']);
  assert.equal(flat.groups[0].title, '', 'one floor: no heading');
  assert.equal(flat.total, '42 m²');
  assert.deepEqual(flat.notes, []);
  const en = roomsView(roomsData(build('flat-1').model), 'en');
  assert.equal(en.groups[0].rooms[0].area, '13.4 m²');
  const duplex = roomsView(roomsData(build('duplex-1').model), 'pl');
  assert.deepEqual(duplex.groups.map((g) => g.title), ['Parter', 'Piętro']);
  assert.deepEqual(duplex.groups.map((g) => g.area), ['51,3 m²', '51,3 m²']); // 15.8 + 8.9 + 3.9 + 22.7 and 3.6 + 11.9 + 17.9 + 17.9
  assert.equal(duplex.total, '102,6 m²');
  assert.deepEqual(roomsView(roomsData(build('duplex-1').model), 'en').groups.map((g) => g.title), ['Ground floor', 'Upper floor']);
});

test('roomsView: an estimate gets a tilde and one note that explains it, a balcony one note that it is not in the total', () => {
  const { model } = build('flat-1', (p) => { for (const r of p.levels[0].rooms) { if (r.id === 'living') r.area = 30; if (r.id === 'hall') r.use = 'balcony'; } });
  const en = roomsView(roomsData(model), 'en'), pl = roomsView(roomsData(model), 'pl');
  assert.match(en.groups[0].rooms[0].area, /^~13\.[34] m²$/);
  assert.match(pl.groups[0].rooms[0].area, /^~13,[34] m²$/);
  assert.match(en.total, /^~/);
  assert.deepEqual(en.notes, [INFO_TEXT.en.estimate, INFO_TEXT.en.balcony]);
  assert.deepEqual(pl.notes, [INFO_TEXT.pl.estimate, INFO_TEXT.pl.balcony]);
  assert.equal(en.groups[0].rooms[2].balcony, true);
  for (const v of [en, pl]) assert.doesNotMatch(JSON.stringify(v), LONG_DASH);
});
