// Small 2D geometry helpers shared by the validator and the model builder.
// Plan space: x to the right, y downward. Points are [x, y].
export const EPS = 1e-9;

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2; // signed; abs() for the area
}

export function polygonCentroid(poly) {
  const a = polygonArea(poly);
  if (Math.abs(a) < EPS) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const k = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * k;
    cy += (y1 + y2) * k;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPolygon(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distancePointToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 < EPS ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  return { dist: Math.hypot(p[0] - cx, p[1] - cy), t, closest: [cx, cy] };
}

// Proper intersection of segments ab and cd (crossing in the interior of both). Returns the point or null.
export function segmentCrossing(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < EPS) return null; // parallel or collinear
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const e = 1e-7;
  if (t > e && t < 1 - e && u > e && u < 1 - e) return [a[0] + t * r[0], a[1] + t * r[1]];
  return null;
}

// First self-intersection point of a closed polygon, or null. Quadratic in the number of points: the validator caps a
// room polygon at CAPS.polygonPoints (src/core/caps.js) before calling it.
export function polygonSelfIntersection(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // adjacent edges
      const p = segmentCrossing(a, b, poly[j], poly[(j + 1) % n]);
      if (p) return p;
    }
  }
  return null;
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// Quadratic as well (same cap).
export function distinctPointCount(poly, eps = 1e-6) {
  const seen = [];
  for (const p of poly) if (!seen.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps)) seen.push(p);
  return seen.length;
}
