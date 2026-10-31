// Ported from planwalk viewer/src/physics.js (MIT, same author), source commit fa1a280 (v0.3.2).
// Spacer physics: 2D circle against oriented rectangles, stair ramps, jumps and doors, deterministic. No DOM, no three.js.
// The player walks through furniture: only walls, window gaps, stairs with their rails and shut doors stop it.
import { PLAYER, STAIR_SWITCH, JUMP, DOOR_REACH, DOOR_CONE_DEG, DOOR_SECONDS, roomAt } from './geometry.js';
import { pointInPolygon } from '../core/geom2d.js';

const MAX_SUBSTEP = 0.04; // metres per collision pass, well under the thinnest wall (0.08) plus the radius
const EPS_PEN = 1e-3;
const DOOR_MARGIN = 0.02; // a door does not shut on a player this close to it (metres beyond the radius)
const DOOR_SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9]; // points along the opening that a player must be able to see to work the door
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => {
  const t = Math.PI * 2;
  return a - t * Math.floor((a + Math.PI) / t);
};

// solid[i] is what stops the player on level i: the colliders of the model without the furniture, plus the doors that are shut.
// fixed[i] is the same without the doors. doors holds the state of every door that can be shut (all open at the start).
export function createWorld(model, margin = 6) {
  const b = model.bounds;
  const fixed = model.levels.map((lv) => ({ colliders: lv.colliders.filter((c) => c.kind !== 'furniture') }));
  const world = {
    model,
    levels: model.levels,
    stairs: model.stairs,
    radius: PLAYER.radius,
    bounds: { minX: b.minX - margin, maxX: b.maxX + margin, minY: b.minY - margin, maxY: b.maxY + margin },
    fixed,
    solid: fixed.map((l) => ({ colliders: [...l.colliders] })),
    doors: model.levels.flatMap((lv) => lv.doors.map((d) => ({ ...d, closed: false, t: 1 }))),
  };
  return world;
}

function rebuildSolid(world, li) {
  world.solid[li].colliders = [...world.fixed[li].colliders, ...world.doors.filter((d) => d.level === li && d.closed).map((d) => d.collider)];
}

// Push vector that moves a circle (x, y, r) out of rect c, or null when they do not overlap.
function pushOut(c, x, y, r) {
  if (x < c.minX - r || x > c.maxX + r || y < c.minY - r || y > c.maxY + r) return null;
  const dx = x - c.cx, dy = y - c.cy;
  const lx = dx * c.ux + dy * c.uy;
  const ly = -dx * c.uy + dy * c.ux;
  const qx = clamp(lx, -c.hx, c.hx), qy = clamp(ly, -c.hy, c.hy);
  let nx, ny, depth;
  if (qx === lx && qy === ly) {
    // centre inside the rectangle: leave through the nearest face
    const px = c.hx - Math.abs(lx), py = c.hy - Math.abs(ly);
    if (px < py) { nx = lx >= 0 ? 1 : -1; ny = 0; depth = px + r; } else { nx = 0; ny = ly >= 0 ? 1 : -1; depth = py + r; }
  } else {
    const ex = lx - qx, ey = ly - qy;
    const d = Math.hypot(ex, ey);
    if (d >= r) return null;
    nx = ex / d; ny = ey / d; depth = r - d;
  }
  return [(nx * c.ux - ny * c.uy) * depth, (nx * c.uy + ny * c.ux) * depth];
}

// Iterative push-out against all colliders of the level. Returns true when anything pushed.
function resolve(level, p, r) {
  let hit = false;
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const c of level.colliders) {
      const v = pushOut(c, p.x, p.y, r);
      if (v) { p.x += v[0]; p.y += v[1]; moved = true; }
    }
    if (!moved) break;
    hit = true;
  }
  return hit;
}

export function maxPenetration(level, x, y, r = PLAYER.radius) {
  let worst = 0;
  for (const c of level.colliders) {
    const v = pushOut(c, x, y, r);
    if (v) worst = Math.max(worst, Math.hypot(v[0], v[1]));
  }
  return worst;
}

function clampBounds(world, p) {
  const b = world.bounds;
  p.x = clamp(p.x, b.minX, b.maxX);
  p.y = clamp(p.y, b.minY, b.maxY);
}

function settle(world, p) {
  const level = world.solid[p.level];
  clampBounds(world, p);
  resolve(level, p, world.radius);
  if (maxPenetration(level, p.x, p.y, world.radius) <= EPS_PEN) return;
  // still stuck: spiral outwards to the nearest free spot
  const x0 = p.x, y0 = p.y;
  for (let ring = 1; ring <= 60; ring++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = x0 + Math.cos(a) * ring * 0.1, y = y0 + Math.sin(a) * ring * 0.1;
      if (maxPenetration(level, x, y, world.radius) <= EPS_PEN) { p.x = x; p.y = y; return; }
    }
  }
}

