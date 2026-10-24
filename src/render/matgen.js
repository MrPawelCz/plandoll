// Pixel generators for the material library (src/render/library.js). Pure JavaScript: no DOM, no three.js, and no source of
// randomness other than a seeded hash.
// Everything is seeded (mulberry32 and an integer hash) and uses only + - * / floor sqrt abs min max on floats, so the same
// key and seed give the same bytes on every machine. Every pattern is periodic over its tile, so the maps repeat without seams.
//
// generateMaps(key, { seed }) -> {
//   key, size, dsize,
//   color:  Uint8Array RGBA (size x size), sRGB, alpha 255,
//   data:   Uint8Array RGBA (dsize x dsize), linear data: R = height (bump), G = roughness, B and A = 255,
//   avg:    [r, g, b] mean colour, sRGB 0..255,
//   linear: [r, g, b] mean colour in linear light, 0..1 (what a tint has to be divided by),
//   roughness: mean roughness 0..1
// }
// MATERIAL_DEFS[key] = { group, label, size, dsize, world, bump, seed, roughness (nominal), sheen }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- noise ----

// The caller's seed moves every lattice at once (set by generateMaps for the duration of one run).
let offset = 0;

// Uniform value in [0, 1) from two integers and a seed.
function h2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((seed + offset) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const tri = (x) => Math.abs(x - Math.floor(x) - 0.5) * 2;

// Value noise over a px x py lattice that wraps at the tile edge; (u, v) in tile units.
function vnoise(u, v, px, py, seed) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = u * px, y = v * py;
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  let tx = x - fx0, ty = y - fy0;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const x0 = fx0 % px, y0 = fy0 % py;
  const x1 = x0 + 1 === px ? 0 : x0 + 1, y1 = y0 + 1 === py ? 0 : y0 + 1;
  const a = h2(x0, y0, seed), b = h2(x1, y0, seed), c = h2(x0, y1, seed), d = h2(x1, y1, seed);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

// Sum of octaves, each with twice the cells of the one before; result in 0..1.
function fbm(u, v, px, py, octaves, seed) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u, v, px << o, py << o, seed + o * 101);
    norm += amp; amp *= 0.5;
  }
  return sum / norm;
}

// Cellular noise on an n x n wrapping grid: distance to the nearest (w[0]) and second nearest (w[1]) feature point in cell units
// and a random value of the nearest cell (w[2]).
const W = new Float64Array(3);
function worley(u, v, n, seed) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = u * n, y = v * n, cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const dx = gx + 0.1 + 0.8 * h2(wx, wy, seed) - x, dy = gy + 0.1 + 0.8 * h2(wx, wy, seed + 17) - y;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = h2(wx, wy, seed + 33); } else if (d < f2) f2 = d;
    }
  }
  W[0] = Math.sqrt(f1); W[1] = Math.sqrt(f2); W[2] = id;
  return W;
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// P = [r, g, b, height, roughness] of the pixel being shaded; colour channels 0..255 (sRGB), height and roughness 0..1.
const paint = (P, a, b, t, k = 1) => {
  P[0] = (a[0] + (b[0] - a[0]) * t) * k; P[1] = (a[1] + (b[1] - a[1]) * t) * k; P[2] = (a[2] + (b[2] - a[2]) * t) * k;
};

// ---- surfaces ----
// A maker takes the colour map size and returns shade(u, v, ix, iy, P) for a pixel (u, v in tile units, ix and iy in pixels).

// Lime plaster and limewash: soft clouds, trowel or brush strokes and a fine grain. `shear` turns the strokes diagonal.
function plaster(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const cloud = fbm(u, v, 2, 2, 4, o.seed) - 0.5;
    const sa = fbm(u + o.shear * v, v, 3, 11, 3, o.seed + 7) - 0.5;
    const sb = fbm(u, v + o.shear * u, 12, 3, 3, o.seed + 13) - 0.5;
    const grain = h2(ix, iy, o.seed + 3) - 0.5;
    const f = 1 + cloud * o.cloud + (sa - sb) * o.stroke + grain * o.grain;
    P[0] = base[0] * f * (1 + cloud * o.warm); P[1] = base[1] * f; P[2] = base[2] * f * (1 - cloud * o.warm);
    P[3] = 0.5 + (sa + sb) * 0.6 + grain * 0.18;
    P[4] = o.rough + cloud * 0.08 + grain * 0.05;
  };
}

