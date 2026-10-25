// File helpers against small DOM and browser stubs (no browser): saving a download, reading a picked file, the paste dialog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_PLAN_CHARS } from '../../src/core/limits.js';
import { LAYOUT_FILENAME, IMAGE_FILENAME, MAX_FILE_BYTES, REVOKE_DELAY_MS, refusalText, saveTextFile, saveBlobFile, readTextFile, askForText } from '../../src/app/files.js';

// Matches an en dash or an em dash; built from char codes so the file itself holds neither.
const LONG_DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

class StubBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }

// A document stub with a view carrying Blob, URL, FileReader and setTimeout stubs. Clicks and created nodes are recorded.
function makeDoc() {
  const win = {
    Blob: StubBlob, urlLog: [], timers: [], readers: [],
    URL: { createObjectURL(blob) { win.urlLog.push(['create', blob]); return `blob:stub/${win.urlLog.length}`; }, revokeObjectURL(url) { win.urlLog.push(['revoke', url]); } },
    FileReader: class { constructor() { win.readers.push(this); } readAsText(file) { this.file = file; } },
    setTimeout(fn, ms) { win.timers.push({ fn, ms }); },
  };
  const doc = { created: [], clicks: [], clickHook: null, activeElement: null, defaultView: win };
  const mk = (tag) => {
    const n = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', parentNode: null, removed: false,
      append(...c) { c.forEach((x) => this.appendChild(x)); },
      appendChild(c) { c.parentNode = this; c.removed = false; this.children.push(c); return c; },
      removeChild(c) { c.remove(); return c; },
      remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(e, f) { (this.listeners[e] ??= []).push(f); },
      focus() { doc.activeElement = this; },
      click() { doc.clicks.push({ node: this, attached: this.parentNode === doc.body, href: this.href, download: this.download, display: this.style.display }); doc.clickHook?.(this); } };
    doc.created.push(n); return n;
  };
  doc.createElement = mk; doc.head = mk('head'); doc.body = mk('body'); doc.created.length = 0;
  const all = (n) => [n, ...n.children.flatMap(all)];
  doc.getElementById = (id) => [...all(doc.head), ...all(doc.body)].find((n) => n.id === id) ?? null;
  return doc;
}

const all = (n) => [n, ...n.children.flatMap(all)];
// Dispatches an event on a node and lets it bubble up through the parents until stopPropagation.
function fire(node, type, props = {}) {
  const ev = { type, target: node, stopped: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
  for (let n = node; n && !ev.stopped; n = n.parentNode) (n.listeners[type] ?? []).forEach((f) => f(ev));
  return ev;
}

test('constants: the default file name and the size limit', () => {
  assert.equal(LAYOUT_FILENAME, 'plandoll-layout.json');
  assert.equal(MAX_FILE_BYTES, MAX_PLAN_CHARS); assert.equal(MAX_PLAN_CHARS, 2000000); assert.equal(REVOKE_DELAY_MS, 10000);
});

test('saveTextFile: downloads through a hidden temporary link, then cleans up', () => {
  const doc = makeDoc(); const win = doc.defaultView;
  doc.clickHook = () => win.urlLog.push(['click']);
  assert.equal(saveTextFile(doc, LAYOUT_FILENAME, '{"a":1}'), true);
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'click']); // the address stays valid for a while
  assert.equal(win.timers.length, 1); assert.equal(win.timers[0].ms, 10000); win.timers[0].fn();
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'click', 'revoke']);
  const blob = win.urlLog[0][1];
  assert.ok(blob instanceof StubBlob); assert.equal(blob.type, 'application/json'); assert.deepEqual(blob.parts, ['{"a":1}']);
  assert.equal(doc.clicks.length, 1);
  const click = doc.clicks[0];
  assert.equal(click.node.tag, 'a'); assert.equal(click.href, 'blob:stub/1'); assert.equal(click.download, 'plandoll-layout.json');
  assert.equal(click.display, 'none'); assert.ok(click.attached, 'in the page while it is clicked');
  assert.ok(click.node.removed); assert.equal(doc.body.children.length, 0);
  assert.equal(win.urlLog[2][1], 'blob:stub/1');
});

