// Tier 2 bathroom fixtures: toilet, washbasin with vanity, shower, bathtub.
// Local frame as everywhere: front +z, back (the wall side) -z, centre of the footprint, y up; fittings stay inside the spec size.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { lathe, tubePath, roundedRectShape, M, clamp } from '../kit.js';

const scaleXZ = (sx, sz) => new THREE.Matrix4().makeScale(sx, 1, sz);

// A rounded-rectangle slab (optionally with a rectangular opening), standing on y = 0 and `height` tall, with a softened top edge.
function slab(w, d, r, height, { hole = null, bevel = 0.01, steps = 5 } = {}) {
  const shape = roundedRectShape(w, d, r);
  if (hole) shape.holes.push(roundedRectShape(hole.w, hole.d, hole.r));
  const bt = bevel > 0 ? bevel : 0;
  const g = new THREE.ExtrudeGeometry(shape, { depth: height - 2 * bt, steps: 1, bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: bt > 0 ? 2 : 0, curveSegments: steps });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bt, 0);
  const out = mergeVertices(g);
  g.dispose();
  return out;
}

// ---- toilet: floor pedestal bowl with a closed lid, close-coupled cistern with a dual button ----
export function toilet(b) {
  const { w, d, h } = b;
  const seg = [16, 26, 36][b.ql], rimY = 0.4, tankD = 0.2, zc = 0.105, half = d / 2 - zc; // bowl: centre z, half length
  const R = (w / 2) * 0.97, zs = half / R;
  const prof = [[0.46, 0], [0.58, 0.05], [0.78, 0.15], [0.93, 0.28], [1, 0.36], [1, rimY], [0.86, rimY + 0.004], [0.8, rimY - 0.01], [0.74, 0.33], [0.6, 0.26], [0.38, 0.2], [0.001, 0.18]];
  b.add('ceramic', lathe(prof.map(([r, y]) => [r * R, y]), seg), 'k:ceramic', M(0, 0, zc).multiply(scaleXZ(1, zs)), { uv: 'keep' });
  b.leg('ceramic', 'k:ceramic', [0, rimY / 2, -d / 2 + tankD / 2 + 0.03], w * 0.86, w * 0.6, rimY, { dt: tankD + 0.03, db: tankD * 0.8 });
  b.box('ceramic', 'k:ceramic', [0, rimY + (h - 0.02 - rimY) / 2, -d / 2 + tankD / 2], [w - 0.02, h - 0.02 - rimY, tankD], 0.03, { seg: 2 });
  b.box('ceramic', 'k:ceramic', [0, h - 0.01, -d / 2 + tankD / 2 + 0.002], [w - 0.004, 0.02, tankD + 0.012], 0.008, { seg: 2 });
  for (const sx of [-1, 1]) b.cyl('ceramic', 'k:chrome', [sx * 0.04, h + 0.002, -d / 2 + tankD / 2 + 0.01], 0.021, 0.021, 0.008, { seg: 14 });
  // lid and seat ring
  const lid = [[0.001, rimY + 0.034], [0.84, rimY + 0.034], [0.95, rimY + 0.03], [1.0, rimY + 0.02], [1.0, rimY + 0.008], [0.96, rimY + 0.002]];
  b.add('seat', lathe(lid.map(([r, y]) => [r * R, y]), seg), 'f:white', M(0, 0, zc).multiply(scaleXZ(1, zs)), { uv: 'keep' });
  b.box('seat', 'f:white', [0, rimY + 0.012, -d / 2 + tankD + 0.015], [R * 1.5, 0.026, 0.03], 0.008);
}

