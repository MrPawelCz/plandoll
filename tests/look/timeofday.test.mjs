// Time of day: keyframes, interpolation, clock text and the sun path (pure logic, no GL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYFRAMES, NUMBER_FIELDS, COLOR_FIELDS, sample, clock, sunPosition, hexToRgb, rgbToHex, lerpHex, clamp01 } from '../../src/look/timeofday.js';
import { PRESETS, PRESET_NAMES, getPreset, presetLabel, isPreset } from '../../src/look/presets.js';
import { parseParams, parsePlanParam, buildHash } from '../../src/app/params.js';

test('keyframes are ordered, start at 0 and end at 1, and carry every field', () => {
  assert.equal(KEYFRAMES[0].t, 0); assert.equal(KEYFRAMES.at(-1).t, 1);
  for (let i = 1; i < KEYFRAMES.length; i++) assert.ok(KEYFRAMES[i].t > KEYFRAMES[i - 1].t, `keyframe ${i} is after ${i - 1}`);
  for (const k of KEYFRAMES) {
    for (const n of NUMBER_FIELDS) assert.ok(Number.isFinite(k[n]), `${n} at ${k.t}`);
    for (const n of COLOR_FIELDS) assert.match(k[n], /^#[0-9a-f]{6}$/i, `${n} at ${k.t}`);
  }
});

test('sample returns the keyframe values exactly at the keyframes', () => {
  for (const k of KEYFRAMES) {
    const s = sample(k.t);
    for (const n of NUMBER_FIELDS) assert.ok(Math.abs(s[n] - k[n]) < 1e-9, `${n} at ${k.t}`);
    for (const n of COLOR_FIELDS) assert.equal(s[n], k[n].toLowerCase(), `${n} at ${k.t}`);
  }
});

test('sample interpolates linearly between two keyframes and stays inside their range', () => {
  const a = KEYFRAMES[2], b = KEYFRAMES[3], mid = (a.t + b.t) / 2, s = sample(mid);
  for (const n of NUMBER_FIELDS) assert.ok(Math.abs(s[n] - (a[n] + b[n]) / 2) < 1e-9, n);
  assert.equal(s.sunC, lerpHex(a.sunC, b.sunC, 0.5));
  for (let i = 0; i <= 200; i++) { // never leaves the envelope of all keyframes
    const x = sample(i / 200);
    for (const n of NUMBER_FIELDS) { const vals = KEYFRAMES.map((k) => k[n]); assert.ok(x[n] >= Math.min(...vals) - 1e-9 && x[n] <= Math.max(...vals) + 1e-9, `${n} at ${i / 200}`); }
  }
});

test('sample is continuous: a tiny step in t gives a tiny step in every number', () => {
  let prev = sample(0);
  for (let i = 1; i <= 1000; i++) {
    const cur = sample(i / 1000);
    for (const n of NUMBER_FIELDS) assert.ok(Math.abs(cur[n] - prev[n]) < 0.12, `${n} jumps at ${i / 1000}`);
    prev = cur;
  }
});

test('sample clamps t and survives bad input', () => {
  assert.deepEqual(sample(-5), { ...sample(0), t: 0 });
  assert.deepEqual(sample(7), { ...sample(1), t: 1 });
  for (const bad of [NaN, undefined, Infinity, 'x']) assert.ok(Number.isFinite(sample(bad).exp));
  assert.equal(clamp01(NaN), 0);
});

test('lamps come on in the evening and are off at midday', () => {
  assert.equal(sample(0.4).lampK, 0);
  assert.ok(sample(0.955).lampK >= 0.99);
  assert.ok(sample(0.83).lampK > sample(0.735).lampK);
  assert.ok(sample(0.4).sunI > sample(0.955).sunI);
});

test('clock maps t 0..1 to 06:00..23:00', () => {
  assert.equal(clock(0).text, '06:00'); assert.equal(clock(1).text, '23:00'); assert.equal(clock(0.5).text, '14:30');
  for (let i = 0; i <= 100; i++) { const c = clock(i / 100); assert.ok(c.hour >= 6 && c.hour <= 23 && c.minute >= 0 && c.minute < 60); }
});

test('sun path: up at midday from the south side, down at night, unit direction', () => {
  const noon = sunPosition(0.4), night = sunPosition(0.95);
  assert.ok(noon.up && noon.elevation > 45);
  assert.equal(night.up, false);
  for (let i = 0; i <= 50; i++) { const d = sunPosition(i / 50).dir; assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9); assert.ok(d[1] > 0); }
  assert.ok(sunPosition(0.05).azimuth < sunPosition(0.6).azimuth); // moves on through the day
});

