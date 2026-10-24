// Camera framing: where the camera must stand so that a box (the extent of the model) fits a rectangle of the screen with
// a margin. Pure maths on a camera that keeps its viewing direction, so the viewer and the tests share one answer.
import * as THREE from 'three';

const rad = (d) => (d * Math.PI) / 180;

export function boxCorners(e) {
  const out = [];
  for (const x of [e.minX, e.maxX]) for (const y of [e.minY, e.maxY]) for (const z of [e.minZ, e.maxZ]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

// The rectangle (CSS px, origin top left) of a canvas w x h that is free of bars and cards, shrunk by margin (a fraction of
// its own width and height) on every side, as normalised device coordinates (x right, y up).
export function ndcRect(free, w, h, margin) {
  const fw = free.right - free.left, fh = free.bottom - free.top;
  const l = free.left + margin * fw, r = free.right - margin * fw, t = free.top + margin * fh, b = free.bottom - margin * fh;
  return { x0: (l - w / 2) / (w / 2), x1: (r - w / 2) / (w / 2), y0: (h / 2 - b) / (h / 2), y1: (h / 2 - t) / (h / 2) };
}

// dir: unit vector from the target to the camera. Returns { target, position, distance }: the nearest camera, looking along
// -dir, from which every corner lands inside rect (ndc). The model is centred in the rectangle by moving the target sideways.
export function fitView(corners, dir, fovDeg, aspect, rect) {
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const c = corners.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / corners.length);
  const local = corners.map((p) => { const v = p.clone().sub(c); return { a: v.dot(right), b: v.dot(up), f: v.dot(fwd) }; });
  const ty = Math.tan(rad(fovDeg) / 2), tx = ty * aspect;
  // sx is feasible when every corner has x0 <= (a - sx) / (tx * z) <= x1 with z = f + D; the same for sy. Both are intervals.
  const span = (D) => {
    let lx = -Infinity, ux = Infinity, ly = -Infinity, uy = Infinity;
    for (const p of local) {
      const z = p.f + D;
      lx = Math.max(lx, p.a - rect.x1 * tx * z); ux = Math.min(ux, p.a - rect.x0 * tx * z);
      ly = Math.max(ly, p.b - rect.y1 * ty * z); uy = Math.min(uy, p.b - rect.y0 * ty * z);
    }
    return { lx, ux, ly, uy, ok: lx <= ux && ly <= uy };
  };
  const reach = Math.max(...local.map((p) => Math.abs(p.f)), ...local.map((p) => Math.abs(p.a)), ...local.map((p) => Math.abs(p.b)), 1);
  let lo = Math.max(...local.map((p) => -p.f)) + 0.3, hi = Math.max(lo + 1, reach * 400);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (span(mid).ok) hi = mid; else lo = mid;
  }
  const D = hi, s = span(D);
  let sx = (s.lx + s.ux) / 2, sy = (s.ly + s.uy) / 2;
  // Perspective makes the middle of the feasible interval look off centre on the axis with room to spare: nudge the target until
  // the projected box sits in the middle of the rectangle, never leaving the feasible interval.
  const zc = D + local.reduce((m, p) => m + p.f, 0) / local.length;
  for (let i = 0; i < 8; i++) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of local) {
      const z = p.f + D, xn = (p.a - sx) / (tx * z), yn = (p.b - sy) / (ty * z);
      x0 = Math.min(x0, xn); x1 = Math.max(x1, xn); y0 = Math.min(y0, yn); y1 = Math.max(y1, yn);
    }
    sx = Math.min(s.ux, Math.max(s.lx, sx + ((x0 + x1) / 2 - (rect.x0 + rect.x1) / 2) * tx * zc));
    sy = Math.min(s.uy, Math.max(s.ly, sy + ((y0 + y1) / 2 - (rect.y0 + rect.y1) / 2) * ty * zc));
  }
  const target = c.clone().addScaledVector(right, sx).addScaledVector(up, sy);
  return { target, position: target.clone().addScaledVector(dir, D), distance: D };
}

// Where a box lands on a w x h canvas seen through cam (any three.js camera whose matrices are current): CSS px.
export function projectedBox(corners, cam, w, h) {
  cam.updateMatrixWorld();
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const p of corners) {
    const q = p.clone().project(cam), x = ((q.x + 1) / 2) * w, y = ((1 - q.y) / 2) * h;
    l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
  }
  return { left: l, right: r, top: t, bottom: b };
}

// Margins of a projected box inside a free rectangle, as fractions of the free rectangle's width and height (negative: cropped).
export function marginsOf(box, free) {
  const fw = free.right - free.left, fh = free.bottom - free.top;
  return { left: (box.left - free.left) / fw, right: (free.right - box.right) / fw, top: (box.top - free.top) / fh, bottom: (free.bottom - box.bottom) / fh };
}
