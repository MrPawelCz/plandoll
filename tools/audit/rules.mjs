// Audit rules A1..A5, B1..B3, C (see docs/DESIGN.md, the section on the audit). Own geometry only (geom.mjs).
import { auditRules2, HARD2 } from './rules2.mjs';
import { piecePoly, overlap, pip, distPolySeg, rectPoly, quarterDisc, Grid, DEG, polyBBox } from './geom.mjs';

export const HARD = new Set(['A1', 'A2', 'A3a', 'A3b', 'A3c', 'A5', 'B1', 'B2bed', 'B3', 'C']);
const SILL_FREE = 0.35, LEAF_DEG = 75, LEAF_T = 0.04, JAMB = 0.05;
const FUNC = ['wardrobe', 'wardrobe-small', 'desk', 'kitchen-sink', 'kitchen-hob', 'fridge', 'toilet', 'washbasin', 'shower', 'bathtub', 'washing-machine', 'dresser', 'shoe-cabinet', 'sofa2', 'sofa3', 'sofa-bed', 'dining-table'];
const BEDS = ['bed-double', 'bed-king', 'bed-single'];
const CHAIRS = ['dining-chair', 'desk-chair', 'bar-stool'];
const TABLES = ['dining-table', 'desk', 'kitchen-island'];
const FRONT_REQ = { wardrobe: 0.9, 'wardrobe-small': 0.9, fridge: 0.9, 'kitchen-sink': 0.9, 'kitchen-hob': 0.9, toilet: 0.6, washbasin: 0.6, shower: 0.7, bathtub: 0.7, 'washing-machine': 0.6 };
const COUNTERS = ['kitchen-base', 'kitchen-sink', 'kitchen-hob', 'kitchen-island', 'fridge'];
const r3 = (v) => Math.round(v * 1000) / 1000;
const area = (poly) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

