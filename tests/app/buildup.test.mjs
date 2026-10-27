// The build-up of the intro on a real scene (no GL): the walls start flat and rise to exactly the heights the cutaway gave them, the windows and doors come, the furniture lands piece by piece
// and a soft shadow comes under each piece on the floor, and finish() puts every wall box and every piece back as they were, so that the page after the intro is the page without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { composeLayout, cutawayPieces, emittersByLevel, NEAR_DEFAULT } from '../../src/render/compose.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { viewOf, nearSides } from '../../src/app/camera.js';
import { createBuildUp } from '../../src/app/buildup.js';
import { INTRO } from '../../src/app/intro.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const example = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));

// the page's own start: the scene cut for the main view, the furniture composed and hidden where the cutaway says
function stage(name) {
  const p = example(name);
  for (const lv of p.levels) lv.furniture = [];
  const model = buildModel(modelOf(analyzePlan(p))), ext = modelExtent(model);
  const ps = new PlanScene(model, 'textured'); ps.setLabels(false); ps.setArcs(false); ps.setCeilings(false);
  const near = nearSides(35.5), view = viewOf({ azimuth: 35.5 });
  applyWallCut(ps, ext, near);
  const layout = autoFurnish(model, { seed: 1, allowedTypes: piecesImplemented() });
  const furn = composeLayout({ model, layout, quality: 'medium', look: 'textured', seed: 1 });
  cutawayPieces(furn.pieces, ext, view, near);
  const scene = new THREE.Scene(); scene.add(ps.group); scene.add(furn.group);
  const lampLog = [];
  const build = createBuildUp({ ps, furn, layout, ext, scene, lamps: (list) => lampLog.push(list) });
  return { ps, furn, layout, scene, build, lampLog, model };
}
const snapshot = (s) => ({
  walls: s.ps.cuttables.map((c) => [c.mesh.visible, c.mesh.position.y, c.mesh.scale.y]),
  pieces: [...s.furn.pieces.values()].map((g) => [g.visible, g.position.x, g.position.y, g.position.z, g.scale.x, g.scale.y, g.scale.z]),
});
const visiblePieces = (s) => [...s.furn.pieces.values()].filter((g) => g.visible).length;
const wallHeights = (s) => s.ps.cuttables.map((c) => (c.mesh.visible ? c.mesh.scale.y : 0));

