// Loads data for the audit from a repository tree: plan -> model (buildModel), layout (autoFurnish), catalogue specs.
// Only DATA is taken from the repository; every collision and distance rule lives in rules.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (repo, rel) => import(pathToFileURL(join(repo, rel)).href);

export async function loadRepo(repo) {
  repo = resolve(repo);
  const [val, geo, specs, lay, rooms, gen] = await Promise.all([
    imp(repo, 'src/core/validate.js'), imp(repo, 'src/model/geometry.js'), imp(repo, 'src/furniture/specs.js'), imp(repo, 'src/layout/index.js'), imp(repo, 'src/layout/rooms.js'),
    existsSync(join(repo, 'tools/gen-plans.mjs')) ? imp(repo, 'tools/gen-plans.mjs') : Promise.resolve(null),
  ]);
  return { repo, val, geo, specs, lay, rooms, gen };
}

// plan spec: a file path, an example name (examples/<name>.plan.json) or gen:SEED[:family]
export function loadPlan(R, spec) {
  if (spec.startsWith('gen:')) {
    const [, seed, fam] = spec.split(':');
    if (!R.gen) throw new Error('tools/gen-plans.mjs missing in this tree');
    return R.gen.generatePlan(Number(seed), fam || undefined).plan;
  }
  const cands = [spec, join(R.repo, spec), join(R.repo, 'examples', `${spec}.plan.json`)];
  const f = cands.find((c) => existsSync(c) && !/\/$/.test(c));
  if (!f) throw new Error(`plan not found: ${spec}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function buildAll(R, plan) {
  const p = JSON.parse(JSON.stringify(plan));
  for (const lv of p.levels ?? []) lv.furniture = [];
  const res = R.val.analyzePlan(p), norm = R.val.modelOf(res);
  if (!norm) throw new Error(`plan invalid: ${JSON.stringify((res.errors ?? []).slice(0, 3))}`);
  return R.geo.buildModel(norm);
}

export function layoutFor(R, model, { seed = 1, layoutFile } = {}) {
  if (layoutFile) return JSON.parse(readFileSync(layoutFile, 'utf8'));
  return R.lay.autoFurnish(model, { seed });
}
