// Bundles src/app/main.js with three.js into one self-contained dist/plandoll.html (examples embedded as JSON).
// esbuild is a dev dependency; nothing here runs in the product.
//   node tools/build.mjs [--out DIR]        (DIR defaults to dist; the tests build into a temporary one)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES_URL, jsonLd, jsonLdBlock } from './agent-files.mjs';
import { MARK_CSS, gitState, markHtml, versionMark } from './version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
if (outIdx >= 0 && !process.argv[outIdx + 1]) { console.error('usage: node tools/build.mjs [--out DIR]'); process.exit(2); }
const dist = outIdx >= 0 ? resolve(process.argv[outIdx + 1]) : join(root, 'dist');

const TITLE = 'plandoll';

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
// The version mark in the corner of the page (tools/version.mjs): the version of package.json and the commit the page is built from.
const mark = versionMark({ version, ...gitState(root) });
// The description of the page for programs (tools/agent-files.mjs), in the head, with the address of GitHub Pages: a host with an address of its own swaps the block for its own.
const ld = jsonLdBlock(jsonLd({ base: PAGES_URL, version }));

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

// The loading icon is plain CSS in the HTML, so it turns before the script runs; the page takes it away when the first frame is drawn (main.js, leaveLoading). data-intro on the body says where the
// page is: "loading" (until the first frame), "playing" (the intro) and "done". The control bar and its hint stay hidden in the first two and fade in at "done"; the two animations at the end of
// the rules are the failsafe of the style alone: whatever happens to the script, the icon is gone after 60 s, and the bar is back after 90 s of "loading" or 40 s of "playing" (two animations with
// two names, so the clock starts over when the state changes). The script has its own failsafe, 15 s after the first frame, which comes first; these are long because the clock of an animation runs
// with the frames, and a thread that was blocked for seconds (the shaders of a slow device) has made it jump ahead by ten seconds and more: 20 s was seen to run out 6 s into an intro that played. A request for less motion stops the icon turning.
const LOADING_CSS = [
  '#ps-loading{position:fixed;left:50%;top:50%;z-index:50;width:28px;height:28px;margin:-14px 0 0 -14px;box-sizing:border-box;border:3px solid rgba(74,59,42,.18);border-top-color:#c8793a;border-radius:50%;pointer-events:none;animation:ps-spin .8s linear infinite,ps-load-off 0s linear 60s forwards}',
  '@keyframes ps-spin{to{transform:rotate(360deg)}}@keyframes ps-load-off{to{opacity:0;visibility:hidden}}@keyframes ps-show-wait{to{opacity:1;pointer-events:auto}}@keyframes ps-show-play{to{opacity:1;pointer-events:auto}}',
  '@media (prefers-reduced-motion:reduce){#ps-loading{animation:ps-load-off 0s linear 60s forwards}}',
  'body[data-intro-fade] #ps-ui,body[data-intro-fade] #ps-hint{transition:opacity .45s ease}',
  'body[data-intro=loading] #ps-ui,body[data-intro=loading] #ps-hint,body[data-intro=playing] #ps-ui,body[data-intro=playing] #ps-hint{opacity:0;pointer-events:none}',
  'body[data-intro=loading] #ps-ui,body[data-intro=loading] #ps-hint{animation:ps-show-wait 0s linear 90s forwards}',
  'body[data-intro=playing] #ps-ui,body[data-intro=playing] #ps-hint{animation:ps-show-play 0s linear 40s forwards}',
].join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<!--
${NOTICE}
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><meta name="description" content="Turn a floor plan into a furnished, lit miniature of the flat, in your browser."><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#e9dfcf;overflow:hidden;overscroll-behavior:none}canvas{display:block}noscript{font:14px/1.4 ui-rounded,system-ui,sans-serif;color:#4a3b2a;display:block;padding:24px}${MARK_CSS}${LOADING_CSS}</style><noscript><style>#ps-loading{display:none}</style></noscript>${ld}
</head><body data-intro="loading"><div id="ps-loading" role="status" aria-label="Loading / Wczytywanie"></div><noscript>This page needs JavaScript. Ta strona potrzebuje JavaScriptu.</noscript>${markHtml(mark)}<script>${code}</script></body></html>
`;
mkdirSync(dist, { recursive: true });
const file = join(dist, 'plandoll.html');
writeFileSync(file, html);
console.log(`built ${file} (${statSync(file).size} bytes)`);
