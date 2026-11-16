// Mutation tests for the audit rules S1..S4, E1..E7, P1..P6 (tools/audit/rules2.mjs): a clean fixture passes, a deliberate fault is reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadRepo, buildAll } from '../../tools/audit/data.mjs';
import { auditModel } from '../../tools/audit/rules.mjs';
import { RULES2 } from '../../tools/audit/rules2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await loadRepo(ROOT);
const piece = (id, type, room, x, y, rot = 0, extra = {}) => {
  const s = R.specs.SPEC_BY_ID[type];
  return { id, type, room, x, y, rot, size: extra.size ?? [...s.size], elev: extra.elev ?? 0, on: extra.on ?? null, colors: {} };
};
const audit = (plan, levels) => {
  const model = buildAll(R, plan);
  const lay = { version: 1, levels: model.levels.map((L) => ({ id: L.id, pieces: levels[L.id] ?? [] })) };
  return auditModel(model, lay, R.specs, { rooms: R.rooms }).violations.filter((v) => RULES2.includes(v.rule));
};
const count = (V, rule) => V.filter((v) => v.rule === rule).length;
const wall = (id, a, b, kind = 'interior') => ({ id, from: a, to: b, kind });
const room = (id, name, use, polygon) => ({ id, name, use, polygon, floor: 'wood' });

// ---- fixture 1: a flat on one level, built to be clean for the E and P rules
function flat() {
  return {
    version: 1, name: 'fixture', units: 'm', meta: {},
    levels: [{
      id: 'L0', name: 'Ground', height: 2.7,
      walls: [wall('n', [0, 0], [12, 0], 'exterior'), wall('e', [12, 0], [12, 8], 'exterior'), wall('s', [12, 8], [0, 8], 'exterior'), wall('w', [0, 8], [0, 0], 'exterior'),
        wall('mid', [0, 4], [12, 4]), wall('vh', [9, 0], [9, 8]), wall('vp', [1.2, 4], [1.2, 8])],
      openings: [
        { id: 'front', wall: 'n', type: 'door', offset: 10.5, width: 1, hinge: 'start', opens_to: 'left' },
        { id: 'd-hl', wall: 'vh', type: 'door', offset: 1.5, width: 0.9, hinge: 'start', opens_to: 'left' },
        { id: 'd-pan', wall: 'mid', type: 'door', offset: 0.15, width: 0.8, hinge: 'start', opens_to: 'left' },
        { id: 'd-stu', wall: 'mid', type: 'door', offset: 4, width: 0.9, hinge: 'start', opens_to: 'left' },
        { id: 'd-bat', wall: 'mid', type: 'door', offset: 10, width: 0.9, hinge: 'start', opens_to: 'right' },
        { id: 'wl', wall: 'n', type: 'window', offset: 1, width: 2.6 }, { id: 'wl2', wall: 'n', type: 'window', offset: 5, width: 2 },
        { id: 'ws', wall: 's', type: 'window', offset: 3, width: 1.5 },
      ],
      rooms: [
        room('living', 'Living room', 'living', [[0, 0], [9, 0], [9, 4], [0, 4]]), room('hall', 'Hall', 'hall', [[9, 0], [12, 0], [12, 4], [9, 4]]),
        room('pantry', 'Pantry', 'storage', [[0, 4], [1.2, 4], [1.2, 8], [0, 8]]), room('study', 'Study', 'office', [[1.2, 4], [9, 4], [9, 8], [1.2, 8]]),
        room('bath', 'Bathroom', 'bathroom', [[9, 4], [12, 4], [12, 8], [9, 8]]),
      ],
    }],
  };
}
const CLEAN = [
  piece('k1', 'kitchen-base', 'living', 0.5, 0.45, 0), piece('k2', 'kitchen-sink', 'living', 1.4, 0.45, 0), piece('k3', 'kitchen-hob', 'living', 2.3, 0.45, 0),
  piece('k4', 'kitchen-base', 'living', 2.9, 0.45, 0), piece('k5', 'fridge', 'living', 3.5, 0.475, 0),
  piece('t1', 'dining-table', 'living', 2.5, 2.4, 0), piece('c1', 'dining-chair', 'living', 2.0, 1.75, 0), piece('c2', 'dining-chair', 'living', 3.0, 1.75, 0),
  piece('c3', 'dining-chair', 'living', 2.0, 3.05, 180), piece('c4', 'dining-chair', 'living', 3.0, 3.05, 180),
  piece('s1', 'sofa3', 'living', 6.5, 3.4, 180), piece('a1', 'armchair', 'living', 7.8, 2.0, 90), piece('bn', 'bench', 'hall', 10.5, 0.35, 0), piece('ac', 'armchair', 'study', 2.5, 5.0, 0), piece('a2', 'art-large', 'living', 5.0, 0.2, 0),
  piece('p1', 'bookshelf', 'pantry', 0.8, 7.7, 180),
  piece('d1', 'desk', 'study', 6.5, 7.5, 180), piece('dc', 'desk-chair', 'study', 6.5, 6.7, 0), piece('bs', 'bookshelf', 'study', 3.5, 7.75, 180),
];
const pick = (...ids) => CLEAN.filter((p) => ids.includes(p.id));
const without = (...ids) => CLEAN.filter((p) => !ids.includes(p.id));
const fl = (extra = [], lay = CLEAN) => ({ L0: [...lay, ...extra] });
const V1 = (lay) => audit(flat(), { L0: lay });

