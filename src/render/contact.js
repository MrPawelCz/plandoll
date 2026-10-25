// Soft contact shadows: a dark, blurred footprint on the floor under every piece that stands on it, all of them merged into one
// mesh (one draw call for the whole home). Hung pieces, rugs, lamps on tables and pendants get none. Deterministic, no random numbers.
import * as THREE from 'three';
import { specOf } from '../furniture/specs.js';

export const CONTACT_PAD = 0.24; // metres of soft edge outside the footprint
const LIFT = 0.012; // above the floor, so that thin rugs and floor offsets never hide it
const TOUCH = 0.3; // a part counts as standing on the floor when its lowest point is below this height

const ramp = (x) => { const s = x * x * (3 - 2 * x); return s * s; }; // 0 at the outer edge, 1 at the footprint edge

let texture = null, material = null;

// 32 x 32 alpha map for the 3 x 3 patch: the outer ring falls off, the middle is solid.
function softTexture() {
  if (texture) return texture;
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const a = ramp(Math.min(1, Math.min(u, 1 - u) * 2)) * ramp(Math.min(1, Math.min(v, 1 - v) * 2));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
    }
  }
  texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'contact-shadow';
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function contactMaterial() {
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#2a1d14', opacity: 0.5 });
    material.name = 'contact-shadow';
  }
  return material;
}

// k: the interpolated look from timeofday.sample. The shadow takes the colour of the ground light, darkened.
export function setContactLook(k) {
  const m = contactMaterial();
  m.color.set(k.gnd).multiplyScalar(0.2);
  m.opacity = 0.56 + 0.12 * (1 - Math.min(1, Math.max(0, k.sunI / 3.3)));
}

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _b = new THREE.Box3();

// The part of a piece that touches the floor, as a rectangle in the piece's own frame (x0, x1, z0, z1), or null.
export function footprintOf(g) {
  _inv.copy(g.matrixWorld).invert();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox || geo.boundingBox.isEmpty()) return;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    _b.copy(geo.boundingBox).applyMatrix4(_m);
    if (_b.min.y > TOUCH) return;
    x0 = Math.min(x0, _b.min.x); x1 = Math.max(x1, _b.max.x); z0 = Math.min(z0, _b.min.z); z1 = Math.max(z1, _b.max.z);
  });
  return Number.isFinite(x0 + x1 + z0 + z1) && x1 - x0 > 0.04 && z1 - z0 > 0.04 ? { x0, x1, z0, z1 } : null;
}

// Does this piece get a shadow? Only furniture that stands on the floor and is not lifted.
export function castsContact(g) {
  const mode = specOf(g.userData.pieceType)?.place?.mode;
  return (mode === 'floor' || mode === 'corner') && !(g.userData.elev > 0.05);
}

const idx = [];
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const a = j * 4 + i, b = a + 4; idx.push(a, b, b + 1, a, b + 1, a + 1); }
const UV = [0, 0.5, 0.5, 1];

// One mesh with a 3 x 3 patch per piece, in world space; `skip` (a Set of piece ids) leaves pieces out. Returns null when nothing stands.
export function contactMesh(pieces, skip = null) {
  const pos = [], uv = [], nor = [], index = [], v = new THREE.Vector3();
  let n = 0;
  for (const [id, g] of pieces) {
    if (!g.visible || skip?.has(id) || !castsContact(g)) continue;
    const f = footprintOf(g);
    if (!f) continue;
    const pad = Math.min(CONTACT_PAD, Math.max(0.07, 0.3 * Math.min(f.x1 - f.x0, f.z1 - f.z0))); // small things get a tighter shadow
    const xs = [f.x0 - pad, f.x0, f.x1, f.x1 + pad], zs = [f.z0 - pad, f.z0, f.z1, f.z1 + pad];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        v.set(xs[i], LIFT, zs[j]).applyMatrix4(g.matrixWorld);
        pos.push(v.x, v.y, v.z); uv.push(UV[i], UV[j]); nor.push(0, 1, 0);
      }
    }
    for (const k of idx) index.push(k + n * 16);
    n++;
  }
  if (!n) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); // the ambient occlusion pass reads normals of every mesh
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, contactMaterial());
  mesh.name = 'contact-shadows'; mesh.renderOrder = 1; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.raycast = () => {}; // never picked
  mesh.userData.pieces = n;
  return mesh;
}
