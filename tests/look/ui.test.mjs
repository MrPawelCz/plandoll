// Error card and controls, against a tiny DOM stub (no browser): the card carries both languages and a technical detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { showErrorCard, ERROR_TEXT, createUI } from '../../src/app/ui.js';

function makeDoc() {
  const mk = (tag) => ({ tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', id: '', value: '', options: [],
    append(...c) { this.children.push(...c); if (tag === 'select') this.options.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  const doc = { head: mk('head'), body: mk('body'), documentElement: mk('html'), createElement: mk, getElementById(id) { const all = []; const walk = (n) => { all.push(n); n.children.forEach(walk); }; walk(doc.head); walk(doc.body); return all.find((n) => n.id === id && !n.removed) ?? null; } };
  return doc;
}
const texts = (n) => [n.textContent, ...n.children.flatMap(texts)].filter(Boolean);

test('error card shows English and Polish text plus the detail, and replaces an older card', () => {
  const doc = makeDoc();
  showErrorCard('WebGL2 is not available', doc);
  const card = showErrorCard('second', doc);
  const all = texts(card);
  for (const lang of ['en', 'pl']) { assert.ok(all.includes(ERROR_TEXT[lang].title)); assert.ok(all.includes(ERROR_TEXT[lang].body)); }
  assert.ok(all.includes('second'));
  assert.equal(card.attrs.role, 'alert');
  assert.equal(doc.body.children.filter((c) => c.id === 'ps-card' && !c.removed).length, 1);
  assert.ok(!all.join(' ').match(/[\u2013\u2014]/), 'no long dashes in user-facing text');
  assert.ok(doc.getElementById('ps-style'));
});

test('controls: three mood buttons with own names, language switch, no old names', () => {
  const doc = makeDoc(); const calls = [];
  const state = { preset: 'amber', t: 0.5, q: 'auto', lang: 'en' };
  const ui = createUI({ onPreset: (n) => calls.push(['preset', n]), onTime: (t) => calls.push(['t', t]), onQuality: (q) => calls.push(['q', q]), onLang: (l) => calls.push(['lang', l]) }, state, doc);
  const all = texts(ui.root);
  for (const s of ['Amber', 'Clear', 'Lamplit', 'Time of day', '14:30', 'PL']) assert.ok(all.includes(s), s);
  ui.update({ lang: 'pl', preset: 'lamplit', t: 1 });
  const pl = texts(ui.root);
  for (const s of ['Bursztyn', 'Jasno', 'Lampy', 'Pora dnia', '23:00', 'EN']) assert.ok(pl.includes(s), s);
  assert.ok(!pl.join(' ').match(/cozy|bright|moody|mood/i));
  const moods = ui.root.children.find((c) => c.className === 'moods').children;
  assert.equal(moods.length, 3);
  assert.deepEqual(moods.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'true']);
  moods[1].listeners.click(); assert.deepEqual(calls.at(-1), ['preset', 'clear']);
  assert.equal(doc.documentElement.lang, 'pl');
});

const everyNode = (n) => [n, ...n.children.flatMap(everyNode)];

test('controls: the quality choice has a visible name, Auto says which level it picked, and a description is attached', () => {
  const doc = makeDoc(); const calls = [];
  const state = { preset: 'amber', t: 0.5, q: 'auto', level: 'low', lang: 'en' };
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality: (q) => calls.push(q), onLang() {}, onReset() {} }, state, doc);
  const nodes = everyNode(ui.root), label = nodes.find((n) => n.className === 'quality'), select = nodes.find((n) => n.tag === 'select');
  const help = nodes.find((n) => n.id === 'ps-quality-help');
  assert.ok(texts(label).includes('Image quality'), 'a visible name beside the choice');
  assert.deepEqual(select.options.map((o) => o.textContent), ['Auto: low', 'High', 'Medium', 'Low']);
  assert.equal(select.attrs['aria-describedby'], help.id);
  assert.equal(label.title, help.textContent); assert.equal(select.title, help.textContent);
  for (const word of ['High', 'Low', 'sharper', 'battery']) assert.ok(help.textContent.includes(word), word);
  ui.update({ level: 'medium' });
  assert.equal(select.options[0].textContent, 'Auto: medium', 'without autoLevel it follows the level in use');
  ui.update({ q: 'high', level: 'high', autoLevel: 'low' });
  assert.equal(select.options[0].textContent, 'Auto: low', 'with a level chosen by hand, Auto still names what it would pick');
  ui.update({ lang: 'pl', q: 'auto', level: 'low', autoLevel: 'low' });
  assert.ok(texts(label).includes('Jakość obrazu'));
  assert.deepEqual(select.options.map((o) => o.textContent), ['Auto: niska', 'Wysoka', 'Średnia', 'Niska']);
  for (const word of ['Wysoka', 'Niska', 'ostrzejszy', 'baterii']) assert.ok(help.textContent.includes(word), word);
  assert.ok(!`${help.textContent}${label.title}`.match(/[\u2013\u2014]/), 'no long dashes');
});

test('controls: the reset button calls back, and the first-visit hint goes away for good', () => {
  const doc = makeDoc(); const calls = [];
  const ui = createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onReset: () => calls.push('reset') }, { preset: 'amber', t: 0.5, q: 'auto', level: 'low', lang: 'en' }, doc);
  const reset = everyNode(ui.root).find((n) => n.className === 'reset');
  assert.equal(reset.textContent, 'Reset view'); assert.ok(reset.title.length > 5);
  reset.listeners.click(); assert.deepEqual(calls, ['reset']);
  assert.equal(doc.getElementById('ps-hint').textContent, 'Drag to turn');
  ui.update({ lang: 'pl' }); assert.equal(doc.getElementById('ps-hint').textContent, 'Przeciągnij, żeby obrócić'); assert.equal(reset.textContent, 'Reset widoku');
  ui.hideHint(); assert.equal(doc.getElementById('ps-hint'), null);
  ui.update({ lang: 'en' }); ui.hideHint(); // no hint left: nothing throws
  assert.equal(doc.getElementById('ps-hint'), null);
});
