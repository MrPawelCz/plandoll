// Child process of extract-json.test.mjs: runs extractJson on one hostile input and prints one JSON line. A hang is the failure the
// parent guards against with a timeout (node:test cannot interrupt a synchronous loop), which is why this runs in a process of its own.
//   node tests/core/extract-json-child.mjs <case> [mark]
import { extractJson } from '../../src/core/extract-json.js';
import { MAX_PLAN_CHARS } from '../../src/core/limits.js';
import { bare } from './paste-variants.mjs';

const [name, mark] = process.argv.slice(2);

const CASES = {
  // one long run of fence marks (` or ~, the second argument) where a fence can start
  marksOnly: () => mark.repeat(MAX_PLAN_CHARS),
  marksAfterObject: () => `{"a":1}\n${mark.repeat(MAX_PLAN_CHARS - 20)}`,
  marksThenText: () => `${mark.repeat(MAX_PLAN_CHARS - 10)}x`,
  marksWithLabel: () => `x\n${mark.repeat(100000)} json`,
  marksIndented: () => `\n  ${mark.repeat(50000)}\n`,
  // texts that make every search of extractJson run as long as its limits allow
  openBraces: () => '{ '.repeat(600000),
  openObjects: () => '{"a":'.repeat(300000),
  fencedBraces: () => '```\n{\n```\n'.repeat(200000),
  unclosedPlans: () => '{"levels": [] '.repeat(100000),
  closedPlans: () => '{"levels": []}'.repeat(100000),
  closedObjects: () => '{"a": 1}'.repeat(200000),
  snippetsThenPlan: () => `${'{x} '.repeat(300000)}${bare}`,
  // the other inputs of that kind in the test file
  braces50k: () => '{'.repeat(50000),
  largeNotes: () => { const filler = 'Some text with { stray braces } and more. '.repeat(20000); return `${filler}\n\`\`\`json\n${bare}\n\`\`\`\n${filler}`; },
};

if (!CASES[name] || (name.startsWith('marks') && !mark)) { console.error(`unknown case ${name}`); process.exit(2); }
const text = CASES[name]().slice(0, MAX_PLAN_CHARS);
const t0 = performance.now();
const r = extractJson(text);
console.log(JSON.stringify({ ms: Math.round(performance.now() - t0), ok: r.ok, kind: r.kind, value: r.ok ? r.value : undefined }));
