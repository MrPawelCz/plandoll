// The version mark of the page (tools/version.mjs, tools/build.mjs and one line of main.js): the words of the mark, what is read from git (with a stand-in runner and
// with real repositories made for the test), the element of the built page, and ui=0 taking it away. The build test builds the page into a temporary directory, as
// tests/look/interact.test.mjs does.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MARK_CSS, gitState, markHtml, versionMark } from '../../tools/version.mjs';

// The day of the mark is the day in UTC, wherever the commit was made and wherever the page is built. These tests run in a zone 13 hours ahead of UTC in October (New Zealand summer time),
// so that a day taken from the local calendar fails them on every machine: in CI (which runs in UTC) and here (London is UTC in winter) alike it would pass unnoticed.
process.env.TZ = 'Pacific/Auckland';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHA = '3bcb848f0e1d2c3b4a5968778695a4b3c2d1e0f9';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

test('the mark names the day of the commit, its number among the commits of that day and the first seven characters of the commit', () => {
  assert.deepEqual(versionMark({ head: SHA, date: '2026-10-27', seq: 4 }), { text: '2026-10-27v04 · 3bcb848', date: '2026-10-27' });
  assert.equal(versionMark({ head: SHA, date: '2026-10-27', seq: 1 }).text, '2026-10-27v01 · 3bcb848', 'two digits at least, as the numbers of the other sites of the same owner');
  assert.equal(versionMark({ head: SHA, date: '2026-10-27', seq: 12 }).text, '2026-10-27v12 · 3bcb848');
  assert.equal(versionMark({ head: SHA, date: '2026-10-27', seq: 123 }).text, '2026-10-27v123 · 3bcb848', 'a busy day grows the number, it is never cut');
  assert.deepEqual(versionMark({ head: SHA.toUpperCase(), date: '2026-10-27', seq: 2 }), { text: '2026-10-27v02 · 3bcb848', date: '2026-10-27' }, 'a hash in capitals is read as lower case');
});

test('a number that is not known is left out, never made up: a shallow clone shows the day and the commit only', () => {
  for (const seq of [0, -1, 1.5, NaN, null, undefined, '3']) assert.equal(versionMark({ head: SHA, date: '2026-10-27', seq }).text, '2026-10-27 · 3bcb848', String(seq));
  assert.equal(versionMark({ head: SHA, date: '2026-10-27' }).text, '2026-10-27 · 3bcb848');
});

test('a tree with uncommitted changes carries a plus, and a page built outside git says dev, with no day', () => {
  assert.equal(versionMark({ head: SHA, dirty: true, date: '2026-10-27', seq: 4 }).text, '2026-10-27v04 · 3bcb848+');
  for (const head of ['', undefined, null, 'abc123', SHA.slice(1), `${SHA}0`, 'z'.repeat(40)]) {
    assert.deepEqual(versionMark({ head, dirty: true, date: '2026-10-27', seq: 4 }), { text: 'dev', date: '' }, String(head));
  }
});

test('a day that is not a day is left out with its number, and the same input always gives the same words (nothing reads the clock)', () => {
  for (const date of ['', 'today', '27/10/2026', '2026-10-27T10:00', '2026-1-7', null, undefined]) {
    assert.deepEqual(versionMark({ head: SHA, date, seq: 4 }), { text: '3bcb848', date: '' }, String(date));
  }
  const a = versionMark({ head: SHA, date: '2026-10-27', seq: 4 }), b = versionMark({ head: SHA, date: '2026-10-27', seq: 4 });
  assert.deepEqual(a, b);
  assert.doesNotMatch(a.text, /\d{1,2}:\d{2}/, 'no time of day in the mark');
});

// A stand-in for execFileSync that answers the questions of gitState; `log` is the list of commit times (seconds, newest first) of the first-parent line.
const standIn = ({ head = SHA, status = '', log = [], shallow = 'false', calls = [] } = {}) => (cmd, args, opts) => {
  calls.push({ cmd, args, cwd: opts.cwd });
  if (args[0] === 'rev-parse' && args[1] === '--verify') return `${head}\n`;
  if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return `${shallow}\n`;
  if (args[0] === 'status') return status;
  if (args[0] === 'log') return log.map((t) => `${t}\n`).join('');
  throw new Error('unexpected');
};
const unix = (iso) => Date.parse(iso) / 1000;

