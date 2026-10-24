// Plans for the editor tests: the two examples and one generated plan, each with its model and its automatic layout.
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { generatePlan } from '../../tools/gen-plans.mjs';
import { autoFurnish } from '../../src/layout/index.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
export const modelOfPlan = (plan) => buildModel(modelOf(analyzePlan(plan)));
export function testPlans() {
  const out = [['flat-1', example('flat-1')], ['duplex-1', example('duplex-1')], ['gen-401', generatePlan(401).plan]];
  return out.map(([name, plan]) => { const model = modelOfPlan(plan); return { name, model, layout: autoFurnish(model, { seed: 3 }) }; });
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
export function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}
// A small hand made layout without a plan: a table with a vase on it, a sofa, an empty second level.
export function smallLayout() {
  return {
    version: 1, seed: 1,
    levels: [
      { id: 'L0', pieces: [
        { id: 'p1', type: 'dining-table', room: 'r', x: 2, y: 2, rot: 0, size: [1.6, 0.9, 0.75], elev: 0, on: null, colors: {} },
        { id: 'p2', type: 'vase', room: 'r', x: 2.3, y: 2, rot: 0, size: [0.15, 0.15, 0.3], elev: 0.75, on: 'p1', colors: {} },
        { id: 'p3', type: 'sofa3', room: 'r', x: 6, y: 2, rot: 0, size: [2.1, 0.95, 0.85], elev: 0, on: null, colors: { upholstery: '#7d8b99' } },
        { id: 'p4', type: 'bookshelf', room: 'r', x: 6, y: 4, rot: 0, size: [0.9, 0.32, 1.9], elev: 0, on: null, colors: {} },
        { id: 'p5', type: 'plant-small', room: 'r', x: 6, y: 4, rot: 0, size: [0.25, 0.25, 0.4], elev: 1.9, on: 'p4', colors: {} },
      ] },
      { id: 'L1', pieces: [] },
    ],
  };
}
