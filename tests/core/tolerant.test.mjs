// Tolerant reading of imperfect plans (docs/SPEC.md section 5): unknown properties are a warning, an element with an error is
// skipped and the rest still makes a model, and nothing usable left is reported as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf, validatePlan } from '../../src/core/validate.js';
import { CAPS } from '../../src/core/caps.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const flat = () => load('examples/flat-1.plan.json');
const duplex = () => load('examples/duplex-1.plan.json');
const codes = (list) => list.map((i) => i.code);

test('an unknown property is a warning, is ignored, and the plan stays ok', () => {
  const p = flat();
  p.levels[0].rooms[0].furniture = [{ id: 'x', type: 'sofa', center: [1, 1] }];
  p.notes = 'drawn from a photo';
  p.levels[0].walls[0].comment = 'north wall';
  const r = analyzePlan(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(codes(r.warnings).filter((c) => c === 'W116'), ['W116', 'W116', 'W116']);
  const w = r.warnings.find((i) => i.code === 'W116' && i.path === 'levels[0].rooms[0]');
  assert.match(w.message, /unknown property "furniture"/);
  assert.match(w.message, /planwalk ignores it/);
  assert.ok(w.fix.length > 0);
  assert.equal(r.partial, false);
  assert.ok(r.normalized, 'the whole plan is built');
  const text = JSON.stringify(r.normalized);
  for (const word of ['comment', 'drawn from a photo', 'north wall']) assert.ok(!text.includes(word), `${word} must not reach the normalized plan`);
  assert.equal(r.normalized.levels[0].furniture.length, 9, 'the furniture inside the room is not added to the level');
});

test('strict keeps an unknown property an error (E002), as before', () => {
  const p = flat();
  p.levels[0].rooms[0].furniture = [];
  const r = analyzePlan(p, { strict: true });
  assert.equal(r.ok, false);
  const e = r.errors.find((i) => i.code === 'E002' && /unknown property "furniture"/.test(i.message));
  assert.ok(e, JSON.stringify(r.errors));
  assert.ok(!codes(r.warnings).includes('W116'));
  assert.equal(validatePlan(p, { strict: true }).ok, false);
  assert.equal(validatePlan(p).ok, true, 'validatePlan passes the option on and is tolerant by default');
});

test('$schema and keys starting with x- are allowed silently, in both modes, at every level', () => {
  const p = flat();
  p.$schema = 'https://example.com/plan.schema.json';
  p['x-source'] = { app: 'a tool' };
  p.levels[0]['x-note'] = 1;
  p.levels[0].walls[0]['x-colour'] = 'red';
  p.levels[0].furniture[0]['x-sku'] = 'A-1';
  for (const strict of [false, true]) {
    const r = analyzePlan(p, { strict });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.warnings, [], `strict ${strict}: ${JSON.stringify(r.warnings)}`);
    assert.ok(!JSON.stringify(r.normalized).includes('x-colour'));
  }
});

test('a wrong type or value of a KNOWN property is still an error (E002)', () => {
  const room = flat();
  room.levels[0].rooms[0].use = 'garage'; // not in the enum
  const a = analyzePlan(room);
  assert.equal(a.ok, false);
  assert.ok(a.errors.some((e) => e.code === 'E002' && /use/.test(e.path + e.message)));
  assert.ok(a.normalized, 'a value outside an enum does not stop the model');

  const wall = flat();
  wall.levels[0].walls[2].thickness = 'thick'; // wrong type: the wall cannot be read
  const b = analyzePlan(wall);
  assert.equal(b.ok, false);
  assert.ok(b.errors.some((e) => e.code === 'E002' && e.path === 'levels[0].walls[2].thickness'));
  assert.equal(b.normalized, null);
  assert.equal(b.partial, true);
  assert.deepEqual(b.skipped.map((s) => [s.kind, s.id]).filter(([k]) => k === 'wall'), [['wall', 'w3']]);

  const miss = flat();
  delete miss.levels[0].rooms[0].polygon;
  assert.ok(analyzePlan(miss).errors.some((e) => e.code === 'E002' && /polygon/.test(e.message)));
});

