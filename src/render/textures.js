// Procedural textures for the "textured" look (docs/TEXTURES.md). Pure JavaScript: no DOM, no three.js, no randomness
// beyond a seeded integer hash, so every run on every machine produces the same bytes (only + - * / floor sqrt abs min
// max are used on floats, no trigonometry, exp, pow or log).
// Contract used by materials.js and the tests:
//   TEXTURE_SPECS[key] = { size, world, normalSize, mime, avg }
//     size        colour map edge in pixels (square, tiles seamlessly)
//     world       metres covered by one repeat, both axes (one pixel = world / size metres)
//     normalSize  normal map edge in pixels, 0 when the texture has no normal map
//     mime        image type used when the texture is embedded in a GLB ('image/jpeg' for opaque colour maps)
//     avg         target average colour [r, g, b], 0..255 (tests check the generated mean against it)
//   generateTexture(key) -> { key, size, world, color: Uint8Array (RGBA, alpha 255), normalSize, normal: Uint8Array | null }
//     the normal map is tangent space, OpenGL convention (green points to the top of the image), RGBA, alpha 255
// Layout rule: every pattern is periodic over the tile and its joints are placed so the tile edge never lies on a joint,
// which keeps the seam test honest. Wood and stone grain run along x (the u direction).

export const TEXTURE_SPECS = {
  'floor-wood': { size: 1024, world: 2.0, normalSize: 512, mime: 'image/jpeg', avg: [201, 162, 122] },
  'floor-tile': { size: 1024, world: 1.2, normalSize: 512, mime: 'image/jpeg', avg: [217, 221, 224] },
  'floor-carpet': { size: 512, world: 1.0, normalSize: 256, mime: 'image/jpeg', avg: [185, 178, 166] },
  'floor-stone': { size: 1024, world: 2.0, normalSize: 512, mime: 'image/jpeg', avg: [169, 164, 154] },
  'floor-concrete': { size: 512, world: 2.0, normalSize: 256, mime: 'image/jpeg', avg: [154, 154, 152] },
  'wall-plaster': { size: 512, world: 1.0, normalSize: 256, mime: 'image/jpeg', avg: [242, 239, 233] },
  'wood-furniture': { size: 512, world: 1.0, normalSize: 256, mime: 'image/jpeg', avg: [205, 176, 140] },
  fabric: { size: 256, world: 0.5, normalSize: 256, mime: 'image/jpeg', avg: [216, 210, 200] },
  rug: { size: 512, world: 1.0, normalSize: 256, mime: 'image/jpeg', avg: [197, 206, 210] },
  ground: { size: 512, world: 4.0, normalSize: 0, mime: 'image/jpeg', avg: [222, 218, 210] },
  linen: { size: 256, world: 0.35, normalSize: 256, mime: 'image/jpeg', avg: [238, 233, 224] },
  knit: { size: 256, world: 0.4, normalSize: 256, mime: 'image/jpeg', avg: [180, 195, 201] },
  boucle: { size: 256, world: 0.4, normalSize: 256, mime: 'image/jpeg', avg: [200, 190, 176] },
  'rug-band': { size: 128, world: 0.5, normalSize: 128, mime: 'image/jpeg', avg: [150, 160, 166] },
  leaf: { size: 128, world: 0.25, normalSize: 128, mime: 'image/jpeg', avg: [150, 190, 125] },
  'wood-light': { size: 512, world: 1.0, normalSize: 256, mime: 'image/jpeg', avg: [221, 209, 190] },
  'rug-bold': { size: 512, world: 1.2, normalSize: 256, mime: 'image/jpeg', avg: [196, 191, 181] },
};

// Normal map strength per texture (height units per pixel of the colour map to unit slope).
const NORMAL_STRENGTH = {
  'floor-wood': 2.0,
  'floor-tile': 1.8,
  'floor-carpet': 0.3,
  'floor-stone': 1.8,
  'floor-concrete': 0.25,
  'wall-plaster': 0.3,
  'wood-furniture': 0.5,
  fabric: 2.0,
  rug: 0.3,
  linen: 1.4,
  knit: 1.5,
  boucle: 1.1,
  'rug-band': 0.8,
  leaf: 0.6,
  'wood-light': 0.5,
  'rug-bold': 0.3,
};

export function textureKeys() {
  return Object.keys(TEXTURE_SPECS);
}

