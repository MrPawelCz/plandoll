// Independent 2D geometry for the layout audit: convex polygons, separating axes, point and segment distances, a distance grid.
// Plan space in metres (x right, y down). Written for the audit only; it does not import anything from the engine.
export const DEG = Math.PI / 180;

export const rectPoly = (cx, cy, ux, uy, hw, hd) => {
  const fx = -uy, fy = ux;
  return [[cx - ux * hw - fx * hd, cy - uy * hw - fy * hd], [cx + ux * hw - fx * hd, cy + uy * hw - fy * hd], [cx + ux * hw + fx * hd, cy + uy * hw + fy * hd], [cx - ux * hw + fx * hd, cy - uy * hw + fy * hd]];
};

// A piece with rotation rot (degrees) has its width along (cos, sin) and its depth along (-sin, cos).
export function piecePoly(x, y, w, d, rot) {
  const ux = Math.cos(rot * DEG), uy = Math.sin(rot * DEG), fx = -uy, fy = ux;
  const hw = w / 2, hd = d / 2;
  return [[x - ux * hw - fx * hd, y - uy * hw - fy * hd], [x + ux * hw - fx * hd, y + uy * hw - fy * hd], [x + ux * hw + fx * hd, y + uy * hw + fy * hd], [x - ux * hw + fx * hd, y - uy * hw + fy * hd]];
}

// Overlap depth of two convex polygons (smallest overlap over all edge normals); <= 0 when they are apart or only touch.
export function overlap(A, B) {
  let best = Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      let nx = q[1] - p[1], ny = p[0] - q[0];
      const l = Math.hypot(nx, ny);
      if (l < 1e-12) continue;
      nx /= l; ny /= l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const t = v[0] * nx + v[1] * ny; if (t < a0) a0 = t; if (t > a1) a1 = t; }
      for (const v of B) { const t = v[0] * nx + v[1] * ny; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return o;
      if (o < best) best = o;
    }
  }
  return best;
}

export function pip(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 < 1e-18 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Distance between a convex polygon and a segment (0 when they touch or cross).
export function distPolySeg(poly, a, b) {
  const sep = overlap(poly, [a, b, [b[0] + 1e-9, b[1] + 1e-9]]);
  if (sep > 0) return 0;
  let d = Infinity;
  for (const v of poly) d = Math.min(d, distPointSeg(v, a, b));
  for (const e of [a, b]) {
    if (pip(e, poly)) return 0;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, distPointSeg(e, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
}

export function segCross(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

// Quarter disc as a convex polygon: centre c, start direction a (unit), swing side s (unit, perpendicular to a), radius r.
// The arc is approximated from outside (vertices at r / cos(half step)) so the polygon never under-covers the true disc.
export function quarterDisc(c, a, s, r, n = 24) {
  const step = (Math.PI / 2) / n, R = r / Math.cos(step / 2);
  const pts = [[c[0], c[1]]];
  for (let i = 0; i <= n; i++) {
    const t = i * step;
    const k = i === 0 ? r : i === n ? r : R;
    pts.push([c[0] + k * (a[0] * Math.cos(t) + s[0] * Math.sin(t)), c[1] + k * (a[1] * Math.cos(t) + s[1] * Math.sin(t))]);
  }
  // the two radial end points sit on the circle exactly, the others on the circumscribed polygon: still convex
  return pts;
}

export const polyBBox = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1 };
};
export const centroid = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];

// Grid of cells (centre sampling). mark(poly) sets cells whose centre lies inside a convex polygon.
export class Grid {
  constructor(minX, minY, maxX, maxY, cell = 0.05) {
    this.cell = cell; this.x0 = minX; this.y0 = minY;
    this.nx = Math.ceil((maxX - minX) / cell); this.ny = Math.ceil((maxY - minY) / cell);
    this.n = this.nx * this.ny;
  }
  idx(i, j) { return j * this.nx + i; }
  center(i, j) { return [this.x0 + (i + 0.5) * this.cell, this.y0 + (j + 0.5) * this.cell]; }
  cellOf(x, y) { return [Math.floor((x - this.x0) / this.cell), Math.floor((y - this.y0) / this.cell)]; }
  fillConvex(arr, poly, val = 1) {
    const b = polyBBox(poly), c = this.cell;
    const i0 = Math.max(0, Math.floor((b.x0 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.floor((b.x1 - this.x0) / c));
    const j0 = Math.max(0, Math.floor((b.y0 - this.y0) / c)), j1 = Math.min(this.ny - 1, Math.floor((b.y1 - this.y0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = this.center(i, j);
      if (convexContains(poly, p)) arr[this.idx(i, j)] = val;
    }
  }
  fillAny(arr, poly, val = 1) {
    const b = polyBBox(poly), c = this.cell;
    const i0 = Math.max(0, Math.floor((b.x0 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.floor((b.x1 - this.x0) / c));
    const j0 = Math.max(0, Math.floor((b.y0 - this.y0) / c)), j1 = Math.min(this.ny - 1, Math.floor((b.y1 - this.y0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pip(this.center(i, j), poly)) arr[this.idx(i, j)] = val;
  }
  // Euclidean distance (metres) from every cell to the nearest cell with obs[idx] != 0 (Felzenszwalb squared transform).
  edt(obs) {
    const { nx, ny } = this, INF = 1e12;
    const f = new Float64Array(this.n);
    for (let k = 0; k < this.n; k++) f[k] = obs[k] ? 0 : INF;
    const d = new Float64Array(Math.max(nx, ny)), z = new Float64Array(Math.max(nx, ny) + 1), v = new Int32Array(Math.max(nx, ny));
    const pass = (len, get, set) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        for (;;) {
          const p = v[k];
          s = ((get(q) + q * q) - (get(p) + p * p)) / (2 * q - 2 * p);
          if (s <= z[k] && k > 0) k--; else break;
        }
        if (s <= z[k]) { v[k] = q; z[k + 1] = INF; } else { k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + get(p); }
      for (let q = 0; q < len; q++) set(q, d[q]);
    };
    for (let i = 0; i < nx; i++) pass(ny, (q) => f[q * nx + i], (q, val) => { f[q * nx + i] = val; });
    for (let j = 0; j < ny; j++) pass(nx, (q) => f[j * nx + q], (q, val) => { f[j * nx + q] = val; });
    const out = new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) out[k] = Math.sqrt(f[k]) * this.cell;
    return out;
  }
}

export function convexContains(poly, p) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-12) continue;
    if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false;
  }
  return true;
}
