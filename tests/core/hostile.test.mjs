// Hostile and broken input: size caps, bounded work and memory, prototype keys (docs/SPEC.md section 5, "Limits").
// The big cases run in a child process with a 256 MB heap (hostile-child.mjs), the way a small phone would see them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CAPS, hasOwn, clip } from '../../src/core/caps.js';
import { MAX_PLAN_CHARS } from '../../src/core/limits.js';
import { normalizePlan } from '../../src/core/defaults.js';
import { PLAN_SCHEMA, checkSchema, validatePlan } from '../../src/core/validate.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const flat = () => load('examples/flat-1.plan.json');
const codes = (r) => [...r.errors, ...r.warnings].map((i) => i.code);

const CHILD = fileURLToPath(new URL('./hostile-child.mjs', import.meta.url));
function child(name, asObject = false) {
  const t0 = Date.now();
  const env = asObject ? { ...process.env, HOSTILE_AS_OBJECT: '1' } : process.env;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', CHILD, name], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 24, env });
  assert.equal(r.status, 0, `${name}: child exited with ${r.status} ${r.signal || ''} ${(r.stderr || '').slice(0, 300)}`);
  return { ...JSON.parse(r.stdout.trim().split('\n').pop()), wallMs: Date.now() - t0 };
}

test('two 5,000 character ids (10 KB) validate in under a second inside a 256 MB heap', () => {
  const o = child('ids5k');
  assert.ok(o.inputBytes > 10000 && o.inputBytes < 11000, `${o.inputBytes} bytes`);
  assert.ok(o.ms < 1000, `${o.ms} ms`);
  assert.ok(o.codes.includes('E005'), o.codes.join());
  assert.ok(o.messageBytes < 8000, `${o.messageBytes} bytes of messages`);
});

test('ids of 20,000 characters (40 KB) do not crash the process, in every place an id is echoed', () => {
  for (const name of ['ids20k', 'idsEverywhere', 'unknownKey']) {
    const o = child(name);
    assert.equal(o.threw, null, name);
    assert.ok(o.ms < 1000, `${name}: ${o.ms} ms`);
    assert.ok(o.messageBytes < 12000, `${name}: ${o.messageBytes} bytes of messages`);
  }
});

test('a 20 MB string in meta.notes is rejected cheaply, as text (size limit) and as an object (E002)', () => {
  const asText = child('notes20mb');
  assert.ok(asText.ms < 2000, `${asText.ms} ms`);
  assert.deepEqual(asText.codes, ['E001']);
  assert.ok(asText.messageBytes < 4000);
  const asObject = child('notes20mb', true);
  assert.ok(asObject.ms < 2000, `${asObject.ms} ms`);
  assert.ok(asObject.codes.includes('E002'));
  assert.ok(asObject.messageBytes < 4000);
});

test('plans over a count cap are rejected in under a second, whatever the array: E013 for objects, and as text E013 or, above the size limit, E001', () => {
  for (const name of ['walls100k', 'walls20k', 'poly100k', 'furniture100k', 'levels5k']) {
    const o = child(name, true);
    assert.deepEqual(o.codes, ['E013'], name);
    assert.equal(o.ok, false);
    assert.equal(o.normalized, false);
    assert.ok(o.ms < 1000, `${name}: ${o.ms} ms`);
    const t = child(name);
    assert.deepEqual(t.codes, [t.inputBytes > MAX_PLAN_CHARS ? 'E001' : 'E013'], `${name} as text`);
    assert.equal(t.normalized, false);
    assert.ok(t.ms < 1000, `${name} as text: ${t.ms} ms`);
  }
});

test('plans at the caps finish in bounded time, and the work budget says so (W111) when it ran out', () => {
  for (const name of ['wallsAtCap', 'roomsAtCap', 'polygonsAtCap', 'maxPlan']) {
    const o = child(name);
    assert.equal(o.ok, true, name);
    assert.ok(o.ms < 4000, `${name}: ${o.ms} ms`); // about 0.5 s on an idle machine
    assert.ok(o.issues <= 400, `${name}: ${o.issues} issues`);
  }
  assert.ok(child('roomsAtCap').codes.includes('W111'));
  assert.ok(child('maxPlan').inputBytes > 1000000, 'maxPlan is the biggest plan the caps accept (12 levels of 600 walls, 600 openings, 150 rooms, 400 pieces)');
});