// ---- integer hash ----

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Uniform value in [0, 1) from two integers and a seed.
function hash2(x, y, seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(x, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(y, 0x297a2d39);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// White noise with unit standard deviation (a uniform distribution scaled by sqrt(12)).
function wn(x, y, seed) {
  return (hash2(x, y, seed) - 0.5) * 3.4641016;
}

// ---- small helpers (polynomials only) ----

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function step(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// 1 between a and b with soft edges of half width e.
const band = (d, a, b, e) => step(a - e, a + e, d) * (1 - step(b - e, b + e, d));

// Pixel coverage of a line of width w (pixels) whose centre is d pixels from the pixel centre.
function lineCover(d, w) {
  const c = (w + 1) * 0.5 - d;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

// Distance in pixels from the centre of pixel p to a periodic line at position c (period = size).
function circDist(p, c, size) {
  let d = p + 0.5 - c;
  d -= size * Math.floor(d / size + 0.5);
  return d < 0 ? -d : d;
}

function put(c, i, r, g, b) {
  c[i] = r < 0 ? 0 : r > 255 ? 255 : r + 0.5;
  c[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g + 0.5;
  c[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b + 0.5;
  c[i + 3] = 255;
}

// Periodic fractal value noise, zero mean and unit standard deviation. The first octave has cx x cy lattice cells across
// the tile (so cx cells along x), every further octave doubles both counts; lattice indices wrap, so the field tiles.
function noiseField(size, cx, cy, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  const c0 = new Int32Array(size), c1 = new Int32Array(size), ct = new Float32Array(size);
  const r0 = new Int32Array(size), r1 = new Int32Array(size), rt = new Float32Array(size);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const nx = cx * (1 << o), ny = cy * (1 << o);
    if (nx > size || ny > size) break;
    const lat = new Float32Array(nx * ny);
    const s = seed + Math.imul(o, 7919);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lat[j * nx + i] = hash2(i, j, s) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const f = (x * nx) / size, i = Math.floor(f);
      c0[x] = i; c1[x] = (i + 1) % nx; ct[x] = smooth5(f - i);
    }
    for (let y = 0; y < size; y++) {
      const f = (y * ny) / size, j = Math.floor(f);
      r0[y] = (j % ny) * nx; r1[y] = ((j + 1) % ny) * nx; rt[y] = smooth5(f - j);
    }
    for (let y = 0; y < size; y++) {
      const a0 = r0[y], a1 = r1[y], ty = rt[y], row = y * size;
      for (let x = 0; x < size; x++) {
        const i0 = c0[x], i1 = c1[x], tx = ct[x];
        const top = lat[a0 + i0] + (lat[a0 + i1] - lat[a0 + i0]) * tx;
        const bot = lat[a1 + i0] + (lat[a1 + i1] - lat[a1 + i0]) * tx;
        out[row + x] += amp * (top + (bot - top) * ty);
      }
    }
    amp *= gain;
  }
  let sum = 0, sq = 0;
  const n = out.length;
  for (let i = 0; i < n; i++) { sum += out[i]; sq += out[i] * out[i]; }
  const mean = sum / n, k = 1 / Math.sqrt(Math.max(sq / n - mean * mean, 1e-12));
  for (let i = 0; i < n; i++) out[i] = (out[i] - mean) * k;
  return out;
}

// Joint positions (metres, modulo `period`) for each row of a running-bond layout, chosen so joints of neighbouring rows
// (including the last row against the first, because the tile wraps) are at least `gap` apart. draw(r, attempt) -> joints.
function runningBond(rows, period, gap, draw) {
  const circ = (d) => { const e = d - period * Math.floor(d / period + 0.5); return e < 0 ? -e : e; };
  const joints = [];
  for (let r = 0; r < rows; r++) {
    const neighbours = r > 0 ? [joints[r - 1]] : [];
    if (r === rows - 1 && rows > 1) neighbours.push(joints[0]);
    let best = null, bestGap = -1;
    for (let a = 0; a < 60; a++) {
      const js = draw(r, a);
      let g = period;
      for (const nb of neighbours) for (const p of js) for (const q of nb) g = Math.min(g, circ(p - q));
      if (g >= gap) { best = js; break; }
      if (g > bestGap) { bestGap = g; best = js; }
    }
    joints.push(best);
  }
  return joints;
}

// Wool pile shared by carpet and rug: small multiplicative deviation and a fibre height field.
function pile(size, seed) {
  const n1 = noiseField(size, size >> 2, size >> 2, 2, seed + 1);
  const n2 = noiseField(size, size >> 4, size >> 2, 2, seed + 2);
  const dev = new Float32Array(size * size), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, w = wn(x, y, seed + 3);
      dev[i] = 0.026 * n1[i] + 0.018 * n2[i] + 0.016 * w;
      hgt[i] = 0.5 * n1[i] + 0.3 * n2[i] + 0.6 * w;
    }
  }
  return { dev, hgt };
}

// ---- generators: fill color (RGBA) and height (one float per pixel, higher is raised) ----

// Oak engineered boards: 14 boards across 2 m, two boards per row with random end joints, per-board tone and grain.
function genWood(size, seed, color, height, avg) {
  const ppm = size / 2, rows = 14, rowH = size / rows, off = rowH / 2, m = size - 1;
  const joints = runningBond(rows, 2.0, 0.3, (r, a) => {
    const o = hash2(r, a, seed) * 2.0;
    return [o, (o + 0.6 + hash2(r, a, seed + 1) * 0.8) % 2.0];
  });
  const rowOf = new Uint8Array(size), distY = new Float32Array(size);
  for (let y = 0; y < size; y++) {
    let yy = y + 0.5 - off;
    if (yy < 0) yy += size;
    const r = Math.min(rows - 1, Math.floor(yy / rowH)), t = yy - r * rowH;
    rowOf[y] = r;
    distY[y] = t < rowH - t ? t : rowH - t;
  }
  const boardOf = new Uint8Array(rows * size), distX = new Float32Array(rows * size);
  for (let r = 0; r < rows; r++) {
    const p1 = joints[r][0] * ppm, p2 = joints[r][1] * ppm, span = (p2 - p1 + size) % size;
    for (let x = 0; x < size; x++) {
      boardOf[r * size + x] = (x + 0.5 - p1 + size) % size < span ? 0 : 1;
      const d1 = circDist(x, p1, size), d2 = circDist(x, p2, size);
      distX[r * size + x] = d1 < d2 ? d1 : d2;
    }
  }
  const fine = noiseField(size, 8, 256, 2, seed + 11);
  const med = noiseField(size, 4, 64, 2, seed + 12);
  const band = noiseField(size, 3, 24, 2, seed + 13);
  const nb = rows * 2;
  const tone = new Float32Array(nb), hue = new Float32Array(nb), ox = new Int32Array(nb), oy = new Int32Array(nb);
  for (let i = 0; i < nb; i++) {
    tone[i] = hash2(i, 1, seed + 20) * 2 - 1;
    hue[i] = hash2(i, 2, seed + 20) * 2 - 1;
    ox[i] = Math.floor(hash2(i, 3, seed + 20) * size);
    oy[i] = Math.floor(hash2(i, 4, seed + 20) * size);
  }
  for (let y = 0; y < size; y++) {
    const r = rowOf[y], dy = distY[y];
    for (let x = 0; x < size; x++) {
      const id = r * 2 + boardOf[r * size + x], dx = distX[r * size + x];
      const g = lineCover(dx < dy ? dx : dy, 1.0);
      const k = ((y + oy[id]) & m) * size + ((x + ox[id]) & m);
      const lum = 1 + 0.05 * tone[id] + 0.026 * fine[k] + 0.014 * med[k] + 0.008 * band[k];
      const h = hue[id], v = 1 - 0.35 * g;
      put(color, (y * size + x) * 4,
        avg[0] * lum * (1 + 0.012 * h) * v, avg[1] * lum * v, avg[2] * (1 + (lum - 1) * 1.3) * (1 - 0.025 * h) * v);
      height[y * size + x] = -g + 0.05 * fine[k];
    }
  }
}

// Porcelain stoneware, 2 x 2 tiles of 0.6 m, 3.5 mm grout, faint veining and speckle, tone varies per tile.
function genTile(size, seed, color, height, avg) {
  const half = size / 2, q = size / 4, m = size - 1;
  const dist = new Float32Array(size), cell = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const a = circDist(p, q, size), b = circDist(p, q + half, size);
    dist[p] = a < b ? a : b;
    cell[p] = p + 0.5 >= q && p + 0.5 < q + half ? 1 : 0;
  }
  const warp = noiseField(size, 3, 3, 3, seed + 1);
  const warp2 = noiseField(size, 2, 3, 3, seed + 2);
  const show = noiseField(size, 2, 2, 2, seed + 4);
  const mott = noiseField(size, 4, 4, 3, seed + 3);
  const tone = new Float32Array(4), ox = new Int32Array(4), oy = new Int32Array(4);
  for (let i = 0; i < 4; i++) {
    tone[i] = hash2(i, 1, seed + 20) * 2 - 1;
    ox[i] = Math.floor(hash2(i, 2, seed + 20) * size);
    oy[i] = Math.floor(hash2(i, 3, seed + 20) * size);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = cell[y] * 2 + cell[x];
      const d = dist[x] < dist[y] ? dist[x] : dist[y];
      const g = lineCover(d, 3.0);
      const k = ((y + oy[t]) & m) * size + ((x + ox[t]) & m);
      const w = wn(x, y, seed + 11);
      let lum = 1 + 0.025 * tone[t] + 0.006 * mott[k] + 0.007 * w;
      // veins: thin wavy lines along the two diagonals (integer counts keep them periodic), faded in and out
      const pa = ((x + ox[t] + y + oy[t]) * 3) / size + 0.3 * warp[k];
      const pb = ((x + ox[t] - y - oy[t] + 2 * size) * 2) / size + 0.3 * warp2[k];
      const fa = Math.abs(pa - Math.floor(pa + 0.5)), fb = Math.abs(pb - Math.floor(pb + 0.5));
      const vis = step(-0.2, 1.0, show[k]);
      lum -= vis * (0.024 * (1 - step(0, 0.006, fa)) + 0.008 * (1 - step(0, 0.03, fa)) + 0.016 * (1 - step(0, 0.005, fb)));
      const u = hash2(x, y, seed + 9);
      if (u < 0.01) lum -= 0.02 + 4 * u;
      else if (u > 0.992) lum += 0.015;
      const gl = 1 + 0.012 * w;
      put(color, (y * size + x) * 4,
        avg[0] * lum * (1 - g) + 186 * gl * g, avg[1] * lum * (1 - g) + 189 * gl * g, avg[2] * lum * (1 - g) + 192 * gl * g);
      height[y * size + x] = (d < 1.5 ? -1 : d < 3 ? -(3 - d) / 1.5 : 0) + 0.03 * w + 0.01 * mott[k];
    }
  }
}

