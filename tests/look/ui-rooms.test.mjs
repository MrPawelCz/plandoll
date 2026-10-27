// The Rooms button of the tools row (it opens and closes the list of rooms, dock.js): where it stands, its words in both languages, its pressed state, and that it
// leaves the bar while editing. Against the tiny DOM stub of ui-shell.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/app/ui.js';
import { parseParams } from '../../src/app/params.js';
import { INFO_TEXT } from '../../src/app/info.js';

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id) ?? null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const toolButtons = (ui) => every(ui.root).filter((n) => n.className === 'tool');
const base = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true };
const handlers = (extra = {}) => ({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, ...extra });

test('rooms=1 in the address opens the list, and the list is closed without it', () => {
  assert.equal(parseParams('').rooms, false);
  assert.equal(parseParams('#rooms=1').rooms, true);
  for (const h of ['#rooms=0', '#rooms=', '#rooms=true', '#rooms=2']) assert.equal(parseParams(h).rooms, false, h);
  assert.equal(parseParams('#rooms=1&edit=1').rooms, true);
});

test('the Rooms button stands after the shell button and before Edit, says what it does in both languages, and calls the page', () => {
  const doc = makeDoc(); let calls = 0;
  const ui = createUI(handlers({ onRooms: () => { calls++; } }), { ...base, shell: true }, doc), buttons = toolButtons(ui);
  assert.deepEqual(buttons.map((b) => b.dataset.tool).slice(0, 3), ['shell', 'rooms', 'edit']);
  const rooms = buttons[1];
  assert.equal(rooms.type, 'button');
  assert.equal(rooms.textContent, 'Rooms');
  assert.equal(rooms.title, INFO_TEXT.en.roomsTitle);
  assert.equal(rooms.attrs['aria-label'], INFO_TEXT.en.roomsTitle);
  rooms.listeners.click();
  assert.equal(calls, 1);
  ui.update({ lang: 'pl' });
  assert.equal(rooms.textContent, 'Pokoje');
  assert.equal(rooms.title, INFO_TEXT.pl.roomsTitle);
  assert.ok(!`${rooms.textContent}${rooms.title}${rooms.attrs['aria-label']}`.match(LONG_DASH), 'no long dashes in the words of the button');
});

test('the button is pressed while the list is open, and a bar without the handler does not fail when it is pressed', () => {
  const doc = makeDoc();
  const ui = createUI(handlers(), { ...base }, doc), rooms = toolButtons(ui).find((b) => b.dataset.tool === 'rooms');
  assert.equal(rooms.attrs['aria-pressed'], 'false');
  ui.update({ rooms: true }); assert.equal(rooms.attrs['aria-pressed'], 'true');
  ui.update({ rooms: false }); assert.equal(rooms.attrs['aria-pressed'], 'false');
  assert.doesNotThrow(() => rooms.listeners.click());
  const open = createUI(handlers(), { ...base, rooms: true }, makeDoc());
  assert.equal(toolButtons(open).find((b) => b.dataset.tool === 'rooms').attrs['aria-pressed'], 'true', 'rooms=1 starts pressed');
});

test('while editing the button leaves the bar (the list belongs to the plain page), and comes back with the plain page', () => {
  const doc = makeDoc();
  const ui = createUI(handlers(), { ...base, editing: true }, doc), rooms = toolButtons(ui).find((b) => b.dataset.tool === 'rooms');
  assert.equal(rooms.style.display, 'none');
  ui.update({ editing: false });
  assert.equal(rooms.style.display, '');
});
