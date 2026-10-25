// Builds the material contact sheet page (tools/materials-entry.js) into one HTML file.
//   node tools/materials-sheet.mjs [out.html]
// Then take one view per call (the hash carries the options):
//   node tools/shot.mjs --html out.html --size 1600x900 --out DIR name=light=warm&cols=5&az=20&el=32
//   node tools/shot.mjs --html out.html --size 1600x900 --out DIR name=light=cool&keys=oak,boucle,leather&cols=3
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(tmpdir(), 'plandoll-materials.html');
const res = spawnSync(process.execPath, [join(root, 'tools/build-sheet.mjs'), 'tools/materials-entry.js', out], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
