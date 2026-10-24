// Furniture kit: small geometry makers (rounded box, tapered box, cylinder, pleated cloth, cushion, books, leaves) and
// `pieceBuilder`, which collects geometry per (slot, material), merges it and returns one THREE.Group per piece.
// Plain arithmetic and a seeded generator only: the same input always builds the same piece. No files, no network, no DOM.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, texScale } from '../render/materials.js';
import { leafGeometry } from '../render/soft.js';

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
export const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const qLevel = (q) => (q === 'low' ? 0 : q === 'high' ? 2 : 1);
export const deg = (a) => (a * Math.PI) / 180;

// Matrix from a position and Euler angles (radians, order XYZ).
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
}

// ---- own materials (not in the shared library): metals, glass-like surfaces ----
const OWN = {
  'k:brass': () => new THREE.MeshStandardMaterial({ color: '#b99654', roughness: 0.34, metalness: 0.85 }),
  'k:black': () => new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.5, metalness: 0.55 }),
  'k:screen': () => new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.12, metalness: 0.2 }),
  'k:mirror': () => new THREE.MeshStandardMaterial({ color: '#dfe6e8', roughness: 0.03, metalness: 1 }),
  'k:shade': () => new THREE.MeshStandardMaterial({ color: '#f1e6d2', roughness: 0.9, metalness: 0, emissive: '#e9b872', emissiveIntensity: 0.28, side: THREE.DoubleSide }),
  'k:paper': () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 }),
  'k:ceramic': () => new THREE.MeshStandardMaterial({ color: '#ece7de', roughness: 0.3, metalness: 0 }),
};
const matCache = new Map();
const BOOST = 1 / 0.72; // a textured material is tinted by colour / texture average; an override colour is lifted the same way, roughly

// The material of a mesh: the shared one, or a clone tinted with a slot colour and/or switched to vertex colours (the shared one is never changed).
export function materialFor(key, tint = null, vcol = false, look = 'clay') {
  if (typeof key !== 'string') return key;
  const id = `${look}|${key}|${tint ?? ''}|${vcol ? 1 : 0}`;
  let m = matCache.get(id);
  if (m) return m;
  const own = OWN[key];
  if (own && !tint && !vcol) { m = matCache.get(`own|${key}`); if (!m) { m = own(); m.name = key; matCache.set(`own|${key}`, m); } matCache.set(id, m); return m; }
  const base = own ? own() : mat(key, look);
  if (!tint && !vcol) return base;
  m = base.clone();
  m.name = `${key}${tint ? `~${tint}` : ''}${vcol ? '+vc' : ''}`;
  if (tint) {
    m.color.set(tint);
    if (m.map) m.color.setRGB(Math.min(1, m.color.r * BOOST), Math.min(1, m.color.g * BOOST), Math.min(1, m.color.b * BOOST));
  }
  if (vcol) m.vertexColors = true;
  matCache.set(id, m);
  return m;
}
export function disposeKitMaterials() { for (const m of matCache.values()) m.dispose(); matCache.clear(); }

// Swaps the materials of built pieces to a look ('clay' or 'textured'); tinted and vertex-colour meshes keep their tint.
export function applyLook(root, look = 'clay') {
  root.traverse((o) => { const L = o.isMesh && o.userData.look; if (L) o.material = materialFor(L.mat, L.tint, L.vcol, look); });
}

// ---- geometry ----
function axisPos(half, r, flat, seg) {
  const out = [];
  for (let i = 0; i <= seg; i++) out.push(-half + (r * i) / seg);
  for (let j = 1; j < flat; j++) out.push(-half + r + (2 * (half - r) * j) / flat);
  for (let i = 0; i <= seg; i++) out.push(half - r + (r * i) / seg);
  return out;
}