test('clean fixture: no hard violation of the new rules', () => {
  const V = audit(flat(), fl());
  assert.deepEqual(V.filter((v) => v.hard).map((v) => `${v.rule} ${v.detail}`), []);
});

test('E1: a lone kitchen unit (a base cabinet far from the run)', () => {
  const V = audit(flat(), fl([piece('m1', 'kitchen-base', 'living', 8.0, 0.45, 0)]));
  assert.ok(V.some((v) => v.rule === 'E1' && /stands alone/.test(v.detail)), JSON.stringify(V.map((v) => v.rule)));
});

test('E1: sink and hob 4 m apart in separate runs', () => {
  const lay = [...without('k1', 'k2', 'k3', 'k4', 'k5'), piece('k1', 'kitchen-base', 'living', 0.5, 0.45, 0), piece('k2', 'kitchen-sink', 'living', 1.4, 0.45, 0), piece('k3', 'kitchen-hob', 'living', 5.5, 0.45, 0), piece('k4', 'kitchen-base', 'living', 6.1, 0.45, 0)];
  assert.ok(V1(lay).some((v) => v.rule === 'E1' && /apart/.test(v.detail)));
});

test('E2: a dining table with four chairs in a room that is not joined to the kitchen', () => {
  const lay = [...without('t1', 'c1', 'c2', 'c3', 'c4'), piece('t2', 'dining-table', 'bath', 10.5, 6.0, 0), piece('e1', 'dining-chair', 'bath', 10.0, 5.35, 0), piece('e2', 'dining-chair', 'bath', 11.0, 5.35, 0), piece('e3', 'dining-chair', 'bath', 10.0, 6.65, 180), piece('e4', 'dining-chair', 'bath', 11.0, 6.65, 180)];
  assert.ok(V1(lay).some((v) => v.rule === 'E2' && /neither in the kitchen/.test(v.detail)));
});

test('E2: a table 6 m from the counters in one long room', () => {
  const plan = { version: 1, name: 'long', units: 'm', meta: {}, levels: [{ id: 'L0', name: 'G', height: 2.7,
    walls: [wall('n', [0, 0], [14, 0], 'exterior'), wall('e', [14, 0], [14, 4], 'exterior'), wall('s', [14, 4], [0, 4], 'exterior'), wall('w', [0, 4], [0, 0], 'exterior')],
    openings: [{ id: 'front', wall: 's', type: 'door', offset: 7, width: 1, hinge: 'start', opens_to: 'left' }, { id: 'w1', wall: 'n', type: 'window', offset: 2, width: 3 }],
    rooms: [room('living', 'Living room', 'living', [[0, 0], [14, 0], [14, 4], [0, 4]])] }] };
  const run = [piece('k1', 'kitchen-sink', 'living', 1.0, 0.45, 0), piece('k2', 'kitchen-hob', 'living', 2.0, 0.45, 0), piece('k3', 'kitchen-base', 'living', 2.6, 0.45, 0)];
  const seats = (x) => [piece('t1', 'dining-table', 'living', x, 2.0, 0), piece('c1', 'dining-chair', 'living', x - 0.5, 1.35, 0), piece('c2', 'dining-chair', 'living', x + 0.5, 1.35, 0), piece('c3', 'dining-chair', 'living', x - 0.5, 2.65, 180), piece('c4', 'dining-chair', 'living', x + 0.5, 2.65, 180)];
  assert.equal(count(audit(plan, { L0: [...run, ...seats(4.5)] }), 'E2'), 0);
  const far = audit(plan, { L0: [...run, ...seats(11)] });
  assert.ok(far.some((v) => v.rule === 'E2' && /straight/.test(v.detail)), JSON.stringify(far.map((v) => v.detail)));
});

