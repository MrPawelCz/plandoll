// The furniture catalogue: labels in both languages, ranges that make sense, deterministic order, and clampSize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECS, GROUPS, specOf } from '../../src/furniture/specs.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { catalog, catalogGroups, defaultSizeOf, clampSize, isResizable, resizableAxes, slotLabel, GROUP_LABELS, SLOT_LABELS } from '../../src/furniture/catalog.js';

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // en dash and em dash
const AX = { w: 0, d: 1, h: 2 };

test('the catalogue lists exactly the types that are built, in both languages', () => {
  const built = piecesImplemented();
  for (const lang of ['en', 'pl']) {
    const ids = catalog(lang).map((e) => e.id);
    assert.deepEqual([...ids].sort(), built, `${lang}: the catalogue and piecesImplemented() differ`);
    assert.ok(ids.length >= 40, `${ids.length} entries`);
  }
});

test('every entry has a label, a group label and a slot label in English and Polish, and none has a long dash', () => {
  const en = catalog('en'), pl = catalog('pl');
  assert.equal(en.length, pl.length);
  en.forEach((e, i) => {
    const p = pl[i], spec = specOf(e.id);
    assert.equal(p.id, e.id);
    assert.equal(e.label, spec.label.en);
    assert.equal(p.label, spec.label.pl);
    assert.ok(e.groupLabel && p.groupLabel && e.groupLabel !== p.groupLabel, `${e.id}: group label`);
    assert.deepEqual(e.slots.map((s) => s.name), spec.slots);
    e.slots.forEach((s, k) => {
      for (const [lang, name] of [['en', s.label], ['pl', p.slots[k].label]]) {
        assert.ok(typeof name === 'string' && name.length > 0, `${e.id}/${s.name}: no ${lang} label`);
        assert.ok(SLOT_LABELS[s.name], `${e.id}/${s.name}: the slot is missing in the label table`);
        assert.ok(!LONG_DASH.test(name), `${e.id}/${s.name}: long dash`);
      }
    });
    for (const text of [e.label, p.label, e.groupLabel, p.groupLabel]) assert.ok(!LONG_DASH.test(text), `${e.id}: long dash in "${text}"`);
  });
  for (const g of GROUPS) assert.ok(GROUP_LABELS[g].en && GROUP_LABELS[g].pl, `group ${g}`);
  assert.equal(slotLabel('sofa2', 'upholstery', 'pl'), 'Tapicerka');
  assert.equal(slotLabel('sofa2', 'legs', 'pl'), 'Nogi');
  assert.equal(slotLabel('sofa2', 'legs', 'en'), 'Legs');
  assert.equal(slotLabel('kitchen-sink', 'basin', 'pl'), 'Zlew');
  assert.equal(slotLabel('washbasin', 'basin', 'pl'), 'Umywalka');
  assert.equal(slotLabel('sofa2', 'made-up-slot', 'en'), 'Made up slot', 'an unknown slot falls back to its plain name');
});

test('the order is deterministic: group, then tier, then id', () => {
  const a = catalog('en'), b = catalog('en');
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1], q = a[i], gp = GROUPS.indexOf(p.group), gq = GROUPS.indexOf(q.group);
    assert.ok(gp >= 0 && gq >= 0);
    assert.ok(gp < gq || (gp === gq && (p.tier < q.tier || (p.tier === q.tier && p.id < q.id))), `${p.id} before ${q.id}`);
  }
  assert.deepEqual(catalog('pl').map((e) => e.id), a.map((e) => e.id), 'the order does not depend on the language');
  const groups = catalogGroups('pl');
  assert.deepEqual(groups.map((g) => g.group), GROUPS.filter((g) => a.some((e) => e.group === g)));
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), a.length);
  assert.equal(groups[0].label, GROUP_LABELS[groups[0].group].pl);
});

