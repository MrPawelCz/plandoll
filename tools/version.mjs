// The version mark of the page: "2026-11-17v04 · 3bcb848" in the bottom right corner, written by tools/build.mjs as plain HTML.
// It starts with the day of the commit the page was built from (UTC) and the number of that commit among the commits of the same day on the main line of the
// history (v01 is the first of the day); then come the first seven characters of the commit, a "+" after them when the tree had uncommitted changes, and just
// "dev" outside git. The day and the number are read from the history of git and nothing here reads the clock, so two builds of one commit are the same bytes
// (the page of GitHub Pages is built in CI, with the whole history, and compared with the local build), and the mark can be read from the HTML without a browser.
import { execFileSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// head: the full hash of the commit ('' outside git); dirty: the tracked files differ from that commit; date: the day of the commit, YYYY-MM-DD in UTC;
// seq: the number of the commit among the commits of that day, 1 and up (0 when it is not known: a shallow clone has cut the history, so a count would be wrong,
// and a page without a number shows it is not the page of the workflow that counts the whole history).
// Returns { text, date }: the words of the mark and the day of the commit ('' when unknown, and always '' for "dev").
export function versionMark({ head, dirty = false, date = '', seq = 0 } = {}) {
  const h = String(head ?? '').trim().toLowerCase();
  if (!SHA.test(h)) return { text: 'dev', date: '' };
  const day = DAY.test(String(date ?? '').trim()) ? String(date).trim() : '';
  const number = day && Number.isInteger(seq) && seq > 0 ? `v${String(seq).padStart(2, '0')}` : '';
  const commit = `${h.slice(0, 7)}${dirty ? '+' : ''}`;
  return { text: day ? `${day}${number} · ${commit}` : commit, date: day };
}

// What git says about the tree at `root`: { head, dirty, date, seq }, all empty, false or 0 when there is no git or no repository there. `ref` is the commit to
// describe (the head of the tree by default; a commit that is not the head is never dirty). The day is the day of the commit in UTC, whatever zone it was made in,
// and seq counts the commits of that day on the first-parent line that ends in the commit, the commit itself included. `run` is execFileSync unless a test passes its own.
export function gitState(root, run = execFileSync, ref = 'HEAD') {
  const git = (...args) => {
    try { return String(run('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 })).trim(); } catch { return ''; }
  };
  const head = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (!SHA.test(head)) return { head: '', dirty: false, date: '', seq: 0 };
  const dirty = ref === 'HEAD' && git('status', '--porcelain', '--untracked-files=no') !== '';
  const times = git('log', '--first-parent', '--format=%ct', head).split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).map(Number);
  const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const date = times.length ? dayOf(times[0]) : '';
  let seq = 0;
  if (date && git('rev-parse', '--is-shallow-repository') !== 'true') for (const t of times) { if (dayOf(t) !== date) break; seq++; }
  return { head, dirty, date, seq };
}

// The element of the page. The mark is inert (it takes no pointer, so it never covers a button or a gesture) and sits under the bars: it comes first in the
// document, and the bars that the page builds later paint over it.
export const MARK_CSS = '#ps-version{position:fixed;right:10px;bottom:4px;padding:0 7px;border-radius:6px;background:rgba(250,244,232,.62);color:rgba(74,59,42,.82);font:600 11px/13px ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;pointer-events:none;-webkit-user-select:none;user-select:none}';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function markHtml(mark) {
  return `<div id="ps-version"${mark.date ? ` data-date="${escapeHtml(mark.date)}"` : ''}>${escapeHtml(mark.text)}</div>`;
}
