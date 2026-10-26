// The Copy link button of the control bar: in the tools row between Save image and Load plan, its words in both languages, it calls back, and it leaves the bar while editing
// (the link is then in the File menu of the edit bar). Against the tiny DOM stub of ui.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI, EDIT_STR } from '../../src/app/ui.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById() { return null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const share = (ui) => every(ui.root).find((n) => n.dataset?.tool === 'share');

test('the Copy link button is there, says what it does in both languages, calls back, and goes while editing', () => {
  const doc = makeDoc(); let calls = 0;
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onShare: () => { calls++; } }, { preset: 'amber', t: 0.5, q: 'auto', lang: 'pl', tools: true }, doc);
  const b = share(ui);
  assert.ok(b); assert.equal(b.type, 'button'); assert.equal(b.className, 'tool');
  assert.equal(b.textContent, 'Kopiuj link'); assert.match(b.title, /cały układ jest w linku/); assert.equal(b.attrs['aria-label'], b.title);
  b.listeners.click(); assert.equal(calls, 1);
  ui.update({ lang: 'en' });
  assert.equal(b.textContent, 'Copy link'); assert.match(b.title, /the whole layout is in the link/);
  assert.equal(b.style.display, '', 'on the plain page');
  ui.update({ editing: true }); assert.equal(b.style.display, 'none', 'while editing the link is in the File menu');
  ui.update({ editing: false }); assert.equal(b.style.display, '');
});

test('without a handler the button does nothing and does not throw; the edit bar words for the link exist in both languages', () => {
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true }, makeDoc());
  assert.doesNotThrow(() => share(ui).listeners.click());
  assert.equal(EDIT_STR.pl.link, 'Kopiuj link'); assert.equal(EDIT_STR.en.link, 'Copy link');
  assert.match(EDIT_STR.pl.moreLabel, /link/); assert.match(EDIT_STR.en.moreLabel, /link/);
});
