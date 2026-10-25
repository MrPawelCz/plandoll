// The button of the open shell (shell=1): absent without the flag, in the tools row with it, its word and hint follow the state in both languages, and the
// address parameter reads back. Against the tiny DOM stub of ui.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/app/ui.js';
import { parseParams, editHash } from '../../src/app/params.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id && !n.removed) ?? null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const toolButtons = (ui) => every(ui.root).filter((n) => n.className === 'tool');

test('shell=1 is read from the address, off for everything else, and survives the edit toggle', () => {
  assert.equal(parseParams('#shell=1').shell, true);
  for (const h of ['', '#amber', '#shell=0', '#shell=true', '#shell=', '#shell=2']) assert.equal(parseParams(h).shell, false, h);
  assert.equal(parseParams('#shell=1&edit=1').shell, true);
  assert.equal(parseParams(`#${editHash('#shell=1&plan=duplex-1', true, { preset: 'clear', t: 0.4, q: 'auto', lang: 'pl' })}`).shell, true, 'switching the editor on keeps the flag');
});

test('without the flag the tools row has the three buttons it always had and the bar keeps its class', () => {
  const doc = makeDoc(), ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true }, doc);
  assert.deepEqual(toolButtons(ui).map((b) => b.dataset.tool), ['edit', 'saveImage', 'loadPlan']);
  assert.equal(ui.root.className, '');
  ui.update({ editing: true }); assert.equal(ui.root.className, 'editing');
});

test('with the flag the button comes first in the tools row, says what it does in both languages and calls back', () => {
  const doc = makeDoc(); let calls = 0;
  const state = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true, shell: true, shellOpen: false };
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onShell: () => { calls++; } }, state, doc);
  const buttons = toolButtons(ui), shell = buttons[0];
  assert.deepEqual(buttons.map((b) => b.dataset.tool), ['shell', 'edit', 'saveImage', 'loadPlan']);
  assert.equal(shell.textContent, 'Open the shell'); assert.equal(shell.attrs['aria-label'], 'Open the shell'); assert.match(shell.title, /Space or Esc/);
  assert.equal(shell.type, 'button');
  assert.equal(ui.root.className, 'has-shell');
  shell.listeners.click(); assert.equal(calls, 1);
  ui.update({ shellOpen: true });
  assert.equal(shell.textContent, 'Close the shell'); assert.equal(shell.attrs['aria-label'], 'Close the shell'); assert.match(shell.title, /Fold/);
  ui.update({ lang: 'pl', shellOpen: false });
  assert.equal(shell.textContent, 'Otwórz bryłę'); assert.match(shell.title, /spacja albo Esc/);
  ui.update({ shellOpen: true });
  assert.equal(shell.textContent, 'Złóż bryłę');
  ui.update({ editing: true }); assert.equal(ui.root.className, 'editing has-shell');
  assert.notEqual(shell.style.display, 'none', 'the button stays while editing');
  assert.ok(!`${shell.textContent}${shell.title}`.match(/[\u2013\u2014]/), 'no long dashes in the words of the button');
});
