// The card board under the model, sized by the shell. Closed, the board hugs the outer walls with a small rim; while the outer walls fall open it grows to hold
// them, and it shrinks back as they fold up. Pure: no three.js, no DOM; tests/look/board.test.mjs runs it in Node.
// A wall that has turned by `deg` degrees (0 closed, 90 flat) reaches out of its outer face by reach * sin(deg), so the extent follows the walls themselves, not a clock.

export const CLOSED_RIM = Object.freeze({ min: 0.35, share: 0.06 }); // metres, and a share of the larger side of the closed model
export const OPEN_RIM = Object.freeze({ min: 0.3, share: 0.03 }); // the same, of the larger side of the open extent

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sideOf = (b) => Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
const rimOf = (b, r) => Math.max(r.min, r.share * sideOf(b));
const sinOf = (deg) => Math.sin((clamp(Number.isFinite(deg) ? deg : 0, 0, 90) * Math.PI) / 180);

// The box { minX, maxX, minZ, maxZ } of the closed model together with every wall at its angle. ext: the extent of the closed model; walls: the fold walls
// (foldwalls.js: from, to, out, reach); degs: the angle of each wall in degrees (a missing one counts as closed, a value past 90 as flat).
export function fallenExtent(ext, walls, degs) {
  const e = { minX: ext.minX, maxX: ext.maxX, minZ: ext.minZ, maxZ: ext.maxZ };
  (walls ?? []).forEach((f, i) => {
    const r = f.reach * sinOf(degs?.[i]);
    for (const [x, z] of [f.from, f.to, [f.to[0] + f.out[0] * r, f.to[1] + f.out[1] * r], [f.from[0] + f.out[0] * r, f.from[1] + f.out[1] * r]]) {
      e.minX = Math.min(e.minX, x); e.maxX = Math.max(e.maxX, x); e.minZ = Math.min(e.minZ, z); e.maxZ = Math.max(e.maxZ, z);
    }
  });
  return e;
}

// The outer rectangle of the board for the walls at their angles: { minX, maxX, minZ, maxZ, width, depth, rim, fall } with fall (0 to 1) the share by which
// the walls have fallen. Closed it is the closed model plus max(0.35 m, 6 percent of its larger side); flat it is the open extent plus max(0.3 m, 3 percent of
// its larger side); between, the rim runs from one to the other and the extent is that of the walls as they stand, so a wall is never off the board.
export function boardRect(ext, walls, degs) {
  const shut = fallenExtent(ext, walls, []), open = fallenExtent(ext, walls, (walls ?? []).map(() => 90)), now = fallenExtent(ext, walls, degs); // shut: the closed model with the outer faces of its walls
  let total = 0, got = 0;
  (walls ?? []).forEach((f, i) => { total += f.reach; got += f.reach * sinOf(degs?.[i]); });
  const fall = total > 0 ? clamp(got / total, 0, 1) : 0, closedRim = rimOf(shut, CLOSED_RIM), openRim = rimOf(open, OPEN_RIM);
  const rim = closedRim + (openRim - closedRim) * fall;
  const r = { minX: now.minX - rim, maxX: now.maxX + rim, minZ: now.minZ - rim, maxZ: now.maxZ + rim };
  return { ...r, width: r.maxX - r.minX, depth: r.maxZ - r.minZ, rim, fall };
}
