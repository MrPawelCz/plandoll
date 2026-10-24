import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TEXTURE_SPECS, textureKeys, generateTexture } from '../../src/render/textures.js';

// The contract the page relies on: sizes may only shrink, world and avg stay.
const CONTRACT = {
  'floor-wood': { size: 1024, world: 2.0, normalSize: 512, avg: [201, 162, 122] },
  'floor-tile': { size: 1024, world: 1.2, normalSize: 512, avg: [217, 221, 224] },
  'floor-carpet': { size: 512, world: 1.0, normalSize: 256, avg: [185, 178, 166] },
  'floor-stone': { size: 1024, world: 2.0, normalSize: 512, avg: [169, 164, 154] },
  'floor-concrete': { size: 512, world: 2.0, normalSize: 256, avg: [154, 154, 152] },
  'wall-plaster': { size: 512, world: 1.0, normalSize: 256, avg: [242, 239, 233] },
  'wood-furniture': { size: 512, world: 1.0, normalSize: 256, avg: [205, 176, 140] },
  fabric: { size: 256, world: 0.5, normalSize: 256, avg: [216, 210, 200] },
  rug: { size: 512, world: 1.0, normalSize: 256, avg: [197, 206, 210] },
  ground: { size: 512, world: 4.0, normalSize: 0, avg: [222, 218, 210] },
  linen: { size: 256, world: 0.35, normalSize: 256, avg: [238, 233, 224] },
  knit: { size: 256, world: 0.4, normalSize: 256, avg: [180, 195, 201] },
  boucle: { size: 256, world: 0.4, normalSize: 256, avg: [200, 190, 176] },
  'rug-band': { size: 128, world: 0.5, normalSize: 128, avg: [150, 160, 166] },
  leaf: { size: 128, world: 0.25, normalSize: 128, avg: [150, 190, 125] },
  'wood-light': { size: 512, world: 1.0, normalSize: 256, avg: [221, 209, 190] },
  'rug-bold': { size: 512, world: 1.2, normalSize: 256, avg: [196, 191, 181] },
};

// Largest standard deviation of luminance (0..255 scale) over 64 x 64 windows. Measured on the shipped textures and
// rounded up with about 20% headroom; a calm look means no texture may become much busier than it is today.
const MAX_WINDOW_STD = {
  'floor-wood': 15, // board tone steps and grooves fall inside a window
  'floor-tile': 12, // grout lines
  'floor-carpet': 9,
  'floor-stone': 11, // grout lines
  'floor-concrete': 6,
  'wall-plaster': 3,
  'wood-furniture': 8,
  fabric: 14, // the weave itself
  rug: 14, // diamond edges between the two tones
  ground: 8,
  linen: 11, // the weave itself, calmer than the upholstery twill
  knit: 32, // a chunky knit is made of stitches
  boucle: 21, // loops and the gaps between them
  'rug-band': 12,
  leaf: 17, // midrib and veins
  'wood-light': 9,
  'rug-bold': 90, // a charcoal trellis on cream wool
};

