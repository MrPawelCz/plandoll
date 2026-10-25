// Saving and loading layouts as text: round trip on three plans, stable text, limits, and hostile files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeLayout, parseLayout, createState, movePiece, rotatePiece, recolorPiece, addPiece, deletePiece, resizePiece, IO_LIMITS } from '../../src/editor/index.js';
import { testPlans, smallLayout, clone } from './plans.mjs';

const plans = testPlans();
const mk = (id, extra = {}) => ({ id, type: 'plant-small', room: 'r', x: 1, y: 1, rot: 0, size: [0.25, 0.25, 0.4], elev: 0, on: null, colors: {}, ...extra });
const withPieces = (levels) => JSON.stringify({ version: 1, seed: 1, levels });

for (const { name, model, layout } of plans) {
  test(`plan ${name}: save and load gives the same layout, with no warnings`, () => {
    const text = serializeLayout(layout);
    assert.equal(typeof text, 'string');
    const back = parseLayout(text, model, { strict: true });
    assert.equal(back.ok, true, JSON.stringify(back.errors.slice(0, 3)));
    assert.deepEqual(back.layout, layout);
    assert.deepEqual(back.warnings, []);
    assert.equal(serializeLayout(back.layout), text, 'saving the loaded layout gives the same text');
    const noModel = parseLayout(text);
    assert.equal(noModel.ok, true);
    assert.deepEqual(noModel.layout, layout);
  });

  test(`plan ${name}: the same operations give the same text`, () => {
    const run = () => {
      let st = createState(layout);
      const ps = layout.levels[0].pieces.filter((p) => !p.on);
      for (const p of ps.slice(0, 8)) {
        st = movePiece(st, p.id, p.x + 0.17, p.y - 0.11, { model }).state;
        st = rotatePiece(st, p.id, p.rot + 90, { model }).state;
      }
      st = deletePiece(st, ps[9].id).state;
      st = addPiece(st, { type: 'plant-large', x: ps[0].x, y: ps[0].y, level: layout.levels[0].id, room: ps[0].room }, { model }).state;
      return serializeLayout(st.layout);
    };
    const a = run(), b = run();
    assert.equal(a, b);
    assert.notEqual(a, serializeLayout(layout), 'the operations did change something');
  });
}

test('the saved text has a fixed key order, sorted colour slots and one piece per line', () => {
  const l = smallLayout();
  l.levels[0].pieces[2].colors = { upholstery: '#7d8b99', cushions: '#e0c48b', legs: '#222222' };
  const text = serializeLayout(l);
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ['version', 'seed', 'levels']);
  assert.deepEqual(Object.keys(data.levels[0]), ['id', 'pieces']);
  assert.deepEqual(Object.keys(data.levels[0].pieces[0]), ['id', 'type', 'room', 'x', 'y', 'rot', 'size', 'elev', 'on', 'colors']);
  assert.deepEqual(Object.keys(data.levels[0].pieces[2].colors), ['cushions', 'legs', 'upholstery']);
  assert.equal(text.split('\n').filter((line) => line.includes('"type"')).length, 5);
  assert.ok(text.endsWith('}\n'));
  const edited = recolorPiece(createState(l), 'p3', 'legs', '#101010');
  assert.notEqual(serializeLayout(edited.state.layout), text);
  assert.equal(serializeLayout(null), null);
  assert.equal(serializeLayout({ levels: 'x' }), null);
  assert.equal(serializeLayout({ levels: [{ id: 'L0', pieces: [{}] }] }), null);
  const nan = smallLayout();
  nan.levels[0].pieces[0].x = NaN;
  assert.equal(serializeLayout(nan), null, 'a layout that could not be read back is not written');
  assert.equal(typeof serializeLayout(smallLayout()), 'string');
});

test('garbage text is refused with a message and never throws', () => {
  const bad = [undefined, null, 5, {}, [], '', ' ', 'not json', '{', 'null', '[]', '42', '"x"', '{}', '{"version":2,"levels":[]}', '{"version":1}', '{"version":1,"levels":{}}', '{"version":1,"levels":"x"}',
    '\u0000\u0001', '[' .repeat(200000), '{"a":'.repeat(50000), 'x'.repeat(IO_LIMITS.chars + 1)];
  for (const t of bad) {
    const r = parseLayout(t, plans[0].model);
    assert.equal(r.ok, false, String(t).slice(0, 30));
    assert.equal(r.layout, null);
    assert.ok(r.errors.length >= 1 && typeof r.errors[0] === 'string');
  }
  const okEmpty = parseLayout('{"version":1,"levels":[]}');
  assert.equal(okEmpty.ok, true);
  assert.deepEqual(okEmpty.layout, { version: 1, seed: 1, levels: [] });
  assert.equal(parseLayout('﻿{"version":1,"levels":[]}').ok, true, 'a byte order mark is skipped');
});