test('ranges make sense: min below the default, the default below max, only w, d and h', () => {
  for (const e of catalog('en')) {
    for (const [ax, r] of Object.entries(e.range)) {
      assert.ok(ax in AX, `${e.id}: axis ${ax}`);
      assert.ok(Array.isArray(r) && r.length === 2 && r.every(Number.isFinite), `${e.id}/${ax}`);
      assert.ok(r[0] < r[1], `${e.id}/${ax}: ${r}`);
      assert.ok(r[0] <= e.size[AX[ax]] && e.size[AX[ax]] <= r[1], `${e.id}/${ax}: default ${e.size[AX[ax]]} outside ${r}`);
      assert.ok(r[0] >= 0.05 && r[1] <= 5, `${e.id}/${ax}: unreasonable ${r}`);
    }
    assert.equal(e.size.length, 3);
    assert.ok(e.size.every((v) => Number.isFinite(v) && v > 0));
    assert.equal(isResizable(e.id), Object.keys(e.range).length > 0);
    assert.deepEqual(resizableAxes(e.id), Object.keys(AX).filter((ax) => e.range[ax]));
  }
  assert.equal(isResizable('sofa2'), true);
  assert.equal(isResizable('armchair'), false);
  assert.equal(isResizable('nope'), false);
});

test('an entry is a copy: changing it does not change the contract', () => {
  const e = catalog('en').find((x) => x.id === 'sofa2');
  e.size[0] = 9; e.range.w[0] = 9; e.slots.pop(); e.rooms.push('x');
  const spec = specOf('sofa2');
  assert.equal(spec.size[0], 1.6);
  assert.equal(spec.range.w[0], 1.4);
  assert.equal(spec.slots.length, 3);
  assert.ok(!spec.rooms.includes('x'));
  const s = defaultSizeOf('sofa2'); s[0] = 7;
  assert.equal(defaultSizeOf('sofa2')[0], 1.6);
  assert.equal(defaultSizeOf('nope'), null);
});

test('clampSize holds each axis inside its range, keeps fixed axes, and is idempotent', () => {
  assert.deepEqual(clampSize('sofa2', [5, 5, 5]), [1.9, 0.9, 0.85], 'only the width has a range');
  assert.deepEqual(clampSize('sofa2', [0, 0, 0]), [1.4, 0.9, 0.85]);
  assert.deepEqual(clampSize('sofa2', [1.6234, 2, 2]), [1.623, 0.9, 0.85], 'millimetre precision');
  assert.deepEqual(clampSize('bookshelf', [0.1, 9, 9]), [0.6, 0.32, 2.4], 'width and height clamp, the depth is fixed');
  assert.deepEqual(clampSize('armchair', [3, 3, 3]), [0.85, 0.85, 0.85], 'no range at all');
  assert.deepEqual(clampSize('sofa2', undefined), [1.6, 0.9, 0.85]);
  assert.deepEqual(clampSize('sofa2', 'wide'), [1.6, 0.9, 0.85]);
  for (const bad of [NaN, Infinity, -Infinity, '1.5', null, undefined, {}, [], true]) {
    assert.deepEqual(clampSize('sofa3', [bad, 1, 1]), [2.1, 0.95, 0.85], `rejected ${String(bad)}`);
  }
  const input = [9, 9, 9];
  clampSize('sofa2', input);
  assert.deepEqual(input, [9, 9, 9], 'the input is not changed');
  assert.equal(clampSize('nope', [1, 1, 1]), null);
  for (const spec of SPECS) {
    for (const probe of [[0, 0, 0], [9, 9, 9], [-1, 0.5, 100], spec.size, [NaN, NaN, NaN], [1.2345, 0.4567, 0.7891]]) {
      const once = clampSize(spec.id, probe), twice = clampSize(spec.id, once);
      assert.deepEqual(twice, once, `${spec.id}: not idempotent for ${probe}`);
      for (const [ax, r] of Object.entries(spec.range)) assert.ok(once[AX[ax]] >= r[0] && once[AX[ax]] <= r[1], `${spec.id}/${ax}`);
      for (const ax of Object.keys(AX)) if (!spec.range[ax]) assert.equal(once[AX[ax]], spec.size[AX[ax]], `${spec.id}/${ax}: a fixed axis moved`);
    }
    assert.deepEqual(clampSize(spec.id, spec.size), spec.size, `${spec.id}: the default is inside the range`);
  }
});
