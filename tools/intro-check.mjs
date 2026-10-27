// The intro of the page in a real browser (headless Chrome, software GL), with real input. A page that opens with the loading icon (plain CSS) shows data-intro "loading", then "playing"
// when the first frame is drawn and "done" when the story is over; the first model builds itself in at most 8 seconds: an empty plan, walls, windows and doors, furniture room by room with a
// counter ("piece N of M" / "mebel N z M") up to M of M, the words in the language of the page, the camera coming down to the view the page starts in. The check runs the story in real time and
// then holds it at chosen moments (window.__intro.seek) to read the words and to take four screenshots, compares the last frame of the intro with the first frame after it (no jump) and with the
// page without an intro (the scene after the intro is the usual scene), and tries every way of ending or avoiding it: a touch or a click on the picture and on the control bar (nothing else
// happens), a key (Space does not open the shell), the wheel (it does not zoom), intro=0, a request for less motion, the editor, ui=0, live=1, a frame rate that is too low. It also checks that
// the words keep clear of the marks of a page in its corners (#pd-brand and #pd-privacy of plandoll.com, when the page has them) and that the page makes no request of its own.
//   node tools/intro-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout 900] [--phone] [--q low|medium|high] [--only real,held,jump,skips,modes,plans,resized,slow,stuck]
// --q sets the quality of the page under test (default low, which the software renderer can bear), --only runs some of the parts (the names above) instead of all of them.
// --phone runs a touch window of 390 x 844 at scale 2. On a small machine run it under the Chrome lock (one browser at a time). CHROME names the browser (chrome-headless-shell is fine).
// Exits 1 when a step fails.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = { html: null, out: null, timeout: 900, q: 'low', only: null };
let phone = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--phone') phone = true;
  else if (argv[i].startsWith('--') && argv[i].slice(2) in opt && argv[i + 1] !== undefined) opt[argv[i].slice(2)] = argv[++i];
  else { console.error('usage: node tools/intro-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout S] [--phone] [--q low|medium|high] [--only real,held,jump,skips,modes,plans,resized,slow,stuck]'); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Q = ['low', 'medium', 'high'].includes(opt.q) ? opt.q : 'low'; // the quality of the page under test (low keeps the software renderer bearable)
const want = (k) => !opt.only || opt.only.split(',').includes(k);
const live = /^https?:\/\//i.test(opt.html ?? '');
const page = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const ownOrigin = live ? new URL(opt.html).origin : 'file://';
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });
const W = phone ? 390 : 1280, H = phone ? 844 : 800, SCALE = phone ? 2 : 1, tag = phone ? 'phone' : 'desktop';
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-intro-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--use-gl=angle', `--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map(), logs = [], requests = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const cleanup = async () => { try { ws?.close(); } catch { /* closed */ } chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

