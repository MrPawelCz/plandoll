// The version mark of the page (tools/version.mjs, tools/build.mjs and one line of main.js): the words of the mark, what is read from git, the element of the
// built page, and ui=0 taking it away. The build test builds the page into a temporary directory, as tests/look/interact.test.mjs does.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK_CSS, gitState, markHtml, versionMark } from '../../tools/version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHA = '3bcb848f0e1d2c3b4a5968778695a4b3c2d1e0f9';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const CI_LIMIT = 1150000; // the bytes that the built page may take: the same limit as the step of .github/workflows/ci.yml

test('the mark names the version and the first seven characters of the commit, and the day of that commit', () => {
  assert.deepEqual(versionMark({ version: '0.2.0', head: SHA, date: '2026-10-27' }), { text: 'v0.2.0 · 3bcb848', date: '2026-10-27' });
  assert.deepEqual(versionMark({ version: '0.2.0', head: SHA.toUpperCase() }), { text: 'v0.2.0 · 3bcb848', date: '' }, 'a hash in capitals is read as lower case; no day is no day');
});

test('a tree with uncommitted changes carries a plus, and a page built outside git says dev, with no day', () => {
  assert.equal(versionMark({ version: '0.2.0', head: SHA, dirty: true, date: '2026-10-27' }).text, 'v0.2.0 · 3bcb848+');
  for (const head of ['', undefined, null, 'abc123', SHA.slice(1), `${SHA}0`, 'z'.repeat(40)]) {
    assert.deepEqual(versionMark({ version: '0.2.0', head, dirty: true, date: '2026-10-27' }), { text: 'v0.2.0 · dev', date: '' }, String(head));
  }
});

test('a day that is not a day is left out, and the same input always gives the same words (nothing reads the clock)', () => {
  for (const date of ['', 'today', '27/10/2026', '2026-10-27T10:00', null, undefined]) assert.equal(versionMark({ version: '1.0.0', head: SHA, date }).date, '', String(date));
  const a = versionMark({ version: '1.4.2', head: SHA, date: '2026-10-27' }), b = versionMark({ version: '1.4.2', head: SHA, date: '2026-10-27' });
  assert.deepEqual(a, b);
  assert.doesNotMatch(a.text, /\d{1,2}:\d{2}/, 'no time of day in the mark');
});

test('a version that is not a number like 1.2.3 stops the build instead of printing nonsense', () => {
  for (const version of ['', '1.2', 'x', '1.2.3.x', 'v1.2.3', undefined, null]) assert.throws(() => versionMark({ version, head: SHA }), /not a number/, String(version));
  assert.equal(versionMark({ version: '1.0.0-rc.1', head: SHA }).text, 'v1.0.0-rc.1 · 3bcb848');
});

test('the git reading asks for the head, the tracked files and the day of the head, in the tree it was given', () => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (args[0] === 'rev-parse') return `${SHA}\n`;
    if (args[0] === 'status') return '';
    if (args[0] === 'show') return '2026-10-27\n';
    throw new Error('unexpected');
  };
  assert.deepEqual(gitState('/some/tree', run), { head: SHA, dirty: false, date: '2026-10-27' });
  assert.deepEqual(calls.map((c) => c.cmd), ['git', 'git', 'git']);
  assert.ok(calls.every((c) => c.cwd === '/some/tree'));
  const status = calls.find((c) => c.args[0] === 'status');
  assert.deepEqual(status.args, ['status', '--porcelain', '--untracked-files=no'], 'only tracked files make a tree dirty (node_modules and tmp stay out)');
  assert.deepEqual(calls.find((c) => c.args[0] === 'show').args, ['show', '-s', '--format=%cs', 'HEAD']);
});

test('changed tracked files make the tree dirty, and no git or no repository leaves everything empty', () => {
  const dirty = (cmd, args) => (args[0] === 'rev-parse' ? SHA : args[0] === 'status' ? ' M src/app/main.js\n' : '2026-10-27');
  assert.equal(gitState('/t', dirty).dirty, true);
  const none = () => { throw new Error('git: not found'); };
  assert.deepEqual(gitState('/t', none), { head: '', dirty: false, date: '' });
  const garbage = () => 'fatal: not a git repository';
  assert.deepEqual(gitState('/t', garbage), { head: '', dirty: false, date: '' });
});

