import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAN_SCHEMA, netArea, roomGraph, validatePlan } from '../../src/core/validate.js';
import { polygonArea } from '../../src/core/geom2d.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const flat = () => load('examples/flat-1.plan.json');
const codes = (r) => [...r.errors, ...r.warnings].map((i) => i.code);

test('the reference examples validate cleanly and normalize to metres', () => {
  for (const p of ['examples/flat-1.plan.json', 'tests/fixtures/duplex-min.plan.json']) {
    const r = validatePlan(load(p));
    assert.equal(r.ok, true, `${p}: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, [], `${p} should have no warnings`);
    assert.ok(r.normalized);
  }
});

test('E001: not an object', () => {
  for (const bad of [null, 'text', 42, []]) {
    const r = validatePlan(bad);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'E001');
    assert.equal(r.normalized, null);
  }
});

test('E002: schema violation names the path', () => {
  const p = flat();
  p.units = 'yards';
  const r = validatePlan(p);
  assert.ok(r.errors.some((i) => i.code === 'E002' && /units/.test(i.path + i.message)));
});

test('E003: duplicate ids', () => {
  const p = flat();
  p.levels[0].walls[1].id = p.levels[0].walls[0].id;
  assert.ok(codes(validatePlan(p)).includes('E003'));
});

test('E004: wall of zero length', () => {
  const p = flat();
  p.levels[0].walls[0].to = [...p.levels[0].walls[0].from];
  assert.ok(codes(validatePlan(p)).includes('E004'));
});

test('E005: opening on a missing wall', () => {
  const p = flat();
  p.levels[0].openings[0].wall = 'no-such-wall';
  assert.ok(codes(validatePlan(p)).includes('E005'));
});

test('E006: opening does not fit its wall, and overlapping openings', () => {
  const p = flat();
  const wall = p.levels[0].walls[0];
  p.levels[0].openings.push({ id: 'too-wide', wall: wall.id, type: 'door', offset: 7.5, width: 1.5 });
  assert.ok(codes(validatePlan(p)).includes('E006'));

  const q = load('tests/fixtures/duplex-min.plan.json');
  q.levels[0].openings.push({ id: 'overlap', wall: 'g1', type: 'window', offset: 2.0, width: 1.4 });
  assert.ok(codes(validatePlan(q)).includes('E006'));
});

test('E007: opening taller than the wall', () => {
  const p = flat();
  p.levels[0].openings[0].height = 3.5;
  assert.ok(codes(validatePlan(p)).includes('E007'));
});

test('a two point room polygon is a schema violation (E002)', () => {
  const p = flat();
  p.levels[0].rooms[0].polygon = [[0, 0], [1, 0]];
  assert.ok(codes(validatePlan(p)).includes('E002'));
});

test('E008: repeated points, self-intersecting and tiny room polygons', () => {
  for (const polygon of [[[0, 0], [1, 0], [1, 0]], [[0, 0], [2, 2], [2, 0], [0, 2]], [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]]]) {
    const p = flat();
    p.levels[0].rooms[0].polygon = polygon;
    assert.ok(codes(validatePlan(p)).includes('E008'), JSON.stringify(polygon));
  }
});

test('E009: stair to a missing level, or to its own level', () => {
  const p = load('tests/fixtures/duplex-min.plan.json');
  p.levels[0].stairs[0].to_level = 'nope';
  assert.ok(codes(validatePlan(p)).includes('E009'));
  p.levels[0].stairs[0].to_level = 'L0';
  assert.ok(codes(validatePlan(p)).includes('E009'));
});

// A stair in a one-floor plan: no "to_level" means the stair leaves the plan (it is valid), "rise" gives the direction.
const upStair = { id: 'st', from: [1, 3.2], to: [1, 5.8], width: 0.9, steps: 14 };
const withStair = (stair, patch = (p) => p) => { const p = flat(); p.levels[0].stairs = [stair]; return patch(p); };

test('stairs without to_level are valid in a plan of one floor, up by default and down with a negative rise', () => {
  for (const stair of [upStair, { ...upStair, rise: -3 }, { ...upStair, rise: 3 }]) {
    const r = validatePlan(withStair(stair));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(!codes(r).includes('E009'));
    assert.equal(r.normalized.levels[0].stairs[0].to_level, undefined);
  }
  assert.equal(validatePlan(withStair({ ...upStair, rise: -3 })).normalized.levels[0].stairs[0].rise, -3);
  const cm = withStair({ ...upStair, from: [100, 320], to: [100, 580], width: 90, rise: -300 }, (p) => {
    p.units = 'cm';
    for (const w of p.levels[0].walls) { w.from = w.from.map((v) => v * 100); w.to = w.to.map((v) => v * 100); }
    p.levels[0].openings = []; p.levels[0].rooms = []; p.levels[0].furniture = [];
    return p;
  });
  assert.equal(validatePlan(cm).normalized.levels[0].stairs[0].rise, -3, 'rise is converted from the plan units');
});

test('E012: a stair that climbs 0, and E009 hints that point the right way', () => {
  assert.ok(codes(validatePlan(withStair({ ...upStair, rise: 0 }))).includes('E012'));
  assert.ok(codes(validatePlan(withStair({ ...upStair, rise: 0.005 }))).includes('E012'), 'under 1 cm climbs nowhere too (the page would skip it)');
  assert.ok(!codes(validatePlan(withStair({ ...upStair, rise: 0.5 }))).includes('E012'));
  for (const to_level of ['L1', 'L0']) {
    const r = validatePlan(withStair({ ...upStair, to_level }));
    const e = r.errors.find((i) => i.code === 'E009');
    assert.ok(e, `to_level ${to_level} on a one-level plan must be an error`);
    assert.match(e.fix, /delete "to_level"/);
    assert.doesNotMatch(e.fix, /to one of/, 'a one-level plan has nothing to point at');
  }
  const duplex = load('tests/fixtures/duplex-min.plan.json');
  duplex.levels[0].stairs[0].to_level = 'L2';
  const e = validatePlan(duplex).errors.find((i) => i.code === 'E009');
  assert.match(e.fix, /"L1"/);
  assert.doesNotMatch(e.fix, /one of "L0"/, 'the stair own level is never a suggestion');
});

test('E010: NaN and infinity', () => {
  const p = flat();
  p.levels[0].walls[0].to = [Number.NaN, 0];
  assert.ok(codes(validatePlan(p)).includes('E010'));
  const q = flat();
  q.levels[0].walls[0].to = [Number.POSITIVE_INFINITY, 0];
  assert.ok(codes(validatePlan(q)).includes('E010'));
});

test('E011: implausible scale suggests the likely units', () => {
  const p = flat();
  for (const w of p.levels[0].walls) { w.from = w.from.map((v) => v * 100); w.to = w.to.map((v) => v * 100); }
  const r = validatePlan(p);
  const e = r.errors.find((i) => i.code === 'E011');
  assert.ok(e, 'a plan drawn in centimetres but declared in metres must be flagged');
  assert.match(e.message + e.fix, /cm/);
});

test('units are converted: the same flat in centimetres normalizes to the same size', () => {
  const m = validatePlan(flat());
  const cm = flat();
  cm.units = 'cm';
  for (const w of cm.levels[0].walls) { w.from = w.from.map((v) => v * 100); w.to = w.to.map((v) => v * 100); if (w.thickness) w.thickness *= 100; }
  for (const o of cm.levels[0].openings) { o.offset *= 100; o.width *= 100; if (o.height) o.height *= 100; if (o.sill) o.sill *= 100; }
  for (const r of cm.levels[0].rooms) { r.polygon = r.polygon.map((pt) => pt.map((v) => v * 100)); if (r.area) r.area *= 10000; }
  for (const f of cm.levels[0].furniture) { f.center = f.center.map((v) => v * 100); if (f.size) f.size = f.size.map((v) => v * 100); if (f.height) f.height *= 100; }
  const r = validatePlan(cm);
  assert.ok(r.normalized, JSON.stringify(r.errors));
  const wm = m.normalized.levels[0].walls[0], wc = r.normalized.levels[0].walls[0];
  assert.ok(Math.abs(wm.length - wc.length) < 1e-6);
});

test('W102: declared area differs from the polygon', () => {
  const p = flat();
  p.levels[0].rooms[0].area = 99;
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  assert.ok(codes(r).includes('W102'));
});

// A 4 x 3 m room with 0.2 m walls: 12 m2 along the centerlines, 3.8 x 2.8 = 10.64 m2 net of the walls.
const room43 = (area, drop = []) => ({
  version: 1, units: 'm',
  levels: [{
    id: 'L0',
    walls: [
      { id: 'n', from: [0, 0], to: [4, 0], kind: 'exterior', thickness: 0.2 },
      { id: 'e', from: [4, 0], to: [4, 3], kind: 'exterior', thickness: 0.2 },
      { id: 's', from: [4, 3], to: [0, 3], kind: 'exterior', thickness: 0.2 },
      { id: 'w', from: [0, 3], to: [0, 0], kind: 'exterior', thickness: 0.2 },
    ].filter((w) => !drop.includes(w.id)),
    openings: [{ id: 'front', wall: 's', type: 'door', offset: 1, width: 0.9 }],
    rooms: [{ id: 'r', name: 'Room', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], area }],
  }],
});

test('W102 accepts a declared area that is net of the walls (printed areas) or along the centerlines', () => {
  for (const area of [10.64, 10.2, 11.0, 12, 12.3]) assert.ok(!codes(validatePlan(room43(area))).includes('W102'), `${area} m2`);
});

test('W102 still reports an area that fits neither convention', () => {
  for (const area of [9, 8, 14]) {
    const w = validatePlan(room43(area)).warnings.find((i) => i.code === 'W102');
    assert.ok(w, `${area} m2`);
    assert.match(w.message, /10\.64 m2 net of the walls, which is \d+(\.\d+)?% (more|less) than declared/);
    assert.match(w.fix, /net/);
  }
});

// A room traced along walls of the given thicknesses (one wall per polygon edge) with an entrance door on the last wall.
const tracedRoom = (polygon, thick, area) => ({
  version: 1, units: 'm',
  levels: [{
    id: 'L0',
    walls: polygon.map((p, i) => ({ id: `e${i}`, from: p, to: polygon[(i + 1) % polygon.length], kind: 'exterior', thickness: thick[i] })),
    openings: [{ id: 'front', wall: `e${polygon.length - 1}`, type: 'door', offset: 0.5, width: 0.9 }],
    rooms: [{ id: 'r', name: 'Room', polygon, area }],
  }],
});

test('netArea survives a nearly straight corner between walls of different thickness, and a room thinner than its walls', () => {
  const poly = [[0, 0], [4, 0], [8, 0.02], [8, 4], [0, 4]];
  const plan = tracedRoom(poly, [0.3, 0.12, 0.12, 0.12, 0.12], 1);
  const L = validatePlan(plan).normalized.levels[0];
  const centre = Math.abs(polygonArea(L.rooms[0].polygon));
  const net = netArea(L.rooms[0].polygon, L.walls);
  assert.ok(net > 0.85 * centre && net < centre, `${net} of ${centre}`);
  plan.levels[0].rooms[0].area = net;
  assert.ok(!codes(validatePlan(plan)).includes('W102'), 'the exact net area must not be flagged');
  const thin = [[0, 0], [4, 0], [4, 0.3], [0, 0.3]];
  const T = validatePlan(tracedRoom(thin, [0.4, 0.4, 0.4, 0.4], 1)).normalized.levels[0];
  const x = netArea(T.rooms[0].polygon, T.walls);
  assert.ok(Number.isFinite(x) && x >= 0 && x <= 1.2 + 1e-9, `${x}`);
});

test('W102 keeps the 5% limit where no wall runs along the room, because there is nothing to subtract', () => {
  const inside = (area) => { const p = room43(area); p.levels[0].rooms[0].polygon = [[1, 0.5], [3, 0.5], [3, 2.5], [1, 2.5]]; return p; }; // 4 m2, walls 0.5 m away
  assert.ok(codes(validatePlan(inside(4.28))).includes('W102'), '7% off');
  assert.ok(!codes(validatePlan(inside(4.15))).includes('W102'), '3.7% off');
});

test('netArea moves every walled edge in by half the wall thickness and leaves open edges alone', () => {
  const area = (plan) => { const n = validatePlan(plan).normalized.levels[0]; return netArea(n.rooms[0].polygon, n.walls.filter((w) => w.length > 0)); };
  assert.ok(Math.abs(area(room43(10)) - 10.64) < 1e-6);
  assert.ok(Math.abs(area(room43(10, ['w'])) - 10.92) < 1e-6, 'the open west edge does not move: 3.9 x 2.8');
  const l = room43(10);
  l.levels[0].walls = [[[0, 0], [4, 0]], [[4, 0], [4, 2]], [[4, 2], [2, 2]], [[2, 2], [2, 4]], [[2, 4], [0, 4]], [[0, 4], [0, 0]]]
    .map(([from, to], i) => ({ id: `l${i}`, from, to, kind: 'exterior', thickness: 0.2 }));
  l.levels[0].rooms[0].polygon = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  l.levels[0].openings = [{ id: 'front', wall: 'l4', type: 'door', offset: 0.5, width: 0.9 }];
  assert.ok(Math.abs(area(l) - 10.44) < 1e-6, 'an L shape with a reflex corner: 12 m2 along the centerlines');
});

test('W104: door outside 0.6 to 1.2 m', () => {
  const p = flat();
  const d = p.levels[0].openings.find((o) => o.type === 'door');
  d.width = 1.5;
  assert.ok(codes(validatePlan(p)).includes('W104'));
});

test('W108: no exterior door means no entrance', () => {
  const p = flat();
  p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'front');
  assert.ok(codes(validatePlan(p)).includes('W108'));
});

test('W108 is not raised for an upper floor: elevation above the ground, or a stair that arrives from below', () => {
  const noDoor = (patch) => { const p = flat(); p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'front'); return patch(p); };
  assert.ok(!codes(validatePlan(noDoor((p) => { p.levels[0].elevation = 3; return p; }))).includes('W108'));
  assert.ok(!codes(validatePlan(noDoor((p) => { p.levels[0].stairs = [{ ...upStair, rise: -3 }]; return p; }))).includes('W108'));
  assert.ok(codes(validatePlan(noDoor((p) => { p.levels[0].stairs = [upStair]; return p; }))).includes('W108'), 'a stair that only goes up does not bring anybody in');
  assert.match(validatePlan(noDoor((p) => p)).warnings.find((i) => i.code === 'W108').fix, /do not invent a door/);
});

test('W105: a room that no door reaches from the entrance', () => {
  const p = flat();
  p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'd-living-bed');
  const r = validatePlan(p);
  assert.equal(r.ok, true);
  assert.ok(codes(r).includes('W105'));
});

test('W105 counts rooms that share an open edge (no wall between them) as connected', () => {
  // flat-1: take out the door and the wall between living room and bedroom; the polygons still share x = 5, y 0 to 3
  const open = flat();
  open.levels[0].walls = open.levels[0].walls.filter((w) => w.id !== 'w5');
  open.levels[0].openings = open.levels[0].openings.filter((o) => o.id !== 'd-living-bed');
  const r = validatePlan(open);
  assert.ok(!codes(r).includes('W105'), JSON.stringify(r.warnings.map((i) => i.code)));
  const walled = flat();
  walled.levels[0].openings = walled.levels[0].openings.filter((o) => o.id !== 'd-living-bed');
  const w = validatePlan(walled).warnings.find((i) => i.code === 'W105');
  assert.ok(w, 'a wall without a door still separates the rooms');
  assert.match(w.fix, /leave the wall out/);
  const graph = (plan, opts) => roomGraph(validatePlan(plan).normalized, opts).edges.map((e) => e.via);
  assert.ok(graph(open, { open: true }).includes('open'));
  assert.ok(!graph(open).includes('open'), 'the default graph counts doors, passages and stairs only');
});

test('W105: a wall still separates two rooms whose polygons run 0.12 m beside its centerline', () => {
  const p = flat();
  p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'd-living-bed');
  const living = p.levels[0].rooms.find((r) => r.id === 'living'), bedroom = p.levels[0].rooms.find((r) => r.id === 'bedroom');
  living.polygon = [[0, 0], [5.12, 0], [5.12, 3], [0, 3]];
  bedroom.polygon = [[5.12, 0], [8, 0], [8, 3], [5.12, 3]];
  assert.ok(validatePlan(p).warnings.some((i) => i.code === 'W105' && i.id === 'bedroom'), 'a wall within its own thickness of the shared edge is a wall (the rule W101 uses)');
});

test('W105 also runs on a drawing of an upper floor: the room at the top of the arriving stair is the entrance', () => {
  const upper = (patch) => {
    const p = flat();
    p.levels[0].elevation = 3;
    p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'front');
    p.levels[0].stairs = [{ id: 'arrive', from: [1, 1.2], to: [3.2, 1.2], width: 0.9, steps: 14, rise: -3 }];
    return patch(p);
  };
  assert.deepEqual(codes(validatePlan(upper((p) => p))), [], 'every room is reachable from the living room, and there is no W108');
  const cut = validatePlan(upper((p) => { p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'd-living-bed'); return p; }));
  assert.ok(cut.warnings.some((i) => i.code === 'W105' && i.id === 'bedroom'));
});

test('W106 reports a wall end that just misses another wall, not a free end far from every wall', () => {
  const near = flat();
  near.levels[0].walls.find((w) => w.id === 'w5').to = [5, 2.8]; // 0.2 m short of the wall at y = 3
  const hit = validatePlan(near).warnings.find((i) => i.code === 'W106');
  assert.ok(hit);
  assert.match(hit.message, /just misses wall "w6"/);
  const far = flat();
  far.levels[0].walls.find((w) => w.id === 'w5').to = [5, 1.5]; // free end 1.5 m from the next wall
  assert.ok(!codes(validatePlan(far)).includes('W106'));
});

test('ids may contain dots, scale_note may be 1000 characters, and the embedded schema is the schema file', () => {
  const p = flat();
  p.levels[0].rooms[0].id = 'L1-0.1';
  p.meta = { source: 'image', scale_note: 'x'.repeat(1000) };
  assert.equal(validatePlan(p).ok, true);
  p.meta.scale_note = 'x'.repeat(1001);
  assert.ok(codes(validatePlan(p)).includes('E002'));
  const q = flat();
  q.levels[0].rooms[0].id = 'my room';
  const e = validatePlan(q).errors.find((i) => i.code === 'E002');
  assert.match(e.message, /letters, digits, "_", "-" and "\."/);
  assert.deepEqual(PLAN_SCHEMA, load('schema/plan.v1.schema.json'));
});

test('W109 and W110: furniture outside rooms, level without rooms', () => {
  const p = flat();
  p.levels[0].furniture[0].center = [50, 50];
  assert.ok(codes(validatePlan(p)).includes('W109'));
  const q = flat();
  q.levels[0].rooms = [];
  assert.ok(codes(validatePlan(q)).includes('W110'));
});

test('every issue carries a concrete message and a fix sentence to be pasted back and fixed', () => {
  const p = flat();
  p.levels[0].openings[0].wall = 'ghost';
  p.levels[0].rooms[0].area = 1;
  p.levels[0].openings[1].height = 9;
  const r = validatePlan(p);
  assert.ok(r.errors.length >= 2 && r.warnings.length >= 1);
  for (const i of [...r.errors, ...r.warnings]) {
    assert.match(i.code, /^[EW]\d{3}$/);
    assert.ok(typeof i.path === 'string');
    assert.ok(i.message.length > 15, i.message);
    assert.ok(i.fix.length > 15, `${i.code} has no fix text`);
  }
});
