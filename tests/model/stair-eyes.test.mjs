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

test('coming down from the upper floor the walker is on the lower level as soon as he is off the top of the flight, not half way down', () => {
  // the flight has a stretch where the walker is on the ramp but not yet on the lower floor if the switch comes late: there the bodies of the upper floor
  // (the rails, the walls round the stairwell) would stop him on a ramp that leads to the lower floor
  for (const r of [0.6, 0.9, 0.97]) {
    const p = createPlayer(world, { level: st.upper, x: st.from[0] + st.dir[0] * st.length * r, y: st.from[1] + st.dir[1] * st.length * r });
    stepPlayer(world, p, {}, 1 / 60);
    assert.equal(p.level, st.lower, `placed at ${r} of the flight`);
    assert.equal(p.onStair, st.id, `on the ramp at ${r}`);
    assert.ok(Math.abs(p.floor - (model.levels[st.lower].elevation + r * st.delta)) < 1e-6, `the floor is the ramp at ${r}`);
  }
  // and on foot: from the landing above the flight, south down the flight (yaw 90), a second of walking is 1.4 m of the 2.8 m
  const q = createPlayer(world, { level: 1, x: 1.1, y: 1.9, yawDeg: 90 });
  assert.equal(q.level, 1);
  for (let i = 0; i < 60; i++) stepPlayer(world, q, { forward: 1 }, 1 / 60);
  assert.equal(q.level, 0, `after 1.4 m down the flight (y = ${q.y.toFixed(2)}) he is on the lower level`);
  assert.ok(q.y > 3.0 && q.y < 3.6, `and has walked down the flight: y = ${q.y.toFixed(2)}`);
});