const keys = textureKeys();
const cache = new Map();
const tex = (key) => {
  if (!cache.has(key)) cache.set(key, generateTexture(key));
  return cache.get(key);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('the key list and the specs match the contract', () => {
  assert.deepEqual([...keys].sort(), Object.keys(CONTRACT).sort());
  for (const key of keys) {
    const spec = TEXTURE_SPECS[key], want = CONTRACT[key];
    assert.ok(spec.size <= want.size && spec.size > 0, `${key} size ${spec.size}`);
    assert.ok(spec.normalSize <= want.normalSize, `${key} normalSize ${spec.normalSize}`);
    assert.equal(spec.world, want.world, `${key} world`);
    assert.deepEqual(spec.avg, want.avg, `${key} avg`);
    assert.equal(spec.mime, 'image/jpeg', `${key} mime`);
  }
});

test('every texture has the declared sizes, opaque colour and a normal map exactly when normalSize is set', () => {
  for (const key of keys) {
    const spec = TEXTURE_SPECS[key], t = tex(key);
    assert.equal(t.key, key);
    assert.equal(t.size, spec.size);
    assert.equal(t.world, spec.world);
    assert.equal(t.normalSize, spec.normalSize);
    assert.ok(t.color instanceof Uint8Array, `${key} colour type`);
    assert.equal(t.color.length, spec.size * spec.size * 4, `${key} colour length`);
    for (let i = 3; i < t.color.length; i += 4) {
      if (t.color[i] !== 255) assert.fail(`${key} colour alpha ${t.color[i]} at pixel ${i >> 2}`);
    }
    if (spec.normalSize === 0) {
      assert.equal(t.normal, null, `${key} must have no normal map`);
    } else {
      assert.ok(t.normal instanceof Uint8Array, `${key} normal type`);
      assert.equal(t.normal.length, spec.normalSize * spec.normalSize * 4, `${key} normal length`);
      for (let i = 3; i < t.normal.length; i += 4) {
        if (t.normal[i] !== 255) assert.fail(`${key} normal alpha ${t.normal[i]} at pixel ${i >> 2}`);
      }
    }
  }
});

test('an unknown key throws', () => {
  assert.throws(() => generateTexture('floor-lava'), /unknown texture/);
});

test('the mean colour stays within 8 levels of the target on every channel', () => {
  for (const key of keys) {
    const { color, size } = tex(key), n = size * size, sum = [0, 0, 0];
    for (let i = 0; i < color.length; i += 4) { sum[0] += color[i]; sum[1] += color[i + 1]; sum[2] += color[i + 2]; }
    for (let c = 0; c < 3; c++) {
      const mean = sum[c] / n;
      assert.ok(Math.abs(mean - TEXTURE_SPECS[key].avg[c]) <= 8, `${key} channel ${c}: mean ${mean.toFixed(1)}`);
    }
  }
});

test('generation is deterministic byte for byte', () => {
  for (const key of keys) {
    const a = generateTexture(key), b = generateTexture(key);
    assert.equal(sha(a.color), sha(b.color), `${key} colour`);
    if (a.normal) assert.equal(sha(a.normal), sha(b.normal), `${key} normal`);
    assert.equal(sha(a.color), sha(tex(key).color), `${key} colour differs from the cached run`);
  }
});

test('different textures do not share bytes', () => {
  const seen = new Map();
  for (const key of keys) {
    const h = sha(tex(key).color);
    assert.ok(!seen.has(h), `${key} equals ${seen.get(h)}`);
    seen.set(h, key);
  }
});

// Mean absolute difference between the first and the last line along an axis, relative to the mean difference of
// neighbouring lines inside the map. A tile that closes without a seam keeps this ratio near 1.
function seamRatio(buf, size, axis) {
  let edge = 0, inner = 0, ne = 0, ni = 0;
  for (let a = 0; a < size; a++) {
    for (let ch = 0; ch < 3; ch++) {
      const at = (p) => buf[(axis === 0 ? a * size + p : p * size + a) * 4 + ch];
      edge += Math.abs(at(0) - at(size - 1));
      ne++;
      for (let p = 0; p < size - 1; p++) { inner += Math.abs(at(p) - at(p + 1)); ni++; }
    }
  }
  return edge / ne / (inner / ni);
}

test('colour and normal maps tile without a seam on both axes', () => {
  for (const key of keys) {
    const t = tex(key);
    for (const axis of [0, 1]) {
      const r = seamRatio(t.color, t.size, axis);
      assert.ok(r <= 1.5, `${key} colour ${axis === 0 ? 'columns' : 'rows'}: seam ratio ${r.toFixed(2)}`);
      if (t.normal) {
        const rn = seamRatio(t.normal, t.normalSize, axis);
        assert.ok(rn <= 1.5, `${key} normal ${axis === 0 ? 'columns' : 'rows'}: seam ratio ${rn.toFixed(2)}`);
      }
    }
  }
});

test('normals are unit length, point up and use the OpenGL convention', () => {
  for (const key of keys) {
    const { normal, normalSize } = tex(key);
    if (!normal) continue;
    const n = normalSize * normalSize;
    let good = 0, zSum = 0;
    for (let i = 0; i < normal.length; i += 4) {
      const x = (normal[i] / 255) * 2 - 1, y = (normal[i + 1] / 255) * 2 - 1, z = (normal[i + 2] / 255) * 2 - 1;
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len >= 0.97 && len <= 1.03) good++;
      zSum += z;
    }
    assert.ok(good / n >= 0.99, `${key}: ${((good / n) * 100).toFixed(2)}% of normals have unit length`);
    assert.ok(zSum / n > 0.85, `${key}: mean z ${(zSum / n).toFixed(3)}`);
  }
  // wood grooves must exist in the normal map: some pixels lean clearly sideways or up/down
  const wood = tex('floor-wood').normal;
  let steep = 0;
  for (let i = 0; i < wood.length; i += 4) if (Math.abs(wood[i + 1] - 128) > 20) steep++;
  assert.ok(steep > 1000, `floor-wood normal map is flat (${steep} steep pixels)`);
});

