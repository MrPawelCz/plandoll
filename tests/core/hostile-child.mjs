// Child process of hostile.test.mjs: builds one hostile input, validates it and prints one JSON line.
//   node --max-old-space-size=256 tests/core/hostile-child.mjs <case> [repo-root]
// The optional repo root lets the same cases run against another checkout.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [name, rootArg] = process.argv.slice(2);
const root = resolve(rootArg ?? fileURLToPath(new URL('../..', import.meta.url)));
const { analyzePlan } = await import(pathToFileURL(`${root}/src/core/validate.js`).href);

const square = (id = 'a') => [
  { id, from: [0, 0], to: [6, 0], kind: 'exterior' }, { id: 'b', from: [6, 0], to: [6, 4], kind: 'exterior' },
  { id: 'c', from: [6, 4], to: [0, 4], kind: 'exterior' }, { id: 'd', from: [0, 4], to: [0, 0], kind: 'exterior' },
];
const plan = (level = {}) => ({ version: 1, levels: [{ id: 'L0', walls: square(), ...level }] });
const room = (id, polygon = [[0, 0], [6, 0], [6, 4], [0, 4]]) => ({ id, name: id, polygon });
const flat = JSON.stringify;

const CASES = {
  // two 5,000 character ids: an opening that names a wall which does not exist (the "did you mean" path)
  ids5k: () => flat(plan({ walls: square('x'.repeat(5000)), openings: [{ id: 'o', wall: 'y'.repeat(5000), type: 'door', offset: 1, width: 0.9 }] })),
  ids20k: () => flat(plan({ walls: square('x'.repeat(20000)), openings: [{ id: 'o', wall: 'y'.repeat(20000), type: 'door', offset: 1, width: 0.9 }] })),
  idsEverywhere: () => flat(plan({ walls: square('x'.repeat(5000)), rooms: [room('r'.repeat(5000))], openings: [{ id: 'o'.repeat(5000), wall: 'q'.repeat(5000), type: 'door', offset: 1, width: 0.9 }] })),
  unknownKey: () => flat(plan({ ['k'.repeat(20000)]: 1 })),
  notes20mb: () => flat({ ...plan(), meta: { notes: 'x'.repeat(20 * 1024 * 1024) } }),
  walls100k: () => flat(plan({ walls: Array.from({ length: 100000 }, (_, i) => ({ id: `w${i}`, from: [i % 100, 0], to: [i % 100, 1] })) })),
  walls20k: () => flat(plan({ walls: Array.from({ length: 20000 }, (_, i) => ({ id: `w${i}`, from: [i % 100, 0], to: [i % 100, 1] })) })),
  poly100k: () => flat(plan({ rooms: [room('r', Array.from({ length: 100000 }, (_, i) => [Math.cos(i) * 3 + 3, Math.sin(i) * 2 + 2]))] })),
  furniture100k: () => flat(plan({ furniture: Array.from({ length: 100000 }, (_, i) => ({ id: `f${i}`, type: 'chair', center: [1, 1] })) })),
  levels5k: () => flat({ version: 1, levels: Array.from({ length: 5000 }, (_, i) => ({ id: `L${i}`, walls: square() })) }),
  // at the caps: the most work the validator is asked to do on a plan that is accepted
  wallsAtCap: () => flat(plan({ walls: Array.from({ length: 600 }, (_, i) => ({ id: `w${i}`, from: [(i * 0.37) % 9, (i * 0.11) % 5], to: [((i * 0.37) % 9) + 0.4, ((i * 0.11) % 5) + 0.3], kind: 'interior' })) })),
  roomsAtCap: () => flat(plan({ rooms: Array.from({ length: 150 }, (_, i) => room(`r${i}`, [[0, 0], [6 - (i % 5) * 0.01, 0], [6, 4 - (i % 7) * 0.01], [0, 4]])) })),
  polygonsAtCap: () => flat(plan({ rooms: Array.from({ length: 150 }, (_, i) => room(`r${i}`, Array.from({ length: 120 }, (_, k) => [3 + Math.cos((k / 120) * 6.2832) * (1 + i * 0.01), 2 + Math.sin((k / 120) * 6.2832) * (1 + i * 0.005)]))) })),
  // the largest plan the caps accept: 12 levels, each with 600 walls, 600 openings, 150 rooms and 400 pieces of furniture
  maxPlan: () => flat({ version: 1, levels: Array.from({ length: 12 }, (_, l) => ({
    id: `L${l}`,
    walls: Array.from({ length: 600 }, (_, i) => ({ id: `w${i}`, from: [(i % 30) * 0.5, Math.floor(i / 30) * 0.5], to: [(i % 30) * 0.5 + 0.5, Math.floor(i / 30) * 0.5], kind: i < 4 ? 'exterior' : 'interior' })),
    openings: Array.from({ length: 600 }, (_, i) => ({ id: `o${i}`, wall: `w${i}`, type: i % 2 ? 'window' : 'door', offset: 0, width: 0.4 })),
    rooms: Array.from({ length: 150 }, (_, i) => room(`r${i}`, [[(i % 15), Math.floor(i / 15)], [(i % 15) + 1, Math.floor(i / 15)], [(i % 15) + 1, Math.floor(i / 15) + 1], [(i % 15), Math.floor(i / 15) + 1]])),
    furniture: Array.from({ length: 400 }, (_, i) => ({ id: `f${i}`, type: 'chair', center: [(i % 40) * 0.4, Math.floor(i / 40) * 0.4], size: [0.4, 0.4] })),
  })) }),
  // keys that exist on every object
  proto: () => '{"version":1,"__proto__":{"x":1},"constructor":{"y":2},"toString":3,"levels":[{"id":"L0","walls":[{"id":"a","from":[0,0],"to":[6,0],"kind":"constructor","__proto__":5},{"id":"b","from":[6,0],"to":[6,4],"kind":"toString"},{"id":"c","from":[6,4],"to":[0,4]},{"id":"d","from":[0,4],"to":[0,0]}],"openings":[{"id":"o","wall":"c","type":"constructor","offset":1,"width":0.9}]}]}',
  prototypeUnits: () => flat({ ...plan(), units: 'constructor' }),
};

if (!CASES[name]) { console.error(`unknown case ${name}`); process.exit(2); }
const text = CASES[name]();
// HOSTILE_AS_OBJECT=1 hands analyzePlan the parsed object, the way api.load(object) does, so the caps behind the text size limit are tested too.
const input = process.env.HOSTILE_AS_OBJECT ? JSON.parse(text) : text;
const t0 = performance.now();
let result = null, threw = null;
try { result = analyzePlan(input); } catch (e) { threw = String(e && e.message ? e.message : e).slice(0, 120); }
const ms = performance.now() - t0;
const issues = result ? [...result.errors, ...result.warnings] : [];
const bad = result?.salvaged?.levels?.flatMap((l) => l.walls.map((w) => w.thickness)).filter((t) => !Number.isFinite(t)).length ?? 0;
console.log(JSON.stringify({
  name, inputBytes: text.length, ms: Math.round(ms * 10) / 10, rssMB: Math.round(process.resourceUsage().maxRSS / 1024), threw,
  ok: result?.ok ?? null, codes: [...new Set(issues.map((i) => i.code))], issues: issues.length, normalized: !!result?.normalized,
  messageBytes: JSON.stringify(issues).length, nanThickness: bad,
  messages: issues.slice(0, 6).map((i) => `${i.code} ${i.message}`.slice(0, 160)),
}));
