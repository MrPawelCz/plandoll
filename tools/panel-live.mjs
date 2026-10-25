// The panel on the real page (edit=1) with a real session: opens the list, selects a piece, changes size and colour, selects a room and
// changes its colours. One screenshot per step and viewport, plus an audit of touch targets and overlaps printed after each shot.
//   node tools/panel-live.mjs [--out DIR] [--html FILE] [--steps list,sel,size,room] [--sizes 390x844,1100x700]
// Chrome runs through tools/shot.mjs (one browser at a time: run this under tools/chrome-lock.sh; PS_ANGLE=metal draws on the GPU).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : dflt; };
const out = resolve(arg('out', 'shots'));
const html = resolve(arg('html', join(root, 'dist/plandoll.html')));
const steps = arg('steps', 'list,sel,size,room').split(',');
const sizes = arg('sizes', '390x844,1100x700').split(',');

// Runs in the page after it has drawn its frames; the step comes from the address (step=...).
const PROGRAM = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = new URLSearchParams(location.hash.slice(1)).get('step');
  const q = (s) => document.querySelector(s), all = (s) => [...document.querySelectorAll(s)];
  const ed = window.__edit;
  const out = { step, edit: !!ed, errors: [] };
  if (!ed) return JSON.stringify(out);
  const toggle = q('.psp-toggle');
  const open = async () => { if (toggle && toggle.getAttribute('aria-expanded') !== 'true') { toggle.click(); await sleep(350); } };
  const expand = async (head) => { if (head && head.getAttribute('aria-expanded') === 'false') { head.click(); await sleep(250); } };
  const last = () => { const lv = ed.session.state.layout.levels.find((l) => l.pieces.length); return lv ? lv.pieces[lv.pieces.length - 1] : null; };
  try {
    if (step === 'list') { await open(); await expand(q('.psp-group-head')); }
    if (step === 'sel' || step === 'size') {
      ed.session.add('sofa3'); await sleep(400); await open(); await expand(q('.psp-sel .psp-sel-head'));
      out.before = JSON.stringify(last()?.size ?? null);
    }
    if (step === 'size') {
      const num = q('.psp-num');
      if (num) { num.value = String(Math.round(Number(num.getAttribute('max')) * 0.9)); num.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300); }
      const sw = all('.psp-sel .psp-slot')[0]?.querySelectorAll('.psp-sw')[2];
      if (sw) { sw.click(); await sleep(300); }
      out.after = JSON.stringify(last()?.size ?? null); out.colors = JSON.stringify(last()?.colors ?? null);
    }
    if (step === 'room') {
      const lv = ed.session.state.layout.levels[0]?.id ?? 'L0';
      ed.session.selectRoom(lv, 'living'); await sleep(400); await open(); await expand(q('.psp-room .psp-sel-head'));
      for (const row of all('.psp-room .psp-slot')) { row.querySelectorAll('.psp-sw')[2]?.click(); await sleep(200); }
      out.room = JSON.stringify(ed.session.selectedRoom()?.colors ?? null);
    }
  } catch (e) { out.errors.push(String(e).slice(0, 120)); }
  await sleep(300);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const small = all('.psp-root button, .psp-root input, .psp-root select').filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { c: e.className.toString().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44);
  const groups = {}; for (const s of small) groups[s.c + ' ' + s.w + 'x' + s.h] = (groups[s.c + ' ' + s.w + 'x' + s.h] || 0) + 1;
  out.small = groups;
  const rect = (s) => { const e = q(s); if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const hit = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  out.panel = rect('.psp-root'); out.sheet = rect('.psp-sheet');
  out.overlap = ['#ps-ui', '#ps-edit', '#ps-edit-msg', '#ps-edit-menu', '#ps-hint'].filter((s) => hit(out.panel, rect(s)) || hit(out.sheet, rect(s)));
  const sh = q('.psp-sheet'); out.sheetScroll = sh ? [sh.scrollHeight, sh.clientHeight] : null;
  out.cut = all('.psp-root *').filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1).length;
  return JSON.stringify(out);
})()`;

let failed = 0;
for (const size of sizes) {
  const jobs = steps.map((s) => `${size}-${s}=preset=amber&edit=1&step=${s}:2`);
  const r = spawnSync(process.execPath, [join(root, 'tools/shot.mjs'), '--html', html, '--size', size, '--out', out, '--timeout', '25', '--eval', PROGRAM, ...jobs],
    { encoding: 'utf8', maxBuffer: 1 << 24, env: process.env });
  process.stdout.write((r.stdout ?? '').split('\n').map((l) => l.slice(0, 700)).join('\n'));
  if (r.status) failed++;
}
process.exit(failed ? 1 : 0);
