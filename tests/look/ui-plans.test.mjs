// The example plan buttons of the control bar: one per built-in plan, the one on show is pressed, a tap calls back with the plan name, the words are in both
// languages, none is pressed for a plan from a file, and the group leaves the bar while editing. Against the tiny DOM stub of ui.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/app/ui.js';
import { PLAN_NAMES } from '../../src/app/params.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id && !n.removed) ?? null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const base = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true };

test('one button per built-in plan, in the tools row before every other button, the plan on show pressed', () => {
  const doc = makeDoc(), ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { ...base, plan: 'duplex-1' }, doc);
  const group = every(ui.root).find((n) => n.className === 'plans');
  assert.ok(group, 'the group exists'); assert.equal(group.attrs.role, 'group');
  const tools = every(ui.root).find((n) => n.className === 'tools');
  assert.equal(tools.children[0], group, 'the plans come first in the tools row');
  const buttons = group.children;
  assert.deepEqual(buttons.map((b) => b.dataset.plan), [...PLAN_NAMES]);
  assert.deepEqual(buttons.map((b) => b.className), PLAN_NAMES.map(() => 'tool plan'));
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'true']);
  assert.deepEqual(buttons.map((b) => b.textContent), ['Flat', 'Duplex']);
  for (const b of buttons) { assert.equal(b.type, 'button'); assert.ok(b.title.length > 10); assert.equal(b.attrs['aria-label'], b.title); }
  assert.equal(group.attrs['aria-label'], 'Example plans');
});

test('a tap calls back with the plan name; the pressed button follows the state and a plan from a file leaves none pressed', () => {
  const doc = makeDoc(), calls = [];
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onPlan: (n) => calls.push(n) }, { ...base, plan: 'flat-1' }, doc);
  const buttons = every(ui.root).find((n) => n.className === 'plans').children;
  buttons[1].listeners.click(); buttons[0].listeners.click();
  assert.deepEqual(calls, ['duplex-1', 'flat-1']);
  ui.update({ plan: 'duplex-1' }); assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'true']);
  ui.update({ plan: null }); assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false']);
});

test('the words are in both languages and without long dashes', () => {
  const doc = makeDoc(), ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { ...base, plan: 'flat-1' }, doc);
  const group = every(ui.root).find((n) => n.className === 'plans'), buttons = group.children;
  ui.update({ lang: 'pl' });
  assert.deepEqual(buttons.map((b) => b.textContent), ['Mieszkanie', 'Dupleks']);
  assert.equal(group.attrs['aria-label'], 'Przykładowe plany');
  for (const b of buttons) assert.ok(!`${b.textContent}${b.title}`.match(/[–—]/), b.textContent);
  assert.match(buttons[0].title, /jedno piętro/); assert.match(buttons[1].title, /dwa piętra/);
  ui.update({ lang: 'en' });
  assert.match(buttons[0].title, /one floor/); assert.match(buttons[1].title, /two floors/);
});

test('the plan buttons leave the bar while editing and come back, and btn=0 hides the whole tools row they sit in', () => {
  const doc = makeDoc(), ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { ...base, plan: 'flat-1' }, doc);
  const group = every(ui.root).find((n) => n.className === 'plans'), tools = every(ui.root).find((n) => n.className === 'tools');
  assert.notEqual(group.style.display, 'none');
  ui.update({ editing: true }); assert.equal(group.style.display, 'none');
  ui.update({ editing: false }); assert.equal(group.style.display, '');
  ui.update({ tools: false }); assert.equal(tools.style.display, 'none');
});