test('E3: a living room with three seats', () => {
  const V = audit(flat(), fl([], without('s1', 'a1', 'ac')));
  assert.ok(V.some((v) => v.rule === 'E3' && /living/.test(v.detail)));
});

test('E4: a 22 m2 study with only a bookshelf; a pantry of 9 m2', () => {
  assert.ok(V1(without('d1', 'dc', 'ac')).some((v) => v.rule === 'E4' && v.room === 'study'));
  const p = flat();
  p.levels[0].walls = p.levels[0].walls.filter((w) => w.id !== 'vp');
  p.levels[0].rooms = p.levels[0].rooms.filter((r) => r.id !== 'pantry' && r.id !== 'study');
  p.levels[0].rooms.push(room('pantry', 'Pantry', 'storage', [[0, 4], [9, 4], [9, 8], [0, 8]]));
  p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'd-stu');
  const V = audit(p, { L0: pick('k1', 'k2', 'k3', 'k4', 'k5', 't1', 'c1', 'c2', 'c3', 'c4', 's1', 'a1', 'bn', 'p1') });
  assert.ok(V.some((v) => v.rule === 'E4' && /limit 4\.5/.test(v.detail)));
});

test('E5: a picture in a bathroom is reported', () => {
  assert.ok(V1([...CLEAN, piece('m5', 'art-small', 'bath', 10.5, 7.85, 0)]).some((v) => v.rule === 'E5' && /bath/.test(v.detail)));
});

test('E6: a living room without any window in an exterior wall', () => {
  const p = flat();
  p.levels[0].openings = p.levels[0].openings.filter((o) => !o.id.startsWith('wl'));
  assert.ok(audit(p, fl()).some((v) => v.rule === 'E6' && v.room === 'living'));
});

test('P1: a hall of 40 percent of the floor', () => {
  const p = flat();
  p.levels[0].rooms = p.levels[0].rooms.filter((r) => r.id !== 'living');
  p.levels[0].rooms.push(room('living', 'Entrance hall', 'hall', [[0, 0], [9, 0], [9, 4], [0, 4]]));
  assert.ok(audit(p, fl()).some((v) => v.rule === 'P1'));
  assert.equal(count(audit(flat(), fl()), 'P1'), 0);
});

test('P2: a study with no door to a hall, and one reached only through a bedroom', () => {
  const p = flat();
  p.levels[0].openings = p.levels[0].openings.filter((o) => o.id !== 'd-stu');
  assert.ok(audit(p, fl()).some((v) => v.rule === 'P2' && v.room === 'study'));
  const q = flat();
  const pan = q.levels[0].rooms.find((r) => r.id === 'pantry');
  pan.name = 'Bedroom 2'; pan.use = 'bedroom';
  q.levels[0].openings.push({ id: 'd-sb', wall: 'vp', type: 'door', offset: 0.5, width: 0.8, hinge: 'start', opens_to: 'left' });
  q.levels[0].openings = q.levels[0].openings.filter((o) => o.id !== 'd-stu');
  const V = audit(q, fl());
  assert.ok(V.some((v) => v.rule === 'P2' && v.room === 'study' && /through a bedroom/.test(v.detail)), JSON.stringify(V.filter((v) => v.rule === 'P2').map((v) => v.detail)));
});

