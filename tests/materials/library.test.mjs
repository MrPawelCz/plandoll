import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { generateMaps, MATERIAL_DEFS } from '../../src/render/matgen.js';
import { mat, texScale, disposeMaterials } from '../../src/render/materials.js';
import { MATERIAL_KEYS, getMaterial, materialInfo, textureBudget, libraryScale, mipBytes, TEXTURE_MAX_SIZE, TEXTURE_BUDGET_BYTES, disposeLibrary } from '../../src/render/library.js';

const sha = (...bufs) => { const h = createHash('sha256'); for (const b of bufs) h.update(b); return h.digest('hex'); };
const src = (name) => fileURLToPath(new URL(`../../src/render/${name}`, import.meta.url));

test('the library has at least twelve materials covering walls, floors, fabrics, leather, stone and lacquer', () => {
  assert.ok(MATERIAL_KEYS.length >= 12, `${MATERIAL_KEYS.length} keys`);
  for (const key of ['plaster-warm', 'plaster-cool', 'limewash', 'oak', 'oak-smoked', 'walnut', 'tile-grey', 'stone-light', 'boucle', 'linen', 'velvet', 'leather', 'lacquer-white']) {
    assert.ok(MATERIAL_KEYS.includes(key), key);
  }
  const groups = new Set(MATERIAL_KEYS.map((k) => MATERIAL_DEFS[k].group));
  for (const g of ['wall', 'floor', 'fabric', 'leather', 'stone', 'lacquer', 'wood']) assert.ok(groups.has(g), `group ${g}`);
});

test('every key builds a textured and a clay material with roughness in 0..1 and textures of at most 512 px', () => {
  for (const key of MATERIAL_KEYS) {
    const m = getMaterial(key), c = getMaterial(key, { look: 'clay' });
    assert.ok(m.roughness >= 0 && m.roughness <= 1, `${key} roughness ${m.roughness}`);
    assert.ok(m.map && m.roughnessMap, `${key} maps`);
    for (const t of [m.map, m.roughnessMap, m.bumpMap]) {
      assert.ok(t.image.width <= TEXTURE_MAX_SIZE && t.image.height <= TEXTURE_MAX_SIZE, `${key} ${t.name} ${t.image.width}x${t.image.height}`);
    }
    const info = materialInfo(key);
    assert.ok(info.roughness > 0 && info.roughness < 1, `${key} mean roughness ${info.roughness}`);
    assert.ok(Math.abs(c.roughness - info.roughness) < 1e-9, `${key} clay roughness`);
    assert.equal(c.map, null);
    assert.equal(m.userData.libraryKey, key);
    assert.ok(libraryScale(key) > 0);
  }
});

test('the average colour is in 0..255 and agrees with the colour map', () => {
  for (const key of MATERIAL_KEYS) {
    const info = materialInfo(key);
    assert.equal(info.avg.length, 3);
    for (const c of info.avg) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `${key} avg ${info.avg}`);
    const g = generateMaps(key);
    let sum = 0;
    for (let i = 1; i < g.color.length; i += 4) sum += g.color[i];
    const meanGreen = sum / (g.color.length / 4);
    assert.ok(Math.abs(meanGreen - info.avg[1]) < 24, `${key} sRGB green mean ${meanGreen.toFixed(1)} vs average ${info.avg[1]}`);
  }
});

test('texture memory of the whole library stays under 32 MB and is the sum of the textures made', () => {
  for (const key of MATERIAL_KEYS) getMaterial(key);
  const total = textureBudget();
  assert.ok(total > 0 && total <= TEXTURE_BUDGET_BYTES, `budget ${(total / 1048576).toFixed(2)} MB`);
  assert.equal(total, MATERIAL_KEYS.reduce((a, k) => a + materialInfo(k).bytes, 0));
  for (const key of MATERIAL_KEYS) {
    const info = materialInfo(key);
    assert.equal(info.bytes, info.textures.reduce((a, t) => a + t.bytes, 0));
    assert.equal(info.textures[0].bytes, mipBytes(info.size));
  }
  assert.equal(mipBytes(1), 4);
  assert.equal(mipBytes(2), 4 * 4 + 4);
});

test('pixels are deterministic: same key and seed, same hash; another seed or key, another hash', () => {
  const seen = new Map();
  for (const key of MATERIAL_KEYS) {
    const a = generateMaps(key), b = generateMaps(key);
    assert.equal(a.color.length, a.size * a.size * 4);
    assert.equal(a.data.length, a.dsize * a.dsize * 4);
    const h = sha(a.color, a.data);
    assert.equal(h, sha(b.color, b.data), `${key} twice`);
    assert.ok(!seen.has(h), `${key} equals ${seen.get(h)}`);
    seen.set(h, key);
    for (let i = 3; i < a.color.length; i += 4) if (a.color[i] !== 255) assert.fail(`${key} colour alpha`);
  }
  const base = generateMaps('oak'), other = generateMaps('oak', { seed: 1 }), again = generateMaps('oak', { seed: 1 });
  assert.notEqual(sha(base.color), sha(other.color));
  assert.equal(sha(other.color), sha(again.color));
  assert.equal(sha(base.color), sha(generateMaps('oak').color), 'a seeded run leaves no state behind');
});

