// Dynamic cutaway: which walls are cut for which set of near edges, and that the same set always gives the same walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallCutHeight, edgeSides, WALL_LOW, WALL_PART, NEAR_DEFAULT } from '../../src/render/compose.js';
import { applyWallCut } from '../../src/render/cutaway.js';
import { nearSides } from '../../src/app/camera.js';

const ext = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 };
const N = { north: true, west: true }, S = { south: true, east: true }, NE = { north: true, east: true }, SW = { south: true, west: true };

test('the default set of near edges is the main view: south and east are low, north and west stay tall', () => {
  assert.deepEqual(NEAR_DEFAULT, { south: true, east: true });
  for (const [x, z] of [[5, 0.1], [0.1, 4], [5, 7.9], [9.9, 4], [5, 4], [0.1, 0.1], [9.9, 0.1], [0.1, 7.9], [9.9, 7.9]]) {
    assert.equal(wallCutHeight(x, z, ext, 0.3), wallCutHeight(x, z, ext, 0.3, NEAR_DEFAULT), `${x},${z}`);
  }
  assert.equal(wallCutHeight(5, 0.1, ext), Infinity); assert.equal(wallCutHeight(5, 7.9, ext), WALL_LOW);
});

test('wallCutHeight follows the near edges; a corner is low only when both of its walls face the camera', () => {
  assert.equal(wallCutHeight(5, 0.1, ext, 0.3, N), WALL_LOW, 'north wall faces the camera');
  assert.equal(wallCutHeight(5, 7.9, ext, 0.3, N), Infinity, 'south wall faces away');
  assert.equal(wallCutHeight(0.1, 4, ext, 0.3, N), WALL_LOW);
  assert.equal(wallCutHeight(9.9, 4, ext, 0.3, N), Infinity);
  assert.equal(wallCutHeight(5, 4, ext, 0.3, N), WALL_PART, 'partitions do not depend on the view');
  assert.equal(wallCutHeight(9.9, 0.1, ext, 0.3, NE), WALL_LOW, 'the corner of two near walls');
  assert.equal(wallCutHeight(9.9, 0.1, ext, 0.3, { north: true }), Infinity, 'one wall of the corner faces away');
  assert.equal(wallCutHeight(0.1, 7.9, ext, 0.3, SW), WALL_LOW);
  assert.equal(wallCutHeight(5, 0.1, ext, 0.3, null), Infinity, 'no near set: everything outside stays tall');
  assert.deepEqual(edgeSides(0.1, 7.9, ext, 0.3), ['south', 'west']);
  assert.deepEqual(edgeSides(5, 4, ext, 0.3), []);
});

test('every camera direction cuts at least one outer wall low and keeps at least one tall', () => {
  const probe = { north: [5, 0.1], south: [5, 7.9], west: [0.1, 4], east: [9.9, 4] };
  let prev = nearSides(35);
  for (let az = 0; az < 360; az += 5) {
    prev = nearSides(az, prev);
    const heights = Object.values(probe).map(([x, z]) => wallCutHeight(x, z, ext, 0.3, prev));
    assert.ok(heights.some((h) => h === WALL_LOW), `a low wall at ${az}`);
    assert.ok(heights.some((h) => h === Infinity), `a tall wall at ${az}`);
  }
});

function fakePlan() {
  const mk = (x, z, sx, sz) => ({ position: { x, y: 1.3, z }, scale: { x: sx, y: 2.6, z: sz }, visible: true, castShadow: true });
  const walls = { north: mk(5, 0.1, 6, 0.2), south: mk(5, 7.9, 6, 0.2), west: mk(0.1, 4, 0.2, 5), east: mk(9.9, 4, 0.2, 5), part: mk(5, 4, 4.5, 0.1), small: mk(6, 4, 1, 0.1), neCorner: mk(9.9, 0.1, 0.2, 0.2) };
  const caps = [];
  const ps = { cutH: null, cuttables: Object.values(walls).map((mesh) => ({ mesh, y0: 0, y1: 2.6 })), _placeCap(c) { caps.push(c); } };
  return { ps, walls, caps };
}
const heights = (w) => Object.fromEntries(Object.entries(w).map(([k, m]) => [k, m.visible ? +m.scale.y.toFixed(3) : 0]));

test('applyWallCut cuts the near walls low and keeps the others tall', () => {
  const { ps, walls, caps } = fakePlan();
  applyWallCut(ps, ext, S);
  assert.equal(ps.cutH, 1.1, 'the dark wall tops show while the walls are cut');
  assert.deepEqual(heights(walls), { north: 2.6, south: WALL_LOW, west: 2.6, east: WALL_LOW, part: WALL_PART, small: WALL_PART, neCorner: 2.6 });
  assert.equal(caps.length, ps.cuttables.length, 'every wall top is placed again');
  applyWallCut(ps, ext, N);
  assert.deepEqual(heights(walls), { north: WALL_LOW, south: 2.6, west: WALL_LOW, east: 2.6, part: WALL_PART, small: WALL_PART, neCorner: 2.6 });
});

test('applyWallCut gives the same walls for the same set whatever came before, and reports changes', () => {
  const a = fakePlan(), b = fakePlan();
  applyWallCut(a.ps, ext, S);
  applyWallCut(b.ps, ext, N); applyWallCut(b.ps, ext, NE); applyWallCut(b.ps, ext, SW);
  const changed = applyWallCut(b.ps, ext, S);
  assert.deepEqual(heights(a.walls), heights(b.walls));
  assert.deepEqual(Object.values(a.walls).map((m) => m.castShadow), Object.values(b.walls).map((m) => m.castShadow));
  assert.ok(changed > 0, 'walls changed when the view turned back');
  assert.equal(applyWallCut(b.ps, ext, S), 0, 'nothing changes when the set stays the same');
});

test('shadows: a long partition and a full height wall on the sun side do not cast, the rest keep their shadow', () => {
  const { ps, walls } = fakePlan();
  applyWallCut(ps, ext, S);
  assert.deepEqual(Object.fromEntries(Object.entries(walls).map(([k, m]) => [k, m.castShadow])), { north: true, south: true, west: true, east: true, part: false, small: true, neCorner: true }, 'main view: as before, only the long partition is out');
  applyWallCut(ps, ext, N); // the camera looks from the north: the south and east walls are tall and the sun stands on their outer side
  assert.equal(walls.south.castShadow, false); assert.equal(walls.east.castShadow, false);
  assert.equal(walls.north.castShadow, true); assert.equal(walls.west.castShadow, true);
  assert.equal(walls.neCorner.castShadow, true, 'a corner that also touches the north edge keeps its shadow');
  applyWallCut(ps, ext, S);
  assert.equal(walls.south.castShadow, true, 'back in the main view the south wall casts again');
});
