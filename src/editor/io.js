// Saving and loading a layout as text. serializeLayout gives stable JSON (fixed key order, one piece per line); parseLayout turns text
// back into a layout and checks everything: limits, known types, finite numbers, sizes inside their ranges, colours, unique ids,
// supports without cycles, pieces inside the plan. Text only: nothing here touches the network, files or browser storage.
import { specOf } from '../furniture/specs.js';
import { LIMITS } from '../layout/engine.js';
import { roomInterior, boxInsidePolygon, obb, pointInPolygon } from '../layout/geometry.js';
import { sizeFrom, validRoomId, ROOM_PARTS, ROOM_LIMIT } from './state.js';
import { readColor, cleanColor, cleanRoomColor } from './colors.js';
import { normRot } from './rules.js';

export const IO_LIMITS = Object.freeze({ chars: 2000000, levels: 20, warnings: 60 });
const ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const r3 = (v) => Math.round(v * 1000) / 1000;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function canonPiece(p) {
  if (![p.x, p.y, p.rot, p.elev, ...p.size].every(fin)) throw new Error('a number is not finite');
  const colors = {};
  for (const k of Object.keys(p.colors ?? {}).sort()) { const c = cleanColor(p.colors[k]); if (c) colors[k] = c; } // always the full form
  return { id: p.id, type: p.type, room: p.room, x: r3(p.x), y: r3(p.y), rot: r3(p.rot), size: p.size.map(r3), elev: r3(p.elev), on: p.on ?? null, colors };
}

// Room colours of a level as [[roomId, { wall?, floor? }], ...] sorted by id; empty entries and invalid values are left out.
function canonRooms(rooms) {
  if (!isObj(rooms)) return [];
  const out = [];
  for (const id of Object.keys(rooms).sort()) {
    const src = rooms[id];
    if (!validRoomId(id) || !isObj(src)) continue;
    const entry = {};
    for (const part of ROOM_PARTS) { const c = Object.prototype.hasOwnProperty.call(src, part) ? cleanRoomColor(src[part]) : null; if (c) entry[part] = c; }
    if (Object.keys(entry).length) out.push([id, entry]);
  }
  return out.slice(0, ROOM_LIMIT);
}

// Text for a layout, or null when the layout is not a layout or holds a number that is not finite (it could not be read back).
// Same layout, same text (key order is fixed, colour slots and rooms sorted; levels without room colours have no "rooms" key).
export function serializeLayout(layout) {
  try {
    if (!isObj(layout) || !Array.isArray(layout.levels)) return null;
    const lines = ['{', '  "version": 1,', `  "seed": ${JSON.stringify(fin(layout.seed) ? layout.seed : 1)},`, '  "levels": ['];
    layout.levels.forEach((lv, i) => {
      lines.push('    {', `      "id": ${JSON.stringify(lv.id)},`);
      const rooms = canonRooms(lv.rooms), tail = rooms.length ? ',' : '';
      if (!lv.pieces.length) lines.push(`      "pieces": []${tail}`);
      else {
        lines.push('      "pieces": [');
        lv.pieces.forEach((p, j) => lines.push(`        ${JSON.stringify(canonPiece(p))}${j < lv.pieces.length - 1 ? ',' : ''}`));
        lines.push(`      ]${tail}`);
      }
      if (rooms.length) {
        lines.push('      "rooms": {');
        rooms.forEach(([id, entry], j) => lines.push(`        ${JSON.stringify(id)}: ${JSON.stringify(entry)}${j < rooms.length - 1 ? ',' : ''}`));
        lines.push('      }');
      }
      lines.push(i < layout.levels.length - 1 ? '    },' : '    }');
    });
    lines.push('  ]', '}');
    return `${lines.join('\n')}\n`;
  } catch { return null; }
}

