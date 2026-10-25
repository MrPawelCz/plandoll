// The floor step of the prop layer: open floor in the middle of a room gets a rug and an armchair that faces it, and every rule of the
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

test('the bare middle of the study gets a rug with an armchair on it', () => {
  const rug = study.find((p) => p.type === 'rug');
  const chair = study.find((p) => p.type === 'armchair');
  assert.ok(rug && chair, 'a rug and an armchair');
  assert.ok(Math.abs(chair.x - rug.x) < rug.size[0] / 2 && Math.abs(chair.y - rug.y) < rug.size[1] / 2, 'the armchair stands on the rug');
  const [fx, fy] = frontOf(chair.rot);
  assert.ok((rug.x - chair.x) * fx + (rug.y - chair.y) * fy > 0, 'the armchair faces the middle of the rug');
});

test('the floor step keeps every rule and gives the same result twice', () => {
  assert.deepEqual(checkLayout(model, layout, { allowedTypes: ALL }), []);
  assert.deepEqual(layout, autoFurnish(model, { seed: 7, allowedTypes: ALL }));
  const plain = autoFurnish(model, { seed: 7 });
  assert.deepEqual(checkLayout(model, plain), []);
});
