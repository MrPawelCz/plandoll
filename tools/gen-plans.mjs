// Deterministic synthetic apartments for tests and demos (docs/SPEC.md section 5).
// Usage: node tools/gen-plans.mjs --seed N --count K --out DIR [--family NAME]
// Writes DIR/truth/<id>.plan.json for K plans (seed N, N+1, ...). The family cycles through FAMILIES unless --family is given.
// A plan is built from horizontal bands of rooms (exterior walls follow the union of the bands, so L shapes are just
// bands of different widths); doors and windows are placed from the geometry, so every room is reachable by construction.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAMILIES = ['studio', 'one-bedroom', 'two-bedroom', 'three-bedroom', 'l-shaped', 'balcony', 'duplex'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r05 = (v) => Math.round(v * 20) / 20; // 5 cm grid
const r2 = (v) => Math.round(v * 100) / 100;
const between = (r, a, b) => r05(a + r() * (b - a));

const FLOOR = { dining: 'wood', living: 'wood', bedroom: 'wood', kitchen: 'tile', bathroom: 'tile', hall: 'tile', corridor: 'carpet', other: 'stone' };
const NAMES = { dining: 'Dining room', living: 'Living room', bedroom: 'Bedroom', kitchen: 'Kitchen', bathroom: 'Bathroom', hall: 'Hall', corridor: 'Corridor' };

// A room spec is [id, use, width]; the last room of a band takes the remaining width.
function room(id, use, w, name) { return { id, use, w, name: name ?? NAMES[use] ?? id, floor: FLOOR[use] ?? 'wood' }; }

