// The Spacer button of the control bar: there by default after the shell button, gone with walk=0 and while editing, its word and hint follow the state in both languages
// (Walk and Exit, Spacer and Wyjdź), and while Spacer runs the bar keeps the moods and that button only. Against the tiny DOM stub of ui.test.mjs (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/app/ui.js';
import { startState } from '../../src/app/shell.js';
import { parseParams, editHash } from '../../src/app/params.js';
import { setViewParams } from '../../src/app/share.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [], title: '',
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id && !n.removed) ?? null; } };
  return doc;
}
const every = (n) => [n, ...n.children.flatMap(every)];
const toolButtons = (ui) => every(ui.root).filter((n) => n.className === 'tool');
const bar = (hash = '', extra = {}, handlers = {}) => {
  const doc = makeDoc(), state = { ...startState(parseParams(hash, { language: 'en' })), ...extra };
  return { ui: createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, ...handlers }, state, doc), state, doc };
};

test('the button is there by default, after the shell button and before the list of rooms, and calls back', () => {
  let calls = 0;
  const { ui } = bar('', {}, { onSpacer: () => { calls++; } });
  assert.deepEqual(toolButtons(ui).map((b) => b.dataset.tool), ['shell', 'spacer', 'rooms', 'edit', 'saveImage', 'share', 'loadPlan']);
  const b = toolButtons(ui)[1];
  assert.equal(b.type, 'button');
  b.listeners.click(); assert.equal(calls, 1);
  const noShell = bar('#shell=0');
  assert.deepEqual(toolButtons(noShell.ui).map((x) => x.dataset.tool), ['spacer', 'rooms', 'edit', 'saveImage', 'share', 'loadPlan'], 'without the shell it comes first');
});

test('walk=0 and the editor take the button away; a click with no handler does nothing', () => {
  for (const h of ['#walk=0', '#edit=1', '#walk=0&edit=1']) assert.equal(toolButtons(bar(h).ui).some((b) => b.dataset.tool === 'spacer'), false, h);
  assert.equal(toolButtons(bar('#walk=1').ui).some((b) => b.dataset.tool === 'spacer'), true, 'walk=1 opens in Spacer and keeps the button (it reads Exit then)');
  const { ui } = bar(); assert.doesNotThrow(() => toolButtons(ui)[1].listeners.click());
});

test('the word and the hint follow the state in both languages: Walk and Exit, Spacer and Wyjdź', () => {
  const { ui } = bar();
  const b = toolButtons(ui)[1];
  assert.equal(b.textContent, 'Walk'); assert.match(b.title, /eye height/); assert.equal(b.attrs['aria-pressed'], 'false'); assert.equal(b.attrs['aria-label'], b.title);
  ui.update({ walking: true });
  assert.equal(b.textContent, 'Exit'); assert.match(b.title, /go back to the view from above/); assert.equal(b.attrs['aria-pressed'], 'true');
  ui.update({ lang: 'pl' });
  assert.equal(b.textContent, 'Wyjdź'); assert.match(b.title, /wróć do widoku z góry/);
  ui.update({ walking: false });
  assert.equal(b.textContent, 'Spacer'); assert.match(b.title, /widoku z oczu \(Esc wraca\)/); assert.equal(b.attrs['aria-pressed'], 'false');
});

test('while Spacer runs the bar says so, and the row of tools stays for the way out even with btn=0; the other tools are the style\'s to hide, none is removed', () => {
  const { ui } = bar('#btn=0');
  assert.equal(ui.root.className, '');
  const tools = every(ui.root).find((n) => n.className === 'tools');
  assert.equal(tools.style.display, 'none', 'btn=0 hides the row');
  ui.update({ walking: true });
  assert.equal(ui.root.className, 'walking');
  assert.equal(tools.style.display, '', 'but not while walking: Exit is there');
  ui.update({ walking: false });
  assert.equal(tools.style.display, 'none'); assert.equal(ui.root.className, '');
  const full = bar();
  full.ui.update({ walking: true });
  assert.equal(full.ui.root.className, 'has-tools walking');
  const css = full.doc.getElementById('ps-style').textContent;
  assert.match(css, /#ps-ui\.walking label\.time,#ps-ui\.walking label\.quality,#ps-ui\.walking \.sep,#ps-ui\.walking button\.reset,#ps-ui\.walking button\.lang,#ps-ui\.walking \.plans,#ps-ui\.walking \.floors,#ps-ui\.walking button\.tool:not\(\[data-tool=spacer\]\)\{display:none\}/, 'the moods and the Exit button are what is left');
  assert.ok(!new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`).test(css));
});

test('the address: walk=1 opens in Spacer, walk=0 takes the button away, nothing else changes; the editor drops walk=1 and keeps walk=0', () => {
  assert.deepEqual([parseParams('').walk, parseParams('').spacer], [false, true]);
  assert.deepEqual([parseParams('#walk=1').walk, parseParams('#walk=1').spacer], [true, true]);
  assert.deepEqual([parseParams('#walk=0').walk, parseParams('#walk=0').spacer], [false, false]);
  for (const h of ['#walk=', '#walk=2', '#walk=true', '#walk']) assert.deepEqual([parseParams(h).walk, parseParams(h).spacer], [false, true], h);
  const state = { preset: 'clear', t: 0.4, q: 'auto', lang: 'pl' };
  assert.equal(parseParams(`#${editHash('#walk=1&plan=duplex-1', true, state)}`).walk, false, 'into the editor');
  assert.equal(parseParams(`#${editHash('#walk=1&edit=1', false, state)}`).walk, false, 'and out of it');
  assert.equal(parseParams(`#${editHash('#walk=0', true, state)}`).spacer, false, 'walk=0 is a choice about the buttons and stays');
  assert.equal(parseParams(`#${editHash('#walk=1&plan=duplex-1', true, state)}`).plan.name, 'duplex-1', 'the rest stays');
  // the link that Copy link hands out is made from an empty base (main.js buildLink), so a page opened with walk=1 sends a link that opens from above
  assert.ok(!/walk/.test(setViewParams('', { preset: 'amber', t: 0.5, az: 10, pol: 40, floor: 'all', plan: 'flat-1', seed: 1 }, 'XYZ')));
});
