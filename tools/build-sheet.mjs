// Bundles any entry (a contact sheet page, a test page) into one standalone HTML file next to the product build.
//   node tools/build-sheet.mjs <entry.js> <out.html>      e.g. node tools/build-sheet.mjs tools/sheet-entry.js dist/furniture-sheet.html
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [entry, out] = process.argv.slice(2);
if (!entry || !out) { console.error('usage: node tools/build-sheet.mjs <entry.js> <out.html>'); process.exit(2); }
const result = await build({ entryPoints: [resolve(root, entry)], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none', logLevel: 'warning' });
const code = result.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
mkdirSync(dirname(resolve(root, out)), { recursive: true });
writeFileSync(resolve(root, out), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>sheet</title><style>html,body{margin:0;overflow:hidden;background:#dedad3}canvas{display:block}</style></head><body><script>${code}</script></body></html>\n`);
console.log(`${out} ${(code.length / 1024).toFixed(0)} KiB`);
