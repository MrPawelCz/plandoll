// Runs every tests/**/*.test.mjs with node:test. A directory argument to `node --test` is not portable across
// Node versions (22 treats it as a file), so the files are listed explicitly. Extra arguments go to node --test.
// The files run one after another unless --test-concurrency is given: several Chrome tests at once starve a small
// machine and Chrome then misses its start-up window (seen on a CI runner).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(p));
    else if (entry.name.endsWith('.test.mjs')) out.push(p);
  }
  return out.sort();
}

const files = collect(join(root, 'tests'));
if (!files.length) { console.error('No tests found under tests/'); process.exit(1); }
const extra = process.argv.slice(2);
if (!extra.some((a) => a.startsWith('--test-concurrency'))) extra.unshift('--test-concurrency=1');
const res = spawnSync(process.execPath, ['--test', ...extra, ...files], { stdio: 'inherit', cwd: root });
process.exit(res.status ?? 1);
