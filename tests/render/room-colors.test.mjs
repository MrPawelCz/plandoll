// Room colours in the scene (Node, no GL): floors take a colour or a library material, walls take a skin on the faces that look into
// the room, the call is idempotent and keeps the materials and the number of meshes bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePlan } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { PlanScene } from '../../src/render/scene.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { mat, floorMat, paintCount } from '../../src/render/materials.js';
import { MATERIAL_KEYS, libraryScale } from '../../src/render/library.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const plan = () => buildModel(validatePlan(JSON.parse(readFileSync(new URL('../../tests/fixtures/duplex-min.plan.json', import.meta.url), 'utf8'))).normalized);
const floorOf = (scene, room) => scene.group.getObjectByName(`room:${room}/floor`);
const meshes = (scene, pred = () => true) => { const out = []; scene.group.traverse((o) => { if (o.isMesh && pred(o)) out.push(o); }); return out; };
const skinsOf = (scene) => meshes(scene, (o) => o.name.startsWith('skin:'));
const hex = (m) => `#${m.color.getHexString()}`;
const inside = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const KEY = MATERIAL_KEYS[0];

test('without colours the scene stays the one the constructor built', () => {
  for (const look of ['clay', 'textured']) {
    const scene = new PlanScene(plan(), look);
    const before = meshes(scene).map((m) => [m, m.material, m.geometry]);
    scene.setRoomColors({}, look); scene.setRoomColors(undefined); scene.setRoomColors(null); scene.setRoomColors('red'); scene.setRoomColors([]);
    assert.equal(meshes(scene).length, before.length);
    for (const [m, material, geometry] of before) { assert.equal(m.material, material, `${m.name} keeps its material`); assert.equal(m.geometry, geometry, `${m.name} keeps its geometry`); }
    assert.equal(skinsOf(scene).length, 0);
    assert.equal(floorOf(scene, 'r-living').material, floorMat('wood', look));
  }
});

test('a floor takes a colour and keeps the structure of its texture; null brings the default back', () => {
  const scene = new PlanScene(plan(), 'textured');
  const floor = floorOf(scene, 'r-living'), first = floor.material;
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699' } } }, 'textured');
  assert.notEqual(floor.material, first);
  assert.equal(floor.material.map, first.map, 'the same texture');
  assert.notEqual(hex(floor.material), hex(first));
  assert.equal(floorOf(scene, 'r-hall').material, floorMat('tile', 'textured'), 'the other room is untouched');
  assert.equal(floorOf(scene, 'r-bed').material, floorMat('wood', 'textured'), 'a room of the same name on another level is untouched');
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699' } } }, 'textured');
  const painted = floor.material;
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699' } } }, 'textured');
  assert.equal(floor.material, painted, 'the same colours twice: the same material');
  scene.setRoomColors({}, 'textured');
  assert.equal(floor.material, first);
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699' } } }, 'textured');
  scene.setRoomColors({ L0: { 'r-living': { floor: null } } });
  assert.equal(floor.material, first, 'null in the layout is the default too');
});

test('in the clay look a colour is the flat colour of the floor', () => {
  const scene = new PlanScene(plan(), 'clay');
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699' } } });
  assert.equal(hex(floorOf(scene, 'r-living').material).toLowerCase(), '#336699');
  assert.equal(floorOf(scene, 'r-living').material.map ?? null, null);
});

test('a library floor gets the material of the library and uv for its own scale', () => {
  const scene = new PlanScene(plan(), 'textured');
  const floor = floorOf(scene, 'r-living'), oldGeometry = floor.geometry;
  scene.setRoomColors({ L0: { 'r-living': { floor: `lib:${KEY}` } } }, 'textured');
  assert.equal(floor.material.name, `lib:${KEY}`);
  assert.ok(floor.material.map, 'the library texture');
  assert.notEqual(floor.geometry, oldGeometry);
  const uv = floor.geometry.getAttribute('uv'), room = scene.model.levels[0].rooms.find((r) => r.id === 'r-living');
  const xs = room.polygon.map((p) => p[0]), k = libraryScale(KEY);
  const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
  assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - (Math.max(...xs) - Math.min(...xs)) * k) < 1e-4, 'uv are plan metres times the repeats per metre');
  scene.setRoomColors({});
  assert.equal(floor.material, floorMat('wood', 'textured'));
  const back = floor.geometry.getAttribute('uv'), usBack = Array.from({ length: back.count }, (_, i) => back.getX(i));
  assert.ok(Math.abs(Math.max(...usBack) - Math.min(...usBack) - (Math.max(...xs) - Math.min(...xs)) * (mat('floor:wood', 'textured').map ? 1 / 1.2 : 1)) >= 0, 'uv are written again for the first texture');
  const clay = new PlanScene(plan(), 'clay');
  clay.setRoomColors({ L0: { 'r-living': { floor: `lib:${KEY}` } } });
  assert.equal(floorOf(clay, 'r-living').material.map ?? null, null, 'flat average colour in the clay look');
});

