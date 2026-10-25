// Decor pieces: lamps (with emitters), plants, pictures, mirror, curtain.
import * as THREE from 'three';
import { artTexture, glossPlane, leafCluster, lathe, pleated, M, deg, clamp } from '../kit.js';

// Scales a geometry about the vertical axis (x, z) and in y so that it fits the given reach and top, in place.
function fit(g, rx, rz, top) {
  g.computeBoundingBox();
  const bb = g.boundingBox, sx = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)), sz = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
  const fx = sx > rx ? rx / sx : 1, fz = sz > rz ? rz / sz : 1, fy = bb.max.y > top ? top / bb.max.y : 1;
  if (fx < 1 || fz < 1 || fy < 1) g.scale(fx, fy, fz);
  return g;
}

export function floorLamp(b) {
  const { w, d, h } = b;
  const r = Math.min(w, d) / 2, shadeH = 0.3, shadeR = r - 0.005;
  b.cyl('base', 'k:black', [0, 0.01, 0], r * 0.8, r * 0.82, 0.02, { seg: 20 });
  b.cyl('base', 'k:brass', [0, (h - shadeH) / 2 + 0.01, 0], 0.011, 0.011, h - shadeH - 0.04, { seg: 8 });
  b.add('shade', lathe([[shadeR * 0.86, 0], [shadeR, 0.02], [shadeR * 0.97, shadeH * 0.55], [shadeR * 0.92, shadeH]].map(([rr, y]) => [rr, y - shadeH / 2]), [12, 20, 32][b.ql]), 'k:shade', M(0, h - shadeH / 2 - 0.005, 0), { uv: 'keep', shadow: false });
  b.cyl('base', 'k:brass', [0, h - shadeH - 0.02, 0], 0.02, 0.02, 0.04, { seg: 10 });
  b.emitter([0, h - shadeH * 0.55, 0]);
}

export function tableLamp(b) {
  const { w, d, h } = b;
  const r = Math.min(w, d) / 2, shadeH = Math.min(0.2, h * 0.45), top = h - shadeH;
  const s = (top - 0.03) / 0.27;
  b.add('base', lathe([[0.001, 0], [0.06, 0], [0.085, 0.04], [0.098, 0.1], [0.082, 0.17], [0.04, 0.225], [0.016, 0.25], [0.012, 0.27]].map(([rr, y]) => [rr * Math.min(1, (r - 0.02) / 0.1), y * s]), [14, 20, 32][b.ql]), 'k:ceramic', M(0, 0, 0), { uv: 'keep' });
  b.add('shade', lathe([[r * 0.7, 0], [r * 0.86, shadeH * 0.5], [r - 0.003, shadeH]].map(([rr, y]) => [rr, y - shadeH / 2]), [12, 20, 32][b.ql]), 'k:shade', M(0, top + shadeH / 2, 0), { uv: 'keep', shadow: false });
  b.emitter([0, top + shadeH * 0.35, 0]);
}

export function pendant(b) {
  const { w, d, h } = b;
  const r = Math.min(w, d) / 2 - 0.003, domeH = Math.min(0.24, h * 0.55);
  b.add('shade', lathe([[r, 0], [r * 0.98, domeH * 0.12], [r * 0.86, domeH * 0.45], [r * 0.55, domeH * 0.8], [r * 0.2, domeH * 0.96], [r * 0.12, domeH]], [16, 24, 40][b.ql]), 'k:shade', M(0, 0, 0), { uv: 'keep', shadow: false });
  b.cyl('shade', 'k:brass', [0, domeH + 0.01, 0], r * 0.12, r * 0.12, 0.03, { seg: 12 });
  b.cyl('cord', 'k:black', [0, domeH + 0.02 + (h - domeH - 0.02) / 2, 0], 0.004, 0.004, h - domeH - 0.02, { seg: 6 });
  b.emitter([0, domeH * 0.35, 0]);
}

function plant(b, o) {
  const { w, d, h } = b;
  const potH = o.potH(b), potR = o.potR(b), reach = Math.min(w, d) / 2 - 0.004;
  const prof = [[potR * 0.62, 0], [potR * 0.8, potH * 0.1], [potR * 0.95, potH * 0.55], [potR, potH * 0.96], [potR * 0.93, potH]];
  b.add('pot', lathe(prof, [12, 18, 28][b.ql]), 'f:pot', M(0, 0, 0), { uv: 'keep' });
  b.cyl('pot', 'f:soil', [0, potH - 0.012, 0], potR * 0.9, potR * 0.9, 0.012, { seg: [10, 14, 20][b.ql] });
  const count = Math.round(o.count * [0.6, 1, 1.15][b.ql]);
  const base = potH - 0.01;
  // trunk and a few bare stems under the foliage
  if (o.trunk) {
    const trunkH = h * o.trunk;
    b.cyl('leaves', 'f:wood', [0, base + trunkH / 2, 0], 0.016, 0.024, trunkH, { seg: 8 });
  }
  const tiers = o.tiers ?? 1;
  for (let k = 0; k < tiers; k++) {
    const g = leafCluster(Math.max(4, Math.round(count / tiers)), b.rng, o.leaf(b, base, k));
    if (!g) continue;
    g.translate(0, base + (o.start ? o.start * h : 0) + (o.tierRise ?? 0) * h * k, 0);
    fit(g, reach, reach, h);
    b.add('leaves', g, 'f:leaf1', null, { uv: 'keep' });
  }
}

