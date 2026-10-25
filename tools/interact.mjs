// Click-through check of the built page or a published address, the way a visitor uses it: headless Chrome (software GL, so slow),
// by default with a phone screen and touch input. It waits for the first frames, then taps a mood button, drags the time-of-day
// slider and changes the quality, and after each step checks that the PICTURE changed, not only the controls.
//   node tools/interact.mjs [--html dist/plandoll.html | --html https://host/path/] [--size 390x844] [--scale 3] [--desktop]
//                           [--hash "frames=2"] [--out DIR] [--timeout 240] [--settle 12] [--edit] [--quick] [--btn]
// --desktop uses mouse input and a plain window. --hash is the address hash; empty (the default) is the page exactly as a visitor
// opens it. --settle is how many seconds to wait for a redraw when the page does not report its frame count (older builds).
// --edit opens the page with edit=1 and adds the steps of the layout editor (select, drag, turn, undo, redo, delete, automatic layout);
// without it the page is tested as a visitor sees it and the check is that there is no edit bar.
// --btn opens the page with btn=1 and tests the extra buttons: the example plans, the open shell, saving the picture (a PNG), the frame hook, the Edit button (with the shell open) and leaving the editor again.
// Exits 1 when a step fails, the page reports an error, writes to storage or asks for anything outside its own address.
// On a small machine run only one browser at a time (tools/chrome-lock.sh).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { html: null, size: '390x844', scale: '3', hash: '', out: null, timeout: 240, settle: 12, desktop: false, edit: false, quick: false, btn: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--desktop') opt.desktop = true;
  else if (a === '--edit') opt.edit = true;
  else if (a === '--quick') opt.quick = true;
  else if (a === '--btn') opt.btn = true;
  else if (a.startsWith('--') && a.slice(2) in opt && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
  else { console.error(`usage: node tools/interact.mjs [--html FILE|URL] [--size WxH] [--scale N] [--desktop] [--edit] [--quick] [--btn] [--hash H] [--out DIR] [--timeout S] [--settle S] (got ${a})`); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [W, H] = opt.size.split('x').map(Number);
const live = /^https?:\/\//i.test(opt.html ?? '');
const target = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const own = live ? new URL(opt.html).origin + '/' : null;
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });

// Software GL by default (swiftshader); PS_ANGLE=metal draws on the GPU where the machine has one.
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const GL_FLAGS = ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-chrome-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--use-gl=angle', `--use-angle=${ANGLE}`, ...GL_FLAGS, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map();
const logs = new Set(), requests = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const text = (a) => String(a.value ?? a.description ?? '').slice(0, 300);
const cleanup = async () => { try { ws?.close(); } catch {} chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

const steps = [];
let failed = false;
const record = (name, ok, detail = {}) => { if (!ok) failed = true; steps.push({ name, ok, ...detail }); console.log(JSON.stringify({ step: name, ok, ...detail })); };

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${text(r.exceptionDetails.exception ?? { value: r.exceptionDetails.text })}`);
  return r.result.value;
}
async function waitFor(expression, seconds, every = 400) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { try { if (await ev(expression)) return true; } catch {} await sleep(every); }
  return false;
}
// Touch or mouse input at a point, as the browser's own input pipeline sees it.
async function tap(x, y) {
  if (opt.desktop) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  } else {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(80); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
// hold: milliseconds to rest before letting go (a slow release does not start the page's inertia, so the turn is exactly what was dragged)
async function drag(x0, y0, x1, y1, hold = 0) {
  const n = 12, at = (k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n];
  if (opt.desktop) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' }); await sleep(30); }
    if (hold) await sleep(hold);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  } else {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(30); }
    if (hold) await sleep(hold);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
// The part of the screen above the controls: only the 3D picture is there, so equal bytes mean an unchanged picture.
async function picture(label) {
  const top = await ev(`Math.floor(Math.min(...['#ps-ui', '#ps-ui .blurb'].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? innerHeight)) - 4)`);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: W, height: Math.max(40, top), scale: 1 } });
  if (out) {
    writeFileSync(join(out, `${label}.png`), Buffer.from(shot.data, 'base64'));
    const full = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, fromSurface: true }); // the whole screen, controls included, for a look
    writeFileSync(join(out, `${label}-full.jpg`), Buffer.from(full.data, 'base64'));
  }
  return shot.data;
}
// After an action: wait for the page to draw again (it reports a frame count), then give the compositor a moment.
async function redrawn(before) {
  const counts = (await ev('typeof window.__frames')) === 'number';
  if (counts) { const ok = await waitFor(`window.__frames > ${before}`, Number(opt.timeout)); await sleep(500); return { counts, ok }; }
  await sleep(Number(opt.settle) * 1000); return { counts, ok: null };
}
const frames = () => ev('typeof window.__frames === "number" ? window.__frames : -1');
const tapAt = async (sel) => { const r = await rectOf(sel); if (!r || r.w < 1 || r.h < 1) return false; await tap(r.x + r.w / 2, r.y + r.h / 2); return true; };
const mood = (name) => `#ps-ui button.mood[data-preset="${name}"]`;