test('saveTextFile: the revoke delay can be injected', () => {
  const doc = makeDoc(); const win = doc.defaultView;
  assert.equal(saveTextFile(doc, 'a.json', '{}', { revokeDelayMs: 250 }), true);
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create']);
  assert.equal(win.timers.length, 1); assert.equal(win.timers[0].ms, 250);
  assert.equal(doc.body.children.length, 0, 'the link is gone at once');
  win.timers[0].fn();
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'revoke']);
});

test('saveTextFile: false for empty or non-text input, with nothing created', () => {
  const cases = [[LAYOUT_FILENAME, ''], [LAYOUT_FILENAME, undefined], [LAYOUT_FILENAME, 42], ['', '{}'], [undefined, '{}'], [7, '{}']];
  for (const [name, text] of cases) {
    const doc = makeDoc();
    assert.equal(saveTextFile(doc, name, text), false);
    assert.equal(doc.defaultView.urlLog.length, 0); assert.equal(doc.clicks.length, 0); assert.equal(doc.body.children.length, 0);
  }
});

test('saveTextFile: false when a browser piece is missing or unusable', () => {
  const breakers = {
    'no createObjectURL': (d) => { d.defaultView.URL = {}; },
    'Blob is not a constructor': (d) => { d.defaultView.Blob = false; },
    'no body': (d) => { d.body = null; },
  };
  for (const [name, breakIt] of Object.entries(breakers)) {
    const doc = makeDoc(); breakIt(doc);
    assert.equal(saveTextFile(doc, 'a.json', '{}'), false, name); assert.equal(doc.clicks.length, 0, name);
  }
  assert.equal(saveTextFile(null, 'a.json', '{}'), false);
});

test('saveTextFile: a click that throws gives false and still removes the link and frees the URL', () => {
  const doc = makeDoc(); const win = doc.defaultView;
  doc.clickHook = () => { throw new Error('blocked'); };
  assert.equal(saveTextFile(doc, 'a.json', '{}'), false);
  const link = doc.created.find((n) => n.tag === 'a');
  assert.ok(link.removed); assert.equal(doc.body.children.length, 0);
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'revoke']);
});

test('saveTextFile: a failing createObjectURL gives false and creates no link', () => {
  const doc = makeDoc();
  doc.defaultView.URL = { createObjectURL() { throw new Error('no room'); }, revokeObjectURL() { throw new Error('must not be called'); } };
  assert.equal(saveTextFile(doc, 'a.json', '{}'), false);
  assert.equal(doc.created.filter((n) => n.tag === 'a').length, 0);
});

test('saveTextFile: falls back to the global Blob and URL when the document has no view', () => {
  const doc = makeDoc(); doc.defaultView = null;
  assert.equal(saveTextFile(doc, 'a.json', '{}'), true);
  assert.ok(doc.clicks[0].href.startsWith('blob:'));
  assert.equal(doc.body.children.length, 0);
});

// Starts a file read against a fresh stub document; `prep` may change the document first.
function start(prep) {
  const doc = makeDoc(); prep?.(doc);
  const p = readTextFile(doc);
  return { doc, p, input: doc.created.find((n) => n.tag === 'input'), win: doc.defaultView };
}
const file = (size = 10) => ({ size, name: 'layout.json' });
const finished = (r, input, doc) => { assert.ok(!doc.body.children.includes(input), 'the picker input is not left in the page'); return r; };

test('readTextFile: the input is a hidden JSON file picker that gets clicked', async () => {
  const { doc, p, input } = start();
  assert.equal(input.type, 'file'); assert.equal(input.accept, '.json,application/json'); assert.equal(input.style.display, 'none');
  assert.equal(doc.clicks.filter((c) => c.node === input).length, 1);
  fire(input, 'cancel'); await p;
  assert.ok(input.removed);
});

test('readTextFile: reads the chosen file as text', async () => {
  const { doc, p, input, win } = start(); const chosen = file(7);
  input.files = [chosen]; fire(input, 'change');
  assert.equal(win.readers.length, 1); assert.equal(win.readers[0].file, chosen);
  win.readers[0].result = '{"a":1}'; win.readers[0].onload();
  assert.deepEqual(finished(await p, input, doc), { ok: true, text: '{"a":1}' });
});

