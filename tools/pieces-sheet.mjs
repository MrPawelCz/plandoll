// Builds the furniture contact sheet page (tools/sheet-entry.js) into one HTML file.
//   node tools/pieces-sheet.mjs [out.html]
// Then take one view per call (the hash carries the options):
//   node tools/shot.mjs --html out.html --size 1600x900 --out DIR name=az=35&el=30&cols=3&types=sofa3,sofa2,armchair:2
// Different azimuths (35, 125, 215, 305) of the same sheet give four sides.
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(tmpdir(), 'planstage-sheet.html');
const res = spawnSync(process.execPath, [join(root, 'tools/build-sheet.mjs'), 'tools/sheet-entry.js', out], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