test('the git reading asks for the head, the tracked files, the history of the main line and the shallow flag, in the tree it was given', () => {
  const calls = [];
  const log = [unix('2026-10-27T15:00:00Z'), unix('2026-10-27T09:00:00Z'), unix('2026-10-26T23:59:00Z')];
  assert.deepEqual(gitState('/some/tree', standIn({ log, calls })), { head: SHA, dirty: false, date: '2026-10-27', seq: 2 });
  assert.ok(calls.every((c) => c.cmd === 'git' && c.cwd === '/some/tree'));
  assert.deepEqual(calls.find((c) => c.args[0] === 'status').args, ['status', '--porcelain', '--untracked-files=no'], 'only tracked files make a tree dirty (node_modules and tmp stay out)');
  assert.deepEqual(calls.find((c) => c.args[0] === 'log').args, ['log', '--first-parent', '--format=%ct', SHA], 'the main line only, from the commit that is described');
  assert.deepEqual(calls.find((c) => c.args[1] === '--verify').args, ['rev-parse', '--verify', 'HEAD^{commit}']);
});

test('the number counts the commits of the same day in UTC from the newest, and stops at the first commit of an earlier day', () => {
  const day = (...iso) => iso.map(unix);
  // the day is the day in UTC: 23:59:59 on the 26th is not the 27th
  assert.equal(gitState('/t', standIn({ log: day('2026-10-27T10:00:00Z') })).seq, 1);
  assert.equal(gitState('/t', standIn({ log: day('2026-10-27T10:00:00Z', '2026-10-27T00:00:00Z') })).seq, 2, 'the first second of the day counts for that day');
  assert.deepEqual(gitState('/t', standIn({ log: day('2026-10-26T23:30:00Z', '2026-10-26T12:00:00Z', '2026-10-25T12:00:00Z') })), { head: SHA, dirty: false, date: '2026-10-26', seq: 2 });
  assert.equal(gitState('/t', standIn({ log: day('2026-10-27T10:00:00Z', '2026-10-26T23:59:59Z', '2026-10-27T08:00:00Z') })).seq, 1, 'the count stops at the first earlier day, a later commit of the same day beyond it is not counted');
});

test('a shallow clone gives the day but no number, and a commit that is not the head is never dirty', () => {
  const log = [unix('2026-10-27T15:00:00Z')];
  assert.deepEqual(gitState('/t', standIn({ log, shallow: 'true' })), { head: SHA, dirty: false, date: '2026-10-27', seq: 0 });
  assert.equal(gitState('/t', standIn({ log, shallow: '--is-shallow-repository' })).seq, 0, 'a git too old to know the question echoes it: no number rather than a wrong one');
  assert.equal(gitState('/t', standIn({ log, shallow: '' })).seq, 0, 'no answer, no number');
  const calls = [];
  assert.deepEqual(gitState('/t', standIn({ log, status: ' M src/app/main.js\n', calls }), 'v1.0'), { head: SHA, dirty: false, date: '2026-10-27', seq: 1 });
  assert.ok(!calls.some((c) => c.args[0] === 'status'), 'a tag or a hash is a commit, not a tree');
  assert.deepEqual(calls.find((c) => c.args[1] === '--verify').args, ['rev-parse', '--verify', 'v1.0^{commit}']);
});

test('changed tracked files make the tree dirty, and no git, no repository or an unreadable history leave what is unknown empty', () => {
  assert.equal(gitState('/t', standIn({ status: ' M src/app/main.js\n', log: [unix('2026-10-27T15:00:00Z')] })).dirty, true);
  const none = () => { throw new Error('git: not found'); };
  assert.deepEqual(gitState('/t', none), { head: '', dirty: false, date: '', seq: 0 });
  const garbage = () => 'fatal: not a git repository';
  assert.deepEqual(gitState('/t', garbage), { head: '', dirty: false, date: '', seq: 0 });
  assert.deepEqual(gitState('/t', standIn({ log: [] })), { head: SHA, dirty: false, date: '', seq: 0 }, 'a head without a readable history has no day and no number');
  const noisy = standIn({ log: ['x', '', 'NaN'] });
  assert.deepEqual(gitState('/t', noisy), { head: SHA, dirty: false, date: '', seq: 0 });
});