test('readTextFile: no file chosen, or the cancel event, means cancelled', async () => {
  for (const files of [[], null, undefined]) {
    const { doc, p, input } = start(); input.files = files; fire(input, 'change');
    assert.deepEqual(finished(await p, input, doc), { ok: false, error: 'cancelled' });
  }
  const { doc, p, input } = start(); fire(input, 'cancel');
  assert.deepEqual(finished(await p, input, doc), { ok: false, error: 'cancelled' });
});

test('readTextFile: a file over the limit is refused without being read', async () => {
  const { doc, p, input, win } = start(); input.files = [file(MAX_FILE_BYTES + 1)]; fire(input, 'change');
  assert.deepEqual(finished(await p, input, doc), { ok: false, error: 'too-large' });
  assert.equal(win.readers.length, 0);
});

test('readTextFile: text longer than the limit is refused, text of exactly the limit is accepted', async () => {
  let t = start(); t.input.files = [file(MAX_FILE_BYTES)]; fire(t.input, 'change');
  t.win.readers[0].result = 'x'.repeat(MAX_FILE_BYTES + 1); t.win.readers[0].onload();
  assert.deepEqual(finished(await t.p, t.input, t.doc), { ok: false, error: 'too-large' });
  t = start(); t.input.files = [file(MAX_FILE_BYTES)]; fire(t.input, 'change');
  t.win.readers[0].result = 'x'.repeat(MAX_FILE_BYTES); t.win.readers[0].onload();
  const r = finished(await t.p, t.input, t.doc);
  assert.equal(r.ok, true); assert.equal(r.text.length, MAX_FILE_BYTES);
});

test('readTextFile: a reader error, an abort or a result that is not text means read-failed', async () => {
  const settles = [(r) => r.onerror(), (r) => r.onabort(), (r) => { r.result = null; r.onload(); }];
  for (const settle of settles) {
    const { doc, p, input, win } = start(); input.files = [file()]; fire(input, 'change'); settle(win.readers[0]);
    assert.deepEqual(finished(await p, input, doc), { ok: false, error: 'read-failed' });
  }
});

test('readTextFile: a reader that cannot be created or started means read-failed', async () => {
  const broken = [
    class { constructor() { throw new Error('boom'); } },
    class { readAsText() { throw new Error('boom'); } },
  ];
  for (const Reader of broken) {
    const { doc, p, input } = start((d) => { d.defaultView.FileReader = Reader; });
    input.files = [file()]; fire(input, 'change');
    assert.deepEqual(finished(await p, input, doc), { ok: false, error: 'read-failed' });
  }
});

test('readTextFile: resolves once, even when several events fire', async () => {
  let t = start(); fire(t.input, 'cancel'); t.input.files = [file()]; fire(t.input, 'change');
  assert.equal(t.win.readers.length, 0, 'a late change after the cancel starts no read');
  assert.deepEqual(finished(await t.p, t.input, t.doc), { ok: false, error: 'cancelled' });
  t = start(); t.input.files = [file()]; fire(t.input, 'change'); fire(t.input, 'cancel'); fire(t.input, 'change');
  assert.equal(t.win.readers.length, 1, 'a cancel or a second change during the read is ignored');
  const reader = t.win.readers[0];
  reader.result = 'one'; reader.onload(); reader.result = 'two'; reader.onload(); reader.onerror();
  assert.deepEqual(finished(await t.p, t.input, t.doc), { ok: true, text: 'one' });
});

test('readTextFile: an unsupported or failing browser resolves instead of throwing', async () => {
  let doc = makeDoc(); doc.defaultView.FileReader = false;
  assert.deepEqual(await readTextFile(doc), { ok: false, error: 'unsupported' }); assert.equal(doc.clicks.length, 0);
  doc = makeDoc(); const real = doc.createElement;
  doc.createElement = (tag) => { const n = real(tag); if (tag === 'input') n.click = undefined; return n; };
  assert.deepEqual(await readTextFile(doc), { ok: false, error: 'unsupported' });
  doc = makeDoc(); doc.clickHook = () => { throw new Error('blocked'); };
  assert.deepEqual(await readTextFile(doc), { ok: false, error: 'read-failed' });
  assert.equal(doc.body.children.length, 0, 'the input does not stay behind');
  doc = makeDoc(); doc.createElement = () => { throw new Error('no DOM'); };
  assert.deepEqual(await readTextFile(doc), { ok: false, error: 'read-failed' });
  assert.deepEqual(await readTextFile(null), { ok: false, error: 'unsupported' });
});