// Box w x h x d centred on the origin with rounded edges (r), `seg` slices per rounded edge, `top` slices across the top face,
// `puff` (stuffed top), `warp(x, z)` (height added to the top face: folds, dents). Attribute faceAxis steers the uv in `add`.
export function roundBox(w, h, d, r = 0.008, o = {}) {
  const seg = o.seg ?? 1, topN = o.top ?? 1, puff = o.puff ?? 0, warp = o.warp ?? null;
  const rad = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const half = [w / 2, h / 2, d / 2], inner = half.map((v) => v - rad);
  const faces = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
  const pos = [], nor = [], ax = [], idx = [];
  for (const [na, sign, ua, va] of faces) {
    const top = na === 1 && sign > 0;
    const U = axisPos(half[ua], rad, top ? topN : 1, seg), V = axisPos(half[va], rad, top ? topN : 1, seg);
    const base = pos.length / 3;
    for (const vv of V) {
      for (const uu of U) {
        const P = [0, 0, 0];
        P[na] = sign * half[na]; P[ua] = uu; P[va] = vv;
        const q = [0, 0, 0], d3 = [0, 0, 0];
        for (let a = 0; a < 3; a++) { q[a] = Math.max(-inner[a], Math.min(inner[a], P[a])); d3[a] = P[a] - q[a]; }
        const len = Math.hypot(d3[0], d3[1], d3[2]) || 1;
        let nx = d3[0] / len, ny = d3[1] / len, nz = d3[2] / len;
        const x = q[0] + nx * rad, z = q[2] + nz * rad;
        let y = q[1] + ny * rad;
        const t = ny > 0 ? ny : 0;
        if (puff && t) {
          const fx = 1 - ((2 * x) / w) ** 2, fz = 1 - ((2 * z) / d) ** 2;
          y += puff * fx * fz * t;
          nx -= puff * ((-8 * x) / (w * w)) * fz * t;
          nz -= puff * ((-8 * z) / (d * d)) * fx * t;
        }
        if (warp && t) {
          const e = 0.01, f0 = warp(x, z);
          y += f0 * t;
          nx -= ((warp(x + e, z) - f0) / e) * t;
          nz -= ((warp(x, z + e) - f0) / e) * t;
        }
        const l2 = Math.hypot(nx, ny, nz) || 1;
        pos.push(x, y, z); nor.push(nx / l2, ny / l2, nz / l2); ax.push(na);
      }
    }
    for (let j = 0; j < V.length - 1; j++) {
      for (let i = 0; i < U.length - 1; i++) {
        const a = base + j * U.length + i, b = a + 1, c = a + U.length, e = c + 1;
        idx.push(a, b, e, a, e, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('faceAxis', new THREE.Float32BufferAttribute(ax, 1));
  g.setIndex(idx);
  return g;
}

// Stuffed cushion: rounded, puffed, with a soft button dent in the middle of the top (dent in metres, 0 for none).
export function cushion(w, h, d, o = {}) {
  const dent = o.dent ?? 0.012, s = 0.13 * Math.min(w, d);
  const warp = dent ? (x, z) => -dent * Math.exp(-(x * x + z * z) / (2 * s * s)) : null;
  return roundBox(w, h, d, o.r ?? Math.min(0.05, h * 0.38), { seg: o.seg ?? 2, top: o.top ?? 4, puff: o.puff ?? h * 0.18, warp });
}

// Box tapering from (wt x dt) at the top to (wb x db) at the bottom, centred, height h (legs).
export function taperBox(wt, dt, wb, db, h) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    p.setXYZ(i, p.getX(i) * lerp(wb, wt, t), (t - 0.5) * h, p.getZ(i) * lerp(db, dt, t));
  }
  g.computeVertexNormals();
  return g;
}

export const cylinder = (rt, rb, h, seg, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const lathe = (profile, seg) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

export function flipped(g) {
  const f = g.clone();
  const ix = f.index;
  for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
  const n = f.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return f;
}

// Hanging pleated cloth in the XY plane: width w, height h (bottom at y = 0, hem at the bottom), `folds` pleats of depth amp in z.
// Returns a closed two-layer sheet (front and back), so it shows from both sides.
export function pleated(w, h, folds, amp, o = {}) {
  const nx = Math.max(8, Math.round(folds * (o.perFold ?? 6))), ny = o.rows ?? 6, rng = mulberry32(o.seed ?? 3);
  const sway = Array.from({ length: folds + 2 }, () => 0.8 + rng() * 0.4);
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, f = u * folds, k = Math.min(folds, Math.floor(f));
      const wave = 0.5 - 0.5 * Math.cos(f * Math.PI * 2);
      pos.push((u - 0.5) * w, v * h, amp * wave * sway[k] * (0.75 + 0.25 * v) + (o.lean ?? 0) * (1 - v));
      uv.push(u, v);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const back = flipped(g);
  back.translate(0, 0, -(o.thick ?? 0.012));
  return mergeGeometries([g, back], false);
}

export function colorize(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

const BOOK_COLORS = ['#7d4a3a', '#2f4858', '#c7a46a', '#8a9a7b', '#d8d0c2', '#3c3c42', '#a85d4a', '#5d7388', '#e1c48a', '#6b5b73', '#b8b3a6', '#415a4b'];

// Books for one shelf compartment: x from -len/2, standing on y = 0, spine toward +z. Returns geometry with vertex colours or null.
export function bookRow(len, maxH, depth, rng, o = {}) {
  const fill = o.fill ?? 0.78, list = [];
  let x = -len / 2 + 0.01;
  const stop = -len / 2 + len * fill;
  let guard = 0;
  while (x < stop && guard++ < 60) {
    if (rng() < (o.gap ?? 0.07)) { x += 0.05 + rng() * 0.08; continue; }
    const t = 0.018 + rng() * 0.03, bh = maxH * (0.62 + rng() * 0.34), bd = depth * (0.78 + rng() * 0.2);
    if (x + t > len / 2 - 0.005) break;
    const col = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
    const g = new THREE.BoxGeometry(t, bh, bd);
    colorize(g, new THREE.Color(col).multiplyScalar(0.85 + rng() * 0.3));
    g.translate(x + t / 2, bh / 2, 0);
    list.push(g);
    x += t + 0.001;
  }
  const lang = deg(14 + rng() * 6), lh = maxH * 0.8;
  if (o.lean !== false && list.length && x + lh * Math.sin(lang) + 0.07 < len / 2) {
    const t = 0.03, bh = lh, bd = depth * 0.85, ang = lang;
    const g = new THREE.BoxGeometry(t, bh, bd);
    colorize(g, new THREE.Color(BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)]));
    g.translate(t / 2, bh / 2, 0);
    g.applyMatrix4(M(0, 0, 0, 0, 0, ang)); // leans toward -x
    g.translate(x + bh * Math.sin(ang) + 0.02, 0, 0);
    list.push(g);
  }
  return list.length ? mergeGeometries(list, false) : null;
}

// Leaf blades on stems: `count` leaves from a seeded generator, each scaled to `len`, tilted out by `tilt`, vertex-coloured. Base at the origin.
export function leafCluster(count, rng, o = {}) {
  const base = leafGeometry(), list = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const len = (o.len ?? 0.3) * (o.shrink ? lerp(1, o.shrink, t) : 1) * (0.8 + rng() * 0.4);
    const az = i * 2.399963 + rng() * 0.6, tilt = (o.tilt ?? 0.9) + (rng() - 0.5) * 0.5 + (o.tiltUp ? t * o.tiltUp : 0);
    const y = (o.rise ?? 0) * (o.risePow ? t ** o.risePow : t);
    const g = base.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, az, 0, 'YXZ')), new THREE.Vector3(len * (o.wide ?? 0.9), len, len));
    g.applyMatrix4(m);
    const r = (o.radius ?? 0.04) * (0.5 + rng());
    g.translate(Math.sin(az) * r, y, Math.cos(az) * r);
    const shade = 0.78 + rng() * 0.4;
    colorize(g, new THREE.Color(shade, shade, shade));
    list.push(g);
  }
  return list.length ? mergeGeometries(list, false) : null;
}

