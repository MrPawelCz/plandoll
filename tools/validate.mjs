#!/usr/bin/env node
// planwalk plan validator CLI (docs/SPEC.md section 5).
//   node tools/validate.mjs plan.json [--json] [--strict]     ("-" reads the plan from stdin)
// Exit codes: 0 ok (with --strict also no warnings and nothing repaired), 1 not ok, 2 usage error or unreadable file.
// A chat answer is read like the viewer reads it; each change made to read it is printed as a "note:" line (the "repairs" list with --json).
// Invalid JSON is reported as error E001 (exit 1), so the message can be pasted back into a chat.
// A property the schema does not know is a warning (W116), as in the viewer; --strict makes it an error (E002). A plan with errors in
// some elements exits 1, and one more line says how many elements the viewer would skip to show the rest.
// npm run build:skill bundles this file with src/core/ into skill/planwalk/scripts/validate.mjs.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { analyzePlan } from '../src/core/validate.js';

const MAX_PER_CODE = 15; // text mode only; --json always lists everything
// The usage line shows the path as it was run. Computed on demand: process.cwd() throws when the directory is gone.
const self = () => { try { return relative(process.cwd(), process.argv[1]); } catch { return 'validate.mjs'; } };

function usage(code) {
  const out = code === 0 ? process.stdout : process.stderr;
  out.write(`usage: node ${self()} <plan.json | -> [--json] [--strict]\n`);
  out.write('  --json    print { ok, partial, errors, warnings, skipped, repairs } as JSON\n');
  out.write('  --strict  exit 1 when there are warnings too, or when the text had to be repaired to be read; unknown properties are errors\n');
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage(0);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
for (const fl of flags) if (fl !== '--json' && fl !== '--strict') { process.stderr.write(`unknown option ${fl}\n`); usage(2); }
if (files.length !== 1) usage(2);

let text;
try {
  text = readFileSync(files[0] === '-' ? 0 : files[0], 'utf8');
} catch (e) {
  process.stderr.write(`cannot read ${files[0]}: ${e.message}\n`);
  process.exit(2);
}

const { ok, partial, errors, warnings, skipped, repairs } = analyzePlan(text, { strict: flags.has('--strict') });

if (flags.has('--json')) {
  process.stdout.write(`${JSON.stringify({ ok, partial, errors, warnings, skipped, repairs }, null, 2)}\n`);
} else {
  const line = (i) => {
    const where = `${i.path || '(plan)'}${i.id !== undefined && !i.message.includes(`"${i.id}"`) ? ` "${i.id}"` : ''}`;
    return `${i.code} ${where}: ${i.message}. Fix: ${i.fix}`.replace(/\.\. /g, '. ');
  };
  const counts = new Map();
  const lines = repairs.map((r) => `note: ${r}`);
  for (const i of [...errors, ...warnings]) {
    const n = (counts.get(i.code) || 0) + 1;
    counts.set(i.code, n);
    if (n <= MAX_PER_CODE) lines.push(line(i));
  }
  for (const [code, n] of counts) if (n > MAX_PER_CODE) lines.push(`${code} ... and ${n - MAX_PER_CODE} more ${code} issues (use --json for the full list)`);
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
  process.stdout.write(`${errors.length} errors, ${warnings.length} warnings\n`);
  if (skipped.length) {
    const n = `${skipped.length} element${skipped.length === 1 ? '' : 's'}`;
    process.stdout.write(partial ? `${n} would be skipped when opened in the viewer\n` : `${n} with errors, and nothing usable would be left: the viewer could not build a model\n`);
  }
}

process.exitCode = ok && !(flags.has('--strict') && (warnings.length || repairs.length)) ? 0 : 1; // not process.exit(): a large report on a pipe must be flushed first
