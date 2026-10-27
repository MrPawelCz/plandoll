// The area that the list of rooms shows (model/areas.js listedArea): the figure the drawing declares when it agrees with the room as drawn, and the room as drawn,
// net of its walls and marked as an estimate, when it does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzePlan, modelOf, AREA_TOL, NET_AREA_TOL } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { listedArea, roomArea, NET_BUDGET, NET_LOW } from '../../src/model/areas.js';

const plan = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));
// a built model of an example plan with one edit applied to the plan first (the page strips the furniture the same way)
function modelWith(name, edit) {
  const p = plan(name);
  for (const lv of p.levels) lv.furniture = [];
  edit?.(p);
  return buildModel(modelOf(analyzePlan(p)));
}
const roomOf = (m, id) => { for (const lv of m.levels) { const r = lv.rooms.find((x) => x.id === id); if (r) return { room: r, walls: lv.walls }; } throw new Error(`no room ${id}`); };
const setArea = (id, area) => (p) => { for (const lv of p.levels) for (const r of lv.rooms) if (r.id === id) { if (area === undefined) delete r.area; else r.area = area; } };

test('the tolerances are the validator\'s own: 5 percent of the polygon along the wall centrelines, 10 percent of the polygon net of the walls', () => {
  assert.equal(AREA_TOL, 0.05);
  assert.equal(NET_AREA_TOL, 0.1);
});

test('a declared area that agrees with the drawing is shown as declared, for every room of both example plans (they print net areas)', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const m = modelWith(name);
    for (const lv of m.levels) for (const r of lv.rooms) {
      const a = listedArea(r, lv.walls);
      assert.equal(a.estimated, false, `${name} ${r.id}`);
      assert.equal(a.m2, r.declaredArea, `${name} ${r.id}`);
      assert.equal(a.declared, undefined);
    }
  }
});

test('a declared area that the drawing contradicts is left out: the room is shown as drawn, net of its walls, marked as an estimate, and the declared figure is kept aside', () => {
  const m = modelWith('flat-1', setArea('living', 30)); // the living room is 5 by 3 metres along the centrelines (15 m2), about 13.4 m2 net
  const { room, walls } = roomOf(m, 'living'), a = listedArea(room, walls);
  assert.equal(a.estimated, true);
  assert.equal(a.declared, 30);
  assert.ok(Math.abs(a.m2 - 13.36) < 0.05, `net of the walls, not 30 and not the 15 of the centrelines: ${a.m2}`);
  assert.equal(roomArea(room, walls).m2, 30, 'the labels of the scene keep showing the declared figure (this list does not change them)');
});

test('a room whose plan declares no area is an estimate, without a declared figure', () => {
  const m = modelWith('flat-1', setArea('bedroom', undefined));
  const { room, walls } = roomOf(m, 'bedroom'), a = listedArea(room, walls);
  assert.equal(a.estimated, true);
  assert.ok(!('declared' in a));
  assert.ok(Math.abs(a.m2 - 7.78) < 0.05, `${a.m2}`);
});

test('the edges of the test: inside either window the declared figure stands, outside both it does not', () => {
  // living room: 15.00 m2 along the centrelines, 13.36 net; the windows are [14.25, 15.75] and [12.02, 14.70]
  const shown = (declared) => { const m = modelWith('flat-1', setArea('living', declared)); const { room, walls } = roomOf(m, 'living'); return listedArea(room, walls); };
  assert.equal(shown(15.7).estimated, false, 'within 5 percent of the centrelines');
  assert.equal(shown(16.0).estimated, true, 'past 5 percent of the centrelines and far from the net one');
  assert.equal(shown(12.1).estimated, false, 'within 10 percent of the net area');
  assert.equal(shown(11.9).estimated, true, 'past 10 percent of the net area');
  assert.equal(shown(15.7).m2, 15.7);
});

test('every room is worked out once: the same object comes back', () => {
  const m = modelWith('duplex-1', setArea('hall', 99));
  const { room, walls } = roomOf(m, 'hall');
  assert.equal(listedArea(room, walls), listedArea(room, walls));
});

