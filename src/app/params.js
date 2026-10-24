// Page parameters from the address hash: #preset&t=0.7&q=high&cam=close&plan=flat-1&frames=3&lang=pl&ui=0&live=1
// A bare word is the preset name (so "#amber" works). Pure functions, no DOM: tested in Node.
import { isPreset, getPreset, DEFAULT_PRESET } from '../look/presets.js';
import { parseQualityParam } from '../look/quality.js';

export const PLAN_NAMES = Object.freeze(['flat-1', 'duplex-1']);

export function splitHash(hash) {
  const out = { bare: [], kv: {} };
  for (const part of String(hash ?? '').replace(/^#/, '').split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i < 0) out.bare.push(decodeURIComponent(part)); else out.kv[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
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
  return { preset: presetName, t, q: parseQualityParam(kv.q), cam: kv.cam === 'close' ? 'close' : 'main', plan: parsePlanParam(kv.plan), frames, lang, ui: kv.ui !== '0', live: kv.live === '1', tmSet: kv.t !== undefined, seed, merge: kv.merge !== '0' };
}

// Hash string for a parameter object (inverse of parseParams for the fields the page changes).
export function buildHash(p) {
  const parts = [`preset=${p.preset}`, `t=${(+p.t).toFixed(3)}`];
  if (p.q && p.q !== 'auto') parts.push(`q=${p.q}`);
  if (p.cam === 'close') parts.push('cam=close');
  if (p.plan?.name && p.plan.name !== 'flat-1') parts.push(`plan=${p.plan.name}`);
  if (p.seed && p.seed !== 1) parts.push(`seed=${p.seed}`);
  if (p.lang) parts.push(`lang=${p.lang}`);
  return parts.join('&');
}
