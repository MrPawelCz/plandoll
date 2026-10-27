// The version mark of the page: "v0.2.0 · 3bcb848" in the bottom right corner, written by tools/build.mjs as plain HTML.
// The number is the version of package.json, raised with every publication; the rest says which commit the page was built from: its first seven
// characters, a "+" after them when the tree had uncommitted changes, "dev" outside git. Nothing here reads the clock, so two builds of one commit are
// the same bytes (the page of GitHub Pages is built in CI and compared with the local build), and the mark can be read from the HTML without a browser.
import { execFileSync } from 'node:child_process';

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// version: the field of package.json; head: the full hash of the commit ('' outside git); dirty: the tracked files differ from that commit; date: its day, YYYY-MM-DD.
// Returns { text, date }: the words of the mark and the day of the commit ('' when unknown, and always '' for "dev").
export function versionMark({ version, head, dirty = false, date = '' } = {}) {
  const v = String(version ?? '').trim();
  if (!SEMVER.test(v)) throw new Error(`the version in package.json is "${v}", not a number like 1.2.3`);
  const h = String(head ?? '').trim().toLowerCase();
  if (!SHA.test(h)) return { text: `v${v} · dev`, date: '' };
  const day = String(date ?? '').trim();
  return { text: `v${v} · ${h.slice(0, 7)}${dirty ? '+' : ''}`, date: DAY.test(day) ? day : '' };
}

// What git says about the tree at `root`: { head, dirty, date }, all empty or false when there is no git or no repository there.
// `run` is execFileSync unless a test passes its own.
export function gitState(root, run = execFileSync) {
  const git = (...args) => {
    try { return String(run('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 })).trim(); } catch { return ''; }
  };
  const head = git('rev-parse', 'HEAD');
  if (!SHA.test(head)) return { head: '', dirty: false, date: '' };
  return { head, dirty: git('status', '--porcelain', '--untracked-files=no') !== '', date: git('show', '-s', '--format=%cs', 'HEAD') };
}

// The element of the page. The mark is inert (it takes no pointer, so it never covers a button or a gesture) and sits under the bars: it comes first in the
// document, and the bars that the page builds later paint over it.
export const MARK_CSS = '#ps-version{position:fixed;right:10px;bottom:4px;padding:0 7px;border-radius:6px;background:rgba(250,244,232,.62);color:rgba(74,59,42,.82);font:600 10px/12px ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;pointer-events:none;-webkit-user-select:none;user-select:none}';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function markHtml(mark) {
  return `<div id="ps-version"${mark.date ? ` data-date="${escapeHtml(mark.date)}"` : ''}>${escapeHtml(mark.text)}</div>`;
}
