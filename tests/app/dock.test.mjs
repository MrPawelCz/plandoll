// The dock (dock.js): the card of a tapped piece and the list of rooms, against a small DOM stub (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { createDock, DOCK_STYLE_ID } from '../../src/app/dock.js';
import { pieceInfo, roomsData, INFO_TEXT } from '../../src/app/info.js';

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function makeDoc() {
  const doc = { activeElement: null };
  const mk = (tag) => ({
    tag, children: [], parent: null, style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', title: '', hidden: false, type: '',
    get firstChild() { return this.children[0] ?? null; },
    appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; },
    remove() { this.parent?.removeChild(this); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(e, f) { (this.listeners[e] ??= []).push(f); },
    click() { for (const f of this.listeners.click ?? []) f({ type: 'click', target: this, preventDefault() {} }); },
  });
  Object.assign(doc, { head: mk('head'), body: mk('body'), createElement: mk });
  doc.getElementById = (id) => all(doc.head).concat(all(doc.body)).find((n) => n.id === id) ?? null;
  return doc;
}
const all = (n) => [n, ...n.children.flatMap(all)];
const cls = (name) => (n) => n.className === name;
const find = (n, name) => all(n).find(cls(name));
const findAll = (n, name) => all(n).filter(cls(name));
const strings = (n) => all(n).flatMap((x) => [x.textContent, x.title, x.attrs['aria-label']]).filter(Boolean);

const plan = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const modelOf2 = (name) => { const p = plan(name); for (const lv of p.levels) lv.furniture = []; return buildModel(modelOf(analyzePlan(p))); };
const sofa = (model) => pieceInfo({ id: 's1', type: 'sofa2', room: 'living', size: [1.6, 0.9, 0.85] }, 'L0', model);

function setup(lang = 'en', handlers = {}) {
  const doc = makeDoc(), calls = [];
  const dock = createDock({ doc, host: doc.body, lang, onCardClose: () => calls.push(['card']), onRoomsClose: () => calls.push(['rooms']), onRoomPick: (r) => calls.push(['pick', r]), ...handlers });
  return { doc, dock, calls, root: dock.element, card: find(dock.element, 'psd-card'), rooms: find(dock.element, 'psd-rooms') };
}