// Boards that run along x. Each row of boards has two pieces per tile with their own tone and grain; seams are dark grooves.
function boards(o) {
  const light = hex(o.light), dark = hex(o.dark);
  return (size) => {
    const rows = o.rows, start = [], len = [];
    for (let r = 0; r < rows; r++) { start.push(h2(r, 1, o.seed)); len.push(0.3 + 0.4 * h2(r, 2, o.seed)); }
    const gapV = (o.gap * rows) / size, gapU = o.gap / size;
    return (u, v, ix, iy, P) => {
      const vr = v * rows, r = Math.min(rows - 1, Math.floor(vr)), lv = vr - r;
      let x = u - start[r]; x -= Math.floor(x);
      const first = x < len[r];
      const uu = first ? x : x - len[r];
      const sd = o.seed + 53 * (r * 2 + (first ? 0 : 1)) + 11;
      const tone = (h2(r, first ? 3 : 4, o.seed) - 0.5) * o.tone;
      const w1 = fbm(uu, v, 2, rows * 3, 3, sd), w2 = fbm(uu, v, 6, rows * 14, 2, sd + 5);
      const lines = tri(lv * o.rings + (w1 - 0.5) * o.warp + (w2 - 0.5) * o.fine + h2(r, 5, sd) * 9);
      const pores = h2(ix, iy, sd + 9);
      const t = clamp01(0.5 + tone + (lines - 0.5) * o.contrast + (w2 - 0.5) * 0.3 + (pores - 0.5) * 0.05);
      const edge = Math.max(clamp01(1 - Math.min(lv, 1 - lv) / gapV), clamp01(1 - Math.min(x, Math.abs(x - len[r]), 1 - x) / gapU));
      paint(P, dark, light, t, 1 - edge * o.groove);
      P[3] = 0.62 + (lines - 0.5) * 0.14 - edge * 0.5;
      P[4] = o.rough + (pores - 0.5) * 0.1 - (lines - 0.5) * 0.06 + edge * 0.3;
    };
  };
}

// Large-format tiles with grout; every tile has its own cloudy tone.
function tiles(o) {
  const base = hex(o.base), shade = hex(o.shade);
  return (size) => {
    const n = o.count, px = size / n;
    return (u, v, ix, iy, P) => {
      const tx = u * n, ty = v * n, ti = Math.floor(tx), tj = Math.floor(ty);
      const lu = tx - ti, lv = ty - tj, sd = o.seed + 29 * (ti * n + tj + 1);
      const cloud = fbm(lu, lv, 2, 2, 5, sd), vein = tri(fbm(lu, lv, 3, 2, 4, sd + 3) * 6);
      const speck = h2(ix, iy, sd + 5);
      const t = clamp01(0.5 + (h2(ti, tj, o.seed + 1) - 0.5) * o.tone + (cloud - 0.5) * 0.55 - (1 - vein) * (1 - vein) * (1 - vein) * o.vein);
      const grout = clamp01(o.grout - Math.min(lu, 1 - lu, lv, 1 - lv) * px + 0.5);
      paint(P, shade, base, t, 1 - (speck > 0.985 ? 0.07 : 0) - grout * o.groutDark);
      P[3] = 0.66 + (cloud - 0.5) * 0.06 - grout * 0.5;
      P[4] = o.rough + (cloud - 0.5) * 0.2 + grout * (0.95 - o.rough);
    };
  };
}