// Real repositories, made for the test: the commits get the times of the test, so the day and the number do not depend on the day the test runs.
const scratch = mkdtempSync(join(tmpdir(), 'plandoll-version-git-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const git = (cwd, args, when, authored = when) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...(when ? { GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: when } : {}) },
}).trim();

test('in real repositories: the day goes by UTC, the number counts the day on the main line, a shallow clone has none', () => {
  const repo = join(scratch, 'repo');
  git(scratch, ['init', '-q', '-b', 'main', repo]);
  const commit = (name, when) => { writeFileSync(join(repo, 'file.txt'), `${name}\n`); git(repo, ['add', 'file.txt']); git(repo, ['commit', '-q', '-m', name], when); return git(repo, ['rev-parse', 'HEAD']); };
  const c1 = commit('one', '2026-10-26T12:00:00+00:00');
  const c2 = commit('two', '2026-10-27T00:30:00+01:00'); // 23:30 UTC on the 26th
  const c3 = commit('three', '2026-10-27T00:10:00+00:00');
  const c4 = commit('four', '2026-10-27T09:00:00+00:00');
  assert.deepEqual(gitState(repo), { head: c4, dirty: false, date: '2026-10-27', seq: 2 });
  assert.deepEqual(gitState(repo, execFileSync, c3), { head: c3, dirty: false, date: '2026-10-27', seq: 1 });
  assert.deepEqual(gitState(repo, execFileSync, c2), { head: c2, dirty: false, date: '2026-10-26', seq: 2 }, 'the clock on the wall said the 27th, UTC says the 26th');
  assert.deepEqual(gitState(repo, execFileSync, c1), { head: c1, dirty: false, date: '2026-10-26', seq: 1 });
  assert.equal(versionMark(gitState(repo)).text, `2026-10-27v02 · ${c4.slice(0, 7)}`);
  writeFileSync(join(repo, 'untracked.txt'), 'x\n');
  assert.equal(gitState(repo).dirty, false, 'an untracked file does not make the tree dirty');
  writeFileSync(join(repo, 'file.txt'), 'changed\n');
  assert.equal(gitState(repo).dirty, true);
  const shallow = join(scratch, 'shallow');
  git(scratch, ['clone', '-q', '--depth', '1', pathToFileURL(repo).href, shallow]);
  assert.deepEqual(gitState(shallow), { head: c4, dirty: false, date: '2026-10-27', seq: 0 }, 'a clone with a cut history knows the day but cannot count, so it gives no number');
  assert.equal(versionMark(gitState(shallow)).text, `2026-10-27 · ${c4.slice(0, 7)}`, 'the page of a workflow that forgot the whole history differs from the local build at once, in the open');
  assert.deepEqual(gitState(join(scratch, 'nowhere-at-all')), { head: '', dirty: false, date: '', seq: 0 });
});

test('in a real repository with a merge: the commits of the side branch are not counted, and the day is the day the commit was made, not the day it was written', () => {
  const repo = join(scratch, 'merge');
  git(scratch, ['init', '-q', '-b', 'main', repo]);
  const commit = (name, when, authored, file = 'file.txt') => { writeFileSync(join(repo, file), `${name}\n`); git(repo, ['add', file]); git(repo, ['commit', '-q', '-m', name], when, authored); return git(repo, ['rev-parse', 'HEAD']); };
  commit('base', '2026-10-26T12:00:00+00:00');
  git(repo, ['checkout', '-q', '-b', 'side']);
  commit('side one', '2026-10-27T08:00:00+00:00', undefined, 'side.txt'); // another file, so that the merge has no conflict
  commit('side two', '2026-10-27T08:30:00+00:00', undefined, 'side.txt');
  git(repo, ['checkout', '-q', 'main']);
  const one = commit('main one', '2026-10-27T09:00:00+00:00');
  git(repo, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], '2026-10-27T10:00:00+00:00');
  const merged = git(repo, ['rev-parse', 'HEAD']);
  assert.equal(git(repo, ['rev-list', '--count', 'HEAD']), '5', 'five commits are reachable, three of them on the main line');
  assert.deepEqual(gitState(repo), { head: merged, dirty: false, date: '2026-10-27', seq: 2 }, 'the merge and the commit before it: the two commits of the side branch are not on the main line');
  assert.deepEqual(gitState(repo, execFileSync, one), { head: one, dirty: false, date: '2026-10-27', seq: 1 });
  // a commit written on the 25th and made (rebased, cherry-picked, amended) on the 27th belongs to the 27th
  const later = commit('rewritten', '2026-10-27T11:00:00+00:00', '2026-10-25T09:00:00+00:00');
  assert.equal(git(repo, ['log', '-1', '--format=%as'], undefined), '2026-10-25', 'the author date of the commit is the 25th');
  assert.deepEqual(gitState(repo), { head: later, dirty: false, date: '2026-10-27', seq: 3 }, 'the committer date decides: the 27th, the third commit of the day on the main line');
});