test('P3: a bedroom of 4.8 m2; P4: a door 0.7 m wide into a living room; P5: a room name nobody knows', () => {
  const p = flat();
  p.levels[0].rooms.find((r) => r.id === 'pantry').name = 'Bedroom 2';
  assert.ok(audit(p, fl()).some((v) => v.rule === 'P3' && v.room === 'pantry'));
  const q = flat();
  q.levels[0].openings.find((o) => o.id === 'd-hl').width = 0.7;
  assert.ok(audit(q, fl()).some((v) => v.rule === 'P4' && v.piece === 'd-hl'));
  const s = flat();
  s.levels[0].rooms.find((r) => r.id === 'study').name = 'Zxqv';
  assert.ok(audit(s, fl()).some((v) => v.rule === 'P5' && v.room === 'study'));
});

test('E7: a bedroom with a chest of drawers needs the mirror right over it', () => {
  const p = flat();
  p.levels[0].rooms.find((r) => r.id === 'pantry').name = 'Bedroom 2';
  const chest = piece('dr', 'dresser', 'pantry', 0.85, 6, 90), mirror = (y, elev = 1.0) => piece('mi', 'mirror', 'pantry', 1.1, y, 90, { elev });
  assert.equal(count(audit(p, fl([chest, mirror(6)])), 'E7'), 0);
  assert.ok(audit(p, fl([chest, mirror(7.3)])).some((v) => v.rule === 'E7' && /beside the chest/.test(v.detail)), 'mirror 1.3 m along the wall');
  assert.ok(audit(p, fl([chest, mirror(6, 0.9)])).some((v) => v.rule === 'E7'), 'mirror 0.05 m over the top');
  assert.ok(audit(p, fl([chest])).some((v) => v.rule === 'E7' && /no mirror/.test(v.detail)), 'no mirror at all');
  assert.ok(audit(p, fl([chest, mirror(6), piece('sh', 'shelf-wall', 'pantry', 1.1, 6, 90, { elev: 1.5 })])).some((v) => v.rule === 'E7' && /covers/.test(v.detail)), 'a shelf over the mirror');
  assert.equal(count(audit(flat(), fl()), 'E7'), 0);
});

test('P6: the leaf of an inner door lies by the wall when a wall is within 0.6 m of its hinge side', () => {
  const plan = (hinge) => ({ version: 1, name: 'doors', units: 'm', meta: {}, levels: [{ id: 'L0', name: 'G', height: 2.7,
    walls: [wall('n', [0, 0], [6, 0], 'exterior'), wall('e', [6, 0], [6, 4], 'exterior'), wall('s', [6, 4], [0, 4], 'exterior'), wall('w', [0, 4], [0, 0], 'exterior'), wall('mid', [0, 2], [6, 2])],
    openings: [{ id: 'front', wall: 's', type: 'door', offset: 3, width: 1, hinge: 'start', opens_to: 'left' }, { id: 'd1', wall: 'mid', type: 'door', offset: 0.1, width: 0.9, hinge, opens_to: 'left' }, { id: 'win', wall: 'n', type: 'window', offset: 2, width: 2 }],
    rooms: [room('hall', 'Hall', 'hall', [[0, 0], [6, 0], [6, 2], [0, 2]]), room('liv', 'Living room', 'living', [[0, 2], [6, 2], [6, 4], [0, 4]])] }] });
  const hit = (hinge) => audit(plan(hinge), {}).filter((v) => v.rule === 'P6' && v.piece === 'd1');
  assert.equal(hit('start').length, 0);
  assert.equal(hit('end').length, 1, 'hinge on the far jamb, wall at the other');
});