// The pieces of the open paste dialog.
function parts(doc) {
  const overlay = doc.getElementById('ps-files-overlay');
  const nodes = overlay ? all(overlay) : [];
  const buttons = nodes.filter((n) => n.tag === 'button');
  return { overlay, nodes, buttons, dialog: nodes.find((n) => n.attrs.role === 'dialog'), area: nodes.find((n) => n.tag === 'textarea'),
    load: buttons.find((b) => b.className === 'ps-files-load'), cancel: buttons.find((b) => b.className === 'ps-files-cancel') };
}
const EN = { title: 'Paste a layout', hint: 'Paste the text of a saved layout and press Load.', load: 'Load', cancel: 'Cancel' };
const PL = { title: 'Wklej układ', hint: 'Wklej tekst zapisanego układu i naciśnij Wczytaj.', load: 'Wczytaj', cancel: 'Anuluj' };

test('askForText: an accessible dialog in English and Polish, with the focus in the textarea', async () => {
  for (const [lang, want] of [['en', EN], ['pl', PL], ['de', EN], [undefined, EN]]) {
    const doc = makeDoc(); const p = askForText(doc, lang); const u = parts(doc);
    assert.ok(doc.body.children.includes(u.overlay)); assert.equal(u.overlay.tag, 'div');
    assert.equal(u.dialog.attrs['aria-modal'], 'true');
    const heading = u.nodes.find((n) => n.id === u.dialog.attrs['aria-labelledby']);
    assert.ok(heading && /^h[1-6]$/.test(heading.tag), 'aria-labelledby points at a heading'); assert.equal(heading.textContent, want.title);
    assert.ok(u.nodes.some((n) => n.tag === 'p' && n.textContent === want.hint));
    assert.equal(u.area.id, 'ps-files-text'); assert.equal(u.area.spellcheck, false); assert.ok(u.area.attrs['aria-label']);
    assert.deepEqual(u.buttons.map((b) => b.textContent).sort(), [want.cancel, want.load].sort());
    assert.ok(u.buttons.every((b) => b.type === 'button'));
    assert.equal(doc.activeElement, u.area);
    assert.ok(!all(u.overlay).map((n) => n.textContent).join(' ').match(LONG_DASH), 'no long dashes in the texts');
    fire(u.cancel, 'click'); assert.equal(await p, null);
  }
});

test('askForText: Load resolves the text as pasted and removes the dialog', async () => {
  const doc = makeDoc(); const p = askForText(doc, 'en'); const u = parts(doc);
  u.area.value = '{"v":1}\n'; fire(u.load, 'click');
  assert.equal(await p, '{"v":1}\n');
  assert.equal(doc.getElementById('ps-files-overlay'), null); assert.equal(doc.body.children.length, 0);
  assert.ok(u.overlay.removed);
});

test('askForText: Cancel gives null and removes the dialog', async () => {
  const doc = makeDoc(); const p = askForText(doc, 'pl'); const u = parts(doc);
  u.area.value = 'dropped'; fire(u.cancel, 'click');
  assert.equal(await p, null);
  assert.equal(doc.getElementById('ps-files-overlay'), null); assert.equal(doc.body.children.length, 0);
});

test('askForText: Escape cancels, from the textarea, the dialog or the overlay', async () => {
  for (const pick of [(u) => u.area, (u) => u.dialog, (u) => u.overlay]) {
    const doc = makeDoc(); const p = askForText(doc, 'en'); const u = parts(doc);
    u.area.value = 'dropped'; const ev = fire(pick(u), 'keydown', { key: 'Escape' });
    assert.equal(await p, null); assert.ok(ev.defaultPrevented);
    assert.equal(doc.getElementById('ps-files-overlay'), null);
  }
});