test('the element is plain HTML with the words escaped, and the day only when there is one', () => {
  assert.equal(markHtml({ text: 'v0.2.0 · 3bcb848', date: '2026-10-27' }), '<div id="ps-version" data-date="2026-10-27">v0.2.0 · 3bcb848</div>');
  assert.equal(markHtml({ text: 'v0.2.0 · dev', date: '' }), '<div id="ps-version">v0.2.0 · dev</div>');
  assert.equal(markHtml({ text: '<b>&"', date: 'x"y' }), '<div id="ps-version" data-date="x&quot;y">&lt;b&gt;&amp;&quot;</div>');
});

test('the style keeps the mark small, inert and under the bars of the page', () => {
  assert.match(MARK_CSS, /^#ps-version\{/);
  assert.match(MARK_CSS, /position:fixed/);
  assert.match(MARK_CSS, /right:10px;bottom:4px/, 'the lower right corner, below the bar that stands 18 px above the edge');
  assert.match(MARK_CSS, /pointer-events:none/, 'it never covers a button or takes a gesture from the camera');
  assert.doesNotMatch(MARK_CSS, /z-index/, 'it comes first in the page, and the bars that the page builds later paint over it');
  const size = /font:600 (\d+)px\/(\d+)px/.exec(MARK_CSS);
  assert.ok(size && Number(size[1]) <= 11 && Number(size[2]) <= 13, 'a small print');
});

test('package.json and the lock file carry the same version, a number like 1.2.3', () => {
  assert.doesNotThrow(() => versionMark({ version: pkg.version, head: SHA }));
  assert.equal(lock.version, pkg.version, 'package-lock.json: raise the version there when package.json goes up');
  assert.equal(lock.packages[''].version, pkg.version);
});

const dir = mkdtempSync(join(tmpdir(), 'plandoll-version-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('the built page carries the mark before its script, with the version of package.json, and stays within the size that CI allows', () => {
  const built = spawnSync(process.execPath, [join(root, 'tools/build.mjs'), '--out', dir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const file = join(dir, 'plandoll.html'), html = readFileSync(file, 'utf8');
  assert.ok(statSync(file).size <= CI_LIMIT, `the page is ${statSync(file).size} bytes, CI stops at ${CI_LIMIT}`);
  assert.equal(html.split('id="ps-version"').length, 2, 'one mark');
  const at = html.indexOf('id="ps-version"');
  assert.ok(at > html.indexOf('</noscript>') && at < html.indexOf('<script>'), 'after the noscript note and before the script: the page of plandoll.com keeps everything up to the first script');
  const m = /<div id="ps-version"(?: data-date="(\d{4}-\d{2}-\d{2})")?>([^<]*)<\/div>/.exec(html);
  assert.ok(m, 'the element');
  const words = /^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) · ([0-9a-f]{7}\+?|dev)$/.exec(m[2]);
  assert.ok(words, `the words "${m[2]}"`);
  assert.equal(words[1], pkg.version);
  if (words[2] === 'dev') assert.equal(m[1], undefined, 'no day without a commit'); else assert.ok(m[1], 'the day of the commit');
  assert.ok(html.includes(MARK_CSS), 'the style of the mark is in the head');
});

test('ui=0 takes the mark away before anything else happens on the page, and the editor and the plain page keep it', () => {
  const src = readFileSync(join(root, 'src/app/main.js'), 'utf8');
  const line = "if (!partsOf(params).controls) document.getElementById('ps-version')?.remove();";
  const at = src.indexOf(line), parsed = src.indexOf('const params = parseParams(location.hash'), decoded = src.indexOf('await decodeShare(params.share)');
  assert.ok(at > 0, 'the line is there');
  assert.ok(parsed > 0 && parsed < at && at < decoded, 'right after the address is read, before a share link is unpacked: no flash of the mark on a page that wants none');
  assert.equal(src.split("getElementById('ps-version')").length, 2, 'the page touches the mark nowhere else');
});