test('the dock is added to the page once with its style, and both parts start hidden', () => {
  const { doc, dock, card, rooms } = setup();
  assert.equal(dock.element.parent, doc.body);
  assert.equal(card.hidden, true);
  assert.equal(rooms.hidden, true);
  assert.equal(dock.cardOpen, false);
  assert.equal(dock.roomsOpen, false);
  createDock({ doc, host: doc.body });
  assert.equal(all(doc.head).filter((n) => n.id === DOCK_STYLE_ID).length, 1, 'a second dock does not add the style again');
  const css = doc.getElementById(DOCK_STYLE_ID).textContent;
  assert.match(css, /\.psd-card\{flex:none;order:-1/, 'on a narrow window the card stands above the list');
  assert.match(css, /\.psd-rooms\{display:flex;flex:0 1 auto;[^}]*min-height:0/, 'and the list shrinks to end above the bars');
  assert.match(css, /max-height:calc\(100vh - var\(--ps-stack-h,0px\)[^;]*\);max-height:calc\(100dvh - var\(--ps-stack-h,0px\)/, 'the dock ends above the bars; dvh follows what a phone shows while its address bar comes and goes, vh stays for browsers without it');
  assert.match(css, /max-height:46vh;max-height:46dvh/);
  assert.match(css, /@media \(min-width:761px\)/);
  for (const v of ['--psd-top', '--psd-list-top', '--psd-card-top']) assert.match(css, new RegExp(`var\\(${v},\\d+px\\)`), `${v} moves the dock clear of the marks of a page that has its own`);
  assert.doesNotMatch(css, LONG_DASH);
});

test('the card shows the name, where the piece stands and its three sizes in millimetres, and opens and closes', () => {
  const { dock, card, calls } = setup('en');
  const model = modelOf2('flat-1');
  dock.showCard(sofa(model));
  assert.equal(card.hidden, false);
  assert.equal(dock.cardOpen, true);
  assert.equal(find(card, 'psd-title').textContent, 'Two-seat sofa');
  assert.equal(find(card, 'psd-where').textContent, 'Living room');
  const dims = findAll(card, 'psd-dim');
  assert.deepEqual(dims.map((d) => d.dataset.dim), ['w', 'd', 'h']);
  assert.deepEqual(dims.map((d) => d.children.map((c) => c.textContent)), [['width', '1600'], ['depth', '900'], ['height', '850']]);
  assert.equal(find(card, 'psd-unit').textContent, 'mm');
  assert.match(card.attrs['aria-label'], /Two-seat sofa, Living room: width 1600, depth 900, height 850 mm/);
  assert.equal(card.attrs.role, 'dialog');
  assert.equal(card.attrs['aria-modal'], 'false');
  assert.equal(card.attrs['aria-live'], 'polite');
  const close = find(card, 'psd-close');
  assert.equal(close.type, 'button');
  assert.equal(close.attrs['aria-label'], 'Close the card');
  close.click();
  assert.deepEqual(calls, [['card']], 'the close button tells the page; the page takes the card away');
  assert.equal(card.hidden, false, 'the dock never closes the card by itself');
  dock.hideCard();
  assert.equal(card.hidden, true);
  assert.equal(dock.cardOpen, false);
});

test('a second piece replaces the card, and a change of language redraws it in place', () => {
  const { dock, card } = setup('en');
  const model = modelOf2('flat-1');
  dock.showCard(sofa(model));
  dock.showCard(pieceInfo({ id: 'w1', type: 'wardrobe', room: 'bedroom', size: [1.8, 0.6, 2.2] }, 'L0', model));
  assert.equal(findAll(card, 'psd-dim').length, 3, 'no sizes are left over from the first piece');
  assert.equal(find(card, 'psd-title').textContent, 'Wardrobe');
  assert.equal(find(card, 'psd-where').textContent, 'Bedroom');
  dock.setLang('pl');
  assert.equal(find(card, 'psd-title').textContent, 'Szafa');
  assert.deepEqual(findAll(card, 'psd-dim').map((d) => d.children[0].textContent), ['szer.', 'głęb.', 'wys.']);
  assert.equal(find(card, 'psd-close').attrs['aria-label'], 'Zamknij kartę');
  assert.deepEqual(findAll(card, 'psd-dim').map((d) => d.children[1].textContent), ['1800', '600', '2200']);
});

test('a card with no room to name leaves the line out', () => {
  const { dock, card } = setup();
  dock.showCard(pieceInfo({ id: 'x', type: 'rug', room: 'nowhere', size: [2.4, 1.7, 0.015] }, 'L0', modelOf2('flat-1')));
  assert.equal(find(card, 'psd-where').hidden, true);
  assert.deepEqual(findAll(card, 'psd-dim').map((d) => d.children[1].textContent), ['2400', '1700', '15']);
});

test('the list shows every room with its area, the total stays under the rows, and the list opens and closes', () => {
  const { dock, rooms, calls } = setup('en');
  dock.setRooms(roomsData(modelOf2('flat-1')));
  dock.setRoomsOpen(true);
  assert.equal(rooms.hidden, false);
  assert.equal(dock.roomsOpen, true);
  const rows = findAll(rooms, 'psd-row');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.textContent)), [['Living room', '13.4 m²'], ['Bedroom', '7.8 m²'], ['Hall', '5 m²'], ['Bathroom', '5.2 m²'], ['Study', '10.6 m²']]);
  assert.equal(rows[0].attrs['aria-label'], 'Living room, 13.4 m²');
  assert.equal(rows[0].type, 'button');
  assert.equal(findAll(rooms, 'psd-group-head').length, 0, 'one floor: no heading');
  const total = find(rooms, 'psd-total');
  assert.equal(total.hidden, false);
  assert.deepEqual(total.children.map((c) => c.textContent), ['Total', '42 m²']);
  assert.equal(find(rooms, 'psd-rooms-title').textContent, 'Rooms');
  assert.equal(find(rooms, 'psd-notes').hidden, true);
  find(rooms, 'psd-close').click();
  assert.deepEqual(calls, [['rooms']]);
  dock.setRoomsOpen(false);
  assert.equal(rooms.hidden, true);
});

test('a plan with two floors gets a heading with its own total over each floor, and a balcony and an estimate get their notes', () => {
  const { dock, rooms } = setup('pl');
  dock.setRooms(roomsData(modelOf2('duplex-1')));
  const heads = findAll(rooms, 'psd-group-head');
  assert.deepEqual(heads.map((h) => h.children.map((c) => c.textContent)), [['Parter', '51,3 m²'], ['Piętro', '51,3 m²']]);
  assert.equal(findAll(rooms, 'psd-row').length, 8);
  assert.deepEqual(find(rooms, 'psd-total').children.map((c) => c.textContent), ['Razem', '102,6 m²']);
  const p = plan('flat-1'); for (const lv of p.levels) lv.furniture = [];
  for (const r of p.levels[0].rooms) { if (r.id === 'living') r.area = 30; if (r.id === 'hall') r.use = 'balcony'; }
  dock.setRooms(roomsData(buildModel(modelOf(analyzePlan(p)))));
  assert.deepEqual(findAll(rooms, 'psd-note').map((n) => n.textContent), [INFO_TEXT.pl.estimate, INFO_TEXT.pl.balcony]);
  assert.equal(findAll(rooms, 'psd-row').filter((r) => r.dataset.balcony === '1').length, 1);
  assert.match(findAll(rooms, 'psd-row')[0].children[1].textContent, /^~13,[34] m²$/);
});