// Three tiers of leaves on the trunk: broad and spreading low, shorter and more upright higher up.
export const plantLarge = (b) => plant(b, {
  potH: () => 0.3, potR: (bb) => Math.min(0.2, bb.w * 0.36), trunk: 0.66, count: 48, start: 0.28, tiers: 3, tierRise: 0.17,
  leaf: (bb, base, k) => ({ len: 0.36 - 0.04 * k, tilt: 1.0 - 0.2 * k, rise: 0.1 * bb.h, radius: 0.05 - 0.008 * k, shrink: 0.85, wide: 1.0 }),
});
export const plantSmall = (b) => plant(b, {
  potH: () => 0.12, potR: (bb) => Math.min(0.085, bb.w * 0.36), trunk: 0, count: 15, start: 0,
  leaf: (bb, base) => ({ len: Math.min(0.3, bb.h - base) * 1.0, tilt: 0.28, rise: 0.0, radius: 0.025, shrink: 0.75, wide: 0.55 }),
});

function picture(b, frameKey) {
  const { w, d, h } = b;
  const f = Math.min(0.05, w * 0.07);
  b.box('frame', frameKey, [0, h - f / 2, 0], [w, f, d], 0.004);
  b.box('frame', frameKey, [0, f / 2, 0], [w, f, d], 0.004);
  b.box('frame', frameKey, [-(w / 2 - f / 2), h / 2, 0], [f, h - 2 * f, d], 0.004);
  b.box('frame', frameKey, [w / 2 - f / 2, h / 2, 0], [f, h - 2 * f, d], 0.004);
  // a pale mount around the picture, then the picture itself on a thin board
  b.box('canvas', 'f:top', [0, h / 2, -d / 2 + 0.006], [w - 2 * f + 0.004, h - 2 * f + 0.004, 0.012], 0.002, { uv: 'keep' });
  const m = Math.min(w, h) * 0.09, pw = w - 2 * f - 2 * m, ph = h - 2 * f - 2 * m;
  const tex = artTexture(b.seed * 31 + Math.round(w * 100), 96, Math.max(32, Math.round(96 * ph / pw)));
  b.add('canvas', new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), M(0, h / 2, -d / 2 + 0.0125), { uv: 'keep' });
}
export const artLarge = (b) => picture(b, 'f:wood');
export const artSmall = (b) => picture(b, 'k:black');

export function mirror(b) {
  const { w, d, h } = b;
  const f = 0.026;
  b.box('frame', 'k:brass', [0, h - f / 2, 0], [w, f, d], 0.004);
  b.box('frame', 'k:brass', [0, f / 2, 0], [w, f, d], 0.004);
  b.box('frame', 'k:brass', [-(w / 2 - f / 2), h / 2, 0], [f, h - 2 * f, d], 0.004);
  b.box('frame', 'k:brass', [w / 2 - f / 2, h / 2, 0], [f, h - 2 * f, d], 0.004);
  b.box('glass', 'k:paper', [0, h / 2, d / 2 - 0.014], [w - 2 * f + 0.004, h - 2 * f + 0.004, 0.006], 0.001); // silvered backing, slightly recessed
  b.add('glass', glossPlane(w - 2 * f, h - 2 * f, { lo: 0.78, hi: 1, streak: 0.14 }), 'k:mirror', M(0, h / 2, d / 2 - 0.0105), { uv: 'keep' });
}

export function curtain(b) {
  const { w, d, h } = b;
  const folds = clamp(Math.round(w / 0.15), 4, 24), amp = Math.min(0.045, (d - 0.04) / 2.4), top = h - 0.045;
  b.add('fabric', pleated(w - 0.05, top, folds, amp, { rows: 6, seed: b.seed + 1, thick: 0.012, uneven: true }), 'f:linen', M(0, 0, -0.012), { uv: 'keep' });
  b.cyl('rod', 'k:brass', [0, h - 0.025, 0.008], 0.011, 0.011, w, { seg: 10, rot: [0, 0, Math.PI / 2] });
  for (const s of [-1, 1]) b.add('rod', new THREE.SphereGeometry(0.02, 10, 8), 'k:brass', M(s * (w / 2 - 0.02), h - 0.025, 0.008), { uv: 'keep' });
  const rings = clamp(Math.round(w / 0.14), 4, 26);
  for (let i = 0; i < rings; i++) b.cyl('rod', 'k:brass', [-w / 2 + 0.06 + ((w - 0.12) * (i + 0.5)) / rings, h - 0.026, 0.008], 0.017, 0.017, 0.012, { seg: 8, rot: [0, 0, Math.PI / 2] });
  void deg;
}

export const builders = { 'floor-lamp': floorLamp, 'table-lamp': tableLamp, pendant, 'plant-large': plantLarge, 'plant-small': plantSmall, 'art-large': artLarge, 'art-small': artSmall, mirror, curtain };
