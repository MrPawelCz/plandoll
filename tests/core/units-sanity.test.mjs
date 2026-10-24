// W112 to W115: sizes that look like a unit slip (centimetres written as metres), and no false alarms on real plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RANGES, validatePlan } from '../../src/core/validate.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const flat = () => load('examples/flat-1.plan.json');
const duplex = () => load('examples/duplex-1.plan.json');
const warn = (plan, code) => validatePlan(plan).warnings.filter((w) => w.code === code);

const withFurniture = (item) => {
  const p = flat();
  p.levels[0].furniture = [{ id: 'f1', center: [2, 2], ...item }];
  p.levels[0].rooms[0].polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
  return p;
};

test('the bundled examples and fixtures raise none of the unit warnings, and the references stay warning-free', () => {
  const files = [
    ...readdirSync(new URL('../../examples/', import.meta.url)).filter((f) => f.endsWith('.plan.json')).map((f) => `examples/${f}`),
    ...readdirSync(new URL('../../tests/fixtures/', import.meta.url)).filter((f) => f.endsWith('.plan.json')).map((f) => `tests/fixtures/${f}`),
  ];
  assert.ok(files.length >= 4, files.join());
  for (const f of files) {
    const r = validatePlan(load(f));
    const slips = r.warnings.filter((w) => ['W111', 'W112', 'W113', 'W114', 'W115'].includes(w.code));
    assert.deepEqual(slips, [], `${f}: ${slips.map((w) => w.message).join(' | ')}`);
  }
  for (const f of ['examples/flat-1.plan.json', 'examples/duplex-1.plan.json', 'tests/fixtures/duplex-min.plan.json']) assert.deepEqual(validatePlan(load(f)).warnings, [], f);
});

test('W112: furniture written in centimetres (bookshelf size [90, 30]) gets a warning with the metre values', () => {
  const [w] = warn(withFurniture({ type: 'bookshelf', size: [90, 30] }), 'W112');
  assert.ok(w, 'expected W112');
  assert.equal(w.path, 'levels[0].furniture[0]');
  assert.equal(w.id, 'f1');
  assert.match(w.message, /bookshelf has width 90 m, depth 30 m, more than the 6 m/);
  assert.match(w.fix, /centimetres/);
  assert.match(w.fix, /0\.9 x 0\.3/);
});

test('W112: a height of 190 on a bookshelf, and each dimension on its own', () => {
  assert.equal(warn(withFurniture({ type: 'bookshelf', size: [0.9, 0.3], height: 190 }), 'W112').length, 1);
  assert.equal(warn(withFurniture({ type: 'wardrobe', size: [1, 0.6], height: 210 }), 'W112').length, 1);
  assert.equal(warn(withFurniture({ type: 'sofa', size: [200, 0.9] }), 'W112').length, 1);
  assert.equal(warn(withFurniture({ type: 'sofa', size: [2, 90] }), 'W112').length, 1);
  assert.equal(RANGES.furniture, 6);
  assert.equal(warn(withFurniture({ type: 'rug', size: [6, 4] }), 'W112').length, 0, 'exactly 6 m is allowed');
  assert.equal(warn(withFurniture({ type: 'rug', size: [6.1, 4] }), 'W112').length, 1);
});

test('W112: a piece more than twice as long as its room', () => {
  const p = flat();
  const L = p.levels[0];
  L.rooms = [{ id: 'closet', name: 'Closet', polygon: [[0, 0], [2, 0], [2, 2.5], [0, 2.5]] }];
  L.furniture = [{ id: 'f1', type: 'rug', center: [1, 1], size: [5.6, 1] }];
  const [w] = warn(p, 'W112');
  assert.ok(w && /twice as long as room "closet"/.test(w.message), w && w.message);
  L.furniture[0].size = [4.9, 1];
  assert.equal(warn(p, 'W112').length, 0, 'less than twice the room span is left alone');
});