// Honed light stone: horizontal bands, pits and thin joints between slabs.
function stone(o) {
  const base = hex(o.base), vein = hex(o.vein);
  return (size) => (u, v, ix, iy, P) => {
    const warp = fbm(u, v, 3, 3, 3, o.seed) - 0.5;
    const band = smooth(0.15, 0.85, tri(v * 9 + warp * 3.5)), fine = fbm(u, v, 5, 41, 3, o.seed + 9);
    const pit = fbm(u, v, 40, 120, 2, o.seed + 21);
    const hole = smooth(0.74, 0.8, pit);
    const t = clamp01(0.35 + (band - 0.5) * 0.32 + (fine - 0.5) * 0.55 + (fbm(u, v, 2, 2, 4, o.seed + 4) - 0.5) * 0.5);
    const seam = clamp01(1.2 - Math.min(Math.abs(u * 2 - Math.floor(u * 2 + 0.5)), Math.abs(v * 2 - Math.floor(v * 2 + 0.5))) * size * 0.5 + 0.2);
    paint(P, base, vein, t, 1 - seam * 0.08);
    P[0] *= 1 - hole * 0.14; P[1] *= 1 - hole * 0.2; P[2] *= 1 - hole * 0.28;
    P[3] = 0.62 + (fine - 0.5) * 0.1 - hole * 0.35 - seam * 0.3;
    P[4] = o.rough + (fine - 0.5) * 0.14 + hole * 0.3;
  };
}

// Looped yarn: two layers of round tufts, darker in the gaps.
function loops(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const a = worley(u, v, o.cells, o.seed); const d1 = a[0], id = a[2];
    const b = worley(u, v, o.cells * 2 - 5, o.seed + 41); const d2 = b[0];
    const h1 = smooth(0, 1, 1 - d1 / 0.66), h2v = smooth(0, 1, 1 - d2 / 0.62) * 0.85;
    const h = Math.max(h1, h2v) * (0.82 + 0.18 * h2(ix, iy, o.seed + 6));
    const k = 0.7 + 0.36 * h;
    paint(P, base, base, 0, k * (1 + (id - 0.5) * 0.1));
    P[3] = h; P[4] = o.rough - 0.07 * h;
  };
}

// Plain weave: warp and weft threads with uneven thickness (slubs) and a tone of their own.
function weave(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const N = o.threads, tu = u * N, tv = v * N, iu = Math.floor(tu), iv = Math.floor(tv), fu = tu - iu, fv = tv - iv;
    const weftOver = ((iu + iv) & 1) === 0;
    const slubW = vnoise(u, (iv + 0.5) / N, 7, N, o.seed), slubV = vnoise((iu + 0.5) / N, v, N, 7, o.seed + 5);
    const pv = 1 - (2 * fv - 1) * (2 * fv - 1), pu = 1 - (2 * fu - 1) * (2 * fu - 1);
    const h = weftOver ? 0.5 + 0.5 * pv * (0.7 + 0.5 * slubW) : 0.5 + 0.5 * pu * (0.7 + 0.5 * slubV);
    const tone = weftOver ? h2(iv, 0, o.seed + 1) : h2(iu, 1, o.seed + 2);
    paint(P, base, base, 0, (0.8 + 0.22 * h) * (1 + (tone - 0.5) * 0.1 + ((weftOver ? slubW : slubV) - 0.5) * 0.1));
    P[3] = h * 0.9; P[4] = o.rough;
  };
}

// Pile with swirls: broad light and dark patches and a fine sparkle.
function pile(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const swirl = fbm(u, v, 3, 3, 4, o.seed) - 0.5, sweep = fbm(u + v, v, 2, 6, 3, o.seed + 8) - 0.5;
    const spark = h2(ix, iy, o.seed + 3) - 0.5;
    paint(P, base, base, 0, 1 + swirl * 0.34 + sweep * 0.2 + spark * 0.06);
    P[3] = 0.5 + spark * 0.12 + swirl * 0.1; P[4] = o.rough + swirl * 0.2 + spark * 0.05;
  };
}

