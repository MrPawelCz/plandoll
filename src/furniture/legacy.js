// Furniture from simple solids. Local frame: x = width, z = depth (plan y), y up; the front faces +z, the back -z.
// Beds are the exception: the long side runs along x and the head is at -x.
import * as THREE from 'three';
import { mat, texScale } from '../render/materials.js';
import { boxGeometry, setBoxUV } from '../render/uv.js';
import { softBoxGeometry, leafGeometry } from '../render/soft.js';
import { hasOwn } from '../core/caps.js';

const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
const SPH = new THREE.SphereGeometry(0.5, 14, 10);
// Cabinet wood: the grain runs up the fronts (the uv are turned a quarter), as on a wardrobe door.
const GRAIN_UP = new Set(['f:body', 'f:soft']);
// Mesh limits: one piece builds at most PIECE_MESHES meshes (a bookshelf adds one per book) and one scene at most
// SCENE_MESHES, so a plan with hundreds of pieces cannot freeze the page. A piece that hit a limit has userData.truncated.
export const PIECE_MESHES = 300;
export const SCENE_MESHES = 8000;
const BOOKS = ['f:book0', 'f:book1', 'f:book2', 'f:book3', 'f:book4', 'f:book5'];

function rnd(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const BUILDERS = {
  sofa({ bx, sb, soft, W, D, H, hw, hd }) {
    const arm = Math.min(0.2, W * 0.14), back = Math.min(0.26, D * 0.3), baseH = Math.min(0.42, H * 0.55), armH = Math.min(H * 0.8, baseH + 0.24);
    for (const x of [-hw + 0.08, hw - 0.08]) for (const z of [-hd + 0.08, hd - 0.08]) bx(x - 0.03, x + 0.03, 0, 0.1, z - 0.03, z + 0.03, 'f:dark');
    sb(-hw, hw, 0.1, baseH, -hd, hd, 'f:fabric', 0.04, 0.008);
    sb(-hw, -hw + arm, 0.1, armH, -hd, hd, 'f:fabric', 0.06, 0.012);
    sb(hw - arm, hw, 0.1, armH, -hd, hd, 'f:fabric', 0.06, 0.012);
    sb(-hw + arm, hw - arm, 0.1, H, -hd, -hd + back, 'f:fabric', 0.07, 0.02);
    const n = Math.max(1, Math.round((W - 2 * arm) / 0.7)), cw = (W - 2 * arm) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -hw + arm + i * cw + 0.01, x1 = -hw + arm + (i + 1) * cw - 0.01;
      sb(x0, x1, baseH, baseH + 0.12, -hd + back, hd - 0.02, 'f:cushion', 0.045, 0.03);
      sb(x0, x1, baseH + 0.12, H - 0.06, -hd + back, -hd + back + 0.13, 'f:cushion', 0.045, 0.025);
    }
    // two scatter cushions leaning on the back, textured look only
    if (W > 1.5 && D > 0.7) {
      for (const sgn of [-1, 1]) {
        const cxp = sgn * (hw - arm - 0.27), zc = -hd + back + 0.22;
        soft(cxp - 0.19, cxp + 0.19, baseH + 0.15, baseH + 0.51, zc - 0.06, zc + 0.06, 'f:blanket', 0.05, 0.04, [-0.3, sgn * 0.22, 0]);
      }
    }
  },
  bed({ bx, sb, W, D, H, hw, hd }) {
    const frameH = Math.min(0.28, H * 0.6);
    bx(-hw, hw, 0.08, frameH, -hd, hd, 'f:wood');
    bx(-hw, -hw + 0.08, 0.08, H + 0.55, -hd, hd, 'f:wood');
    sb(-hw + 0.08, hw - 0.03, frameH, H, -hd + 0.04, hd - 0.04, 'f:bedding', 0.05, 0.03);
    const n = D > 1.2 ? 2 : 1, slot = (D - 0.08) / n, pw = Math.min(0.62, slot - 0.08);
    for (let i = 0; i < n; i++) {
      const zc = -hd + 0.04 + slot * (i + 0.5);
      sb(-hw + 0.14, -hw + 0.5, H, H + 0.12, zc - pw / 2, zc + pw / 2, 'f:pillow', 0.05, 0.045);
    }
    sb(-hw + 0.7, hw - 0.01, H, H + 0.045, -hd + 0.02, hd - 0.02, 'f:blanket', 0.02, 0.012);
  },
  table({ bx, cy, soft, leaf, W, D, H, hw, hd }) {
    bx(-hw, hw, H - 0.04, H, -hd, hd, 'f:wood');
    const i = Math.min(0.07, hw * 0.3, hd * 0.3);
    for (const x of [-hw + i, hw - i]) for (const z of [-hd + i, hd - i]) bx(x - 0.03, x + 0.03, 0, H - 0.04, z - 0.03, z + 0.03, 'f:dark');
    if (H < 0.5) bx(-hw + 0.06, hw - 0.06, 0.1, 0.13, -hd + 0.06, hd - 0.06, 'f:body');
    // textured look: two books and a small vase on a coffee table, a linen runner and a vase with leaves on a dining table
    if (H < 0.5) {
      soft(-hw * 0.55, -hw * 0.55 + 0.24, H, H + 0.032, -0.09, 0.09, 'f:book1', 0.004, 0.002, [0, 0.12, 0]);
      soft(-hw * 0.55 + 0.02, -hw * 0.55 + 0.22, H + 0.032, H + 0.058, -0.07, 0.07, 'f:book4', 0.004, 0.002, [0, -0.25, 0]);
      cy(hw * 0.4, 0.02, 0.05, H, H + 0.17, 'f:white', 0.05, 'textured');
      for (let k = 0; k < 3; k++) leaf(k * 2.1, 0.5 + 0.1 * k, 0.16, hw * 0.4, H + 0.15, 0.02, 'f:leaf2');
    } else if (W > 1.2) {
      soft(-hw * 0.7, hw * 0.7, H, H + 0.006, -0.11, 0.11, 'f:linen', 0.002, 0);
      cy(0, 0, 0.06, H, H + 0.22, 'f:white', 0.06, 'textured');
      for (let k = 0; k < 4; k++) leaf(k * 1.7, 0.35 + 0.12 * k, 0.2, 0, H + 0.2, 0, 'f:leaf1');
    }
  },
  chair({ bx, W, D, H, hw, hd }) {
    const sh = Math.min(0.46, H * 0.5);
    bx(-hw, hw, sh - 0.04, sh, -hd, hd, 'f:body');
    for (const x of [-hw + 0.04, hw - 0.04]) for (const z of [-hd + 0.04, hd - 0.04]) bx(x - 0.02, x + 0.02, 0, sh - 0.04, z - 0.02, z + 0.02, 'f:dark');
    bx(-hw + 0.02, hw - 0.02, sh, H, -hd, -hd + 0.04, 'f:body');
  },
  desk({ bx, W, D, H, hw, hd }) {
    bx(-hw, hw, H - 0.04, H, -hd, hd, 'f:wood');
    bx(-hw + 0.02, -hw + 0.06, 0, H - 0.04, -hd + 0.03, hd - 0.03, 'f:body');
    bx(hw - 0.46, hw - 0.02, 0.04, H - 0.04, -hd + 0.03, hd - 0.03, 'f:body');
    bx(-hw + 0.06, hw - 0.46, 0.3, H - 0.04, -hd + 0.03, -hd + 0.05, 'f:body');
    for (let k = 1; k <= 3; k++) {
      const y = 0.04 + ((H - 0.08) * k) / 4;
      bx(hw - 0.44, hw - 0.04, y - 0.004, y + 0.004, hd - 0.031, hd - 0.026, 'f:dark');
    }
  },
  wardrobe({ bx, W, D, H, hw, hd }) {
    bx(-hw, hw, 0.06, H, -hd, hd, 'f:body');
    bx(-hw + 0.02, hw - 0.02, 0, 0.06, -hd + 0.02, hd - 0.02, 'f:dark');
    const n = Math.max(2, Math.round(W / 0.5)), pw = W / n;
    for (let i = 0; i < n; i++) bx(-hw + i * pw + 0.012, -hw + (i + 1) * pw - 0.012, 0.1, H - 0.04, hd, hd + 0.012, 'f:soft');
    for (let i = 1; i < n; i += 2) {
      const x = -hw + i * pw;
      bx(x - 0.03, x - 0.016, 0.85, 1.2, hd + 0.012, hd + 0.03, 'f:dark');
      bx(x + 0.016, x + 0.03, 0.85, 1.2, hd + 0.012, hd + 0.03, 'f:dark');
    }
  },
  counter({ bx, W, D, H, hw, hd }) {
    bx(-hw + 0.03, hw - 0.03, 0, 0.1, -hd + 0.03, hd - 0.05, 'f:dark');
    bx(-hw, hw, 0.1, H - 0.04, -hd, hd, 'f:body');
    bx(-hw - 0.005, hw + 0.005, H - 0.04, H, -hd, hd + 0.02, 'f:top');
    const n = Math.max(1, Math.round(W / 0.6)), pw = W / n;
    for (let i = 0; i < n; i++) {
      const x = -hw + (i + 0.5) * pw;
      if (i > 0) bx(-hw + i * pw - 0.004, -hw + i * pw + 0.004, 0.14, H - 0.06, hd, hd + 0.004, 'f:dark');
      bx(x - 0.07, x + 0.07, H - 0.14, H - 0.126, hd, hd + 0.025, 'f:dark');
    }
  },
  fridge({ bx, W, D, H, hw, hd }) {
    bx(-hw, hw, 0.02, H, -hd, hd, 'f:fridge');
    const s = H * 0.62;
    bx(-hw, hw, s - 0.005, s + 0.005, hd, hd + 0.004, 'f:dark');
    bx(hw - 0.08, hw - 0.062, s + 0.08, s + 0.5, hd, hd + 0.03, 'f:steel');
    bx(hw - 0.08, hw - 0.062, s - 0.5, s - 0.08, hd, hd + 0.03, 'f:steel');
  },
  stove({ bx, cy, W, D, H, hw, hd }) {
    bx(-hw, hw, 0, H - 0.02, -hd, hd, 'f:white');
    bx(-hw, hw, H - 0.02, H, -hd, hd, 'f:screen');
    const r = Math.min(hw, hd) * 0.42;
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) cy(sx * hw, sz * hd, r, H, H + 0.012, 'f:dark');
    bx(-hw + 0.04, hw - 0.04, 0.08, H * 0.62, hd, hd + 0.012, 'f:screen');
    bx(-hw + 0.06, hw - 0.06, H * 0.62 - 0.07, H * 0.62 - 0.05, hd + 0.012, hd + 0.04, 'f:steel');
  },
  sink(a) {
    const { bx, cy, W, D, H, hw, hd } = a;
    BUILDERS.counter(a);
    bx(-hw + 0.1, hw - 0.1, H, H + 0.006, -hd + 0.1, hd - 0.1, 'f:steel');
    bx(-hw + 0.14, hw - 0.14, H + 0.006, H + 0.009, -hd + 0.14, hd - 0.14, 'f:dark');
    cy(0, -hd + 0.06, 0.016, H, H + 0.2, 'f:steel');
    bx(-0.012, 0.012, H + 0.18, H + 0.2, -hd + 0.05, -hd + 0.2, 'f:steel');
  },
  bathtub({ bx, cy, W, D, H, hw, hd }) {
    const t = 0.07;
    bx(-hw, hw, 0, 0.12, -hd, hd, 'f:white');
    bx(-hw, hw, 0, H, -hd, -hd + t, 'f:white');
    bx(-hw, hw, 0, H, hd - t, hd, 'f:white');
    bx(-hw, -hw + t, 0, H, -hd, hd, 'f:white');
    bx(hw - t, hw, 0, H, -hd, hd, 'f:white');
    bx(-hw + t, hw - t, 0.12, 0.14, -hd + t, hd - t, 'f:bathfloor');
    cy(-hw + 0.06, 0, 0.018, H, H + 0.18, 'f:steel');
    bx(-hw + 0.04, -hw + 0.2, H + 0.16, H + 0.18, -0.012, 0.012, 'f:steel');
  },
  shower({ bx, cy, W, D, H, hw, hd }) {
    bx(-hw, hw, 0, 0.07, -hd, hd, 'f:white');
    bx(-hw, hw, 0.07, H, hd - 0.012, hd, 'f:glass');
    bx(hw - 0.012, hw, 0.07, H, -hd, hd, 'f:glass');
    bx(-hw, hw, H - 0.025, H, hd - 0.025, hd, 'f:steel');
    bx(hw - 0.025, hw, H - 0.025, H, -hd, hd, 'f:steel');
    bx(hw - 0.025, hw, 0.07, H, hd - 0.025, hd, 'f:steel');
    cy(-hw + 0.14, -hd + 0.06, 0.012, 0.07, H - 0.12, 'f:steel');
    cy(-hw + 0.14, -hd + 0.14, 0.11, H - 0.12, H - 0.105, 'f:steel');
    bx(-hw + 0.13, -hw + 0.15, H - 0.13, H - 0.11, -hd + 0.05, -hd + 0.14, 'f:steel');
  },
  toilet({ bx, cy, W, D, H, hw, hd }) {
    const tank = Math.max(H * 1.9, H + 0.35), tz = D * 0.26;
    bx(-hw * 0.85, hw * 0.85, 0, tank, -hd, -hd + tz, 'f:white');
    bx(-hw * 0.55, hw * 0.55, 0, H * 0.85, -hd + tz, hd - D * 0.25, 'f:white');
    const bowlD = D * 0.74, zc = hd - bowlD / 2;
    cy(0, zc, hw * 1.9, H - 0.05, H, 'f:white', bowlD / 2);
    cy(0, zc, hw * 1.65, H, H + 0.015, 'f:bathfloor', (bowlD / 2) * 0.88);
    bx(-0.03, 0.03, tank, tank + 0.012, -hd + 0.03, -hd + tz - 0.03, 'f:steel');
  },
  basin({ bx, cy, W, D, H, hw, hd }) {
    cy(0, -hd * 0.35, 0.07, 0, H - 0.17, 'f:white');
    bx(-hw, hw, H - 0.17, H, -hd, hd, 'f:white');
    bx(-hw + 0.06, hw - 0.06, H, H + 0.004, -hd + 0.09, hd - 0.05, 'f:bathfloor');
    cy(0, -hd + 0.05, 0.012, H, H + 0.13, 'f:steel');
    bx(-0.01, 0.01, H + 0.12, H + 0.13, -hd + 0.04, -hd + 0.14, 'f:steel');
  },
  tvunit({ bx, W, D, H, hw, hd }) {
    bx(-hw + 0.03, hw - 0.03, 0, 0.08, -hd + 0.03, hd - 0.03, 'f:dark');
    bx(-hw, hw, 0.08, H, -hd, hd, 'f:wood');
    bx(-0.004, 0.004, 0.12, H - 0.04, hd, hd + 0.004, 'f:dark');
    const tw = Math.min(W * 0.75, 1.3), th = tw * 0.5625;
    bx(-0.14, 0.14, H, H + 0.03, -0.07, 0.07, 'f:dark');
    bx(-tw / 2, tw / 2, H + 0.05, H + 0.05 + th, -0.02, 0.02, 'f:screen');
  },
  bookshelf({ bx, W, D, H, hw, hd }) {
    bx(-hw, -hw + 0.03, 0, H, -hd, hd, 'f:wood');
    bx(hw - 0.03, hw, 0, H, -hd, hd, 'f:wood');
    bx(-hw + 0.03, hw - 0.03, 0, H, -hd, -hd + 0.015, 'f:body');
    const n = Math.max(2, Math.round(H / 0.38));
    for (let i = 0; i <= n; i++) {
      const y = (i * (H - 0.03)) / n;
      bx(-hw + 0.03, hw - 0.03, y, y + 0.03, -hd, hd, 'f:wood');
      if (i === n || i % 2 === 1) continue;
      const room = (H - 0.03) / n - 0.05;
      let x = -hw + 0.06, k = i * 31;
      while (x < hw - 0.12) {
        const bw = 0.03 + rnd(k++) * 0.035, bh = Math.min(room, 0.18 + rnd(k++) * 0.12);
        bx(x, x + bw, y + 0.03, y + 0.03 + bh, -hd + 0.03, hd - 0.04, BOOKS[Math.floor(rnd(k++) * BOOKS.length)]);
        x += bw + 0.004;
        if (rnd(k++) > 0.9) x += 0.12;
      }
    }
  },
  plant({ bx, cy, sp, leaf, W, D, H, hw, hd }) {
    const r = Math.min(hw, hd);
    cy(0, 0, r * 0.62, 0, 0.26, 'f:pot');
    cy(0, 0, r * 0.56, 0.26, 0.275, 'f:soil');
    const top = Math.max(H, 0.5);
    sp(0, 0.26 + (top - 0.26) * 0.42, 0, r * 0.95, 'f:leaf2', 'clay');
    sp(r * 0.28, 0.26 + (top - 0.26) * 0.7, r * 0.1, r * 0.72, 'f:leaf1', 'clay');
    sp(-r * 0.2, top - r * 0.5, -r * 0.12, r * 0.6, 'f:leaf3', 'clay');
    // textured look: a stem and a spiral of leaf blades, the lower ones wide and drooping, the upper ones upright
    cy(0, 0, 0.011, 0.275, top * 0.82, 'f:soil', 0.011, 'textured');
    const n = 17, tones = ['f:leaf1', 'f:leaf2', 'f:leaf3', 'f:leaf2'];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), az = k * 2.39996;
      const y = 0.3 + (top * 0.82 - 0.3) * u, len = (r * 1.55 + 0.1 * top) * (1 - 0.35 * u), tilt = 1.15 - 0.85 * u;
      leaf(az, tilt, len, Math.sin(az) * 0.012, y, Math.cos(az) * 0.012, tones[k % 4]);
    }
  },
  rug({ bx, soft, W, D, H, hw, hd }) {
    bx(-hw, hw, 0.002, 0.012, -hd, hd, 'f:rug', 'clay');
    bx(-hw + 0.08, hw - 0.08, 0.012, 0.015, -hd + 0.08, hd - 0.08, 'f:rug2', 'clay');
    soft(-hw, hw, 0.002, 0.016, -hd, hd, 'f:rug', 0.006, 0);
    soft(-hw + 0.08, hw - 0.08, 0.016, 0.0215, -hd + 0.08, hd - 0.08, 'f:rug2', 0.0027, 0.003);
  },
  box({ bx, hw, hd, H }) {
    bx(-hw, hw, 0, H, -hd, hd, 'f:body');
  },
};