export function auditModel(model, layout, specs, extra = {}) {
  const V = [];
  const stats = { levels: model.levels.length, pieces: 0 };
  const add = (rule, o) => V.push({ rule, hard: HARD.has(rule) || HARD2.has(rule), ...o });
  const specOf = (t) => specs.SPEC_BY_ID[t] ?? null;
  const kindOf = (p, spec) => {
    if (p.on) return 'surface';
    const m = spec?.place?.mode;
    return m === 'floor' || m === 'corner' ? 'floor' : m === 'floor-flat' ? 'flat' : m === 'wall-mount' ? 'wall' : m === 'window' ? 'window' : m === 'ceiling' ? 'ceiling' : m === 'surface' ? 'surface' : 'floor';
  };

  model.levels.forEach((L, li) => {
    const LL = layout.levels.find((x) => x.id === L.id);
    const pieces = (LL?.pieces ?? []).map((p) => {
      const spec = specOf(p.type);
      const k = kindOf(p, spec);
      return { ...p, kind: k, poly: piecePoly(p.x, p.y, p.size[0], p.size[1], p.rot), z0: p.elev, z1: p.elev + p.size[2], spec, f: [-Math.sin(p.rot * DEG), Math.cos(p.rot * DEG)], u: [Math.cos(p.rot * DEG), Math.sin(p.rot * DEG)] };
    });
    stats.pieces += pieces.length;
    const byId = new Map(pieces.map((p) => [p.id, p]));
    const roomOf = new Map(L.rooms.map((r) => [r.id, r]));
    const floor = pieces.filter((p) => p.kind === 'floor');
    const flat = pieces.filter((p) => p.kind === 'flat');
    const nameOf = (p) => `${p.type}#${p.id}`;
    const rep = (p) => ({ room: p.room, piece: nameOf(p), type: p.type, level: L.id, at: [r3(p.x), r3(p.y)] });

    // ---- walls: own solids (a wall minus its door and passage gaps; windows stay solid); room edge thickness
    const wallRects = [];
    const gapsOf = (w) => L.openings.filter((o) => o.wallId === w.id && (o.type === 'door' || o.type === 'passage') && o.sill <= SILL_FREE).map((o) => [o.u0, o.u1]).sort((a, b) => a[0] - b[0]);
    const wallPt = (w, u, v) => [w.from[0] + w.dir[0] * u + w.normal[0] * v, w.from[1] + w.dir[1] * u + w.normal[1] * v];
    for (const w of L.walls) {
      let cur = 0;
      const spans = [];
      for (const [a, b] of gapsOf(w)) { if (a > cur + 1e-4) spans.push([cur, a]); cur = Math.max(cur, b); }
      if (cur < w.length - 1e-4) spans.push([cur, w.length]);
      for (const [a, b] of spans) {
        const e0 = a <= 1e-6 ? -w.thickness / 2 : 0, e1 = b >= w.length - 1e-6 ? w.thickness / 2 : 0;
        const hv = w.thickness / 2;
        wallRects.push({ wall: w.id, poly: [wallPt(w, a + e0, -hv), wallPt(w, b + e1, -hv), wallPt(w, b + e1, hv), wallPt(w, a + e0, hv)] });
      }
    }
    const edgeThick = (a, b) => {
      let t = 0;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const w of L.walls) {
        const cross = Math.abs((b[0] - a[0]) * w.dir[1] - (b[1] - a[1]) * w.dir[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (cross > 0.01) continue;
        const rel = [mid[0] - w.from[0], mid[1] - w.from[1]];
        const along = rel[0] * w.dir[0] + rel[1] * w.dir[1], off = Math.abs(rel[0] * w.dir[1] - rel[1] * w.dir[0]);
        if (off < 0.03 && along > -0.01 && along < w.length + 0.01) t = Math.max(t, w.thickness);
      }
      return t / 2;
    };

    // ---- openings with own frames
    const wallBy = new Map(L.walls.map((w) => [w.id, w]));
    const ops = L.openings.map((o) => {
      const w = wallBy.get(o.wallId);
      const oz = (v0, v1) => rectPoly(0, 0, 1, 0, 0, 0) && [wallPt(w, o.u0, v0), wallPt(w, o.u1, v0), wallPt(w, o.u1, v1), wallPt(w, o.u0, v1)];
      const out = { o, w, free: (o.type === 'door' || o.type === 'passage') && o.sill <= SILL_FREE, zone: oz(-(w.thickness / 2 + 0.9), w.thickness / 2 + 0.9), face: oz(-(w.thickness / 2 + 0.12), w.thickness / 2 + 0.12), sector: null, sector90: null, leaf: null };
      if (o.type === 'door' && out.free) {
        // own derivation of the swing from hinge and opens_to (checked against the model in the tests)
        const side = o.opens_to === 'right' ? -1 : 1;
        const sn = [w.normal[0] * side, w.normal[1] * side];
        const start = o.hinge !== 'end';
        const up = start ? o.u0 + JAMB : o.u1 - JAMB;
        const hinge = [w.from[0] + w.dir[0] * up + sn[0] * (w.thickness / 2 - 0.02), w.from[1] + w.dir[1] * up + sn[1] * (w.thickness / 2 - 0.02)];
        const closed = start ? w.dir : [-w.dir[0], -w.dir[1]];
        const wl = Math.max(0.2, o.u1 - o.u0 - 2 * JAMB - 0.01);
        out.hinge = hinge; out.closed = closed; out.sn = sn; out.wl = wl;
        out.sector = quarterDisc(hinge, closed, sn, wl + 0.05);
        out.sector90 = quarterDisc(hinge, closed, sn, wl);
        const a = LEAF_DEG * DEG, ex = closed[0] * Math.cos(a) + sn[0] * Math.sin(a), ey = closed[1] * Math.cos(a) + sn[1] * Math.sin(a);
        out.leaf = rectPoly(hinge[0] + ex * wl / 2, hinge[1] + ey * wl / 2, ex, ey, wl / 2, LEAF_T / 2);
        const mid = [hinge[0] + sn[0] * 0.3 + closed[0] * 0.3, hinge[1] + sn[1] * 0.3 + closed[1] * 0.3];
        out.swingRoom = L.rooms.find((r) => pip(mid, r.polygon))?.id ?? null;
      }
      return out;
    });

    // ---- A1 piece vs piece (floor-standing), tucked chairs allowed up to 40 % of their depth
    for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
      const a = floor[i], b = floor[j];
      const o = overlap(a.poly, b.poly);
      if (o <= 0.01) continue;
      const ch = CHAIRS.includes(a.type) && TABLES.includes(b.type) ? a : CHAIRS.includes(b.type) && TABLES.includes(a.type) ? b : null;
      if (ch && o <= 0.4 * ch.size[1] + 0.01) continue;
      add('A1', { ...rep(a), other: nameOf(b), otherRoom: b.room, value: r3(o), unit: 'm overlap', detail: `${a.type} x ${b.type} overlap ${o.toFixed(3)}` });
    }
    // A1h: hanging and ceiling pieces against floor pieces or each other with a shared height range (soft)
    const hung = pieces.filter((p) => p.kind === 'wall' || p.kind === 'ceiling');
    for (const h of hung) for (const o2 of [...floor, ...hung]) {
      if (o2 === h || (o2.kind !== 'floor' && o2.id < h.id)) continue;
      if (Math.min(h.z1, o2.z1) - Math.max(h.z0, o2.z0) <= 0.01) continue;
      const o = overlap(h.poly, o2.poly);
      if (o > 0.05) add('A1h', { ...rep(h), other: nameOf(o2), value: r3(o), unit: 'm overlap', detail: `${h.type} (hung) x ${o2.type} overlap ${o.toFixed(3)}` });
    }
    // surface pieces must lie on their parent
    for (const p of pieces.filter((q) => q.kind === 'surface')) {
      const par = p.on ? byId.get(p.on) : null;
      if (!par) { add('A1s', { ...rep(p), value: 0, detail: `${p.type} has no parent piece (on=${p.on})` }); continue; }
      const out = p.poly.some((c) => !pip(c, par.poly) && distPolySeg(par.poly, c, c) > 0.03);
      if (out) add('A1s', { ...rep(p), other: nameOf(par), value: 0, detail: `${p.type} hangs over the edge of ${par.type}` });
    }

    // ---- A2 floor and flat pieces inside the room shrunk by half the wall thickness
    for (const p of [...floor, ...flat]) {
      const room = roomOf.get(p.room);
      if (!room) { add('A2', { ...rep(p), value: 0, detail: `unknown room ${p.room}` }); continue; }
      let worst = 0;
      const outside = p.poly.filter((c) => !pip(c, room.polygon));
      if (outside.length) {
        worst = Math.max(...outside.map((c) => Math.min(...room.polygon.map((v, i) => distPolySeg([c, c, c, c], v, room.polygon[(i + 1) % room.polygon.length])))), 0.01);
      }
      room.polygon.forEach((a, i) => {
        const b = room.polygon[(i + 1) % room.polygon.length];
        const t = edgeThick(a, b);
        if (t <= 0) return;
        const d = distPolySeg(p.poly, a, b);
        if (t - d > worst) worst = t - d;
      });
      if (worst > 0.005) add('A2', { ...rep(p), value: r3(worst), unit: 'm into wall', detail: `${p.type} reaches ${worst.toFixed(3)} m into a wall or out of ${p.room}` });
    }
    for (const p of pieces.filter((q) => q.kind === 'wall')) for (const op of ops) {
      if (Math.min(p.z1, op.o.sill + op.o.height) - Math.max(p.z0, op.o.sill) <= 0.02) continue;
      const o = overlap(p.poly, op.face);
      if (o > 0.02) add(op.free ? 'A2' : 'A4', { ...rep(p), other: op.o.id, value: r3(o), unit: 'm overlap', detail: `${p.type} hangs on ${op.o.type} ${op.o.id}` });
    }

    // ---- A3 doors
    for (const op of ops) {
      if (!op.free) continue;
      for (const p of floor) {
        const o = overlap(p.poly, op.zone);
        if (o > 0.01) add('A3a', { ...rep(p), other: op.o.id, value: r3(o), unit: 'm into door zone', detail: `${p.type} inside 0.9 m zone of ${op.o.id}` });
      }
      if (!op.sector) continue;
      for (const p of floor) {
        const o = overlap(p.poly, op.sector);
        if (o > 0.01) add('A3b', { ...rep(p), other: op.o.id, value: r3(o), unit: 'm into leaf sweep', detail: `${p.type} in the sweep of ${op.o.id} (room ${op.swingRoom})`, at: [r3(p.x), r3(p.y)] });
      }
    }
    const doors = ops.filter((o) => o.leaf);
    for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
      const o = overlap(doors[i].leaf, doors[j].leaf);
      if (o > 0.01) add('A3c', { room: doors[i].swingRoom, piece: `${doors[i].o.id}+${doors[j].o.id}`, type: 'leaf', level: L.id, value: r3(o), unit: 'm leaf overlap', detail: `open leaves of ${doors[i].o.id} and ${doors[j].o.id} overlap`, at: doors[i].hinge.map(r3) });
    }
    const FRONT_DOOR = { wardrobe: 0.5, 'wardrobe-small': 0.45, fridge: 0.6 };
    for (const p of floor) {
      const dep = FRONT_DOOR[p.type];
      if (!dep) continue;
      const zone = rectPoly(p.x + p.f[0] * (p.size[1] / 2 + dep / 2), p.y + p.f[1] * (p.size[1] / 2 + dep / 2), p.u[0], p.u[1], p.size[0] / 2, dep / 2);
      for (const op of doors) {
        const o = overlap(zone, op.sector90);
        if (o > 0.02) add('A3c', { ...rep(p), other: op.o.id, value: r3(o), unit: 'm furniture door x leaf sweep', detail: `${p.type} front doors reach into the sweep of ${op.o.id}` });
      }
    }

    // ---- A4 windows (soft): floor pieces taller than the sill in front of a window
    for (const op of ops.filter((x) => x.o.type === 'window')) for (const p of floor) {
      if (!(p.z1 > op.o.sill + 0.02) || p.z0 >= op.o.sill + op.o.height) continue;
      const o = overlap(p.poly, op.face);
      if (o > 0.02) add('A4', { ...rep(p), other: op.o.id, value: r3(o), unit: 'm in front of window', detail: `${p.type} (h ${p.size[2]}) covers window ${op.o.id} (sill ${op.o.sill})` });
    }

    // ---- stairs: A5 and C
    const stairsHere = model.stairs.filter((s) => s.lower === li || s.upper === li);
    for (const st of stairsHere) {
      const lowL = model.levels[st.lower], upL = model.levels[st.upper];
      const [dx, dy] = st.dir, hw = st.width / 2;
      const delta = upL.elevation - lowL.elevation;
      const riser = delta / st.steps, tread = st.length / Math.max(1, st.steps - 1);
      const L0 = st.length;
      const rect = (s0, s1) => rectPoly(st.from[0] + dx * (s0 + s1) / 2, st.from[1] + dy * (s0 + s1) / 2, dx, dy, (s1 - s0) / 2, hw);
      const foot = rect(-tread / 2, L0 + tread / 2);
      const bottom = rect(-tread / 2 - 0.9, -tread / 2), top = rect(L0 + tread / 2, L0 + tread / 2 + 0.9);
      const here = li === st.lower ? 'bottom' : 'top';
      for (const p of [...floor, ...flat]) {
        const o = overlap(p.poly, foot);
        if (o > 0.01) add('A5', { ...rep(p), other: st.id, value: r3(o), unit: 'm on stair', detail: `${p.type} on stair ${st.id} (${li === st.lower ? 'lower' : 'upper'} level)` });
        const zone = li === st.lower ? bottom : top;
        if (p.kind === 'floor') { const o2 = overlap(p.poly, zone); if (o2 > 0.01) add('A5', { ...rep(p), other: st.id, value: r3(o2), unit: 'm into 0.9 landing', detail: `${p.type} inside 0.9 m landing at the ${here} of ${st.id}` }); }
      }
      if (li === st.lower) { // C metrics once per stair
        const sr = { room: '-', piece: st.id, type: 'stair', level: L.id, at: st.from.map(r3) };
        if (st.width < 0.9 - 1e-6) add('C', { ...sr, value: st.width, unit: 'm width', detail: `stair ${st.id} width ${st.width} < 0.90` });
        if (riser < 0.16 - 1e-6 || riser > 0.19 + 1e-6) add('C', { ...sr, value: r3(riser), unit: 'm riser', detail: `stair ${st.id} riser ${riser.toFixed(3)} (rise ${delta.toFixed(3)} / ${st.steps} risers), allowed 0.16 to 0.19` });
        if (tread < 0.25 - 1e-6) add('C', { ...sr, value: r3(tread), unit: 'm tread', detail: `stair ${st.id} tread ${tread.toFixed(3)} (length ${L0.toFixed(2)} / ${st.steps - 1} treads) < 0.25` });
        const f = 2 * riser + tread;
        if (f < 0.59 - 1e-6 || f > 0.65 + 1e-6) add('C', { ...sr, value: r3(f), unit: 'm 2h+s', detail: `stair ${st.id} 2h+s = ${f.toFixed(3)} outside 0.59 to 0.65` });
        // headroom: where the soffit is lower than 2.0 above a step, the upper slab and the lower ceiling must be open
        const soffit = upL.elevation - upL.slab - lowL.elevation;
        let badFloor = 0, badCeil = 0, first = null;
        const holesOf = (rooms, key) => rooms.flatMap((r) => r[key]);
        const upHoles = holesOf(upL.rooms, 'floorHoles'), lowHoles = holesOf(lowL.rooms, 'ceilingHoles');
        const step = 0.05;
        for (let s = -tread / 2 + step / 2; s < L0 + tread / 2; s += step) {
          const idx = Math.min(st.steps - 1, Math.max(0, Math.round(s / tread)));
          const h = (idx + 1) * riser;
          if (soffit - h >= 2.0) continue;
          for (let v = -hw + step / 2; v < hw; v += step) {
            const pt = [st.from[0] + dx * s - dy * v, st.from[1] + dy * s + dx * v];
            if (upL.rooms.some((r) => pip(pt, r.polygon)) && !upHoles.some((hp) => pip(pt, hp))) { badFloor++; first ??= pt; }
            if (lowL.rooms.some((r) => pip(pt, r.polygon)) && !lowHoles.some((hp) => pip(pt, hp))) badCeil++;
          }
        }
        if (badFloor) add('C', { ...sr, value: r3(badFloor * step * step), unit: 'm2 slab over steps', detail: `stair ${st.id}: ${(badFloor * step * step).toFixed(2)} m2 of the upper slab sits less than 2.0 m above steps (no floor opening there)`, at: first.map(r3) });
        if (badCeil) add('C', { ...sr, value: r3(badCeil * step * step), unit: 'm2 ceiling over steps', detail: `stair ${st.id}: ${(badCeil * step * step).toFixed(2)} m2 of the lower ceiling less than 2.0 m above steps (no ceiling opening)` });
        // landing zones against walls; footprint against walls and leaf sweeps (both levels)
        const wallOn = (levelObj, poly) => {
          let m = 0;
          for (const w of levelObj.walls) {
            const gaps = levelObj.openings.filter((o) => o.wallId === w.id && (o.type === 'door' || o.type === 'passage') && o.sill <= SILL_FREE).map((o) => [o.u0, o.u1]).sort((a, b) => a[0] - b[0]);
            let cur = 0; const spans = [];
            for (const [a, b] of gaps) { if (a > cur + 1e-4) spans.push([cur, a]); cur = Math.max(cur, b); }
            if (cur < w.length - 1e-4) spans.push([cur, w.length]);
            for (const [a, b] of spans) { const hv = w.thickness / 2; m = Math.max(m, overlap(poly, [wallPt(w, a - hv, -hv), wallPt(w, b + hv, -hv), wallPt(w, b + hv, hv), wallPt(w, a - hv, hv)])); }
          }
          return m;
        };
        for (const [lvO, nm, poly] of [[lowL, 'bottom landing', bottom], [upL, 'top landing', top], [lowL, 'footprint (lower level)', foot]]) {
          const m = wallOn(lvO, poly);
          if (m > 0.02) add('C', { ...sr, value: r3(m), unit: 'm into wall', detail: `stair ${st.id} ${nm} overlaps a wall by ${m.toFixed(3)}` });
        }
      }
      for (const op of doors) {
        const o = overlap(op.sector90, foot);
        if (o > 0.02) add('C', { room: op.swingRoom, piece: op.o.id, type: 'door', level: L.id, other: st.id, value: r3(o), unit: 'm leaf sweep on steps', detail: `door ${op.o.id} swings onto stair ${st.id}`, at: op.hinge.map(r3) });
      }
    }

    // ---- B2 clearances in front of pieces (free depth by marching a rectangle until it hits an obstacle)
    const wallPolys = wallRects.map((w) => w.poly);
    const freeDepth = (mk, want, skip) => {
      let d = 0;
      for (; d < want - 1e-9; d += 0.02) {
        const z = mk(Math.min(want, d + 0.02));
        if (wallPolys.some((w) => overlap(z, w) > 0.004) || floor.some((q) => !skip(q) && overlap(z, q.poly) > 0.004)) return r3(d);
      }
      return want;
    };
    const frontZone = (p, dep, off = 0) => rectPoly(p.x + p.f[0] * (p.size[1] / 2 + off + dep / 2), p.y + p.f[1] * (p.size[1] / 2 + off + dep / 2), p.u[0], p.u[1], p.size[0] / 2, dep / 2);
    const roomArea = (p) => area(roomOf.get(p.room)?.polygon ?? [[0, 0], [1, 0], [1, 1]]);
    const funcAccess = new Map();
    for (const p of floor) {
      if (BEDS.includes(p.type)) {
        const sides = [1, -1].map((sg) => (dep) => rectPoly(p.x + p.u[0] * sg * (p.size[0] / 2 + dep / 2), p.y + p.u[1] * sg * (p.size[0] / 2 + dep / 2), p.u[0], p.u[1], dep / 2, p.size[1] / 2));
        const fd = sides.map((mk) => freeDepth(mk, 0.6, (q) => q === p || q.type === 'nightstand'));
        funcAccess.set(p, sides.map((mk) => mk(1.3)));
        const double = p.type !== 'bed-single';
        const ok = double ? (fd[0] >= 0.59 && fd[1] >= 0.59) || (roomArea(p) < 9 && Math.max(...fd) >= 0.59) : Math.max(...fd) >= 0.59;
        if (!ok) add('B2bed', { ...rep(p), value: Math.min(...fd), unit: 'm free beside bed', detail: `${p.type} free beside: ${fd.join(' / ')} m (need 0.60 ${double ? 'both sides' : 'one side'}; room ${roomArea(p).toFixed(1)} m2)` });
        continue;
      }
      if (FUNC.includes(p.type)) funcAccess.set(p, [rectPoly(p.x + p.f[0] * (p.size[1] / 2 + 0.7), p.y + p.f[1] * (p.size[1] / 2 + 0.7), p.u[0], p.u[1], p.size[0] / 2 + 0.3, 0.7)]); // disc centre within 1.4 m of the front
      const req = FRONT_REQ[p.type];
      if (req) {
        const d = freeDepth((x) => frontZone(p, x), req, (q) => q === p);
        if (d < req - 0.01) add('B2', { ...rep(p), value: d, unit: 'm free in front', detail: `${p.type} free front ${d} m, need ${req}` });
      }
      if (p.type === 'desk') {
        const chairs = floor.filter((q) => q.type === 'desk-chair' && q.room === p.room && Math.hypot(q.x - p.x, q.y - p.y) < 1.4);
        let ext = 0;
        for (const c of chairs) for (const v of c.poly) ext = Math.max(ext, (v[0] - p.x) * p.f[0] + (v[1] - p.y) * p.f[1] - p.size[1] / 2);
        const need = ext + 0.8;
        const d = freeDepth((x) => frontZone(p, x), need, (q) => q === p || chairs.includes(q));
        if (d < need - 0.01) add('B2', { ...rep(p), value: r3(d - ext), unit: 'm behind chair', detail: `desk: ${r3(d - ext)} m behind the chair, need 0.80` });
      }
      if (p.type === 'dining-table') {
        const chairs = floor.filter((q) => q.type === 'dining-chair' && q.room === p.room && overlap(q.poly, rectPoly(p.x, p.y, p.u[0], p.u[1], p.size[0] / 2 + 0.5, p.size[1] / 2 + 0.5)) > 0);
        for (const c of chairs) {
          const mk = (x) => rectPoly(c.x - c.f[0] * (c.size[1] / 2 + x / 2), c.y - c.f[1] * (c.size[1] / 2 + x / 2), c.u[0], c.u[1], c.size[0] / 2, x / 2);
          const d = freeDepth(mk, 0.7, (q) => q === c || q === p || q.type === 'dining-chair');
          if (d < 0.69) add('B2', { ...rep(c), other: nameOf(p), value: d, unit: 'm behind chair', detail: `dining chair has ${d} m behind it, need 0.70` });
        }
      }
      if (p.type.startsWith('sofa')) {
        const tbl = floor.filter((q) => q.type.startsWith('coffee-table') && q.room === p.room && ((q.x - p.x) * p.f[0] + (q.y - p.y) * p.f[1]) > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (tbl) {
          let near = Infinity;
          for (const v of tbl.poly) near = Math.min(near, (v[0] - p.x) * p.f[0] + (v[1] - p.y) * p.f[1] - p.size[1] / 2);
          if (near < 0.35 - 1e-6 || near > 0.55 + 1e-6) add('B2', { ...rep(p), other: nameOf(tbl), value: r3(near), unit: 'm sofa to table', detail: `gap sofa to coffee table ${near.toFixed(2)} m (0.35 to 0.55 expected, 0.40 to 0.50 ideal)` });
        }
        const tv = floor.filter((q) => q.type === 'tv-unit' && q.room === p.room && ((q.x - p.x) * p.f[0] + (q.y - p.y) * p.f[1]) > 0 && q.f[0] * p.f[0] + q.f[1] * p.f[1] < -0.7)[0];
        if (tv) {
          let near = Infinity;
          for (const v of tv.poly) near = Math.min(near, (v[0] - p.x) * p.f[0] + (v[1] - p.y) * p.f[1] - p.size[1] / 2);
          if (near < 2.0 - 1e-6 || near > 4.0 + 1e-6) add('B2', { ...rep(p), other: nameOf(tv), value: r3(near), unit: 'm sofa to tv', detail: `sofa to tv unit ${near.toFixed(2)} m (2.0 to 4.0 expected)` });
        }
      }
      if (COUNTERS.includes(p.type)) {
        for (const q of floor) {
          if (q === p || !COUNTERS.includes(q.type) || q.room !== p.room || q.id < p.id) continue;
          if (p.f[0] * q.f[0] + p.f[1] * q.f[1] > -0.9) continue;
          let near = Infinity;
          for (const v of q.poly) near = Math.min(near, (v[0] - p.x) * p.f[0] + (v[1] - p.y) * p.f[1] - p.size[1] / 2);
          const lat = Math.abs((q.x - p.x) * p.u[0] + (q.y - p.y) * p.u[1]);
          if (near > 0 && near < 1.0 - 1e-6 && lat < (p.size[0] + q.size[0]) / 2 - 0.05) add('B2', { ...rep(p), other: nameOf(q), value: r3(near), unit: 'm between counters', detail: `gap between counters ${near.toFixed(2)} m, need 1.00` });
        }
      }
    }

    // ---- B1 and B3 on a grid (cell 0.05, tolerance 0.02 for the cell size)
    const rooms = L.rooms.filter((r) => r.polygon.length >= 3);
    const bb = polyBBox(rooms.flatMap((r) => r.polygon));
    const g = new Grid(bb.x0 - 0.3, bb.y0 - 0.3, bb.x1 + 0.3, bb.y1 + 0.3, 0.05);
    const obs = new Uint8Array(g.n), dom = new Uint8Array(g.n), forced = new Uint8Array(g.n);
    for (const r of rooms) g.fillAny(dom, r.polygon);
    for (const w of wallPolys) g.fillConvex(obs, w);
    for (const p of floor) g.fillConvex(obs, p.poly);
    for (const r of L.rooms) for (const h of r.floorHoles ?? []) g.fillConvex(obs, h);
    for (const st of model.stairs.filter((s) => s.lower === li)) { g.fillConvex(dom, st.footprint); g.fillConvex(forced, st.footprint); for (let k = 0; k < g.n; k++) if (forced[k]) obs[k] = 0; }
    const dist = g.edt(obs);
    const freeMask = (r) => { const m = new Uint8Array(g.n); for (let k = 0; k < g.n; k++) m[k] = dom[k] && !obs[k] && (forced[k] || dist[k] >= r - 0.02) ? 1 : 0; return m; };
    L._audit = { g, dom, forced, freeMask, rooms, ops, floor, funcAccess, nameOf, rep, roomOf };
  });

  // B1: per room
  for (const [li, L] of model.levels.entries()) {
    const A = L._audit, { g } = A;
    for (const room of A.rooms) {
      const hall = /hall|corridor/.test(`${room.use ?? ''}`);
      const r = hall ? 0.45 : 0.4;
      const rm = new Uint8Array(g.n); g.fillAny(rm, room.polygon);
      const base = A.freeMask(r);
      for (let k = 0; k < g.n; k++) base[k] = base[k] && rm[k] ? 1 : 0;
      const doorsHere = A.ops.filter((o) => o.free && L.rooms.some((x) => x === room) && pointNearRoom(o, room));
      const starts = [];
      for (const op of doorsHere) {
        const c = wallCenter(op), side = roomSide(op, room);
        const p0 = [c[0] + op.w.normal[0] * side * (op.w.thickness / 2 + 0.45), c[1] + op.w.normal[1] * side * (op.w.thickness / 2 + 0.45)];
        const cell = nearestFree(g, base, p0, 0.9);
        if (!cell) add('B1', { room: room.id, piece: op.o.id, type: 'door', level: L.id, value: 0, unit: 'no standing room', detail: `no spot for a ${(2 * r).toFixed(2)} m disc near door ${op.o.id} inside ${room.id}`, at: p0.map(r3) });
        else starts.push([op, cell]);
      }
      if (starts.length) {
        const comp = bfs(g, base, starts[0][1]);
        for (const [op, cell] of starts.slice(1)) if (!comp[cell]) add('B1', { room: room.id, piece: `${starts[0][0].o.id}->${op.o.id}`, type: 'door-pair', level: L.id, value: 0, unit: 'no path', detail: `a ${(2 * r).toFixed(2)} m disc cannot pass from door ${starts[0][0].o.id} to door ${op.o.id} inside ${room.id}`, at: g.center(cell % g.nx, Math.floor(cell / g.nx)).map(r3) });
        for (const [p, zones] of A.funcAccess) {
          if (p.room !== room.id) continue;
          const okAny = zones.some((z) => touchesMask(g, comp, z));
          if (!okAny) add('B1', { ...A.rep(p), value: 0, unit: 'no path', detail: `no ${(2 * r).toFixed(2)} m path from the doors of ${room.id} to ${p.type}` });
        }
      }
    }
  }
  // B3: from the entrance through every level
  const entrance = findEntrance(model);
  if (entrance) {
    const R = 0.35, masks = model.levels.map((L) => L._audit.freeMask(R));
    const offs = []; let tot = 0;
    model.levels.forEach((L, i) => { offs.push(tot); tot += L._audit.g.n; });
    const parent = new Int32Array(tot).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    model.levels.forEach((L, i) => {
      const { g } = L._audit, m = masks[i];
      for (let j = 0; j < g.ny; j++) for (let k = 0; k < g.nx; k++) {
        const id = g.idx(k, j); if (!m[id]) continue;
        if (k + 1 < g.nx && m[id + 1]) uni(offs[i] + id, offs[i] + id + 1);
        if (j + 1 < g.ny && m[id + g.nx]) uni(offs[i] + id, offs[i] + id + g.nx);
        if (k + 1 < g.nx && j + 1 < g.ny && m[id + g.nx + 1] && m[id + 1] && m[id + g.nx]) uni(offs[i] + id, offs[i] + id + g.nx + 1);
        if (k > 0 && j + 1 < g.ny && m[id + g.nx - 1] && m[id - 1] && m[id + g.nx]) uni(offs[i] + id, offs[i] + id + g.nx - 1);
      }
    });
    for (const st of model.stairs) {
      const lo = model.levels[st.lower]._audit, up = model.levels[st.upper]._audit, [dx, dy] = st.dir;
      const tread = st.length / Math.max(1, st.steps - 1), hw = st.width / 2;
      const lowCells = [], upCells = [];
      for (let j = 0; j < lo.g.ny; j++) for (let k = 0; k < lo.g.nx; k++) { const id = lo.g.idx(k, j); if (lo.forced[id] && masks[st.lower][id]) lowCells.push(id); }
      const a0 = st.length + tread / 2 + 0.02, a1 = a0 + 0.7;
      for (let j = 0; j < up.g.ny; j++) for (let k = 0; k < up.g.nx; k++) {
        const id = up.g.idx(k, j); if (!masks[st.upper][id]) continue;
        const c = up.g.center(k, j), s = (c[0] - st.from[0]) * dx + (c[1] - st.from[1]) * dy, v = -(c[0] - st.from[0]) * dy + (c[1] - st.from[1]) * dx;
        if (s >= a0 && s <= a1 && Math.abs(v) <= hw) upCells.push(id);
      }
      if (!lowCells.length || !upCells.length) { add('B3', { room: '-', piece: st.id, type: 'stair', level: model.levels[st.upper].id, value: 0, unit: 'no link', detail: `stair ${st.id}: no walkable cell ${!lowCells.length ? 'on the steps' : 'at the top landing'} for a 0.70 m disc`, at: st.to.map(r3) }); continue; }
      for (const c of lowCells) uni(offs[st.lower] + c, offs[st.lower] + lowCells[0]);
      for (const c of upCells) uni(offs[st.upper] + c, offs[st.lower] + lowCells[0]);
    }
    const { L: eL, cell: eCell, door } = entrance;
    const li0 = model.levels.indexOf(eL), start = find(offs[li0] + eCell);
    const inComp = (li, id) => masks[li][id] && find(offs[li] + id) === start;
    model.levels.forEach((L, li) => {
      const { g, rooms: rs, funcAccess, rep } = L._audit;
      for (const room of rs) {
        const rm = new Uint8Array(g.n); g.fillAny(rm, room.polygon);
        let any = false;
        for (let k = 0; k < g.n && !any; k++) if (rm[k] && inComp(li, k)) any = true;
        if (!any) add('B3', { room: room.id, piece: room.id, type: 'room', level: L.id, value: 0, unit: 'unreachable', detail: `room ${room.id} cannot be reached from ${door} by a 0.70 m disc`, at: room.label?.map(r3) });
      }
      for (const [p, zones] of funcAccess) {
        const ok = zones.some((z) => { const m = new Uint8Array(g.n); g.fillConvex(m, z); for (let k = 0; k < g.n; k++) if (m[k] && inComp(li, k)) return true; return false; });
        if (!ok) add('B3', { ...rep(p), value: 0, unit: 'unreachable', detail: `${p.type} cannot be reached from ${door} by a 0.70 m disc` });
      }
    });
  } else V.push({ rule: 'B3', hard: false, room: '-', piece: '-', type: '-', level: '-', detail: 'no entrance door found; B3 skipped' });
  if (!extra.skipRules2) V.push(...auditRules2(model, layout, specs, extra));
  if (process.env.AUDIT_DEBUG) globalThis.__auditDebug = model.levels.map((L) => L._audit);
  for (const L of model.levels) delete L._audit;
  return { violations: V, stats };

  function pointNearRoom(op, room) {
    const c = wallCenter(op);
    return [-1, 1].some((s) => pip([c[0] + op.w.normal[0] * s * 0.3, c[1] + op.w.normal[1] * s * 0.3], room.polygon));
  }
  function roomSide(op, room) {
    const c = wallCenter(op);
    return [-1, 1].find((s) => pip([c[0] + op.w.normal[0] * s * 0.3, c[1] + op.w.normal[1] * s * 0.3], room.polygon)) ?? 1;
  }
  function wallCenter(op) { const u = (op.o.u0 + op.o.u1) / 2; return [op.w.from[0] + op.w.dir[0] * u, op.w.from[1] + op.w.dir[1] * u]; }
  function findEntrance(m) {
    const L = m.levels[0];
    if (!L) return null;
    const cand = L._audit.ops.filter((o) => o.free && o.o.type === 'door');
    const pick = cand.find((o) => o.o.id === 'front') ?? cand.find((o) => o.w.kind === 'exterior') ?? cand[0] ?? L._audit.ops.find((o) => o.free);
    if (!pick) return null;
    const mask = L._audit.freeMask(0.35), c = wallCenter(pick);
    for (const s of [1, -1]) {
      const inside = L.rooms.some((r) => pip([c[0] + pick.w.normal[0] * s * 0.3, c[1] + pick.w.normal[1] * s * 0.3], r.polygon));
      if (!inside) continue;
      const p0 = [c[0] + pick.w.normal[0] * s * (pick.w.thickness / 2 + 0.45), c[1] + pick.w.normal[1] * s * (pick.w.thickness / 2 + 0.45)];
      const cell = nearestFree(L._audit.g, mask, p0, 1.0);
      if (cell) return { L, cell, door: pick.o.id };
      add('B3', { room: '-', piece: pick.o.id, type: 'door', level: L.id, value: 0, unit: 'blocked', detail: `no 0.70 m spot inside the entrance ${pick.o.id}`, at: p0.map(r3) });
    }
    return null;
  }
}

