// Independent audit of furniture layouts: collisions (A1..A5), clearances and reachability (B1..B3), stairs (C).
// node tools/audit-layout.mjs --repo <tree> --plan <file.json | example name | gen:SEED[:family]> [--seed N] [--json] [--layout file]
// Exit code 0 when there are no hard violations; soft ones (A1h, A1s, A4, B2 except beds) are counted separately.
import { loadRepo, loadPlan, buildAll, layoutFor } from './audit/data.mjs';
import { auditModel } from './audit/rules.mjs';
import { fileURLToPath } from 'node:url';

export async function auditPlan(R, planSpec, { seed = 1, layoutFile } = {}) {
  const plan = loadPlan(R, planSpec);
  const model = buildAll(R, plan);
  const layout = layoutFor(R, model, { seed, layoutFile });
  return { model, layout, ...auditModel(model, layout, R.specs, { rooms: R.rooms }) };
}

export const summarize = (V) => {
  const by = {};
  for (const v of V) by[v.rule] = (by[v.rule] ?? 0) + 1;
  return by;
};

async function main(argv) {
  const o = { repo: process.cwd(), seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') o.repo = argv[++i];
    else if (argv[i] === '--plan') o.plan = argv[++i];
    else if (argv[i] === '--seed') o.seed = Number(argv[++i]);
    else if (argv[i] === '--layout') o.layout = argv[++i];
    else if (argv[i] === '--json') o.json = true;
  }
  if (!o.plan) { process.stderr.write('usage: node tools/audit-layout.mjs --repo <tree> --plan <file|example|gen:SEED[:family]> [--seed N] [--json] [--layout file]\n'); process.exit(2); }
  const R = await loadRepo(o.repo);
  const res = await auditPlan(R, o.plan, { seed: o.seed, layoutFile: o.layout });
  const hard = res.violations.filter((v) => v.hard), soft = res.violations.filter((v) => !v.hard);
  if (o.json) {
    process.stdout.write(`${JSON.stringify({ plan: o.plan, seed: o.seed, pieces: res.stats.pieces, counts: summarize(res.violations), hard: hard.length, soft: soft.length, violations: res.violations }, null, 1)}\n`);
  } else {
    const c = summarize(res.violations), ch = summarize(hard), cs = summarize(soft);
    process.stdout.write(`audit ${o.plan} seed ${o.seed}: ${res.stats.pieces} pieces, ${hard.length} [T] hard, ${soft.length} [S] soft\n`);
    process.stdout.write(`  counts: ${Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(' ') || 'none'}\n`);
    process.stdout.write(`  [T] ${Object.keys(ch).sort().map((k) => `${k}=${ch[k]}`).join(' ') || 'none'}\n  [S] ${Object.keys(cs).sort().map((k) => `${k}=${cs[k]}`).join(' ') || 'none'}\n`);
    for (const v of res.violations) process.stdout.write(`  [${v.hard ? 'T' : 'S'}] ${v.rule} ${v.level ?? ''} ${v.room ?? ''} ${v.piece ?? ''}: ${v.detail}${v.at ? ` @${v.at.join(',')}` : ''}\n`);
  }
  process.exit(hard.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
