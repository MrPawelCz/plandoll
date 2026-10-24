// In Node: the two example plans and twelve synthetic plans (seeds 401 to 412 cover all seven families) validate, build a model and a scene graph.
// No GL: the label canvases only need a document stub, as in scene.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { generatePlan } from '../../tools/gen-plans.mjs';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const plans = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')]];
for (let seed = 401; seed <= 412; seed++) { const { family, plan } = generatePlan(seed); plans.push([`gen-${seed}-${family}`, plan]); }

test('the set has fourteen plans covering every generator family', () => {
  assert.equal(plans.length, 14);
  const families = new Set(plans.filter(([n]) => n.startsWith('gen-')).map(([n]) => n.split('-')[2] + (n.split('-')[3] ? `-${n.split('-')[3]}` : '')));
  assert.equal(families.size, 7);
});

for (const [name, plan] of plans) {
  test(`plan ${name} validates, builds a model and a scene`, () => {
    const res = analyzePlan(plan);
    assert.ok(res.ok, `validation failed: ${JSON.stringify((res.errors ?? []).slice(0, 3))}`);
    const model = buildModel(modelOf(res));
    assert.ok(model.levels.length >= 1);
    for (const lv of model.levels) {
      assert.ok(lv.walls.length >= 4, 'walls');
      assert.ok(lv.rooms.length >= 1, 'rooms');
    }
    const ps = new PlanScene(model, 'textured');
    let meshes = 0;
    ps.group.traverse((o) => { if (o.isMesh) meshes++; });
    assert.ok(meshes > 20, `only ${meshes} meshes`);
  });
}