// ---- washbasin: vanity with two drawers (or four when wide), stone top, vessel basin(s) and a lever mixer ----
export function washbasin(b) {
  const { w, d, h } = b;
  const tapUp = 0.14, topY = h - tapUp, slabT = 0.03, plinth = 0.08, bodyTop = topY - slabT;
  b.box('vanity', 'f:dark', [0, plinth / 2, -0.02], [w - 0.04, plinth, d - 0.08], 0.004);
  b.box('vanity', 'f:body', [0, plinth + (bodyTop - plinth) / 2, -0.012], [w - 0.004, bodyTop - plinth, d - 0.024], 0.006, { seg: 1 });
  b.box('vanity', 'f:top', [0, topY - slabT / 2, 0], [w, slabT, d], 0.008, { seg: 2, top: 2 });
  const cols = w > 0.9 ? 2 : 1, fh = (bodyTop - plinth - 0.012) / 2, fw = w / cols;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      b.box('vanity', 'f:wood', [-w / 2 + fw * (c + 0.5), plinth + 0.006 + fh * (r + 0.5) + r * 0.0, d / 2 - 0.021], [fw - 0.008, fh - 0.006, 0.02], 0.004);
    }
  }
  const n = w > 0.95 ? 2 : 1, bw = clamp(n === 2 ? w / 2 - 0.1 : w * 0.76, 0.3, 0.48), bz = 0.04, bh = 0.1, seg = [18, 28, 40][b.ql];
  const R = bw / 2, zs = (d * 0.66) / bw;
  const prof = [[0.55, 0], [0.8, 0.012], [0.97, 0.05], [1, bh - 0.004], [0.96, bh], [0.88, bh - 0.002], [0.84, bh - 0.02], [0.66, 0.045], [0.3, 0.032], [0.001, 0.03]];
  for (let i = 0; i < n; i++) {
    const x = n === 2 ? (i ? 1 : -1) * w / 4 : 0;
    b.add('basin', lathe(prof.map(([r, y]) => [r * R, y]), seg), 'k:ceramic', M(x, topY, bz).multiply(scaleXZ(1, zs)), { uv: 'keep' });
    b.cyl('basin', 'k:chrome', [x, topY + 0.032, bz], 0.022, 0.022, 0.004, { seg: 12 });
    const tz = -d / 2 + 0.065;
    b.cyl('tap', 'k:chrome', [x, topY + 0.058, tz], 0.014, 0.017, 0.116, { seg: 12 });
    b.add('tap', tubePath([[0, 0.11, 0], [0, 0.133, 0.025], [0, 0.133, 0.07], [0, 0.118, 0.115], [0, 0.098, 0.128]], 0.0085, { seg: 12, radial: 7 }), 'k:chrome', M(x, topY, tz), { uv: 'keep' });
    b.cyl('tap', 'k:chrome', [x + 0.026, topY + 0.098, tz], 0.006, 0.006, 0.05, { seg: 8, rot: [0, 0, Math.PI / 2] });
  }
}