function layoutLevel(spec, r) {
  const rooms = [], bands = [];
  let y = 0;
  spec.bands.forEach((b, i) => {
    const y0 = y, y1 = y + b.h;
    let x = 0;
    const rs = b.rooms.map((rm, k) => {
      const x1 = k === b.rooms.length - 1 ? b.width : r2(x + rm.w);
      const out = { ...rm, band: i, k, x0: x, x1, y0, y1 };
      x = x1;
      return out;
    });
    rooms.push(...rs);
    bands.push({ i, y0, y1, width: b.width, rooms: rs });
    y = y1;
  });
  const D = y, last = bands[bands.length - 1];
  const walls = [
    { id: 'x-top', from: [0, 0], to: [bands[0].width, 0], kind: 'exterior' },
    { id: 'x-bot', from: [0, D], to: [last.width, D], kind: 'exterior' },
    { id: 'x-left', from: [0, 0], to: [0, D], kind: 'exterior' },
  ];
  for (const b of bands) walls.push({ id: `x-right-${b.i}`, from: [b.width, b.y0], to: [b.width, b.y1], kind: 'exterior' });
  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i], c = bands[i + 1], lo = Math.min(a.width, c.width), hi = Math.max(a.width, c.width);
    walls.push({ id: `h-${i}`, from: [0, a.y1], to: [lo, a.y1] });
    if (hi > lo) walls.push({ id: `x-step-${i}`, from: [lo, a.y1], to: [hi, a.y1], kind: 'exterior' });
  }
  for (const b of bands) for (let k = 0; k < b.rooms.length - 1; k++) walls.push({ id: `v-${b.i}-${k}`, from: [b.rooms[k].x1, b.y0], to: [b.rooms[k].x1, b.y1] });

  const openings = [];
  const free = (wallId, a, b) => !openings.some((o) => o.wall === wallId && a < o.offset + o.width + 0.25 && b > o.offset - 0.25);
  const put = (op) => { openings.push(op); return op; };

  // links: [roomIdA, roomIdB, type, width]
  const byId = new Map(rooms.map((q) => [q.id, q]));
  for (const [ia, ib, type, width] of spec.links) {
    const A = byId.get(ia), B = byId.get(ib);
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt++) {
      let wall, lo, hi, base;
      if (A.band === B.band) {
        const left = A.x1 === B.x0 ? A : B.x1 === A.x0 ? B : null;
        if (!left) throw new Error(`rooms ${ia} and ${ib} are not neighbours`);
        wall = `v-${A.band}-${left.k}`; base = A.y0; lo = A.y0 + 0.3 + width / 2; hi = A.y1 - 0.3 - width / 2;
      } else {
        const up = A.band < B.band ? A : B, dn = up === A ? B : A;
        if (dn.band !== up.band + 1) throw new Error(`rooms ${ia} and ${ib} are not on adjacent bands`);
        wall = `h-${up.band}`; base = 0;
        lo = Math.max(up.x0, dn.x0) + 0.3 + width / 2; hi = Math.min(up.x1, dn.x1) - 0.3 - width / 2;
      }
      if (hi < lo) throw new Error(`no room for a ${type} between ${ia} and ${ib}`);
      const c = lo + (hi - lo) * (attempt === 0 ? 0.25 + 0.5 * r() : r());
      const offset = r05(c - width / 2 - base);
      if (free(wall, offset, offset + width)) { put({ id: `${type === 'door' ? 'd' : 'p'}-${ia}-${ib}`, wall, type, offset, width }); done = true; }
    }
    if (!done) throw new Error(`could not place a ${type} between ${ia} and ${ib}`);
  }

  // entrance
  const fr = byId.get(spec.front);
  const frontWall = spec.frontSide === 'top' ? 'x-top' : 'x-bot';
  {
    const w = 0.9, lo = fr.x0 + 0.35 + w / 2, hi = fr.x1 - 0.35 - w / 2;
    for (let a = 0; a < 8; a++) {
      const c = lo + (hi - lo) * (a === 0 ? 0.3 : r());
      const offset = r05(c - w / 2);
      if (free(frontWall, offset, offset + w)) { put({ id: 'front', wall: frontWall, type: 'door', offset, width: w }); break; }
    }
  }

  for (const o of spec.preOpenings ?? []) put(o); // reserved before the windows are placed (balcony door)

  // windows on the exterior side of each room
  let wn = 0;
  const small = (q) => q.use === 'bathroom' || q.use === 'hall';
  for (const q of rooms) {
    if (q.id === 'corr') continue;
    const b = bands[q.band];
    const sides = [];
    if (q.band === 0) sides.push({ wall: 'x-top', a: q.x0, b: q.x1, base: 0 });
    if (q.band === bands.length - 1) sides.push({ wall: 'x-bot', a: q.x0, b: q.x1, base: 0 });
    if (q.x0 === 0) sides.push({ wall: 'x-left', a: q.y0, b: q.y1, base: 0 });
    if (q.x1 === b.width) sides.push({ wall: `x-right-${b.i}`, a: q.y0, b: q.y1, base: b.y0 });
    if (q.band > 0) {
      const prev = bands[q.band - 1];
      if (prev.width < b.width) {
        const lo = Math.max(q.x0, prev.width), hi = q.x1;
        if (hi - lo >= 1.2) sides.push({ wall: `x-step-${q.band - 1}`, a: lo, b: hi, base: prev.width });
      }
    }
    let placed = 0;
    for (const s of sides) {
      const len = s.b - s.a;
      if (len < 1.3 || (small(q) && placed >= 1)) continue;
      const count = !small(q) && len > 4.6 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const w = small(q) ? 0.6 : r05(Math.min(1.2 + r() * 0.6, len / count - 0.9));
        const segLo = s.a + (len * n) / count, segHi = s.a + (len * (n + 1)) / count;
        const mid = (segLo + segHi) / 2;
        for (const dc of [0, 0.35, -0.35, 0.7, -0.7]) {
          const c = mid + dc;
          if (c - w / 2 < segLo + 0.25 || c + w / 2 > segHi - 0.25) continue;
          const offset = r05(c - w / 2 - s.base);
          if (!free(s.wall, offset, offset + w)) continue;
          put(small(q) ? { id: `win-${++wn}`, wall: s.wall, type: 'window', offset, width: w, height: 0.6, sill: 1.3 } : { id: `win-${++wn}`, wall: s.wall, type: 'window', offset, width: w, height: 1.3 });
          placed++;
          break;
        }
      }
    }
  }
  return { rooms, walls, openings, bands, D, W: Math.max(...bands.map((q) => q.width)) };
}