test('the element is plain HTML with the words escaped, and the day only when there is one', () => {
  assert.equal(markHtml({ text: '2026-10-27v04 · 3bcb848', date: '2026-10-27' }), '<div id="ps-version" data-date="2026-10-27">2026-10-27v04 · 3bcb848</div>');
  assert.equal(markHtml({ text: 'dev', date: '' }), '<div id="ps-version">dev</div>');
  assert.equal(markHtml({ text: '<b>&"', date: 'x"y' }), '<div id="ps-version" data-date="x&quot;y">&lt;b&gt;&amp;&quot;</div>');
});

test('the style keeps the mark small, inert and under the bars of the page', () => {
  assert.match(MARK_CSS, /^#ps-version\{/);
  assert.match(MARK_CSS, /position:fixed/);
  assert.match(MARK_CSS, /right:10px;bottom:4px/, 'the lower right corner, below the bar that stands 18 px above the edge');
  assert.match(MARK_CSS, /pointer-events:none/, 'it never covers a button or takes a gesture from the camera');
  assert.doesNotMatch(MARK_CSS, /z-index/, 'it comes first in the page, and the bars that the page builds later paint over it');
  const size = /font:600 (\d+)px\/(\d+)px/.exec(MARK_CSS);
  assert.ok(size && Number(size[1]) >= 11 && Number(size[1]) <= 12 && Number(size[2]) <= 13, 'a small print, but not under the 11 px that text which carries information gets');
});

test('package.json and the lock file carry the same version, a number like 1.2.3 (the description for programs says it; the mark of the page does not)', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(lock.version, pkg.version, 'package-lock.json: raise the version there when package.json goes up');
  assert.equal(lock.packages[''].version, pkg.version);
});

test('the workflows fetch the whole history, because the number of the commit among the commits of its day is counted from it', () => {
  for (const name of ['ci', 'pages']) {
    const yml = readFileSync(join(root, `.github/workflows/${name}.yml`), 'utf8');
    assert.match(yml, /uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0(?: #[^\n]*)?\n/, `${name}.yml: checkout with fetch-depth: 0`);
  }
});

const dir = mkdtempSync(join(tmpdir(), 'plandoll-version-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('the built page carries the mark before its script, with exactly the words that git gives for the tree', () => {
  const built = spawnSync(process.execPath, [join(root, 'tools/build.mjs'), '--out', dir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const file = join(dir, 'plandoll.html'), html = readFileSync(file, 'utf8');
  assert.equal(html.split('id="ps-version"').length, 2, 'one mark');
  const at = html.indexOf('id="ps-version"');
  assert.ok(at > html.indexOf('</noscript>') && at < html.indexOf('<script>'), 'after the noscript note and before the script: the page of plandoll.com keeps everything up to the first script');
  const m = /<div id="ps-version"(?: data-date="(\d{4}-\d{2}-\d{2})")?>([^<]*)<\/div>/.exec(html);
  assert.ok(m, 'the element');
  const words = /^(?:(\d{4}-\d{2}-\d{2})(v\d{2,})? · )?([0-9a-f]{7}\+?)$|^dev$/.exec(m[2]);
  assert.ok(words, `the words "${m[2]}"`);
  assert.doesNotMatch(m[2], /^v\d+\.\d+\.\d+/, 'the version of package.json is not what the mark says any more');
  const expected = versionMark(gitState(root));
  assert.equal(m[2], expected.text, 'the mark is what git says about the tree the page was built from');
  assert.equal(m[1], expected.date || undefined, 'the day of the commit, and no day without a commit');
  if (m[2] === 'dev') assert.equal(m[1], undefined, 'no day without a commit');
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
