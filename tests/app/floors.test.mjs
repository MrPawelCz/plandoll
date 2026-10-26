// The floors on show (src/app/floors.js and the floor parameter of params.js): the address value, the choice for a plan, which levels are drawn, the words on the
// buttons in both languages, how far the base of the house rises for an upper floor that stands alone, and the box of the floors on show. Pure: runs in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { parseParams, buildHash, planHash, editHash, floorHash, splitHash, parseFloorParam, ALL } from '../../src/app/params.js';
import { resolveFloor, visibleFlags, visibleIndices, allShown, floorChoices, levelLabel, floorLift, visibleExtent, sameGround } from '../../src/app/floors.js';

const example = (name) => { const p = JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8')); for (const lv of p.levels) lv.furniture = []; return p; };
const modelOfPlan = (plan) => buildModel(modelOf(analyzePlan(plan)));
const noDash = (s) => !/[–—]/.test(s);

test('the address value: a whole number from 0 up or all; anything else counts as all', () => {
  assert.equal(parseFloorParam('0'), 0); assert.equal(parseFloorParam('1'), 1); assert.equal(parseFloorParam('12'), 12); assert.equal(parseFloorParam(' 2 '), 2);
  assert.equal(parseFloorParam('all'), ALL);
  for (const bad of [undefined, null, '', ' ', '-1', '1.5', '1e1', '+1', 'one', 'ALL', '100', '007x', '0x1', '%']) assert.equal(parseFloorParam(bad), ALL, String(bad));
});

test('parseParams reads floor=, defaults to all and survives a broken address', () => {
  assert.equal(parseParams('').floor, ALL);
  assert.equal(parseParams('#plan=duplex-1&floor=0').floor, 0);
  assert.equal(parseParams('#floor=1&edit=1').floor, 1);
  assert.equal(parseParams('#floor=all').floor, ALL);
  assert.equal(parseParams('#floor=%').floor, ALL);
  assert.equal(parseParams('#floor=-3').floor, ALL);
  assert.equal(parseParams('#amber&floor=1&t=0.5').t, 0.5, 'the other parameters are not disturbed');
});

test('the choice for a plan: one level has nothing to choose, a level that does not exist is all', () => {
  assert.equal(resolveFloor(0, 1), ALL); assert.equal(resolveFloor(1, 1), ALL); assert.equal(resolveFloor(0, 0), ALL);
  assert.equal(resolveFloor(0, 2), 0); assert.equal(resolveFloor(1, 2), 1); assert.equal(resolveFloor(2, 2), ALL); assert.equal(resolveFloor(5, 3), ALL);
  assert.equal(resolveFloor(ALL, 3), ALL); assert.equal(resolveFloor(-1, 3), ALL); assert.equal(resolveFloor(1.5, 3), ALL); assert.equal(resolveFloor('1', 3), ALL, 'only a number is an index');
  assert.equal(resolveFloor(undefined, 3), ALL); assert.equal(resolveFloor(NaN, 3), ALL);
});

test('which levels are drawn: all of them, or only the chosen one', () => {
  assert.deepEqual(visibleFlags(ALL, 2), [true, true]);
  assert.deepEqual(visibleFlags(0, 2), [true, false]);
  assert.deepEqual(visibleFlags(1, 2), [false, true]);
  assert.deepEqual(visibleFlags(1, 3), [false, true, false]);
  assert.deepEqual(visibleFlags(2, 3), [false, false, true]);
  assert.deepEqual(visibleFlags(3, 3), [true, true, true], 'no such level: all');
  assert.deepEqual(visibleFlags(0, 1), [true], 'a single level is always drawn');
  assert.deepEqual(visibleFlags(0, 0), []);
  assert.deepEqual(visibleIndices(1, 3), [1]); assert.deepEqual(visibleIndices(ALL, 3), [0, 1, 2]);
  assert.ok(allShown(visibleFlags(ALL, 4))); assert.ok(!allShown(visibleFlags(0, 4))); assert.ok(allShown([]), 'nothing to hide');
});

test('floorHash sets floor=, takes it out for all, and keeps everything else', () => {
  assert.equal(floorHash('#plan=duplex-1&lang=pl', 1), 'plan=duplex-1&lang=pl&floor=1');
  assert.equal(floorHash('#plan=duplex-1&floor=0&lang=pl', 1), 'plan=duplex-1&lang=pl&floor=1', 'the old value goes');
  assert.equal(floorHash('#plan=duplex-1&floor=1', ALL), 'plan=duplex-1');
  assert.equal(floorHash('', 0), 'floor=0'); assert.equal(floorHash('', ALL), '');
  assert.equal(floorHash('#amber&t=0.4', 0), 'amber&t=0.4&floor=0', 'a bare preset word stays');
  assert.equal(floorHash('#plan=duplex-1', 'nonsense'), 'plan=duplex-1', 'a wrong value is all');
  assert.equal(floorHash('#plan=duplex-1', '1'), 'plan=duplex-1&floor=1', 'a numeric string is an index');
  assert.doesNotThrow(() => floorHash('#t=%&floor=1', 0));
});

test('the address after a new plan, a new mode or a rebuilt hash: floor= goes, stays or is written', () => {
  assert.equal(splitHash(planHash('#plan=duplex-1&floor=1&lang=pl', 'flat-1')).kv.floor, undefined, 'another example starts with all floors');
  assert.equal(splitHash(planHash('#floor=0&lang=pl', 'duplex-1')).kv.floor, undefined);
  assert.equal(splitHash(planHash('#floor=0&lang=pl', 'duplex-1')).kv.lang, 'pl', 'and nothing else is lost');
  assert.equal(splitHash(editHash('#plan=duplex-1&floor=1', true, { preset: 'clear', t: 0.4, lang: 'en' })).kv.floor, '1', 'edit mode keeps the floors on show');
  assert.equal(splitHash(editHash('#plan=duplex-1&floor=1', false, {})).kv.floor, '1');
  assert.equal(splitHash(editHash('#plan=duplex-1', true, { floor: 0 })).kv.floor, '0', 'the state of the page wins');
  assert.equal(splitHash(editHash('#plan=duplex-1&floor=1', true, { floor: ALL })).kv.floor, undefined, 'and all takes the parameter out');
  const p = parseParams('#plan=duplex-1&floor=1&edit=1');
  assert.equal(parseParams(`#${buildHash(p)}`).floor, 1, 'buildHash writes the floor and it reads back');
  assert.ok(!buildHash(parseParams('#plan=duplex-1')).includes('floor'), 'all is the default and is not written');
});

test('the buttons: a name per level and a last one for all, in both languages', () => {
  const names = ['Ground floor', 'Upper floor'];
  const en = floorChoices(names, 'en'), pl = floorChoices(names, 'pl');
  assert.deepEqual(en.map((c) => c.key), [0, 1, ALL]); assert.deepEqual(pl.map((c) => c.key), [0, 1, ALL]);
  assert.deepEqual(en.map((c) => c.label), ['Ground floor', 'Upper floor', 'Both']);
  assert.deepEqual(pl.map((c) => c.label), ['Parter', 'Piętro', 'Oba']);
  for (const c of [...en, ...pl]) { assert.ok(c.title.length > 8, c.label); assert.ok(noDash(c.label + c.title), c.label); }
  assert.match(pl[0].title, /Parter/); assert.match(en[1].title, /Upper floor/);
});

test('three or more levels end with All / Wszystkie; one level or none has no buttons', () => {
  const three = ['Basement', 'Ground floor', 'First floor'];
  assert.deepEqual(floorChoices(three, 'en').map((c) => c.label), ['Basement', 'Ground floor', 'First floor', 'All']);
  assert.deepEqual(floorChoices(three, 'pl').map((c) => c.label), ['Piwnica', 'Parter', 'Piętro', 'Wszystkie']);
  assert.deepEqual(floorChoices(['Ground floor'], 'en'), []); assert.deepEqual(floorChoices([], 'pl'), []);
  assert.deepEqual(floorChoices(undefined, 'pl'), []); assert.deepEqual(floorChoices('nope', 'en'), []);
});

test('the names: general English ones are translated into Polish, foreign ones are kept, a missing name becomes Level N', () => {
  assert.equal(levelLabel('Ground floor', 0, 'pl'), 'Parter'); assert.equal(levelLabel('Upper floor', 1, 'pl'), 'Piętro'); assert.equal(levelLabel('First floor', 1, 'pl'), 'Piętro');
  assert.equal(levelLabel('ground FLOOR', 0, 'pl'), 'Parter', 'case does not matter');
  assert.equal(levelLabel('Garage', 0, 'pl'), 'Garage'); assert.equal(levelLabel('Antresola', 1, 'pl'), 'Antresola');
  assert.equal(levelLabel('Ground floor', 0, 'en'), 'Ground floor');
  assert.equal(levelLabel('', 0, 'en'), 'Level 1'); assert.equal(levelLabel(undefined, 2, 'pl'), 'Poziom 3');
  assert.equal(levelLabel('L1', 1, 'en', 'L1'), 'Level 2', 'a name that is the id says nothing');
  assert.equal(levelLabel('L1', 1, 'en', 'x'), 'L1');
  const objs = floorChoices([{ id: 'L0', name: 'L0' }, { id: 'L1', name: 'Upper floor' }], 'pl');
  assert.deepEqual(objs.map((c) => c.label), ['Poziom 1', 'Piętro', 'Oba'], 'levels given as objects work too');
});

test('a long name is cut on the button and complete in the title', () => {
  const long = 'Mezzanine above the winter garden and the studio';
  const c = floorChoices([long, 'Roof terrace'], 'en');
  assert.ok(c[0].label.length <= 18 && c[0].label.endsWith('…'), c[0].label);
  assert.ok(c[0].title.includes(long));
  assert.ok(noDash(c[0].label));
});

test('the base rises only for an upper floor that stands alone; the lowest floor on show decides', () => {
  const duplex = modelOfPlan(example('duplex-1'));
  const [g, u] = duplex.levels;
  assert.equal(floorLift(duplex, [true, true]), 0); assert.equal(floorLift(duplex, [true, false]), 0);
  const lift = floorLift(duplex, [false, true]);
  assert.ok(Math.abs(lift - ((u.elevation - u.slab) - (g.elevation - g.slab))) < 1e-3, `lift ${lift}`);
  assert.ok(lift > 2.4 && lift < 3.2, `about one storey: ${lift}`);
  const three = { levels: [{ elevation: 0, slab: 0.2, height: 2.5 }, { elevation: 2.7, slab: 0.2, height: 2.5 }, { elevation: 5.4, slab: 0.3, height: 2.5 }] };
  assert.equal(floorLift(three, [false, true, false]), 2.7); assert.equal(floorLift(three, [false, false, true]), 5.3);
  assert.equal(floorLift(three, [true, false, false]), 0); assert.equal(floorLift(three, [true, true, true]), 0);
  assert.equal(floorLift(three, [false, false]), 0, 'flags that do not fit the plan change nothing'); assert.equal(floorLift({ levels: [] }, []), 0); assert.equal(floorLift(null, []), 0);
  assert.equal(floorLift(three, [false, false, false]), 0, 'nothing shown is not a lift');
});

test('the box of the floors on show: the whole box when all are, otherwise their walls and heights', () => {
  const duplex = modelOfPlan(example('duplex-1')), full = modelExtent(duplex);
  assert.equal(visibleExtent(duplex, full, [true, true]), full, 'the very same object, so a picture of all floors does not change');
  const g = visibleExtent(duplex, full, [true, false]), u = visibleExtent(duplex, full, [false, true]);
  for (const b of [g, u]) { assert.equal(b.minX, full.minX); assert.equal(b.maxX, full.maxX); assert.equal(b.minZ, full.minZ); assert.equal(b.maxZ, full.maxZ); }
  assert.ok(Math.abs(g.minY - full.minY) < 1e-9, 'the ground floor reaches down to the base');
  assert.ok(g.maxY < full.maxY - 2 && g.maxY > 2, `ground floor tops out at ${g.maxY}`);
  assert.equal(g.floorY, 0); assert.ok(u.floorY > 2.4, `the upper floor starts at ${u.floorY}`);
  assert.ok(Math.abs(u.maxY - full.maxY) < 1e-9, 'the upper floor reaches the top');
  assert.ok(u.minY > full.minY + 2, 'and starts above the base');
  assert.ok(sameGround(g, full) && sameGround(u, full) && sameGround(g, u), 'the two floors of the example stand on the same ground');
});

test('floors with different ground: each box follows its own walls, and a stair that leaves a level counts for its owner', () => {
  const model = {
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 8 },
    levels: [
      { elevation: 0, slab: 0.2, height: 2.6, walls: [{ from: [0, 0], to: [10, 0] }, { from: [10, 0], to: [10, 8] }, { from: [0, 8], to: [10, 8] }] },
      { elevation: 2.8, slab: 0.2, height: 2.6, walls: [{ from: [2, 1], to: [8, 1] }, { from: [8, 1], to: [8, 6] }] },
    ],
    looseStairs: [{ id: 's', owner: 1, down: false, delta: 3.1 }, { id: 't', owner: 0, down: true, delta: 1.2 }],
  };
  const full = { minX: 0, maxX: 10, minZ: 0, maxZ: 8, minY: -1.4, maxY: 5.9 };
  const g = visibleExtent(model, full, [true, false]), u = visibleExtent(model, full, [false, true]);
  assert.deepEqual([g.minX, g.maxX, g.minZ, g.maxZ], [0, 10, 0, 8]);
  assert.deepEqual([u.minX, u.maxX, u.minZ, u.maxZ], [2, 8, 1, 6]);
  assert.ok(Math.abs(g.minY - -1.2) < 1e-9, 'the stair that goes down from the ground floor reaches below it'); assert.ok(Math.abs(g.maxY - 2.6) < 1e-9);
  assert.ok(Math.abs(u.minY - 2.6) < 1e-9 && Math.abs(u.maxY - 5.9) < 1e-9, `${u.minY} ${u.maxY}`);
  assert.ok(!sameGround(g, u), 'different ground');
  assert.ok(Math.abs(floorLift(model, [false, true]) - 2.8) < 1e-9);
});

test('visibleExtent never throws on bad input and falls back to the whole box', () => {
  const full = { minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: 0, maxY: 3 };
  assert.equal(visibleExtent({ levels: [] }, full, []), full); assert.equal(visibleExtent(null, full, [true]), full);
  assert.equal(visibleExtent({ levels: [{ elevation: 0, slab: 0, height: 2, walls: [] }, { elevation: 2, slab: 0, height: 2, walls: [] }] }, full, [true, true]), full);
  const noWalls = visibleExtent({ levels: [{ elevation: 0, slab: 0, height: 2, walls: [] }, { elevation: 2, slab: 0, height: 2, walls: [{ from: [NaN, 1], to: ['x', 2] }] }] }, full, [false, true]);
  assert.equal(noWalls.minX, 0, 'a level without usable walls keeps the ground of the whole'); assert.equal(noWalls.floorY, 2);
  assert.ok(!sameGround(null, full) && !sameGround(full, undefined));
});