// Pebbled leather: round grain cells with fine creases between them, soft mottling and a few long folds.
function hide(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const w = worley(u, v, o.cells, o.seed), edge = w[1] - w[0], id = w[2];
    const grain = smooth(0.03, 0.34, edge), cloud = fbm(u, v, 3, 3, 4, o.seed + 2) - 0.5;
    const fold = 1 - smooth(0, 0.022, Math.abs(fbm(u, v, 2, 3, 2, o.seed + 6) - 0.5));
    paint(P, base, base, 0, (0.87 + 0.13 * grain) * (1 + (id - 0.5) * 0.05 + cloud * 0.2) * (1 - fold * 0.07));
    P[3] = grain * 0.8 + 0.1 - fold * 0.25; P[4] = o.rough + (1 - grain) * 0.28 + fold * 0.1;
  };
}

// Glossy paint with a faint orange peel.
function peel(o) {
  const base = hex(o.base);
  return () => (u, v, ix, iy, P) => {
    const n = fbm(u, v, 12, 12, 3, o.seed) - 0.5, soft = fbm(u, v, 2, 2, 2, o.seed + 1) - 0.5;
    paint(P, base, base, 0, 1 + n * 0.012 + soft * 0.02);
    P[3] = 0.5 + n * 0.2; P[4] = o.rough + n * 0.04;
  };
}

export const MATERIAL_DEFS = {
  'plaster-warm': { group: 'wall', label: 'Warm plaster', size: 512, dsize: 256, world: 2.4, bump: 1.2, seed: 101, roughness: 0.92,
    make: plaster({ base: '#e8dfd0', seed: 101, shear: 1, cloud: 0.07, stroke: 0.1, grain: 0.035, warm: 0.04, rough: 0.9 }) },
  'plaster-cool': { group: 'wall', label: 'Cool plaster', size: 512, dsize: 256, world: 2.4, bump: 1.2, seed: 131, roughness: 0.92,
    make: plaster({ base: '#dde2e2', seed: 131, shear: 1, cloud: 0.06, stroke: 0.09, grain: 0.035, warm: -0.03, rough: 0.9 }) },
  limewash: { group: 'wall', label: 'Limewash', size: 512, dsize: 256, world: 2.4, bump: 0.8, seed: 161, roughness: 0.95,
    make: plaster({ base: '#e3d9c6', seed: 161, shear: 2, cloud: 0.16, stroke: 0.2, grain: 0.025, warm: 0.07, rough: 0.94 }) },
  oak: { group: 'floor', label: 'Oak boards', size: 512, dsize: 512, world: 1.2, bump: 1.6, seed: 201, roughness: 0.55,
    make: boards({ light: '#d9bd8e', dark: '#a8794a', seed: 201, rows: 8, tone: 0.34, contrast: 0.5, warp: 3, fine: 1.5, rings: 10, gap: 1.6, groove: 0.5, rough: 0.52 }) },
  'oak-smoked': { group: 'floor', label: 'Smoked oak boards', size: 512, dsize: 512, world: 1.2, bump: 1.6, seed: 241, roughness: 0.5,
    make: boards({ light: '#7c5a3c', dark: '#3d281a', seed: 241, rows: 8, tone: 0.3, contrast: 0.5, warp: 4, fine: 1.5, rings: 8, gap: 1.6, groove: 0.6, rough: 0.5 }) },
  walnut: { group: 'wood', label: 'Walnut', size: 512, dsize: 256, world: 1.0, bump: 1.0, seed: 281, roughness: 0.5,
    make: boards({ light: '#845a38', dark: '#341f12', seed: 281, rows: 2, tone: 0.1, contrast: 0.5, warp: 7, fine: 1.2, rings: 22, gap: 0.8, groove: 0.2, rough: 0.46 }) },
  'tile-grey': { group: 'floor', label: 'Grey porcelain tile', size: 512, dsize: 512, world: 1.2, bump: 1.0, seed: 301, roughness: 0.34,
    make: tiles({ base: '#c4c6c6', shade: '#8e9293', seed: 301, count: 2, tone: 0.3, vein: 0.07, grout: 1.2, groutDark: 0.3, rough: 0.3 }) },
  'stone-light': { group: 'stone', label: 'Honed limestone', size: 512, dsize: 256, world: 1.2, bump: 0.9, seed: 341, roughness: 0.5,
    make: stone({ base: '#ddd3bf', vein: '#b3a287', seed: 341, rough: 0.46 }) },
  boucle: { group: 'fabric', label: 'Bouclé', size: 256, dsize: 256, world: 0.5, bump: 2.0, seed: 401, roughness: 0.97,
    make: loops({ base: '#e6dece', cells: 30, seed: 401, rough: 0.98 }) },
  linen: { group: 'fabric', label: 'Linen', size: 256, dsize: 256, world: 0.3, bump: 1.4, seed: 441, roughness: 0.92,
    make: weave({ base: '#dcd1ba', threads: 52, seed: 441, rough: 0.92 }) },
  velvet: { group: 'fabric', label: 'Velvet', size: 256, dsize: 128, world: 0.8, bump: 0.5, seed: 481, roughness: 0.72, sheen: true,
    make: pile({ base: '#6c8576', seed: 481, rough: 0.72 }) },
  leather: { group: 'leather', label: 'Pebbled leather', size: 256, dsize: 256, world: 0.4, bump: 1.3, seed: 521, roughness: 0.5,
    make: hide({ base: '#935f3e', cells: 44, seed: 521, rough: 0.42 }) },
  'lacquer-white': { group: 'lacquer', label: 'White lacquer', size: 128, dsize: 64, world: 1.0, bump: 0.3, seed: 561, roughness: 0.16,
    make: peel({ base: '#f1efea', seed: 561, rough: 0.14 }) },
};