test('prototype keys stay errors and never produce NaN, even in the tolerant mode', () => {
  const r = analyzePlan('{"version":1,"__proto__":{"x":1},"constructor":1,"toString":2,"hasOwnProperty":3,"levels":[{"id":"L0","walls":[{"id":"a","from":[0,0],"to":[6,0]},{"id":"b","from":[6,0],"to":[6,4]},{"id":"c","from":[6,4],"to":[0,0]}]}]}');
  assert.equal(r.ok, false);
  const unknown = r.errors.filter((e) => e.code === 'E002' && /unknown property/.test(e.message)).map((e) => e.message);
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.ok(unknown.some((m) => m.includes(`"${k}"`)), `${k}: ${unknown.join(' | ')}`);
  assert.ok(!codes(r.warnings).includes('W116'));
  const bad = (r.salvaged ? r.salvaged.levels : []).flatMap((l) => l.walls.flatMap((w) => [w.thickness, w.length, ...w.from, ...w.to])).filter((v) => !Number.isFinite(v));
  assert.deepEqual(bad, []);
});

test('an element with an error is skipped and the rest makes a model (partial)', () => {
  const p = flat();
  p.levels[0].openings[1].width = 0; // schema: greater than 0
  p.levels[0].furniture[2].center = 'middle'; // wrong type
  const r = analyzePlan(p);
  assert.equal(r.ok, false);
  assert.equal(r.normalized, null);
  assert.equal(r.partial, true);
  assert.equal(r.dropped, 2);
  assert.equal(r.skipped.length, 2);
  const byKind = Object.fromEntries(r.skipped.map((s) => [s.kind, s]));
  assert.equal(byKind.opening.id, p.levels[0].openings[1].id);
  assert.equal(byKind.opening.path, 'levels[0].openings[1]');
  assert.match(byKind.opening.why, /width is 0 but must be greater than 0/);
  assert.equal(byKind.opening.reason, 'invalid');
  assert.equal(byKind.furniture.path, 'levels[0].furniture[2]');
  const m = modelOf(r);
  assert.ok(m, 'a model can be built');
  assert.equal(m.name, p.name, 'the plan name and meta are kept, as in a whole plan');
  assert.deepEqual(m.meta, p.meta);
  assert.equal(m.levels[0].walls.length, 8);
  assert.equal(m.levels[0].openings.length, 11);
  assert.equal(m.levels[0].furniture.length, 8);
  assert.equal(m.levels[0].rooms.length, 5);
  assert.ok(r.errors.some((e) => e.code === 'E002' && e.path === 'levels[0].openings[1].width'), 'the errors are listed as before');
});

test('every kind of element can be skipped: wall, opening, room, stair, furniture, level', () => {
  const p = duplex();
  p.levels[0].walls[0].from = [1]; // too short a point
  p.levels[0].rooms[0].polygon = [[0, 0], [1, 1]]; // fewer than 3 points
  p.levels[0].stairs[0].steps = 1; // minimum 2
  p.levels[0].furniture = [{ id: 'bad', type: 'sofa' }]; // no center
  p.levels[1].height = -3; // the whole level
  const r = analyzePlan(p);
  assert.equal(r.partial, true);
  const kinds = r.skipped.map((s) => s.kind);
  for (const k of ['wall', 'room', 'stair', 'furniture', 'level']) assert.ok(kinds.includes(k), `${k} in ${kinds.join()}`);
  assert.equal(r.skipped.find((s) => s.kind === 'level').id, 'L1');
  assert.equal(r.skipped.find((s) => s.kind === 'level').path, 'levels[1]');
  assert.equal(modelOf(r).levels.length, 1);
});

test('an opening on a skipped wall is skipped with the reason "its wall was skipped"', () => {
  const p = flat();
  const wall = p.levels[0].walls.find((w) => p.levels[0].openings.some((o) => o.wall === w.id));
  const attached = p.levels[0].openings.filter((o) => o.wall === wall.id).map((o) => o.id);
  assert.ok(attached.length >= 1);
  wall.to = 'north'; // the wall cannot be read
  const r = analyzePlan(p);
  assert.equal(r.partial, true);
  const deps = r.skipped.filter((s) => s.kind === 'opening');
  assert.deepEqual(deps.map((s) => s.id).sort(), [...attached].sort());
  for (const s of deps) { assert.equal(s.why, 'its wall was skipped'); assert.equal(s.reason, 'wall-skipped'); }
  assert.equal(r.skipped.filter((s) => s.kind === 'wall').length, 1);
  assert.equal(r.dropped, r.skipped.length, 'the dropped count includes the dependants');
  assert.ok(!codes(r.errors).includes('E005'), 'no E005 for an opening whose wall is already reported');
  const m = modelOf(r);
  assert.equal(m.levels[0].walls.length, 7);
  assert.equal(m.levels[0].openings.length, p.levels[0].openings.length - attached.length);
  const wallIds = new Set(m.levels[0].walls.map((w) => w.id));
  assert.ok(m.levels[0].openings.every((o) => wallIds.has(o.wall)));
});