// The second window of W102 (the polygon net of the walls) exists only where a wall runs along an edge: with no walls, or none along the room, the "net" figure is the polygon
// itself, and the declared figure has to be within 5 percent of it, as the validator says. The list must agree with the validator on that, room by room.
test('a plan with no walls has no net window: a figure 7 percent above the polygon is set aside, as W102 says', () => {
  const edit = (p) => { for (const lv of p.levels) { lv.walls = []; for (const r of lv.rooms) if (r.id === 'living') r.area = 16.05; } };
  const p = plan('flat-1');
  for (const lv of p.levels) lv.furniture = [];
  edit(p);
  const res = analyzePlan(p);
  const flagged = (res.warnings ?? []).filter((w) => w.code === 'W102').map((w) => String(w.id ?? w.path));
  assert.ok(flagged.some((x) => x.includes('living')), `the validator flags the living room: ${flagged.join(', ')}`);
  const m = buildModel(modelOf(res)), { room, walls } = roomOf(m, 'living'), a = listedArea(room, walls);
  assert.equal(a.estimated, true, 'the list agrees with W102: the figure is set aside');
  assert.equal(a.declared, 16.05);
  assert.ok(Math.abs(a.m2 - 15) < 1e-6, `the polygon itself: ${a.m2}`);
  const near = modelWith('flat-1', (q) => { for (const lv of q.levels) { lv.walls = []; for (const r of lv.rooms) if (r.id === 'living') r.area = 15.7; } });
  const b = roomOf(near, 'living');
  assert.equal(listedArea(b.room, b.walls).estimated, false, 'and 4.7 percent above the polygon is still within the first window');
});

// A grid of rooms 4 by 3 metres that declare 10.6 m2, which is their area net of the walls (the walls are 0.2 m thick): every figure agrees with the drawing.
function grid(cols, rows, cw, rh, declared) {
  const walls = [], rooms = []; let id = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) walls.push({ id: `h${id++}`, from: [i * cw, j * rh], to: [(i + 1) * cw, j * rh], ...(j === 0 || j === rows ? { kind: 'exterior' } : {}) });
  for (let i = 0; i <= cols; i++) for (let j = 0; j < rows; j++) walls.push({ id: `v${id++}`, from: [i * cw, j * rh], to: [i * cw, (j + 1) * rh], ...(i === 0 || i === cols ? { kind: 'exterior' } : {}) });
  let n = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) rooms.push({ id: `r${n}`, name: `Room ${n++}`, use: 'living', polygon: [[i * cw, j * rh], [(i + 1) * cw, j * rh], [(i + 1) * cw, (j + 1) * rh], [i * cw, (j + 1) * rh]], area: declared });
  return { version: 1, name: 'grid', units: 'm', levels: [{ id: 'L0', name: 'Flat', height: 2.7, walls, openings: [], rooms }] };
}

test('a big plan: when the budget of the level is gone, a declared figure that a net area could be still stands, and one that cannot is set aside', () => {
  const p = grid(12, 8, 4, 3, 10.6); // 96 rooms among 212 walls: about 59 000 wall checks a room, and the budget is 3 000 000
  p.levels[0].rooms[90].area = 30; // above the polygon (12 m2): no net area is that large
  p.levels[0].rooms[91].area = 5; // below two thirds of the polygon
  const res = analyzePlan(p);
  assert.equal(res.ok, true);
  const m = buildModel(modelOf(res)), lv = m.levels[0];
  assert.equal(lv.rooms.length, 96);
  const shown = lv.rooms.map((r) => listedArea(r, lv.walls));
  const skipped = shown.filter((a) => a.skipped).length;
  assert.ok(skipped > 0 && skipped < 96, `the budget ran out part of the way through the list (${skipped} rooms went unchecked), which is what this test is about`);
  shown.forEach((a, i) => {
    if (i === 90 || i === 91) { assert.equal(a.estimated, true, `room ${i}: the figure is set aside`); assert.equal(a.declared, [30, 5][i - 90]); assert.ok(Math.abs(a.m2 - 12) < 0.5, `room ${i} is shown as drawn: ${a.m2}`); return; }
    assert.equal(a.estimated, false, `room ${i} keeps its declared figure, checked or not`);
    assert.equal(a.m2, 10.6, `room ${i}`);
  });
  assert.ok(shown.slice(-5).some((a) => a.skipped), 'the rooms at the end of the list are among the ones that went unchecked');
});

test('the window of a figure that cannot be checked is below the polygon and not below NET_LOW of it', () => {
  assert.equal(NET_LOW, 0.65);
  assert.equal(NET_BUDGET, 3000000);
  const p = grid(12, 8, 4, 3, 10.6);
  const lv0 = p.levels[0];
  // the last rooms are the ones that go unchecked; give them figures on both sides of the window (the polygon is 12 m2, so the window is 7.8 to 12 and a figure within 5 percent
  // of 12 is accepted before any net estimate is asked for)
  const probes = [[95, 7.9, false], [94, 7.7, true], [93, 13, true]]; // [index, declared, set aside]
  for (const [i, d] of probes) lv0.rooms[i].area = d;
  const m = buildModel(modelOf(analyzePlan(p))), lv = m.levels[0];
  for (const r of lv.rooms) listedArea(r, lv.walls); // in list order, as the list works them out
  for (const [i, d, aside] of probes) {
    const a = listedArea(lv.rooms[i], lv.walls);
    assert.equal(a.skipped, true, `room ${i} went unchecked`);
    assert.equal(a.estimated, aside, `declared ${d}`);
  }
});
