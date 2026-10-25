// Builds the review page of the editor panel (tools/panel-entry.js) into one HTML file.
//   node tools/panel-sheet.mjs [out.html]
// Then take shots, one invocation per screen size (the hash carries the options, see panel-entry.js):
//   node tools/shot.mjs --html out.html --size 390x844 --out DIR phone=open=1&groups=living
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(tmpdir(), 'plandoll-panel.html');
const res = spawnSync(process.execPath, [join(root, 'tools/build-sheet.mjs'), 'tools/panel-entry.js', out], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
