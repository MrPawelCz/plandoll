// The share link: the layout of the page (and a plan of the visitor's own) packed into the address, so that one link carries it to someone else.
// It all goes in the part of the address after the #, which a browser never sends to a server: nothing is stored or uploaded anywhere.
//   share=z1.<text>   the JSON { v: 1, plan?, layout } deflated (the browser's CompressionStream, 'deflate-raw') and written in base64url
//   share=u1.<text>   the same JSON not deflated (a browser without CompressionStream makes this one; it is longer but opens everywhere)
// Pure functions, no DOM: encodeShare and decodeShare are asynchronous because the stream API is, the rest is synchronous. Tested in Node.
// A link comes from a stranger, so it is read with care: the text of the link and the unpacked text have a size limit (a small deflated text that
// unpacks to a huge one is stopped while it unpacks), and what comes out is checked afterwards by the same readers as a loaded file (readPlanText, parseLayout).
import { specOf } from '../furniture/specs.js';
import { MAX_PLAN_CHARS } from '../core/limits.js';
import { isPreset } from '../look/presets.js';
import { splitHash, PLAN_NAMES, ALL, parseFloorParam } from './params.js';

export const SHARE_KEY = 'share';
export const SHARE_VERSION = 1;
export const SHARE_MAX_VALUE = 400000; // the longest value of share= that is read, in characters (a plan and a layout at their largest deflate to far less)
export const SHARE_MAX_TEXT = 2 * MAX_PLAN_CHARS + 65536; // the longest text that a link may unpack to: a plan and a layout, each up to the file limit
export const SHARE_LONG = 4000; // a link longer than this gets a word of warning: some messengers cut or refuse such a text (some chat apps take only 2000 characters per message)

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Whether a parsed JSON value nests deeper than `limit` levels. Iterative on purpose: JSON.parse copes with a text nested a million levels deep, but anything recursive that
// then walks the object (JSON.stringify, the validator) would run out of stack, and a link of 150 characters can hold such a text. A plan or a layout is about six levels deep.
export const MAX_DEPTH = 40;
function tooDeep(root, limit = MAX_DEPTH) {
  const stack = [root, 1];
  while (stack.length) {
    const depth = stack.pop(), value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (depth > limit) return true;
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) stack.push(value[i], depth + 1);
    else for (const k of Object.keys(value)) stack.push(value[k], depth + 1);
  }
  return false;
}

// ---------- base64url ----------
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Bytes of a base64url text; throws on anything that is not base64url.
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('not base64url');
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Runs bytes through a (De)CompressionStream and gathers the result; more than `cap` bytes out stops it (the error has tooLarge set).
async function pump(bytes, stream, cap = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {}); // a stream that breaks says so through the reader
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      try { await reader.cancel(); } catch { /* it is stopped either way */ }
      const e = new Error('the unpacked text is too large'); e.tooLarge = true; throw e;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---------- what goes in the link ----------
// The text of a layout (editor/io.js serializeLayout) as a shorter object that parseLayout reads back to the same layout: what a reader fills in by itself is
// left out (a size that is the size of the type, a height that is the one the type has, no turn, no support, no colours, the seed 1).
export function packLayout(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!isObj(d) || d.version !== 1 || !Array.isArray(d.levels)) return null;
  const out = { version: 1 };
  if (d.seed !== undefined && d.seed !== 1) out.seed = d.seed;
  out.levels = d.levels.map((lv) => {
    const level = { id: lv.id, pieces: (Array.isArray(lv.pieces) ? lv.pieces : []).map(packPiece) };
    if (isObj(lv.rooms) && Object.keys(lv.rooms).length) level.rooms = lv.rooms;
    return level;
  });
  return out;
}
function packPiece(p) {
  const spec = specOf(p.type);
  const out = { id: p.id, type: p.type, room: p.room, x: p.x, y: p.y };
  if (p.rot) out.rot = p.rot;
  if (!spec || !Array.isArray(p.size) || p.size.some((v, k) => !(Math.abs(v - spec.size[k]) <= 1e-4))) out.size = p.size;
  const base = spec && spec.place?.mode === 'wall-mount' ? (spec.place.elevation ?? 0) : 0; // the height that a reader gives a piece without one
  if (!(Math.abs(p.elev - base) <= 1e-4)) out.elev = p.elev;
  if (p.on) out.on = p.on;
  if (isObj(p.colors) && Object.keys(p.colors).length) out.colors = p.colors;
  return out;
}

// A plan as it came out of the validator (normalized: metres, with derived fields) back in the form that the validator reads, without the fields it works out itself and with
// the numbers rounded to a tenth of a millimetre: this is what goes in a link for a plan of the visitor's own. Null for something that is not a plan.
export function planForLink(plan) {
  if (!isObj(plan) || !Array.isArray(plan.levels)) return null;
  const num = (v) => (fin(v) ? (v > 0 ? Math.max(1e-4, r4(v)) : r4(v)) : v); // a tiny positive value (a thickness, a width) must not become 0, which the validator refuses
  const pt = (p) => (Array.isArray(p) ? p.map(num) : p);
  const out = { version: plan.version ?? 1, units: 'm' };
  if (plan.name) out.name = plan.name;
  out.levels = plan.levels.map((lv) => ({
    id: lv.id, name: lv.name, elevation: num(lv.elevation), height: num(lv.height), slab: num(lv.slab),
    walls: (lv.walls ?? []).map((w) => ({ id: w.id, kind: w.kind, from: pt(w.from), to: pt(w.to), thickness: num(w.thickness), height: num(w.height) })),
    openings: (lv.openings ?? []).map((o) => ({ id: o.id, wall: o.wall, type: o.type, offset: num(o.offset), width: num(o.width), height: num(o.height), sill: num(o.sill), hinge: o.hinge, opens_to: o.opens_to })),
    rooms: (lv.rooms ?? []).map((r) => {
      const room = { id: r.id, name: r.name, use: r.use, floor: r.floor, ceiling: r.ceiling, polygon: (r.polygon ?? []).map(pt) };
      if (fin(r.declaredArea)) room.area = num(r.declaredArea);
      return room;
    }),
    stairs: (lv.stairs ?? []).map((s) => ({ id: s.id, from: pt(s.from), to: pt(s.to), width: num(s.width), steps: s.steps, to_level: s.to_level, rise: num(s.rise) })),
  }));
  return out;
}

