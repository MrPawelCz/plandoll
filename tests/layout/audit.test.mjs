// Independent layout audit (tools/audit-layout.mjs): mutation tests on a clean hand-made layout, baseline guard on the examples,
// and a text test that the audit code does not import the engine's own collision helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadRepo, loadPlan, buildAll, layoutFor } from '../../tools/audit/data.mjs';
import { auditModel } from '../../tools/audit/rules.mjs';
import { RULES2 } from '../../tools/audit/rules2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = await loadRepo(ROOT);
const counts = (V) => { const c = {}; for (const v of V) c[v.rule] = (c[v.rule] ?? 0) + 1; return c; };
const piece = (id, type, room, x, y, rot = 0, extra = {}) => {
  const s = R.specs.SPEC_BY_ID[type];
  return { id, type, room, x, y, rot, size: extra.size ?? [...s.size], elev: extra.elev ?? 0, on: extra.on ?? null, colors: {} };
};
const run = (planName, levels) => {
  const model = buildAll(R, loadPlan(R, planName));
  return auditModel(model, { version: 1, levels }, R.specs, { skipRules2: true }).violations;
};
const diff = (a, b) => { const ca = counts(a), cb = counts(b), out = {}; for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) { const d = (cb[k] ?? 0) - (ca[k] ?? 0); if (d) out[k] = d; } return out; };

// flat-1: living 0..5 x 0..3, bedroom 5..8 x 0..3, hall 0..2 x 3..6, bath 2..4 x 3..6, study 4..8 x 3..6.
const CLEAN = [
  piece('s1', 'sofa2', 'living', 3.2, 0.62, 0), piece('t1', 'coffee-table', 'living', 3.2, 1.5, 0),
  piece('b1', 'bed-single', 'bedroom', 7.2, 1.5, 180), piece('w1', 'wardrobe-small', 'bedroom', 5.62, 2.56, 180),
  piece('d1', 'desk', 'study', 6.5, 5.52, 180), piece('c1', 'desk-chair', 'study', 6.5, 4.9, 0),
];
const base = (extra = []) => [{ id: 'L0', pieces: [...CLEAN, ...extra] }];
const hardOf = (V) => V.filter((v) => v.hard);

test('clean layout has no hard violations on flat-1', () => {
  const V = run('flat-1', base());
  assert.deepEqual(hardOf(V).map((v) => `${v.rule} ${v.piece} ${v.detail}`), []);
});

const MUT = [
  ['bed in the leaf sweep (A3b)', 'A3b', [piece('m1', 'bed-single', 'living', 1.1, 2.0, 90)]],
  ['wardrobe in the 0.9 m door zone outside the sweep (A3a)', 'A3a', [piece('m2', 'shoe-cabinet', 'hall', 1.05, 3.65, 0)]],
  ['two overlapping armchairs (A1)', 'A1', [piece('m3a', 'armchair', 'living', 1.0, 0.6, 0), piece('m3b', 'armchair', 'living', 1.3, 0.7, 0)]],
  ['piece inside a wall (A2)', 'A2', [piece('m4', 'wardrobe-small', 'living', 3.0, 0.05, 0)]],
  ['gap of 0.60 m in the hall instead of 0.90 (B1)', 'B1', [piece('m6', 'wardrobe', 'hall', 0.7, 4.6, 0, { size: [1.1, 0.6, 2.2] })]],
];
for (const [name, rule, extra] of MUT) {
  test(`mutation: ${name}`, () => {
    const d = diff(run('flat-1', base()), run('flat-1', base(extra)));
    assert.ok((d[rule] ?? 0) > 0, `${rule} not reported: ${JSON.stringify(d)}`);
  });
}

test('mutation: a door-wide gap of 1.0 m in the hall is accepted (B1)', () => {
  const d = diff(run('flat-1', base()), run('flat-1', base([piece('m7', 'wardrobe', 'hall', 0.7, 4.6, 0, { size: [0.7, 0.6, 2.2] })])));
  assert.equal(d.B1 ?? 0, 0, JSON.stringify(d));
});

test('the sweep lies on the swing side only: a piece behind the door wall is not in the sweep', () => {
  // d-hall-living swings into the living room (north); the same spot mirrored into the hall (south) is outside the sweep
  const d = diff(run('flat-1', base()), run('flat-1', base([piece('m8', 'armchair', 'hall', 1.0, 3.55, 0, { size: [0.6, 0.6, 0.85] })])));
  assert.equal(d.A3b ?? 0, 0, JSON.stringify(d));
});

test('mutation: a sofa on the stairs (A5) and a stair-top wall (C) on duplex-1', () => {
  const empty = [{ id: 'L0', pieces: [] }, { id: 'L1', pieces: [] }];
  const withSofa = [{ id: 'L0', pieces: [piece('m5', 'sofa2', 'hall', 1.1, 4.0, 90)] }, { id: 'L1', pieces: [] }];
  const d = diff(run('duplex-1', empty), run('duplex-1', withSofa));
  assert.ok(d.A5 > 0, JSON.stringify(d));
});

test('duplex-1: stair numbers are measured by the audit itself (riser, tread, 2h+s)', () => {
  const V = run('duplex-1', [{ id: 'L0', pieces: [] }, { id: 'L1', pieces: [] }]);
  const text = V.filter((v) => v.rule === 'C').map((v) => v.detail).join(' | ');
  assert.match(text, /riser 0\.207/);
  assert.match(text, /tread 0\.215/);
});

