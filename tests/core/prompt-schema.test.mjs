// The prompts a person pastes into a chat must agree with schema/plan.v1.schema.json: a chat that follows them has to produce
// a plan the validator accepts. Read against the schema file: the format example, every dotted field name (wall.thickness),
// the fields the schema requires (none may sit only in the optional list), enum values and the limits the prompts state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, 'utf8').replace(/\r\n/g, '\n');
const schema = JSON.parse(read('schema/plan.v1.schema.json'));
const D = schema.$defs;
const owners = { level: D.level, wall: D.wall, opening: D.opening, room: D.room, stair: D.stair, furniture: D.furniture, meta: schema.properties.meta };
const PROMPTS = [['docs/PROMPT.md', 'Optional fields:'], ['docs/PROMPT.pl.md', 'Pola opcjonalne:']];
const DOTTED = /\b(level|wall|opening|room|stair|furniture|meta)\.([a-z_]+)\b/g;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const resolve = (n) => (n.$ref ? D[n.$ref.split('/').pop()] : n);
const quoted = (s) => [...s.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// Walks the format example (placeholders made numeric) against the schema: known keys, required keys, enum values.
function walk(value, node, path, out) {
  node = resolve(node);
  if (node.enum) for (const v of String(value).split('|')) if (!node.enum.includes(v)) out.push(`${path}: "${v}" is not one of ${node.enum.join(', ')}`);
  if (Array.isArray(value)) return value.forEach((v, i) => node.items && walk(v, node.items, `${path}[${i}]`, out));
  if (!value || typeof value !== 'object' || !node.properties) return;
  for (const k of Object.keys(value)) {
    if (has(node.properties, k)) walk(value[k], node.properties[k], `${path}.${k}`, out);
    else out.push(`${path}: the schema has no "${k}"`);
  }
  for (const k of node.required || []) if (!has(value, k)) out.push(`${path}: the example lacks the required "${k}"`);
}

// Everything that disagrees with the schema in one prompt text; [] when it agrees. `marker` starts the optional-fields line.
function check(text, marker) {
  const problems = [];
  const lines = text.split('\n');
  const optional = lines.filter((l) => l.startsWith(marker));
  if (optional.length !== 1) return [`expected one line starting with "${marker}", found ${optional.length}`];
  const block = text.match(/```text\n([\s\S]*?)\n```/);
  try {
    walk(JSON.parse(block[1].replace(/\[x, y\]/g, '[0, 0]')), schema, 'plan', problems);
  } catch (e) {
    problems.push(`the format example is not readable as JSON: ${e.message}`);
  }
  for (const [ref, owner, key] of text.matchAll(DOTTED)) if (!has(owners[owner].properties, key)) problems.push(`${ref}: the schema has no such field`);
  for (const [ref, owner, key] of optional[0].matchAll(DOTTED)) if ((owners[owner].required || []).includes(key)) problems.push(`${ref} is required by the schema but listed as optional`);
  // Stairs and furniture are optional lists, so their entries are not in the format example: a rule line must name the required keys.
  for (const name of ['stair', 'furniture']) {
    const need = D[name].required;
    const line = lines.find((l) => l !== optional[0] && need.every((k) => l.includes(`"${k}"`)));
    if (!line) problems.push(`${name}: no line outside the optional list names ${need.join(', ')}`);
    else for (const k of quoted(line)) if (!has(D[name].properties, k) && !has(D.level.properties, k)) problems.push(`${name}: the line naming its required keys also names "${k}", which the schema does not know`);
  }
  const types = (text.match(/[a-z]+(?:-[a-z]+)*(?:, [a-z]+(?:-[a-z]+)*){10,}/g) || []).find((m) => m.includes(D.furniture.properties.type.enum[0]));
  if (!types || [...types.split(', ')].sort().join() !== [...D.furniture.properties.type.enum].sort().join()) problems.push(`the furniture types differ from the schema: ${types}`);
  for (const [owner, key] of [['room', 'floor'], ['opening', 'hinge'], ['opening', 'opens_to']]) {
    const list = text.match(new RegExp(`${owner}\\.${key} \\(([^)]*)\\)`));
    if (!list) problems.push(`${owner}.${key}: no list of values`);
    else for (const [, v] of list[1].matchAll(/"([a-z]+)"/g)) if (!owners[owner].properties[key].enum.includes(v)) problems.push(`${owner}.${key}: "${v}" is not in the schema`);
  }
  const stated = (what, ...parts) => { if (!lines.some((l) => parts.every((p) => (p instanceof RegExp ? p.test(l) : l.includes(p))))) problems.push(`the limit of ${what} is not stated as in the schema`); };
  stated('name', '"name"', String(schema.properties.name.maxLength));
  stated('meta.scale_note', 'meta.scale_note', String(schema.properties.meta.properties.scale_note.maxLength));
  stated('meta.notes', 'meta.notes', String(schema.properties.meta.properties.notes.maxLength));
  stated('ids', '"_"', D.id.pattern.match(/\{1,(\d+)\}/)[1]);
  const { minimum, maximum } = D.stair.properties.steps;
  stated('steps', '"steps"', new RegExp(`\\b${minimum}\\b.*\\b${maximum}\\b`));
  return problems;
}

for (const [file, marker] of PROMPTS) {
  test(`${file} agrees with the schema: known keys, required keys outside the optional list, enum values, limits`, () => {
    assert.deepEqual(check(read(file), marker), []);
  });
}

test('both prompts name the same dotted fields, so one cannot drift from the other', () => {
  const refs = PROMPTS.map(([file]) => [...read(file).matchAll(DOTTED)].map((m) => m[0]));
  assert.ok(refs[0].length >= 10, 'the check found the dotted fields');
  assert.deepEqual([...new Set(refs[1])].sort(), [...new Set(refs[0])].sort());
});

test('the check itself catches the mistakes it exists for', () => {
  const [file, marker] = PROMPTS[0];
  const text = read(file);
  const problemsOf = (broken) => check(broken, marker).join('\n');
  assert.match(problemsOf(text.replace(/^- Stairs:.*\n/m, '')), /stair: no line outside the optional list names id, from, to, width, steps/);
  assert.match(problemsOf(text.replace('furniture.rotation.', 'furniture.rotation, stair.steps.')), /stair\.steps is required by the schema but listed as optional/);
  assert.match(problemsOf(text.replace('wall.thickness', 'wall.colour')), /wall\.colour: the schema has no such field/);
  assert.match(problemsOf(text.replace('"kind": "exterior"', '"kind": "outer"')), /"outer" is not one of exterior, interior, partition/);
  assert.match(problemsOf(text.replace('at most 120 characters', 'at most 130 characters')), /limit of name/);
  assert.match(problemsOf(text.replace(', rug.', '.')), /furniture types differ/);
});

// tools/build.mjs embeds the whole prompt file, so anything outside the prompt (a heading, tips, a changelog) would be pasted
// into every chat that receives it. The files must hold nothing but the prompt.
test('each prompt file starts with its first prompt sentence and holds no markdown heading', () => {
  const FIRST = { 'docs/PROMPT.md': 'You turn a floor plan image', 'docs/PROMPT.pl.md': 'Zamień obraz rzutu' };
  for (const [file] of PROMPTS) {
    const text = read(file);
    assert.ok(text.startsWith(FIRST[file]), `${file} has to start with the prompt itself, not a title or a note`);
    assert.doesNotMatch(text, /^#{1,6} /m, `${file} holds a markdown heading: the whole file is sent to the chat`);
  }
});