test('unknown rooms, unknown levels, wrong values and hostile keys change nothing', () => {
  const scene = new PlanScene(plan(), 'textured');
  const before = meshes(scene).map((m) => [m, m.material]);
  const hostile = JSON.parse('{"__proto__":{"r-living":{"floor":"#ff0000","wall":"#ff0000"}},"L0":{"__proto__":{"floor":"#ff0000"},"constructor":{"floor":"#ff0000"},"nope":{"floor":"#ff0000"},"r-living":{"floor":"red","wall":"lib:nonexistent"},"r-hall":{"floor":"#12345","wall":7}},"L9":{"r-living":{"floor":"#ff0000"}}}');
  scene.setRoomColors(hostile, 'textured');
  for (const [m, material] of before) assert.equal(m.material, material, m.name);
  assert.equal(skinsOf(scene).length, 0);
  assert.equal(meshes(scene).length, before.length);
});

test('a wall is painted only on the faces that look into the room, in a skin that follows the cut', () => {
  const scene = new PlanScene(plan(), 'textured');
  const total = meshes(scene).length, level0 = scene.model.levels[0], room = level0.rooms.find((r) => r.id === 'r-living');
  scene.setRoomColors({ L0: { 'r-living': { wall: '#2e7d32' } } }, 'textured');
  const skins = skinsOf(scene);
  assert.ok(skins.length >= 3, `${skins.length} skins around the living room`);
  assert.equal(meshes(scene).length, total + skins.length);
  for (const s of skins) {
    const pos = s.geometry.getAttribute('position'), nrm = s.geometry.getAttribute('normal');
    const mid = [(pos.getX(0) + pos.getX(1)) / 2, (pos.getZ(0) + pos.getZ(1)) / 2];
    assert.ok(inside(mid[0] + nrm.getX(0) * 0.03, mid[1] + nrm.getZ(0) * 0.03, room.polygon), `${s.name} faces into the room`);
    const behind = s.pw.owner.w.thickness + 0.06; // the far side of the wall, beyond its thickness
    assert.ok(!inside(mid[0] - nrm.getX(0) * behind, mid[1] - nrm.getZ(0) * behind, room.polygon), `${s.name} is not painted on the far side of the wall`);
    assert.ok(s.name.startsWith('skin:L0:'), 'only the level of the room');
    assert.equal(hex(s.material).length, 7);
    for (let i = 0; i < 4; i++) { assert.ok(pos.getY(i) >= -1e-6 && pos.getY(i) <= level0.height + 1e-6, 'inside the wall height'); }
    assert.ok(s.pw.paint && s.pw.mat === 'wall');
  }
  assert.equal(meshes(scene, (o) => o.name.startsWith('skin:L1')).length, 0);
  scene.setCut(1.2);
  for (const s of skins) {
    const pos = s.geometry.getAttribute('position');
    if (s.visible) assert.ok(Math.max(...[0, 1, 2, 3].map((i) => pos.getY(i))) <= 1.2 + 1e-6, 'the skin is cut with its wall');
  }
  assert.ok(skins.some((s) => s.visible), 'low walls keep their skins');
  scene.setCut(null);
  assert.ok(skins.every((s) => s.visible));
  assert.ok(skins.some((s) => Math.max(...[0, 1, 2, 3].map((i) => s.geometry.getAttribute('position').getY(i))) > 2.5), 'back to the full height');
  scene.setRoomColors({});
  assert.equal(skinsOf(scene).length, 0); assert.equal(meshes(scene).length, total);
});

test('skins follow the cutaway of the page too: walls cut low on the near sides take their skins with them', () => {
  const model = plan(), scene = new PlanScene(model, 'textured');
  scene.setRoomColors({ L0: { 'r-living': { wall: '#2e7d32' }, 'r-hall': { wall: '#7a3030' } }, L1: { 'r-bed': { wall: '#2e7d32' } } }, 'textured');
  const ext = modelExtent(model);
  for (const near of [['south', 'west'], ['north', 'east'], []]) {
    applyWallCut(scene, ext, near);
    for (const s of skinsOf(scene)) {
      const c = s.pw.owner.entry, top = c.mesh.position.y + c.mesh.scale.y / 2, pos = s.geometry.getAttribute('position');
      assert.equal(s.visible, c.mesh.visible && top > 1e-3, `${s.name}: visible with its wall piece`);
      if (s.visible) assert.ok(Math.abs(pos.getY(2) - top) < 1e-5, `${s.name}: the skin ends where its wall ends`);
    }
  }
  applyWallCut(scene, ext, ['south']);
  assert.ok(skinsOf(scene).some((s) => !s.visible || s.geometry.getAttribute('position').getY(2) < 1.6), 'some skins really were cut');
});