// parseLayout(text, model?, { strict? }) -> { ok, layout, errors, warnings }
// errors make the file unusable (ok false, layout null). warnings list what was repaired or left out (a size clamped to its range,
// an unknown type, a piece outside the plan); with `strict` any warning counts as an error. With a model, levels and rooms must
// exist in the plan and the layout gets one level per plan level.
export function parseLayout(text, model = null, opts = {}) {
  const errors = [], warnings = [];
  let more = 0;
  const warn = (m) => { if (warnings.length < IO_LIMITS.warnings) warnings.push(m); else more++; };
  const done = (layout) => {
    if (more) warnings[IO_LIMITS.warnings - 1] = `${more + 1} more warnings left out.`; // the list never grows past the limit
    const strict = isObj(opts) && opts.strict === true;
    const ok = errors.length === 0 && !(strict && warnings.length > 0);
    return { ok, layout: ok ? layout : null, errors: strict && errors.length === 0 ? warnings.slice() : errors, warnings };
  };
  const stop = (m) => { errors.push(m); return done(null); };
  try {
    if (typeof text !== 'string') return stop('The layout must be text.');
    if (text.length > IO_LIMITS.chars) return stop('The layout text is larger than 2 MB.');
    let data;
    try { data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return stop('The text is not valid JSON.'); }
    if (!isObj(data)) return stop('The layout must be a JSON object.');
    if (data.version !== 1) return stop('Only layout version 1 can be loaded.');
    if (!Array.isArray(data.levels)) return stop('The layout has no list of levels.');
    if (data.levels.length > IO_LIMITS.levels) return stop(`The layout has more than ${IO_LIMITS.levels} levels.`);
    let seed = 1;
    if (data.seed !== undefined) { if (fin(data.seed) && Math.abs(data.seed) <= 2147483647) seed = Math.floor(data.seed); else warn('The seed is not a usable number: 1 is used.'); }
    let total = 0;
    for (const lv of data.levels) {
      if (isObj(lv) && Array.isArray(lv.pieces)) {
        if (lv.pieces.length > LIMITS.perLevel) return stop(`A level holds more than ${LIMITS.perLevel} pieces.`);
        total += lv.pieces.length;
      }
    }
    if (total > LIMITS.total) return stop(`The layout holds more than ${LIMITS.total} pieces.`);

    const mlevels = model && Array.isArray(model.levels) ? model.levels : null;
    const seenLevel = new Set(), seenId = new Set();
    const levels = [];
    for (const lv of data.levels) {
      if (!isObj(lv) || typeof lv.id !== 'string' || !ID_RE.test(lv.id) || !Array.isArray(lv.pieces)) { warn('A level without a valid id or list of pieces was skipped.'); continue; }
      if (seenLevel.has(lv.id)) { warn(`Level ${lv.id} appears twice: the second one was skipped.`); continue; }
      seenLevel.add(lv.id);
      const ml = mlevels ? mlevels.find((l) => l && l.id === lv.id) : null;
      if (mlevels && !ml) { warn(`Level ${lv.id} is not in the plan: its ${lv.pieces.length} pieces were skipped.`); continue; }
      const level = { id: lv.id, pieces: readPieces(lv, ml, seenId, warn) };
      const rooms = readRooms(lv, ml, warn);
      if (rooms) level.rooms = rooms;
      levels.push(level);
    }
    if (mlevels) {
      const byId = new Map(levels.map((l) => [l.id, l]));
      const ordered = [];
      for (const ml of mlevels.slice(0, IO_LIMITS.levels)) {
        const got = byId.get(ml.id);
        if (!got) warn(`Level ${ml.id} is missing in the text: it stays empty.`);
        ordered.push(got ?? { id: ml.id, pieces: [] });
      }
      levels.length = 0; levels.push(...ordered);
    }
    return done({ version: 1, seed, levels });
  } catch {
    return stop('The layout could not be read.');
  }
}