test('when nothing usable is left there is no model, as before', () => {
  const noWalls = flat();
  noWalls.levels[0].walls.forEach((w) => { w.from = 'a'; });
  let r = analyzePlan(noWalls);
  assert.equal(r.ok, false);
  assert.equal(r.normalized, null);
  assert.equal(r.partial, false);
  assert.equal(modelOf(r), null);
  assert.equal(r.skipped.filter((s) => s.kind === 'wall').length, 8);

  const noLevel = flat();
  noLevel.levels[0].height = 0;
  r = analyzePlan(noLevel);
  assert.equal(r.partial, false);
  assert.equal(modelOf(r), null);
  assert.deepEqual(r.skipped.map((s) => s.kind), ['level']);

  for (const bad of [{ version: 1, levels: [] }, { version: 1 }, { version: 1, levels: 'x' }, '{"not":"a plan"', null]) {
    r = analyzePlan(bad);
    assert.equal(r.ok, false);
    assert.equal(r.partial, false);
    assert.equal(modelOf(r), null);
  }
});

test('a whole plan with errors that are not fatal still has a normalized plan, and is not partial', () => {
  const p = flat();
  p.levels[0].openings[0].wall = 'no-such-wall'; // E005
  const r = analyzePlan(p);
  assert.equal(r.ok, false);
  assert.ok(r.normalized);
  assert.equal(r.partial, false);
  assert.deepEqual(r.skipped, []);
  assert.equal(modelOf(r), r.normalized);
});

test('a clean plan: nothing skipped, not partial, modelOf is the normalized plan', () => {
  const r = analyzePlan(flat());
  assert.equal(r.ok, true);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.partial, false);
  assert.equal(modelOf(r), r.normalized);
});

test('caps are unchanged: a plan over a cap is not read any further and is not partial', () => {
  const p = flat();
  p.levels[0].furniture = Array.from({ length: 401 }, (_, i) => ({ id: `f${i}`, type: 'plant', center: [1, 1] }));
  const r = analyzePlan(p);
  assert.deepEqual(codes(r.errors), ['E013']);
  assert.equal(r.normalized, null);
  assert.equal(r.partial, false);
  assert.deepEqual(r.skipped, []);
});

test('a plan with so many violations that the check gives up is not read leniently', () => {
  const p = flat();
  p.levels[0].walls = Array.from({ length: 400 }, (_, i) => ({ id: `w${i}`, from: [0, 0], to: [1, 1], thickness: 'a', height: 'b', kind: 'c' }));
  const r = analyzePlan(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'E002'));
  assert.equal(r.normalized, null);
  assert.equal(r.partial, false);
});

test('unknown properties do not count toward that limit: 1000 walls with two ignored keys each are still read', () => {
  const p = flat();
  const wall = (i) => ({ id: `w${i}`, from: [i % 40, Math.floor(i / 40) * 2], to: [(i % 40) + 0.9, Math.floor(i / 40) * 2], label: `wall ${i}`, confidence: 0.9 });
  p.levels = [0, 1].map((k) => ({ id: `L${k}`, walls: Array.from({ length: 500 }, (_, i) => wall(i)) }));
  const r = analyzePlan(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
  assert.ok(r.normalized, 'the whole plan is built');
  assert.equal(r.partial, false);
  assert.equal(r.normalized.levels[0].walls.length + r.normalized.levels[1].walls.length, 1000);
  const w = r.warnings.filter((i) => i.code === 'W116');
  assert.equal(w.length, 101, 'listed up to the usual limit with one closing line');
  assert.match(w[100].message, /more issues with the code W116 are not listed/);
  assert.ok(!JSON.stringify(r.normalized).includes('confidence'));
  const strict = analyzePlan(p, { strict: true });
  assert.equal(strict.ok, false, 'strict still reports them');
  assert.ok(strict.errors.some((e) => e.code === 'E002' && /unknown property/.test(e.message)));
});

test('a plan with far more unknown properties than are collected is still read, and a real violation next to them is still reported', () => {
  const p = flat();
  p.levels[0].walls[0] = { ...p.levels[0].walls[0], ...Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`extra${i}`, i])) };
  p.levels[0].walls[1].thickness = 'thick';
  const r = analyzePlan(p);
  assert.deepEqual(r.errors.map((e) => e.path), ['levels[0].walls[1].thickness']);
  assert.equal(r.partial, true);
  assert.equal(r.skipped.length > 0, true);
  assert.equal(r.warnings.filter((i) => i.code === 'W116').length, 101);
  assert.equal(modelOf(r).levels[0].walls.length, flat().levels[0].walls.length - 1);
});

