// Window light on the floor: a soft warm patch under every window, all of them in one mesh (one draw call for the whole home).
// Where the sun shines through, the patch is the window projected along the sun's rays, so it points the way the light travels and
// grows long when the sun is low; on the sides the sun does not reach, a faint pool of sky light lies just inside the window.
// The shape is computed on the graphics card from the window corners and one sun direction, so changing the hour moves the patches
// without rebuilding anything. Deterministic, no random numbers; never picked.
import * as THREE from 'three';

const LIFT = 0.016; // above the floor, over the contact shadows
const PAD = 0.14; // metres added on each side of the opening before it is projected
const REACH = 4.2; // longest run of a patch on the floor, in metres
const POOL = 1.4; // how far the sky light pool reaches into the room from the window, in metres

const SUN = { value: new THREE.Vector3(0.4, 0.8, 0.4) };
const STRENGTH = { value: 0 };

let texture = null, material = null;

const WARM = new THREE.Color('#ffae62');

const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

// 64 x 64 alpha map: a rectangle with soft edges all around.
function softTexture() {
  if (texture) return texture;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const a = smooth(Math.min(u, 1 - u) / 0.2) * smooth(Math.min(v, 1 - v) / 0.2);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
    }
  }
  texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'window-light';
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function sunPatchMaterial() {
  if (material) return material;
  material = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: '#ffd9a0', blending: THREE.AdditiveBlending });
  material.name = 'window-light';
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uSun = SUN; sh.uniforms.uStrength = STRENGTH;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aCorner;
attribute vec4 aInfo;
uniform vec3 uSun;
varying float vOn;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 sd = normalize(uSun);
  vec2 away = -normalize(sd.xz + vec2(1e-5));
  float rise = aCorner.y - aInfo.x;
  vec2 run = away * (rise / max(sd.y, 0.08));
  float len = length(run);
  if (len > ${REACH.toFixed(2)}) run *= ${REACH.toFixed(2)} / len;
  float lit = smoothstep(0.0, 0.5, dot(aInfo.yz, -away));
  vec2 pool = -aInfo.yz * mix(0.05, ${POOL.toFixed(2)}, uv.y);
  vec2 shift = mix(pool, run, lit);
  transformed = vec3(aCorner.x + shift.x, aInfo.x + ${LIFT.toFixed(3)}, aCorner.z + shift.y);
  vOn = aInfo.w * mix(0.7, 1.0, lit);
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uStrength;
varying float vOn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.a *= vOn * uStrength;`);
  };
  material.customProgramCacheKey = () => 'window-light';
  return material;
}

// k: the interpolated look from timeofday.sample; dir: unit vector towards the sun (the stage passes sunPosition(t).dir).
export function setSunPatchLook(k, dir) {
  const m = sunPatchMaterial();
  if (Array.isArray(dir)) SUN.value.set(dir[0], Math.max(0.05, dir[1]), dir[2]);
  m.color.set(k.sunC).lerp(WARM, 0.4).multiplyScalar(0.36); // a warm light, never a white haze
  STRENGTH.value = Math.min(1, Math.max(0, (k.sunI - 0.6) / 2.4)) * (1 - Math.min(1, Math.max(0, (k.lampK - 0.2) / 0.5)));
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

function sideInside(rooms, x, z) {
  for (const poly of rooms) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > z) !== (yj > z) && x < ((xj - xi) * (z - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) return true;
  }
  return false;
}

// panes: [{ mesh, floorY, rooms }] with the pane box (a unit box scaled to the opening), the height of the floor under it and the
// room polygons of its level (plan coordinates, [x, y] with y on the world z axis). `root` is the group the mesh will live in.
// Returns the mesh (or null) with userData.show(paneMesh, on) to switch the patch of one pane.
export function sunPatchMesh(panes, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pos = [], corner = [], info = [], uv = [], nor = [], index = [], owner = [];
  let n = 0;
  for (const p of panes) {
    const mesh = p.mesh;
    _m.multiplyMatrices(inv, mesh.matrixWorld);
    _n.set(0, 0, 1).transformDirection(_m);
    const nx = _n.x, nz = _n.z, l = Math.hypot(nx, nz);
    if (l < 1e-6) continue;
    const ox = nx / l, oz = nz / l;
    _v.set(0, 0, 0).applyMatrix4(_m);
    const cx = _v.x, cz = _v.z;
    const a = sideInside(p.rooms, cx + 0.45 * ox, cz + 0.45 * oz), b = sideInside(p.rooms, cx - 0.45 * ox, cz - 0.45 * oz);
    if (a === b) continue; // not on the outer wall of a room: no patch
    const out = a ? [-ox, -oz] : [ox, oz]; // the outdoor side
    const sx = Math.max(1e-3, mesh.scale.x), pad = 0.5 + PAD / sx;
    const quad = [[-pad, -0.5, 0, 0], [pad, -0.5, 1, 0], [pad, 0.5, 1, 1], [-pad, 0.5, 0, 1]];
    for (const [lx, ly, u, v] of quad) {
      _v.set(lx, ly, 0).applyMatrix4(_m);
      corner.push(_v.x, _v.y, _v.z);
      pos.push(_v.x, p.floorY + LIFT, _v.z); // a flat stand-in for passes that read the plain positions (ambient occlusion)
      info.push(p.floorY, out[0], out[1], 1);
      uv.push(u, v); nor.push(0, 1, 0);
    }
    index.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
    owner.push(mesh);
    n++;
  }
  if (!n) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); // the ambient occlusion pass reads normals of every mesh
  geo.setIndex(index);
  const m = new THREE.Mesh(geo, sunPatchMaterial());
  m.name = 'window-light'; m.renderOrder = 1; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  m.raycast = () => {}; // never picked
  m.userData.patches = n;
  m.userData.show = (pane, on) => {
    const i = owner.indexOf(pane);
    if (i < 0) return;
    const w = on ? 1 : 0, attr = geo.attributes.aInfo;
    if (attr.getW(i * 4) === w) return;
    for (let k = 0; k < 4; k++) attr.setW(i * 4 + k, w);
    attr.needsUpdate = true;
  };
  return m;
}
