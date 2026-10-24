import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractJson } from '../../src/core/extract-json.js';
import { MAX_PLAN_CHARS } from '../../src/core/limits.js';
import { analyzePlan, validatePlan } from '../../src/core/validate.js';

import { plan, bare, variants } from './paste-variants.mjs';

// The hostile inputs run in a child process (extract-json-child.mjs) that is killed after 10 s: node:test cannot interrupt a
// synchronous loop, so code that stopped being linear would stall the whole file instead of failing one test.
const CHILD = fileURLToPath(new URL('./extract-json-child.mjs', import.meta.url));
function child(name, mark = '') {
  const r = spawnSync(process.execPath, [CHILD, name, mark], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1 << 20 });
  const hung = r.error && r.error.code === 'ETIMEDOUT';
  assert.equal(r.status, 0, `${name} ${mark}: ${hung ? 'no answer after 10 s, extractJson is no longer linear' : r.error || r.signal || r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('seven paste styles (and more) load to the same plan', () => {
  for (const [name, text] of Object.entries(variants)) {
    const r = extractJson(text);
    assert.equal(r.ok, true, `${name}: ${r.error}`);
    assert.deepEqual(r.value, plan, name);
    assert.ok(Array.isArray(r.repairs), name);
  }
});

test('bare JSON needs no repairs, every other style records what was done', () => {
  assert.deepEqual(extractJson(bare).repairs, []);
  assert.deepEqual(extractJson(`\ufeff${bare}`).repairs, [], 'a leading byte order mark is not worth a notice');
  const has = (name, phrase) => assert.ok(extractJson(variants[name]).repairs.includes(phrase), `${name}: ${extractJson(variants[name]).repairs}`);
  has('fenced block', 'took the code block');
  has('leading json line', 'dropped a leading json line');
  has('typographic quotes as delimiters', 'replaced typographic quotes with plain quotes');
  has('Polish quotes as delimiters', 'replaced typographic quotes with plain quotes');
  has('// comments', 'removed comments');
  has('/* */ comments', 'removed comments');
  has('trailing commas', 'removed trailing commas');
  has('byte order mark and zero width characters', 'removed invisible characters');
  has('non-breaking spaces as indentation', 'replaced non-breaking spaces');
  assert.ok(extractJson(`Here you go: ${bare} Enjoy!`).repairs.includes('ignored the text around the JSON object'));
});

test('typographic quotes inside a value survive, whatever the delimiters are', () => {
  const polish = extractJson('Oto plan: {"name": "Mieszkanie „Słoneczne” 2", "levels": []} Gotowe.');
  assert.equal(polish.ok, true);
  assert.equal(polish.value.name, 'Mieszkanie „Słoneczne” 2');
  const both = extractJson('{“name”: “Pokój „Salon” duży”, “levels”: []}');
  assert.equal(both.ok, true);
  assert.equal(both.value.name, 'Pokój „Salon” duży');
  const english = extractJson('{“name”: “The “big” room”, “levels”: [],}');
  assert.equal(english.value.name, 'The “big” room');
  const ascii = extractJson('{“name”: “Say "hi"”, “levels”: []}');
  assert.equal(ascii.value.name, 'Say "hi"');
});

test('braces, comment markers and commas inside strings are not touched', () => {
  const r = extractJson('Look: {"name": "a } { b // not a comment, ] /* nor this */", "note": "x,]", "levels": [], } thanks {');
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'a } { b // not a comment, ] /* nor this */');
  assert.equal(r.value.note, 'x,]');
  assert.equal(extractJson('{"a": "\\"}\\\\", "levels": [],}').value.a, '"}\\');
});

test('the block that looks like a plan wins over an earlier snippet', () => {
  const text = `The format is like \`\`\`json\n{"note": "example"}\n\`\`\`\nand here is yours:\n\`\`\`json\n${bare}\n\`\`\``;
  assert.deepEqual(extractJson(text).value, plan);
  assert.deepEqual(extractJson(`Use {braces} for objects. Your plan: ${bare}`).value, plan);
});