function stairCoords(st, x, y) {
  const dx = x - st.from[0], dy = y - st.from[1];
  return { r: st.length > 0 ? (dx * st.dir[0] + dy * st.dir[1]) / st.length : 0, t: -dx * st.dir[1] + dy * st.dir[0] };
}

// Floor height under the player and level switching on stairs (ramp: height = r * delta).
function updateStairs(world, p) {
  p.onStair = null;
  let floor = world.levels[p.level].elevation;
  for (const st of world.stairs) {
    if (p.level !== st.lower && p.level !== st.upper) continue;
    const { r, t } = stairCoords(st, p.x, p.y);
    if (Math.abs(t) > st.width / 2 || r < 0 || r > 1) continue;
    const lowE = world.levels[st.lower].elevation;
    if (p.level === st.lower) {
      if (r >= STAIR_SWITCH) { p.level = st.upper; floor = lowE + r * st.delta; resolve(world.solid[p.level], p, world.radius); } // the ramp goes on up to the top, so the eyes do not hop when the level changes
      else { floor = lowE + r * st.delta; p.onStair = st.id; }
    } else if (r < STAIR_SWITCH) {
      p.level = st.lower; floor = lowE + r * st.delta; p.onStair = st.id;
      resolve(world.solid[p.level], p, world.radius);
    } else {
      floor = lowE + r * st.delta;
    }
    break;
  }
  p.floor = floor;
}

export function createPlayer(world, { level = 0, x = 0, y = 0, yawDeg = 0, pitchDeg = 0 } = {}) {
  const p = { level: clamp(level, 0, Math.max(0, world.levels.length - 1)), x, y, yaw: rad(yawDeg), pitch: rad(pitchDeg), floor: 0, onStair: null, collisions: 0, jumpH: 0, jumpV: 0 };
  teleport(world, p, x, y, p.level);
  return p;
}

export function teleport(world, p, x, y, level = p.level) {
  p.level = clamp(level, 0, Math.max(0, world.levels.length - 1));
  p.x = x; p.y = y;
  p.jumpH = 0; p.jumpV = 0;
  if (world.levels.length) { settle(world, p); updateStairs(world, p); }
  return p;
}

// Starts a jump (JUMP.speed up) when the player stands on the floor; in the air it does nothing. Returns true when the jump started.
export function jump(world, p) {
  if (!world.levels.length || p.jumpH > 0 || p.jumpV > 0) return false;
  p.jumpV = JUMP.speed;
  return true;
}

// Height above the floor under the player, one step of constant gravity (exact for that, so a step of any size lands the same way).
function stepJump(p, dt) {
  if (!(p.jumpH > 0 || p.jumpV > 0) || !(dt > 0)) return;
  const h = p.jumpH + p.jumpV * dt - 0.5 * JUMP.gravity * dt * dt;
  if (h <= 0) { p.jumpH = 0; p.jumpV = 0; return; }
  p.jumpH = h;
  p.jumpV -= JUMP.gravity * dt;
}

// Advance the player by dt seconds. input: { forward, strafe, turn (-1..1), run }.
export function stepPlayer(world, p, input = {}, dt = 1 / 60) {
  const fwd = clamp(+input.forward || 0, -1, 1), str = clamp(+input.strafe || 0, -1, 1), turn = clamp(+input.turn || 0, -1, 1);
  if (!world.levels.length) return p;
  p.yaw = wrap(p.yaw + turn * rad(PLAYER.turnRate) * dt);
  stepJump(p, dt);
  let mx = fwd, my = str;
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }
  if (mag > 1e-9 && dt > 0) {
    const speed = input.run ? PLAYER.run : PLAYER.walk;
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    const vx = (cos * mx - sin * my) * speed, vy = (sin * mx + cos * my) * speed;
    const n = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / MAX_SUBSTEP));
    for (let i = 0; i < n; i++) {
      const px = p.x, py = p.y;
      p.x += (vx * dt) / n;
      p.y += (vy * dt) / n;
      clampBounds(world, p);
      const level = world.solid[p.level];
      if (resolve(level, p, world.radius)) p.collisions++;
      if (maxPenetration(level, p.x, p.y, world.radius) > EPS_PEN) { p.x = px; p.y = py; }
      updateStairs(world, p);
    }
  } else {
    updateStairs(world, p);
  }
  return p;
}