test('askForText: blank or oversized text keeps the dialog open and says why, text of exactly the limit passes', async () => {
  for (const lang of ['en', 'pl']) {
    for (const [text, key] of [['', 'empty'], ['   \n\t ', 'empty'], ['x'.repeat(MAX_FILE_BYTES + 1), 'tooLong']]) {
      const doc = makeDoc(); const p = askForText(doc, lang); const u = parts(doc);
      u.area.value = text; fire(u.load, 'click');
      const err = u.nodes.find((n) => n.id === 'ps-files-error');
      assert.equal(err.textContent, refusalText(lang, key)); assert.ok(err.textContent.length > 10); assert.equal(doc.body.children.length, 1, 'the dialog stays');
      fire(u.cancel, 'click'); assert.equal(await p, null); assert.equal(doc.body.children.length, 0);
    }
  }
  const doc = makeDoc(); const p = askForText(doc, 'en'); const u = parts(doc);
  u.area.value = 'x'.repeat(MAX_FILE_BYTES); fire(u.load, 'click');
  assert.equal((await p).length, MAX_FILE_BYTES);
});

test('askForText: a click on the dim background cancels, a click inside or the end of a drag does not', async () => {
  const doc = makeDoc(); const p = askForText(doc, 'en'); const u = parts(doc);
  fire(u.dialog, 'click'); fire(u.area, 'click');
  assert.ok(doc.getElementById('ps-files-overlay'), 'a click inside keeps it open');
  fire(u.area, 'pointerdown'); fire(u.overlay, 'click');
  assert.ok(doc.getElementById('ps-files-overlay'), 'a selection drag that ends outside keeps it open');
  fire(u.overlay, 'click');
  assert.equal(await p, null); assert.equal(doc.getElementById('ps-files-overlay'), null);
});

test('askForText: only one dialog at a time, the older one answers null', async () => {
  const doc = makeDoc();
  const stray = doc.createElement('div'); stray.id = 'ps-files-overlay'; doc.body.appendChild(stray);
  const first = askForText(doc, 'en'); const old = parts(doc).overlay;
  assert.ok(stray.removed, 'a leftover overlay is cleared');
  const second = askForText(doc, 'pl');
  assert.equal(await first, null); assert.ok(old.removed);
  assert.equal(doc.body.children.filter((c) => c.id === 'ps-files-overlay').length, 1);
  const u = parts(doc); assert.notEqual(u.overlay, old); assert.ok(u.nodes.some((n) => n.textContent === PL.title));
  u.area.value = 'new'; fire(u.load, 'click');
  assert.equal(await second, 'new');
  assert.equal(doc.body.children.length, 0);
});

test('askForText: focus goes back to where it was when the dialog closes', async () => {
  const doc = makeDoc(); const opener = doc.createElement('button'); doc.body.appendChild(opener); opener.focus();
  const p = askForText(doc, 'en'); const u = parts(doc);
  assert.equal(doc.activeElement, u.area);
  fire(u.cancel, 'click'); await p;
  assert.equal(doc.activeElement, opener);
});

