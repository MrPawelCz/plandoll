// The edit bar with its More menu against a small DOM stub (no browser): buttons, menu, closing, the status line, the published height.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEditBar, EDIT_STR } from '../../src/app/ui.js';

const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');

function makeDoc() {
  const timers = [];
  const win = { setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].dead = true; }, timers };
  const doc = { defaultView: win, listeners: {}, vars: {}, documentElement: { style: { setProperty(k, v) { doc.vars[k] = v; } } } };
  const mk = (tag) => ({
    tag, children: [], style: { setProperty() {} }, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', hidden: false, disabled: false, parentNode: null,
    append(...c) { c.forEach((x) => this.appendChild(x)); }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, addEventListener(e, f) { (this.listeners[e] ??= []).push(f); },
    contains(n) { return n === this || this.children.some((c) => c.contains(n)); },
    getBoundingClientRect() { return { top: 700, left: 0, width: 300, height: 58 }; },
    click() { (this.listeners.click ?? []).forEach((f) => f({ target: this })); },
  });
  doc.createElement = mk; doc.head = mk('head'); doc.body = mk('body');
  doc.getElementById = () => null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] ??= []).push(f); }; doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] ?? []).filter((x) => x !== f); };
  return doc;
}
const all = (n) => [n, ...n.children.flatMap(all)];

test('the bar has six buttons and a menu with seven items, in both languages', () => {
  const doc = makeDoc(), calls = [];
  const names = ['onTurn', 'onRemove', 'onUndo', 'onRedo', 'onAuto', 'onDuplicate', 'onSave', 'onLoad', 'onPaste', 'onLink', 'onSaveImage'];
  const bar = createEditBar(Object.fromEntries(names.map((n) => [n, () => calls.push(n)])), { lang: 'pl', selected: true }, doc);
  assert.deepEqual(bar.root.children.filter((c) => c.tag === 'button').map((b) => b.dataset.edit), ['turn', 'remove', 'undo', 'redo', 'auto', 'more']);
  assert.deepEqual(Object.keys(bar.items), ['duplicate', 'save', 'load', 'paste', 'link', 'image', 'plan']);
  assert.equal(bar.buttons.more.textContent, 'Plik'); assert.equal(bar.items.save.textContent, 'Zapisz układ'); assert.equal(bar.items.image.textContent, 'Zapisz obraz');
  bar.items.image.click(); assert.deepEqual(calls, ['onSaveImage']);
  assert.equal(bar.items.link.textContent, 'Kopiuj link'); bar.items.link.click(); assert.deepEqual(calls, ['onSaveImage', 'onLink']);
  bar.update({ lang: 'en' });
  assert.equal(bar.buttons.more.textContent, 'File'); assert.equal(bar.items.paste.textContent, 'Paste layout'); assert.equal(bar.items.link.textContent, 'Copy link');
  for (const lang of ['pl', 'en']) for (const [k, v] of Object.entries(EDIT_STR[lang])) { assert.ok(v.length > 0, k); assert.ok(!LONG_DASH.test(v), k); }
  for (const key of Object.keys(EDIT_STR.en)) assert.ok(key in EDIT_STR.pl, `pl has ${key}`);
});

test('More opens the menu, an item calls its handler and closes it, a tap outside and Escape close it', () => {
  const doc = makeDoc(), calls = [];
  const bar = createEditBar({ onDuplicate: () => calls.push('dup'), onSave: () => calls.push('save'), onLoad: () => calls.push('load'), onPaste: () => calls.push('paste') }, { lang: 'en', selected: true }, doc);
  assert.equal(bar.menu.hidden, true);
  bar.buttons.more.click(); assert.equal(bar.menu.hidden, false); assert.equal(bar.buttons.more.attrs['aria-expanded'], 'true');
  bar.items.save.click(); assert.deepEqual(calls, ['save']); assert.equal(bar.menu.hidden, true);
  bar.buttons.more.click(); bar.items.duplicate.click(); bar.buttons.more.click(); bar.items.load.click(); bar.buttons.more.click(); bar.items.paste.click();
  assert.deepEqual(calls, ['save', 'dup', 'load', 'paste']);
  bar.buttons.more.click(); assert.equal(bar.menu.hidden, false);
  doc.listeners.pointerdown.forEach((f) => f({ target: bar.panel })); // a tap beside the bar
  assert.equal(bar.menu.hidden, true);
  bar.buttons.more.click();
  doc.listeners.pointerdown.forEach((f) => f({ target: bar.items.save })); // a tap inside the menu does not close it by itself
  assert.equal(bar.menu.hidden, false);
  let stopped = false;
  doc.listeners.keydown.forEach((f) => f({ key: 'Escape', stopPropagation() { stopped = true; }, preventDefault() {} }));
  assert.equal(bar.menu.hidden, true); assert.equal(stopped, true);
  doc.listeners.keydown.forEach((f) => f({ key: 'Escape', stopPropagation() { stopped = 'again'; }, preventDefault() {} })); // closed menu: the key is left to the page
  assert.equal(stopped, true);
});

test('Duplicate is disabled while nothing is selected; say() shows one line and clears it', () => {
  const doc = makeDoc();
  const bar = createEditBar({}, { lang: 'en', selected: false }, doc);
  assert.equal(bar.items.duplicate.disabled, true);
  bar.update({ selected: true }); assert.equal(bar.items.duplicate.disabled, false);
  const msg = all(bar.root).find((n) => n.id === 'ps-edit-msg');
  bar.say('Layout loaded'); assert.equal(msg.textContent, 'Layout loaded');
  const t = doc.defaultView.timers; assert.ok(t.length >= 1 && t[t.length - 1].ms >= 3000);
  t[t.length - 1].fn(); assert.equal(msg.textContent, '');
  bar.say('one'); bar.say('two'); assert.equal(msg.textContent, 'two');
});

test('the height of the stack of bars is published as --ps-stack-h', () => {
  const doc = makeDoc();
  globalThis.window = { innerHeight: 844, addEventListener() {}, removeEventListener() {} };
  try {
    const bar = createEditBar({}, { lang: 'en' }, doc, { root: { offsetHeight: 90 } });
    assert.equal(doc.vars['--ps-stack-h'], '144px'); // 844 - 700
    bar.dispose();
  } finally { delete globalThis.window; }
});

test('the bar code has no storage and no network', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/app/ui.js', import.meta.url)), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|WebSocket/.test(src));
});
