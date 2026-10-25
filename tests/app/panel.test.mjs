// Editor panel against a small DOM stub (no browser) and a stand-in for the editing session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPanel, PANEL_TEXT } from '../../src/app/panel.js';
import { catalog, catalogGroups, resizableAxes, clampSize, defaultSizeOf } from '../../src/furniture/catalog.js';
import { paletteOf, defaultColorOf } from '../../src/furniture/palettes.js';
import { LOOK_COLOR } from '../../src/render/materials.js';

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
    fire(e, ev = {}) { for (const f of this.listeners[e] ?? []) f({ type: e, target: this, preventDefault() {}, ...ev }); },
    focus() { doc.activeElement = this; },
  });
  Object.assign(doc, { head: mk('head'), body: mk('body'), createElement: mk });
  doc.getElementById = (id) => all(doc.head).concat(all(doc.body)).find((n) => n.id === id) ?? null;
  return doc;
}
const all = (n) => [n, ...n.children.flatMap(all)];
const find = (n, pred) => all(n).find(pred);
const findAll = (n, pred) => all(n).filter(pred);
const cls = (name) => (n) => n.className === name;
const texts = (n) => all(n).flatMap((x) => [x.textContent, x.title, x.attrs['aria-label']]).filter(Boolean);

function makeSession() {
  const subs = new Set(), s = { calls: [], sel: null, probs: [], subs, n: 0, refuse: null };
  Object.assign(s, {
    selected: () => s.sel,
    problems: () => s.probs,
    add(type) {
      s.calls.push(['add', type]);
      if (s.refuse) return { ok: false, reason: s.refuse };
      s.sel = { id: `p${++s.n}`, type, size: defaultSizeOf(type), colors: {} };
      s.emit(); return { ok: true };
    },
    resize(size) { s.calls.push(['resize', size]); s.sel = { ...s.sel, size: [size.w, size.d, size.h] }; s.emit(); return { ok: true }; },
    recolor(slot, color) {
      s.calls.push(['recolor', slot, color]);
      const colors = { ...s.sel.colors };
      if (color === null) delete colors[slot]; else colors[slot] = color;
      s.sel = { ...s.sel, colors }; s.emit(); return { ok: true };
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit() { for (const f of [...subs]) f({ type: 'change' }); },
    select(piece) { s.sel = piece; s.emit(); },
  });
  return s;
}
const setup = (lang = 'en') => {
  const doc = makeDoc(), session = makeSession();
  const panel = createPanel({ doc, host: doc.body, lang, session });
  return { doc, session, panel, root: panel.element };
};
const items = (root) => findAll(root, cls('psp-item'));
const sofa = { id: 'a1', type: 'sofa2', size: defaultSizeOf('sofa2'), colors: {} };

test('the list holds every type of the catalogue once, in groups, with names in both languages', () => {
  for (const lang of ['en', 'pl']) {
    const { root } = setup(lang);
    const groups = findAll(root, cls('psp-group'));
    assert.deepEqual(groups.map((g) => g.dataset.group), catalogGroups(lang).map((g) => g.group));
    const ids = items(root).map((b) => b.dataset.id);
    assert.deepEqual(ids.slice().sort(), catalog(lang).map((e) => e.id).sort(), 'every type once');
    for (const b of items(root)) {
      const e = catalog(lang).find((x) => x.id === b.dataset.id);
      assert.ok(texts(b).includes(e.label), `${lang}/${e.id}: name`);
    }
    for (const g of catalogGroups(lang)) assert.ok(texts(root).includes(g.label), `${lang}: group ${g.label}`);
  }
  const en = setup('en'), pl = setup('pl');
  assert.ok(texts(en.root).includes('Sofa') || texts(en.root).some((t) => /sofa/i.test(t)));
  assert.notDeepEqual(texts(en.root), texts(pl.root));
});

test('the first group starts open, the others closed, and a group opens and closes by its heading', () => {
  const { root } = setup();
  const heads = findAll(root, cls('psp-group-head')), lists = findAll(root, cls('psp-items'));
  assert.ok(heads.length >= 6);
  assert.deepEqual(heads.map((h) => h.attrs['aria-expanded']), heads.map((_, i) => String(i === 0)));
  assert.deepEqual(lists.map((l) => l.hidden), lists.map((_, i) => i !== 0));
  heads[2].fire('click');
  assert.equal(heads[2].attrs['aria-expanded'], 'true'); assert.equal(lists[2].hidden, false);
  heads[0].fire('click');
  assert.equal(heads[0].attrs['aria-expanded'], 'false'); assert.equal(lists[0].hidden, true);
  for (const [i, h] of heads.entries()) assert.equal(h.attrs['aria-controls'], lists[i].id);
});

test('extras carry a tag, every item shows where it belongs, and touch targets are real buttons', () => {
  const { root } = setup('pl');
  const extra = catalog('pl').filter((e) => e.tier === 3).map((e) => e.id);
  assert.ok(extra.length >= 4);
  for (const b of items(root)) {
    assert.equal(b.tag, 'button'); assert.equal(b.type, 'button');
    const tagged = findAll(b, cls('psp-tag')).length === 1;
    assert.equal(tagged, extra.includes(b.dataset.id), b.dataset.id);
    if (tagged) assert.equal(findAll(b, cls('psp-tag'))[0].textContent, PANEL_TEXT.pl.extra);
    const rooms = find(b, cls('psp-item-rooms'));
    assert.ok(rooms && rooms.textContent.length > 0, `${b.dataset.id}: rooms`);
  }
  const sofaBtn = items(root).find((b) => b.dataset.id === 'sofa2');
  assert.match(find(sofaBtn, cls('psp-item-rooms')).textContent, /salon/);
  const plant = items(root).find((b) => b.dataset.id === 'plant-large');
  assert.match(find(plant, cls('psp-item-rooms')).textContent, /\+\d$/, 'a long list of rooms is shortened');
});

test('the add button opens and closes the sheet, and a piece is added by touching its entry', () => {
  const { doc, root, session } = setup();
  const toggle = find(root, cls('psp-toggle')), sheet = find(root, cls('psp-sheet')), addBox = find(root, cls('psp-add'));
  assert.equal(sheet.hidden, true); assert.equal(toggle.attrs['aria-expanded'], 'false');
  toggle.fire('click');
  assert.equal(toggle.attrs['aria-expanded'], 'true'); assert.equal(sheet.hidden, false); assert.equal(addBox.hidden, false);
  items(root).find((b) => b.dataset.id === 'sofa2').fire('click');
  assert.deepEqual(session.calls, [['add', 'sofa2']]);
  assert.equal(addBox.hidden, true, 'the list closes after an add');
  assert.equal(find(root, cls('psp-sel')).hidden, false, 'the selected piece shows');
  assert.equal(find(root, cls('psp-sel-name')).textContent, catalog('en').find((e) => e.id === 'sofa2').label);
  assert.equal(doc.activeElement, find(root, cls('psp-sel-head')), 'the keyboard focus moves to the selected piece');
});

test('Escape and the close button shut the list', () => {
  const { root } = setup();
  const toggle = find(root, cls('psp-toggle')), addBox = find(root, cls('psp-add'));
  toggle.fire('click'); assert.equal(addBox.hidden, false);
  root.fire('keydown', { key: 'Escape' }); assert.equal(addBox.hidden, true);
  toggle.fire('click'); find(root, cls('psp-close')).fire('click'); assert.equal(addBox.hidden, true);
});

test('a refused add keeps the list open and says why, in both languages', () => {
  for (const [lang, want] of [['en', PANEL_TEXT.en.fail['no-room']], ['pl', PANEL_TEXT.pl.fail['no-room']]]) {
    const { root, session, panel } = setup(lang);
    find(root, cls('psp-toggle')).fire('click');
    session.refuse = 'no-room';
    items(root)[0].fire('click');
    const note = find(root, cls('psp-note'));
    assert.equal(note.hidden, false); assert.equal(note.textContent, want);
    assert.equal(find(root, cls('psp-add')).hidden, false);
    session.refuse = null;
    items(root)[0].fire('click');
    assert.equal(note.hidden, true);
    panel.dispose();
  }
});

test('a selected piece gets size fields only for axes with a range, and one colour bar per slot', () => {
  for (const type of ['sofa2', 'bed-double', 'wardrobe', 'plant-large', 'floor-lamp', 'toilet', 'curtain']) {
    const { root, session } = setup();
    const piece = { id: 'x', type, size: defaultSizeOf(type), colors: {} };
    session.select(piece);
    const inputs = findAll(root, (n) => n.tag === 'input');
    assert.deepEqual(inputs.map((i) => i.dataset.axis), resizableAxes(type), `${type}: fields`);
    const e = catalog('en').find((x) => x.id === type);
    for (const input of inputs) {
      const [lo, hi] = e.range[input.dataset.axis];
      assert.equal(Number(input.attrs.min), Math.ceil(lo * 100 - 1e-6)); assert.equal(Number(input.attrs.max), Math.floor(hi * 100 + 1e-6));
      assert.equal(input.attrs.step, '1');
      assert.equal(input.type, 'number');
      assert.equal(Number(input.value), Math.round(piece.size[{ w: 0, d: 1, h: 2 }[input.dataset.axis]] * 1000) / 10);
      assert.ok(!/NaN/.test(input.value));
    }
    const rows = findAll(root, cls('psp-slot'));
    assert.deepEqual(rows.map((r) => find(r, cls('psp-slot-name')).textContent), e.slots.map((s) => s.label), `${type}: slot rows`);
    for (const [i, row] of rows.entries()) {
      const pal = paletteOf(type, e.slots[i].name);
      assert.equal(findAll(row, cls('psp-sw')).length, pal.colors.length, `${type}/${e.slots[i].name}: swatches`);
      assert.equal(findAll(row, cls('psp-default')).length, 1);
    }
  }
});

test('a piece without a size or colours still gets sound fields (no NaN, defaults shown)', () => {
  const { root, session } = setup();
  session.select({ id: 'x', type: 'sofa2' });
  const inputs = findAll(root, (n) => n.tag === 'input');
  assert.ok(inputs.length > 0);
  for (const i of inputs) assert.ok(i.value !== '' && !/NaN/.test(i.value));
  assert.ok(findAll(root, cls('psp-default')).every((b) => b.attrs['aria-pressed'] === 'true'));
  session.select({ id: 'y', type: 'not-a-type', size: [1, 1, 1] });
  assert.equal(findAll(root, (n) => n.tag === 'input').length, 0);
  assert.equal(find(root, cls('psp-sel-name')).textContent, 'not-a-type');
});

test('changing a field calls resize in metres, clamped to the range', () => {
  const { root, session } = setup();
  session.select(sofa);
  const r = catalog('en').find((e) => e.id === 'sofa2').range;
  const input = findAll(root, (n) => n.tag === 'input').find((i) => i.dataset.axis === 'w');
  const w1 = sofa.size[0] === 1.7 ? 1.5 : 1.7;
  input.value = String(w1 * 100); input.fire('change');
  assert.deepEqual(session.calls.at(-1), ['resize', { w: w1, d: sofa.size[1], h: sofa.size[2] }]);
  input.value = '9999'; input.fire('change');
  assert.equal(session.calls.at(-1)[1].w, r.w[1]); assert.equal(input.value, String(Math.round(r.w[1] * 1000) / 10), 'the kept value is shown');
  input.value = '1'; input.fire('change');
  assert.equal(session.calls.at(-1)[1].w, r.w[0]);
  input.value = '150,5'; input.fire('change');
  assert.equal(session.calls.at(-1)[1].w, clampSize('sofa2', [1.505, 1, 1])[0]);
  const n = session.calls.length;
  input.value = ''; input.fire('change'); input.value = 'abc'; input.fire('change');
  assert.equal(session.calls.length, n, 'an empty or broken entry changes nothing');
  assert.ok(input.value !== '' && !/NaN/.test(input.value), 'and the field goes back to the value in use');
  const same = input.value; input.fire('change');
  assert.equal(session.calls.length, n, 'the same value is not sent again'); assert.equal(input.value, same);
  for (const [, size] of session.calls.filter((c) => c[0] === 'resize')) for (const v of Object.values(size)) assert.ok(Number.isFinite(v));
});

test('when the session refuses a new size, the field goes back to the size in use', () => {
  const { root, session } = setup();
  session.select(sofa);
  session.resize = (size) => { session.calls.push(['resize', size]); return { ok: false, reason: 'fixed-size' }; };
  const input = findAll(root, (n) => n.tag === 'input').find((i) => i.dataset.axis === 'w');
  const used = input.value, w1 = sofa.size[0] === 1.7 ? 1.5 : 1.7;
  input.value = String(w1 * 100); input.fire('change');
  assert.equal(session.calls.at(-1)[0], 'resize'); assert.equal(input.value, used);
});

test('touching a swatch recolors the slot with a colour of its palette, and Default brings the default back', () => {
  const { root, session } = setup();
  session.select(sofa);
  const slot = 'upholstery', pal = paletteOf('sofa2', slot);
  const row = findAll(root, cls('psp-slot'))[0];
  const def = find(row, cls('psp-default')), sws = findAll(row, cls('psp-sw'));
  assert.equal(def.attrs['aria-pressed'], 'true'); assert.ok(sws.every((b) => b.attrs['aria-pressed'] === 'false'));
  sws[3].fire('click');
  assert.deepEqual(session.calls.at(-1), ['recolor', slot, pal.colors[3].hex]);
  assert.equal(sws[3].attrs['aria-pressed'], 'true'); assert.equal(def.attrs['aria-pressed'], 'false');
  assert.equal(sws.filter((b) => b.attrs['aria-pressed'] === 'true').length, 1);
  assert.equal(sws[3].title, pal.colors[3].name.en);
  assert.ok(sws[3].attrs['aria-label'].includes(pal.colors[3].name.en));
  sws[5].fire('click');
  assert.equal(sws[5].attrs['aria-pressed'], 'true'); assert.equal(sws[3].attrs['aria-pressed'], 'false');
  def.fire('click');
  assert.deepEqual(session.calls.at(-1), ['recolor', slot, null]);
  assert.equal(def.attrs['aria-pressed'], 'true'); assert.ok(sws.every((b) => b.attrs['aria-pressed'] === 'false'));
  const other = findAll(root, cls('psp-slot'))[1];
  assert.ok(findAll(other, cls('psp-sw')).every((b) => b.attrs['aria-pressed'] === 'false'), 'other slots are untouched');
});

test('the Default swatch shows the colour of the look of the page', () => {
  const { root, session } = setup();
  session.select(sofa);
  const dots = findAll(root, cls('psp-dot')).map((d) => d.style.background);
  const e = catalog('en').find((x) => x.id === 'sofa2');
  assert.deepEqual(dots, e.slots.map((s) => defaultColorOf('sofa2', s.name, 'textured')));
  assert.equal(dots[0], LOOK_COLOR['f:fabric']);
  assert.notEqual(dots[0], defaultColorOf('sofa2', 'upholstery', 'clay'));
});

test('problems of the piece are listed in words, red for the hard ones and yellow for the others', () => {
  const { root, session, panel } = setup('en');
  session.select(sofa);
  const list = find(root, cls('psp-problems'));
  assert.equal(list.children.length, 0);
  session.probs = [{ kind: 'overlap', with: 'q' }, { kind: 'door-zone' }, { kind: 'whatever' }];
  panel.refresh();
  assert.deepEqual(list.children.map((li) => [li.className, li.textContent]), [['psp-bad', PANEL_TEXT.en.problems.overlap], ['psp-warn', PANEL_TEXT.en.problems['door-zone']]]);
  panel.setLang('pl');
  assert.deepEqual(list.children.map((li) => li.textContent), [PANEL_TEXT.pl.problems.overlap, PANEL_TEXT.pl.problems['door-zone']]);
  session.probs = []; panel.refresh();
  assert.equal(list.children.length, 0);
});

test('setLang changes every text, and no text anywhere has a long dash', () => {
  const { root, session, panel } = setup('en');
  session.select(sofa); session.probs = [{ kind: 'overlap' }, { kind: 'stair' }, { kind: 'floating-prop' }];
  find(root, cls('psp-toggle')).fire('click'); panel.refresh();
  const en = texts(root);
  assert.ok(en.includes('Add')); assert.ok(en.includes('Default'));
  panel.setLang('pl');
  const pl = texts(root);
  assert.ok(pl.includes('Dodaj')); assert.ok(pl.includes('Domyślny')); assert.ok(pl.includes('Salon'));
  assert.ok(!pl.includes('Add') && !pl.includes('Default') && !pl.includes('Living room'));
  assert.ok(pl.some((t) => t.includes('Szerokość')) && en.some((t) => t.includes('Width')));
  assert.equal(find(root, cls('psp-sel-name')).textContent, catalog('pl').find((e) => e.id === 'sofa2').label);
  for (const t of [...en, ...pl]) assert.ok(!LONG_DASH.test(t), t);
  for (const lang of ['en', 'pl']) {
    for (const group of Object.values(PANEL_TEXT[lang])) for (const t of typeof group === 'object' ? Object.values(group) : [group]) assert.ok(!LONG_DASH.test(String(t)), String(t));
  }
  panel.setLang('en'); assert.ok(texts(root).includes('Add'));
});

test('the selection is followed through the session, and what is typed is not overwritten', () => {
  const { doc, root, session, panel } = setup();
  session.select(sofa);
  const input = findAll(root, (n) => n.tag === 'input').find((i) => i.dataset.axis === 'w');
  const before = input.value;
  doc.activeElement = input; input.value = '17';
  session.sel = { ...session.sel, size: [2.2, session.sel.size[1], session.sel.size[2]] }; panel.refresh();
  assert.equal(input.value, '17', 'a focused field keeps what the person is typing');
  doc.activeElement = null; panel.refresh();
  assert.equal(input.value, '220'); assert.notEqual(input.value, before);
  assert.equal(findAll(root, (n) => n.tag === 'input').find((i) => i.dataset.axis === 'w'), input, 'the same field element stays');
  session.select(null);
  assert.equal(find(root, cls('psp-sel')).hidden, true); assert.equal(find(root, cls('psp-sheet')).hidden, true);
  assert.equal(findAll(root, (n) => n.tag === 'input').length, 0);
  session.select({ id: 'b2', type: 'bed-double', size: defaultSizeOf('bed-double'), colors: { frame: '#9C7048' } });
  const pressed = findAll(root, (n) => n.attrs['aria-pressed'] === 'true' && n.dataset.color);
  assert.deepEqual(pressed.map((b) => b.dataset.color), ['#9c7048'], 'a colour is matched without regard to case');
});

test('200 refreshes in a row do not grow the page, and a new selection replaces the old fields', () => {
  const { root, session, panel } = setup();
  session.select(sofa);
  const count = () => all(root).length;
  const n = count();
  for (let i = 0; i < 200; i++) panel.refresh();
  assert.equal(count(), n);
  for (let i = 0; i < 50; i++) { session.select({ id: `s${i}`, type: i % 2 ? 'bed-double' : 'sofa2', size: defaultSizeOf(i % 2 ? 'bed-double' : 'sofa2'), colors: {} }); }
  const m = count();
  for (let i = 0; i < 200; i++) panel.refresh();
  assert.equal(count(), m);
  panel.setLang('pl'); panel.setLang('en'); panel.setLang('pl');
  const k = count();
  for (let i = 0; i < 20; i++) { panel.setLang(i % 2 ? 'en' : 'pl'); }
  assert.ok(Math.abs(count() - k) < 40, 'switching languages does not pile up nodes');
});

test('dispose stops listening and takes the panel out of the page; the style is injected once', () => {
  const doc = makeDoc(), a = makeSession(), b = makeSession();
  const p1 = createPanel({ doc, host: doc.body, lang: 'en', session: a }), p2 = createPanel({ doc, host: doc.body, lang: 'pl', session: b });
  assert.equal(all(doc.head).filter((n) => n.id === 'ps-panel-style').length, 1);
  assert.equal(a.subs.size, 1);
  assert.ok(doc.body.children.includes(p1.element));
  p1.dispose();
  assert.equal(a.subs.size, 0); assert.ok(!doc.body.children.includes(p1.element)); assert.ok(doc.body.children.includes(p2.element));
  a.select(sofa); p1.refresh(); p1.dispose(); // nothing throws after dispose
  assert.equal(b.subs.size, 1);
  p2.dispose(); assert.equal(b.subs.size, 0);
});

test('the panel works with a session that has no problems or subscribe, and uses the body when no host is given', () => {
  const doc = makeDoc();
  const session = { selected: () => null, add: () => ({ ok: true }), resize() {}, recolor() {} };
  const panel = createPanel({ doc, lang: 'pl', session });
  assert.ok(doc.body.children.includes(panel.element));
  panel.refresh(); panel.setLang('en'); panel.dispose();
});

test('the style sheet keeps the panel inside a phone screen and the controls at touch size', () => {
  const { doc } = setup();
  const css = doc.getElementById('ps-panel-style').textContent;
  assert.match(css, /max-width:calc\(100vw - 24px\)/);
  assert.match(css, /\.psp-root\[hidden\]/, 'the whole panel can be hidden with the hidden attribute');
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /max-height:55vh/);
  assert.match(css, /\.psp-item\{[^}]*min-height:44px/);
  assert.match(css, /\.psp-toggle\{[^}]*min-height:44px/);
  assert.match(css, /font-size:16px/, 'inputs are 16px so that phones do not zoom in');
  assert.ok(!LONG_DASH.test(css));
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(css));
});

test('the source of the panel keeps nothing in the browser, makes no request, has no randomness and does not import three.js', () => {
  const src = readFileSync(new URL('../../src/app/panel.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|WebSocket|Math\.random/.test(src));
  assert.ok(!/from ['"]three/.test(src));
  assert.ok(!LONG_DASH.test(src), 'no long dashes in the source');
});