// Short wool pile: fine isotropic fibres, a little direction along x, very soft low frequency shading.
function genCarpet(size, seed, color, height, avg) {
  const { dev, hgt } = pile(size, seed);
  const low = noiseField(size, 3, 3, 3, seed + 4);
  for (let i = 0; i < size * size; i++) {
    const lum = 1 + 0.025 * low[i] + dev[i];
    put(color, i * 4, avg[0] * lum, avg[1] * lum * (1 - 0.002 * low[i]), avg[2] * lum * (1 - 0.006 * low[i]));
    height[i] = hgt[i];
  }
}

// Travertine slabs in rows of 0.4 m (5 per 2 m), three slabs of 0.5 to 0.9 m per row, 3 mm grout, cloudy mottling,
// thin wavy strata and small elongated pits.
function genStone(size, seed, color, height, avg) {
  const ppm = size / 2, rows = 5, rowH = size / rows, off = rowH / 2, m = size - 1;
  // three slabs per row: w1 and w2 are drawn so that the remainder w3 = 2.0 - w1 - w2 also falls in 0.5 to 0.9 m
  const joints = runningBond(rows, 2.0, 0.15, (r, a) => {
    const o = hash2(r, a, seed) * 2.0;
    const w1 = 0.5 + 0.4 * hash2(r, a, seed + 1), rest = 2.0 - w1;
    const lo = Math.max(0.5, rest - 0.9), hi = Math.min(0.9, rest - 0.5);
    const w2 = lo + (hi - lo) * hash2(r, a, seed + 2);
    return [o, (o + w1) % 2.0, (o + w1 + w2) % 2.0];
  });
  const rowOf = new Uint8Array(size), distY = new Float32Array(size);
  for (let y = 0; y < size; y++) {
    let yy = y + 0.5 - off;
    if (yy < 0) yy += size;
    const r = Math.min(rows - 1, Math.floor(yy / rowH)), t = yy - r * rowH;
    rowOf[y] = r;
    distY[y] = t < rowH - t ? t : rowH - t;
  }
  const slabOf = new Uint8Array(rows * size), distX = new Float32Array(rows * size);
  for (let r = 0; r < rows; r++) {
    const [j0, j1, j2] = joints[r].map((j) => j * ppm);
    const s1 = (j1 - j0 + size) % size, s2 = (j2 - j0 + size) % size;
    for (let x = 0; x < size; x++) {
      const rel = (x + 0.5 - j0 + size) % size;
      slabOf[r * size + x] = rel < s1 ? 0 : rel < s2 ? 1 : 2;
      let d = circDist(x, j0, size);
      const d1 = circDist(x, j1, size), d2 = circDist(x, j2, size);
      if (d1 < d) d = d1;
      if (d2 < d) d = d2;
      distX[r * size + x] = d;
    }
  }
  const mott = noiseField(size, 3, 3, 4, seed + 1);
  const bandA = noiseField(size, 4, 48, 3, seed + 2, 0.55);
  const bandB = noiseField(size, 3, 36, 3, seed + 3, 0.55);
  const warp = noiseField(size, 3, 3, 2, seed + 4);
  const ns = rows * 3;
  const tone = new Float32Array(ns), hue = new Float32Array(ns), ox = new Int32Array(ns), oy = new Int32Array(ns);
  for (let i = 0; i < ns; i++) {
    tone[i] = hash2(i, 1, seed + 20) * 2 - 1;
    hue[i] = hash2(i, 2, seed + 20) * 2 - 1;
    ox[i] = Math.floor(hash2(i, 3, seed + 20) * size);
    oy[i] = Math.floor(hash2(i, 4, seed + 20) * size);
  }
  for (let y = 0; y < size; y++) {
    const r = rowOf[y], dy = distY[y];
    for (let x = 0; x < size; x++) {
      const id = r * 3 + slabOf[r * size + x], dx = distX[r * size + x];
      const d = dx < dy ? dx : dy;
      const g = lineCover(d, 1.5);
      const sx = (x + ox[id]) & m, sy = (y + oy[id]) & m, k = sy * size + sx;
      const wy = Math.floor(warp[k] * 9);
      const kw = ((sy + wy) & m) * size + sx;
      const w = wn(x, y, seed + 11);
      const va = 1 - step(0, 0.09, Math.abs(bandA[kw])), vb = 1 - step(0, 0.07, Math.abs(bandB[kw]));
      let lum = 1 + 0.04 * tone[id] + 0.025 * mott[k] + 0.008 * w + 0.028 * va * va - 0.03 * vb * vb;
      let pit = 0;
      if (hash2(x >> 2, y >> 1, seed + 21) < 0.0035) {
        pit = (x & 3) === 1 || (x & 3) === 2 ? 1 : 0.55;
        lum -= 0.06 * pit;
      }
      const h = hue[id], gl = 1 + 0.012 * w;
      put(color, (y * size + x) * 4,
        avg[0] * lum * (1 + 0.01 * h) * (1 - g) + 146 * gl * g, avg[1] * lum * (1 - g) + 141 * gl * g,
        avg[2] * lum * (1 - 0.015 * h) * (1 - g) + 131 * gl * g);
      height[y * size + x] = -(d < 0.75 ? 1 : d < 1.75 ? 1.75 - d : 0) + 0.03 * mott[k] + 0.02 * w - 0.35 * pit;
    }
  }
}