// ---- driver ----

const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const linearToSrgb = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const byte = (x) => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));

export function generateMaps(key, { seed = 0 } = {}) {
  const def = MATERIAL_DEFS[key];
  if (!def) throw new Error(`unknown material: ${key}`);
  const { size, dsize } = def;
  offset = (seed | 0) * 977;
  let shade;
  try { shade = def.make(size); } catch (e) { offset = 0; throw e; }
  const color = new Uint8Array(size * size * 4), height = new Float32Array(size * size), rough = new Float32Array(size * size);
  const P = new Float64Array(5);
  let sr = 0, sg = 0, sb = 0, sq = 0;
  for (let iy = 0; iy < size; iy++) {
    const v = (iy + 0.5) / size;
    for (let ix = 0; ix < size; ix++) {
      shade((ix + 0.5) / size, v, ix, iy, P);
      const i = iy * size + ix, o = i * 4;
      const r = byte(P[0]), g = byte(P[1]), b = byte(P[2]);
      color[o] = r; color[o + 1] = g; color[o + 2] = b; color[o + 3] = 255;
      sr += SRGB_TO_LINEAR[r]; sg += SRGB_TO_LINEAR[g]; sb += SRGB_TO_LINEAR[b];
      const q = clamp01(P[4]); height[i] = clamp01(P[3]); rough[i] = q; sq += q;
    }
  }
  offset = 0;
  const n = size * size, f = size / dsize, data = new Uint8Array(dsize * dsize * 4);
  for (let jy = 0; jy < dsize; jy++) {
    for (let jx = 0; jx < dsize; jx++) {
      let h = 0, q = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const i = (jy * f + dy) * size + jx * f + dx; h += height[i]; q += rough[i]; }
      const o = (jy * dsize + jx) * 4;
      data[o] = byte((h / (f * f)) * 255); data[o + 1] = byte((q / (f * f)) * 255); data[o + 2] = 255; data[o + 3] = 255;
    }
  }
  const linear = [sr / n, sg / n, sb / n];
  return { key, size, dsize, color, data, linear, avg: linear.map((c) => Math.round(linearToSrgb(c))), roughness: sq / n };
}
