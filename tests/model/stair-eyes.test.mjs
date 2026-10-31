// The eyes of Spacer follow the ramp of the stair: the height of the floor under the walker never hops, not even at the step where he changes level at the top (and at the bottom going down).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createPlayer, stepPlayer } from '../../src/model/physics.js';
import { fileModel } from '../helpers/walk-model.mjs';

const model = fileModel('examples/duplex-1.plan.json'), world = createWorld(model);
const st = model.levels[0].stairs[0];
const slope = st.delta / st.length; // metres of height per metre walked along the flight

// walks along the flight (x 1.1 from y0 to y1, so north is yaw -90 and south yaw 90) and returns the largest change of the floor height in one step, the level changes and the end
function climb({ y0, y1, yawDeg, run, dt = 1 / 60 }) {
  const p = createPlayer(world, { level: y0 > y1 ? 0 : 1, x: 1.1, y: y0, yawDeg });
  let last = p.floor, worst = 0, switches = 0, level = p.level;
  for (let i = 0; i < 60 * 8 && (y0 > y1 ? p.y > y1 : p.y < y1); i++) {
    stepPlayer(world, p, { forward: 1, run }, dt);
    worst = Math.max(worst, Math.abs(p.floor - last)); last = p.floor;
    if (p.level !== level) { switches++; level = p.level; }
  }
  return { worst, switches, p };
}

for (const run of [false, true]) {
  for (const dt of [1 / 60, 1 / 30]) {
    test(`going up the stair of duplex-1 ${run ? 'running' : 'walking'} at ${Math.round(1 / dt)} steps a second: no hop of the floor at the level switch`, () => {
      const speed = run ? 2.8 : 1.4, perStep = slope * speed * dt;
      const { worst, switches, p } = climb({ y0: 5.6, y1: 2.0, yawDeg: -90, run, dt });
      assert.equal(switches, 1, 'one change of level');
      assert.equal(p.level, 1);
      assert.ok(worst <= perStep * 1.6 + 1e-9, `the largest change ${worst.toFixed(4)} m against ${perStep.toFixed(4)} m of the ramp in a step`);
    });
  }
}

test('going down the stair is as smooth', () => {
  const { worst, switches, p } = climb({ y0: 1.9, y1: 5.7, yawDeg: 90, run: false });
  assert.equal(switches, 1);
  assert.equal(p.level, 0);
  assert.ok(worst <= slope * 1.4 / 60 * 1.6 + 1e-9, `the largest change ${worst.toFixed(4)} m`);
});