// Polished screed: cloudy low frequency patches, faint trowel smears, rare dark pores.
function genConcrete(size, seed, color, height, avg) {
  const cloud = noiseField(size, 4, 4, 5, seed + 1);
  const mid = noiseField(size, 24, 24, 2, seed + 2);
  const smear = noiseField(size, 2, 9, 3, seed + 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, w = wn(x, y, seed + 4), u = hash2(x, y, seed + 5);
      let lum = 1 + 0.024 * cloud[i] + 0.01 * mid[i] + 0.008 * smear[i] + 0.006 * w;
      let pore = 0;
      if (u < 0.0012) { pore = 1; lum -= 0.16; } else if (u > 0.9985) lum += 0.03;
      put(color, i * 4, avg[0] * lum * (1 + 0.003 * cloud[i]), avg[1] * lum, avg[2] * lum * (1 - 0.004 * cloud[i]));
      height[i] = 0.25 * mid[i] + 0.15 * w - pore;
    }
  }
}

// Matt paint on plaster: almost flat, a faint orange peel and a very slow drift so the wall stays calm.
function genPlaster(size, seed, color, height, avg) {
  const peel = noiseField(size, size >> 2, size >> 2, 2, seed + 1);
  const drift = noiseField(size, 3, 3, 3, seed + 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, w = wn(x, y, seed + 3);
      const lum = 1 + 0.0075 * peel[i] + 0.005 * drift[i] + 0.003 * w;
      put(color, i * 4, avg[0] * lum * (1 + 0.0015 * drift[i]), avg[1] * lum, avg[2] * lum * (1 - 0.002 * drift[i]));
      height[i] = peel[i] + 0.5 * w;
    }
  }
}