// How many of the warnings of parseLayout are about something that was not taken (a piece, a level or a colour that was skipped or left out). A piece that only sticks out
// of its room is kept, a size moved into its range is repaired: neither is a loss, so neither is counted.
export const lostCount = (warnings) => (Array.isArray(warnings) ? warnings.filter((w) => /skipped|left out/.test(String(w))).length : 0);

// ---------- the value of share= ----------
// { plan?: object, layout: object } -> { ok: true, value, compressed, chars } | { ok: false, error: 'empty' | 'too-long' }. `env` supplies CompressionStream (tests pass their own).
export async function encodeShare({ plan = null, layout = null } = {}, env = globalThis) {
  if (!isObj(layout) && !isObj(plan)) return { ok: false, error: 'empty' };
  const body = { v: SHARE_VERSION };
  if (isObj(plan)) body.plan = plan;
  if (isObj(layout)) body.layout = layout;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let value = null, compressed = false;
  if (typeof env.CompressionStream === 'function') {
    try { value = `z1.${toBase64Url(await pump(bytes, new env.CompressionStream('deflate-raw')))}`; compressed = true; } catch { value = null; }
  }
  if (value === null) value = `u1.${toBase64Url(bytes)}`;
  if (value.length > SHARE_MAX_VALUE) return { ok: false, error: 'too-long' };
  return { ok: true, value, compressed, chars: value.length };
}

// The value of share= -> { ok: true, plan: object | null, layout: object | null } or { ok: false, error } with error one of
// 'empty' | 'too-long' | 'format' (not a share value) | 'too-large' (unpacks to too much) | 'broken' (the text inside is damaged) | 'version' | 'unsupported' (no DecompressionStream here).
// The plan and the layout are only objects here: the caller reads them with readPlanText and parseLayout.
export async function decodeShare(value, env = globalThis) {
  const fail = (error) => ({ ok: false, error });
  if (typeof value !== 'string' || value === '') return fail('empty');
  if (value.length > SHARE_MAX_VALUE) return fail('too-long');
  const dot = value.indexOf('.'), tag = dot < 0 ? '' : value.slice(0, dot);
  if (tag !== 'z1' && tag !== 'u1') return fail('format');
  let bytes;
  try { bytes = fromBase64Url(value.slice(dot + 1)); } catch { return fail('format'); }
  if (tag === 'z1') {
    if (typeof env.DecompressionStream !== 'function') return fail('unsupported');
    let stream;
    try { stream = new env.DecompressionStream('deflate-raw'); } catch { return fail('unsupported'); } // a browser that has the stream but not this format
    try { bytes = await pump(bytes, stream, SHARE_MAX_TEXT); } catch (e) { return fail(e?.tooLarge ? 'too-large' : 'broken'); }
  } else if (bytes.length > SHARE_MAX_TEXT) return fail('too-large');
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('broken'); }
  if (!isObj(body)) return fail('broken');
  if (body.v !== SHARE_VERSION) return fail('version');
  if (tooDeep(body)) return fail('broken');
  const plan = isObj(body.plan) ? body.plan : null, layout = isObj(body.layout) ? body.layout : null;
  if (!plan && !layout) return fail('empty');
  return { ok: true, plan, layout };
}

// ---------- the address ----------
// The hash with share= (the value of the link) and the view of the page set: view = { preset, t, az, pol, floor, plan, seed }. Every other parameter of `base` stays
// (base '' gives a clean link: only these). The floors on show, the example plan and the seed go in only when they differ from the defaults.
export function setViewParams(base, view = {}, value = null) {
  const { bare, kv } = splitHash(base);
  const rest = { ...kv };
  for (const k of ['preset', 't', 'az', 'pol', 'floor', 'plan', 'seed', SHARE_KEY]) delete rest[k];
  const set = {};
  if (isPreset(view.preset)) set.preset = view.preset;
  if (fin(view.t)) set.t = Math.min(1, Math.max(0, view.t)).toFixed(3);
  if (fin(view.az)) set.az = String(+view.az.toFixed(2)); // two decimals: a whole degree would open the view up to half a degree off, a few pixels at the edges of the furniture
  if (fin(view.pol)) set.pol = String(+view.pol.toFixed(2));
  const floor = parseFloorParam(String(view.floor ?? ALL));
  if (floor !== ALL) set.floor = String(floor);
  if (PLAN_NAMES.includes(view.plan) && view.plan !== 'flat-1') set.plan = view.plan;
  if (fin(view.seed) && Math.floor(view.seed) !== 1) set.seed = String(Math.floor(view.seed));
  const parts = bare.filter((b) => !isPreset(b)).map(encodeURIComponent);
  for (const [k, v] of Object.entries({ ...set, ...rest })) parts.push(`${k}=${encodeURIComponent(v)}`);
  if (typeof value === 'string' && value) parts.push(`${SHARE_KEY}=${encodeURIComponent(value)}`); // the long part comes last, so the readable ones stay in view
  return parts.join('&');
}