test('limits: 400 pieces per level, 1500 in all, 20 levels', () => {
  const many = (n, from = 0) => Array.from({ length: n }, (_, i) => mk(`q${from + i}`));
  assert.equal(parseLayout(withPieces([{ id: 'L0', pieces: many(400) }])).ok, true);
  const over = parseLayout(withPieces([{ id: 'L0', pieces: many(401) }]));
  assert.equal(over.ok, false);
  assert.match(over.errors[0], /400/);
  const levels = (n, per) => Array.from({ length: n }, (_, k) => ({ id: `L${k}`, pieces: many(per, k * 1000) }));
  assert.equal(parseLayout(withPieces(levels(5, 300))).ok, true, '1500 in all is allowed');
  const total = parseLayout(withPieces([...levels(5, 300), { id: 'L5', pieces: many(1, 9000) }]));
  assert.equal(total.ok, false);
  assert.match(total.errors[0], /1500/);
  assert.equal(parseLayout(withPieces(Array.from({ length: 21 }, (_, k) => ({ id: `L${k}`, pieces: [] })))).ok, false);
});

test('hostile pieces: duplicate ids, loops of supports, missing supports, unknown types, bad numbers', () => {
  const text = withPieces([{ id: 'L0', pieces: [
    mk('a'), mk('a', { x: 2 }),
    { ...mk('t1'), type: 'dining-table', size: [1.6, 0.9, 0.75] },
    mk('v1', { type: 'vase', size: [0.15, 0.15, 0.3], elev: 0.75, on: 't1' }),
    mk('loop1', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'loop2' }), mk('loop2', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'loop1' }),
    mk('above', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'loop1' }),
    mk('self', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'self' }),
    mk('orphan', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'ghost' }),
    mk('wrong', { type: 'vase', size: [0.15, 0.15, 0.3], on: 'a' }),
    mk('weird', { type: 'sofa9' }), mk('proto', { type: '__proto__' }), mk('ctor', { type: 'constructor' }),
    mk('nan', { x: 1e999 }), mk('str', { x: '1' }), mk('far', { x: 5000 }), mk('badrot', { rot: 'north' }),
    mk('badsize', { size: [1, 2] }), mk('badsize2', { size: [1, 2, null] }), mk('noroom', { room: 5 }),
    mk('bad id!'), mk(''), 7, null, 'x', [],
  ] }]);
  const r = parseLayout(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const ids = r.layout.levels[0].pieces.map((p) => p.id);
  assert.deepEqual(ids, ['a', 't1', 'v1'], 'only the valid pieces stay');
  assert.ok(r.warnings.length >= 18);
  assert.ok(r.warnings.some((w) => /already used/.test(w)));
  assert.ok(r.warnings.some((w) => /loop/.test(w)));
  assert.ok(r.warnings.some((w) => /not there/.test(w)));
  assert.ok(r.warnings.some((w) => /cannot stand/.test(w)));
  assert.equal(parseLayout(text, null, { strict: true }).ok, false, 'strict mode turns warnings into errors');
});