// Procedural art for pictures: soft colour blocks on a ground, from a seed. Returns a THREE.DataTexture (no DOM).
export function artTexture(seed, w = 72, h = 96) {
  const rng = mulberry32(seed), data = new Uint8Array(w * h * 4);
  const pal = ['#d9c7a8', '#7f9a8d', '#c97b63', '#3e5c76', '#e6dccb', '#a18a6f', '#2f3b4a', '#d4a373'];
  const col = () => new THREE.Color(pal[Math.floor(rng() * pal.length)]);
  const bg = col(), shapes = [];
  const kind = Math.floor(rng() * 3);
  for (let i = 0; i < 4; i++) shapes.push({ c: col(), x: rng(), y: rng(), r: 0.12 + rng() * 0.22, w: 0.25 + rng() * 0.5, h: 0.1 + rng() * 0.3 });
  const bands = [col(), col()];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = i / (w - 1), v = j / (h - 1);
      let c = bg.clone();
      if (kind === 0) { // horizon with sun
        c = (v < 0.58 ? bands[0] : bands[1]).clone().lerp(bg, v < 0.58 ? v * 0.7 : 0.2);
        const dx = u - shapes[0].x, dy = v - 0.35;
        if (dx * dx + dy * dy < 0.018) c = shapes[1].c.clone();
      } else if (kind === 1) { // colour fields
        for (const s of shapes) if (Math.abs(u - s.x) < s.w / 2 && Math.abs(v - s.y) < s.h / 2) c = s.c.clone();
      } else { // circles
        for (const s of shapes) { const dx = u - s.x, dy = (v - s.y) * 0.75; if (dx * dx + dy * dy < s.r * s.r * 0.5) c = s.c.clone(); }
      }
      const k = (j * w + i) * 4, g = 0.96 + 0.04 * Math.sin((i * 12.9898 + j * 78.233) * 3.7);
      const sc = c.convertLinearToSRGB();
      data[k] = clamp(sc.r * 255 * g, 0, 255); data[k + 1] = clamp(sc.g * 255 * g, 0, 255); data[k + 2] = clamp(sc.b * 255 * g, 0, 255); data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

// ---- the piece builder ----
function boxUV(g, k) {
  const p = g.attributes.position, n = g.attributes.normal, fa = g.attributes.faceAxis, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let a;
    if (fa) a = fa.getX(i);
    else { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); a = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2; }
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (a === 0) uv.setXY(i, z * k, y * k); else if (a === 1) uv.setXY(i, x * k, z * k); else uv.setXY(i, x * k, y * k);
  }
}
const trisOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