test('many unknown properties are listed up to the usual limit with one closing line', () => {
  const p = flat();
  for (let i = 0; i < 150; i++) p.levels[0].walls[0][`junk${i}`] = i;
  const r = analyzePlan(p);
  assert.equal(r.ok, true);
  const w = r.warnings.filter((i) => i.code === 'W116');
  assert.equal(w.length, 101);
  assert.match(w[100].message, /more issues with the code W116 are not listed/);
});

test('a number that is not finite drops its element and the model is built from the rest', () => {
  const p = flat();
  p.levels[0].furniture[0].center = [Infinity, 1];
  const r = analyzePlan(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'E010'));
  assert.equal(r.partial, true);
  assert.equal(r.skipped.length, 1);
  assert.equal(modelOf(r).levels[0].furniture.length, 8);
});

test('a "units" value that is not understood makes the whole plan unusable: nothing is salvaged and the fix names "units"', () => {
  for (const units of ['feet', 'inches', 'meters', 'centimeters', 'M', '', 5, null, true, ['m'], {}]) {
    const label = JSON.stringify(units);
    const p = flat();
    p.units = units;
    const r = analyzePlan(p);
    assert.equal(r.ok, false, label);
    assert.equal(r.normalized, null, label);
    assert.equal(r.salvaged, null, label);
    assert.equal(r.partial, false, label);
    assert.equal(modelOf(r), null, label);
    assert.deepEqual(r.skipped, [], label);
    assert.equal(r.dropped, 0, label);
    assert.deepEqual(codes(r.errors), ['E002'], `${label}: no other check runs on a plan whose scale is not known`);
    assert.equal(r.errors[0].path, 'units', label);
    assert.match(r.errors[0].fix, /Use one of "m", "cm", "mm", "ft", "in".* at units\./, label);
    assert.equal(validatePlan(p).normalized, null, label);
  }
  const feet = flat();
  feet.units = 'feet';
  assert.match(analyzePlan(feet).errors[0].fix, /closest: "ft"/);
  const many = duplex();
  many.units = 'centimeters';
  many.levels[0].walls[0].from = 'x'; // an element error next to it changes nothing: the plan is refused whole
  const r = analyzePlan(many);
  assert.equal(r.partial, false);
  assert.equal(modelOf(r), null);
  assert.deepEqual(r.skipped, []);
});

test('a missing "units" is metres, as before, and every unit the schema lists still gives a model', () => {
  const p = flat();
  delete p.units;
  let r = analyzePlan(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.normalized.sourceUnits, 'm');
  for (const units of ['m', 'cm', 'mm', 'ft', 'in']) {
    p.units = units;
    r = analyzePlan(p);
    assert.ok(modelOf(r), units);
    assert.equal(r.normalized.sourceUnits, units);
    assert.ok(!r.errors.some((e) => e.path === 'units'), units);
  }
});

test('a number that is not finite outside every element refuses the whole plan, as before, and is not partial', () => {
  const p = flat();
  p.meta = { scale: 1e999 };
  let r = analyzePlan(p);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r.errors), ['E010']);
  assert.equal(r.normalized, null);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.partial, false, 'nothing was skipped, so there is no banner to show: the plan is refused');
  assert.equal(modelOf(r), null);
  p.levels[0].furniture[0].center = 'x'; // with a skipped element the rest is shown, and the error in meta stays listed
  r = analyzePlan(p);
  assert.equal(r.partial, true);
  assert.equal(r.skipped.length, 1);
  assert.ok(codes(r.errors).includes('E010'));
  assert.equal(modelOf(r).levels[0].furniture.length, 8);
});

