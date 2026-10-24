// Material library: thirteen procedural surfaces (plaster, limewash, oak, smoked oak, walnut, porcelain tile, limestone, bouclé,
// linen, velvet, leather, white lacquer) with a colour map, a packed data map and a roughness value. Pixels come from
// src/render/matgen.js (pure JS, seeded); this module only wraps them in textures and materials.
//
//   MATERIAL_KEYS                       keys, in sheet order
//   getMaterial(key, { tint, look })    a fresh material; `tint` is the colour the surface should have on average (hex, css name or
//                                       THREE.Color), `look` 'textured' (default) or 'clay' (flat colour, same roughness)
//   materialInfo(key)                   { key, group, label, roughness, metalness, avg, world, size, bytes, textures, ... }
//   textureBudget()                     bytes of all library textures created so far, mip chains included
//   libraryScale(key)                   texture repeats per metre, for geometry builders that write uv
//   disposeLibrary()                    frees textures and shared materials
//
// The data map holds height in R (used as a bump map) and roughness in G (used as a roughness map), so one texture serves both.
// A shared material per key is kept inside this module and never handed out: getMaterial returns a clone, so a caller may change
// the clone's colour or any other property without touching anyone else's surface.
import * as THREE from 'three';
import { MATERIAL_DEFS, generateMaps } from './matgen.js';

export const MATERIAL_KEYS = Object.keys(MATERIAL_DEFS);
export const TEXTURE_MAX_SIZE = 512;
export const TEXTURE_BUDGET_BYTES = 32 * 1024 * 1024;

const entries = new Map();
let anisotropy = 4;

// Bytes of an RGBA8 texture with its full mip chain.
export function mipBytes(w, h = w) {
  let total = 0;
  for (;;) {
    total += w * h * 4;
    if (w === 1 && h === 1) return total;
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
}

function dataTexture(pixels, size, name, srgb) {
  const t = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function entry(key) {
  let e = entries.get(key);
  if (e) return e;
  const def = MATERIAL_DEFS[key];
  if (!def) throw new Error(`unknown material: ${key}`);
  const g = generateMaps(key);
  const map = dataTexture(g.color, g.size, `lib:${key}`, true);
  const packed = dataTexture(g.data, g.dsize, `lib:${key}:data`, false);
  const avg = new THREE.Color().setRGB(g.linear[0], g.linear[1], g.linear[2], THREE.LinearSRGBColorSpace);
  const bytes = mipBytes(g.size) + mipBytes(g.dsize);
  const params = { color: 0xffffff, map, roughnessMap: packed, roughness: 1, bumpMap: packed, bumpScale: def.bump, metalness: 0 };
  const shared = def.sheen
    ? new THREE.MeshPhysicalMaterial({ ...params, sheen: 1, sheenRoughness: 0.55, sheenColor: avg.clone().multiplyScalar(0.8).offsetHSL(0, 0, 0.05) })
    : new THREE.MeshStandardMaterial(params);
  shared.name = key;
  e = { key, def, map, packed, avg, avgSrgb: g.avg, roughness: g.roughness, bytes, size: g.size, dsize: g.dsize, shared };
  entries.set(key, e);
  return e;
}

// Keeps the average colour of the surface at the tint: the colour map is divided by its own mean (in linear light) so that a
// textured slot looks like the colour of the slot. Channels are capped at 1.25 (the hue is kept) so that a very light tint on a
// dark texture does not blow out its highlights.
function factor(e, tint) {
  const want = new THREE.Color(tint);
  const c = new THREE.Color(want.r / Math.max(e.avg.r, 1e-4), want.g / Math.max(e.avg.g, 1e-4), want.b / Math.max(e.avg.b, 1e-4));
  const top = Math.max(c.r, c.g, c.b);
  if (top > 1.25) c.multiplyScalar(1.25 / top);
  return c;
}

export function getMaterial(key, { tint, look = 'textured' } = {}) {
  const e = entry(key);
  if (look === 'clay') {
    const m = new THREE.MeshStandardMaterial({ color: tint === undefined ? e.avg.clone() : new THREE.Color(tint), roughness: e.roughness, metalness: 0 });
    m.name = key;
    m.userData.libraryKey = key;
    return m;
  }
  const m = e.shared.clone();
  if (tint !== undefined) m.color.copy(factor(e, tint));
  m.userData.libraryKey = key;
  return m;
}

export function materialInfo(key) {
  const e = entry(key), d = e.def;
  return {
    key, group: d.group, label: d.label,
    roughness: e.roughness, metalness: 0,
    avg: [...e.avgSrgb],
    world: d.world, size: e.size, dataSize: e.dsize,
    bytes: e.bytes,
    textures: [{ name: e.map.name, size: e.size, bytes: mipBytes(e.size) }, { name: e.packed.name, size: e.dsize, bytes: mipBytes(e.dsize) }],
  };
}

export function textureBudget() {
  let total = 0;
  for (const e of entries.values()) total += e.bytes;
  return total;
}

// Repeats per metre of the colour map (uv = metres x libraryScale).
export function libraryScale(key) {
  const d = MATERIAL_DEFS[key];
  if (!d) throw new Error(`unknown material: ${key}`);
  return 1 / d.world;
}

export function setAnisotropy(n) {
  anisotropy = Math.max(1, n | 0);
  for (const e of entries.values()) { e.map.anisotropy = anisotropy; e.packed.anisotropy = anisotropy; }
}

export function disposeLibrary() {
  for (const e of entries.values()) { e.shared.dispose(); e.map.dispose(); e.packed.dispose(); }
  entries.clear();
}
