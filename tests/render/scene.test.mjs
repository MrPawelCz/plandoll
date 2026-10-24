// Scene graph in Node (no GL): metric texture coordinates, cutaway, and the swap between the clay and textured looks.
// The label canvases need a document; a tiny stub is enough because nothing is drawn here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { validatePlan } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { PlanScene, Stage } from '../../src/render/scene.js';
import { mat, texScale, textureSet } from '../../src/render/materials.js';
import { TEXTURE_SPECS } from '../../src/render/textures.js';

const ctx = new Proxy({}, {
  get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const plan = () => buildModel(validatePlan(JSON.parse(readFileSync(new URL('../../tests/fixtures/duplex-min.plan.json', import.meta.url), 'utf8'))).normalized);
const boxes = (scene) => { const out = []; scene.group.traverse((o) => { if (o.isMesh && o.pw?.uv) out.push(o); }); return out; };
const faceRange = (g, face) => {
  const uv = g.getAttribute('uv');
  const us = [0, 1, 2, 3].map((i) => uv.getX(face * 4 + i)), vs = [0, 1, 2, 3].map((i) => uv.getY(face * 4 + i));
  return { u: Math.max(...us) - Math.min(...us), v: Math.max(...vs) - Math.min(...vs), vmax: Math.max(...vs) };
};

test('every box carries uv in metres: face extents equal the box size times the texture scale', () => {
  const scene = new PlanScene(plan(), 'textured');
  const list = boxes(scene);
  assert.ok(list.length > 40, `${list.length} boxes`);
  for (const m of list) {
    const k = m.pw.uv.k, s = m.scale;
    const px = faceRange(m.geometry, 0), py = faceRange(m.geometry, 2), pz = faceRange(m.geometry, 4);
    const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-4, `${m.name} ${what}: ${a} vs ${b}`);
    const turn = m.pw.uv.swap ? ([a, b]) => [b, a] : (p) => p; // door leaves and stairs run their grain across the box
    const [pxu, pxv] = turn([px.u, px.v]), [pyu, pyv] = turn([py.u, py.v]), [pzu, pzv] = turn([pz.u, pz.v]);
    near(pxu, s.z * k, '+x face along z'); near(pxv, s.y * k, '+x face along y');
    near(pyu, s.x * k, '+y face along x'); near(pyv, s.z * k, '+y face along z');
    near(pzu, s.x * k, '+z face along x'); near(pzv, s.y * k, '+z face along y');
  }
});

test('only door leaves and stair steps turn their wood a quarter, everything else keeps the pattern direction', () => {
  const list = boxes(new PlanScene(plan(), 'textured'));
  const turned = new Set(list.filter((m) => m.pw.uv.swap).map((m) => m.pw.mat));
  assert.deepEqual([...turned].sort(), ['leaf', 'stair']);
  for (const mat of ['leaf', 'stair']) assert.ok(list.some((m) => m.pw.mat === mat), `the fixture has ${mat} boxes`);
});

test('shareBoxes survives two overlapping exports: the boxes get their own geometry back', () => {
  const scene = new PlanScene(plan(), 'clay');
  const own = boxes(scene).map((m) => m.geometry);
  scene.shareBoxes(true); scene.shareBoxes(true); // a second export started before the first one ended
  scene.shareBoxes(false); scene.shareBoxes(false);
  boxes(scene).forEach((m, i) => assert.equal(m.geometry, own[i], `${m.name} keeps its own geometry`));
});

test('floors use plan metres as uv, scaled by the texture of the floor', () => {
  const model = plan();
  const scene = new PlanScene(model, 'textured');
  const room = model.levels[0].rooms.find((r) => r.floor === 'wood') ?? model.levels[0].rooms[0];
  let floor;
  scene.group.traverse((o) => { if (o.name === `room:${room.id}/floor`) floor = o; });
  assert.ok(floor, 'floor mesh');
  const k = texScale(`floor:${room.floor}`), pos = floor.geometry.getAttribute('position'), uv = floor.geometry.getAttribute('uv');
  assert.ok(Math.abs(k * TEXTURE_SPECS[{ wood: 'floor-wood', tile: 'floor-tile', carpet: 'floor-carpet', stone: 'floor-stone', concrete: 'floor-concrete' }[room.floor]].world - 1) < 1e-9);
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Math.abs(uv.getX(i) - pos.getX(i) * k) < 1e-5 && Math.abs(uv.getY(i) - pos.getZ(i) * k) < 1e-5, `vertex ${i}`);
  }
});