// levels[].rooms: only the known parts, valid colours and (with a model) rooms of the plan; at most ROOM_LIMIT rooms. Or null.
function readRooms(lv, mlevel, warn) {
  if (lv.rooms === undefined || lv.rooms === null) return null;
  if (!isObj(lv.rooms)) { warn(`Level ${lv.id}: the room colours are not a list and were ignored.`); return null; }
  const known = mlevel ? new Set((mlevel.rooms ?? []).slice(0, 400).map((r) => r && r.id)) : null;
  const keys = Object.keys(lv.rooms);
  if (keys.length > ROOM_LIMIT) warn(`Level ${lv.id} has colours for more than ${ROOM_LIMIT} rooms: the rest were left out.`);
  const out = {};
  for (const id of keys.slice(0, ROOM_LIMIT)) {
    if (!validRoomId(id)) { warn(`Room colours for "${id.slice(0, 30)}" were skipped: not a valid room id.`); continue; }
    if (known && !known.has(id)) { warn(`Room ${id} is not on level ${lv.id} of the plan: its colours were skipped.`); continue; }
    const src = lv.rooms[id];
    if (!isObj(src)) { warn(`Room ${id}: the colours are not a list and were ignored.`); continue; }
    const got = {};
    for (const k of Object.keys(src).slice(0, 20)) {
      if (!ROOM_PARTS.includes(k)) { warn(`Room ${id}: "${k.slice(0, 30)}" is not a colour of a room (use wall or floor).`); continue; }
      const c = readColor(src[k], 'room');
      if (!c) { warn(`Room ${id}: the ${k} colour is not valid and was left out.`); continue; }
      if (c.bare) warn(`Room ${id}: the ${k} colour "${String(src[k]).slice(0, 30)}" is now written ${c.value}.`);
      got[k] = c.value;
    }
    const entry = {};
    for (const part of ROOM_PARTS) if (got[part]) entry[part] = got[part];
    if (Object.keys(entry).length) out[id] = entry;
  }
  return Object.keys(out).length ? out : null;
}

