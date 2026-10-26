// The floor buttons of the control bar: a group after the example plans in the tools row, one button per level and a last one for all of them, the choice on show pressed,
// the words in both languages, a tap calls back with the key, nothing for a plan with one level, and the group stays on the bar while editing. Against the tiny DOM stub of
// ui.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/app/ui.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id && !n.removed) ?? null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const noop = { onPreset() {}, onTime() {}, onQuality() {}, onLang() {} };
const base = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true, plan: 'duplex-1' };
const duplexLevels = [{ id: 'L0', name: 'Ground floor' }, { id: 'L1', name: 'Upper floor' }];
const rowOf = (ui) => every(ui.root).find((n) => n.className === 'floors');
const live = (row) => row.children.filter((b) => !b.removed);

test('two levels: three buttons after the example plans, the last one pressed, each with a name and a long label', () => {
  const doc = makeDoc(), ui = createUI(noop, { ...base, levels: duplexLevels, floor: 'all' }, doc);
  const row = rowOf(ui), tools = every(ui.root).find((n) => n.className === 'tools');
  assert.ok(row); assert.equal(row.attrs.role, 'group'); assert.equal(row.attrs['aria-label'], 'Floors on show');
  assert.equal(tools.children.indexOf(row), 1, 'right after the example plans, before every other tool');
  const buttons = live(row);
  assert.deepEqual(buttons.map((b) => b.dataset.floor), ['0', '1', 'all']);
  assert.deepEqual(buttons.map((b) => b.className), ['tool floor', 'tool floor', 'tool floor']);
  assert.deepEqual(buttons.map((b) => b.textContent), ['Ground floor', 'Upper floor', 'Both']);
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'true']);
  for (const b of buttons) { assert.equal(b.type, 'button'); assert.ok(b.title.length > 10); assert.equal(b.attrs['aria-label'], b.title); }
  assert.notEqual(row.style.display, 'none');
  assert.equal(ui.root.className, 'has-tools', 'the bar itself is as it was');
});

test('the pressed button follows the choice, a tap calls back with the key', () => {
  const doc = makeDoc(), calls = [];
  const ui = createUI({ ...noop, onFloor: (k) => calls.push(k) }, { ...base, levels: duplexLevels, floor: 'all' }, doc);
  const buttons = live(rowOf(ui));
  buttons[0].listeners.click(); buttons[1].listeners.click(); buttons[2].listeners.click();
  assert.deepEqual(calls, [0, 1, 'all']);
  ui.update({ floor: 0 }); assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['true', 'false', 'false']);
  ui.update({ floor: 1 }); assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  ui.update({ floor: 'all' }); assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'true']);
  assert.equal(live(rowOf(ui)).length, 3, 'the same buttons, not new ones, for the same plan');
  assert.doesNotThrow(() => createUI(noop, { ...base, levels: duplexLevels }, makeDoc()).update({ floor: 1 }), 'a page without the handler');
});

test('Polish words: Parter, Piętro, Oba; a name the page does not know stays; no long dashes', () => {
  const doc = makeDoc(), ui = createUI(noop, { ...base, lang: 'pl', levels: duplexLevels, floor: 'all' }, doc);
  const row = rowOf(ui), buttons = live(row);
  assert.deepEqual(buttons.map((b) => b.textContent), ['Parter', 'Piętro', 'Oba']);
  assert.equal(row.attrs['aria-label'], 'Widoczne piętra');
  assert.match(buttons[0].title, /Parter/); assert.match(buttons[2].title, /oba piętra/);
  ui.update({ lang: 'en' }); assert.deepEqual(buttons.map((b) => b.textContent), ['Ground floor', 'Upper floor', 'Both']);
  ui.update({ levels: [{ id: 'a', name: 'Garage' }, { id: 'b', name: 'Upper floor' }], lang: 'pl' });
  assert.deepEqual(live(row).map((b) => b.textContent), ['Garage', 'Piętro', 'Oba']);
  for (const b of live(row)) assert.ok(!/[–—]/.test(`${b.textContent}${b.title}`));
});

test('one level, none or no list: the group is empty and hidden', () => {
  for (const levels of [undefined, [], [{ id: 'L0', name: 'Ground floor' }]]) {
    const ui = createUI(noop, { ...base, plan: 'flat-1', levels, floor: 'all' }, makeDoc()), row = rowOf(ui);
    assert.equal(live(row).length, 0, JSON.stringify(levels)); assert.equal(row.style.display, 'none');
  }
});

test('a new plan with other levels rebuilds the buttons: three levels end with All, and one level takes them away', () => {
  const doc = makeDoc(), ui = createUI(noop, { ...base, levels: duplexLevels, floor: 1 }, doc), row = rowOf(ui);
  const old = [...live(row)];
  ui.update({ levels: [{ id: 'B', name: 'Basement' }, { id: 'G', name: 'Ground floor' }, { id: 'F', name: 'First floor' }], floor: 'all' });
  assert.ok(old.every((b) => b.removed), 'the old buttons are gone');
  assert.deepEqual(live(row).map((b) => b.textContent), ['Basement', 'Ground floor', 'First floor', 'All']);
  assert.deepEqual(live(row).map((b) => b.dataset.floor), ['0', '1', '2', 'all']);
  assert.deepEqual(live(row).map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false', 'true']);
  ui.update({ lang: 'pl' }); assert.deepEqual(live(row).map((b) => b.textContent), ['Piwnica', 'Parter', 'Piętro', 'Wszystkie']);
  ui.update({ levels: [{ id: 'L0', name: 'Ground floor' }], floor: 'all' });
  assert.equal(live(row).length, 0); assert.equal(row.style.display, 'none');
  ui.update({ levels: duplexLevels });
  assert.equal(live(row).length, 3); assert.notEqual(row.style.display, 'none');
});

test('the group stays on the bar while editing and goes with btn=0', () => {
  const doc = makeDoc(), ui = createUI(noop, { ...base, levels: duplexLevels, floor: 0 }, doc), row = rowOf(ui), tools = every(ui.root).find((n) => n.className === 'tools');
  ui.update({ editing: true });
  assert.notEqual(row.style.display, 'none', 'the floors can be changed in the editor');
  assert.equal(live(row).length, 3); assert.equal(live(row)[0].attrs['aria-pressed'], 'true');
  const plans = every(ui.root).find((n) => n.className === 'plans');
  assert.equal(plans.style.display, 'none', 'while the example plans leave');
  ui.update({ editing: false, tools: false });
  assert.equal(tools.style.display, 'none', 'btn=0 hides the whole row, the floors included');
});
