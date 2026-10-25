// Shared materials: a calm "clay" palette and the "textured" look built from procedural textures (see textures.js).
// One material instance per name and look; names without a texture share the clay instance.
import * as THREE from 'three';
import { TEXTURE_SPECS, generateTexture } from './textures.js';
import { getMaterial as libraryMaterial, libraryScale, disposeLibrary, setAnisotropy } from './library.js';

export const LOOKS = ['clay', 'textured'];

export const PALETTE = {
  wall: '#f2efe9',
  frame: '#ebe7de',
  leaf: '#d9c8aa',
  stair: '#d8d2c7',
  slab: '#e3ded4',
  ceiling: '#f6f4ef',
  plate: '#e7e3db',
  ground: '#dedad2',
  wallcap: '#34373c', // the dark top of a wall in the textured cutaway; the clay look never shows it
  'floor:wood': '#c9a27a',
  'floor:tile': '#d9dde0',
  'floor:carpet': '#b9b2a6',
  'floor:stone': '#a9a49a',
  'floor:concrete': '#9a9a98',
  'f:body': '#d8d2c8',
  'f:fabric': '#d8d2c8',
  'f:cushion': '#e8e3d9',
  'f:linen': '#f0ece3',
  'f:soft': '#e8e3d9',
  'f:dark': '#aaa398',
  'f:wood': '#cdb08c',
  'f:white': '#f3f1ec',
  'f:steel': '#c4c8cc',
  'f:screen': '#3b3f45',
  'f:fridge': '#e6e9eb',
  'f:top': '#efebe3',
  'f:bedding': '#f0ece3',
  'f:pillow': '#fbfaf6',
  'f:blanket': '#b4c3c9',
  'f:bathfloor': '#e9eef0',
  'f:pot': '#cdbfae',
  'f:soil': '#6e6558',
  'f:leaf1': '#8aa683',
  'f:leaf2': '#7a9a76',
  'f:leaf3': '#9bb596',
  'f:rug': '#c5ced2',
  'f:rug2': '#dde3e5',
  'f:book0': '#b9a58c',
  'f:book1': '#9fb0a6',
  'f:book2': '#c4b3b0',
  'f:book3': '#a9b4c2',
  'f:book4': '#d1c19f',
  'f:book5': '#8e9aa3',
};

const ROUGH = { 'floor:tile': 0.45, 'f:steel': 0.35, 'f:white': 0.4, 'f:screen': 0.3, 'f:fridge': 0.4 };