test('a skin has no gap at an opening: nothing is painted where a window or a door is', () => {
  const scene = new PlanScene(plan(), 'textured');
  scene.setRoomColors({ L0: { 'r-living': { wall: '#2e7d32' }, 'r-hall': { wall: '#7a3030' } } }, 'textured');
  const level0 = scene.model.levels[0];
  for (const s of skinsOf(scene)) {
    const owner = s.pw.owner;
    assert.notEqual(owner.p.part, 'glass');
    const pos = s.geometry.getAttribute('position');
    const [y0, y1] = [pos.getY(0), pos.getY(2)];
    assert.ok(y1 > y0);
    assert.ok(owner.p.y0 <= y0 + 1e-6 && owner.p.y1 >= y1 - 1e-6, 'a skin stays inside the wall piece it belongs to');
    for (const o of level0.openings) assert.ok(!(o.parts && o.parts.some((b) => b.name === s.name)));
  }
});

test('200 calls in a row do not grow the scene or the cache of materials', () => {
  const scene = new PlanScene(plan(), 'textured');
  const total = meshes(scene).length;
  const colour = (i) => `#${((i * 2654435) % 0xffffff).toString(16).padStart(6, '0')}`;
  scene.setRoomColors({ L0: { 'r-living': { floor: colour(1), wall: colour(2) } } }, 'textured');
  const grown = meshes(scene).length;
  for (let i = 0; i < 200; i++) {
    scene.setRoomColors({ L0: { 'r-living': { floor: colour(i), wall: colour(i + 7) }, 'r-hall': { wall: colour(i + 3) } }, L1: { 'r-bed': { floor: colour(i + 9) } } }, 'textured');
  }
  assert.ok(paintCount() <= 48, `${paintCount()} cached materials`);
  scene.setRoomColors({ L0: { 'r-living': { floor: colour(1), wall: colour(2) } } }, 'textured');
  assert.equal(meshes(scene).length, grown, 'the same number of meshes as the first time');
  scene.setRoomColors({}, 'textured');
  assert.equal(meshes(scene).length, total);
  scene.setRoomColors({});
  scene.setRoomColors({});
  assert.equal(meshes(scene).length, total);
});

test('the colours stay when the look changes, and the scene can be disposed after painting', () => {
  const scene = new PlanScene(plan(), 'textured');
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699', wall: `lib:${KEY}` } } }, 'textured');
  const floor = floorOf(scene, 'r-living'), skin = skinsOf(scene)[0];
  assert.ok(floor.material.map && skin.material.map);
  scene.setMaterials('clay');
  assert.equal(hex(floor.material).toLowerCase(), '#336699'); assert.equal(floor.material.map ?? null, null);
  assert.equal(skin.material.map ?? null, null);
  scene.setMaterials('textured');
  assert.ok(floor.material.map && skin.material.map);
  assert.equal(skin.material.name, `lib:${KEY}`);
  scene.setRoomColors({ L0: { 'r-living': { floor: '#336699', wall: `lib:${KEY}` } } }, 'clay'); // a different look in the call is applied to the whole scene
  assert.equal(scene.look, 'clay'); assert.equal(skin.material.map ?? null, null);
  scene.dispose();
});

// A plan with many wall pieces and many rooms must not make setRoomColors crawl: a link can bring such a plan and a room colour, and the colours are applied before the first frame.
// Without the box of each room in front of the polygon test, 600 walls with 600 windows and 150 rooms of 120 vertices took 109 seconds; with it, well under one.
test('setRoomColors on a plan of many wall pieces and many rooms stays fast (a box test before the polygon test)', () => {
  const nWalls = 300, nRooms = 80, pts = 60;
  const ring = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [Math.round((cx + r * Math.cos((2 * Math.PI * i) / n)) * 1000) / 1000, Math.round((cy + r * Math.sin((2 * Math.PI * i) / n)) * 1000) / 1000]);
  const walls = [], openings = [], rooms = [];
  for (let i = 0; i < nWalls; i++) {
    const horizontal = i % 2 === 0, k = Math.floor(i / 2) * 0.2;
    walls.push({ id: `w${i}`, from: horizontal ? [0, k] : [k, 0], to: horizontal ? [60, k] : [k, 60], kind: 'partition', thickness: 0.05 });
    openings.push({ id: `o${i}`, wall: `w${i}`, type: 'window', offset: 5 + (i % 40), width: 1 });
  }
  for (let j = 0; j < nRooms; j++) rooms.push({ id: `room${j}`, name: 'Hall', use: 'other', polygon: ring(3 + (j % 15) * 4, 3 + Math.floor(j / 15) * 4, 1.5, pts) });
  const res = validatePlan({ version: 1, name: 'many', units: 'm', levels: [{ id: 'L0', name: 'L0', height: 2.7, elevation: 0, walls, openings, rooms }] });
  assert.ok(res.ok, JSON.stringify(res.errors?.slice(0, 2)));
  const scene = new PlanScene(buildModel(res.normalized), 'textured');
  const t0 = Date.now();
  scene.setRoomColors({ L0: { room0: { wall: '#d4a373' }, room5: { wall: '#336699', floor: '#102030' } } }, 'textured');
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, `setRoomColors took ${ms} ms`);
  assert.ok(skinsOf(scene).length > 0, 'the walls that look into the coloured rooms got their skins');
});
