// Models for the Spacer physics tests (not a test itself). The page builds its model from the plan without furniture (the layout engine
// furnishes the flat afterwards), so these helpers strip it the same way: Spacer never sees a piece of furniture.
// Ported from planwalk tests/viewer/walk-room.mjs (MIT, same author), source commit fa1a280 (v0.3.2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';

// keepFurniture: only for the one test that proves the physics would ignore furniture even if a model carried it.
export const planModel = (plan, keepFurniture = false) => {
  const p = JSON.parse(JSON.stringify(plan));
  if (!keepFurniture) for (const lv of p.levels) lv.furniture = [];
  const res = analyzePlan(p), norm = modelOf(res);
  assert.ok(norm, JSON.stringify(res.errors));
  return buildModel(norm);
};

// A model of a plan file under the repository root, e.g. 'examples/flat-1.plan.json' or 'tests/fixtures/duplex-min.plan.json'.
export const fileModel = (file) => planModel(JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')));

// Room A (x 0 to 4) and room B (x 4 to 8), 4 m deep, with the door d1 (y 1.0 to 1.9) and the passage p1 (y 2.6 to 3.6) in the wall x = 4.
// divider: a wall across room B at y = 2.4 that hides the door from the south part of B. sill: the sill of the door (a high one cannot be walked through).
// sofa: a sofa (x 1 to 3 at y = 2) in room A, kept in the model (see planModel).
export function twoRooms({ divider = false, sill, sofa = false } = {}) {
  const walls = [
    { id: 'w1', from: [0, 0], to: [8, 0], kind: 'exterior' }, { id: 'w2', from: [8, 0], to: [8, 4], kind: 'exterior' },
    { id: 'w3', from: [8, 4], to: [0, 4], kind: 'exterior' }, { id: 'w4', from: [0, 4], to: [0, 0], kind: 'exterior' },
    { id: 'w5', from: [4, 0], to: [4, 4], kind: 'interior' },
  ];
  if (divider) walls.push({ id: 'w6', from: [4, 2.4], to: [8, 2.4], kind: 'interior' });
  const door = { id: 'd1', wall: 'w5', type: 'door', offset: 1.0, width: 0.9 };
  if (sill !== undefined) door.sill = sill;
  return planModel({
    version: 1, name: 'Two rooms', units: 'm',
    levels: [{
      id: 'L0', name: 'Ground', height: 2.6, walls,
      openings: [door, { id: 'p1', wall: 'w5', type: 'passage', offset: 2.6, width: 1.0 }],
      rooms: [{ id: 'a', name: 'A', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], floor: 'wood', ceiling: true }, { id: 'b', name: 'B', polygon: [[4, 0], [8, 0], [8, 4], [4, 4]], floor: 'tile', ceiling: true }],
      stairs: [],
      furniture: sofa ? [{ id: 'sofa', type: 'sofa', center: [2, 2], rotation: 0 }] : [],
    }],
  }, sofa);
}
