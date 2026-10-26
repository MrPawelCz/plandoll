// The button of the open shell: on by default (shell=0 takes it away), in the tools row after the example plans, its word and hint follow the state in both
// languages, it works the same while editing, and the address parameter reads back. Against the tiny DOM stub of ui.test.mjs (no browser).
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

test('the shell is on by default, shell=0 turns it off, and the choice survives the edit toggle', () => {
  for (const h of ['', '#amber', '#shell=1', '#shell=true', '#shell=', '#shell=2']) assert.equal(parseParams(h).shell, true, h);
  assert.equal(parseParams('#shell=0').shell, false);
  assert.equal(parseParams('#shell=0&edit=1').shell, false);
  const state = { preset: 'clear', t: 0.4, q: 'auto', lang: 'pl' };
  assert.equal(parseParams(`#${editHash('#shell=0&plan=duplex-1', true, state)}`).shell, false, 'switching the editor on keeps shell=0');
  assert.equal(parseParams(`#${editHash('#plan=duplex-1', true, state)}`).shell, true, 'and leaves the default alone');
});

test('without the shell button the tools row has the example plans and the four buttons (edit, save image, copy link, load plan), and the bar says it has tools', () => {
  const doc = makeDoc(), ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {} }, { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true, plan: 'flat-1' }, doc);
  assert.deepEqual(toolButtons(ui).map((b) => b.dataset.tool), ['edit', 'saveImage', 'share', 'loadPlan']);
  assert.equal(ui.root.className, 'has-tools');
  ui.update({ editing: true }); assert.equal(ui.root.className, 'editing has-tools');
  ui.update({ editing: false, tools: false }); assert.equal(ui.root.className, '', 'btn=0 leaves the bar as it was');
});

test('with the shell the button comes first among the tools, says what it does in both languages and calls back', () => {
  const doc = makeDoc(); let calls = 0;
  const state = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true, shell: true, shellOpen: false };
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onShell: () => { calls++; } }, state, doc);
  const buttons = toolButtons(ui), shell = buttons[0];
  assert.deepEqual(buttons.map((b) => b.dataset.tool), ['shell', 'edit', 'saveImage', 'share', 'loadPlan']);
  assert.equal(shell.textContent, 'Open the shell'); assert.equal(shell.attrs['aria-label'], 'Open the shell'); assert.match(shell.title, /Space or Esc/);
  assert.equal(shell.type, 'button');
  assert.notEqual(shell.attrs['aria-disabled'], 'true');
  assert.equal(ui.root.className, 'has-tools');
  shell.listeners.click(); assert.equal(calls, 1);
  ui.update({ shellOpen: true });
  assert.equal(shell.textContent, 'Close the shell'); assert.equal(shell.attrs['aria-label'], 'Close the shell'); assert.match(shell.title, /Fold/);
  ui.update({ lang: 'pl', shellOpen: false });
  assert.equal(shell.textContent, 'Otwórz bryłę'); assert.match(shell.title, /spacja albo Esc/);
  ui.update({ shellOpen: true });
  assert.equal(shell.textContent, 'Złóż bryłę');
  assert.ok(!`${shell.textContent}${shell.title}`.match(/[\u2013\u2014]/), 'no long dashes in the words of the button');
});

test('while editing the shell button stays on the bar and works as it does outside the editor: no dimming, no hint to finish editing, the same words and calls', () => {
  const doc = makeDoc(); let calls = 0;
  const state = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en', tools: true, shell: true, shellOpen: false, editing: true };
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onShell: () => { calls++; } }, state, doc);
  const shell = toolButtons(ui)[0];
  assert.equal(shell.dataset.tool, 'shell');
  assert.notEqual(shell.style.display, 'none', 'the button is still there');
  assert.notEqual(shell.attrs['aria-disabled'], 'true', 'and not dimmed');
  assert.match(shell.title, /Space or Esc/); assert.doesNotMatch(shell.title, /editing/i);
  assert.equal(shell.textContent, 'Open the shell');
  assert.equal(ui.root.className, 'editing has-tools');
  shell.listeners.click(); assert.equal(calls, 1, 'a tap calls the page');
  ui.update({ shellOpen: true }); assert.equal(shell.textContent, 'Close the shell'); assert.match(shell.title, /Fold/);
  ui.update({ lang: 'pl', shellOpen: false });
  assert.match(shell.title, /spacja albo Esc/); assert.doesNotMatch(shell.title, /edycj/i); assert.equal(shell.textContent, 'Otwórz bryłę');
  assert.ok(!shell.title.match(/[\u2013\u2014]/));
  ui.update({ editing: false });
  assert.notEqual(shell.attrs['aria-disabled'], 'true'); assert.match(shell.title, /spacja albo Esc/);
});