test('failures say what is wrong and never throw', () => {
  const none = extractJson('Sorry, I cannot read the image you sent.');
  assert.deepEqual([none.ok, none.kind], [false, 'no-object']);
  assert.match(none.error, /no JSON object/i);

  assert.equal(extractJson('Sorry, a lone { in the middle of a sentence is not a plan.').kind, 'no-object');
  assert.equal(extractJson('{ nope').kind, 'no-object');
  const cut = extractJson(bare.slice(0, 300));
  assert.deepEqual([cut.ok, cut.kind], [false, 'truncated']);
  assert.match(cut.error, /cut off/);

  const broken = extractJson('{"version": 1, "levels": [}');
  assert.deepEqual([broken.ok, broken.kind], [false, 'invalid']);
  assert.ok(broken.error.length > 5);

  assert.equal(extractJson('').kind, 'empty');
  assert.equal(extractJson('   \n ').kind, 'empty');
  for (const odd of [undefined, null, 42, {}, [], '{', '}', '"', '\\', '```', '```json\n```', '{"a"', '{“', '/*', '{ // x', '[{', '\u0000', 'x'.repeat(1000)]) {
    const r = extractJson(odd);
    assert.equal(typeof r.ok, 'boolean', String(odd));
    if (!r.ok) assert.ok(r.kind && r.error && Array.isArray(r.repairs), String(odd));
  }
  assert.equal(child('braces50k').ok, false);
});

test('text over the size limit is refused before any work', () => {
  const big = 'x'.repeat(3 * 1024 * 1024);
  const t0 = Date.now();
  const r = extractJson(big);
  assert.deepEqual([r.ok, r.kind], [false, 'too-long']);
  assert.match(r.error, new RegExp(String(MAX_PLAN_CHARS)));
  assert.ok(Date.now() - t0 < 500);
  assert.equal(extractJson(`{"a":"${'y'.repeat(MAX_PLAN_CHARS)}"}`).kind, 'too-long');
});

test('a last line that is one long run of fence marks is read in linear time', () => {
  for (const mark of ['`', '~']) {
    for (const name of ['marksOnly', 'marksAfterObject', 'marksThenText', 'marksWithLabel', 'marksIndented']) {
      const out = child(name, mark);
      assert.equal(typeof out.ok, 'boolean', `${name} ${mark}`);
      assert.ok(out.ms < 300, `${name} ${mark}: took ${out.ms} ms`);
    }
  }
  // the pattern still finds an ordinary block, also one fenced with a longer run of marks
  assert.deepEqual(extractJson(`Here you go:\n\`\`\`\`json\n${bare}\n\`\`\`\`\nDone.`).value, plan);
  assert.deepEqual(extractJson(`Here you go:\n~~~~~\n${bare}\n~~~~~\nDone.`).value, plan);
});

test('a large text of the allowed size is read in reasonable time', () => {
  const out = child('largeNotes');
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, plan);
  assert.ok(out.ms < 3000, `took ${out.ms} ms`);
});

test('the validator reads pasted answers through extractJson and reports the repairs', () => {
  const r = analyzePlan(variants['fenced block with notes before and after']);
  assert.equal(r.ok, true);
  assert.ok(r.normalized);
  assert.deepEqual(r.repairs, ['took the code block']);
  assert.deepEqual(analyzePlan(bare).repairs, []);
  assert.equal(validatePlan(plan).ok, true);
});

test('validator E001 messages tell the person what to do', () => {
  const none = analyzePlan('Please attach the drawing again.');
  assert.equal(none.errors[0].code, 'E001');
  assert.match(none.errors[0].message, /no JSON object/i);
  assert.match(none.errors[0].fix, /JSON object/);
  const cut = analyzePlan(bare.slice(0, 400));
  assert.equal(cut.errors[0].code, 'E001');
  assert.match(cut.errors[0].fix, /whole plan again/);
  const nan = analyzePlan('{"version": 1, "levels": [{"id": "L0", "elevation": NaN}]}');
  assert.equal(nan.errors[0].code, 'E001');
  assert.match(nan.errors[0].fix, /NaN or Infinity/);
  assert.equal(analyzePlan('x'.repeat(MAX_PLAN_CHARS + 1)).errors[0].code, 'E001');
});

test('many snippets before the plan do not hide it or replace it (fenced and unfenced)', () => {
  const junk = (i) => `Example ${i}:\n\`\`\`json\n{"example": ${i}}\n\`\`\`\n`;
  for (const n of [3, 4, 5, 12]) {
    const r = extractJson(`${Array.from({ length: n }, (_, i) => junk(i)).join('')}Your plan:\n\`\`\`json\n${bare}\n\`\`\``);
    assert.equal(r.ok, true, `${n} snippets`);
    assert.deepEqual(r.value, plan, `${n} snippets: the plan, not {"example": ...}`);
  }
  for (const n of [2, 3, 6, 40]) {
    const r = extractJson(`Use ${Array.from({ length: n }, (_, i) => `{name${i}}`).join(', ')} as you like. Plan: ${bare}`);
    assert.equal(r.ok, true, `${n} brace snippets`);
    assert.deepEqual(r.value, plan, `${n} brace snippets`);
  }
  // junk objects that do parse are skipped for the plan, and still returned when nothing else is there
  assert.deepEqual(extractJson('Look: {"a": 1} and {"b": 2}. Done.').value, { a: 1 });
  assert.deepEqual(extractJson(`{"a": 1}, {"b": 2}, {"c": 3}, {"d": 4}, ${bare} // ok`).value, plan);
});