const ALIAS = {
  armchair: 'sofa', 'bed-double': 'bed', 'bed-single': 'bed', 'table-dining': 'table', 'table-coffee': 'table',
  'kitchen-counter': 'counter', 'tv-unit': 'tvunit',
};

export function buildFurniture(f, budget) {
  const g = new THREE.Group();
  const flat = f.type === 'rug';
  const room = Math.min(PIECE_MESHES, budget ? budget.left : Infinity);
  let used = 0, skipped = false;
  const full = () => { if (used < room) return false; skipped = true; return true; };
  const add = (m) => { used++; m.castShadow = !flat; m.receiveShadow = true; g.add(m); return m; };
  // The uv of a box are metres in the furniture's own frame, so a grain or a weave runs on across the parts of one piece.
  const bx = (x0, x1, y0, y1, z0, z1, m, look) => {
    if (full()) return null;
    const mesh = new THREE.Mesh(boxGeometry(), mat(m));
    mesh.pw = { mat: m, box: true };
    if (look) mesh.pw.look = look;
    const sx = Math.max(1e-4, x1 - x0), sy = Math.max(1e-4, y1 - y0), sz = Math.max(1e-4, z1 - z0);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.scale.set(sx, sy, sz);
    setBoxUV(mesh.geometry, mesh.position.x, mesh.position.y, mesh.position.z, sx, sy, sz, texScale(m), GRAIN_UP.has(m));
    return add(mesh);
  };
  const cy = (cx, cz, r, y0, y1, m, rz = r, look) => {
    if (full()) return null;
    const mesh = new THREE.Mesh(CYL, mat(m));
    mesh.pw = { mat: m };
    if (look) mesh.pw.look = look;
    mesh.position.set(cx, (y0 + y1) / 2, cz);
    mesh.scale.set(r * 2, Math.max(1e-4, y1 - y0), rz * 2);
    return add(mesh);
  };
  const sp = (cx, cyy, cz, r, m, look) => {
    if (full()) return null;
    const mesh = new THREE.Mesh(SPH, mat(m));
    mesh.pw = { mat: m };
    if (look) mesh.pw.look = look;
    mesh.position.set(cx, cyy, cz);
    mesh.scale.setScalar(r * 2);
    return add(mesh);
  };
  // Soft solids (rounded, puffed) exist only in the textured look; sb also keeps the plain box for the clay look.
  const soft = (x0, x1, y0, y1, z0, z1, m, r, puff = 0, rot = null) => {
    if (full()) return null;
    const sx = Math.max(1e-4, x1 - x0), sy = Math.max(1e-4, y1 - y0), sz = Math.max(1e-4, z1 - z0);
    const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2, czm = (z0 + z1) / 2;
    const mesh = new THREE.Mesh(softBoxGeometry(sx, sy, sz, r, puff, cxm, cym, czm, texScale(m)), mat(m));
    mesh.pw = { mat: m, look: 'textured' };
    mesh.position.set(cxm, cym, czm);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    return add(mesh);
  };
  const sb = (x0, x1, y0, y1, z0, z1, m, r, puff) => {
    bx(x0, x1, y0, y1, z0, z1, m, 'clay');
    return soft(x0, x1, y0, y1, z0, z1, m, r, puff);
  };
  // A leaf blade of length len: tilt leans it out from the vertical, az turns it round the stem (textured look only).
  const leaf = (az, tilt, len, x, y, z, m) => {
    if (full()) return null;
    const mesh = new THREE.Mesh(leafGeometry(), mat(m));
    mesh.pw = { mat: m, look: 'textured' };
    mesh.position.set(x, y, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(tilt, az, 0);
    mesh.scale.setScalar(len);
    return add(mesh);
  };
  const key = hasOwn(ALIAS, f.type) ? ALIAS[f.type] : f.type;
  const fn = hasOwn(BUILDERS, key) ? BUILDERS[key] : BUILDERS.box;
  fn({ bx, cy, sp, sb, soft, leaf, W: f.w, D: f.d, H: f.h, hw: f.w / 2, hd: f.d / 2 });
  if (budget) budget.left -= used;
  if (skipped) g.userData.truncated = true;
  g.name = `furniture:${f.id}`;
  g.userData.type = f.type;
  return g;
}