function furnish(rooms, extra, r) {
  const out = [];
  let n = 0;
  const add = (type, x, y, rotation, size) => out.push({ id: `f${++n}`, type, center: [r2(x), r2(y)], ...(rotation ? { rotation } : {}), ...(size ? { size } : {}) });
  for (const q of rooms) {
    const w = q.x1 - q.x0, d = q.y1 - q.y0, cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2;
    if (q.use === 'living') {
      if (d >= 3.2 && w >= 3.4) { add('sofa', cx, q.y1 - 0.65, 0); add('table-coffee', cx, q.y1 - 1.75, 0); add('tv-unit', cx, q.y0 + 0.45, 0); }
      if (w >= 5.4) add('table-dining', q.x0 + 1.3, cy, 0, [1.6, 0.9]);
    } else if (q.use === 'dining') {
      if (w >= 2.4 && d >= 2.4) { add('table-dining', cx, cy, 0, [1.6, 0.9]); add('chair', cx - 0.45, cy - 0.7, 0); add('chair', cx + 0.45, cy - 0.7, 0); add('chair', cx - 0.45, cy + 0.7, 0); add('chair', cx + 0.45, cy + 0.7, 0); }
      if (w >= 4.4 && d >= 3.6) add('plant', q.x1 - 0.5, q.y1 - 0.5, 0);
    } else if (q.use === 'bedroom') {
      if (w >= 2.7 && d >= 2.7) { add('bed-double', q.x1 - 1.2, cy, 90); add('wardrobe', q.x0 + 0.6, q.y0 + 0.45, 0, [1.0, 0.6]); }
      if (w >= 3.3 && d >= 3.1) add('desk', q.x0 + 1.0, q.y1 - 0.5, 0, [1.4, 0.7]);
    } else if (q.use === 'kitchen') {
      if (w >= 2.6) { add('kitchen-counter', q.x0 + 0.75, q.y0 + 0.5, 0, [1.2, 0.6]); add('sink', q.x0 + 1.95, q.y0 + 0.5, 0); }
      if (w >= 3.4) { add('stove', q.x0 + 2.75, q.y0 + 0.5, 0); add('fridge', q.x0 + 3.45 > q.x1 - 0.4 ? q.x1 - 0.45 : q.x0 + 3.45, q.y0 + 0.5, 0); }
    } else if (q.use === 'bathroom') {
      if (w >= 1.7 && d >= 1.6) { add('toilet', q.x1 - 0.45, q.y0 + 0.5, 0); add('basin', q.x0 + 0.5, q.y0 + 0.45, 0); }
      if (d >= 2.0 && w >= 1.7) add('bathtub', cx, q.y1 - 0.5, 0, [Math.min(1.6, w - 0.4), 0.7]);
    } else if (q.use === 'hall' && w >= 1.9 && d >= 1.8) add('plant', q.x1 - 0.4, q.y0 + 0.4, 0);
  }
  for (const e of extra ?? []) add(e[0], e[1], e[2], e[3], e[4]);
  return out;
}

function levelJson(spec, r) {
  const L = layoutLevel(spec, r);
  const poly = (q) => [[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]];
  const walls = [...L.walls, ...(spec.extraWalls ?? [])];
  const rooms = [...L.rooms.map((q) => ({ id: q.id, name: q.name, use: q.use, polygon: poly(q), floor: q.floor, area: r2((q.x1 - q.x0) * (q.y1 - q.y0)) })), ...(spec.extraRooms ?? [])];
  return {
    json: { id: spec.id, name: spec.name, height: spec.height ?? 2.7, walls, openings: [...L.openings, ...(spec.extraOpenings ?? [])], rooms, stairs: spec.stairs ?? [], furniture: furnish(L.rooms, spec.extraFurniture, r) },
    layout: L,
  };
}

const STYLE_NOTE = 'Synthetic plan with known truth. CC0.';