test('a tint changes only its own copy, never the shared material or the next caller', () => {
  for (const key of MATERIAL_KEYS) {
    const plain = getMaterial(key), red = getMaterial(key, { tint: '#c03020' }), again = getMaterial(key);
    assert.notEqual(plain, red);
    assert.notEqual(plain, again);
    assert.equal(plain.map, red.map, `${key} shares its textures`);
    assert.deepEqual(again.color.toArray(), [1, 1, 1], `${key} untinted colour`);
    red.color.set('#00ff00'); red.roughness = 0.1; red.name = 'changed';
    const next = getMaterial(key);
    assert.deepEqual(next.color.toArray(), [1, 1, 1]);
    assert.equal(next.roughness, 1);
    assert.equal(next.name, key);
  }
});

test('a tint puts the slot colour on the average of the surface (within the cap)', () => {
  const tint = new THREE.Color('#8a8f70');
  for (const key of ['plaster-warm', 'oak', 'boucle', 'linen', 'tile-grey', 'leather', 'velvet']) {
    const m = getMaterial(key, { tint }), info = materialInfo(key), g = generateMaps(key);
    const mean = g.linear;
    for (let c = 0; c < 3; c++) {
      const got = m.color.toArray()[c] * mean[c], want = [tint.r, tint.g, tint.b][c];
      if (Math.max(...m.color.toArray()) < 1.25 - 1e-9) assert.ok(Math.abs(got - want) < 0.005, `${key} channel ${c}: ${got.toFixed(4)} vs ${want.toFixed(4)}`);
    }
    assert.ok(Math.max(...m.color.toArray()) <= 1.25 + 1e-9, `${key} cap`);
    assert.ok(info.avg.every((v) => v >= 0 && v <= 255));
  }
  const clay = getMaterial('boucle', { tint: '#336699', look: 'clay' });
  assert.equal(clay.color.getHexString(), '336699');
  assert.throws(() => getMaterial('no-such-material'), /unknown material/);
  assert.throws(() => generateMaps('no-such-material'), /unknown material/);
});

test('every map tiles: the step across the wrap-around edge is no larger than the largest step inside the tile', () => {
  // Boards and tiles have designed boundaries; the wrap edge has to be no harder than the hardest of those.
  for (const key of MATERIAL_KEYS) {
    const { color, size } = generateMaps(key);
    const lum = (x, y) => { const o = ((y % size) * size + (x % size)) * 4; return color[o] * 0.3 + color[o + 1] * 0.59 + color[o + 2] * 0.11; };
    for (const horizontal of [true, false]) {
      let worst = 0, edge = 0;
      for (let k = 0; k < size; k++) {
        let sum = 0;
        for (let i = 0; i < size; i++) sum += horizontal ? Math.abs(lum(k + 1, i) - lum(k, i)) : Math.abs(lum(i, k + 1) - lum(i, k));
        sum /= size;
        if (k === size - 1) edge = sum; else worst = Math.max(worst, sum);
      }
      assert.ok(edge <= worst * 1.25 + 1, `${key} ${horizontal ? 'horizontal' : 'vertical'} wrap step ${edge.toFixed(2)} vs largest inner ${worst.toFixed(2)}`);
    }
  }
});

test('the generator reads nothing from the environment and the library code stays small', () => {
  const text = readFileSync(src('matgen.js'), 'utf8') + readFileSync(src('library.js'), 'utf8');
  for (const bad of [/Math\.random/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /\bfetch\s*\(|XMLHttpRequest|new Image\b/, /createElement|getContext|OffscreenCanvas/]) assert.ok(!bad.test(text), String(bad));
  assert.ok(statSync(src('matgen.js')).size + statSync(src('library.js')).size < 60 * 1024, 'library code under 60 KB');
  disposeLibrary();
  assert.equal(textureBudget(), 0);
});

test('mat() and texScale() serve library surfaces as lib:<key>, one instance per name and look', () => {
  const oak = mat('lib:oak', 'textured'), clay = mat('lib:oak', 'clay');
  assert.ok(oak.map && oak.roughnessMap, 'textured oak has its maps');
  assert.equal(clay.map, null);
  assert.equal(oak, mat('lib:oak', 'textured'));
  assert.equal(clay, mat('lib:oak', 'clay'));
  assert.equal(oak.name, 'lib:oak');
  assert.equal(texScale('lib:oak'), libraryScale('oak'));
  assert.equal(texScale('wall'), texScale('wall'), 'old names are untouched');
  assert.throws(() => mat('lib:nothing', 'textured'), /unknown material/);
  disposeMaterials();
  assert.equal(textureBudget(), 0, 'disposing the materials frees the library too');
  assert.notEqual(mat('lib:oak', 'textured'), oak, 'a new instance after disposal');
  disposeMaterials();
});