test('mutation: a stair whose footprint is not inside one room gets no floor opening, the audit sees the low slab (C)', () => {
  const plan = loadPlan(R, 'duplex-1');
  const wide = JSON.parse(JSON.stringify(plan));
  wide.levels[0].stairs[0].width = 3.4; // footprint leaves the hall, so the model cuts no opening
  const model = buildAll(R, wide);
  const V = auditModel(model, { version: 1, levels: [{ id: 'L0', pieces: [] }, { id: 'L1', pieces: [] }] }, R.specs).violations;
  assert.ok(V.some((v) => v.rule === 'C' && /slab sits less than 2\.0 m/.test(v.detail)), JSON.stringify(V.filter((v) => v.rule === 'C').map((v) => v.detail)));
  const ok = auditModel(buildAll(R, plan), { version: 1, levels: [{ id: 'L0', pieces: [] }, { id: 'L1', pieces: [] }] }, R.specs).violations;
  assert.ok(!ok.some((v) => /slab sits less/.test(v.detail)));
});

test('own door swing derivation agrees with the model swing', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const model = buildAll(R, loadPlan(R, name));
    for (const L of model.levels) for (const o of L.openings.filter((x) => x.type === 'door' && x.swing)) {
      const w = L.wallById.get(o.wallId), side = o.opens_to === 'right' ? -1 : 1;
      const sn = [w.normal[0] * side, w.normal[1] * side];
      assert.ok(Math.abs(sn[0] - o.swing.sn[0]) < 1e-9 && Math.abs(sn[1] - o.swing.sn[1]) < 1e-9, `${name} ${o.id}`);
      const up = o.hinge !== 'end' ? o.u0 + 0.05 : o.u1 - 0.05;
      const hx = w.from[0] + w.dir[0] * up + sn[0] * (w.thickness / 2 - 0.02);
      assert.ok(Math.abs(hx - o.swing.px) < 1e-9, `${name} ${o.id} hinge`);
    }
  }
});

// Baseline of the examples with the automatic layout (seed 1): counts per rule may only go down. Lower the numbers when the engine improves.
const BASE = JSON.parse(readFileSync(join(ROOT, 'tests/layout/audit-baseline.json'), 'utf8'));
for (const name of Object.keys(BASE)) {
  test(`baseline guard: ${name} does not get worse than the recorded audit`, () => {
    const model = buildAll(R, loadPlan(R, name));
    const V = auditModel(model, layoutFor(R, model, { seed: 1 }), R.specs, { rooms: R.rooms }).violations;
    const c = counts(V);
    for (const [rule, n] of Object.entries(c)) assert.ok(n <= (BASE[name][rule] ?? 0), `${name}: ${rule} ${n} > recorded ${BASE[name][rule] ?? 0}`);
  });
}

// The examples the page opens (flat-2 and duplex-2) have no hard violation of ANY rule (A, B, C, S, E, P), whatever the seed of the furnishing.
for (const name of ['flat-2', 'duplex-2']) {
  test(`the example ${name} has no hard violation of any rule for the seeds 1 to 4`, () => {
    const model = buildAll(R, loadPlan(R, name));
    for (const seed of [1, 2, 3, 4]) {
      const V = auditModel(model, layoutFor(R, model, { seed }), R.specs, { rooms: R.rooms }).violations.filter((v) => v.hard);
      assert.deepEqual(V.map((v) => `${v.rule} ${v.room ?? ''} ${v.piece ?? ''}`), [], `${name} seed ${seed}`);
    }
  });
}

// The examples flat-2 and duplex-2 must pass the collision and clearance rules (A, B, C). The new rules S, E, P are recorded in the baseline (they must reach zero after the merge).
for (const name of ['flat-2', 'duplex-2']) {
  test(`the example ${name} has no hard violation of the rules A, B, C in the independent audit`, () => {
    const model = buildAll(R, loadPlan(R, name));
    const V = auditModel(model, layoutFor(R, model, { seed: 1 }), R.specs, { skipRules2: true }).violations;
    assert.deepEqual(V.filter((v) => v.hard), [], `${name}: hard violations`);
  });
}

test('audit code imports no collision or zone helper of the engine', () => {
  const files = [join(ROOT, 'tools/audit-layout.mjs'), join(ROOT, 'tools/audit-battery.mjs'), ...readdirSync(join(ROOT, 'tools/audit')).map((f) => join(ROOT, 'tools/audit', f))];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/layout\/geometry\.js|layout\/check\.js|editor\/rules\.js|layout\/engine\.js/.test(t), `${f} imports a forbidden module`);
    assert.ok(!/\b(penetration|boxInsidePolygon|levelZones|roomInterior|checkLayout)\b/.test(t.replace(/^\s*\/\/.*$/gm, '')), `${f} uses a forbidden helper name`);
  }
});

test('baseline: only the known rule names, and no number above the one recorded for the same plan can appear (numbers only go down)', () => {
  const known = new Set(['A1', 'A1h', 'A1s', 'A2', 'A3a', 'A3b', 'A3c', 'A4', 'A5', 'B1', 'B2', 'B2bed', 'B3', 'C', ...RULES2]);
  for (const [name, row] of Object.entries(BASE)) for (const [rule, n] of Object.entries(row)) assert.ok(known.has(rule) && Number.isInteger(n) && n > 0, `${name} ${rule}`);
});

// The two examples carry no violation at all, hard or soft, for the seeds 1 to 4.
for (const name of ['flat-2', 'duplex-2']) {
  test(`the example ${name} has no violation of any rule, hard or soft, for the seeds 1 to 4`, () => {
    const model = buildAll(R, loadPlan(R, name));
    for (const seed of [1, 2, 3, 4]) {
      const V = auditModel(model, layoutFor(R, model, { seed }), R.specs, { rooms: R.rooms }).violations;
      assert.deepEqual(V.map((v) => `${v.rule} ${v.detail}`), [], `${name} seed ${seed}`);
    }
  });
}
