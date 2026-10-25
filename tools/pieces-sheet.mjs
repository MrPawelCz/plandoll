// Builds the furniture contact sheet page (tools/sheet-entry.js) into one HTML file.
//   node tools/pieces-sheet.mjs [out.html] [--groups DIR] [--size 1600x900]
// Then take one view per call (the hash carries the options):
//   node tools/shot.mjs --html out.html --size 1600x900 --out DIR name=az=35&el=30&cols=3&types=sofa3,sofa2,armchair:2
// Different azimuths (35, 125, 215, 305) of the same sheet give four sides.
// --groups DIR also shoots every implemented type in small groups (nine at most, similar sizes together, the cell sized to the
// group so each piece fills a good part of its tile), once from the front (az 35) and once from the back (az 215): DIR/gN-front.jpg
// and DIR/gN-back.jpg. Run it under the browser lock like the other shot tools.
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GROUP_MAX = 9;

// Splits the types into groups of at most GROUP_MAX, the biggest pieces first so that a group holds pieces of similar size, and
// gives each group a grid (columns) and a cell (metres) that fits its biggest piece with a little air around it.
export function pieceGroups(types, sizeOf) {
  const dim = (t) => Math.max(0.1, ...(sizeOf(t) ?? []).filter(Number.isFinite));
  const sorted = types.slice().sort((a, b) => dim(b) - dim(a) || (a < b ? -1 : 1));
  const groups = [];
  for (let i = 0; i < sorted.length; i += GROUP_MAX) {
    const list = sorted.slice(i, i + GROUP_MAX);
    const big = Math.max(...list.map(dim));
    groups.push({ types: list, cols: Math.min(3, list.length), cell: Math.round(Math.min(4.5, Math.max(0.7, big * 1.3)) * 100) / 100 });
  }
  return groups;
}

// Shot jobs for tools/shot.mjs: `name=hash` per group and side.
export function groupJobs(groups) {
  const jobs = [];
  groups.forEach((g, i) => {
    for (const [side, az] of [['front', 35], ['back', 215]]) {
      jobs.push(`g${i + 1}-${side}=az=${az}&el=28&cols=${g.cols}&cell=${g.cell}&fit=tight&types=${g.types.join(',')}`);
    }
  });
  return jobs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const groupsDir = take('--groups'), size = take('--size') ?? '1600x900';
  const out = args[0] ?? join(tmpdir(), 'plandoll-sheet.html');
  const res = spawnSync(process.execPath, [join(root, 'tools/build-sheet.mjs'), 'tools/sheet-entry.js', out], { cwd: root, stdio: 'inherit' });
  if (res.status || !groupsDir) process.exit(res.status ?? 1);
  const { piecesImplemented } = await import('../src/furniture/index.js');
  const { SPEC_BY_ID } = await import('../src/furniture/specs.js');
  const jobs = groupJobs(pieceGroups(piecesImplemented(), (t) => SPEC_BY_ID[t]?.size));
  const shots = spawnSync(process.execPath, [join(root, 'tools/shot.mjs'), '--html', out, '--size', size, '--quality', '82', '--timeout', '40', '--out', groupsDir, ...jobs], { cwd: root, stdio: 'inherit' });
  process.exit(shots.status ?? 1);
}