// ---- doors ----
// A door that can be shut has a state in world.doors: closed (what it is set to) and t, how far the leaf stands open (1 open, 0 shut)
// while it swings. A shut door blocks at once and an open one lets through at once; the swing is only the picture.
const nearestOnGap = (d, x, y) => {
  const [a, b] = d.gap, dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return [a[0] + t * dx, a[1] + t * dy];
};
const standsIn = (world, d, p) => pushOut(d.collider, p.x, p.y, world.radius + DOOR_MARGIN) !== null;
// Walls between the player and the opening hide the door: at least one of a few points along it must be in plain sight.
const seesDoor = (world, d, p) => DOOR_SAMPLES.some((f) => {
  const x = d.gap[0][0] + (d.gap[1][0] - d.gap[0][0]) * f - p.x, y = d.gap[0][1] + (d.gap[1][1] - d.gap[0][1]) * f - p.y, len = Math.hypot(x, y);
  return len < 1e-9 || freeDistance(world.fixed[p.level], p.x, p.y, x / len, y / len, len) >= len - 1e-6;
});

// The door that the space bar works on: the player stands in it, or it is within DOOR_REACH, within DOOR_CONE_DEG of where the player
// looks and in plain sight. The nearest one wins (null when there is none).
export function doorInReach(world, p) {
  const cone = Math.cos(rad(DOOR_CONE_DEG));
  let best = null, bestScore = Infinity;
  for (const d of world.doors) {
    if (d.level !== p.level) continue;
    const inside = standsIn(world, d, p);
    const q = nearestOnGap(d, p.x, p.y), dist = Math.hypot(q[0] - p.x, q[1] - p.y);
    if (!inside) {
      if (dist > DOOR_REACH) continue;
      if (dist > 1e-9 && (q[0] - p.x) * Math.cos(p.yaw) + (q[1] - p.y) * Math.sin(p.yaw) < cone * dist) continue;
      if (!seesDoor(world, d, p)) continue;
    }
    const score = inside ? -1 : dist;
    if (score < bestScore) { best = d; bestScore = score; }
  }
  return best;
}

// What the space bar does at a door: shuts an open one and opens a shut one. Returns { id, action: 'close' | 'open' | 'blocked' }
// ('blocked': the player stands in the doorway, so the door stays open), or null when no door is in reach.
export function useDoor(world, p) {
  const d = doorInReach(world, p);
  if (!d) return null;
  if (!d.closed && standsIn(world, d, p)) return { id: d.id, action: 'blocked' };
  d.closed = !d.closed;
  rebuildSolid(world, d.level);
  return { id: d.id, action: d.closed ? 'close' : 'open' };
}

// The space bar: works the door in reach, else jumps. Returns { action: 'close' | 'open' | 'blocked' | 'jump' | 'none', id? } ('none':
// the player is in the air and there is no door to work).
export function useSpace(world, p) {
  const door = useDoor(world, p);
  return door ?? { action: jump(world, p) ? 'jump' : 'none' };
}

// Swings the leaves towards their state for dt seconds. Returns true when any leaf moved (the picture has to follow).
export function stepDoors(world, dt) {
  let moved = false;
  for (const d of world.doors) {
    const t = clamp(d.t + ((d.closed ? -1 : 1) * dt) / DOOR_SECONDS, 0, 1);
    if (t !== d.t) { d.t = t; moved = true; }
  }
  return moved;
}

// Every door open and at rest again (leaving Spacer, a new plan). Returns true when anything changed.
export function openAllDoors(world) {
  let changed = false;
  for (const d of world.doors) if (d.closed || d.t !== 1) { d.closed = false; d.t = 1; changed = true; }
  if (changed) world.levels.forEach((_, i) => rebuildSolid(world, i));
  return changed;
}

// How far a ray from (x, y) along the unit vector (dx, dy) travels before it meets a collider of the level, at most max (slab test
// against each oriented rectangle). A start inside a collider gives 0.
export function freeDistance(level, x, y, dx, dy, max = 40) {
  let best = max;
  for (const c of level.colliders) {
    const ox = x - c.cx, oy = y - c.cy;
    const lo = [ox * c.ux + oy * c.uy, -ox * c.uy + oy * c.ux], ld = [dx * c.ux + dy * c.uy, -dx * c.uy + dy * c.ux], half = [c.hx, c.hy];
    let t0 = 0, t1 = best;
    for (let k = 0; k < 2 && t0 <= t1; k++) {
      if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) > half[k]) t0 = Infinity; continue; }
      const a = (-half[k] - lo[k]) / ld[k], b = (half[k] - lo[k]) / ld[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
}

const VIEW_RAYS = 72; // 5 degree steps: the work stays at 72 rays whatever the plan
const VIEW_TIE = 0.05; // metres: views this close to the longest one count as equal