// Oak veneer: gently wavy growth rings along x (the ring count is an integer so the tile closes), a tone per ring, fine
// streaks, tiny pore dashes and rays.
function genFurniture(size, seed, color, height, avg) {
  const rings = 44;
  const warp = noiseField(size, 2, 3, 2, seed + 1, 0.4);
  const fine = noiseField(size, 4, size >> 2, 2, seed + 2);
  const low = noiseField(size, 2, 3, 2, seed + 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const phase = (y * rings) / size + 1.8 * warp[i] + 0.06 * fine[i];
      const n = Math.floor(phase), p = phase - n, nm = ((n % rings) + rings) % rings;
      const h0 = hash2(nm, 0, seed + 7), h1 = hash2((nm + 1) % rings, 0, seed + 7);
      const ring = (h0 + (h1 - h0) * step(0, 1, p)) * 2 - 1;
      const dark = step(0.5, 0.82, p) * (1 - step(0.82, 1.0, p));
      let lum = 1 + 0.012 * fine[i] + 0.012 * low[i] + 0.018 * ring;
      let pore = 0;
      if (hash2(x >> 2, y, seed + 5) < 0.07 * (1 - dark)) {
        pore = (x & 3) === 1 || (x & 3) === 2 ? 1 : 0.5;
        lum -= 0.07 * pore;
      }
      if (hash2(x >> 3, y >> 1, seed + 6) < 0.012) lum += 0.04;
      put(color, i * 4, avg[0] * lum * (1 - 0.05 * dark), avg[1] * lum * (1 - 0.07 * dark), avg[2] * lum * (1 - 0.09 * dark));
      height[i] = 0.03 * fine[i] - pore;
    }
  }
}

// Upholstery cloth in a 2/2 twill: 4 px threads with slightly uneven thickness, each thread floats over two crossings and
// under two, which gives soft diagonal ribs instead of a screen like grid.
function genFabric(size, seed, color, height, avg) {
  const th = 4, n = size / th;
  const bounds = (axis) => {
    const b = new Float32Array(n + 1);
    for (let k = 0; k < n; k++) b[k] = k * th - th / 2 + (hash2(k, axis, seed) - 0.5) * 1.2;
    b[n] = b[0] + size;
    return b;
  };
  const mapAxis = (b) => {
    const idx = new Uint8Array(size), u = new Float32Array(size);
    for (let p = 0; p < size; p++) {
      let q = p + 0.5;
      if (q >= b[n]) q -= size;
      let k = 0;
      while (k < n - 1 && q >= b[k + 1]) k++;
      idx[p] = k;
      u[p] = (q - b[k]) / (b[k + 1] - b[k]);
    }
    return { idx, u };
  };
  const X = mapAxis(bounds(1)), Y = mapAxis(bounds(2));
  const tw = new Float32Array(n), tf = new Float32Array(n);
  for (let k = 0; k < n; k++) { tw[k] = hash2(k, 3, seed) * 2 - 1; tf[k] = hash2(k, 4, seed) * 2 - 1; }
  const slub = noiseField(size, 3, 3, 3, seed + 5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, ci = X.idx[x], rj = Y.idx[y], s = (ci + rj) & 3, warpTop = s < 2;
      // position along the two crossing float of the thread that is on top
      const along = warpTop ? s + Y.u[y] - 1 : s - 2 + X.u[x] - 1, across = 2 * (warpTop ? X.u[x] : Y.u[y]) - 1;
      const shade = (1 - 0.12 * across * across) * (1 - 0.1 * along * along);
      const lum = shade * (warpTop ? 0.975 : 1.0) * (1 + 0.022 * (warpTop ? tw[ci] : tf[rj]) + 0.007 * slub[i] + 0.012 * wn(x, y, seed + 6));
      put(color, i * 4, avg[0] * lum * 1.1, avg[1] * lum * 1.1, avg[2] * lum * 1.1);
      height[i] = shade;
    }
  }
}