// ---- shower: dished tray, three glass panes (the back is the wall) in a slim frame, handle, wall valve and rain head ----
export function shower(b) {
  const { w, d, h } = b;
  const trayH = 0.06, gT = h - 0.06, g0 = 0.03, gh = gT - trayH, s = Math.min(w, d);
  const dish = (x, z) => -0.014 * Math.exp(-(x * x + z * z) / (2 * (0.26 * s) ** 2));
  b.box('tray', 'f:white', [0, trayH / 2 - 0.0, 0], [w, trayH, d], 0.012, { seg: 2, top: 12, warp: dish });
  b.cyl('tray', 'k:chrome', [0, trayH - 0.013, 0], 0.045, 0.045, 0.004, { seg: 16 });
  b.cyl('tray', 'k:black', [0, trayH - 0.0105, 0], 0.012, 0.012, 0.003, { seg: 8 });
  const xs = w / 2 - g0, zf = d / 2 - g0;
  b.add('glass', new THREE.PlaneGeometry(2 * xs, gh), 'f:glass', M(0, trayH + gh / 2, zf), { uv: 'keep', shadow: false });
  for (const sx of [-1, 1]) b.add('glass', new THREE.PlaneGeometry(2 * zf, gh), 'f:glass', M(sx * xs, trayH + gh / 2, 0, 0, Math.PI / 2, 0), { uv: 'keep', shadow: false });
  const q = 0.02;
  for (const sx of [-1, 1]) {
    b.plain('fittings', 'k:black', [sx * xs, trayH + gh / 2, zf], [q, gh, q]);
    b.plain('fittings', 'k:black', [sx * xs, gT, 0], [q, q, 2 * zf + q]);
    b.plain('fittings', 'k:black', [sx * xs, trayH + 0.01, 0], [q, 0.02, 2 * zf]);
    b.plain('fittings', 'k:black', [sx * xs, trayH + gh / 2, -zf], [q, gh, q]);
  }
  b.plain('fittings', 'k:black', [0, gT, zf], [2 * xs, q, q]);
  b.plain('fittings', 'k:black', [0, trayH + 0.01, zf], [2 * xs, 0.02, q]);
  b.plain('fittings', 'k:black', [w * 0.18, trayH + gh * 0.5, zf + 0.026], [0.016, 0.4, 0.016]); // handle on the front pane
  for (const dy of [-0.14, 0.14]) b.cyl('fittings', 'k:black', [w * 0.18, trayH + gh * 0.5 + dy, zf + 0.013], 0.006, 0.006, 0.026, { seg: 8, rot: [Math.PI / 2, 0, 0] });
  // valve plate with two knobs, riser, arm and rain head on the back wall
  const wz = -d / 2 + 0.012, px = 0;
  b.cyl('fittings', 'k:chrome', [px, 1.08, wz], 0.06, 0.06, 0.016, { seg: 20, rot: [Math.PI / 2, 0, 0] });
  for (const sx of [-1, 1]) b.cyl('fittings', 'k:chrome', [px + sx * 0.03, 1.08, wz + 0.024], 0.016, 0.016, 0.03, { seg: 12, rot: [Math.PI / 2, 0, 0] });
  b.cyl('fittings', 'k:chrome', [px, 1.5, -d / 2 + 0.02], 0.011, 0.011, 0.84, { seg: 10 });
  b.add('fittings', tubePath([[0, 1.9, -d / 2 + 0.02], [0, 1.935, -d / 2 + 0.06], [0, 1.935, -d / 2 + 0.16], [0, 1.925, -d / 2 + 0.24]], 0.011, { seg: 10, radial: 7 }), 'k:chrome', null, { uv: 'keep' });
  b.cyl('fittings', 'k:chrome', [px, 1.925, -d / 2 + 0.3], 0.115, 0.115, 0.014, { seg: [16, 26, 36][b.ql] });
}

// ---- bathtub: rounded-rectangle shell with a rim, deep floor, deck-mounted lever mixer, drain ----
export function bathtub(b) {
  const { w, d, h } = b;
  const rimH = h - 0.08, wall = 0.07, floorY = 0.14, r = Math.min(0.2, d * 0.28), steps = [4, 6, 8][b.ql];
  b.add('shell', slab(w, d, r, rimH, { hole: { w: w - 2 * wall, d: d - 2 * wall, r: Math.max(0.04, r - wall * 0.4) }, bevel: 0.012, steps }), 'k:ceramic', null, { uv: 'keep' });
  b.add('shell', slab(w - 2 * wall + 0.03, d - 2 * wall + 0.03, Math.max(0.04, r - wall * 0.4) + 0.015, floorY, { bevel: 0, steps }), 'k:ceramic', null, { uv: 'keep' });
  const tx = -w / 2 + 0.2, tz = -d / 2 + wall / 2;
  b.cyl('fittings', 'k:chrome', [tx, rimH + 0.022, tz], 0.02, 0.024, 0.044, { seg: 14 });
  b.add('fittings', tubePath([[0, 0.04, 0], [0, 0.068, 0.025], [0, 0.074, 0.075], [0, 0.058, 0.125], [0, 0.034, 0.14]], 0.0105, { seg: 12, radial: 7 }), 'k:chrome', M(tx, rimH, tz), { uv: 'keep' });
  for (const sx of [-1, 1]) b.cyl('fittings', 'k:chrome', [tx + sx * 0.085, rimH + 0.014, tz], 0.014, 0.016, 0.028, { seg: 10 });
  b.cyl('fittings', 'k:chrome', [-w / 2 + wall + 0.1, floorY + 0.002, 0], 0.036, 0.036, 0.004, { seg: 14 });
  b.cyl('fittings', 'k:black', [-w / 2 + wall + 0.1, floorY + 0.0045, 0], 0.012, 0.012, 0.003, { seg: 8 });
  b.cyl('fittings', 'k:chrome', [-w / 2 + wall + 0.012, rimH - 0.1, 0], 0.022, 0.022, 0.008, { seg: 12, rot: [0, 0, Math.PI / 2] }); // overflow
}

export const builders = { toilet, washbasin, shower, bathtub };