// Textured look: material name -> texture key. The tint is the palette colour divided by the texture average (at most 1),
// so a textured model keeps the colours of the clay model and the texture only adds structure.
const TEXTURED = {
  wall: 'wall-plaster',
  ceiling: 'wall-plaster',
  slab: 'wall-plaster',
  leaf: 'wood-furniture',
  stair: 'wood-furniture',
  ground: 'ground',
  'floor:wood': 'floor-wood',
  'floor:tile': 'floor-tile',
  'floor:carpet': 'floor-carpet',
  'floor:stone': 'floor-stone',
  'floor:concrete': 'floor-concrete',
  'f:wood': 'wood-furniture',
  'f:body': 'wood-light',
  'f:soft': 'wood-light',
  'f:fabric': 'boucle',
  'f:cushion': 'boucle',
  'f:linen': 'fabric',
  'f:bedding': 'linen',
  'f:pillow': 'linen',
  'f:blanket': 'knit',
  'f:rug': 'rug-band',
  'f:rug2': 'rug-bold',
  'f:leaf1': 'leaf',
  'f:leaf2': 'leaf',
  'f:leaf3': 'leaf',
};
// The textured look dresses some materials richer than clay (clay keeps its calm pastel palette): the colour a material has in
// the textured look. For a texture it is the tint (never brighter than the texture average), a plain material gets it as is.
export const LOOK_COLOR = {
  'f:leaf1': '#5f9150', 'f:leaf2': '#4f8043', 'f:leaf3': '#78a65e', // leaves: green instead of pastel
  'f:wood': '#9c7048', // walnut furniture against the light oak floor
  'f:fabric': '#857d72', 'f:cushion': '#9b9387', // taupe sofa
  'f:blanket': '#c58a5f', // camel throws and scatter cushions
  'f:rug': '#3f4247', // charcoal rug border
  'f:pot': '#b86f4b', // terracotta pots
};
// A little light a surface gives back, standing in for the bounce light of a room: a ceiling only sees the floor colour of the
// hemisphere light and would turn muddy brown. Textured look only.
const GLOW = { ceiling: 0.15 };
// Per texture: surface roughness and the strength of its normal map.
const SURFACE = {
  'floor-wood': { rough: 0.62, normal: 0.8 },
  'floor-tile': { rough: 0.42, normal: 0.9 },
  'floor-carpet': { rough: 1, normal: 0.7 },
  'floor-stone': { rough: 0.72, normal: 0.8 },
  'floor-concrete': { rough: 0.7, normal: 0.6 },
  'wall-plaster': { rough: 0.95, normal: 0.25 },
  'wood-furniture': { rough: 0.6, normal: 0.6 },
  fabric: { rough: 1, normal: 0.8 },
  rug: { rough: 1, normal: 0.7 },
  ground: { rough: 0.95, normal: 0 },
  linen: { rough: 0.95, normal: 0.7 },
  knit: { rough: 1, normal: 1 },
  boucle: { rough: 1, normal: 0.9 },
  'rug-band': { rough: 1, normal: 0.7 },
  leaf: { rough: 0.55, normal: 0.5 },
  'wood-light': { rough: 0.55, normal: 0.6 },
  'rug-bold': { rough: 1, normal: 0.7 },
};

const cache = new Map();
const textures = new Map();
let anisotropy = 4;

// Surfaces of the material library (src/render/library.js) are addressed as `lib:<key>`, for example mat('lib:oak', 'textured')
// and texScale('lib:oak'); the clay look gives the flat average colour of the surface with the same roughness.
const LIBRARY_PREFIX = 'lib:';

// Repeats per metre of the texture a material uses in the textured look (1 when it has none): geometry builders write uv with it.
export function texScale(name) {
  if (name.startsWith(LIBRARY_PREFIX)) return libraryScale(name.slice(LIBRARY_PREFIX.length));
  const key = TEXTURED[name];
  return key ? 1 / TEXTURE_SPECS[key].world : 1;
}

export function setTextureAnisotropy(n) {
  anisotropy = Math.max(1, n | 0);
  for (const set of textures.values()) for (const t of [set.map, set.normalMap]) if (t) t.anisotropy = anisotropy;
  setAnisotropy(anisotropy);
}

function dataTexture(data, size, name, color) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// The colour map (and the normal map when the texture has one) of a texture key, generated on first use.
export function textureSet(key) {
  let set = textures.get(key);
  if (set) return set;
  const g = generateTexture(key);
  const map = dataTexture(g.color, g.size, `tex:${key}`, true);
  map.userData.mimeType = TEXTURE_SPECS[key].mime;
  set = { map, normalMap: g.normal ? dataTexture(g.normal, g.normalSize, `tex:${key}:normal`, false) : null };
  textures.set(key, set);
  return set;
}

function tintOf(name, key) {
  const [r, g, b] = TEXTURE_SPECS[key].avg;
  const avg = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  const want = new THREE.Color(LOOK_COLOR[name] ?? PALETTE[name] ?? PALETTE.wall);
  return new THREE.Color(Math.min(1, want.r / avg.r), Math.min(1, want.g / avg.g), Math.min(1, want.b / avg.b));
}