test('the normal map follows the OpenGL convention (green towards the top of the image)', () => {
  // The tile grout is a sunken line along x centred on colour row size / 4 (normal row normalSize / 4). Above it (smaller
  // row index) the surface slopes down towards the bottom of the image, so green is below 128; below it green is above.
  const { normal, normalSize: n } = tex('floor-tile');
  const meanGreen = (y0, y1) => {
    let s = 0, c = 0;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < n; x++) { s += normal[(y * n + x) * 4 + 1] - 127.5; c++; }
    return s / c;
  };
  const centre = n / 4;
  assert.ok(meanGreen(centre - 3, centre - 1) < -10, `rows above the grout: ${meanGreen(centre - 3, centre - 1).toFixed(1)}`);
  assert.ok(meanGreen(centre, centre + 2) > 10, `rows below the grout: ${meanGreen(centre, centre + 2).toFixed(1)}`);
  // the same holds along x for red: left of a vertical grout line the surface falls to the right, so red is above 128
  const meanRed = (x0, x1) => {
    let s = 0, c = 0;
    for (let y = 0; y < n; y++) for (let x = x0; x <= x1; x++) { s += normal[(y * n + x) * 4] - 127.5; c++; }
    return s / c;
  };
  assert.ok(meanRed(centre - 3, centre - 1) > 10, `columns left of the grout: ${meanRed(centre - 3, centre - 1).toFixed(1)}`);
  assert.ok(meanRed(centre, centre + 2) < -10, `columns right of the grout: ${meanRed(centre, centre + 2).toFixed(1)}`);
});

test('the whole set stays inside the memory and time budget', () => {
  let bytes = 0;
  const t0 = process.hrtime.bigint();
  for (const key of keys) {
    const t = generateTexture(key);
    bytes += t.color.length + (t.normal ? t.normal.length : 0);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(bytes < 30 * 1000 * 1000, `${bytes} bytes of map data`);
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms to generate everything`);
});

test('textures.js is pure: no imports, no DOM, no three.js, no trigonometry, exp, pow, log, randomness or clock', () => {
  const src = readFileSync(new URL('../../src/render/textures.js', import.meta.url), 'utf8');
  const banned = [
    [/\bimport\b/, 'import'],
    [/\brequire\s*\(/, 'require'],
    [/\bdocument\b/, 'document'],
    [/\bwindow\b/, 'window'],
    [/\bTHREE\b/, 'THREE'],
    [/Math\.(random|sin|cos|tan|asin|acos|atan|exp|pow|log|hypot|cbrt)/, 'a non deterministic or trigonometric Math function'],
    [/\*\*/, 'the ** operator'],
    [/\bDate\b/, 'Date'],
    [/\bperformance\b/, 'performance'],
    [new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), 'a long dash'],
  ];
  for (const [re, what] of banned) assert.ok(!re.test(src), `textures.js must not contain ${what}`);
});

function maxWindowStd(color, size, win = 64, stride = 32) {
  let max = 0;
  for (let y0 = 0; y0 + win <= size; y0 += stride) {
    for (let x0 = 0; x0 + win <= size; x0 += stride) {
      let s = 0, q = 0;
      for (let y = y0; y < y0 + win; y++) {
        for (let x = x0; x < x0 + win; x++) {
          const i = (y * size + x) * 4, v = 0.299 * color[i] + 0.587 * color[i + 1] + 0.114 * color[i + 2];
          s += v; q += v * v;
        }
      }
      const n = win * win, m = s / n, sd = Math.sqrt(Math.max(q / n - m * m, 0));
      if (sd > max) max = sd;
    }
  }
  return max;
}

test('local contrast stays calm in every 64 x 64 window', () => {
  assert.deepEqual(Object.keys(MAX_WINDOW_STD).sort(), [...keys].sort());
  for (const key of keys) {
    const { color, size } = tex(key), sd = maxWindowStd(color, size);
    assert.ok(sd <= MAX_WINDOW_STD[key], `${key}: window std ${sd.toFixed(2)} exceeds ${MAX_WINDOW_STD[key]}`);
  }
});
