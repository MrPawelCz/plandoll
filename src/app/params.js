// Page parameters from the address hash: #preset&t=0.7&q=high&cam=close&az=90&pol=45&plan=flat-1&floor=all&frames=3&lang=pl&ui=0&live=1&edit=1
// floor=0|1|...|all picks the floors on show for a plan with two or more levels (index from 0, the lowest; all is the default, a wrong value counts as all).
// edit=1 turns the layout editor on (off by default); the pieces stay merged except the one being dragged (merge=0 turns the merging off).
// The control bar carries the extra buttons (the example plans, the open shell, edit mode, saving the picture, loading a plan); btn=0 hides that row.
// The button that opens the shell (the outer walls fall outward and lie flat) is on by default and the view is framed for both positions; shell=0 takes
// the button away and frames the closed model alone. The shell works while editing too (its button is the same with edit=1).
// share=<text> is the layout (and a plan of your own) of a share link, see share.js; the page takes it with it when it opens.
// rooms=1 opens the list of rooms (with their areas) when the page opens; the Rooms button of the control bar opens and closes it (dock.js).
// A bare word is the preset name (so "#amber" works). Pure functions, no DOM: tested in Node.
import { isPreset, getPreset, DEFAULT_PRESET } from '../look/presets.js';
import { parseQualityParam } from '../look/quality.js';

export const PLAN_NAMES = Object.freeze(['flat-1', 'duplex-1']);

// The floors on show (see floors.js): 'all' or the index of one level, written floor=0, floor=1, ... in the address.
export const ALL = 'all';
export const MAX_FLOOR_PARAM = 99; // the largest index that the address may name; a plan has at most 20 levels anyway
// The address value: 'all' or a whole number from 0 up. Anything else (empty, negative, a fraction, text, a number past the limit) is 'all'.
export function parseFloorParam(value) {
  const v = String(value ?? '').trim();
  if (!/^\d{1,2}$/.test(v)) return ALL;
  const n = Number(v);
  return n <= MAX_FLOOR_PARAM ? n : ALL;
}