test('two plans in one answer: the last one is loaded and the repairs say so', () => {
  const second = { ...plan, name: 'Corrected version' };
  const fenced = `First try:\n\`\`\`json\n${bare}\n\`\`\`\nCorrected:\n\`\`\`json\n${JSON.stringify(second, null, 2)}\n\`\`\`\nDone.`;
  const r = extractJson(fenced);
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Corrected version');
  assert.ok(r.repairs.includes('found 2 plans, loaded the last one'), r.repairs.join(' | '));
  assert.ok(r.repairs.includes('took the code block'));
  const loose = extractJson(`Plan: ${bare}\nCorrected: ${JSON.stringify(second)} Thanks`);
  assert.equal(loose.value.name, 'Corrected version');
  assert.ok(loose.repairs.includes('found 2 plans, loaded the last one'));
  const three = extractJson(`${bare}\n${JSON.stringify(second)}\n${bare}`);
  assert.deepEqual(three.value, plan);
  assert.ok(three.repairs.includes('found 3 plans, loaded the last one'));
  // one plan seen twice in different sources (a fence inside the text) is still one plan
  const once = extractJson(`Here:\n\`\`\`json\n${bare}\n\`\`\``);
  assert.ok(!once.repairs.some((x) => /found/.test(x)));
  const smart = extractJson(`“Quote” in a note.\n${bare}\n`);
  assert.ok(!smart.repairs.some((x) => /found/.test(x)), 'typographic quotes elsewhere do not read the plan twice');
});

test('a plan inside a list is taken out of it', () => {
  const r = extractJson(`[${bare}]`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, plan);
  assert.deepEqual(r.repairs, ['took the plan out of a list']);
  const second = { ...plan, name: 'Second' };
  const two = extractJson(JSON.stringify([plan, second]));
  assert.equal(two.value.name, 'Second');
  assert.deepEqual(two.repairs, ['took the plan out of a list', 'found 2 plans, loaded the last one']);
  const fenced = extractJson(`\`\`\`json\n[\n${bare}, // note\n]\n\`\`\``);
  assert.deepEqual(fenced.value, plan);
  assert.ok(fenced.repairs.includes('took the plan out of a list'));
  assert.deepEqual(extractJson('[1, 2, 3]').value, [1, 2, 3], 'a list without a plan is left to the validator');
  assert.deepEqual(extractJson('[]').repairs, []);
});

test('zero width joiners and non-joiners inside strings are kept, noise between tokens goes', () => {
  const name = 'Family \u{1F468}‍\u{1F469}‍\u{1F467} flat, می‌خواهم';
  const r = extractJson(`Plan:\n\`\`\`json\n{"name": "${name}", "levels": [],}\n\`\`\``);
  assert.equal(r.ok, true);
  assert.equal(r.value.name, name);
  const between = extractJson('{"name": "x",‍ "levels": []‌}');
  assert.equal(between.ok, true);
  assert.deepEqual(between.value, { name: 'x', levels: [] });
  assert.ok(between.repairs.includes('removed invisible characters'));
  assert.equal(extractJson('{"na​me": "x​", "levels": [],}').value.name, 'x', 'a zero width space is still dropped everywhere');
});

test('hostile input stays fast with the wider search', () => {
  let total = 0;
  for (const name of ['openBraces', 'openObjects', 'fencedBraces', 'unclosedPlans', 'closedPlans', 'closedObjects', 'snippetsThenPlan']) {
    const out = child(name);
    assert.equal(typeof out.ok, 'boolean', name);
    assert.ok(out.ms < 2500, `${name}: ${out.ms} ms`);
    total += out.ms;
    if (name === 'snippetsThenPlan') assert.deepEqual(out.value, plan, 'plain brace snippets are free, the plan behind them is found');
  }
  assert.ok(total < 9000, `${total} ms in all`);
});

test('a zero width joiner or non-joiner after a typographic closing quote or before the first key does not break the plan', () => {
  for (const z of ['‍', '‌']) {
    const r = extractJson(`{“levels”: [], “name”: “x”${z}, }`);
    assert.equal(r.ok, true, `U+${z.codePointAt(0).toString(16)} after a closing quote`);
    assert.equal(r.value.name, 'x');
    const lead = extractJson(`{${z}“levels”: [], “name”: “y”}`);
    assert.equal(lead.ok, true, `U+${z.codePointAt(0).toString(16)} before the first key`);
    assert.equal(lead.value.name, 'y');
  }
});