// ---- fixture 2: two levels with a stairwell (lower level closed shaft, upper level landing)
function house({ shaftW = 1.2, west = true, east = 13.2, steps = 16 } = {}) {
  const x0 = 13.2 - shaftW;
  const lower = {
    id: 'L0', name: 'Ground', height: 2.7,
    walls: [wall('n', [0, 0], [13.2, 0], 'exterior'), wall('e', [13.2, 0], [13.2, 10], 'exterior'), wall('s', [13.2, 10], [0, 10], 'exterior'), wall('w', [0, 10], [0, 0], 'exterior'),
      wall('wx', [x0, 0], [x0, 7.38]), wall('cross', [0, 7.38], [13.2, 7.38]), wall('head', [x0, 2.94], [13.2, 2.94])],
    openings: [{ id: 'front', wall: 's', type: 'door', offset: 5, width: 1, hinge: 'start', opens_to: 'right' }, { id: 'd-liv', wall: 'cross', type: 'door', offset: 1, width: 0.9, hinge: 'start', opens_to: 'right' },
      { id: 'p-stair', wall: 'cross', type: 'passage', offset: x0 + 0.06, width: 0.99 }, { id: 'd-ut', wall: 'wx', type: 'door', offset: 1.0, width: 0.8, hinge: 'start', opens_to: 'left' }],
    rooms: [room('living', 'Living room', 'living', [[0, 0], [x0, 0], [x0, 7.38], [0, 7.38]]), room('util', 'Utility', 'storage', [[x0, 0], [13.2, 0], [13.2, 2.94], [x0, 2.94]]),
      room('stair', 'Stairwell', 'hall', [[x0, 2.94], [13.2, 2.94], [13.2, 7.38], [x0, 7.38]]), room('hall', 'Hall', 'hall', [[0, 7.38], [13.2, 7.38], [13.2, 10], [0, 10]])],
    stairs: [{ id: 'st', from: [12.555, 7.185], to: [12.555, 3.135], width: 1, steps, to_level: 'L1' }],
  };
  const E = east;
  const upper = {
    id: 'L1', name: 'First', height: 2.7,
    walls: [wall('n', [0, 0], [E, 0], 'exterior'), wall('e', [E, 0], [E, 10], 'exterior'), wall('s', [E, 10], [0, 10], 'exterior'), wall('w', [0, 10], [0, 0], 'exterior'),
      ...(west ? [wall('wx', [12, 2.94], [12, 7.38])] : [])],
    openings: [],
    rooms: [room('landing', 'Landing', 'hall', [[0, 0], [E, 0], [E, 10], [0, 10]])],
  };
  return { version: 1, name: 'house', units: 'm', meta: {}, levels: [lower, upper] };
}
const stairV = (plan, lay = {}) => audit(plan, lay).filter((v) => /^S/.test(v.rule));

test('stairwell fixture: closed shaft, foot passage, one wall on the upper level pass S1 to S4', () => {
  assert.deepEqual(stairV(house()).map((v) => `${v.rule} ${v.detail}`), []);
});

test('S1: 14 risers instead of 16', () => {
  assert.ok(stairV(house({ steps: 14 })).some((v) => v.rule === 'S1'));
});

test('S2: a shaft 0.4 m wider than the run leaves a strip beside it', () => {
  const V = stairV(house({ shaftW: 1.6 }));
  assert.ok(V.some((v) => v.rule === 'S2' && /widest gap 0\.3[89]/.test(v.detail)), JSON.stringify(V.map((v) => v.detail)));
});

test('S2: the run stands in a room that is not named as a stairwell', () => {
  const p = house();
  p.levels[0].rooms.find((r) => r.id === 'stair').name = 'Hall with stairs';
  assert.ok(stairV(p).some((v) => v.rule === 'S2' && /not in a stair room/.test(v.detail)));
});

test('S3: a hole in the floor with two open long edges', () => {
  const V = stairV(house({ west: false, east: 16 }));
  assert.ok(V.some((v) => v.rule === 'S3' && /2 open long edges/.test(v.detail)), JSON.stringify(V.map((v) => v.detail)));
  assert.equal(stairV(house({ west: false })).filter((v) => v.rule === 'S3').length, 0);
});

test('S4: a picture in the shaft and a bench in front of the foot', () => {
  const V = stairV(house(), { L0: [piece('m1', 'art-small', 'stair', 12.1, 5.0, 90), piece('m2', 'bench', 'hall', 12.555, 7.9, 0)] });
  assert.ok(V.some((v) => v.rule === 'S4' && /stair room/.test(v.detail)), JSON.stringify(V.map((v) => v.detail)));
  assert.ok(V.some((v) => v.rule === 'S4' && /in front of the foot/.test(v.detail)), JSON.stringify(V.map((v) => v.detail)));
});

test('every new rule has a mutation test above', () => {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const r of RULES2) assert.ok(new RegExp(`\\b${r}\\b`).test(src.replace(/^\/\/.*$/gm, '')), `no test mentions ${r}`);
});