// Wool rug: soft diamonds in two close tones (cell 0.5 m, two by two per tile) over the same pile as the carpet.
function genRug(size, seed, color, height, avg) {
  const { dev, hgt } = pile(size, seed);
  const wobble = noiseField(size, 4, 4, 3, seed + 7);
  const abrash = noiseField(size, 2, 24, 2, seed + 8);
  const cellPx = size / 2, shiftX = cellPx * 0.25, shiftY = cellPx * 0.5;
  for (let y = 0; y < size; y++) {
    const v = ((y + shiftY) % cellPx) / cellPx - 0.5;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, u = ((x + shiftX) % cellPx) / cellPx - 0.5;
      const d = (u < 0 ? -u : u) + (v < 0 ? -v : v) + 0.012 * wobble[i];
      const q = clamp01(1 - step(0.13, 0.18, d) + band(d, 0.3, 0.38, 0.02) + band(d, 0.62, 0.7, 0.02) + step(0.84, 0.89, d));
      const lum = 1 + dev[i] + 0.01 * abrash[i];
      put(color, i * 4, avg[0] * lum * (1.012 - 0.065 * q), avg[1] * lum * (1.01 - 0.055 * q), avg[2] * lum * (1.008 - 0.045 * q));
      height[i] = hgt[i];
    }
  }
}

// Light pavers of 1 x 1 m (four by four per tile), 1 px joints, tone per paver, fine sandy roughness.
function genGround(size, seed, color, height, avg) {
  const slab = size / 4, half = slab / 2, m = size - 1;
  const dist = new Float32Array(size), idx = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const t = (p + 0.5 - half + size) % slab;
    dist[p] = t < slab - t ? t : slab - t;
    idx[p] = Math.floor(((p + 0.5 - half + size) % size) / slab);
  }
  const mott = noiseField(size, 4, 4, 3, seed + 1);
  const fine = noiseField(size, size >> 2, size >> 2, 2, seed + 2);
  const tone = new Float32Array(16), ox = new Int32Array(16), oy = new Int32Array(16);
  for (let i = 0; i < 16; i++) {
    tone[i] = hash2(i, 1, seed + 20) * 2 - 1;
    ox[i] = Math.floor(hash2(i, 2, seed + 20) * size);
    oy[i] = Math.floor(hash2(i, 3, seed + 20) * size);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const id = idx[y] * 4 + idx[x];
      const g = lineCover(dist[x] < dist[y] ? dist[x] : dist[y], 1.0);
      const k = ((y + oy[id]) & m) * size + ((x + ox[id]) & m);
      const lum = (1 + 0.02 * tone[id] + 0.008 * mott[k] + 0.012 * fine[k] + 0.012 * wn(x, y, seed + 3)) * (1 - 0.14 * g);
      put(color, (y * size + x) * 4, avg[0] * lum, avg[1] * lum, avg[2] * lum);
    }
  }
}

// Linen sheet: a plain weave of 4 px threads, a few thicker, darker threads (slubs) and a very soft mottling.
function genLinen(size, seed, color, height, avg) {
  const th = 4, n = size / th;
  const tone = new Float32Array(n * 2), slub = new Float32Array(n * 2);
  for (let k = 0; k < n * 2; k++) { tone[k] = hash2(k, 3, seed) * 2 - 1; slub[k] = hash2(k, 4, seed) < 0.1 ? 1 : 0; }
  const mottle = noiseField(size, 2, 2, 2, seed + 5);
  // The weave is shifted half a thread so that the tile edge runs through the middle of a thread, not along a thread joint.
  for (let y = 0; y < size; y++) {
    const yy = (y + th / 2) % size, rj = Math.floor(yy / th), uy = ((yy % th) + 0.5) / th;
    for (let x = 0; x < size; x++) {
      const xx = (x + th / 2) % size, i = y * size + x, ci = Math.floor(xx / th), ux = ((xx % th) + 0.5) / th;
      const warpTop = ((ci + rj) & 1) === 0;
      const across = 2 * (warpTop ? ux : uy) - 1, along = 2 * (warpTop ? uy : ux) - 1;
      const t = warpTop ? ci : n + rj;
      const shade = (1 - 0.1 * across * across) * (1 - 0.08 * along * along);
      const lum = shade * (warpTop ? 0.985 : 1) * (1 + 0.02 * tone[t] - 0.035 * slub[t] + 0.012 * mottle[i] + 0.014 * wn(x, y, seed + 6));
      put(color, i * 4, avg[0] * lum * 1.08, avg[1] * lum * 1.08, avg[2] * lum * 1.08);
      height[i] = shade + 0.3 * slub[t];
    }
  }
}

