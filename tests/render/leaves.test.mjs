// The door leaves of the scene: the leaf swings about its hinge and carries its handle, in every look and after every cut.
// Three.js runs in Node here; the label canvases need a document, a tiny stub is enough because nothing is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePlan } from '../../src/core/validate.js';
import { buildModel, leafPose, LEAF_OPEN_DEG } from '../../src/model/geometry.js';
import { createWorld } from '../../src/model/physics.js';
import { PlanScene } from '../../src/render/scene.js';
import { applyWallCut } from '../../src/render/cutaway.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const load = (file) => buildModel(validatePlan(JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))).normalized);
const PLANS = { 'duplex-1': '../../examples/duplex-1.plan.json', 'flat-1': '../../examples/flat-1.plan.json', 'duplex-min': '../fixtures/duplex-min.plan.json' };
const OPEN = (LEAF_OPEN_DEG * Math.PI) / 180;
const near = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const doorsOf = (model) => model.levels.flatMap((lv) => lv.openings.filter((o) => o.type === 'door').map((o) => ({ lv, o })));
const pose = (m) => [m.position.x, m.position.y, m.position.z, m.rotation.y, m.scale.x, m.scale.y, m.scale.z];
const plan2d = (m) => [m.position.x, m.position.z, m.rotation.y]; // where the box stands on the plan, whatever the cut did to its height
const snapshot = (ps) => { const out = new Map(); ps.group.traverse((m) => { if (m.isMesh) out.set(m, pose(m)); }); return out; };
const insideGroup = (ps, m) => { for (let o = m; o; o = o.parent) if (o === ps.group) return true; return false; };

test('every door has a leaf in the map under level index and opening id, with its handle; windows and passages have none', () => {
  for (const [name, file] of Object.entries(PLANS)) {
    const model = load(file), ps = new PlanScene(model, 'clay');
    const doors = doorsOf(model);
    assert.ok(doors.length >= 1, `${name} has doors`);
    assert.equal(ps.leaves.size, doors.length, `${name}: one leaf per door`);
    for (const { lv, o } of doors) {
      const l = ps.leaves.get(`${lv.index}/${o.id}`);
      assert.ok(l, `${name}: leaf of ${o.id}`);
      assert.equal(l.mesh.name, `opening:${o.id}/leaf`);
      assert.equal(l.swing, o.swing);
      assert.ok(l.handle, `${name}: ${o.id} has a handle`);
      assert.equal(l.handle.name, `opening:${o.id}/leaf/handle`);
      assert.equal(l.handle.parent, l.mesh.parent, 'the handle hangs beside the leaf in the opening group, not inside the leaf mesh');
      assert.equal(l.mesh.parent.name, `opening:${o.id}`);
    }
    for (const lv of model.levels) for (const o of lv.openings) if (o.type !== 'door') assert.ok(!ps.leaves.has(`${lv.index}/${o.id}`), `${name}: ${o.id} is no door`);
  }
});

test('the leaf stands where leafPose says at t = 0, 0.5 and 1, turned the way the wall box is', () => {
  for (const [name, file] of Object.entries(PLANS)) {
    const ps = new PlanScene(load(file), 'textured');
    for (const [key, l] of ps.leaves) {
      for (const t of [0, 0.5, 1]) {
        assert.equal(ps.setLeaf(...key.split('/').map((s, i) => (i === 0 ? Number(s) : s)), t), true);
        const p = leafPose(l.swing, t);
        near(l.mesh.position.x, p.cx, `${name} ${key} t=${t} x`); near(l.mesh.position.z, p.cy, `${name} ${key} t=${t} z`);
        near(l.mesh.rotation.y, -p.angle, `${name} ${key} t=${t} rotation`);
        // not just the formula against itself: the leaf direction is the shut direction turned by open * t towards the swing side
        const dx = Math.cos(p.angle), dy = Math.sin(p.angle), { closed, sn } = l.swing;
        near(dx * closed[0] + dy * closed[1], Math.cos(OPEN * t), `${name} ${key} t=${t} angle to the shut leaf`);
        near(dx * sn[0] + dy * sn[1], Math.sin(OPEN * t), `${name} ${key} t=${t} swings to its own side`);
      }
    }
  }
});