test('W113: a level height of 270 (centimetres written as metres), 1.5 and 8 are outside 2 to 6 m', () => {
  const p = flat();
  p.levels[0].height = 270;
  const [w] = warn(p, 'W113');
  assert.ok(w, 'expected W113');
  assert.equal(w.path, 'levels[0]');
  assert.match(w.message, /270 m high/);
  assert.match(w.message, /centimetres written as metres/);
  assert.match(w.fix, /write 2\.7 \(metres\)/);
  for (const h of [1.5, 8]) { p.levels[0].height = h; assert.equal(warn(p, 'W113').length, 1, `height ${h}`); }
  for (const h of [2, 2.4, 2.7, 3.2, 6]) { p.levels[0].height = h; assert.equal(warn(p, 'W113').length, 0, `height ${h}`); }
});

test('W113 is not raised for a plan in centimetres whose numbers are right, nor when the scale is already wrong (E011)', () => {
  const cm = JSON.parse(JSON.stringify(flat()));
  const scale = (v) => (Array.isArray(v) ? v.map(scale) : typeof v === 'number' ? v * 100 : v);
  cm.units = 'cm';
  cm.levels[0].height = 270;
  for (const w of cm.levels[0].walls) { w.from = scale(w.from); w.to = scale(w.to); if (w.thickness) w.thickness *= 100; }
  assert.equal(warn(cm, 'W113').length, 0);
  const tiny = flat();
  tiny.levels[0].height = 270;
  for (const w of tiny.levels[0].walls) { w.from = w.from.map((v) => v / 100); w.to = w.to.map((v) => v / 100); }
  const r = validatePlan(tiny);
  assert.ok(r.errors.some((e) => e.code === 'E011'));
  assert.equal(r.warnings.filter((w) => w.code === 'W113').length, 0);
});

test('W114: stair width below 0.5 m or above 3 m', () => {
  const p = duplex();
  const stair = p.levels.find((l) => l.stairs && l.stairs.length).stairs[0];
  stair.width = 0.3;
  const [w] = warn(p, 'W114');
  assert.ok(w, 'expected W114');
  assert.match(w.message, /stair is 0\.3 m wide/);
  stair.width = 3.5;
  assert.equal(warn(p, 'W114').length, 1);
  stair.width = 120;
  assert.match(warn(p, 'W114')[0].message, /centimetres written as metres/);
  for (const v of [0.5, 0.9, 1.2, 3]) { stair.width = v; assert.equal(warn(p, 'W114').length, 0, `width ${v}`); }
});

test('W115: window width below 0.3 m or above 4 m (doors keep W104)', () => {
  const p = flat();
  const win = p.levels[0].openings.find((o) => o.type === 'window');
  win.width = 0.2;
  assert.equal(warn(p, 'W115').length, 1);
  win.width = 4.5;
  assert.equal(warn(p, 'W115').length, 1);
  win.width = 150;
  assert.match(warn(p, 'W115')[0].message, /centimetres written as metres/);
  for (const v of [0.3, 0.6, 1.2, 2.4]) { win.width = v; assert.equal(warn(p, 'W115').length, 0, `width ${v}`); }
  const door = p.levels[0].openings.find((o) => o.type === 'door');
  door.width = 2.5;
  assert.equal(warn(p, 'W115').length, 0);
  assert.ok(warn(p, 'W104').length >= 1, 'a 2.5 m door is still W104');
});

test('every new warning carries a concrete message with the value and a fix sentence', () => {
  const p = withFurniture({ type: 'bookshelf', size: [90, 30], height: 190 });
  p.levels[0].height = 270;
  const r = validatePlan(p);
  for (const code of ['W112', 'W113']) {
    const w = r.warnings.find((x) => x.code === code);
    assert.ok(w, code);
    assert.ok(/\d/.test(w.message) && w.fix.length > 30, `${code}: ${w.message} / ${w.fix}`);
  }
});