// Chunky knit throw: columns of V stitches, 16 px (6 cm in the world) wide and tall, each V two plump legs of twisted yarn.
function genKnit(size, seed, color, height, avg) {
  const cw = 16, rh = 16, hwid = 3.7;
  const fuzz = noiseField(size, size >> 3, size >> 3, 1, seed + 4);
  const ax = cw * 0.5, ay = rh * 1.04;
  const ends = [[cw * 0.1, -rh * 0.04], [cw * 0.9, -rh * 0.04]];
  // The stitch grid is shifted half a cell so that the tile edge runs through the middle of a stitch, not along a row joint.
  for (let y = 0; y < size; y++) {
    const yy = (y + rh / 2) % size, cj = Math.floor(yy / rh), py = yy - cj * rh + 0.5;
    for (let x = 0; x < size; x++) {
      const xx = (x + cw / 2) % size, i = y * size + x, ci = Math.floor(xx / cw), px = xx - ci * cw + 0.5;
      let best = 99, tBest = 0, side = 0;
      for (let s = 0; s < 2; s++) {
        const dx = ends[s][0] - ax, dy = ends[s][1] - ay, len2 = dx * dx + dy * dy;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (ax + dx * t), qy = py - (ay + dy * t), d = Math.sqrt(qx * qx + qy * qy);
        if (d < best) { best = d; tBest = t; side = s; }
      }
      const hgt = best < hwid ? Math.sqrt(1 - (best / hwid) * (best / hwid)) : 0;
      const ph = tBest * 3 + side * 0.5, f = ph - Math.floor(ph), tri = f < 0.5 ? f * 2 : 2 - f * 2;
      const tone = hash2(ci, cj, seed) * 2 - 1;
      const lum = (0.74 + 0.36 * hgt) * (1 + 0.035 * tone + 0.07 * (tri - 0.5) * hgt + 0.03 * wn(x, y, seed + 6));
      put(color, i * 4, avg[0] * lum, avg[1] * lum, avg[2] * lum);
      height[i] = hgt + 0.1 * fuzz[i];
    }
  }
}

// Boucle: a field of overlapping yarn loops (about 1 cm), each in its own tone and slightly oval, a little darker in the gaps.
function genBoucle(size, seed, color, height, avg) {
  const cell = 8, nc = size / cell;
  for (let y = 0; y < size; y++) {
    const cj0 = Math.floor(y / cell);
    for (let x = 0; x < size; x++) {
      const i = y * size + x, ci0 = Math.floor(x / cell);
      let bump = 0, tone = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ci = ci0 + di, cj = cj0 + dj, wi = ((ci % nc) + nc) % nc, wj = ((cj % nc) + nc) % nc;
          const cx = (ci + 0.5 + (hash2(wi, wj, seed) - 0.5) * 0.8) * cell, cy = (cj + 0.5 + (hash2(wi, wj, seed + 1) - 0.5) * 0.8) * cell;
          const rx = 3.6 + hash2(wi, wj, seed + 2) * 2.4, ry = 3.6 + hash2(wi, wj, seed + 3) * 2.4;
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            const b = Math.sqrt(1 - d2);
            if (b > bump) { bump = b; tone = hash2(wi, wj, seed + 4) * 2 - 1; }
          }
        }
      }
      const lum = (0.82 + 0.24 * bump) * (1 + 0.04 * tone + 0.015 * wn(x, y, seed + 6));
      put(color, i * 4, avg[0] * lum, avg[1] * lum, avg[2] * lum);
      height[i] = bump;
    }
  }
}

// Rug border: a tight twill of wool ribs (4 px, 1.6 cm) over the same pile as the carpet.
function genRugBand(size, seed, color, height, avg) {
  const { dev, hgt } = pile(size, seed), rib = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, f = ((x + y) % rib) / rib, tri = f < 0.5 ? f * 2 : 2 - f * 2;
      const lum = (1 + 1.2 * dev[i]) * (0.93 + 0.12 * tri);
      put(color, i * 4, avg[0] * lum, avg[1] * lum, avg[2] * lum);
      height[i] = 0.5 * hgt[i] + 1.4 * tri;
    }
  }
}

