// Bundles src/app/main.js with three.js into one self-contained dist/plandoll.html (examples embedded as JSON).
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

const TITLE = 'plandoll';

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

// Licence notices travel inside the file: it is distributed on its own, without the repository.
const NOTICE = `plandoll: MIT licence, copyright (c) 2026 Paweł Czerwiński, https://github.com/MrPawelCz/plandoll
Notices for every part of this file: THIRD_PARTY_LICENSES.md in that repository.

This file bundles three.js, distributed under the MIT licence:

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<!--
${NOTICE}
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><meta name="description" content="Turn a floor plan into a furnished, lit miniature of the flat, in your browser."><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#e9dfcf;overflow:hidden}canvas{display:block}noscript{font:14px/1.4 ui-rounded,system-ui,sans-serif;color:#4a3b2a;display:block;padding:24px}</style>
</head><body><noscript>This page needs JavaScript. Ta strona potrzebuje JavaScriptu.</noscript><script>${code}</script></body></html>
`;
mkdirSync(dist, { recursive: true });
const file = join(dist, 'plandoll.html');
writeFileSync(file, html);
console.log(`built ${file} (${statSync(file).size} bytes)`);