test('prototype keys never reach the layout', () => {
  const text = '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"version":1,"seed":3,"levels":[{"__proto__":{"polluted":3},"id":"L0","pieces":['
    + '{"id":"a","type":"sofa3","room":"r","x":1,"y":1,"rot":0,"size":[2.1,0.95,0.85],"elev":0,"on":null,"__proto__":{"polluted":4},"constructor":"x","colors":{"__proto__":"#ffffff","constructor":"#ffffff","upholstery":"#102030","toString":"#fff"}},'
    + '{"id":"__proto__","type":"armchair","room":"r","x":2,"y":2},{"id":"constructor","type":"armchair","room":"r","x":3,"y":3}]}]}';
  const r = parseLayout(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const p = r.layout.levels[0].pieces[0];
  assert.deepEqual(Object.keys(p), ['id', 'type', 'room', 'x', 'y', 'rot', 'size', 'elev', 'on', 'colors']);
  assert.deepEqual(p.colors, { upholstery: '#102030' });
  assert.equal(r.layout.levels[0].pieces.length, 3, 'ids that look like keys are plain ids');
  assert.ok(r.warnings.length >= 3);
  assert.equal(Object.getPrototypeOf(p.colors), Object.prototype);
});

test('sizes are moved into their range with a warning, colours are checked', () => {
  const text = withPieces([{ id: 'L0', pieces: [
    { ...mk('s'), type: 'sofa3', size: [9, 7, 0.1], colors: { upholstery: '#ABCDEF', cushions: 'red', legs: 'oak', nope: '#ffffff' } },
    { ...mk('n'), type: 'armchair' },
  ] }]);
  const r = parseLayout(text);
  assert.equal(r.ok, true);
  const s = r.layout.levels[0].pieces[0];
  assert.deepEqual(s.size, [2.8, 0.95, 0.85], 'width clamped, fixed depth and height back to the spec');
  assert.deepEqual(s.colors, { upholstery: '#abcdef', legs: 'oak' });
  assert.ok(r.warnings.some((w) => /moved into the range/.test(w)));
  assert.ok(r.warnings.some((w) => /"nope"/.test(w)));
  assert.ok(r.warnings.some((w) => /cushions/.test(w)));
  assert.deepEqual(r.layout.levels[0].pieces[1].size, [0.85, 0.85, 0.85], 'a missing size is the spec size');
});

test('with a plan: unknown levels and rooms and pieces outside the plan are left out with a message', () => {
  const { model, layout } = plans[0];
  const level = layout.levels[0];
  const ok = level.pieces.find((p) => !p.on);
  const text = JSON.stringify({ version: 1, seed: 1, levels: [
    { id: level.id, pieces: [
      ok,
      { ...ok, id: 'far', x: 80, y: 80 },
      { ...ok, id: 'room', room: 'no-such-room' },
      { ...ok, id: 'edge', x: ok.x + 100 },
    ] },
    { id: 'L99', pieces: [mk('ghost')] },
  ] });
  const r = parseLayout(text, model);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.layout.levels.map((l) => l.id), model.levels.map((l) => l.id), 'one level per level of the plan');
  assert.deepEqual(r.layout.levels[0].pieces.map((p) => p.id), [ok.id]);
  assert.ok(r.warnings.some((w) => /outside its room/.test(w)));
  assert.ok(r.warnings.some((w) => /not on this level/.test(w)));
  assert.ok(r.warnings.some((w) => /L99/.test(w)));
  const dup = parseLayout(text, plans[1].model);
  assert.equal(dup.ok, true);
  assert.ok(dup.layout.levels.every((l) => l.pieces.length === 0 || l.pieces.every((p) => plans[1].model.levels.find((m) => m.id === l.id).rooms.some((room) => room.id === p.room))));
});

test('two hundred rooms and four hundred pieces do not hang the parser and the warning list stays short', () => {
  const pieces = Array.from({ length: 400 }, (_, i) => mk(`q${i}`, { room: `room-${i % 200}`, x: i * 0.01, y: -i * 0.01 }));
  const t0 = performance.now();
  const noModel = parseLayout(withPieces([{ id: 'L0', pieces }]));
  const withModel = parseLayout(withPieces([{ id: 'L0', pieces }]), plans[0].model);
  const ms = performance.now() - t0;
  assert.equal(noModel.ok, true);
  assert.equal(noModel.layout.levels[0].pieces.length, 400);
  assert.equal(withModel.ok, true);
  assert.equal(withModel.layout.levels[0].pieces.length, 0);
  assert.ok(withModel.warnings.length <= IO_LIMITS.warnings, `${withModel.warnings.length} warnings`);
  assert.match(withModel.warnings.at(-1), /more warnings/);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

test('an edited layout survives save and load (move, resize, colour, delete)', () => {
  const { model, layout } = plans[0];
  let st = createState(layout);
  const sofa = layout.levels[0].pieces.find((p) => p.type === 'sofa3' || p.type === 'sofa2');
  st = movePiece(st, sofa.id, sofa.x, sofa.y + 0.4, { model }).state;
  st = recolorPiece(st, sofa.id, 'upholstery', '#336699').state;
  st = resizePiece(st, sofa.id, { w: sofa.size[0] + 0.2 }, { model }).state;
  st = deletePiece(st, layout.levels[0].pieces.at(-1).id).state;
  const back = parseLayout(serializeLayout(st.layout), model);
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.deepEqual(back.layout, st.layout);
  assert.equal(JSON.stringify(clone(back.layout)), JSON.stringify(back.layout));
});