function nearestFree(g, mask, p, maxD) {
  const [ci, cj] = g.cellOf(p[0], p[1]);
  const R = Math.ceil(maxD / g.cell);
  let best = -1, bd = Infinity;
  for (let j = Math.max(0, cj - R); j <= Math.min(g.ny - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(g.nx - 1, ci + R); i++) {
    const id = g.idx(i, j);
    if (!mask[id]) continue;
    const d = Math.hypot(i - ci, j - cj) * g.cell;
    if (d < bd && d <= maxD) { bd = d; best = id; }
  }
  return best < 0 ? null : best;
}
function bfs(g, mask, start) {
  const seen = new Uint8Array(g.n), q = [start]; seen[start] = 1;
  for (let h = 0; h < q.length; h++) {
    const id = q[h], i = id % g.nx, j = (id - i) / g.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.ny) continue;
      const nid = g.idx(ni, nj);
      if (!mask[nid] || seen[nid]) continue;
      if (di && dj && !(mask[g.idx(i + di, j)] && mask[g.idx(i, j + dj)])) continue;
      seen[nid] = 1; q.push(nid);
    }
  }
  return seen;
}
function touchesMask(g, comp, poly) {
  const m = new Uint8Array(g.n); g.fillConvex(m, poly);
  for (let k = 0; k < g.n; k++) if (m[k] && comp[k]) return true;
  return false;
}