test('__proto__, constructor and toString as keys or as enum values are rejected and never produce NaN', () => {
  const o = child('proto');
  assert.equal(o.ok, false);
  assert.equal(o.nanThickness, 0);
  const r = validatePlan('{"version":1,"__proto__":{"x":1},"constructor":1,"toString":2,"levels":[{"id":"L0","walls":[{"id":"a","from":[0,0],"to":[6,0]},{"id":"b","from":[6,0],"to":[6,4]},{"id":"c","from":[6,4],"to":[0,0]}]}]}');
  const unknown = r.errors.filter((e) => e.code === 'E002' && /unknown property/.test(e.message)).map((e) => e.message);
  for (const k of ['__proto__', 'constructor', 'toString']) assert.ok(unknown.some((m) => m.includes(`"${k}"`)), `${k} should be an unknown property: ${unknown.join(' | ')}`);
  assert.equal(child('prototypeUnits').threw, null);
});

test('an enum value that is an Object.prototype member gets the default, not NaN, in normalizePlan', () => {
  const plan = flat();
  plan.levels[0].walls[0].kind = 'constructor';
  plan.levels[0].openings[0].type = 'toString';
  const n = normalizePlan(plan);
  assert.equal(n.levels[0].walls[0].thickness, 0.12);
  assert.ok(Number.isFinite(n.levels[0].openings[0].height) && Number.isFinite(n.levels[0].openings[0].sill));
  for (const u of ['constructor', '__proto__', 'toString']) assert.throws(() => normalizePlan({ version: 1, units: u, levels: [] }), /unknown units/);
  const r = validatePlan(plan);
  assert.equal(r.ok, false);
  for (const w of r.normalized ? r.normalized.levels[0].walls : []) assert.ok(Number.isFinite(w.thickness));
});

test('hasOwn ignores the prototype chain', () => {
  assert.equal(hasOwn({ a: 1 }, 'a'), true);
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(hasOwn({}, k), false);
  assert.equal(hasOwn(JSON.parse('{"__proto__": 1}'), '__proto__'), true);
});

test('the caps in the schema file, the embedded schema and the validator are the same numbers', () => {
  const file = load('schema/plan.v1.schema.json');
  assert.deepEqual(PLAN_SCHEMA, file);
  const level = file.$defs.level.properties;
  assert.equal(file.properties.levels.maxItems, CAPS.levels);
  for (const key of ['walls', 'openings', 'rooms', 'stairs', 'furniture']) assert.equal(level[key].maxItems, CAPS[key], key);
  assert.equal(file.$defs.room.properties.polygon.maxItems, CAPS.polygonPoints);
  // the validator and the bare schema check agree on every cap: one over is E013 here and a maxItems violation there
  const wall = (i) => ({ id: `w${i}`, from: [0, 0], to: [1, 0] });
  const make = (key, n) => {
    const p = flat();
    const L = p.levels[0];
    if (key === 'levels') p.levels = Array.from({ length: n }, (_, i) => ({ ...JSON.parse(JSON.stringify(L)), id: `L${i}` }));
    else if (key === 'polygon') L.rooms[0].polygon = Array.from({ length: n }, (_, i) => [i * 0.01, 0]);
    else L[key] = Array.from({ length: n }, (_, i) => (key === 'walls' ? wall(i) : { id: `${key}${i}` }));
    return p;
  };
  const caps = { levels: CAPS.levels, walls: CAPS.walls, openings: CAPS.openings, rooms: CAPS.rooms, stairs: CAPS.stairs, furniture: CAPS.furniture, polygon: CAPS.polygonPoints };
  for (const [key, cap] of Object.entries(caps)) {
    const over = make(key, cap + 1);
    assert.deepEqual(codes(validatePlan(over)), ['E013'], `${key} over the cap`);
    assert.ok(checkSchema(JSON.parse(JSON.stringify(over)), PLAN_SCHEMA).some((v) => v.rule === 'maxItems'), `${key}: the schema should flag it too`);
    const at = make(key, cap);
    assert.ok(!codes(validatePlan(at)).includes('E013'), `${key} at the cap is not E013`);
    assert.ok(!checkSchema(JSON.parse(JSON.stringify(at)), PLAN_SCHEMA).some((v) => v.rule === 'maxItems'), `${key} at the cap passes maxItems`);
  }
});

test('E013 names the array and the cap, with a fix', () => {
  const p = flat();
  p.levels[0].walls = Array.from({ length: CAPS.walls + 1 }, (_, i) => ({ id: `w${i}`, from: [0, 0], to: [1, 0] }));
  const r = validatePlan(p);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'E013');
  assert.equal(r.errors[0].path, 'levels[0].walls');
  assert.match(r.errors[0].message, /601 items but at most 600/);
  assert.ok(r.errors[0].fix.length > 20);
});