try {
  let list;
  for (let k = 0; k < 60; k++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(500); }
  ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.add(`${m.params.type}: ${m.params.args.map(text).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') logs.add(`EXC: ${text(m.params.exceptionDetails.exception ?? { value: m.params.exceptionDetails.text })}`);
    else if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (!/^(file|data|blob|about):/.test(u) && !(own && u.startsWith(own))) requests.add(u.slice(0, 200)); }
    else if (m.method === 'Network.webSocketCreated') requests.add(`ws: ${m.params.url}`);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: opt.desktop ? 1 : Number(opt.scale), mobile: !opt.desktop });
  if (!opt.desktop) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const hash = [opt.hash, opt.edit ? 'edit=1' : '', opt.btn ? 'btn=1' : ''].filter(Boolean).join('&');
  const url = `${target}${hash ? `#${hash}` : ''}`;
  await send('Page.navigate', { url });

  // 1. the first frames
  const ready = await waitFor('window.__done === true || !!window.__fail', Number(opt.timeout));
  const first = await ev('JSON.stringify({ done: window.__done === true, fail: window.__fail || null, quality: window.__stats?.quality ?? null, size: window.__stats?.size ?? null, touch: navigator.maxTouchPoints })');
  const info = JSON.parse(first);
  record('first frames', ready && info.done && !info.fail, { ...info, viewport: `${W}x${H}`, input: opt.desktop ? 'mouse' : 'touch' });
  if (!(ready && info.done && !info.fail)) throw new Error('the page did not draw its first frames');
  const bar = await rectOf('#ps-ui');
  const offScreen = await ev(`[...document.querySelectorAll('#ps-ui button, #ps-ui input, #ps-ui select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1); }).length`);
  record('controls on screen', !!bar && bar.x >= -1 && bar.x + bar.w <= W + 1 && bar.y >= 0 && bar.y + bar.h <= H + 1 && offScreen === 0, { bar, controlsOffScreen: offScreen });
  if (!opt.edit) {
    const none = await ev(`JSON.stringify({ bar: !!document.querySelector('#ps-edit'), panel: !!document.querySelector('#ps-edit-panel'), api: typeof window.__edit })`);
    record('no edit bar without edit=1', JSON.parse(none).bar === false && JSON.parse(none).panel === false && JSON.parse(none).api === 'undefined', JSON.parse(none));
  }
  let pic = await picture('0-start');
  const turnAz = () => ev('window.__camera ? window.__camera.azimuth : -1');

  // --quick skips the steps of a visitor (2 to 10: moods, slider, quality, language, turning the model, resets) and goes to the editor steps
  if (!opt.quick) {
  // 2. tap a mood button
  const clock0 = await ev('document.querySelector("#ps-ui .clock").textContent');
  const f0 = await frames();
  const b = await rectOf(mood('lamplit'));
  await tap(b.x + b.w / 2, b.y + b.h / 2);
  const r1 = await redrawn(f0);
  const pressed = await ev(`document.querySelector(${JSON.stringify(mood('lamplit'))}).getAttribute('aria-pressed')`);
  const clock1 = await ev('document.querySelector("#ps-ui .clock").textContent');
  const pic1 = await picture('1-lamplit');
  record('tap Lamplit', pressed === 'true' && clock1 !== clock0 && pic1 !== pic && r1.ok !== false, { pressed, clock: `${clock0} -> ${clock1}`, redrawnFrames: r1.counts ? `${f0} -> ${await frames()}` : 'not reported', pictureChanged: pic1 !== pic });
  pic = pic1;

  // 3. drag the time-of-day slider across the day
  const s = await rectOf('#ps-ui input[type=range]');
  const v0 = Number(await ev('document.querySelector("#ps-ui input[type=range]").value'));
  const thumbX = (v) => s.x + 9 + (s.w - 18) * v, to = v0 < 0.5 ? 0.9 : 0.1, f1 = await frames();
  await drag(thumbX(v0), s.y + s.h / 2, thumbX(to), s.y + s.h / 2);
  const r2 = await redrawn(f1);
  const v1 = Number(await ev('document.querySelector("#ps-ui input[type=range]").value'));
  const clock2 = await ev('document.querySelector("#ps-ui .clock").textContent');
  const pic2 = await picture('2-slider');
  record('drag time of day', Math.abs(v1 - v0) > 0.3 && clock2 !== clock1 && pic2 !== pic && r2.ok !== false, { slider: `${v0.toFixed(2)} -> ${v1.toFixed(2)}`, clock: `${clock1} -> ${clock2}`, redrawnFrames: r2.counts ? `${f1} -> ${await frames()}` : 'not reported', pictureChanged: pic2 !== pic });
  pic = pic2;

  // 4. tap another mood
  const f2 = await frames();
  const c = await rectOf(mood('clear'));
  await tap(c.x + c.w / 2, c.y + c.h / 2);
  const r3 = await redrawn(f2);
  const pic3 = await picture('3-clear');
  record('tap Clear', pic3 !== pic && r3.ok !== false, { redrawnFrames: r3.counts ? `${f2} -> ${await frames()}` : 'not reported', pictureChanged: pic3 !== pic });
  pic = pic3;

  // 5. change the quality to another level (the page rebuilds its furniture and render targets)
  const f3 = await frames();
  const levelBefore = await ev('window.__stats?.quality ?? null');
  const levelTo = levelBefore === 'medium' ? 'low' : 'medium';
  await ev(`(() => { const q = document.querySelector('#ps-ui select'); q.value = ${JSON.stringify(levelTo)}; q.dispatchEvent(new Event('change', { bubbles: true })); return q.value; })()`);
  const r4 = await redrawn(f3);
  const fail4 = await ev('window.__fail || null');
  const pic4 = await picture('4-quality');
  record('change quality', !fail4 && r4.ok !== false && pic4 !== pic, { to: levelTo, fail: fail4, redrawnFrames: r4.counts ? `${f3} -> ${await frames()}` : 'not reported', pictureChanged: pic4 !== pic });

  // 6. the language button changes the text, not the picture
  const l0 = await ev('document.querySelector("#ps-ui .clock").previousSibling.previousSibling?.textContent ?? document.querySelector("#ps-ui label.time span").textContent');
  const lb = await rectOf('#ps-ui button.lang');
  await tap(lb.x + lb.w / 2, lb.y + lb.h / 2); await sleep(400);
  const l1 = await ev('document.querySelector("#ps-ui label.time span").textContent');
  record('tap language', l0 !== l1, { label: `${l0} -> ${l1}` });

  // 7. the labels of the controls and the first-visit hint
  const ui = JSON.parse(await ev(`JSON.stringify({ hint: document.querySelector('#ps-hint')?.textContent ?? null, quality: document.querySelector('#ps-ui label.quality span')?.textContent ?? null, auto: [...document.querySelectorAll('#ps-ui select option')].map((o) => o.textContent)[0] ?? null, reset: document.querySelector('#ps-ui button.reset')?.textContent ?? null, help: (document.querySelector('#ps-quality-help')?.textContent ?? '').length })`));
  record('labels and hint', !!ui.hint && !!ui.quality && /:/.test(ui.auto ?? '') && !!ui.reset && ui.help > 80, { ...ui, bar: await rectOf('#ps-ui') });

  // 8. turn the model by about 90 degrees: a drag over the picture (a finger on the phone, the mouse on the desktop) must change the picture
  const turnAz = () => ev('window.__camera ? window.__camera.azimuth : -1');
  const wrap = (d) => ((d % 360) + 540) % 360 - 180;
  const upToBar = await ev(`Math.floor(document.querySelector('#ps-ui').getBoundingClientRect().top)`);
  const dragPx = Math.round(0.45 * Math.min(W, H));
  let y = Math.round(upToBar * 0.35), x0 = Math.round(W * 0.2);
  if (opt.edit) { // with the editor on, a drag that starts on a piece moves the piece: start the turn where no piece is under the finger
    search: for (const fy of [0.35, 0.2, 0.5, 0.1, 0.65]) for (const fx of [0.2, 0.1, 0.3, 0.05, 0.4]) {
      const px = Math.round(W * fx), py = Math.round(upToBar * fy);
      if ((await ev(`window.__edit.hit(${px}, ${py})`)) === null) { x0 = px; y = py; break search; }
    }
  }
  const a0 = await turnAz(), f4 = await frames(), picBefore = pic;
  await drag(x0, y, Math.min(W - 10, x0 + dragPx), y, 150);
  await waitFor('window.__camera && window.__camera.busy === false', 60);
  const r5 = await redrawn(f4);
  const a1 = await turnAz(), near1 = await ev('window.__camera.near');
  const hintGone = await ev('!document.querySelector("#ps-hint")');
  const pic5 = await picture('5-turned');
  const turned = Math.abs(wrap(a1 - a0));
  record('turn the model', a0 >= 0 && turned > 45 && turned < 140 && pic5 !== picBefore && r5.ok !== false && hintGone, { azimuth: `${a0.toFixed(0)} -> ${a1.toFixed(0)}`, turned: Math.round(turned), nearEdges: near1, hintGone, redrawnFrames: r5.counts ? `${f4} -> ${await frames()}` : 'not reported', pictureChanged: pic5 !== picBefore });
  pic = pic5;

  // 9. a double tap on the picture goes back to the starting view
  const f5 = await frames();
  await tap(x0, y); await sleep(90); await tap(x0, y);
  await waitFor('window.__camera && window.__camera.busy === false', 60);
  const r6 = await redrawn(f5);
  const a2 = await turnAz(), pic6 = await picture('6-double-tap');
  record('double tap resets the view', Math.abs(wrap(a2 - a0)) < 2 && pic6 !== pic && r6.ok !== false, { azimuth: `${a1.toFixed(0)} -> ${a2.toFixed(0)}`, start: a0.toFixed(0), pictureChanged: pic6 !== pic });
  pic = pic6;

  // 10. turn again and use the reset button of the controls
  const f6 = await frames();
  await drag(x0, y, Math.min(W - 10, x0 + dragPx), y, 150);
  await waitFor('window.__camera && window.__camera.busy === false', 60);
  await redrawn(f6);
  const a3 = await turnAz(), picTurned = await picture('7-turned-again'), f7 = await frames();
  const rb = await rectOf('#ps-ui button.reset');
  await tap(rb.x + rb.w / 2, rb.y + rb.h / 2);
  await waitFor('window.__camera && window.__camera.busy === false', 60);
  const r7 = await redrawn(f7);
  const a4 = await turnAz(), pic7 = await picture('8-reset-button');
  record('reset button', Math.abs(wrap(a3 - a0)) > 45 && Math.abs(wrap(a4 - a0)) < 2 && pic7 !== picTurned && r7.ok !== false, { azimuth: `${a3.toFixed(0)} -> ${a4.toFixed(0)}`, pictureChanged: pic7 !== picTurned });

  }

  // 10b. the layout editor (--edit): select a piece, drag it, turn, undo, redo, delete, automatic layout
  if (opt.edit) {
    const pieceInfo = (pid) => ev(`(() => { const p = window.__edit.session.pieceById(${JSON.stringify(pid)}); return p ? { x: p.x, y: p.y, rot: p.rot } : null; })()`);
    const layoutJson = () => ev('JSON.stringify(window.__edit.session.state.layout)');
    const selected = () => ev('window.__edit.selectedId()');
    const count = () => ev('window.__edit.count()');
    const click = async (what) => { const r = await rectOf(`#ps-edit button[data-edit="${what}"]`); await tap(r.x + r.w / 2, r.y + r.h / 2); };
    const key = async (k, code, vk, modifiers = 0, text) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(type === 'keyDown' && text ? { text } : {}) }); };
    const startLayout = await layoutJson();
    const bars = JSON.parse(await ev(`JSON.stringify((() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; const bar = document.querySelector('#ps-edit'); const ctl = document.querySelector('#ps-ui'); if (!bar) return null; return { bar: r(bar), ui: r(ctl), buttons: [...bar.querySelectorAll(':scope > button')].map((b) => ({ name: b.dataset.edit, ...r(b), disabled: b.disabled, label: b.getAttribute('aria-label') })), panel: !!document.querySelector('#ps-edit-panel') }; })())`));
    const stackH = await ev(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ps-stack-h')) || 0`);
    const barOk = !!bars && bars.panel && bars.buttons.length === 6 && bars.buttons.every((b) => b.w >= 43.5 && b.h >= 43.5 && b.x >= -1 && b.x + b.w <= W + 1 && b.label) && bars.bar.y + bars.bar.h <= bars.ui.y + 1 && bars.bar.h < 80 && stackH > 100 && stackH < H;
    record('edit bar', barOk, { bar: bars?.bar, stackHeightVar: stackH, buttons: bars?.buttons.map((b) => `${b.name} ${Math.round(b.w)}x${Math.round(b.h)}${b.disabled ? ' off' : ''}`) });
    const area = Math.floor(bars ? Math.min(bars.bar.y, bars.ui.y) : 400) - 6;
    const cands = await ev(`(() => { const out = []; for (const lv of window.__edit.session.state.layout.levels) for (const p of lv.pieces) if (!p.on && p.elev === 0 && p.size[2] > 0.3) out.push({ id: p.id, type: p.type, area: p.size[0] * p.size[1], level: lv.id, room: p.room, x: p.x, y: p.y }); return out.sort((a, b) => b.area - a.area).slice(0, 12); })()`);
    const inside = (pt) => pt && pt.x > 8 && pt.x < W - 8 && pt.y > 8 && pt.y < area;

    // select: a tap on a piece selects it (the outline shows), the id reported by the page is the one tapped
    let chosen = null, f = await frames(), picBeforeSel = pic;
    for (const c of cands) {
      const pt = await ev(`window.__edit.screenOf(${JSON.stringify(c.id)})`);
      if (!inside(pt)) continue;
      // the sheet of a selected piece opens over the bottom of the picture, and a piece under it cannot be grabbed again: look first (the selection is set
      // by the page, not by a tap), and only a piece that stays on the open picture is tapped for real, from the state of nothing selected
      await ev(`window.__edit.session.select(${JSON.stringify(c.id)})`); await sleep(350);
      const pt2 = await ev(`window.__edit.screenOf(${JSON.stringify(c.id)})`);
      const top = pt2 ? await ev(`document.elementFromPoint(${pt2.x}, ${pt2.y})?.tagName ?? null`) : null;
      await ev('window.__edit.session.select(null)'); await sleep(350);
      if (top !== 'CANVAS' || !inside(pt2)) continue;
      await tap(pt2.x, pt2.y); await sleep(350);
      if ((await selected()) === c.id) { chosen = { ...c, pt: pt2 }; break; }
    }
    await redrawn(f);
    const picSel = await picture('9-edit-selected');
    const bars2 = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ps-edit button')].map((b) => b.disabled))`));
    record('edit: tap selects a piece', !!chosen && picSel !== picBeforeSel && bars2[0] === false && bars2[1] === false, { piece: chosen ? `${chosen.id} ${chosen.type}` : null, pictureChanged: picSel !== picBeforeSel, disabled: bars2.join(',') });
    pic = picSel;
    if (!chosen) throw new Error('no piece could be selected by a tap');
    const id = chosen.id;

    // drag: about 80 px over the floor; the piece moves in the layout, the picture changes, the camera does not turn
    const p0 = await pieceInfo(id), az0 = await turnAz(); f = await frames();
    const sel0 = await ev('window.__edit.screenOf(' + JSON.stringify(id) + ')');
    await drag(sel0.x, sel0.y, Math.min(W - 12, sel0.x + 80), Math.min(area - 6, sel0.y + 30));
    await sleep(300); await redrawn(f);
    const p1 = await pieceInfo(id), az1 = await turnAz(), picDrag = await picture('10-edit-dragged');
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    record('edit: drag moves the piece', moved > 0.1 && picDrag !== pic && Math.abs(az1 - az0) < 0.5 && (await selected()) === id, { moved: `${moved.toFixed(2)} m`, from: `${p0.x.toFixed(2)},${p0.y.toFixed(2)}`, to: `${p1.x.toFixed(2)},${p1.y.toFixed(2)}`, cameraTurned: +(az1 - az0).toFixed(2), pictureChanged: picDrag !== pic });
    pic = picDrag;

    // drag onto another piece of the same room: the place is flagged (overlap), then the drag is undone in one step. The drop point is worked out so that
    // the dragged piece's centre lands on the centre of the other piece (the finger rests above the floor, so the offset of the grab is taken into account).
    // The first drag took the piece up to a few metres away, perhaps under the Add button or out of its room: take it back first, so that the piece
    // stands where it was tapped and the next grab starts on the picture.
    await click('undo'); await sleep(350);
    const me = cands.find((c) => c.id === id);
    const target = await (async () => {
      const cur = await pieceInfo(id), here = await ev('window.__edit.screenOf(' + JSON.stringify(id) + ')');
      const fh = me && here ? await ev(`window.__edit.floorAt(${here.x}, ${here.y}, ${JSON.stringify(me.level)})`) : null;
      if (!fh) return null;
      const off = [cur.x - fh[0], cur.y - fh[1]];
      for (const c of cands) {
        if (c.id === id || c.level !== me.level || c.room !== me.room) continue;
        const drop = await ev(`window.__edit.pointOf(${JSON.stringify(c.level)}, ${c.x - off[0]}, ${c.y - off[1]})`);
        if (inside(drop)) return { ...c, here, drop };
      }
      return null;
    })();
    if (target) {
      f = await frames();
      const before = await layoutJson();
      await drag(target.here.x, target.here.y, target.drop.x, target.drop.y);
      await sleep(300); await redrawn(f);
      const kinds = await ev('JSON.stringify(window.__edit.session.problems().map((p) => p.kind))');
      const picOver = await picture('11-edit-overlap');
      const changedByDrop = (await layoutJson()) !== before;
      await click('undo'); await sleep(300);
      record('edit: dropping on another piece shows a problem, undo takes the drag back', changedByDrop && /overlap/.test(kinds) && (await layoutJson()) === before, { onto: `${target.id} ${target.type}`, room: target.room, problems: kinds, changedByDrop, pictureChanged: picOver !== pic });
      pic = await picture('11b-edit-undone');
    } else record('edit: dropping on another piece shows a problem, undo takes the drag back', false, { error: 'no other piece in the same room is on screen' });

    // turn: +90 degrees; undo and redo
    const t0 = await pieceInfo(id); f = await frames();
    await click('turn'); await sleep(300); await redrawn(f);
    const t1 = await pieceInfo(id), turnedBy = (((t1.rot - t0.rot) % 360) + 360) % 360;
    await click('undo'); await sleep(300);
    const t2 = await pieceInfo(id), redoOn = await ev(`!document.querySelector('#ps-edit button[data-edit="redo"]').disabled`);
    await click('redo'); await sleep(300);
    const t3 = await pieceInfo(id), picTurn = await picture('12-edit-turned');
    record('edit: turn, undo, redo', Math.abs(turnedBy - 90) < 1 && t2.rot === t0.rot && redoOn && t3.rot === t1.rot, { rot: `${t0.rot} -> ${t1.rot}, undo ${t2.rot}, redo ${t3.rot}`, turnedBy, redoEnabledAfterUndo: redoOn });
    await click('undo'); await sleep(200);

    // delete and undo
    const n0 = await count(); f = await frames();
    await click('remove'); await sleep(300); await redrawn(f);
    const n1 = await count(), selAfter = await selected(), picDel = await picture('13-edit-deleted');
    await click('undo'); await sleep(400);
    const n2 = await count();
    record('edit: delete removes the piece, undo brings it back', n1 < n0 && selAfter === null && n2 === n0 && picDel !== picTurn, { count: `${n0} -> ${n1} -> ${n2}`, selectedAfter: selAfter, pictureChanged: picDel !== picTurn });

    // automatic layout: the layout is the automatic one again
    f = await frames();
    await ev(`window.__edit.session.select(${JSON.stringify(id)}); window.__edit.session.turn(90)`); await sleep(300); // a layout that differs from the automatic one, whatever the steps before did
    const changed = (await layoutJson()) !== startLayout;
    await click('auto'); await sleep(500); await redrawn(f);
    const auto = (await layoutJson()) === startLayout;
    record('edit: automatic layout restores the first layout', changed && auto, { changedBeforeReset: changed, equalsFirstLayout: auto });
    pic = await picture('14-edit-auto');

    // keys on the desktop: R turns the selected piece, Ctrl + Z undoes, Delete removes
    if (opt.desktop) {
      await tap(chosen.pt.x, chosen.pt.y); await sleep(300);
      const k0 = await pieceInfo(id);
      await key('r', 'KeyR', 82, 0, 'r'); await sleep(300);
      const k1 = await pieceInfo(id);
      await key('z', 'KeyZ', 90, 2); await sleep(300);
      const k2 = await pieceInfo(id);
      await key('z', 'KeyZ', 90, 10); await sleep(300); // Ctrl + Shift + Z: redo
      const k3 = await pieceInfo(id);
      await key('z', 'KeyZ', 90, 2); await sleep(200);
      const m0 = await count();
      await key('Delete', 'Delete', 46); await sleep(300);
      const m1 = await count();
      await key('z', 'KeyZ', 90, 2); await sleep(300);
      const m2 = await count();
      await key('Escape', 'Escape', 27); await sleep(200);
      record('edit: keys R, Ctrl+Z, Ctrl+Shift+Z, Delete, Escape', k1.rot !== k0.rot && k2.rot === k0.rot && k3.rot === k1.rot && m1 < m0 && m2 === m0 && (await selected()) === null, { rot: `${k0.rot} ${k1.rot} ${k2.rot} ${k3.rot}`, count: `${m0} ${m1} ${m2}` });
    }

    // 10c. the panel, the More menu (duplicate, save, load by paste) and the choice of a room. Every step that changes the layout is undone.
    try { await send('Browser.setDownloadBehavior', { behavior: 'deny' }); } catch {}
    const tapSel = async (sel) => { const r = await rectOf(sel); if (!r || r.w < 1 || r.h < 1) return false; await tap(r.x + r.w / 2, r.y + r.h / 2); return true; };
    const sig = () => ev(`(() => window.__edit.session.state.layout.levels.map((l) => l.id + ':' + l.pieces.map((p) => [p.id, p.type, p.x, p.y, p.rot, p.elev, p.size.join(','), JSON.stringify(p.colors ?? {})].join('|')).join(';') + JSON.stringify(l.rooms ?? {})).join('/'))()`);
    const selId = () => ev('window.__edit.selectedId()');
    const selJson = () => ev('JSON.stringify(window.__edit.session.selected())');
    const undoApi = () => ev('window.__edit.session.undo().ok'), redoApi = () => ev('window.__edit.session.redo().ok');
    await ev('window.__edit.session.select(null)'); await sleep(200);
    const sig0 = await sig(), n00 = await count();
    let f2 = await frames();

    // the panel: the Add button opens the list; a tap on a piece in the list adds it at the centre of the picture
    const tog = await rectOf('.psp-toggle');
    await tapSel('.psp-toggle'); await sleep(500);
    const sheet = await rectOf('.psp-sheet'), barRect = await rectOf('#ps-edit');
    const coversBar = !!(sheet && barRect && sheet.w > 0 && sheet.y < barRect.y + barRect.h && sheet.y + sheet.h > barRect.y);
    await picture('15-panel-open');
    record('panel: the Add button opens the list', !!tog && tog.w >= 43.5 && tog.h >= 43.5 && !!sheet && sheet.w > 100 && sheet.h > 60, { toggle: tog, sheet, sheetCoversEditBar: coversBar });
    // on a narrow screen the details of the selection start folded: open them (a tap on the header) before using a swatch or a size field
    const unfold = async () => {
      const r = await ev(`(() => { const h = [...document.querySelectorAll('.psp-sel-head')].find((x) => x.offsetParent !== null && x.getAttribute('aria-expanded') === 'false'); if (!h) return null; h.scrollIntoView({ block: 'center' }); const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      if (r) { await tap(r.x, r.y); await sleep(450); }
    };
    const itemId = await ev(`(() => { const all = [...document.querySelectorAll('.psp-item')].filter((x) => x.offsetParent !== null); const b = all.find((x) => /sofa|arm|chair/.test(x.dataset.id)) ?? all[0]; return b ? b.dataset.id : null; })()`);
    await ev(`document.querySelector('.psp-item[data-id="${itemId}"]')?.scrollIntoView({ block: 'center' })`); await sleep(250);
    const picPre = await picture('15b-before-add');
    f2 = await frames();
    await tapSel(`.psp-item[data-id="${itemId}"]`); await sleep(600); await redrawn(f2);
    const nAdd = await count(), idAdd = await selId(), picAdd = await picture('16-panel-added');
    record('panel: a tap on a piece in the list adds it, selected', nAdd === n00 + 1 && !!idAdd && picAdd !== picPre, { type: itemId, count: `${n00} -> ${nAdd}`, selected: idAdd, pictureChanged: picAdd !== picPre });

    // a colour swatch of the new piece, then undo and redo
    await unfold();
    const sw = await ev(`(() => { const b = [...document.querySelectorAll('.psp-sw')].find((x) => x.getAttribute('aria-pressed') !== 'true'); return b ? { slot: b.dataset.slot, color: b.dataset.color } : null; })()`);
    const colorsOf = async () => JSON.parse((await selJson()) ?? 'null')?.colors ?? {};
    const col0 = await colorsOf();
    let colOk = false, picCol = picAdd;
    if (sw) {
      const q = `.psp-sw[data-slot="${sw.slot}"][data-color="${sw.color}"]`;
      await ev(`document.querySelector(${JSON.stringify(q)})?.scrollIntoView({ block: 'center' })`); await sleep(250);
      f2 = await frames(); await tapSel(q); await sleep(600); await redrawn(f2);
      const col1 = await colorsOf(); picCol = await picture('17-panel-colour');
      await undoApi(); await sleep(250); const col2 = await colorsOf();
      await redoApi(); await sleep(250); const col3 = await colorsOf();
      colOk = String(col1[sw.slot] ?? '').toLowerCase() === String(sw.color).toLowerCase() && JSON.stringify(col2) === JSON.stringify(col0) && JSON.stringify(col3) === JSON.stringify(col1);
    }
    record('panel: a colour swatch recolours the slot (undo and redo)', colOk && picCol !== picAdd, { swatch: sw, pictureChanged: picCol !== picAdd });

    // a size field, then undo and redo
    const readField = () => ev(`(() => { const i = document.querySelector('.psp-num'); return i && i.offsetParent !== null ? { axis: i.dataset.axis, min: Number(i.min), max: Number(i.max), value: Number(i.value) } : null; })()`);
    await unfold();
    let field = await readField();
    if (!field) { // the new piece has no range to change (an armchair): take a piece of the layout that has one
      const rid = await ev(`(() => { for (const lv of window.__edit.session.state.layout.levels) for (const p of lv.pieces) if (!p.on && /^(sofa2|sofa3|sofa-bed|dresser|bench|coffee-table|dining-table|wardrobe|wardrobe-small|bed-double|bed-single|desk|tv-unit|sideboard)$/.test(p.type)) return p.id; return null; })()`);
      if (rid) { await ev(`window.__edit.session.select(${JSON.stringify(rid)})`); await sleep(500); await unfold(); field = await readField(); }
    }
    let sizeOk = false, sizeNote = {};
    if (field) {
      const idx = { w: 0, d: 1, h: 2 }[field.axis], span = field.max - field.min, want = Math.round(field.value + (field.max - field.value >= field.value - field.min ? 1 : -1) * Math.max(2, span / 4));
      const sizeOf = async () => JSON.parse(await selJson()).size[idx];
      const s0 = await sizeOf();
      await ev(`(() => { const i = document.querySelector('.psp-num[data-axis="${field.axis}"]'); i.scrollIntoView({ block: 'center' }); i.value = '${want}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500);
      const s1 = await sizeOf(); await undoApi(); await sleep(250); const s2 = await sizeOf(); await redoApi(); await sleep(250); const s3 = await sizeOf();
      sizeOk = Math.abs(s1 * 100 - want) < 1.01 && s1 * 100 >= field.min - 0.01 && s1 * 100 <= field.max + 0.01 && Math.abs(s2 - s0) < 1e-9 && Math.abs(s3 - s1) < 1e-9;
      sizeNote = { axis: field.axis, range: `${field.min}..${field.max} cm`, typed: want, kept: +(s1 * 100).toFixed(1), undo: +(s2 * 100).toFixed(1), redo: +(s3 * 100).toFixed(1) };
    }
    record('panel: a size field changes the size within its range (undo and redo)', sizeOk, sizeNote);
    await tapSel('.psp-toggle'); await sleep(400); // closes the panel again
    await undoApi(); await undoApi(); await undoApi(); await sleep(300); // size, colour, add
    record('panel: undo takes back the whole session of changes', (await sig()) === sig0 && (await count()) === n00, { count: await count() });

    // The More menu toggles on every tap, so its state is read first: openMore() leaves it open (and says so), whatever the step before did.
    const menuOpen = () => ev(`!document.querySelector('#ps-edit-menu').hidden`);
    const openMore = async () => { for (let k = 0; k < 3; k++) { if (await menuOpen()) return true; await tapSel('#ps-edit button[data-edit="more"]'); await sleep(450); } return menuOpen(); };
    // More: a copy of the selected piece
    await ev(`window.__edit.session.select(${JSON.stringify(id)})`); await sleep(250);
    const nDup0 = await count(); f2 = await frames();
    await openMore();
    const menuInfo = await ev(`JSON.stringify({ hidden: document.querySelector('#ps-edit-menu').hidden, items: [...document.querySelectorAll('#ps-edit-menu button')].map((b) => { const r = b.getBoundingClientRect(); return b.dataset.editItem + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }) })`);
    await picture('18-more-menu');
    await tapSel('#ps-edit-menu button[data-edit-item="duplicate"]'); await sleep(600); await redrawn(f2);
    const nDup1 = await count(), dupSel = await selId();
    record('More: Duplicate adds a copy and selects it', JSON.parse(menuInfo).hidden === false && nDup1 === nDup0 + 1 && !!dupSel && dupSel !== id, { menu: JSON.parse(menuInfo).items, count: `${nDup0} -> ${nDup1}`, selected: dupSel });
    await undoApi(); await sleep(250);

    // More: Save hands the layout over as a file, the text parses back to the same layout
    await ev(`(() => { window.__saved = []; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__saved.push(b); return orig(b); }; })()`);
    await ev(`window.__edit.session.select(${JSON.stringify(id)})`); await ev('window.__edit.session.duplicate()'); await sleep(300); // a layout that differs from the automatic one
    const sigSaved = await sig(), textSaved = await ev('window.__edit.session.exportText()'); // the saved text rounds the numbers, so the loaded layout is compared by its text
    const savedMenuOpen = await openMore();
    await tapSel('#ps-edit-menu button[data-edit-item="save"]'); await waitFor('window.__saved.length > 0', 6); await sleep(300);
    const saved = await ev(`(async () => { const b = window.__saved[0]; return b ? await b.text() : null; })()`);
    const msgSaved = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`);
    const roundTrip = typeof saved === 'string' ? await ev(`(() => { const s = window.__edit.session, text = ${JSON.stringify(saved)}; let parsed = true; try { JSON.parse(text); } catch { parsed = false; } return JSON.stringify({ parsed, same: text === s.exportText() }); })()`) : '{}';
    record('More: Save gives a file whose text starts with { and parses back to the layout', typeof saved === 'string' && saved.startsWith('{') && JSON.parse(roundTrip).parsed && JSON.parse(roundTrip).same, { startsWith: String(saved).slice(0, 1), bytes: String(saved).length, message: msgSaved, menuWasOpen: savedMenuOpen, ...JSON.parse(roundTrip) });

    // More: Paste loads the saved text back after the layout went back to the automatic one
    await click('auto'); await sleep(500);
    const sigAuto = await sig();
    f2 = await frames();
    const pasteMenuOpen = await openMore();
    await tapSel('#ps-edit-menu button[data-edit-item="paste"]'); await waitFor(`!!document.querySelector('#ps-files-overlay .ps-files-dialog')`, 6); await sleep(300);
    const dlg = await rectOf('#ps-files-overlay .ps-files-dialog');
    await picture('19-paste-dialog');
    await ev(`(() => { const a = document.querySelector('#ps-files-text'); a.value = ${JSON.stringify(saved)}; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await tapSel('#ps-files-overlay button.ps-files-load'); await sleep(800); await redrawn(f2);
    const textLoaded = await ev('window.__edit.session.exportText()'), msgLoaded = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`);
    record('More: Paste layout brings the saved layout back', !!dlg && textLoaded === textSaved && sigAuto !== sigSaved && !!msgLoaded, { dialog: dlg ? `${Math.round(dlg.w)}x${Math.round(dlg.h)}` : null, message: msgLoaded, menuWasOpen: pasteMenuOpen, equalsSaved: textLoaded === textSaved });
    await undoApi(); await sleep(300);
    record('More: undo after loading goes back to the layout before', (await sig()) === sigAuto, {});
    await undoApi(); await sleep(200); // the duplicate made before saving is not part of the automatic layout; the next undo is harmless when nothing is left

    // a room: a tap on the floor of a room where no piece stands picks the room (outline), no piece stays selected
    await ev('window.__edit.session.select(null)'); await sleep(600);
    if (await ev(`document.querySelector('.psp-toggle')?.getAttribute('aria-expanded') === 'true'`)) { await tapSel('.psp-toggle'); await sleep(500); } // the list of the panel must not cover the floor
    const spots = JSON.parse(await ev(`JSON.stringify((() => { const out = [], seen = new Set(); for (const lv of window.__edit.session.state.layout.levels) for (const p of lv.pieces) { const k = lv.id + '/' + p.room; if (seen.has(k)) continue; seen.add(k); const pt = window.__edit.freeFloor(lv.id, p.room); if (pt) out.push({ level: lv.id, room: p.room, x: pt.x, y: pt.y }); } return out; })())`));
    if (spots.length) {
      const spot = spots[0];
      const picNo = await picture('20-before-room'); f2 = await frames();
      await tap(spot.x, spot.y); await sleep(600); await redrawn(f2);
      const picRoom = await picture('21-room-selected');
      const roomId = await ev('window.__edit.selectedRoomId()'), pieceId = await selId(), roomInfo = await ev('JSON.stringify(window.__edit.session.selectedRoom())');
      record('room: a tap on the floor picks the room, no piece is selected', roomId === spot.room && pieceId === null && picRoom !== picNo, { room: spot.room, level: spot.level, name: JSON.parse(roomInfo ?? 'null')?.name, pickedRoom: roomId, selectedPiece: pieceId, pictureChanged: picRoom !== picNo });
      const rc = await ev(`JSON.stringify(window.__edit.session.recolorRoom('floor', '#8a5a3c'))`);
      const colorsNow = JSON.parse(await ev('JSON.stringify(window.__edit.session.selectedRoom()?.colors)'));
      await undoApi(); await sleep(250);
      const colorsUndone = JSON.parse(await ev('JSON.stringify(window.__edit.session.selectedRoom()?.colors ?? null)'));
      record('room: recolouring the floor is one undo step', JSON.parse(rc).ok === true && colorsNow?.floor === '#8a5a3c' && !colorsUndone?.floor, { result: JSON.parse(rc), colors: colorsNow, afterUndo: colorsUndone });
      // a tap beside the plan clears the selection (the corner of the picture is outside the model)
      await tap(14, 14); await sleep(400);
      record('room: a tap outside the plan clears the selection', (await ev('window.__edit.selectedRoomId()')) === null, { selectedRoom: await ev('window.__edit.selectedRoomId()') });
    } else record('room: a tap on the floor picks the room, no piece is selected', false, { error: 'no free floor point found in any room' });
  }

  // 10d. the extra buttons (--btn): saving the picture, the frame hook, the Edit button and leaving the editor again
  if (opt.btn && !opt.edit) {
    const toolInfo = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ps-ui button.tool')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.dataset.tool ?? 'plan:' + b.dataset.plan, x: r.left, y: r.top, w: r.width, h: r.height, text: b.textContent }; }))`));
    await picture('30-buttons');
    const onScreen = (b) => b.w >= 43.5 && b.h >= 43.5 && b.x >= -1 && b.x + b.w <= W + 1 && b.y >= 0 && b.y + b.h <= H + 1;
    const classic = toolInfo.filter((b) => ['edit', 'saveImage', 'loadPlan'].includes(b.name)), extra = toolInfo.filter((b) => !['edit', 'saveImage', 'loadPlan'].includes(b.name));
    record('buttons: Edit, Save image and Load plan are on screen, at least 44 px', classic.length === 3 && classic.every(onScreen), { buttons: classic.map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)} at ${Math.round(b.x)},${Math.round(b.y)}`) });
    record('buttons: the example plans and the open shell are on screen, at least 44 px', extra.length === 3 && extra.every(onScreen), { buttons: extra.map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)} at ${Math.round(b.x)},${Math.round(b.y)}`) });

    // the example plans: Duplex builds the two-storey plan in place (a second level, another picture, plan=duplex-1 in the address, its button pressed), Flat goes back
    const planNow = async () => JSON.parse(await ev(`JSON.stringify({ levels: window.__planInfo().levels, pieces: window.__planInfo().pieces, pressed: [...document.querySelectorAll('#ps-ui button[data-plan]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.plan), hash: location.hash, fail: window.__fail || null })`));
    const planBefore = await planNow(), picPlanFlat = await picture('35-plan-flat');
    let fpl = await frames();
    await tapAt('#ps-ui button[data-plan="duplex-1"]'); await redrawn(fpl);
    const planDup = await planNow(), picPlanDup = await picture('36-plan-duplex');
    record('example plans: Duplex builds the two-storey plan in place', planBefore.levels === 1 && planBefore.pressed.join() === 'flat-1' && planDup.levels === 2 && planDup.pressed.join() === 'duplex-1' && /plan=duplex-1/.test(planDup.hash) && picPlanDup !== picPlanFlat && !planDup.fail, { before: planBefore, after: planDup, pictureChanged: picPlanDup !== picPlanFlat });
    fpl = await frames();
    await tapAt('#ps-ui button[data-plan="flat-1"]'); await redrawn(fpl);
    const planFlat2 = await planNow(), picPlanFlat2 = await picture('37-plan-flat-again');
    record('example plans: Flat goes back and takes plan= out of the address', planFlat2.levels === 1 && planFlat2.pieces === planBefore.pieces && planFlat2.pressed.join() === 'flat-1' && !/plan=/.test(planFlat2.hash) && picPlanFlat2 !== picPlanDup && !planFlat2.fail, { after: planFlat2, pictureChanged: picPlanFlat2 !== picPlanDup });

    // the open shell: the button opens it (every wall lies flat, the camera stays where it was) and the same button folds it back
    const shellSel = '#ps-ui button.tool[data-tool="shell"]';
    const shellNow = async () => JSON.parse(await ev(`JSON.stringify({ mode: window.__shell.mode, clock: window.__shell.clock, deg: window.__shell.state().map((w) => Math.round(w.deg)), view: window.__shell.view().position.map((v) => +v.toFixed(4)), label: document.querySelector(${JSON.stringify(shellSel)}).textContent })`));
    const sh0 = await shellNow(), picSh0 = await picture('38-shell-closed');
    let fsh = await frames();
    await tapAt(shellSel);
    const openedOk = await waitFor('window.__shell.mode === "open"', 20);
    await redrawn(fsh); await sleep(300);
    const sh1 = await shellNow(), picSh1 = await picture('39-shell-open');
    record('open shell: the button opens it, every wall lies flat, the camera stays', sh0.mode === 'closed' && openedOk && sh1.deg.length > 0 && sh1.deg.every((d) => Math.abs(d - 90) <= 1) && JSON.stringify(sh0.view) === JSON.stringify(sh1.view) && picSh1 !== picSh0 && /Close|Złóż/.test(sh1.label), { before: sh0, after: sh1, pictureChanged: picSh1 !== picSh0 });
    fsh = await frames();
    await tapAt(shellSel);
    const closedOk = await waitFor('window.__shell.mode === "closed"', 20);
    await redrawn(fsh); await sleep(300);
    const sh2 = await shellNow(), picSh2 = await picture('40-shell-closed-again');
    record('open shell: the same button folds it back', closedOk && sh2.clock === 0 && sh2.deg.every((d) => d === 0) && JSON.stringify(sh2.view) === JSON.stringify(sh0.view) && picSh2 !== picSh1 && /Open|Otwórz/.test(sh2.label), { after: sh2, pictureChanged: picSh2 !== picSh1 });

    // saving the picture: the file handed over is a PNG
    await ev(`(() => { window.__png = []; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__png.push(b); return orig(b); }; })()`);
    try { await send('Browser.setDownloadBehavior', { behavior: 'deny' }); } catch {}
    await tapAt('#ps-ui button.tool[data-tool="saveImage"]');
    await waitFor('window.__png.length > 0', 20);
    const png = await ev(`(async () => { const b = window.__png[0]; if (!b) return null; const u = new Uint8Array(await b.slice(0, 8).arrayBuffer()); return { bytes: [...u].map((x) => x.toString(16).padStart(2, '0')).join(' '), size: b.size, type: b.type }; })()`);
    record('Save image hands over a PNG file', !!png && png.bytes.startsWith('89 50 4e 47') && png.size > 5000 && png.type === 'image/png', { png });

    // the frame hook: one frame per call, two views give two pictures, nothing is drawn at rest
    if ((await ev('typeof window.__frame')) === 'function') {
      const a = JSON.parse(await ev('window.__frame({ az: 40 }).then((r) => JSON.stringify(r))')), picA = await picture('31-frame-a');
      const b2 = JSON.parse(await ev('window.__frame({ az: 140, dist: 1.1 }).then((r) => JSON.stringify(r))')), picB = await picture('32-frame-b');
      const g1 = await frames(); await sleep(2500); const g2 = await frames();
      const bad = JSON.parse(await ev('window.__frame({ az: NaN, t: 7, preset: "nope", size: { w: 10, h: 10 } }).then((r) => JSON.stringify(r))'));
      const canvas = await ev('(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()');
      record('frame hook: one frame per call, two views, nothing drawn at rest', a.frames === 1 && b2.frames === 1 && a.drawCalls > 0 && picA !== picB && g2 === g1 && bad.frames === 1 && canvas.w === 320 && canvas.h === 180, { first: a, second: b2, framesAtRest: g2 - g1, pictureChanged: picA !== picB, afterBadInput: bad, canvas });
    } else record('frame hook: one frame per call, two views, nothing drawn at rest', false, { error: 'window.__frame is missing' });

    // the shell is opened once more and left open on purpose: the Edit button below must reload into a closed shell
    await tapAt(shellSel); await waitFor('window.__shell.mode === "open"', 20); await sleep(300);

    // the Edit button turns the editor on (the page reloads with edit=1) and Done leaves it; unsaved changes need a second tap
    const editSel = '#ps-ui button.tool[data-tool="edit"]';
    await tapAt(editSel);
    const entered = await waitFor('window.__done === true && typeof window.__edit === "object" && !!document.querySelector("#ps-edit")', Number(opt.timeout));
    await sleep(800);
    const label1 = await ev(`document.querySelector(${JSON.stringify(editSel)})?.textContent ?? null`), btn1 = await rectOf(editSel), bar1 = await rectOf('#ps-edit'), ui1 = await rectOf('#ps-ui');
    await picture('33-edit-entered');
    const shellGone = (await ev('typeof window.__shell')) === 'undefined';
    record('Edit button opens the editor and turns into Done', entered && !!bar1 && !!btn1 && btn1.h >= 43.5 && btn1.x >= -1 && btn1.x + btn1.w <= W + 1 && /Done|Zakończ/.test(label1 ?? ''), { label: label1, button: btn1, hash: await ev('location.hash'), uiBar: ui1 });
    record('Edit with the shell open reloads into a closed shell', entered && shellGone, { shellApi: await ev('typeof window.__shell') });
    if (entered) {
      // while editing the shell stays closed: its button is dimmed, a tap says why, and there is no shell to open
      const shBtn = JSON.parse(await ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(shellSel)}); if (!b) return null; const r = b.getBoundingClientRect(); return { disabled: b.getAttribute('aria-disabled'), title: b.title, shown: r.width > 0 && getComputedStyle(b).display !== 'none', api: typeof window.__shell }; })())`));
      await tapAt(shellSel); await sleep(500);
      const shMsg = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`);
      record('editing: the shell button is dimmed, a tap says why and nothing opens', !!shBtn && shBtn.shown && shBtn.disabled === 'true' && shBtn.api === 'undefined' && /Finish editing|Zakończ edycję/.test(shMsg) && !(await ev('window.__fail')), { button: shBtn, message: shMsg });
      const firstId = await ev('window.__edit.session.state.layout.levels[0].pieces[0].id');
      await ev(`window.__edit.session.select(${JSON.stringify(firstId)}); window.__edit.session.turn(90)`); await sleep(400);
      await tapAt(editSel); await sleep(700);
      const warn = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`), still = await ev('typeof window.__edit');
      await picture('34-done-warning');
      record('Done with unsaved changes warns first and stays', /unsaved|niezapisane/i.test(warn) && still === 'object', { message: warn });
      await tapAt(editSel);
      const left = await waitFor('window.__done === true && typeof window.__edit === "undefined" && !document.querySelector("#ps-edit")', Number(opt.timeout));
      await sleep(500);
      record('a second tap on Done leaves the editor', left, { hash: await ev('location.hash'), label: await ev(`document.querySelector(${JSON.stringify(editSel)})?.textContent ?? null`) });
    }
  }


  // 10e. Load plan: the text of another plan goes into the dialog and the page builds the new model without reloading; a bad text gives a message and changes nothing
  {
    const planText = readFileSync(new URL('../examples/duplex-1.plan.json', import.meta.url), 'utf8');
    const openLoad = async () => {
      if (opt.edit) { await tapAt('#ps-edit button[data-edit="more"]'); await sleep(300); await tapAt('#ps-edit-menu button[data-edit-item="plan"]'); }
      else await tapAt('#ps-ui button.tool[data-tool="loadPlan"]');
      return waitFor("!!document.querySelector('#ps-files-text')", 10);
    };
    const fillAndLoad = async (text) => {
      await ev(`document.querySelector('#ps-files-text').value = ${JSON.stringify(text)}`);
      await tapAt('#ps-files-overlay button.ps-files-load'); await sleep(400);
    };
    const infoNow = async () => JSON.parse(await ev('JSON.stringify(window.__planInfo ? window.__planInfo() : null)'));
    const lineNow = () => ev(`(document.querySelector('#ps-edit-msg') ?? document.querySelector('#ps-ui-msg'))?.textContent ?? ''`);
    const before = await infoNow(), picBefore = await picture('40-plan-before');
    const opened = await openLoad();
    const dialog = await ev(`JSON.stringify({ title: document.querySelector('#ps-files-title')?.textContent ?? null, pick: !!document.querySelector('#ps-files-overlay .ps-files-pick') })`);
    await picture('41-plan-dialog');
    await fillAndLoad('{"not": "a plan"}');
    const badLine = await lineNow(), afterBad = await infoNow(), stillThere = await ev('!!document.querySelector("canvas") && !window.__fail');
    record('Load plan: a text that is not a plan gives a message and changes nothing', opened && /Could not load the plan|Nie wczytano planu/.test(badLine) && JSON.stringify(afterBad) === JSON.stringify(before) && stillThere, { dialog: JSON.parse(dialog), line: badLine.slice(0, 120), before, afterBad });
    const f0 = await frames();
    await openLoad(); await fillAndLoad(planText);
    const swapped = await waitFor(`window.__planInfo && window.__planInfo().levels !== ${before?.levels ?? -1}`, 30);
    await waitFor(`window.__frames > ${f0}`, 30); await sleep(600);
    const okLine = await lineNow(), after = await infoNow(), picAfter = await picture('42-plan-loaded');
    record('Load plan: another plan is built in place, the picture and the pieces change', swapped && picAfter !== picBefore && after.pieces !== before.pieces && /Plan loaded|Wczytano plan/.test(okLine) && (await ev('!window.__fail')), { before, after, line: okLine.slice(0, 100) });
    if (opt.edit) {
      const n = await ev('window.__edit.count()'), undoable = await ev('window.__edit.session.canUndo()');
      const firstId = await ev('window.__edit.session.state.layout.levels[0].pieces[0]?.id ?? null');
      await ev(`window.__edit.session.select(${JSON.stringify(firstId)}); window.__edit.session.turn(90)`); await sleep(500);
      const undoable2 = await ev('window.__edit.session.canUndo()');
      record('Load plan: editing works on the new plan (fresh session, a turn can be undone)', n === after.pieces && undoable === false && undoable2 === true && (await ev('!window.__fail')), { pieces: n, undoBefore: undoable, undoAfterTurn: undoable2 });
    } else {
      const hook = JSON.parse(await ev('window.__frame({ az: 70 }).then((r) => JSON.stringify(r))'));
      record('Load plan: the view still turns and draws after the change', hook.frames === 1 && hook.drawCalls > 0 && (await ev('!window.__fail')), { hook });
    }
  }

  // 11. at rest the page draws nothing: no frames, nothing queued
  await sleep(1500);
  const idle0 = await frames(); await sleep(3000); const idle1 = await frames();
  record('no frames at rest', idle1 === idle0 && (await ev('window.__camera.busy')) === false, { framesAtRest: idle1 - idle0, over: '3 s' });
} catch (e) {
  record('run', false, { error: String(e.message ?? e).slice(0, 300) });
} finally {
  const used = await (async () => { try { return JSON.parse(await ev('JSON.stringify((() => { try { return { local: localStorage.length, session: sessionStorage.length, cookie: document.cookie.length }; } catch (e) { return { error: String(e).slice(0, 80) }; } })())')); } catch { return null; } })();
  if (logs.size) console.log('console:\n' + [...logs].slice(0, 20).join('\n'));
  if (requests.size) console.log('NETWORK (not a local file, data or blob URL):\n' + [...requests].join('\n'));
  if (used && (used.local || used.session || used.cookie)) console.log('STORAGE in use: ' + JSON.stringify(used));
  if (logs.size || requests.size || (used && (used.local || used.session || used.cookie))) failed = true;
  console.log(JSON.stringify({ summary: failed ? 'FAIL' : 'ok', steps: steps.map((x) => `${x.ok ? 'ok' : 'FAIL'} ${x.name}`) }));
  await cleanup();
}
process.exit(failed ? 1 : 0);
