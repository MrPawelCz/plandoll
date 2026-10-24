// Tier 3 extras that reuse the shapes above or need only a few parts: king bed, runner rug, bench, bar stool, round coffee table, book stack.
import * as THREE from 'three';
import { colorize, M, deg } from '../kit.js';
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

export const bedKing = bedDouble;
export const rugRunner = rug;

export const builders = { 'bed-king': bedKing, 'rug-runner': rugRunner, bench, 'bar-stool': barStool, 'coffee-table-round': coffeeTableRound, 'books-stack': booksStack };