test('the leaf stays on its hinge and the handle stays on the leaf for every t', () => {
  for (const [name, file] of Object.entries(PLANS)) {
    const ps = new PlanScene(load(file), 'clay');
    for (const [key, l] of ps.leaves) {
      const [lvl, ...rest] = key.split('/'), id = rest.join('/'), { px, py, wl, closed } = l.swing;
      const h0 = pose(l.handle);
      let handleFromHinge = null;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        ps.setLeaf(Number(lvl), id, t);
        const m = l.mesh, h = l.handle;
        near(Math.hypot(m.position.x - px, m.position.z - py), wl / 2, `${name} ${key} t=${t}: leaf centre to hinge`);
        const d = Math.hypot(h.position.x - px, h.position.z - py);
        handleFromHinge ??= d;
        near(d, handleFromHinge, `${name} ${key} t=${t}: handle to hinge is constant`);
        near(d, wl - 0.08, `${name} ${key} t=${t}: handle 8 cm from the free end`);
        // on the axis of the leaf: the cross product of (handle - hinge) with the leaf direction is nil and the dot product is positive
        const hx = h.position.x - px, hz = h.position.z - py, ax = Math.cos(-m.rotation.y), az = Math.sin(-m.rotation.y);
        near(hx * az - hz * ax, 0, `${name} ${key} t=${t}: handle on the leaf axis`, 1e-9);
        assert.ok(hx * ax + hz * az > 0, 'handle on the free half of the leaf');
        near(h.rotation.y, m.rotation.y, `${name} ${key} t=${t}: handle turns with the leaf`);
        assert.equal(h.position.y, h0[1], 'height of the handle'); assert.deepEqual([h.scale.x, h.scale.y, h.scale.z], h0.slice(4), 'size of the handle');
      }
      // shut: in line with the wall, the free end at the other jamb
      ps.setLeaf(Number(lvl), id, 0);
      near(l.mesh.position.x, px + (closed[0] * wl) / 2, `${name} ${key} shut x`); near(l.mesh.position.z, py + (closed[1] * wl) / 2, `${name} ${key} shut z`);
    }
  }
});

test('t = 1 gives back the pose the scene was built in, exactly', () => {
  for (const file of Object.values(PLANS)) {
    const ps = new PlanScene(load(file), 'clay');
    const before = snapshot(ps);
    for (const [key, l] of ps.leaves) { const [lvl, ...rest] = key.split('/'); ps.setLeaf(Number(lvl), rest.join('/'), 0.3); assert.notDeepEqual(pose(l.mesh), before.get(l.mesh), 'it moved'); }
    for (const [key] of ps.leaves) { const [lvl, ...rest] = key.split('/'); ps.setLeaf(Number(lvl), rest.join('/'), 1); }
    for (const [m, p] of snapshot(ps)) assert.deepEqual(p, before.get(m), `${m.name} is back where it was built`);
  }
});

test('setDoors takes t from the door states; with open set every leaf is open; calling it again changes nothing', () => {
  const model = load(PLANS['duplex-1']), ps = new PlanScene(model, 'textured'), world = createWorld(model);
  const built = snapshot(ps);
  assert.equal(world.doors.length, ps.leaves.size, 'the world has a state for every door of this plan');
  assert.ok(world.doors.every((d) => d.t === 1), 'doors start open');
  ps.setDoors(world.doors);
  for (const [m, p] of snapshot(ps)) assert.deepEqual(p, built.get(m), 'open states leave the scene as built');
  world.doors.forEach((d, i) => { d.t = [0, 0.25, 0.5, 0.75, 1][i % 5]; });
  ps.setDoors(world.doors);
  const once = snapshot(ps);
  for (const d of world.doors) {
    const l = ps.leaves.get(`${d.level}/${d.id}`), p = leafPose(l.swing, d.t);
    near(l.mesh.position.x, p.cx, `${d.id} x`); near(l.mesh.position.z, p.cy, `${d.id} z`);
  }
  ps.setDoors(world.doors); ps.setDoors(world.doors, false);
  for (const [m, p] of snapshot(ps)) assert.deepEqual(p, once.get(m), `${m.name}: idempotent`);
  assert.ok([...once].some(([m, p]) => JSON.stringify(p) !== JSON.stringify(built.get(m))), 'the states did move leaves');
  ps.setDoors(world.doors, true); // leaving Spacer: all open whatever t says
  for (const [m, p] of snapshot(ps)) assert.deepEqual(p, built.get(m), `${m.name}: open for every t`);
  ps.setDoors(world.doors, true);
  for (const [m, p] of snapshot(ps)) assert.deepEqual(p, built.get(m), `${m.name}: open twice`);
  ps.setDoors([]); // no doors, nothing to do
  for (const [m, p] of snapshot(ps)) assert.deepEqual(p, built.get(m));
});

