// The prompts that the Load plan box copies are the ones the repository shows: src/app/prompts.js is generated from docs/PROMPT.md and docs/PROMPT.pl.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROMPT_EN, PROMPT_PL, promptFor } from '../../src/app/prompts.js';
import { render } from '../../tools/sync-prompts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
// Matches an en dash or an em dash; built from char codes so the file itself holds neither.
const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');

test('prompts: the page copies exactly what docs/PROMPT.md and docs/PROMPT.pl.md say, and the module is the one the tool writes', () => {
  assert.equal(PROMPT_EN, read('docs/PROMPT.md'));
  assert.equal(PROMPT_PL, read('docs/PROMPT.pl.md'));
  assert.equal(readFileSync(`${root}src/app/prompts.js`, 'utf8'), render(), 'src/app/prompts.js is stale: run node tools/sync-prompts.mjs and commit it with the documents');
});

test('prompts: promptFor gives Polish for pl and English for anything else', () => {
  assert.equal(promptFor('pl'), PROMPT_PL);
  for (const lang of ['en', 'de', '', undefined, null, 'PL']) assert.equal(promptFor(lang), PROMPT_EN);
});

test('prompts: each one opens with the job, has a usable length and the format example, and holds no long dash', () => {
  assert.match(PROMPT_EN, /^You turn a floor plan image into a JSON file for plandoll\./);
  assert.match(PROMPT_PL, /^Zamień obraz rzutu mieszkania lub domu na plik JSON dla plandoll\./);
  for (const t of [PROMPT_EN, PROMPT_PL]) {
    assert.ok(t.length > 3000 && t.length < 20000, `length ${t.length}`);
    assert.match(t, /"version": 1/); assert.match(t, /"levels"/);
    assert.ok(!LONG_DASH.test(t));
  }
});