const steps = [];
const check = (name, ok, detail = '') => { steps.push({ name, ok: !!ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` | ${String(detail).slice(0, 360)}` : ''}`); };
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const waitFor = async (expression, ms = 30000, label = expression) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expression); if (v) return v; } catch { /* the page is busy */ } await sleep(120); }
  throw new Error(`timed out waiting for ${label}`);
};
const shotB64 = async () => (await send('Page.captureScreenshot', { format: 'png' })).data;
const shot = async (name) => { const b = await shotB64(); if (out) writeFileSync(join(out, `${tag}-${name}.png`), Buffer.from(b, 'base64')); return b; };

// ---------- pictures ----------
function decodePng(b64) {
  const buf = Buffer.from(b64, 'base64');
  let pos = 8, w = 0, h = 0, bpp = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); bpp = body[9] === 6 ? 4 : 3; if (body[8] !== 8 || (body[9] !== 6 && body[9] !== 2) || body[12] !== 0) throw new Error('a PNG of a kind that is not handled'); }
    else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
// How far two pictures are from each other: mean is the average difference of a colour channel (of 255) over all pixels, big the share of pixels where some channel differs by more than 32,
// block the largest difference of one channel between two blocks of 8 by 8 pixels (each averaged, which takes out the noise that two loads of a page put on soft shadows and occlusion).
function diff(a, b) {
  const A = decodePng(a), B = decodePng(b), F = 8;
  if (A.w !== B.w || A.h !== B.h || A.bpp !== B.bpp) return { mean: 255, big: 1, block: 255, why: 'the size differs' };
  let sum = 0, big = 0;
  const n = A.w * A.h;
  for (let p = 0; p < n; p++) {
    let worst = 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(A.px[p * A.bpp + k] - B.px[p * A.bpp + k]); sum += d; if (d > worst) worst = d; }
    if (worst > 32) big++;
  }
  const bw = Math.floor(A.w / F), bh = Math.floor(A.h / F);
  let block = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let k = 0; k < 3; k++) {
      let sa = 0, sb = 0;
      for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) { const i = ((by * F + y) * A.w + bx * F + x) * A.bpp + k; sa += A.px[i]; sb += B.px[i]; }
      block = Math.max(block, Math.abs(sa - sb) / (F * F));
    }
  }
  return { mean: sum / (n * 3), big: big / n, block };
}
const fmt = (d) => `mean ${d.mean.toFixed(3)}, ${(d.big * 100).toFixed(3)}% of pixels over 32, largest block ${d.block.toFixed(1)}`;

// ---------- real input ----------
const mouseTap = async (x, y, o = {}) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: o.button ?? 'left', buttons: o.button === 'right' ? 2 : 1, clickCount: 1 }); await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: o.button ?? 'left', buttons: 0, clickCount: 1 }); await sleep(o.settle ?? 300);
};
const touchTap = async (x, y, o = {}) => {
  await Promise.all([send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }), send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })]);
  await sleep(o.settle ?? 300);
};
const tap = (x, y, o) => (phone ? touchTap(x, y, o) : mouseTap(x, y, o));
const pressKey = async (key, code, vk, o = {}) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers: o.modifiers ?? 0, text: o.text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: o.modifiers ?? 0 }); await sleep(o.settle ?? 300); };
const wheel = async (x, y, dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(400); };

const rectOf = (sel) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return null; const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
  return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: !n.hidden && cs.display !== 'none' && r.width > 0, opacity: cs.opacity }; })()`);
const overlap = (a, b) => !!a && !!b && a.shown && b.shown && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
const camState = () => ev(`({ az: window.__camera.azimuth, pol: window.__camera.polar, dist: window.__camera.distance })`);
const sameCam = (a, b, eps = 1e-6) => Math.abs(a.az - b.az) < eps && Math.abs(a.pol - b.pol) < eps && Math.abs(a.dist - b.dist) < eps;

// The scripts every page gets before its own: a log of data-intro on the body (with the time, whether the loading icon was still there, and why the intro ended), and the switch that
// turns the frame-rate guard off for a page whose address carries guard=off (the software renderer is far slower than 15 frames a second, which is what the guard is for).
const OBSERVER = `(() => {
  if (/[#&]guard=off(&|$)/.test(location.hash)) window.__introNoGuard = true;
  const log = (window.__introLog = []), t0 = performance.now(); let last = null;
  const note = () => { const b = document.body, s = b ? (b.dataset.intro ?? null) : null; if (s !== last) { last = s; log.push({ s, t: Math.round(performance.now() - t0), loader: !!document.getElementById('ps-loading'), end: b?.dataset.introEnd ?? '' }); } };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-intro', 'data-intro-end'] });
  note();
})();`;

async function open(hash, ready = `document.body.dataset.intro === 'playing' || document.body.dataset.intro === 'done'`) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(250); // a change of the part after # alone would not reload the page
  await send('Page.navigate', { url: `${page}#${hash}` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`, 90000, 'the page');
  await waitFor(`!!window.__intro && ${ready}`, 90000, 'the intro hook and the first frame');
}
const stateNow = () => ev(`({ intro: document.body.dataset.intro, end: document.body.dataset.introEnd, state: window.__intro.state, reason: window.__intro.reason, how: window.__intro.how, t: window.__intro.t, root: !!document.getElementById('ps-intro'), shield: !!document.getElementById('ps-intro-shield'), loader: !!document.getElementById('ps-loading') })`);
const logOf = () => ev(`JSON.stringify(window.__introLog)`).then(JSON.parse);
const waitDone = (ms = 40000) => waitFor(`document.body.dataset.intro === 'done'`, ms, 'the end of the intro');
const barOpacity = () => ev(`getComputedStyle(document.getElementById('ps-ui')).opacity`).then(Number);
const hookWords = (lang) => (lang === 'pl'
  ? { chips: ['PUSTY RZUT', 'ŚCIANY', 'OKNA I DRZWI', 'MEBLE', 'GOTOWE'], skip: 'Dotknij, aby pominąć', count: (n, m) => `mebel ${n} z ${m}`, loading: 'Wczytywanie' }
  : { chips: ['EMPTY PLAN', 'WALLS', 'WINDOWS AND DOORS', 'FURNITURE', 'READY'], skip: 'Tap to skip', count: (n, m) => `piece ${n} of ${m}`, loading: 'Loading' });
// the words on the screen now
const words = () => ev(`(() => { const t = (id) => { const n = document.getElementById(id); return n && getComputedStyle(n).display !== 'none' ? n.textContent : null; };
  const o = (id) => { const n = document.getElementById(id); return n ? Number(getComputedStyle(n).opacity) : null; };
  return { chip: t('ps-intro-chip'), count: t('ps-intro-count'), hint: t('ps-intro-hint'), hintOpacity: o('ps-intro-hint'), chipOpacity: o('ps-intro-chip') }; })()`);
// where the closed model lands in the picture (px): every corner of its box must be inside the window
const projectCorners = () => ev(`(() => { const p = window.__shell && window.__shell.project(); if (!p) return null; return JSON.stringify({ w: p.w, h: p.h, pts: p.pts.filter((q) => q.kind === 'closed') }); })()`).then((s) => (s ? JSON.parse(s) : null));
const insideWindow = (p) => p.pts.every((q) => q.x >= 0 && q.x <= p.w && q.y >= 0 && q.y <= p.h);

// ---------- the real-time run ----------
// The software renderer draws a frame a second or so and a call to the page can wait for one, so the page is read once per round trip, from the first moment it is "playing" to the end, and every
// check is made on those readings afterwards (a check made after a few calls would find the intro over).
async function realTime(lang) {
  const T = hookWords(lang), name = `real-time run, ${lang}`;
  await open(`lang=${lang}&q=${Q}&guard=off`);
  const first = (await logOf())[0];
  check(`${name}: the page starts as "loading" with the loading icon on screen`, first && first.s === 'loading' && first.loader === true, JSON.stringify(first));
  const READ = `JSON.stringify((() => { const t = (id) => { const n = document.getElementById(id); return n && getComputedStyle(n).display !== 'none' ? n.textContent : null; };
    const o = (id) => { const n = document.getElementById(id); return n ? Number(getComputedStyle(n).opacity) : null; };
    return { s: document.body.dataset.intro, end: document.body.dataset.introEnd, t: window.__intro.t, chip: t('ps-intro-chip'), count: t('ps-intro-count'), hint: t('ps-intro-hint'), hintOpacity: o('ps-intro-hint'),
      bar: o('ps-ui'), shield: !!document.getElementById('ps-intro-shield'), root: !!document.getElementById('ps-intro'), loader: !!document.getElementById('ps-loading') }; })())`;
  const samples = [], seen = [], counts = [];
  const t0 = Date.now(); let lastText = null;
  while (Date.now() - t0 < 60000) {
    const r = JSON.parse(await ev(READ));
    samples.push(r);
    if (r.chip && r.chip !== lastText) { seen.push(r.chip); lastText = r.chip; }
    if (r.count) counts.push(r.count);
    if (r.s === 'done') break;
    await sleep(50);
  }
  await waitDone(5000);
  const playingNow = samples.filter((r) => r.s === 'playing');
  const log = await logOf();
  const done = log.find((e) => e.s === 'done'), play = log.find((e) => e.s === 'playing');
  check(`${name}: when the first frame is drawn the icon goes and the state is "playing"`, play && play.loader === false, JSON.stringify(play));
  check(`${name}: the loading icon is no longer in the page`, samples.every((r) => !r.loader));
  const s0 = playingNow[0];
  check(`${name}: the intro is playing, with the skip shield over the page`, !!s0 && s0.shield && s0.root, JSON.stringify(s0));
  const tlinfo = await ev(`({ total: window.__intro.total, pieces: window.__intro.timeline.pieces, ready: window.__intro.timeline.readyAt })`);
  const span = (done.t - play.t) / 1000;
  check(`${name}: it plays for at most 8 seconds (${span.toFixed(1)} s from the first frame to "done")`, span <= 8.6 && span >= 4, `total ${tlinfo.total.toFixed(2)} s, ${tlinfo.pieces} pieces`);
  check(`${name}: the control bar is hidden while it plays (${playingNow.length} readings)`, playingNow.length > 0 && playingNow.every((r) => r.bar === 0), JSON.stringify(playingNow.filter((r) => r.bar !== 0).slice(0, 2)));
  check(`${name}: the words that were on screen came in order, in the language of the page, and the last was ${T.chips[4]} (the software renderer draws a frame a second or so: a few words are missed between two frames)`, seen.length >= 2 && seen[seen.length - 1] === T.chips[4] && seen.every((t, i) => T.chips.indexOf(t) >= 0 && (i === 0 || T.chips.indexOf(t) > T.chips.indexOf(seen[i - 1]))), seen.join(' > '));
  const hints = samples.filter((r) => r.hint && r.hintOpacity > 0.3);
  check(`${name}: "${T.skip}" is on screen for the first seconds`, hints.length > 0 && hints[0].hint === T.skip, hints[0]?.hint ?? 'never seen');
  const nums = counts.map((c) => Number(/\d+/.exec(c)[0]));
  check(`${name}: the counter counts up only, in the language of the page, and says M for the total (${tlinfo.pieces})`, counts.length > 0 && nums.every((n, i) => i === 0 || n >= nums[i - 1]) && counts.every((c) => c === T.count(Number(/\d+/.exec(c)[0]), tlinfo.pieces)), `${counts[0] ?? ''} ... ${counts[counts.length - 1] ?? ''} (${counts.length} readings)`);
  const end = await stateNow();
  check(`${name}: it ends as "finished": the words and the shield are gone, the icon too`, end.intro === 'done' && end.end === 'finished' && end.reason === 'finished' && !end.root && !end.shield && !end.loader, JSON.stringify(end));
  const faded = await waitFor(`Number(getComputedStyle(document.getElementById('ps-ui')).opacity) === 1`, 5000, 'the control bar to fade in').then(() => true, () => false);
  check(`${name}: the control bar fades in`, faded, faded ? '' : String(await barOpacity()));
  await shot(`${lang}-after-the-intro`);
  check(`${name}: window.__done is set once the intro is over`, await waitFor('window.__done === true', 8000).then(() => true, () => false));
  const stats = JSON.parse(await ev(`JSON.stringify({ merged: window.__stats.mergedMeshes, pieces: window.__stats.pieces, hidden: window.__stats.hiddenPieces, casters: window.__stats.shadowCasters, emitters: window.__stats.emitters })`));
  check(`${name}: the pieces are merged again after the intro, as on every page (${stats.merged} merged meshes, ${stats.pieces} pieces)`, stats.merged > 0 && stats.pieces >= tlinfo.pieces);
  const after = await camState();
  await ev('window.__camera.reset()'); await sleep(300);
  const home = await camState();
  check(`${name}: the camera ends exactly in the view that Reset view goes back to`, sameCam(after, home), `${JSON.stringify(after)} vs ${JSON.stringify(home)}`);
  check(`${name}: nothing else was opened: no card, no list, the shell is closed`, await ev(`!window.__info.cardOpen() && !window.__info.roomsOpen() && window.__shell.target === 0`));
  return { stats, tl: tlinfo };
}

// ---------- the story held at chosen moments ----------
async function held(lang) {
  const T = hookWords(lang), name = `held story, ${lang}`;
  await open(`lang=${lang}&q=${Q}&guard=off`);
  const tl = JSON.parse(await ev(`JSON.stringify(window.__intro.timeline)`)), M = tl.pieces;
  const at = async (t) => { await ev(`window.__intro.seek(${t})`); await sleep(350); return { w: await words(), s: await stateNow(), cam: await camState(), counts: JSON.parse(await ev(`JSON.stringify(window.__intro.counts)`)) }; };
  const moments = [[0.05, 'EMPTY'], [0.8, 'WALLS'], [1.9, 'OPENINGS'], [3.6, 'FURNITURE'], [tl.readyAt + 0.2, 'READY']], fitMoments = [0.3, 1.2, 2.6, 3.0, 4.2, 4.8, 5.4, 5.8];
  const got = [];
  for (const [t, label] of moments) {
    const r = await at(t); got.push({ t, label, r });
    const wantChip = T.chips[['EMPTY', 'WALLS', 'OPENINGS', 'FURNITURE', 'READY'].indexOf(label)];
    check(`${name}: at ${t.toFixed(1)} s the word is ${wantChip}`, r.w.chip === wantChip, r.w.chip);
    const p = await projectCorners();
    if (p) check(`${name}: at ${t.toFixed(1)} s the whole closed model is inside the window`, insideWindow(p), JSON.stringify(p.pts.filter((q) => q.x < 0 || q.x > p.w || q.y < 0 || q.y > p.h).slice(0, 2)));
    if (label === 'WALLS' || label === 'FURNITURE') await shot(`${lang}-${label.toLowerCase()}`);
    if (label === 'EMPTY') await shot(`${lang}-empty`);
    if (label === 'READY') await shot(`${lang}-ready`);
  }
  const strays = [];
  for (const t of fitMoments) { await at(t); const p = await projectCorners(); if (p && !insideWindow(p)) strays.push(`${t} s: ${JSON.stringify(p.pts.filter((q) => q.x < 0 || q.x > p.w || q.y < 0 || q.y > p.h).slice(0, 1).map((q) => [Math.round(q.x), Math.round(q.y)]))}`); }
  check(`${name}: the whole closed model stays inside the window on the way (${fitMoments.length} more moments)`, strays.length === 0, strays.join(', '));
  check(`${name}: no counter before the furniture, and the counter says "${T.count(0, M)}" or more when it comes`, got[0].r.w.count === null && got[1].r.w.count === null && got[2].r.w.count === null && got[3].r.w.count !== null);
  const mid = Number(/\d+/.exec(got[3].r.w.count)[0]);
  check(`${name}: at 3.6 s the counter is in the middle of the story (${got[3].r.w.count})`, mid > 0 && mid < M && got[3].r.w.count === T.count(mid, M));
  check(`${name}: at Ready the counter says ${T.count(M, M)}`, got[4].r.w.count === T.count(M, M), got[4].r.w.count);
  check(`${name}: the camera starts above the plan (tilt 13) and has come down to the same view at Ready`, Math.abs(got[0].r.cam.pol - 13) < 0.6 && got[4].r.cam.pol > 40 && got[3].r.cam.pol < got[4].r.cam.pol);
  const hint = got[0].r.w;
  check(`${name}: the line to skip is "${T.skip}"`, hint.hint === T.skip, hint.hint);
  // the marks of a page in its corners (the brand and the privacy button of plandoll.com) stay clear of every word
  const brand = await rectOf('#pd-brand'), priv = await rectOf('#pd-privacy');
  if (brand || priv) {
    let clash = [];
    for (const [t] of moments) {
      await at(t);
      for (const sel of ['#ps-intro-chip', '#ps-intro-count', '#ps-intro-hint']) {
        const r = await rectOf(sel);
        if (r && r.shown && Number(r.opacity) > 0.05) for (const [nm, m] of [['brand', await rectOf('#pd-brand')], ['privacy', await rectOf('#pd-privacy')]]) if (m && overlap(r, m)) clash.push(`${sel} over ${nm} at ${t}`);
      }
    }
    check(`${name}: the words keep clear of #pd-brand and #pd-privacy`, !clash.length && !!brand && !!priv, clash.join('; ') || `brand ${JSON.stringify(brand && [brand.x | 0, brand.y | 0, brand.r | 0, brand.b | 0])}, privacy ${JSON.stringify(priv && [priv.x | 0, priv.y | 0, priv.r | 0, priv.b | 0])}`);
    const icon = await ev(`(() => { const a = document.createElement('div'); a.id = 'ps-loading'; document.body.appendChild(a); const r = a.getBoundingClientRect(), c = getComputedStyle(a); const o = { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, pos: c.position }; a.remove(); return o; })()`);
    check(`${name}: the loading icon (28 px, in the middle) is clear of the marks too`, Math.abs(icon.w - 28) < 1 && Math.abs(icon.x + icon.w / 2 - W / 2) < 1 && !(brand && overlap({ ...icon, shown: true }, brand)) && !(priv && overlap({ ...icon, shown: true }, priv)), JSON.stringify(icon));
  }
  return tl;
}

// ---------- no jump at the end ----------
async function noJump(lang) {
  const name = `the end of the intro, ${lang}`;
  const HIDE = `(() => { const s = document.createElement('style'); s.id = 'hide-ui'; s.textContent = '#ps-intro,#ps-ui,#ps-hint,#ps-ui-msg,[id^=pd-]{visibility:hidden!important;transition:none!important}'; document.head.appendChild(s); })()`;
  await open(`lang=${lang}&q=${Q}&guard=off`);
  await ev(HIDE);
  const tl = JSON.parse(await ev(`JSON.stringify(window.__intro.timeline)`));
  await ev(`window.__intro.seek(${tl.total - 0.05})`); await sleep(900);
  const a = await shot(`${lang}-last-frame`);
  const a2 = await shotB64();
  check(`${name}: two pictures of the last frame of the intro are the same picture`, diff(a, a2).mean < 0.05, fmt(diff(a, a2)));
  await ev(`window.__intro.seek(${tl.total + 1})`);
  await waitDone(20000); await waitFor('window.__done === true', 20000); await sleep(1200);
  const statsOf = () => ev(`JSON.stringify((({ geometries, textures, drawCalls, triangles, visibleMeshes, mergedMeshes, shadowCasters, pieces, hiddenPieces, emitters }) => ({ geometries, textures, drawCalls, triangles, visibleMeshes, mergedMeshes, shadowCasters, pieces, hiddenPieces, emitters }))(window.__stats))`).then(JSON.parse);
  const afterStats = await statsOf();
  const b = await shot(`${lang}-first-frame-after`);
  const b2 = await shotB64();
  check(`${name}: and so are two pictures of the page after it`, diff(b, b2).mean < 0.05, fmt(diff(b, b2)));
  const d = diff(a, b);
  check(`${name}: no jump from the last frame of the intro to the first frame after it`, d.mean < 1.5 && d.big < 0.015, fmt(d));
  // the page without an intro, in the same window, with the same view: the scene after the intro is the usual scene
  await open(`lang=${lang}&q=${Q}&intro=0`, `document.body.dataset.intro === 'done' && window.__done === true`);
  await ev(HIDE); await sleep(1200);
  const c = await shot(`${lang}-no-intro`);
  const e = diff(b, c), plainStats = await statsOf();
  check(`${name}: the page after the intro looks like the page with intro=0`, e.mean < 1.5 && e.big < 0.015 && e.block < 10, fmt(e));
  check(`${name}: and holds the same objects: geometries, textures, meshes, merged meshes, shadow casters, pieces, lamps and draw calls are the same numbers (nothing is left over from the intro)`, JSON.stringify(afterStats) === JSON.stringify(plainStats), `${JSON.stringify(afterStats)} vs ${JSON.stringify(plainStats)}`);
  return { jump: d, same: e };
}

// ---------- ways out ----------
async function skips(lang) {
  const T = hookWords(lang), name = `skip, ${lang}`;
  const reach = async (hash) => { await open(hash); const s = await stateNow(); return s.intro === 'playing'; };
  // a touch or a click on the picture
  check(`${name}: the intro is playing before a tap`, await reach(`lang=${lang}&q=${Q}&guard=off`));
  await tap(W / 2, H * 0.4);
  await waitDone(15000);
  let s = await stateNow();
  check(`${name}: a ${phone ? 'touch' : 'click'} on the picture ends it at once ("skipped", by the pointer)`, s.end === 'skipped' && s.how === 'pointer' && s.state === 'done', JSON.stringify(s));
  await sleep(2200);
  s = await stateNow();
  check(`${name}: the words and the shield are gone a moment after`, !s.root && !s.shield, JSON.stringify(s));
  await ev('window.__camera.reset()'); await sleep(250);
  const home = await camState();
  const after = await camState();
  check(`${name}: the tap did nothing else: no card, no turn of the camera, no list, the shell closed`, await ev(`!window.__info.cardOpen() && !window.__info.roomsOpen() && window.__shell.target === 0 && !window.__info.shown()`) && sameCam(home, after));
  check(`${name}: the control bar is back`, (await waitFor(`Number(getComputedStyle(document.getElementById('ps-ui')).opacity) === 1`, 5000).then(() => true, () => false)));
  // a touch on a button of the bar, which is hidden but under the shield: the intro ends and the button is not pressed
  check(`${name}: the intro is playing before a tap on the bar`, await reach(`lang=${lang}&q=${Q}&guard=off`));
  const rooms = await rectOf('#ps-ui button.tool[data-tool="rooms"]');
  check(`${name}: the Rooms button has a place under the shield`, !!rooms && rooms.w > 10, JSON.stringify(rooms));
  await tap(rooms.x + rooms.w / 2, rooms.y + rooms.h / 2, { settle: 900 });
  await waitDone(15000);
  await sleep(1000);
  check(`${name}: a tap on a button of the bar only ends the intro: the list of rooms did not open`, await ev(`!window.__info.roomsOpen()`));
  await waitFor(`Number(getComputedStyle(document.getElementById('ps-ui')).opacity) === 1 && !document.getElementById('ps-intro')`, 6000).catch(() => {});
  const rooms2 = await rectOf('#ps-ui button.tool[data-tool="rooms"]');
  await tap(rooms2.x + rooms2.w / 2, rooms2.y + rooms2.h / 2, { settle: 600 });
  check(`${name}: and the same button works as always afterwards`, await ev(`window.__info.roomsOpen()`));
  // a key
  check(`${name}: the intro is playing before a key`, await reach(`lang=${lang}&q=${Q}&guard=off`));
  await pressKey('Shift', 'ShiftLeft', 16, { settle: 500 });
  check(`${name}: Shift on its own does not end it`, (await stateNow()).intro === 'playing');
  await pressKey(' ', 'Space', 32, { text: ' ', settle: 600 });
  await waitDone(15000);
  s = await stateNow();
  check(`${name}: Space ends it (by a key) and does not open the shell`, s.end === 'skipped' && s.how === 'key' && await ev(`window.__shell.target === 0 && window.__shell.clock === 0`), JSON.stringify(s));
  check(`${name}: a key leaves no shield behind at once`, !s.shield);
  await sleep(300);
  await pressKey(' ', 'Space', 32, { text: ' ', settle: 900 });
  check(`${name}: the next Space opens the shell as always`, await ev(`window.__shell.target === 1`));
  // the arrow key does not turn the view, and Escape ends it
  check(`${name}: the intro is playing before an arrow key`, await reach(`lang=${lang}&q=${Q}&guard=off`));
  await pressKey('ArrowRight', 'ArrowRight', 39, { settle: 600 });
  await waitDone(15000);
  await ev('window.__camera.reset()'); await sleep(250);
  const h2 = await camState(); await sleep(200);
  const sA = await stateNow(), cA = await camState();
  check(`${name}: the arrow key ended it (by a key) and did not turn the view`, sA.how === 'key' && sA.end === 'skipped' && sameCam(cA, h2), `${JSON.stringify(sA)} ${JSON.stringify(cA)} vs ${JSON.stringify(h2)}`);
  // the wheel
  if (!phone) {
    check(`${name}: the intro is playing before the wheel`, await reach(`lang=${lang}&q=${Q}&guard=off`));
    await wheel(W / 2, H / 2, -240);
    await waitDone(15000);
    s = await stateNow();
    const camNow = await camState();
    await ev('window.__camera.reset()'); await sleep(250);
    check(`${name}: the wheel ends it (by the wheel) and does not zoom`, s.end === 'skipped' && s.how === 'wheel' && sameCam(camNow, await camState()), JSON.stringify(s));
  }
}

async function modes(lang) {
  const base = `lang=${lang}&q=${Q}`;
  const never = async (what, hash, end) => {
    await open(hash, `document.body.dataset.intro === 'done'`);
    const log = await logOf(), s = await stateNow();
    check(`${what}: no intro (the state goes from loading to done, the reason is "${end}")`, !log.some((e) => e.s === 'playing') && s.end === end && s.state === 'off' && s.reason === end && !s.root && !s.shield && !s.loader, JSON.stringify({ log: log.map((e) => e.s), s }));
    return s;
  };
  await never('intro=0', `${base}&intro=0`, 'off');
  check('intro=0: the control bar is there at once (no fade) and the page is done', (await barOpacity()) === 1 && await waitFor('window.__done === true', 20000).then(() => true, () => false));
  await never('edit=1', `${base}&edit=1`, 'editor');
  check('edit=1: the editor is there (the sheet and the hook)', await ev(`!!window.__edit && !!document.getElementById('ps-edit')`));
  await never('ui=0', `${base}&ui=0`, 'no-ui');
  check('ui=0: no bar and no words', await ev(`!document.getElementById('ps-ui') && !document.getElementById('ps-intro')`));
  await never('live=1', `${base}&live=1`, 'live');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const rm = await never('a request for less motion', base, 'reduced-motion');
  check('a request for less motion: the page is in its usual state at once, with the bar', (await barOpacity()) === 1 && rm.intro === 'done');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
}

async function otherPlans(lang) {
  const name = `other models, ${lang}`;
  await open(`lang=${lang}&q=${Q}&plan=duplex-1&guard=off`);
  const tl = JSON.parse(await ev(`JSON.stringify(window.__intro.timeline)`));
  check(`${name}: the duplex plays too, within 8 seconds (${tl.pieces} pieces, ${tl.total.toFixed(2)} s)`, tl.total <= 8.0001 && tl.total >= 4.2 && tl.pieces > 0);
  await ev(`window.__intro.seek(${tl.total - 0.05})`); await sleep(400);
  const w = await words();
  check(`${name}: the counter says M of M at the end`, w.count === hookWords(lang).count(tl.pieces, tl.pieces), w.count);
  await ev(`window.__intro.seek(${tl.total + 1})`); await waitDone(20000);
  check(`${name}: and the duplex ends in the usual state`, (await stateNow()).end === 'finished' && await ev(`window.__floors.count === 2 && window.__floors.get() === 'all'`));
  // a link names its own view: the intro ends there
  await open(`lang=${lang}&q=${Q}&az=120&pol=40&guard=off`);
  const t2 = JSON.parse(await ev(`JSON.stringify(window.__intro.timeline)`));
  await ev(`window.__intro.seek(${t2.total + 1})`); await waitDone(20000);
  const c = await camState();
  check(`${name}: with az=120 and pol=40 in the address the intro ends in that view`, Math.abs(c.az - 120) < 1e-6 && Math.abs(c.pol - 40) < 1e-6, JSON.stringify(c));
  // one floor only
  await open(`lang=${lang}&q=${Q}&plan=duplex-1&floor=1&guard=off`);
  const t3 = JSON.parse(await ev(`JSON.stringify(window.__intro.timeline)`));
  const allOf = await ev(`window.__planInfo().pieces`);
  check(`${name}: with floor=1 only the pieces of that floor are built in (${t3.pieces} of ${allOf})`, t3.pieces > 0 && t3.pieces < allOf);
  await ev(`window.__intro.seek(${t3.total + 1})`); await waitDone(20000);
  check(`${name}: and the floor stays as the address says`, await ev(`window.__floors.get() === 1`));
}

// A clock that stops (a script that never gets another animation frame): the intro ends by itself, the page is whole. The test takes the frames away after the first one.
async function stuck() {
  await open(`lang=en&q=${Q}&guard=off`);
  await ev(`window.requestAnimationFrame = () => 0`);
  const t0 = Date.now();
  await waitDone(40000);
  const s = await stateNow();
  check(`the failsafe: an intro whose frames stop ends by itself as "timeout" (${((Date.now() - t0) / 1000).toFixed(0)} s later) and leaves no shield`, s.end === 'timeout' && !s.root && !s.shield, JSON.stringify(s));
  check('and the bar is back', await waitFor(`Number(getComputedStyle(document.getElementById('ps-ui')).opacity) === 1`, 5000).then(() => true, () => false));
}

// A window that is turned or resized while the intro plays ends it (the view it was to end in belongs to the old window), and the page frames itself for the new one.
async function resized() {
  await open(`lang=en&q=${Q}&guard=off`);
  await send('Emulation.setDeviceMetricsOverride', { width: phone ? H : 900, height: phone ? W : 600, deviceScaleFactor: SCALE, mobile: phone });
  await waitDone(20000);
  const s = await stateNow();
  check('a resize of the window ends the intro ("skipped", by the page itself)', s.end === 'skipped' && s.how === 'resize' && !s.shield, JSON.stringify(s));
  const p = await projectCorners();
  check('and the page frames the model for the new window', !p || insideWindow(p), p ? JSON.stringify(p.pts.filter((q) => q.x < 0 || q.x > p.w || q.y < 0 || q.y > p.h).slice(0, 2)) : '');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: phone });
}

