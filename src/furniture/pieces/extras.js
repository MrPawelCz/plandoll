// Tier 3 extras: king bed, runner rug, bench, bar stool, round coffee table, book stack, sideboard, shoe cabinet, vase, table centrepiece,
// wall coat rack and kitchen island.
import * as THREE from 'three';
import { colorize, lathe, M, deg, clamp } from '../kit.js';
import { baseCabinet } from './kitchen.js';
import { bedDouble } from './sleep.js';
import { rug } from './living.js';

export function bench(b) {
  const { w, d, h } = b;
  const seatH = 0.1, legH = h - seatH;
  b.add('seat', b.cush(w, seatH, d, { r: 0.035, puff: 0.02, dent: 0, top: 4 }), 'f:fabric', M(0, h - seatH / 2 - 0.016, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('frame', 'f:wood', [sx * (w / 2 - 0.06), legH / 2, sz * (d / 2 - 0.05)], 0.045, 0.03, legH);
  b.box('frame', 'f:wood', [0, legH - 0.04, 0], [w - 0.12, 0.04, 0.03], 0.006);
}

export function barStool(b) {
  const { w, d, h } = b;
  const r = Math.min(w, d) / 2;
  b.cyl('seat', 'f:fabric', [0, h - 0.03, 0], r - 0.01, r, 0.06, { seg: 24 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('frame', 'k:black', [sx * r * 0.62, (h - 0.06) / 2, sz * r * 0.62], 0.011, 0.009, h - 0.06, { seg: 8 });
  b.add('frame', new THREE.TorusGeometry(r * 0.62 * 1.4142 * 0.5 + 0.02, 0.008, 6, 20), 'k:black', M(0, 0.28, 0, Math.PI / 2));
}

export function coffeeTableRound(b) {
  const { w, d, h } = b;
  const top = new THREE.CylinderGeometry(0.5, 0.5, 0.04, 40);
  b.add('top', top, 'f:wood', M(0, h - 0.02, 0).multiply(new THREE.Matrix4().makeScale(w, 1, d)), { uv: 'keep' });
  for (let i = 0; i < 3; i++) {
    const a = deg(90 + i * 120);
    b.leg('frame', 'k:black', [Math.cos(a) * w * 0.3, (h - 0.04) / 2, Math.sin(a) * d * 0.3], 0.04, 0.024, h - 0.04);
  }
  b.add('frame', new THREE.CylinderGeometry(0.5, 0.5, 0.02, 32), 'k:black', M(0, 0.12, 0).multiply(new THREE.Matrix4().makeScale(w * 0.56, 1, d * 0.56)), { uv: 'keep' });
}

export function booksStack(b) {
  const { w, d } = b;
  const dims = [[0.2, 0.032, 0.14], [0.18, 0.026, 0.13], [0.16, 0.022, 0.12]];
  const cols = ['#5d7388', '#c7a46a', '#7d4a3a'];
  let y = 0;
  dims.forEach(([bw, bt, bd], i) => {
    const g = new THREE.BoxGeometry(Math.min(bw, w * 0.82), bt, Math.min(bd, d * 0.74));
    colorize(g, cols[i]);
    b.add('books', g, 'k:paper', M((i - 1) * 0.004, y + bt / 2, 0, 0, deg(i === 1 ? 7 : i === 2 ? -5 : 0), 0));
    y += bt;
  });
}

// Low cabinet on tapered legs with a row of doors and a stone-like top.
export function sideboard(b) {
  const { w, d, h } = b;
  const legH = 0.14, topT = 0.03, bodyH = h - legH - topT, fz = d / 2 - 0.024;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('body', 'f:wood', [sx * (w / 2 - 0.07), legH / 2, sz * (d / 2 - 0.06)], 0.05, 0.028, legH);
  b.box('body', 'f:body', [0, legH + bodyH / 2, -0.012], [w - 0.02, bodyH, d - 0.024], 0.01, { seg: 2 });
  const n = clamp(Math.round(w / 0.45), 2, 5), dw = (w - 0.04) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.02 + dw * (i + 0.5);
    b.box('body', 'f:wood', [x, legH + 0.01 + (bodyH - 0.02) / 2, fz - 0.008], [dw - 0.008, bodyH - 0.024, 0.02], 0.005);
    b.box('handles', 'k:brass', [x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), legH + bodyH * 0.55, fz + 0.006], [0.012, 0.12, 0.012], 0.004);
  }
  b.box('top', 'f:top', [0, h - topT / 2, 0], [w, topT, d], 0.01, { seg: 2, top: 2 });
}

// Tall narrow cabinet with three flap fronts for shoes.
export function shoeCabinet(b) {
  const { w, d, h } = b;
  const legH = 0.1, topT = 0.025, bodyH = h - legH - topT, fz = d / 2 - 0.02;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.leg('body', 'f:wood', [sx * (w / 2 - 0.04), legH / 2, sz * (d / 2 - 0.04)], 0.036, 0.022, legH);
  b.box('body', 'f:body', [0, legH + bodyH / 2, -0.01], [w - 0.016, bodyH, d - 0.02], 0.008, { seg: 2 });
  const rows = 3, fh = (bodyH - 0.02) / rows;
  for (let r = 0; r < rows; r++) {
    const y = legH + 0.01 + fh * (r + 0.5);
    b.box('body', 'f:wood', [0, y, fz - 0.008], [w - 0.04, fh - 0.008, 0.018], 0.005);
    b.box('handles', 'k:brass', [0, y + fh * 0.36, fz + 0.005], [Math.min(0.14, w * 0.3), 0.01, 0.012], 0.004);
  }
  b.box('top', 'f:top', [0, h - topT / 2, 0], [w, topT, d], 0.008, { seg: 2, top: 2 });
}

// Ceramic vase with a few stems and blossoms.
export function vase(b) {
  const { w, d, h } = b;
  const R = Math.min(w, d) / 2 / 0.075, bodyH = h * 0.63, sy = bodyH / 0.2;
  const prof = [[0.001, 0], [0.05, 0], [0.068, 0.03], [0.074, 0.09], [0.06, 0.15], [0.035, 0.185], [0.04, 0.2], [0.032, 0.199], [0.026, 0.185]];
  b.add('body', lathe(prof.map(([r, y]) => [r * R, y * sy]), [12, 18, 28][b.ql]), 'k:ceramic', null, { uv: 'keep' });
  const n = [5, 7, 9][b.ql];
  for (let i = 0; i < n; i++) {
    const az = i * 2.399963 + b.rng() * 0.4, tilt = 0.08 + 0.3 * ((i % 4) / 3), L = (h - bodyH - 0.02) * (0.82 + 0.18 * b.rng()) / Math.cos(tilt);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, bodyH * 0.96, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, az, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = new THREE.CylinderGeometry(0.0022, 0.003, L, 5);
    g.translate(0, L / 2, 0);
    b.add('stems', g, 'f:leaf2', m, { uv: 'keep', shadow: false });
    const top = new THREE.Vector3(0, L, 0).applyMatrix4(m);
    b.add('stems', new THREE.SphereGeometry(0.016, 8, 6), 'f:pillow', M(top.x, top.y, top.z), { uv: 'keep', shadow: false });
  }
}

// Shallow bowl with a heap of fruit.
export function centerpiece(b) {
  const { w, d, h } = b;
  const R = Math.min(w, d) / 2 / 0.145, bowlH = 0.09;
  const prof = [[0.001, 0], [0.05, 0], [0.09, 0.03], [0.14, 0.085], [0.145, bowlH], [0.136, bowlH - 0.002], [0.085, 0.04], [0.001, 0.03]];
  b.add('bowl', lathe(prof.map(([r, y]) => [r * R, y]), [14, 24, 36][b.ql]), 'k:ceramic', null, { uv: 'keep' });
  const cols = ['#d9892b', '#b7352d', '#e3c23f', '#8aa64a', '#d9892b', '#b7352d'], r0 = 0.034 * R;
  const spots = [[0.05, 0, 0], [-0.05, 0.01, 0.3], [0.0, 0.05, 2.1], [0.0, -0.05, 4.2], [0.03, 0.03, 1], [-0.03, -0.02, 3]];
  spots.forEach(([x, z], i) => {
    const g = new THREE.SphereGeometry(r0, [8, 10, 14][b.ql], [6, 8, 10][b.ql]);
    colorize(g, cols[i % cols.length]);
    b.add('fruit', g, 'k:paper', M(x * R, 0.045 + r0 * (i > 3 ? 1.5 : 0.9), z * R), { uv: 'keep' });
  });
  void h;
}

// Wall-mounted panel with brass hooks and a narrow ledge on top; the back is at -z.
export function coatRack(b) {
  const { w, d, h } = b;
  b.box('board', 'f:wood', [0, h / 2 - 0.01, -d / 2 + 0.01], [w, h - 0.02, 0.02], 0.005);
  b.box('board', 'f:wood', [0, h - 0.01, -d / 2 + 0.05], [w, 0.02, d - 0.004], 0.005);
  const n = clamp(Math.round(w / 0.14), 3, 9), hy = h * 0.42;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.05 + ((w - 0.1) * (i + 0.5)) / n;
    b.cyl('hooks', 'k:brass', [x, hy, -d / 2 + 0.05], 0.006, 0.006, 0.06, { seg: 8, rot: [Math.PI / 2, 0, 0] });
    b.add('hooks', new THREE.SphereGeometry(0.011, 8, 6), 'k:brass', M(x, hy, -d / 2 + 0.082), { uv: 'keep' });
  }
}

// Island: the base cabinet with a thicker top and a plain back.
export function kitchenIsland(b) {
  const { w, d, h } = b;
  const n = clamp(Math.round(w / 0.5), 2, 5);
  baseCabinet(b, {
    handleSlot: 'fronts',
    worktop: (topY) => b.box('worktop', 'f:top', [0, topY - 0.02, 0], [w, 0.04, d], 0.01, { seg: 2, top: 2 }),
    fronts: (y0, y1) => {
      const out = [{ x: 0, w, y0: y1 - 0.17, y1, drawer: true }], dw = w / n;
      for (let i = 0; i < n; i++) out.push({ x: -w / 2 + dw * (i + 0.5), w: dw, y0, y1: y1 - 0.17, hx: (i % 2 ? -1 : 1) * (dw / 2 - 0.04) });
      return out;
    },
  });
  void h;
}

export const bedKing = bedDouble;
export const rugRunner = rug;

export const builders = {
  'bed-king': bedKing, 'rug-runner': rugRunner, bench, 'bar-stool': barStool, 'coffee-table-round': coffeeTableRound, 'books-stack': booksStack,
  sideboard, 'shoe-cabinet': shoeCabinet, vase, centerpiece, 'coat-rack': coatRack, 'kitchen-island': kitchenIsland,
};
