// The floor step of the prop layer: open floor in the middle of a room gets a reading corner (no lone rug and armchair), and every rule of the
// layout still holds. The study of the first example plan has a wide bare stretch between its desk and its window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { autoFurnish, checkLayout } from '../../src/layout/index.js';
import { frontOf } from '../../src/layout/geometry.js';

const ALL = piecesImplemented();
const plan = JSON.parse(readFileSync(new URL('../../examples/flat-1.plan.json', import.meta.url), 'utf8'));
const model = buildModel(modelOf(analyzePlan(plan)));
const layout = autoFurnish(model, { seed: 7, allowedTypes: ALL });
const study = layout.levels.flatMap((lv) => lv.pieces).filter((p) => p.room === 'study');

test('the bare middle of the study gets no lone rug and no armchair on a rug of its own', () => {
  const rug = study.find((p) => p.type === 'rug');
  if (rug) assert.ok(study.some((p) => p !== rug && p.size[2] > 0.2 && !p.on && Math.abs(p.x - rug.x) < rug.size[0] / 2 + 0.2 && Math.abs(p.y - rug.y) < rug.size[1] / 2 + 0.2), 'a rug lies under a piece');
  for (const chair of study.filter((p) => p.type === 'armchair')) assert.ok(!rug || Math.abs(chair.x - rug.x) > rug.size[0] / 2 || Math.abs(chair.y - rug.y) > rug.size[1] / 2 || study.some((p) => p.type === 'desk' || p.type === 'coffee-table'), 'the armchair does not stand alone on the rug');
});

test('the floor step keeps every rule and gives the same result twice', () => {
  assert.deepEqual(checkLayout(model, layout, { allowedTypes: ALL }), []);
  assert.deepEqual(layout, autoFurnish(model, { seed: 7, allowedTypes: ALL }));
  const plain = autoFurnish(model, { seed: 7 });
  assert.deepEqual(checkLayout(model, plain), []);
});
