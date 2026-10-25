// Every number of a real plan, replaced one at a time by something that is not a usable number: the validator never throws, a plan
// it accepts goes through the model and the layout engine without an exception and with finite numbers only, and none of it is slow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish, LIMITS } from '../../src/layout/index.js';

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
const BAD = [NaN, Infinity, -1e308, 1e308, null, '4.2', {}];

// Paths of all numbers in a value, as arrays of keys.
function numberPaths(v, path = [], out = []) {
  if (typeof v === 'number') out.push(path);
  else if (Array.isArray(v)) v.forEach((x, i) => numberPaths(x, [...path, i], out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numberPaths(v[k], [...path, k], out);
  return out;
}
function withValue(plan, path, value) {
  const copy = JSON.parse(JSON.stringify(plan));
  let cur = copy;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
  return copy;
}

for (const name of ['flat-1', 'duplex-1']) {
  test(`${name}: each number replaced by a value that is not usable never throws and never hangs`, () => {
    const plan = example(name);
    const paths = numberPaths(plan);
    assert.ok(paths.length > 100, `${paths.length} numbers`);
    const t0 = performance.now();
    let accepted = 0, refused = 0, slowest = 0;
    for (const path of paths) {
      for (const bad of BAD) {
        const mutated = withValue(plan, path, bad);
        const t1 = performance.now();
        let res;
        try { res = analyzePlan(mutated); } catch (e) { assert.fail(`validation threw for ${path.join('.')} = ${String(bad)}: ${e.message}`); }
        if (res.ok) {
          accepted++;
          try {
            const model = buildModel(modelOf(res));
            const lay = autoFurnish(model, { seed: 1 });
            assert.ok(lay.levels.reduce((n, l) => n + l.pieces.length, 0) <= LIMITS.total);
            for (const l of lay.levels) for (const p of l.pieces) assert.ok([p.x, p.y, p.rot, p.elev, ...p.size].every(Number.isFinite), `${path.join('.')} = ${String(bad)}: ${p.type} has a number that is not finite`);
          } catch (e) { assert.fail(`${path.join('.')} = ${String(bad)} was accepted but the model or the layout threw: ${e.message}`); }
        } else {
          refused++;
          assert.ok(res.errors.length > 0);
        }
        slowest = Math.max(slowest, performance.now() - t1);
      }
    }
    assert.ok(slowest < 2000, `slowest ${slowest.toFixed(0)} ms`);
    assert.ok(performance.now() - t0 < 60000);
    assert.ok(refused > 100, `${refused} refused, ${accepted} accepted`);
  });
}

test('a room corner at the edge of the number range is refused at once (the sampling along a room edge stays bounded)', () => {
  for (const bad of [1e308, -1e308, 1.7e308, 1e300, 1e200]) {
    for (const [room, point, axis] of [[0, 0, 0], [1, 0, 1], [1, 2, 0], [0, 3, 1]]) {
      const plan = example('flat-1');
      plan.levels[0].rooms[room].polygon[point][axis] = bad;
      const t0 = performance.now();
      const res = analyzePlan(plan);
      assert.ok(performance.now() - t0 < 1000, `room ${room} point ${point} = ${bad}`);
      assert.equal(res.ok, false);
    }
  }
});

test('a plan with a room edge of 1e308 metres does not use up the work budget of the next plan', () => {
  const bad = example('flat-1');
  bad.levels[0].rooms[1].polygon[0][1] = 1e308;
  analyzePlan(bad);
  const t0 = performance.now();
  const good = analyzePlan(example('flat-1'));
  assert.equal(good.ok, true);
  assert.ok(performance.now() - t0 < 1000);
  assert.ok(!good.warnings.some((w) => w.code === 'W111'), 'the work budget is whole again');
});
