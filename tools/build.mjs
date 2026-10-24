// Bundles src/app/main.js with three.js into one self-contained dist/planstage.html (examples embedded as JSON).
// esbuild is a dev dependency; nothing here runs in the product.
//   node tools/build.mjs [--out DIR]        (DIR defaults to dist; the tests build into a temporary one)
import { build } from 'esbuild';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
if (outIdx >= 0 && !process.argv[outIdx + 1]) { console.error('usage: node tools/build.mjs [--out DIR]'); process.exit(2); }
const dist = outIdx >= 0 ? resolve(process.argv[outIdx + 1]) : join(root, 'dist');

const TITLE = 'planstage';

const result = await build({
  entryPoints: [join(root, 'src/app/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'inline', // keeps the three.js licence notice inside the single file
  loader: { '.json': 'json' },
  logLevel: 'warning',
});
// Keep an inline script from ending the HTML script element early.
const neutralise = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const code = neutralise(result.outputFiles[0].text);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title>
<style>html,body{margin:0;height:100%;background:#e9dfcf;overflow:hidden}canvas{display:block}noscript{font:14px/1.4 ui-rounded,system-ui,sans-serif;color:#4a3b2a;display:block;padding:24px}</style>
</head><body><noscript>This page needs JavaScript. Ta strona potrzebuje JavaScriptu.</noscript><script>${code}</script></body></html>
`;
mkdirSync(dist, { recursive: true });
const file = join(dist, 'planstage.html');
writeFileSync(file, html);
console.log(`built ${file} (${statSync(file).size} bytes)`);