async function slowDevice() {
  await open(`lang=en&q=${Q}`);
  const t0 = Date.now();
  await waitDone(40000);
  const s = await stateNow();
  check('without guard=off (software GL is far below 15 frames a second) the intro ends by itself, by the guard or at its end, and the page is whole', (s.end === 'slow' || s.end === 'finished') && !s.root && !s.shield, `${s.end} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check('and window.__done is set', await waitFor('window.__done === true', 10000).then(() => true, () => false));
}

try {
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('the browser did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(`console.error: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
    if (d.method === 'Network.requestWillBeSent') requests.add(d.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER });
  if (phone) { await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  else await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  const timer = setTimeout(async () => { console.error(`FAIL timeout after ${opt.timeout} s`); await cleanup(); process.exit(1); }, Number(opt.timeout) * 1000);
  const first = phone ? 'pl' : 'en', second = phone ? 'en' : 'pl';
  if (want('real')) await realTime(first);
  if (want('held')) { await held(first); await held(second); }
  if (want('jump')) await noJump(first);
  if (want('skips')) await skips(first);
  if (want('modes')) await modes(second);
  if (want('plans')) await otherPlans(second);
  if (want('resized')) await resized();
  if (want('slow')) await slowDevice();
  if (want('stuck')) await stuck();
  clearTimeout(timer);
  const foreign = [...requests].filter((u) => !(u.startsWith(ownOrigin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank'));
  check('the page made no request of its own to anywhere else', foreign.length === 0, foreign.slice(0, 3).join(' '));
  check('no script error or console error', logs.length === 0, logs.slice(0, 3).join(' | '));
} catch (e) {
  check('the check ran to the end', false, e.message);
}
await cleanup();
const failed = steps.filter((s) => !s.ok).length;
console.log(`${failed ? 'FAIL' : 'PASS'}: ${steps.length - failed} of ${steps.length} steps (${tag})`);
process.exit(failed ? 1 : 0);
