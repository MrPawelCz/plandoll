// Runs the audit on the examples and on generated plans (seeds A..B), prints a Markdown summary.
// node tools/audit-battery.mjs --repo <tree> [--from 1 --to 200] [--layout-seed 1] [--json out.json]
import { writeFileSync } from 'node:fs';
import { loadRepo } from './audit/data.mjs';
import { auditPlan } from './audit-layout.mjs';
import { RULES2, HARD2 } from './audit/rules2.mjs';

const o = { repo: process.cwd(), from: 1, to: 200, lseed: 1 };
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) { if (a[i] === '--repo') o.repo = a[++i]; else if (a[i] === '--from') o.from = +a[++i]; else if (a[i] === '--to') o.to = +a[++i]; else if (a[i] === '--layout-seed') o.lseed = +a[++i]; else if (a[i] === '--json') o.json = a[++i]; }
const R = await loadRepo(o.repo);
const specs = ['flat-1', 'duplex-1', 'flat-2', 'duplex-2'];
for (let s = o.from; s <= o.to; s++) specs.push(`gen:${s}`);
const rows = [];
let bad = 0;
for (const sp of specs) {
  try {
    const r = await auditPlan(R, sp, { seed: o.lseed });
    rows.push({ plan: sp, family: sp.startsWith('gen:') ? R.gen.generatePlan(+sp.slice(4)).family : sp, pieces: r.stats.pieces, v: r.violations });
  } catch (e) { bad++; rows.push({ plan: sp, error: String(e.message).slice(0, 120), v: [] }); }
}
const rules = ['A1', 'A1h', 'A1s', 'A2', 'A3a', 'A3b', 'A3c', 'A4', 'A5', 'B1', 'B2', 'B2bed', 'B3', 'C', ...RULES2];
const rep2 = (k) => rows.filter((r) => r.plan.startsWith('gen:') && !r.error && r.v.some((v) => v.rule === k)).length; void rep2;
const gen = rows.filter((r) => r.plan.startsWith('gen:') && !r.error);
const out = [];
out.push(`| rule | hard | plans hit (of ${gen.length}) | violations | flat-1 | duplex-1 | flat-2 | duplex-2 |`, '|---|---|---|---|---|---|---|---|');
for (const k of rules) {
  const hit = gen.filter((r) => r.v.some((v) => v.rule === k)).length, n = gen.reduce((t, r) => t + r.v.filter((v) => v.rule === k).length, 0);
  const ex = (name) => rows.find((r) => r.plan === name).v.filter((v) => v.rule === k).length;
  out.push(`| ${k} | ${['A1h', 'A1s', 'A4', 'B2'].includes(k) || (RULES2.includes(k) && !HARD2.has(k)) ? 'S' : 'T'} | ${hit} | ${n} | ${ex('flat-1')} | ${ex('duplex-1')} | ${ex('flat-2')} | ${ex('duplex-2')} |`);
}
const clean = gen.filter((r) => !r.v.some((v) => v.hard)).length;
out.push('', 'Example plans, [T] hard and [S] soft violations (new rules S1..P5 and old A..C):', '| plan | [T] | [S] |', '|---|---|---|');
for (const n of ['flat-1', 'duplex-1', 'flat-2', 'duplex-2']) { const v = rows.find((r) => r.plan === n).v; out.push(`| ${n} | ${v.filter((x) => x.hard).length} | ${v.filter((x) => !x.hard).length} |`); }
out.push('', `Generated plans with zero hard violations: ${clean} of ${gen.length}. Plans that failed to load: ${bad}.`, '');
const tally = (f) => { const m = new Map(); for (const r of gen) for (const v of r.v) { const k = f(v); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((x, y) => y[1] - x[1]); };
out.push('Top offenders (rule, piece type):');
for (const [k, n] of tally((v) => `${v.rule} ${v.type}`).slice(0, 25)) out.push(`- ${k}: ${n}`);
out.push('', 'Top offenders (rule, room):');
for (const [k, n] of tally((v) => `${v.rule} ${String(v.room).replace(/[0-9]+$/, '')}`).slice(0, 15)) out.push(`- ${k}: ${n}`);
const worst = {};
for (const r of gen) for (const v of r.v) { const k = v.rule; if (!worst[k] || (v.value ?? 0) > (worst[k].v.value ?? 0)) worst[k] = { plan: r.plan, v }; }
out.push('', 'Examples (largest value per rule, with coordinates):');
for (const k of rules) if (worst[k]) { const { plan, v } = worst[k]; out.push(`- ${k} ${plan} ${v.level} ${v.room} ${v.piece}: ${v.detail} @${(v.at ?? []).join(',')}`); }
process.stdout.write(`${out.join('\n')}\n`);
if (o.json) writeFileSync(o.json, JSON.stringify(rows));
