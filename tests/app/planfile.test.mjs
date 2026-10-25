import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPlanText } from '../../src/app/planfile.js';
import { MAX_FILE_BYTES } from '../../src/app/files.js';

const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const example = (name) => readFileSync(fileURLToPath(new URL(`../../examples/${name}.plan.json`, import.meta.url)), 'utf8');

test('a valid plan, alone or inside other text, comes back as a plan', () => {
  for (const name of ['flat-1', 'duplex-1']) {
    const r = readPlanText(example(name), 'en');
    assert.equal(r.ok, true, name); assert.ok(r.plan.levels.length >= 1); assert.equal(typeof r.warnings, 'number');
  }
  const wrapped = readPlanText(`Here is the plan:\n${example('flat-1')}\nThanks`, 'pl');
  assert.equal(wrapped.ok, true);
});

test('a plan with problems gives one line: the first problem and how many more, in both languages', () => {
  const broken = JSON.parse(example('flat-1')); delete broken.levels; broken.units = 'furlongs'; broken.extra = { a: 1 };
  const en = readPlanText(JSON.stringify(broken), 'en'), pl = readPlanText(JSON.stringify(broken), 'pl');
  assert.equal(en.ok, false); assert.equal(pl.ok, false);
  assert.match(en.message, /^Could not load the plan: /); assert.match(pl.message, /^Nie wczytano planu: /);
  assert.ok(en.errors >= 2 ? /\(\d+ more\)$/.test(en.message) : !/more\)$/.test(en.message));
  assert.ok(pl.errors >= 2 ? /\(jeszcze \d+\)$/.test(pl.message) : !/jeszcze/.test(pl.message));
  for (const m of [en.message, pl.message]) { assert.ok(m.length <= 170, m.length); assert.ok(!LONG_DASH.test(m)); assert.ok(!/\n/.test(m)); }
});

test('text that is not a plan, empty input and oversized input are refused with a line, never a throw', () => {
  for (const bad of [undefined, null, 42, {}, '', '   ', 'hello', '{', '{"version": 1', '[]', 'null']) {
    const r = readPlanText(bad, 'en'); assert.equal(r.ok, false, String(bad)); assert.equal(typeof r.message, 'string'); assert.ok(r.message.length > 0);
  }
  const big = readPlanText('x'.repeat(MAX_FILE_BYTES + 1), 'pl');
  assert.equal(big.ok, false); assert.match(big.message, /za duży/);
  assert.equal(readPlanText('', 'pl').message, 'Brak planu do wczytania');
});

test('hostile keys do not pollute anything, and the same input gives the same answer', () => {
  const hostile = '{"version":1,"levels":[{"id":"L0","walls":[],"rooms":[]}],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}';
  const a = readPlanText(hostile, 'en'), b = readPlanText(hostile, 'en');
  assert.deepEqual(a, b);
  assert.equal({}.polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
});
