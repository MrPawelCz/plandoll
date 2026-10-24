// Soft solids for the textured look: rounded boxes with an optional puff (cushions, pillows, bedding, rugs) and leaf blades.
// Plain arithmetic only, no randomness: a plan always produces the same shapes.
import * as THREE from 'three';

const SEG = 3; // slices round each rounded edge

// Slice positions along one axis from -half to +half: SEG slices in each edge band of width r and `flat` slices between.
function axisPositions(half, r, flat) {
  const out = [];
  for (let i = 0; i <= SEG; i++) out.push(-half + (r * i) / SEG);
  for (let j = 1; j < flat; j++) out.push(-half + r + (2 * (half - r) * j) / flat);
  for (let i = 0; i <= SEG; i++) out.push(half - r + (r * i) / SEG);
  return out;
}

// Box w x h x d (metres) centred on its own origin, edges rounded to radius r. puff raises the top like a stuffed cushion
// (0 = flat). uv are metres in the frame of the furniture piece, like uv.js: (cx, cy, cz) is where the box sits in that
// frame and k is repeats per metre, so a weave runs on across the parts of one piece. Only the top face is cut into
// slices of about 5 cm (an even count, so one vertex sits in the middle); the other faces are flat apart from their edges.
export function softBoxGeometry(w, h, d, r, puff, cx, cy, cz, k) {
  const radius = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const half = [w / 2, h / 2, d / 2], inner = half.map((v) => v - radius), centre = [cx, cy, cz];
  const flat = (axis) => Math.min(24, Math.max(2, 2 * Math.ceil((half[axis] - radius) / 0.05 / 2)));
  // [axis of the normal, side, axis along u, axis along v]; u x v points out of the box, so the triangles face outwards
  const faces = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
  const pos = [], nor = [], uv = [], idx = [];
  for (const [na, sign, ua, va] of faces) {
    const top = na === 1 && sign > 0;
    const U = axisPositions(half[ua], radius, top ? flat(ua) : 1), V = axisPositions(half[va], radius, top ? flat(va) : 1);
    const base = pos.length / 3;
    for (let j = 0; j < V.length; j++) {
      for (let i = 0; i < U.length; i++) {
        const P = [0, 0, 0];
        P[na] = sign * half[na]; P[ua] = U[i]; P[va] = V[j];
        // the point of the rounded box nearest to P: the nearest point of the inner box plus radius along the offset
        const q = [0, 0, 0], o = [0, 0, 0];
        for (let a = 0; a < 3; a++) { q[a] = Math.max(-inner[a], Math.min(inner[a], P[a])); o[a] = P[a] - q[a]; }
        const len = Math.hypot(o[0], o[1], o[2]) || 1;
        let nx = o[0] / len, ny = o[1] / len, nz = o[2] / len;
        const x = q[0] + nx * radius, z = q[2] + nz * radius;
        let y = q[1] + ny * radius;
        if (puff) {
          const t = ny > 0 ? ny : 0, fx = 1 - ((2 * x) / w) * ((2 * x) / w), fz = 1 - ((2 * z) / d) * ((2 * z) / d);
          y += puff * fx * fz * t;
          nx -= puff * ((-8 * x) / (w * w)) * fz * t;
          nz -= puff * ((-8 * z) / (d * d)) * fx * t;
          const l2 = Math.hypot(nx, ny, nz) || 1;
          nx /= l2; ny /= l2; nz /= l2;
        }
        pos.push(x, y, z);
        nor.push(nx, ny, nz);
        const X = centre[0] + x, Y = centre[1] + y, Z = centre[2] + z;
        if (na === 0) uv.push(Z * k, Y * k);
        else if (na === 1) uv.push(X * k, Z * k);
        else uv.push(X * k, Y * k);
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
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

let LEAF = null;

// One leaf blade, 1 m long and up to 0.56 m wide: the base at the origin, the tip along +y, arched and cupped a little.
// uv: u runs 0 to 1 from the base to the tip, v 0 to 1 across, so the leaf texture (midrib along u) fits one blade.
export function leafGeometry() {
  if (LEAF) return LEAF;
  const NL = 8, NW = 3;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NL; i++) {
    const t = i / NL;
    const width = 0.56 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.2 * t);
    for (let j = 0; j <= NW * 2; j++) {
      const s = j / NW - 1;
      pos.push((s * width) / 2, t, 0.18 * t * t - 0.3 * s * s * width);
      uv.push(t, (s + 1) / 2);
    }
  }
  const row = NW * 2 + 1;
  for (let i = 0; i < NL; i++) {
    for (let j = 0; j < NW * 2; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The base and the tip are points, so their end vertices own only degenerate triangles and get a zero normal: point them out of the blade.
  const nor = g.getAttribute('normal');
  for (let i = 0; i < nor.count; i++) {
    if (Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)) < 0.5) nor.setXYZ(i, 0, 0, 1);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  LEAF = g;
  return g;
}