export function generatePlan(seed, family) {
  const r = rng(seed * 7919 + 17);
  const fam = family ?? FAMILIES[(seed - 1 + FAMILIES.length * 1000) % FAMILIES.length];
  let levels, title;
  if (fam === 'studio') {
    const W = between(r, 5.4, 7.0), D = between(r, 4.6, 5.6);
    title = 'Studio';
    levels = [levelJson({ id: 'L0', name: 'Studio', bands: [
      { h: r05(D - 2.2), width: W, rooms: [room('main', 'living', W, 'Studio')] },
      { h: 2.2, width: W, rooms: [room('hall', 'hall', r05(W - 2.2)), room('bath', 'bathroom', 2.2)] },
    ], links: [['hall', 'main', 'passage', between(r, 1.2, 1.6)], ['hall', 'bath', 'door', 0.8]], front: 'hall' }, r).json];
  } else if (fam === 'one-bedroom') {
    const W = between(r, 8.6, 9.8), D = between(r, 5.8, 6.8), top = r05(D * 0.5);
    title = 'One-bedroom flat';
    levels = [levelJson({ id: 'L0', name: 'Flat', bands: [
      { h: top, width: W, rooms: [room('living', 'living', r05(W - 3.0)), room('bed', 'bedroom', 0)] },
      { h: r05(D - top), width: W, rooms: [room('hall', 'hall', 2.0), room('bath', 'bathroom', 2.0), room('kitchen', 'kitchen', 0)] },
    ], links: [['hall', 'living', 'door', 0.9], ['kitchen', 'living', 'door', 0.85], ['bath', 'hall', 'door', 0.8], ['bed', 'living', 'door', 0.9]], front: 'hall' }, r).json];
  } else if (fam === 'two-bedroom' || fam === 'three-bedroom') {
    const three = fam === 'three-bedroom';
    const W = three ? between(r, 11.4, 12.4) : between(r, 9.6, 11.2), D = three ? between(r, 7.8, 8.8) : between(r, 7.2, 8.2);
    const top = three ? 3.6 : 3.4, bot = r05(D - top - 1.2);
    title = three ? 'Three-bedroom flat' : 'Two-bedroom flat with corridor';
    const topRooms = three
      ? [room('bed1', 'bedroom', r05(W * 0.27), 'Bedroom 1'), room('bed2', 'bedroom', r05(W * 0.25), 'Bedroom 2'), room('bed3', 'bedroom', r05(W * 0.23), 'Bedroom 3'), room('bath', 'bathroom', 0)]
      : [room('bed1', 'bedroom', r05(W * 0.34), 'Bedroom 1'), room('bed2', 'bedroom', r05(W * 0.30), 'Bedroom 2'), room('bath', 'bathroom', 0)];
    const links = [...topRooms.map((q) => [q.id, 'corr', 'door', q.use === 'bathroom' ? 0.8 : 0.9]), ['hall', 'corr', 'door', 0.9], ['kitchen', 'corr', 'door', 0.85], ['living', 'corr', 'door', 0.9], ['kitchen', 'living', 'passage', between(r, 1.2, 1.6)]];
    levels = [levelJson({ id: 'L0', name: 'Flat', bands: [
      { h: top, width: W, rooms: topRooms },
      { h: 1.2, width: W, rooms: [room('corr', 'hall', W, 'Corridor')] },
      { h: bot, width: W, rooms: [room('hall', 'hall', 2.3), room('kitchen', 'kitchen', between(r, 3.0, 3.6)), room('living', 'living', 0)] },
    ], links, front: 'hall' }, r).json];
  } else if (fam === 'l-shaped') {
    const W = between(r, 10.8, 11.8), Wt = between(r, 6.4, 7.2);
    title = 'L-shaped flat';
    levels = [levelJson({ id: 'L0', name: 'Flat', bands: [
      { h: 3.6, width: Wt, rooms: [room('bed1', 'bedroom', r05(Wt * 0.46), 'Bedroom 1'), room('bed2', 'bedroom', 0, 'Bedroom 2')] },
      { h: 4.2, width: W, rooms: [room('hall', 'hall', 2.4), room('living', 'living', r05(W - 2.4 - 3.0 - 2.2)), room('kitchen', 'kitchen', 3.0), room('bath', 'bathroom', 0)] },
    ], links: [['bed1', 'hall', 'door', 0.9], ['bed2', 'living', 'door', 0.9], ['hall', 'living', 'door', 0.9], ['living', 'kitchen', 'passage', between(r, 1.4, 1.9)], ['kitchen', 'bath', 'door', 0.8]], front: 'hall' }, r).json];
  } else if (fam === 'balcony') {
    const W = between(r, 8.6, 9.8), D = between(r, 6.0, 6.8), top = r05(D * 0.5), livW = r05(W - 3.0);
    title = 'One-bedroom flat with balcony';
    const bx0 = r05(0.6 + r() * 0.5), bw = Math.min(3.2, livW - bx0 - 0.5);
    levels = [levelJson({ id: 'L0', name: 'Flat', bands: [
      { h: top, width: W, rooms: [room('living', 'living', livW), room('bed', 'bedroom', 0)] },
      { h: r05(D - top), width: W, rooms: [room('hall', 'hall', 2.0), room('bath', 'bathroom', 2.0), room('kitchen', 'kitchen', 0)] },
    ], links: [['hall', 'living', 'door', 0.9], ['kitchen', 'living', 'door', 0.85], ['bath', 'hall', 'door', 0.8], ['bed', 'living', 'door', 0.9]], front: 'hall',
    extraWalls: [
      { id: 'b-left', from: [bx0, -1.4], to: [bx0, 0], kind: 'partition', height: 1.0 },
      { id: 'b-top', from: [bx0, -1.4], to: [bx0 + bw, -1.4], kind: 'partition', height: 1.0 },
      { id: 'b-right', from: [bx0 + bw, -1.4], to: [bx0 + bw, 0], kind: 'partition', height: 1.0 },
    ],
    extraRooms: [{ id: 'balcony', name: 'Balcony', use: 'other', polygon: [[bx0, -1.4], [bx0 + bw, -1.4], [bx0 + bw, 0], [bx0, 0]], floor: 'stone', ceiling: false, area: r2(bw * 1.4) }],
    preOpenings: [{ id: 'd-living-balcony', wall: 'x-top', type: 'door', offset: r05(bx0 + bw / 2 - 0.45), width: 0.9 }],
    extraFurniture: [['table-coffee', bx0 + bw / 2, -0.7, 0, [0.7, 0.7]], ['plant', bx0 + 0.35, -1.05, 0]] }, r).json];
  } else if (fam === 'duplex') {
    const W = between(r, 9.2, 10.4), D = 6.4;
    title = 'Two-level house';
    const stairTop = 2.85;
    const g = levelJson({ id: 'L0', name: 'Ground floor', bands: [
      { h: 2.2, width: W, rooms: [room('kitchen', 'kitchen', between(r, 3.8, 4.4)), room('wc', 'bathroom', 2.0, 'WC'), room('hall', 'hall', 0)] },
      { h: r05(D - 2.2), width: W, rooms: [room('living', 'living', r05(W - 3.4)), room('dining', 'dining', 0, 'Dining room')] },
    ], links: [['hall', 'dining', 'door', 0.9], ['kitchen', 'living', 'passage', between(r, 1.6, 2.2)], ['wc', 'living', 'door', 0.8], ['living', 'dining', 'passage', between(r, 1.6, 2.2)]], front: 'hall', frontSide: 'top',
    stairs: [{ id: 'stair-1', from: [0.9, D - 0.55], to: [0.9, stairTop], width: 1.0, steps: 14, to_level: 'L1' }] }, r);
    const u = levelJson({ id: 'L1', name: 'Upper floor', height: 2.6, bands: [
      { h: 2.2, width: W, rooms: [room('bath', 'bathroom', 1.8), room('bed1', 'bedroom', 0, 'Bedroom 1')] },
      { h: r05(D - 2.2), width: W, rooms: [room('landing', 'hall', 3.6, 'Landing'), room('bed2', 'bedroom', 0, 'Bedroom 2')] },
    ], links: [['bath', 'landing', 'door', 0.8], ['bed1', 'landing', 'door', 0.9], ['landing', 'bed2', 'door', 0.9]], front: 'bath', frontSide: 'top' }, r);
    u.json.openings = u.json.openings.filter((o) => o.id !== 'front'); // the upper floor has no entrance
    levels = [g.json, u.json];
  } else {
    throw new Error(`unknown family ${fam}`);
  }
  return {
    family: fam,
    plan: { version: 1, name: `${title} (synthetic, seed ${seed})`, units: 'm', meta: { source: 'synthetic', generator: `planstage gen-plans seed ${seed} family ${fam}`, notes: STYLE_NOTE }, levels },
  };
}

function main(argv) {
  const opt = { seed: 1, count: 7, out: null, family: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') opt.seed = Number(argv[++i]);
    else if (argv[i] === '--count') opt.count = Number(argv[++i]);
    else if (argv[i] === '--out') opt.out = argv[++i];
    else if (argv[i] === '--family') opt.family = argv[++i];
  }
  if (!opt.out || !Number.isFinite(opt.seed) || !Number.isFinite(opt.count)) {
    process.stderr.write('usage: node tools/gen-plans.mjs --seed N --count K --out DIR [--family NAME]\n  families: ' + FAMILIES.join(', ') + '\n');
    process.exit(2);
  }
  mkdirSync(join(opt.out, 'truth'), { recursive: true });
  for (let i = 0; i < opt.count; i++) {
    const seed = opt.seed + i;
    const { family, plan } = generatePlan(seed, opt.family);
    const id = `${String(seed).padStart(3, '0')}-${family}`;
    writeFileSync(join(opt.out, 'truth', `${id}.plan.json`), `${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write(`${id}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