function readPieces(lv, mlevel, seenId, warn) {
  const cands = [];
  const rooms = new Map();
  const interior = (id) => {
    if (rooms.has(id)) return rooms.get(id);
    const room = (mlevel.rooms ?? []).find((r) => r.id === id);
    let ip = null;
    if (room) { try { ip = roomInterior(mlevel, room); } catch { ip = null; } }
    rooms.set(id, ip);
    return ip;
  };
  lv.pieces.forEach((p, i) => {
    const tag = isObj(p) && typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : `#${i + 1} on ${lv.id}`;
    if (!isObj(p)) return warn(`Piece ${tag} is not an object: skipped.`);
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return warn(`Piece ${tag} has no valid id: skipped.`);
    if (seenId.has(p.id)) return warn(`Piece ${p.id} has an id that is already used: skipped.`);
    const spec = specOf(p.type);
    if (!spec) return warn(`Piece ${p.id} has an unknown type: skipped.`);
    if (!fin(p.x) || !fin(p.y) || Math.abs(p.x) > 1000 || Math.abs(p.y) > 1000) return warn(`Piece ${p.id} has a position that is not a usable number: skipped.`);
    if (p.rot !== undefined && !fin(p.rot)) return warn(`Piece ${p.id} has an angle that is not a number: skipped.`);
    if (typeof p.room !== 'string' || p.room.length < 1 || p.room.length > 60) return warn(`Piece ${p.id} has no valid room: skipped.`);
    if (p.on !== undefined && p.on !== null && (typeof p.on !== 'string' || !ID_RE.test(p.on))) return warn(`Piece ${p.id} has an invalid support: skipped.`);
    let size = spec.size;
    if (p.size !== undefined) {
      if (!Array.isArray(p.size) || p.size.length !== 3 || !p.size.every(fin)) return warn(`Piece ${p.id} has an invalid size: skipped.`);
      const sz = sizeFrom(spec, p.size, p.size);
      // an axis without a range is fixed at the spec size
      size = sz.size.map((v, k) => (spec.range[['w', 'd', 'h'][k]] ? v : spec.size[k]));
      if (size.some((v, k) => Math.abs(v - p.size[k]) > 1e-4)) warn(`Piece ${p.id}: the size was moved into the range of ${spec.id}.`);
    }
    let elev = p.elev === undefined ? (spec.place.mode === 'wall-mount' ? (spec.place.elevation ?? 0) : 0) : p.elev;
    if (!fin(elev)) return warn(`Piece ${p.id} has a height above the floor that is not a number: skipped.`);
    const maxElev = mlevel?.height ?? 10;
    if (elev < 0 || elev > maxElev) { warn(`Piece ${p.id}: the height above the floor was moved into 0 to ${maxElev} m.`); elev = Math.min(maxElev, Math.max(0, elev)); }
    const colors = {};
    if (p.colors !== undefined && p.colors !== null) {
      if (!isObj(p.colors)) warn(`Piece ${p.id}: the colours are not a list and were ignored.`);
      else for (const k of Object.keys(p.colors).slice(0, 40)) {
        if (!spec.slots.includes(k)) { warn(`Piece ${p.id}: ${spec.id} has no colour slot "${String(k).slice(0, 30)}".`); continue; }
        const c = readColor(p.colors[k], 'piece');
        if (!c) { warn(`Piece ${p.id}: the colour of ${k} is not valid and was left out.`); continue; }
        if (c.bare) warn(`Piece ${p.id}: the colour of ${k} "${String(p.colors[k]).slice(0, 30)}" is now written ${c.value}.`);
        colors[k] = c.value;
      }
    }
    const piece = { id: p.id, type: spec.id, room: p.room, x: r3(p.x), y: r3(p.y), rot: normRot(p.rot ?? 0), size: size.map(r3), elev: r3(elev), on: p.on ?? null, colors };
    if (mlevel) {
      const ip = interior(piece.room);
      if (!ip) return warn(`Piece ${p.id} is in room "${piece.room.slice(0, 30)}", which is not on this level of the plan: skipped.`);
      if (!pointInPolygon([piece.x, piece.y], ip.poly)) return warn(`Piece ${p.id} lies outside its room in the plan: skipped.`);
      if (!boxInsidePolygon(obb(piece.x, piece.y, piece.size[0], piece.size[1], piece.rot), ip.poly)) warn(`Piece ${p.id} sticks out of its room.`);
    }
    seenId.add(piece.id);
    cands.push(piece);
  });
  // supports: the piece below must exist, accept this type and not lead back to the piece itself
  const byId = new Map(cands.map((c) => [c.id, c]));
  const bad = new Set();
  for (const c of cands) {
    let cur = c, steps = 0;
    const visited = new Set([c.id]);
    while (cur.on) {
      const par = byId.get(cur.on);
      if (!par) { warn(`Piece ${c.id} stands on ${cur.on}, which is not there: skipped.`); bad.add(c.id); break; }
      if (visited.has(par.id) || ++steps > 100) { warn(`Piece ${c.id} is part of a loop of supports: skipped.`); bad.add(c.id); break; }
      if (!specOf(cur.type).place.onTop?.includes(par.type)) { warn(`Piece ${cur.id} cannot stand on ${par.type}: ${c.id} skipped.`); bad.add(c.id); break; }
      visited.add(par.id);
      cur = par;
    }
  }
  const kept = cands.filter((c) => !bad.has(c.id));
  for (const c of cands) if (bad.has(c.id)) seenId.delete(c.id);
  const keptById = new Map(kept.map((c) => [c.id, c]));
  // heights of props follow their support (parents first: the chain is acyclic here)
  const fixed = new Map();
  const heightOf = (c, depth = 0) => {
    if (!c.on || depth > 100) return c.elev;
    if (fixed.has(c.id)) return fixed.get(c.id);
    const par = keptById.get(c.on);
    const want = r3(heightOf(par, depth + 1) + par.size[2]);
    if (Math.abs(c.elev - want) > 0.02) warn(`Piece ${c.id}: the height was moved onto ${par.id}.`);
    fixed.set(c.id, Math.abs(c.elev - want) > 0.02 ? want : c.elev);
    return fixed.get(c.id);
  };
  return kept.map((c) => (c.on ? { ...c, elev: heightOf(c) } : c));
}