test('askForText: Ctrl+Enter loads, Tab stays inside the dialog, keys do not reach the page', async () => {
  const doc = makeDoc(); const seen = []; doc.body.addEventListener('keydown', (e) => seen.push(e.key));
  const p = askForText(doc, 'en'); const u = parts(doc);
  u.cancel.focus(); let ev = fire(u.cancel, 'keydown', { key: 'Tab' });
  assert.equal(doc.activeElement, u.area); assert.ok(ev.defaultPrevented, 'Tab from the last control wraps to the first');
  ev = fire(u.area, 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, u.cancel); assert.ok(ev.defaultPrevented, 'Shift+Tab from the first control wraps to the last');
  u.load.focus(); ev = fire(u.load, 'keydown', { key: 'Tab' });
  assert.ok(!ev.defaultPrevented, 'in the middle the browser moves the focus');
  fire(u.area, 'keydown', { key: 'a' });
  assert.deepEqual(seen, [], 'the page never sees these keys');
  u.area.value = 'typed text'; fire(u.area, 'keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(await p, 'typed text');
});

test('askForText: the style element is injected once and pulls in nothing from outside', async () => {
  const doc = makeDoc();
  for (let i = 0; i < 3; i++) { const p = askForText(doc, 'en'); fire(parts(doc).cancel, 'click'); await p; }
  const styles = doc.head.children.filter((n) => n.tag === 'style' && n.id === 'ps-files-style');
  assert.equal(styles.length, 1);
  const css = styles[0].textContent;
  for (const re of [/min\(92vw,\s*560px\)/, /40vh/, /min-height:\s*44px/, /monospace/, /focus-visible/, /backdrop-filter/]) assert.match(css, re);
  assert.ok(!/url\(|@import|https?:/.test(css));
  assert.equal(doc.body.children.filter((n) => n.tag === 'style').length, 0);
});

test('askForText: null when the dialog cannot be built, and nothing half-built stays behind', async () => {
  assert.equal(await askForText(null, 'en'), null);
  let doc = makeDoc(); doc.body = null;
  assert.equal(await askForText(doc, 'en'), null);
  doc = makeDoc(); const real = doc.createElement;
  doc.createElement = (tag) => { const n = real(tag); if (tag === 'textarea') n.focus = () => { throw new Error('no focus'); }; return n; };
  assert.equal(await askForText(doc, 'en'), null);
  assert.equal(doc.getElementById('ps-files-overlay'), null); assert.equal(doc.body.children.length, 0);
  doc.createElement = real;
  const p = askForText(doc, 'en'); const u = parts(doc); u.area.value = 'again'; fire(u.load, 'click');
  assert.equal(await p, 'again', 'a later call works normally');
});

test('source: no storage, no network, no long dashes, no home paths', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/app/files.js', import.meta.url)), 'utf8');
  const lower = src.toLowerCase();
  for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket']) {
    assert.ok(!lower.includes(bad.toLowerCase()), bad);
  }
  assert.ok(!LONG_DASH.test(src), 'no en or em dashes');
  assert.ok(!src.includes(['', 'Users', ''].join('/')));
});

test('saveBlobFile: offers a picture Blob through the same hidden link, and refuses an empty or missing one', () => {
  const doc = makeDoc(); const win = doc.defaultView;
  doc.clickHook = () => win.urlLog.push(['click']);
  const picture = { size: 1234, type: 'image/png' };
  assert.equal(IMAGE_FILENAME, 'plandoll-view.png');
  assert.equal(saveBlobFile(doc, IMAGE_FILENAME, picture), true);
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'click']);
  win.timers[0].fn();
  assert.deepEqual(win.urlLog.map((e) => e[0]), ['create', 'click', 'revoke']);
  assert.equal(win.urlLog[0][1], picture, 'the Blob itself is handed over, not a copy');
  assert.equal(doc.clicks[0].download, 'plandoll-view.png'); assert.ok(doc.clicks[0].node.removed);
  const none = makeDoc();
  for (const bad of [null, undefined, 'x', { size: 0 }, {}]) assert.equal(saveBlobFile(none, IMAGE_FILENAME, bad), false);
  assert.equal(saveBlobFile(none, '', picture), false);
  assert.equal(none.defaultView.urlLog.length, 0, 'nothing was created');
});

test('askForText: the plan kind has its own words and a file button, the text comes back as pasted', async () => {
  for (const [lang, title, pick] of [['en', 'Load a plan', 'Choose a file'], ['pl', 'Wczytaj plan', 'Wybierz plik']]) {
    const doc = makeDoc(); const p = askForText(doc, lang, { kind: 'plan' }); const u = parts(doc);
    const heading = u.nodes.find((n) => n.id === u.dialog.attrs['aria-labelledby']);
    assert.equal(heading.textContent, title);
    assert.ok(u.buttons.some((b) => b.className === 'ps-files-pick' && b.textContent === pick));
    assert.equal(u.buttons.length, 3);
    assert.ok(!all(u.overlay).map((n) => n.textContent).join(' ').match(LONG_DASH), 'no long dashes in the texts');
    u.area.value = '{"version":1}'; fire(u.load, 'click');
    assert.equal(await p, '{"version":1}');
  }
  const doc = makeDoc(); const p = askForText(doc, 'en'); const u = parts(doc);
  assert.equal(u.buttons.length, 2, 'the layout box has no file button'); fire(u.cancel, 'click'); assert.equal(await p, null);
});