export function pieceBuilder(spec, opts = {}) {
  const size = (opts.size ?? spec.size).map(Number);
  const [w, d, h] = size;
  const colors = opts.colors ?? {};
  const seed = (opts.seed ?? 1) >>> 0;
  const rng = mulberry32((seed ^ hashStr(spec.id)) >>> 0);
  const ql = qLevel(opts.quality);
  const groups = new Map(), emitters = [];
  let tris = 0, truncated = false;
  const b = {
    spec, size, w, d, h, rng, ql, colors, seed,
    // add(slot, geometry, matKey|Material, matrix?, { uv: 'box'|'keep', shadow }): returns false when the triangle budget is spent
    add(slot, geometry, matKey, matrix = null, o = {}) {
      if (!spec.slots.includes(slot)) throw new Error(`${spec.id}: unknown slot "${slot}"`);
      const g = geometry.clone();
      if (matrix) g.applyMatrix4(matrix);
      const t = trisOf(g);
      if (tris + t > spec.maxTris) { truncated = true; g.dispose(); return false; }
      let key = matKey, tint = null;
      const c = colors[slot];
      if (typeof c === 'string' && typeof matKey === 'string') { if (c[0] === '#') tint = c; else key = c; }
      else if (typeof c === 'string' && c[0] === '#') { key = matKey.clone(); key.color.set(c); } // an own material (a picture) is tinted as a whole
      if (o.uv !== 'keep') boxUV(g, typeof key === 'string' ? texScale(key) : 1);
      g.deleteAttribute('faceAxis');
      tris += t;
      const vcol = !!g.attributes.color;
      const id = `${slot}|${typeof key === 'string' ? key : key.uuid}|${tint ?? ''}|${vcol ? 1 : 0}`;
      let gr = groups.get(id);
      if (!gr) { gr = { slot, key, tint, vcol, shadow: o.shadow !== false, geoms: [] }; groups.set(id, gr); }
      gr.geoms.push(g);
      return true;
    },
    // box at a centre [x, y, z] with size [sx, sy, sz]; o.rot = [rx, ry, rz]; o.r = edge radius
    box(slot, key, c, s, r = 0.006, o = {}) {
      return b.add(slot, roundBox(s[0], s[1], s[2], r, { seg: Math.min(o.seg ?? 1, ql === 0 ? 1 : 3), top: ql === 0 ? 1 : o.top, puff: o.puff, warp: o.warp }), key, M(c[0], c[1], c[2], ...(o.rot ?? [0, 0, 0])), o);
    },
    // stuffed cushion geometry with detail by quality level (low: coarse, high: smooth)
    cush(w, h, d, o = {}) { return cushion(w, h, d, { ...o, seg: [1, 2, 2][ql], top: [2, o.top ?? 4, (o.top ?? 4) + 2][ql] }); },
    plain(slot, key, c, s, o = {}) { return b.add(slot, new THREE.BoxGeometry(s[0], s[1], s[2]), key, M(c[0], c[1], c[2], ...(o.rot ?? [0, 0, 0])), o); },
    leg(slot, key, c, wt, wb, hh, o = {}) { return b.add(slot, taperBox(wt, o.dt ?? wt, wb, o.db ?? wb, hh), key, M(c[0], c[1], c[2]), o); },
    cyl(slot, key, c, rt, rb, hh, o = {}) {
      return b.add(slot, cylinder(rt, rb, hh, o.seg ?? [10, 16, 24][ql], o.open), key, M(c[0], c[1], c[2], ...(o.rot ?? [0, 0, 0])), { uv: 'keep', ...o });
    },
    emitter(pos, color, power) { emitters.push({ pos, color: color ?? spec.emits?.color ?? '#ffd9a0', power: power ?? spec.emits?.power ?? 1 }); },
    finish() {
      const group = new THREE.Group();
      group.name = spec.id;
      const present = [];
      for (const gr of groups.values()) {
        if (gr.vcol) for (const g of gr.geoms) if (!g.attributes.color) colorize(g, '#ffffff');
        const merged = gr.geoms.length === 1 ? gr.geoms[0] : mergeGeometries(gr.geoms, false);
        if (!merged) { truncated = true; continue; }
        merged.computeBoundingBox(); merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, materialFor(gr.key, gr.tint, gr.vcol));
        mesh.name = `${spec.id}:${gr.slot}`;
        mesh.userData.slot = gr.slot;
        // userData.look drives applyLook (tints, vertex colours, own metals); pw.mat is set only for plain library materials, so
        // a scene that swaps `mat(pw.mat, look)` by itself touches exactly those meshes and leaves the rest alone.
        if (typeof gr.key === 'string') mesh.userData.look = { mat: gr.key, tint: gr.tint, vcol: gr.vcol };
        if (typeof gr.key === 'string' && !gr.tint && !gr.vcol && !OWN[gr.key]) mesh.pw = { mat: gr.key };
        mesh.castShadow = gr.shadow; mesh.receiveShadow = true;
        group.add(mesh);
        if (!present.includes(gr.slot)) present.push(gr.slot);
      }
      group.userData = { type: spec.id, size, tris, slots: present, emitters, truncated };
      return group;
    },
  };
  return b;
}