test('a row picks its room, a second press on the same row lets go, and the page is told each time', () => {
  const { dock, rooms, calls } = setup();
  dock.setRooms(roomsData(modelOf2('duplex-1')));
  const rows = findAll(rooms, 'psd-row');
  rows[3].click();
  assert.deepEqual(calls.pop(), ['pick', { level: 'L0', id: 'living' }]);
  assert.deepEqual(dock.picked, { level: 'L0', id: 'living' });
  assert.deepEqual(rows.map((r) => r.attrs['aria-pressed']), ['false', 'false', 'false', 'true', 'false', 'false', 'false', 'false']);
  assert.equal(rows[3].title, INFO_TEXT.en.unpickRoom);
  assert.equal(rows[0].title, INFO_TEXT.en.pickRoom);
  rows[6].click();
  assert.deepEqual(calls.pop(), ['pick', { level: 'L1', id: 'bed1' }]);
  assert.equal(rows[3].attrs['aria-pressed'], 'false', 'one room at a time');
  rows[6].click();
  assert.deepEqual(calls.pop(), ['pick', null]);
  assert.equal(dock.picked, null);
  assert.ok(rows.every((r) => r.attrs['aria-pressed'] === 'false'));
});

test('the page can let go of the picked room, and a picked room that leaves the list (another floor on show) is let go of', () => {
  const { dock, rooms } = setup();
  const model = modelOf2('duplex-1');
  dock.setRooms(roomsData(model));
  findAll(rooms, 'psd-row')[6].click();
  dock.setPickedRoom(null);
  assert.equal(dock.picked, null);
  assert.ok(findAll(rooms, 'psd-row').every((r) => r.attrs['aria-pressed'] === 'false'));
  dock.setPickedRoom({ level: 'L1', id: 'bed1' });
  assert.equal(findAll(rooms, 'psd-row')[6].attrs['aria-pressed'], 'true');
  dock.setRooms(roomsData(model, [true, false]));
  assert.equal(dock.picked, null, 'the upper floor is off: its room is gone from the list');
  assert.equal(findAll(rooms, 'psd-row').length, 4);
  dock.setRooms(roomsData(model));
  assert.equal(findAll(rooms, 'psd-row').length, 8);
  dock.setPickedRoom({ level: 'L0', id: 'living' });
  dock.setRooms(roomsData(model));
  assert.deepEqual(dock.picked, { level: 'L0', id: 'living' }, 'a room that is still there stays picked');
});

test('a list with no rooms says so and shows no total; no data at all hides the total and the notes', () => {
  const { dock, rooms } = setup('en');
  dock.setRooms(roomsData({ levels: [{ id: 'L0', name: 'Flat', rooms: [], walls: [] }] }));
  assert.equal(find(rooms, 'psd-empty').textContent, INFO_TEXT.en.empty);
  assert.equal(find(rooms, 'psd-total').hidden, true);
  dock.setRooms(roomsData({ levels: [{ id: 'L0', name: 'Ground floor', rooms: [{ id: 'a', name: 'Hall', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], area: 12, declaredArea: 12 }], walls: [] }, { id: 'L1', name: 'Roof', rooms: [], walls: [] }] }, [false, true]));
  assert.equal(find(rooms, 'psd-empty').textContent, INFO_TEXT.en.emptyFloor, 'one floor on show and it has no rooms: the words are for the floor');
  dock.setRooms(null);
  assert.equal(findAll(rooms, 'psd-row').length, 0);
  assert.equal(find(rooms, 'psd-total').hidden, true);
  assert.equal(find(rooms, 'psd-notes').hidden, true);
});

test('the language of the page redraws the list in place and keeps the pressed row', () => {
  const { dock, rooms } = setup('en');
  dock.setRooms(roomsData(modelOf2('flat-1')));
  findAll(rooms, 'psd-row')[1].click();
  dock.setLang('pl');
  assert.equal(find(rooms, 'psd-rooms-title').textContent, 'Pokoje');
  assert.deepEqual(find(rooms, 'psd-total').children.map((c) => c.textContent), ['Razem', '42 m²']);
  assert.equal(findAll(rooms, 'psd-row')[1].children[1].textContent, '7,8 m²');
  assert.equal(findAll(rooms, 'psd-row')[1].attrs['aria-pressed'], 'true');
  assert.equal(find(rooms, 'psd-close').attrs['aria-label'], INFO_TEXT.pl.closeRooms);
});

test('everything the dock writes is free of long dashes, in both languages, and the close buttons are real buttons with a name', () => {
  for (const lang of ['en', 'pl']) {
    const { dock, root } = setup(lang);
    dock.showCard(sofa(modelOf2('flat-1')));
    dock.setRooms(roomsData(modelOf2('duplex-1')));
    dock.setRoomsOpen(true);
    for (const s of strings(root)) assert.doesNotMatch(s, LONG_DASH, s);
    for (const b of findAll(root, 'psd-close')) { assert.equal(b.type, 'button'); assert.ok(b.attrs['aria-label'].length > 2); }
  }
});

test('dispose takes the dock off the page', () => {
  const { doc, dock } = setup();
  dock.dispose();
  assert.equal(doc.body.children.includes(dock.element), false);
});
