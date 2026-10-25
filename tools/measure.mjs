// Performance table for the built page: four plans at the quality levels high, medium and low, one browser run per plan
// (tools/shot.mjs, so only one Chrome runs at a time). Prints draw calls, triangles, textures, lights and frame time per row,
// then checks the targets: at most 1800 draw calls on high, 700 on low and a page file of at most 1.3 MB.
//   node tools/measure.mjs [--levels high,medium,low] [--plans flat-1,duplex-1,gen:404,gen:405] [--frames 2] [--size 1280x720]
//                          [--html dist/planstage.html] [--wrap COMMAND] [--extra PARAMS]
// --extra adds page parameters to every run (for example merge=0 to measure without merged furniture meshes).
// --wrap puts a command in front of the browser launch of every run.
// "gen:SEED" is a generated plan (tools/gen-plans.mjs); it is written to a temporary directory and passed to shot.mjs as an external plan.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlan } from './gen-plans.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = Object.freeze({ highDrawCalls: 1800, lowDrawCalls: 700, pageBytes: 1.3e6 });

const opt = { levels: 'high,medium,low', plans: 'flat-1,duplex-1,gen:404,gen:405', frames: '2', size: '1280x720', html: join(root, 'dist/planstage.html'), wrap: '', extra: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--') && a.slice(2) in opt && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
  else { console.error('usage: node tools/measure.mjs [--levels high,medium,low] [--plans flat-1,duplex-1,gen:404,gen:405] [--frames N] [--size WxH] [--html FILE] [--wrap COMMAND] [--extra PARAMS]'); process.exit(2); }
}
const levels = opt.levels.split(',').filter((l) => ['high', 'medium', 'low'].includes(l));
const plans = opt.plans.split(',').map((s) => s.trim()).filter(Boolean);
if (!levels.length || !plans.length) { console.error('measure: nothing to measure'); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), 'planstage-measure-'));
const shots = join(work, 'shots'); mkdirSync(shots);
const rows = [];
let failed = false;

try {
  for (const plan of plans) {
    const gen = /^gen:(\d+)$/.exec(plan);
    const args = [join(root, 'tools/shot.mjs'), '--size', opt.size, '--html', resolve(opt.html), '--out', shots, '--timeout', '600'];
    let planHash = `plan=${plan}`;
    if (gen) {
      const file = join(work, `gen-${gen[1]}.plan.json`);
      writeFileSync(file, JSON.stringify(generatePlan(Number(gen[1])).plan));
      args.push('--plan', file); planHash = 'plan=ext';
    }
    for (const q of levels) args.push(`${plan.replace(/\W+/g, '_')}_${q}=preset=amber&q=${q}&${planHash}${opt.extra ? `&${opt.extra}` : ''}:${opt.frames}`);
    const [cmd, ...pre] = opt.wrap ? [opt.wrap, process.execPath] : [process.execPath];
    const res = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const lines = (res.stdout ?? '').split('\n').filter((l) => l.startsWith('{'));
    for (const line of lines) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r.done || !r.stats) { failed = true; console.error(`measure: ${r.name} did not finish${r.fail ? `: ${r.fail}` : ''}`); continue; }
      rows.push({ ...r.stats, plan, q: r.stats.quality });
    }
    if (res.status !== 0 && !lines.length) { failed = true; console.error(`measure: browser run for ${plan} failed\n${(res.stdout ?? '') + (res.stderr ?? '')}`.slice(0, 800)); }
  }
} finally { rmSync(work, { recursive: true, force: true }); }

const pad = (v, n) => String(v).padStart(n);
const head = ['plan', 'level', 'draw calls', 'triangles', 'textures', 'lights', 'pieces', 'frame ms'];
const table = rows.map((r) => [r.plan, r.q, r.drawCalls, r.triangles, r.textures, r.lights, r.pieces ?? '-', r.frameMs]);
const widths = head.map((h, i) => Math.max(h.length, ...table.map((row) => String(row[i]).length)));
console.log(head.map((h, i) => (i < 2 ? h.padEnd(widths[i]) : pad(h, widths[i]))).join('  '));
for (const row of table) console.log(row.map((v, i) => (i < 2 ? String(v).padEnd(widths[i]) : pad(v, widths[i]))).join('  '));
console.log(process.env.PS_ANGLE === 'metal' ? 'note: frame times come from this machine\'s GPU (PS_ANGLE=metal).' : 'note: frame times come from software rendering (SwiftShader), not a GPU.');

const worst = (q) => Math.max(0, ...rows.filter((r) => r.q === q).map((r) => r.drawCalls));
const bytes = statSync(resolve(opt.html)).size;
const checks = [
  levels.includes('high') && ['draw calls on high', worst('high'), TARGETS.highDrawCalls],
  levels.includes('low') && ['draw calls on low', worst('low'), TARGETS.lowDrawCalls],
  ['page size in bytes', bytes, TARGETS.pageBytes],
].filter(Boolean);
for (const [label, value, limit] of checks) { const ok = value <= limit; if (!ok) failed = true; console.log(`${ok ? 'ok  ' : 'OVER'} ${label}: ${value} (target ${limit})`); }
process.exit(failed ? 1 : 0);
