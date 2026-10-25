// The automatic layout keeps the strip in front of its pieces free: at most two pieces per plan are flagged `front-blocked`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { autoFurnish } from '../../src/layout/index.js';
import { placementProblems, clearBox } from '../../src/editor/index.js';
import { obb, penetration } from '../../src/layout/geometry.js';
import { specOf } from '../../src/furniture/specs.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const modelOfPlan = (plan) => buildModel(modelOf(analyzePlan(plan)));
const PLANS = [['flat-1', () => example('flat-1')], ['duplex-1', () => example('duplex-1')], ...[401, 402, 404, 405, 406].map((s) => [`gen-${s}`, () => generatePlan(s).plan])];

function blocked(model, layout) {
  const out = [];
  for (const lv of layout.levels) for (const p of lv.pieces) {
    if (placementProblems(model, layout, lv.id, p).some((q) => q.kind === 'front-blocked')) out.push(`${p.type}@${p.room}`);
  }
  return out;
}

for (const [name, make] of PLANS) {
  test(`front-blocked: at most 2 pieces of the automatic layout (${name})`, () => {
    const model = modelOfPlan(make());
    const lay = autoFurnish(model, { seed: 3 });
    const list = blocked(model, lay);
    assert.ok(list.length <= 2, list.join(', '));
    assert.ok(lay.levels.reduce((n, l) => n + l.pieces.length, 0) > 15);
  });
}

// ---- the exemptions of the rule ----
const piece = (id, type, x, y, rot, extra = {}) => ({ id, type, room: 'r', x, y, rot, size: extra.size, elev: 0, on: null, colors: {} });
const mk = (id, type, x, y, rot) => ({ ...piece(id, type, x, y, rot), size: specOf(type).size.slice() });
const noModel = null;
const problems = (layout, id) => placementProblems(noModel, layout, 'L0', layout.levels[0].pieces.find((p) => p.id === id)).filter((q) => q.kind === 'front-blocked');

test('front-blocked: kitchen units and bathroom fixtures may share the open floor in front of them', () => {
  // rot 0 faces +y here: the strip of one unit reaches the other one, like at the corner of an L shaped run
  const crosses = (a, b) => penetration(clearBox(a), obb(b.x, b.y, b.size[0], b.size[1], b.rot)) > 0.01;
  const a = mk('a', 'kitchen-base', 1, 0.3, 0), b = mk('b', 'kitchen-base', 1, 1.2, 90);
  assert.ok(crosses(a, b), 'the strips really cross');
  const run = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [a, b] }] };
  assert.deepEqual(problems(run, 'a'), []);
  const t = mk('t', 'toilet', 1, 0.35, 0), w = mk('w', 'washbasin', 1.3, 0.9, 0);
  assert.ok(crosses(t, w), 'the strips really cross');
  assert.deepEqual(problems({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [t, w] }] }, 't'), []);
  // a different kind of piece in the same place does block
  const shelf = mk('s', 'bookshelf', 1, 1.2, 90);
  assert.equal(problems({ version: 1, seed: 1, levels: [{ id: 'L0', pieces: [a, shelf] }] }, 'a').length, 1);
});

test('front-blocked: a table in front of a kitchen unit still blocks it', () => {
  const lay = { version: 1, seed: 1, levels: [{ id: 'L0', pieces: [mk('a', 'kitchen-base', 1, 0.3, 0), mk('t', 'dining-table', 1, 1.1, 0)] }] };
  const got = problems(lay, 'a');
  assert.equal(got.length, 1);
  assert.equal(got[0].with, 't');
});