test('a number that is not finite inside an ignored property (W116, "$schema", "x-...") is no error and drops nothing', () => {
  const p = flat();
  p.levels[0].walls[0].conf = 1e999;
  p.levels[0].rooms[0].guess = { areas: [12, -1e999] };
  p['x-source'] = { score: 1e999 };
  p.levels[0]['x-conf'] = [1e999];
  const r = analyzePlan(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(codes(r.warnings).filter((c) => c === 'W116'), ['W116', 'W116']);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.partial, false);
  assert.equal(r.normalized.levels[0].walls.length, flat().levels[0].walls.length);
  const q = flat(); // a known property of the same wall still counts
  q.levels[0].walls[0].conf = 1e999;
  q.levels[0].walls[0].thickness = Infinity;
  const s = analyzePlan(q);
  assert.deepEqual(s.errors.map((e) => [e.code, e.path]), [['E010', 'levels[0].walls[0].thickness']]);
  assert.equal(s.partial, true);
  assert.equal(s.skipped.filter((k) => k.kind === 'wall').length, 1);
});

test('a stair that leads to a skipped level is skipped too, with its own reason', () => {
  const p = duplex();
  p.levels[1].height = -3; // the upper level cannot be read
  const r = analyzePlan(p);
  assert.equal(r.partial, true);
  assert.deepEqual(r.skipped.map((s) => [s.kind, s.id, s.path, s.reason]), [
    ['stair', 'stair-1', 'levels[0].stairs[0]', 'level-skipped'],
    ['level', 'L1', 'levels[1]', 'invalid'],
  ]);
  assert.equal(r.skipped[0].why, 'the level it leads to was skipped');
  assert.equal(r.dropped, r.skipped.length, 'the dropped count includes the stair');
  assert.ok(!codes(r.errors).includes('E009'), 'the stair is not reported as one that leads to a missing level');
  const m = modelOf(r);
  assert.equal(m.levels.length, 1);
  assert.equal(m.levels[0].stairs.length, 0);
});

test('a stair stays when the skipped level shares its id with a level that is kept, and a stair without to_level is never skipped for a level', () => {
  const p = duplex();
  const loose = { ...p.levels[0].stairs[0], id: 'out' };
  delete loose.to_level;
  p.levels[0].stairs.push(loose);
  p.levels[1].height = -3;
  let r = analyzePlan(p);
  assert.deepEqual(r.skipped.map((s) => s.kind + ':' + s.id), ['stair:stair-1', 'level:L1']);
  assert.deepEqual(modelOf(r).levels[0].stairs.map((s) => s.id), ['out']);
  const twin = JSON.parse(JSON.stringify(p.levels[1]));
  twin.height = 2.6;
  p.levels.push(twin); // a second level called L1 that can be read
  r = analyzePlan(p);
  assert.deepEqual(r.skipped.map((s) => s.kind + ':' + s.id), ['level:L1']);
  assert.deepEqual(modelOf(r).levels[0].stairs.map((s) => s.id), ['stair-1', 'out']);
});

test('ignored lists the unknown properties that were left out, with their path and name', () => {
  const p = flat();
  p.levels[0].rooms[0].furniture = [];
  p.levels[0].rooms[1].furniture = [];
  p.levels[0].walls[0].conf = 0.9;
  p.notes = 'drawn from a photo';
  p['x-tool'] = 1; // allowed silently, so it is not listed
  const r = analyzePlan(p);
  assert.deepEqual(r.ignored.map((i) => `${i.path}|${i.key}`).sort(), ['levels[0].rooms[0]|furniture', 'levels[0].rooms[1]|furniture', 'levels[0].walls[0]|conf', '|notes']);
  assert.equal(r.warnings.filter((i) => i.code === 'W116').length, r.ignored.length);
  assert.deepEqual(analyzePlan(flat()).ignored, []);
  assert.deepEqual(analyzePlan(p, { strict: true }).ignored, [], 'with strict they are errors, not ignored');
  assert.deepEqual(analyzePlan('not a plan').ignored, []);
});

test('unknown properties beyond their own limit are not collected: the plan still opens whole and ignored stops at the limit', () => {
  const p = flat();
  for (let i = 0; i < CAPS.unknownProperties + 50; i++) p[`extra${i}`] = i;
  const r = analyzePlan(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.ignored.length, CAPS.unknownProperties);
  assert.equal(r.partial, false);
  assert.ok(modelOf(r), 'the plan opens');
});