// The yaw (degrees) with the longest free view from a point. A direction counts with the shorter of its own ray and its two
// neighbours, so a slit between two obstacles does not win; rays that leave the model bounds stop at the edge, so an open door does
// not make the street the longest view. Among equal views the one closest to preferDeg wins, so the answer is deterministic.
export function longestView(level, x, y, bounds, preferDeg = 0) {
  const dir = Array.from({ length: VIEW_RAYS }, (_, i) => [Math.cos((i / VIEW_RAYS) * Math.PI * 2), Math.sin((i / VIEW_RAYS) * Math.PI * 2)]);
  const dist = dir.map(([dx, dy]) => {
    let cap = 40;
    if (bounds && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
      if (Math.abs(dx) > 1e-9) cap = Math.min(cap, ((dx > 0 ? bounds.maxX : bounds.minX) - x) / dx);
      if (Math.abs(dy) > 1e-9) cap = Math.min(cap, ((dy > 0 ? bounds.maxY : bounds.minY) - y) / dy);
    }
    return freeDistance(level, x, y, dx, dy, Math.max(0, cap));
  });
  const score = dist.map((d, i) => Math.min(dist[(i + VIEW_RAYS - 1) % VIEW_RAYS], d, dist[(i + 1) % VIEW_RAYS]));
  const top = Math.max(...score);
  const turn = (i) => Math.abs(((((i * 360) / VIEW_RAYS - preferDeg) % 360) + 540) % 360 - 180);
  let pick = -1;
  for (let i = 0; i < VIEW_RAYS; i++) if (score[i] >= top - VIEW_TIE && (pick < 0 || turn(i) < turn(pick))) pick = i;
  const yaw = (pick * 360) / VIEW_RAYS;
  return yaw > 180 ? yaw - 360 : yaw;
}

// Where Spacer starts: the room with an exterior door, else the largest room (lowest level first), looking along its longest free view.
export function defaultSpawn(model) {
  let found = null;
  for (const lv of model.levels) {
    for (const op of lv.openings) {
      if (op.type === 'window') continue;
      const w = lv.wallById.get(op.wallId);
      if (!w || w.kind !== 'exterior') continue;
      const um = (op.u0 + op.u1) / 2;
      const cx = w.from[0] + w.dir[0] * um, cy = w.from[1] + w.dir[1] * um;
      for (const side of [1, -1]) {
        const k = side * (w.thickness / 2 + 0.4);
        const room = roomAt(lv, cx + w.normal[0] * k, cy + w.normal[1] * k);
        if (room) { found = { level: lv.index, room, door: [cx, cy] }; break; }
      }
      if (found) break;
    }
    if (found) break;
  }
  if (!found) {
    for (const lv of model.levels) {
      if (!lv.rooms.length) continue;
      const room = lv.rooms.reduce((a, b) => (b.area > a.area ? b : a));
      found = { level: lv.index, room, door: null };
      break;
    }
  }
  const b = model.bounds;
  if (!found) return { level: 0, roomId: null, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, yawDeg: 0 };
  const lv = model.levels[found.level];
  // A spawn point must not sit on a stair run (or the hole above it): a ring around the point is tested as well.
  const ring = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * 0.5, Math.sin((i * Math.PI) / 4) * 0.5])];
  const onStair = (x, y) => model.stairs.some((st) => (st.lower === found.level || st.upper === found.level) && ring.some(([dx, dy]) => pointInPolygon([x + dx, y + dy], st.footprint)));
  const clear = (x, y) => pointInPolygon([x, y], found.room.polygon) && maxPenetration(lv, x, y, PLAYER.radius + 0.25) === 0 && !onStair(x, y);
  let [sx, sy] = found.room.label;
  if (!clear(sx, sy)) {
    let best = null, bestD = Infinity;
    const poly = found.room.polygon;
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const step = Math.max(0.1, (x1 - x0) / 300, (y1 - y0) / 300); // 10 cm, coarser for a huge room: at most 300 x 300 points
    const nx = Math.floor((x1 - x0) / step), ny = Math.floor((y1 - y0) / step); // counted loops, see labelPoint in geometry.js
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step;
      for (let j = 0; j <= ny; j++) {
        const y = y0 + j * step;
        if (!clear(x, y)) continue;
        const d = Math.hypot(x - sx, y - sy);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) [sx, sy] = best;
  }
  const lookAt = found.door ?? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  let yaw = Math.atan2(sy - lookAt[1], sx - lookAt[0]);
  if (Math.hypot(sx - lookAt[0], sy - lookAt[1]) < 0.05) yaw = 0;
  return { level: found.level, roomId: found.room.id, x: sx, y: sy, yawDeg: longestView(lv, sx, sy, b, (yaw * 180) / Math.PI) };
}