// A broken percent sequence (#t=%) keeps its raw text instead of stopping the page.
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function splitHash(hash) {
  const out = { bare: [], kv: {} };
  for (const part of String(hash ?? '').replace(/^#/, '').split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i < 0) out.bare.push(decode(part)); else out.kv[part.slice(0, i)] = decode(part.slice(i + 1));
  }
  return out;
}

// 'flat-1' | 'duplex-1' | 'gen:<seed>' | 'ext' (a plan injected by a test tool as window.__plan). Anything else is flat-1.
export function parsePlanParam(value) {
  const v = String(value ?? '').trim();
  if (PLAN_NAMES.includes(v) || v === 'ext') return { kind: v === 'ext' ? 'ext' : 'example', name: v };
  const m = /^gen:(\d{1,9})$/.exec(v);
  if (m) return { kind: 'gen', name: v, seed: Number(m[1]) };
  return { kind: 'example', name: 'flat-1' };
}

export function parseParams(hash, env = {}) {
  const { bare, kv } = splitHash(hash);
  const presetName = isPreset(kv.preset) ? kv.preset : (bare.find(isPreset) ?? DEFAULT_PRESET);
  const preset = getPreset(presetName);
  const tRaw = kv.t !== undefined && kv.t !== '' ? Number(kv.t) : NaN;
  const t = Number.isFinite(tRaw) ? Math.min(1, Math.max(0, tRaw)) : preset.t;
  const frames = Math.min(60, Math.max(1, Math.floor(Number(kv.frames)) || 4));
  const seedRaw = Math.floor(Number(kv.seed)), seed = Number.isFinite(seedRaw) ? Math.min(999999, Math.max(1, seedRaw)) : 1;
  const lang = kv.lang === 'pl' || kv.lang === 'en' ? kv.lang : (/^pl/i.test(env.language ?? '') ? 'pl' : 'en');
  const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  // az (degrees round the model, 0 = from the south, 90 = from the east) and pol (degrees from the vertical) set the view the page opens with
  // floor: the floors on show, 'all' or the index of one level (a plan with fewer levels than that shows all of them)
  // share: the text of a share link (share.js unpacks it; null when there is none)
  return { preset: presetName, t, q: parseQualityParam(kv.q), cam: kv.cam === 'close' ? 'close' : 'main', plan: parsePlanParam(kv.plan), frames, lang, ui: kv.ui !== '0', live: kv.live === '1', tmSet: kv.t !== undefined, seed, merge: kv.merge !== '0', edit: kv.edit === '1', btn: kv.btn !== '0', shell: kv.shell !== '0', az: num(kv.az), pol: num(kv.pol), floor: parseFloorParam(kv.floor), share: kv.share ? kv.share : null, rooms: kv.rooms === '1' };
}

// Hash string for a parameter object (inverse of parseParams for the fields the page changes).
export function buildHash(p) {
  const parts = [`preset=${p.preset}`, `t=${(+p.t).toFixed(3)}`];
  if (p.q && p.q !== 'auto') parts.push(`q=${p.q}`);
  if (p.cam === 'close') parts.push('cam=close');
  if (p.plan?.name && p.plan.name !== 'flat-1') parts.push(`plan=${p.plan.name}`);
  if (p.seed && p.seed !== 1) parts.push(`seed=${p.seed}`);
  if (p.lang) parts.push(`lang=${p.lang}`);
  if (p.edit) parts.push('edit=1');
  if (p.floor !== undefined && parseFloorParam(String(p.floor)) !== ALL) parts.push(`floor=${parseFloorParam(String(p.floor))}`);
  return parts.join('&');
}

// The address hash with floor= set to the choice ('all' takes it out, since it is the default), every other parameter as it was.
export function floorHash(hash, sel) {
  const { bare, kv } = splitHash(hash);
  const out = { ...kv };
  delete out.floor;
  const pick = parseFloorParam(String(sel));
  if (pick !== ALL) out.floor = String(pick);
  const parts = bare.map(encodeURIComponent);
  for (const [k, v] of Object.entries(out)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.join('&');
}

// The address hash without share= (the layout of a share link), every other parameter as it was: used when the page shows another plan, so that a reload does not bring the old layout back.
export function withoutShare(hash) {
  const { bare, kv } = splitHash(hash);
  const out = { ...kv };
  delete out.share;
  const parts = bare.map(encodeURIComponent);
  for (const [k, v] of Object.entries(out)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.join('&');
}

// The address hash after another example plan was picked in the page: every other parameter stays, plan= is set to the plan (flat-1, the default, is left
// out), so a reload or a shared address opens the same plan. An unknown name removes plan= as well. A new plan starts with all its floors on show, so floor= goes,
// and the layout of a share link (share=) belonged to the old plan, so it goes too.
export function planHash(hash, name) {
  const { bare, kv } = splitHash(hash);
  const out = { ...kv };
  delete out.plan; delete out.floor; delete out.share;
  if (name !== 'flat-1' && PLAN_NAMES.includes(name)) out.plan = name;
  const parts = bare.map(encodeURIComponent);
  for (const [k, v] of Object.entries(out)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.join('&');
}

// The address hash for switching edit mode on or off: every other parameter stays, edit=1 is added or removed, and the mood, the time of day,
// the quality and the language of the page (`state`) replace the old values, so the reloaded page opens as the visitor left it.
export function editHash(hash, on, state = {}) {
  const { bare, kv } = splitHash(hash);
  const out = { ...kv };
  if (isPreset(state.preset)) { out.preset = state.preset; }
  if (Number.isFinite(state.t)) out.t = (+state.t).toFixed(3);
  if (state.q === 'auto') delete out.q; else if (state.q) out.q = state.q;
  if (state.lang === 'pl' || state.lang === 'en') out.lang = state.lang;
  if (state.floor !== undefined) { delete out.floor; const f = parseFloorParam(String(state.floor)); if (f !== ALL) out.floor = String(f); } // the floors on show stay
  delete out.edit;
  if (on) out.edit = '1';
  const parts = bare.filter((b) => !isPreset(b) || !out.preset).map(encodeURIComponent);
  for (const [k, v] of Object.entries(out)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.join('&');
}