test('nothing else in the scene moves when a leaf swings, and a wrong id or t changes nothing', () => {
  const ps = new PlanScene(load(PLANS['flat-1']), 'clay');
  const before = snapshot(ps), [[key, l]] = ps.leaves;
  const [lvl, ...rest] = key.split('/'), id = rest.join('/');
  ps.setLeaf(Number(lvl), id, 0);
  let moved = 0;
  for (const [m, p] of snapshot(ps)) if (JSON.stringify(p) !== JSON.stringify(before.get(m))) { moved++; assert.ok(m === l.mesh || m === l.handle, `${m.name} moved`); }
  assert.equal(moved, 2, 'the leaf and its handle');
  const shut = snapshot(ps);
  const same = (what) => { for (const [m, p] of snapshot(ps)) assert.deepEqual(p, shut.get(m), what); };
  assert.equal(ps.setLeaf(Number(lvl), 'no-such-door', 0.5), false); same('unknown id');
  assert.equal(ps.setLeaf(99, id, 0.5), false); same('unknown level');
  for (const bad of [NaN, undefined, null, 'x', Infinity]) { assert.equal(ps.setLeaf(Number(lvl), id, bad), false, `t=${bad}`); same(`t=${bad}`); }
  const win = load(PLANS['flat-1']).levels[0].openings.find((o) => o.type === 'window');
  assert.equal(ps.setLeaf(0, win.id, 0.5), false, 'a window has no leaf');
});

test('t beyond 0 and 1 stops at shut and open', () => {
  const ps = new PlanScene(load(PLANS['duplex-min']), 'clay'), [[key, l]] = ps.leaves, [lvl, ...rest] = key.split('/'), id = rest.join('/');
  ps.setLeaf(Number(lvl), id, 0); const shut = pose(l.mesh), shutHandle = pose(l.handle);
  ps.setLeaf(Number(lvl), id, -3); assert.deepEqual(pose(l.mesh), shut); assert.deepEqual(pose(l.handle), shutHandle);
  ps.setLeaf(Number(lvl), id, 1); const open = pose(l.mesh);
  ps.setLeaf(Number(lvl), id, 7); assert.deepEqual(pose(l.mesh), open);
});