test('a cutaway keeps the texture scale and the height above the floor', () => {
  const scene = new PlanScene(plan(), 'textured');
  const tall = boxes(scene).filter((m) => m.name.startsWith('wall:') && m.pw.uv && m.scale.y > 2);
  assert.ok(tall.length > 5);
  const before = new Map(tall.map((m) => [m, faceRange(m.geometry, 4)]));
  scene.setCut(1.2);
  for (const m of tall) {
    const k = m.pw.uv.k, f = faceRange(m.geometry, 4);
    assert.ok(Math.abs(f.vmax - 1.2 * k) < 1e-4, `${m.name} top of the cut wall sits at 1.2 m of texture: ${f.vmax / k}`);
    assert.ok(Math.abs(f.v - m.scale.y * k) < 1e-4, `${m.name} the visible height is still in metres of texture`);
    assert.ok(Math.abs(f.u - before.get(m).u) < 1e-6, 'along the wall nothing moves');
  }
  scene.setCut(null);
  for (const m of tall) assert.ok(Math.abs(faceRange(m.geometry, 4).v - before.get(m).v) < 1e-5, 'back to full height gives the old uv');
});

test('setMaterials swaps textured and clay; plain materials stay the same instance', () => {
  const scene = new PlanScene(plan(), 'clay');
  const wall = [];
  let glass = null;
  scene.group.traverse((o) => { if (o.isMesh && o.pw?.mat === 'wall') wall.push(o); if (o.isMesh && o.pw?.mat === 'glass') glass = o; });
  assert.ok(wall.length && glass);
  const clayWall = wall[0].material, clayGlass = glass.material;
  assert.equal(clayWall.map, null);
  scene.setMaterials('textured');
  assert.equal(scene.look, 'textured');
  assert.ok(wall[0].material.map instanceof THREE.DataTexture, 'textured wall has a map');
  assert.notEqual(wall[0].material, clayWall);
  assert.equal(glass.material, clayGlass, 'glass is the same in both looks');
  assert.equal(wall[0].material, mat('wall', 'textured'), 'one instance per name and look');
  scene.setMaterials('clay');
  assert.equal(wall[0].material, clayWall, 'back to the same clay instance');
});

test('textured materials keep the clay colours: tint times texture average is close to the palette', () => {
  for (const [name, key] of [['wall', 'wall-plaster'], ['floor:wood', 'floor-wood'], ['floor:tile', 'floor-tile']]) {
    const m = mat(name, 'textured');
    assert.ok(m.map, `${name} has a map`);
    assert.equal(m.map, textureSet(key).map);
    const clay = mat(name, 'clay').color, [r, g, b] = TEXTURE_SPECS[key].avg;
    const avg = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    for (const c of ['r', 'g', 'b']) assert.ok(Math.abs(m.color[c] * avg[c] - clay[c]) < 0.03, `${name} ${c}: ${m.color[c] * avg[c]} vs ${clay[c]}`);
  }
});

test('the ground plane of the stage follows the look', () => {
  const stage = new Stage(new THREE.Scene());
  const clay = stage.ground.material;
  stage.setMaterials('textured');
  assert.ok(stage.ground.material.map, 'textured ground');
  stage.setMaterials('clay');
  assert.equal(stage.ground.material, clay);
  const uv = stage.ground.geometry.getAttribute('uv');
  assert.ok(Math.abs(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i))) - 600 * texScale('ground')) < 1e-6, 'the 600 m plane carries 600 m of texture');
});

test('textured materials read the glTF normal maps with a negative y scale; only the ceiling glows', () => {
  for (const name of ['wall', 'floor:wood', 'floor:tile', 'f:wood', 'f:fabric']) {
    const m = mat(name, 'textured');
    assert.ok(m.normalMap, `${name} has a normal map`);
    assert.ok(m.normalScale.x > 0 && m.normalScale.y === -m.normalScale.x, `${name} normalScale ${m.normalScale.x}, ${m.normalScale.y}`);
    assert.equal(m.emissive.getHex(), 0, `${name} does not glow`);
  }
  assert.ok(mat('ceiling', 'textured').emissive.r > 0.05, 'the textured ceiling gives a little light back');
  assert.equal(mat('ceiling', 'clay').emissive.getHex(), 0, 'the clay ceiling does not glow');
  assert.equal(mat('wall', 'clay').normalMap, null, 'clay has no normal maps');
});