function build(name, look) {
  if (name === 'glass' || name === 'f:glass') {
    return new THREE.MeshStandardMaterial({ color: '#a9c6d8', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  }
  const key = look === 'textured' ? TEXTURED[name] : undefined;
  let m;
  if (key) {
    const set = textureSet(key);
    const s = SURFACE[key];
    m = new THREE.MeshStandardMaterial({ color: tintOf(name, key), map: set.map, normalMap: s.normal > 0 ? set.normalMap : null, roughness: s.rough, metalness: 0 });
    // The maps follow the glTF convention (green up in the image, row 0 at the top), which three.js reads with a negative y scale.
    if (m.normalMap) m.normalScale.set(s.normal, -s.normal);
    if (GLOW[name]) m.emissive.copy(m.color).multiplyScalar(GLOW[name]);
    if (name.startsWith('f:leaf')) m.side = THREE.DoubleSide; // a blade is a single sheet
  } else {
    const color = (look === 'textured' && LOOK_COLOR[name]) || PALETTE[name] || PALETTE.wall;
    m = new THREE.MeshStandardMaterial({ color, roughness: ROUGH[name] ?? 0.92, metalness: name === 'f:steel' ? 0.4 : 0 });
  }
  if (name.startsWith('floor:')) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
  return m;
}

export function mat(name, look = 'clay') {
  if (name.startsWith(LIBRARY_PREFIX)) {
    const id = `${look}:${name}`;
    let m = cache.get(id);
    if (!m) { m = libraryMaterial(name.slice(LIBRARY_PREFIX.length), { look }); m.name = name; cache.set(id, m); }
    return m;
  }
  const id = look === 'textured' && (TEXTURED[name] || LOOK_COLOR[name]) ? `t:${name}` : name;
  let m = cache.get(id);
  if (m) return m;
  m = build(name, look);
  m.name = name;
  cache.set(id, m);
  return m;
}

export const floorName = (kind) => `floor:${kind in { wood: 1, tile: 1, carpet: 1, stone: 1, concrete: 1 } ? kind : 'wood'}`;
export const floorMat = (kind, look = 'clay') => mat(floorName(kind), look);

// A copy of mat(name, look) that a scene may colour for one room: `color` ('#rrggbb') re-tints it (a texture keeps its structure and
// its average becomes the colour, a plain material gets the colour as is), `offset` pulls it a little towards the camera (floors, skins on
// walls). The copies are kept in a small cache, oldest dropped first: asking for the same surface again gives the same material.
const PAINT_LIMIT = 48;
const paints = new Map();
export function paintMat(name, color, look = 'clay', offset = false) {
  const hex = color === undefined || color === null ? '' : new THREE.Color(color).getHexString();
  const id = `${look}|${name}|${hex}|${offset ? 1 : 0}`;
  const held = paints.get(id);
  if (held) { paints.delete(id); paints.set(id, held); return held; }
  const m = mat(name, look).clone();
  if (hex) {
    const want = new THREE.Color(color), key = look === 'textured' && !name.startsWith(LIBRARY_PREFIX) ? TEXTURED[name] : undefined;
    if (key) {
      const [r, g, b] = TEXTURE_SPECS[key].avg;
      const avg = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      const c = new THREE.Color(want.r / Math.max(avg.r, 1e-4), want.g / Math.max(avg.g, 1e-4), want.b / Math.max(avg.b, 1e-4));
      const top = Math.max(c.r, c.g, c.b);
      if (top > 1.25) c.multiplyScalar(1.25 / top); // a very light colour on a dark texture would burn out
      m.color.copy(c);
    } else m.color.copy(want);
  }
  if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
  m.name = `${name}${hex ? `#${hex}` : ''}`;
  paints.set(id, m);
  if (paints.size > PAINT_LIMIT) { const [oldId, old] = paints.entries().next().value; paints.delete(oldId); old.dispose(); }
  return m;
}
export const paintCount = () => paints.size;

// Runs fn with the normal maps detached (a GLB export without them is much smaller), then puts them back.
export async function withoutNormalMaps(fn) {
  const held = [];
  for (const m of [...cache.values(), ...paints.values()]) if (m.normalMap) { held.push([m, m.normalMap]); m.normalMap = null; m.needsUpdate = true; }
  try { return await fn(); } finally { for (const [m, n] of held) { m.normalMap = n; m.needsUpdate = true; } }
}

export function disposeMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  for (const m of paints.values()) m.dispose();
  paints.clear();
  for (const set of textures.values()) { set.map.dispose(); set.normalMap?.dispose(); }
  textures.clear();
  disposeLibrary();
}
