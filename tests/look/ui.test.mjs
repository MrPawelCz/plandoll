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
  assert.ok(!all.join(' ').match(/[–—]/), 'no long dashes in user-facing text');
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