test('colour helpers round-trip', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.equal(rgbToHex([255, 128, 0]), '#ff8000');
  assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  assert.throws(() => hexToRgb('nope'));
});

test('presets: three own names, none of the old identifiers, text in two languages without long dashes', () => {
  assert.deepEqual([...PRESET_NAMES], ['clear', 'amber', 'lamplit']);
  assert.deepEqual(Object.keys(PRESETS).sort(), [...PRESET_NAMES].sort(), 'the same three moods, by the same ids');
  assert.ok(!JSON.stringify(PRESETS).match(/cozy|bright|moody|mood/i));
  for (const n of PRESET_NAMES) {
    const p = PRESETS[n];
    assert.ok(p.t >= 0 && p.t <= 1);
    for (const lang of ['en', 'pl']) { const s = presetLabel(n, lang); assert.ok(s.length > 2); assert.ok(!/[\u2013\u2014]/.test(s)); }
    assert.ok(!('blurb' in p), 'a mood has no description line: it went stale when the time of day moved');
    for (const hex of [...p.swatch, ...Object.values(p.palette).flat()]) assert.match(hex, /^#[0-9a-f]{6}$/i);
  }
  assert.deepEqual(['clear', 'amber', 'lamplit'], [...PRESET_NAMES], 'the order of the buttons is the order of the day');
  assert.deepEqual(['Day', 'Sunset', 'Night'], PRESET_NAMES.map((n) => presetLabel(n, 'en')));
  assert.deepEqual(['Dzień', 'Zachód', 'Noc'], PRESET_NAMES.map((n) => presetLabel(n, 'pl')));
  assert.equal(getPreset('nonsense').id, 'amber'); assert.equal(isPreset('cozy'), false);
});

test('presets start at distinct times: lamplit is the latest, clear the earliest', () => {
  assert.ok(PRESETS.clear.t < PRESETS.amber.t && PRESETS.amber.t < PRESETS.lamplit.t);
});

test('address parameters', () => {
  const p = parseParams('#lamplit&t=0.5&q=low&cam=close&plan=duplex-1&frames=3&lang=pl&ui=0');
  assert.equal(p.preset, 'lamplit'); assert.equal(p.t, 0.5); assert.equal(p.q, 'low'); assert.equal(p.cam, 'close'); assert.equal(p.plan.name, 'duplex-1');
  assert.equal(p.frames, 3); assert.equal(p.lang, 'pl'); assert.equal(p.ui, false);
  const d = parseParams('');
  assert.equal(d.preset, 'amber'); assert.equal(d.t, PRESETS.amber.t); assert.equal(d.q, 'auto'); assert.equal(d.plan.name, 'flat-1'); assert.equal(d.ui, true);
  assert.equal(parseParams('#preset=clear').t, PRESETS.clear.t);
  assert.equal(parseParams('#cozy').preset, 'amber'); // the old names are gone
  assert.equal(parseParams('#t=9').t, 1); assert.equal(parseParams('#t=abc').t, PRESETS.amber.t);
  assert.equal(parseParams('', { language: 'pl-PL' }).lang, 'pl'); assert.equal(parseParams('', { language: 'de' }).lang, 'en');
  assert.deepEqual(parsePlanParam('gen:404'), { kind: 'gen', name: 'gen:404', seed: 404 });
  assert.equal(parsePlanParam('gen:../x').name, 'flat-1'); assert.equal(parsePlanParam('ext').kind, 'ext');
  assert.equal(parseParams('#frames=99999').frames, 60);
  assert.equal(parseParams(buildHash({ preset: 'clear', t: 0.25, q: 'high', cam: 'main', plan: { name: 'duplex-1' }, lang: 'en' })).plan.name, 'duplex-1');
});