for (const name of ['flat-1', 'duplex-1']) {
  test(`${name}: prepare counts what the scene shows, and the empty plan has flat walls and no furniture`, () => {
    const s = stage(name), shown = visiblePieces(s), before = snapshot(s);
    const info = s.build.prepare();
    assert.equal(info.pieces, shown, 'the pieces that show are the pieces of the intro (the cutaway ones stay out)');
    assert.ok(info.walls > 0 && info.openings > 0 && info.rooms > 0);
    assert.equal(info.timeline.pieces, shown);
    const r = s.build.apply(0);
    assert.deepEqual(r, { placed: 0, total: shown });
    assert.equal(visiblePieces(s), 0, 'no furniture on the empty plan');
    // a box that starts below the floor (the foot of an outer wall) is drawn up to the floor and no higher; every other box is a line of two millimetres
    const tall = s.ps.cuttables.map((c, i) => [c.mesh.name, wallHeights(s)[i], c.y0]).filter(([, h, y0]) => h > (y0 < 0 ? -y0 : 0) + 0.01);
    assert.deepEqual(tall, [], 'no wall rises above the floor on the empty plan');
    assert.ok(s.ps.cuttables.filter((c) => c.mesh.visible).length > 0, 'and the lines are drawn');
    assert.notDeepEqual(snapshot(s), before);
    s.build.finish();
  });

  test(`${name}: at the end of the story the scene is the end state, and finish() puts back every box and every piece exactly`, () => {
    const s = stage(name), before = snapshot(s);
    s.build.prepare();
    const tl = s.build.timeline;
    s.build.apply(0);
    const done = s.build.apply(tl.total);
    assert.equal(done.placed, done.total);
    const end = snapshot(s);
    end.pieces.forEach((p, i) => { assert.deepEqual(p, before.pieces[i], `piece ${i} at rest`); });
    end.walls.forEach((w, i) => { assert.equal(w[0], before.walls[i][0], `wall ${i} visible`); assert.ok(Math.abs(w[1] - before.walls[i][1]) < 1e-6 && Math.abs(w[2] - before.walls[i][2]) < 1e-6, `wall ${i} ${w} vs ${before.walls[i]}`); });
    s.build.apply(tl.total * 0.4); // somewhere in the middle, then finish
    const freed = new Set(), geos = new Set();
    for (const g of s.furn.pieces.values()) if (g.visible) g.traverse((o) => { // the pieces the intro drew (the ones the cutaway hides were never drawn)
      if (o.isMesh && o.geometry && !geos.has(o.geometry)) { geos.add(o.geometry); o.geometry.addEventListener('dispose', () => freed.add(o.geometry)); } });
    s.build.finish();
    assert.ok(geos.size > 10 && freed.size === geos.size, `the buffers of every piece go back to the graphics card (${freed.size} of ${geos.size})`);
    assert.ok([...geos].every((geo) => geo.attributes.position.count > 0), 'while the data stays in memory');
    assert.deepEqual(snapshot(s), before, 'back to the very numbers');
    assert.equal(s.build.contact, null, 'the contact shadows are gone');
    assert.equal(s.scene.children.some((c) => c.name === 'contact-shadows'), false);
    assert.equal(s.build.active, false);
    assert.deepEqual(s.build.apply(1), { placed: 0, total: 0 }, 'after finish it does nothing');
  });

  test(`${name}: the story only goes forward: pieces and wall heights never shrink, a lamp never goes out, the contact shadows only add`, () => {
    const s = stage(name);
    const info = s.build.prepare(), tl = info.timeline;
    const patches = () => s.build.contact?.geometry.drawRange.count ?? 0;
    let placed = -1, walls = wallHeights(s).map(() => 0), contact = 0, lampsOn = 0;
    for (let t = 0; t <= tl.total + 0.001; t += 1 / 30) {
      const r = s.build.apply(t);
      assert.ok(r.placed >= placed, `placed at ${t}`); placed = r.placed;
      assert.equal(visiblePieces(s), r.placed, `the visible pieces are the counted ones at ${t.toFixed(2)}`);
      const h = wallHeights(s);
      h.forEach((v, i) => { if (!(t < tl.walls.start + 1e-9)) assert.ok(v >= walls[i] - 1e-9 || s.ps.cuttables[i].mesh.visible === false, `wall box ${i} at ${t.toFixed(2)}`); });
      walls = h.map((v, i) => Math.max(v, walls[i]));
      assert.ok(patches() >= contact, 'the contact shadows only come'); contact = patches();
      const last = s.lampLog[s.lampLog.length - 1];
      if (last) { const on = last.filter((e) => e.power > 0).length; assert.ok(on >= lampsOn, 'a lamp stays lit'); lampsOn = on; }
    }
    assert.equal(placed, info.pieces);
    assert.ok(patches() > 0 || info.pieces === 0, 'there are contact shadows at the end');
    s.build.finish();
  });

  test(`${name}: the lights keep their number: the list of lamps always holds every lamp of the end state, the ones that do not stand yet with no power`, () => {
    const s = stage(name);
    s.build.prepare();
    const tl = s.build.timeline;
    s.build.apply(0);
    const first = s.lampLog[s.lampLog.length - 1];
    s.build.apply(tl.total);
    const last = s.lampLog[s.lampLog.length - 1];
    const lamps = [...emittersByLevel(s.furn.pieces).values()].flat();
    assert.equal(last.length, lamps.length, 'every lamp is in the list at the end');
    assert.ok(first.length === last.length || (first.length === 0 && last.length === 0), 'and at the start: the same lamps');
    assert.ok(first.every((e) => e.power === 0), 'none of them lights at the start');
    assert.ok(last.every((e) => e.power > 0), 'all of them do at the end');
    s.build.finish();
  });
}

test('a piece that stands on the floor starts above its place and ends exactly on it; a rug grows flat; the contact shadow comes when the piece lands', () => {
  const s = stage('flat-1');
  const info = s.build.prepare(), P = INTRO.piece;
  const rest = new Map([...s.furn.pieces].map(([id, g]) => [id, g.position.y]));
  // find the first floor piece: its time is the start of the furniture
  s.build.apply(info.timeline.furniture.start + 1e-6);
  const standing = [...s.furn.pieces].filter(([, g]) => g.visible);
  assert.equal(standing.length, 1, 'one piece at the first moment');
  const [id, g] = standing[0];
  assert.ok(g.position.y > rest.get(id) + P.dropH * 0.9 || g.scale.x < 1, 'it is in the air or small');
  assert.equal(s.build.contact.geometry.drawRange.count, 0, 'no contact shadow yet');
  s.build.apply(info.timeline.furniture.start + P.fall + 0.01);
  assert.ok(g.position.y >= rest.get(id) && g.position.y < rest.get(id) + 0.1, 'it has landed');
  s.build.apply(info.timeline.furniture.start + P.fall + P.bounce + 0.01);
  assert.equal(g.position.y, rest.get(id)); assert.deepEqual([g.scale.x, g.scale.y, g.scale.z], [1, 1, 1]);
  s.build.finish();
});

test('a scene with no furniture and no openings still plays: walls only', () => {
  const s = stage('flat-1');
  for (const g of s.furn.pieces.values()) g.visible = false;
  const info = s.build.prepare();
  assert.equal(info.pieces, 0);
  assert.equal(info.timeline.counterFrom, null);
  assert.deepEqual(s.build.apply(info.timeline.total), { placed: 0, total: 0 });
  assert.equal(s.build.contact, null, 'no pieces, no contact mesh');
  s.build.finish();
  assert.equal([...s.furn.pieces.values()].some((g) => g.visible), false, 'pieces that were hidden stay hidden: they are not the intro\'s business');
});