test('a swung leaf survives the cut, the page cutaway, the looks, the ceilings and the levels: same meshes, same swing, own height', () => {
  const model = load(PLANS['duplex-1']), ps = new PlanScene(model, 'textured');
  const ext = { minX: -1, maxX: 14, minZ: -1, maxZ: 11 };
  const entries = new Map(ps.cuttables.map((c) => [c.mesh, c]));
  const keys = [...ps.leaves.keys()], T = 0.4;
  const swing = () => { for (const k of keys) { const [lvl, ...rest] = k.split('/'); ps.setLeaf(Number(lvl), rest.join('/'), T); } };
  swing();
  const swung = new Map([...ps.leaves].map(([k, l]) => [k, [plan2d(l.mesh), plan2d(l.handle)]]));
  const full = new Map([...ps.leaves].map(([k, l]) => [k, [l.mesh.scale.y, l.mesh.position.y, l.handle.scale.y, l.handle.position.y]]));
  const check = (what) => {
    for (const [k, l] of ps.leaves) {
      assert.ok(entries.has(l.mesh) && entries.has(l.handle), `${what}: ${k} is still in the list of cuttables`);
      assert.ok(insideGroup(ps, l.mesh) && insideGroup(ps, l.handle), `${what}: ${k} is still in the scene`);
      assert.equal(l.handle.parent, l.mesh.parent, `${what}: ${k} handle beside leaf`);
      assert.deepEqual([plan2d(l.mesh), plan2d(l.handle)], swung.get(k), `${what}: ${k} is still swung to ${T}`);
      const [lvl, ...rest] = k.split('/'), p = leafPose(l.swing, T);
      near(l.mesh.position.x, p.cx, `${what}: ${k} x`); near(Math.hypot(l.handle.position.x - l.swing.px, l.handle.position.z - l.swing.py), l.swing.wl - 0.08, `${what}: ${k} handle on the leaf`);
      assert.ok(lvl !== undefined && rest.length);
    }
  };
  ps.setCut(1.1); check('setCut(1.1)');
  const low = [...ps.leaves.values()].map((l) => l.mesh.scale.y);
  assert.ok(low.every((h) => h > 0), 'cut leaves keep a height');
  ps.setCut(0.5); check('setCut(0.5)'); // below the handle: the handle goes, the leaf does not
  ps.setCut(null); check('setCut(null)');
  for (const [k, l] of ps.leaves) assert.deepEqual([l.mesh.scale.y, l.mesh.position.y, l.handle.scale.y, l.handle.position.y], full.get(k), `${k} full height again`);
  applyWallCut(ps, ext); check('applyWallCut');
  applyWallCut(ps, ext, { north: true, west: true }); check('applyWallCut, other sides');
  ps.setCut(null);
  ps.setCeilings(true); check('setCeilings(true)'); ps.setCeilings(false); check('setCeilings(false)');
  ps.setWalkShadows(true); check('setWalkShadows'); ps.setWalkShadows(false);
  ps.setMaterials('clay'); check('clay'); ps.setMaterials('textured'); check('textured');
  ps.setLevelVisible((i) => i === 1); check('one level'); ps.setLevelVisible(() => true); check('all levels');
  ps.shareBoxes(true); check('shareBoxes'); ps.shareBoxes(false); check('shareBoxes off');
  ps.setExplode(1); check('exploded'); ps.setExplode(0);
});

test('swinging a leaf leaves its texture frame alone: the uv belong to the box', () => {
  const ps = new PlanScene(load(PLANS['duplex-1']), 'textured');
  for (const [key, l] of ps.leaves) {
    const uv = Float32Array.from(l.mesh.geometry.getAttribute('uv').array), [lvl, ...rest] = key.split('/');
    ps.setLeaf(Number(lvl), rest.join('/'), 0);
    assert.deepEqual(Array.from(l.mesh.geometry.getAttribute('uv').array), Array.from(uv), `${key} uv`);
    assert.equal(l.mesh.pw.uv.swap, true, 'the grain of a leaf is vertical');
  }
});

test('a rebuilt scene has its own leaves: none of them points into the old scene', () => {
  const model = load(PLANS['duplex-min']), a = new PlanScene(model, 'clay');
  const b = new PlanScene(model, 'clay');
  assert.equal(a.leaves.size, b.leaves.size);
  for (const [k, l] of b.leaves) {
    const old = a.leaves.get(k);
    assert.notEqual(l.mesh, old.mesh); assert.notEqual(l.handle, old.handle);
    assert.ok(insideGroup(b, l.mesh) && !insideGroup(a, l.mesh), 'the new leaf is in the new scene only');
    assert.ok(insideGroup(b, l.handle) && !insideGroup(a, l.handle));
  }
  const [[k, l]] = b.leaves, [lvl, ...rest] = k.split('/'), shut = pose(a.leaves.get(k).mesh);
  b.setLeaf(Number(lvl), rest.join('/'), 0);
  assert.deepEqual(pose(a.leaves.get(k).mesh), shut, 'the old scene did not move');
  assert.ok(l.mesh.position.x !== a.leaves.get(k).mesh.position.x || l.mesh.position.z !== a.leaves.get(k).mesh.position.z);
  a.dispose(); b.dispose();
});