// Leaf blade: green with mottling, a pale midrib along x on the middle row, lateral veins sweeping towards the tip and
// darker edges. The uv of a leaf run once across the tile, so one repeat is one leaf.
function genLeaf(size, seed, color, height, avg) {
  const mott = noiseField(size, 4, 4, 3, seed + 1);
  const fine = noiseField(size, size >> 3, size >> 3, 1, seed + 2);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size, dv = v < 0.5 ? 0.5 - v : v - 0.5;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, u = (x + 0.5) / size;
      const rib = 1 - step(0.012, 0.03, dv);
      const ph = u * 6 - dv * 5, f = ph - Math.floor(ph), dd = f < 0.5 ? f : 1 - f;
      const lat = (1 - step(0.018, 0.05, dd)) * step(0.03, 0.06, dv) * (1 - step(0.42, 0.5, dv));
      const edge = step(0.36, 0.5, dv);
      const lum = (1 + 0.05 * mott[i] + 0.02 * fine[i]) * (1 - 0.2 * edge);
      put(color, i * 4, avg[0] * (lum + 0.2 * rib + 0.09 * lat), avg[1] * (lum + 0.12 * rib + 0.07 * lat), avg[2] * (lum + 0.02 * rib));
      height[i] = -0.8 * rib - 0.35 * lat + 0.15 * mott[i];
    }
  }
}

// Bold rug: a cream wool field with a charcoal trellis of nested diamonds (cell 0.6 m, two by two per tile) over the carpet
// pile. The lattice is shifted half a cell, so the tile edge runs through the middle of a diamond, not along a joint.
function genRugBold(size, seed, color, height, avg) {
  const { dev, hgt } = pile(size, seed);
  const wobble = noiseField(size, 4, 4, 3, seed + 7);
  const cellPx = size / 2, off = cellPx / 2;
  for (let y = 0; y < size; y++) {
    const v = ((y + off) % cellPx) / cellPx - 0.5;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, u = ((x + off) % cellPx) / cellPx - 0.5;
      const d = (u < 0 ? -u : u) + (v < 0 ? -v : v) + 0.012 * wobble[i];
      const q = clamp01(band(d, 0.37, 0.52, 0.018) + (1 - step(0.1, 0.13, d)));
      const lum = 1 + dev[i];
      put(color, i * 4, (226 - 108 * q) * lum, (219 - 101 * q) * lum, (204 - 84 * q) * lum);
      height[i] = hgt[i];
    }
  }
}

const GENERATORS = {
  'floor-wood': genWood,
  'floor-tile': genTile,
  'floor-carpet': genCarpet,
  'floor-stone': genStone,
  'floor-concrete': genConcrete,
  'wall-plaster': genPlaster,
  'wood-furniture': genFurniture,
  fabric: genFabric,
  rug: genRug,
  ground: genGround,
  linen: genLinen,
  knit: genKnit,
  boucle: genBoucle,
  'rug-band': genRugBand,
  leaf: genLeaf,
  'wood-light': genFurniture,
  'rug-bold': genRugBold,
};

// Scales each channel so the mean matches the target average (a table lookup, so values stay inside 0..255).
function recenter(color, avg) {
  let s0 = 0, s1 = 0, s2 = 0;
  const n = color.length >> 2;
  for (let i = 0; i < color.length; i += 4) { s0 += color[i]; s1 += color[i + 1]; s2 += color[i + 2]; }
  const luts = [s0, s1, s2].map((s, c) => {
    const gain = avg[c] / Math.max(s / n, 1e-6), lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) { const t = v * gain + 0.5; lut[v] = t > 255 ? 255 : t; }
    return lut;
  });
  for (let i = 0; i < color.length; i += 4) {
    color[i] = luts[0][color[i]]; color[i + 1] = luts[1][color[i + 1]]; color[i + 2] = luts[2][color[i + 2]];
  }
}

// Height field (size x size) to a tangent space normal map of normalSize pixels. Heights are averaged in blocks when the
// normal map is smaller, then central differences with wrapped edges give the slope; the strength is per colour pixel.
function toNormal(height, size, n, strength) {
  const f = size / n;
  let h = height;
  if (f > 1) {
    h = new Float32Array(n * n);
    const inv = 1 / (f * f);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let s = 0;
        for (let j = 0; j < f; j++) { const row = (y * f + j) * size + x * f; for (let i = 0; i < f; i++) s += height[row + i]; }
        h[y * n + x] = s * inv;
      }
    }
  }
  const out = new Uint8Array(n * n * 4), k = (strength / f) * 0.5;
  for (let y = 0; y < n; y++) {
    const up = ((y + n - 1) % n) * n, row = y * n, dn = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const xm = (x + n - 1) % n, xp = (x + 1) % n;
      const nx = -(h[row + xp] - h[row + xm]) * k, ny = (h[dn + x] - h[up + x]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1), o = (row + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 2] = (inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function generateTexture(key) {
  const spec = TEXTURE_SPECS[key];
  if (!spec) throw new Error(`unknown texture: ${key}`);
  const { size, world, normalSize, avg } = spec;
  const color = new Uint8Array(size * size * 4);
  const height = normalSize ? new Float32Array(size * size) : null;
  GENERATORS[key](size, hashString(key), color, height, avg);
  recenter(color, avg);
  const normal = normalSize ? toNormal(height, size, normalSize, NORMAL_STRENGTH[key]) : null;
  return { key, size, world, color, normalSize, normal };
}