test('echoed values are cut to 80 characters and no message or fix is longer than the message cap', () => {
  const p = flat();
  p.levels[0].walls[0].id = 'x'.repeat(300);
  p.levels[0].openings[0].wall = 'y'.repeat(300);
  p.levels[0].rooms[0].name = 'n'.repeat(500);
  p['k'.repeat(300)] = 1;
  const r = validatePlan(p);
  for (const i of [...r.errors, ...r.warnings]) {
    assert.ok(i.message.length <= CAPS.message && i.fix.length <= CAPS.message, `${i.code} ${i.message.length}/${i.fix.length}`);
    assert.ok(!/x{81}|y{81}|k{81}/.test(i.message + i.fix + i.path), `${i.code} echoes a long value: ${i.message.slice(0, 120)}`);
  }
  assert.equal(clip('a'.repeat(200)).length, CAPS.echo);
  assert.equal(clip('short'), 'short');
});

test('one code never lists more than 100 issues, and the last one says how many were left out', () => {
  const p = flat();
  p.levels[0].walls = Array.from({ length: 300 }, (_, i) => ({ id: `z${i}`, from: [1, 1], to: [1, 1] }));
  const r = validatePlan(p);
  const e004 = r.errors.filter((e) => e.code === 'E004');
  assert.equal(e004.length, 101);
  assert.match(e004[100].message, /more issues with the code E004 are not listed/);
});

test('did-you-mean still works for short typos next to long neighbours', () => {
  const p = flat();
  const wall = p.levels[0].walls[0];
  p.levels[0].openings[0].wall = `${wall.id}x`;
  const r = validatePlan(p);
  const e = r.errors.find((i) => i.code === 'E005');
  assert.ok(e && e.fix.includes(`probably "${wall.id}"`), e && e.fix);
});

test('a meta nested 100,000 deep, and a number that parses to Infinity inside it, do not hang or throw', () => {
  const walls = '[{"id":"a","from":[0,0],"to":[6,0]},{"id":"b","from":[6,0],"to":[6,4]},{"id":"c","from":[6,4],"to":[0,0]}]';
  const deep = `{"version":1,"meta":{"deep":${'['.repeat(100000)}1${']'.repeat(100000)}},"levels":[{"id":"L0","walls":${walls}}]}`;
  const t0 = Date.now();
  const r = validatePlan(deep);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  assert.equal(r.ok, true);
  const inf = validatePlan(`{"version":1,"meta":{"x":1e999},"levels":[{"id":"L0","walls":${walls}}]}`);
  assert.ok(inf.errors.some((e) => e.code === 'E010'));
});

test('checkSchema called on its own offers "did you mean" every time, not only until a shared budget runs out', () => {
  const p = flat();
  const level = { wals: [], ...p.levels[0] }; // a typo first, so each call asks for its suggestion with the budget it was given
  for (let i = 0; i < 900; i++) level[`wallz${i}`] = 1; // 900 near misses use up part of the budget of every call
  p.levels[0] = level;
  for (let call = 0; call < 12; call++) {
    const viol = checkSchema(p, PLAN_SCHEMA);
    assert.ok(viol.some((v) => /unknown property "wals" \(did you mean "walls"\?\)/.test(v.detail)), `call ${call} found no suggestion`);
  }
});

test('E014: a point more than 1000 m from the origin is an error with a fix, one at 1000 m is not, and E011 keeps the wrong scale', () => {
  const at = (mutate) => { const p = flat(); mutate(p.levels[0]); const r = validatePlan(p); return { r, e014: r.errors.filter((e) => e.code === 'E014') }; };
  assert.equal(at((L) => { L.rooms[0].polygon[2][1] = 1000; }).e014.length, 0);
  const far = at((L) => { L.rooms[0].polygon[2][1] = 1001; });
  assert.equal(far.e014.length, 1);
  assert.equal(far.e014[0].path, 'levels[0].rooms[0]');
  assert.equal(far.e014[0].id, flat().levels[0].rooms[0].id);
  assert.match(far.e014[0].message, /more than 1000 m from the origin/);
  assert.match(far.e014[0].fix, /extra digit/);
  assert.equal(far.r.ok, false);
  const wall = at((L) => { L.walls[0].to[1] = 1e6; });
  assert.ok(codes(wall.r).includes('E011') && !codes(wall.r).includes('E014'), 'a far wall end is the scale error');
  assert.equal(CAPS.coordinate, 1000);
});
