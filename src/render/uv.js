// Box geometry with metric texture coordinates. All boxes share one set of position, normal and index buffers and own
// only their uv buffer, so a model with hundreds of boxes stays small (and a GLB export shares the accessors too).
// uv are computed in a texture frame (metres): the box is centred at (cx, cy, cz) there and has size (sx, sy, sz).
// Faces facing x use (z, y), faces facing y use (x, z), faces facing z use (x, y); k is repeats per metre.
import * as THREE from 'three';

const BASE = new THREE.BoxGeometry(1, 1, 1);
const POSITION = BASE.getAttribute('position');
const NORMAL = BASE.getAttribute('normal');
const AXIS = Array.from({ length: POSITION.count }, (_, i) => {
  const n = [Math.abs(NORMAL.getX(i)), Math.abs(NORMAL.getY(i)), Math.abs(NORMAL.getZ(i))];
  return n.indexOf(Math.max(...n));
});

export function boxGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', POSITION);
  g.setAttribute('normal', NORMAL);
  g.setIndex(BASE.getIndex());
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(POSITION.count * 2), 2));
  return g;
}

// swap turns the pattern a quarter turn (a grain that ran along the box now runs across it).
export function setBoxUV(g, cx, cy, cz, sx, sy, sz, k, swap = false) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < POSITION.count; i++) {
    const x = cx + POSITION.getX(i) * sx, y = cy + POSITION.getY(i) * sy, z = cz + POSITION.getZ(i) * sz;
    const a = AXIS[i];
    const u = (a === 0 ? z : x) * k, v = (a === 1 ? z : y) * k;
    if (swap) uv.setXY(i, v, u); else uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}
