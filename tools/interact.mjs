// Click-through check of the built page or a published address, the way a visitor uses it: headless Chrome (software GL, so slow),
// by default with a phone screen and touch input. It waits for the first frames, then taps a mood button, drags the time-of-day
// slider and changes the quality, and after each step checks that the PICTURE changed, not only the controls.
//   node tools/interact.mjs [--html dist/planstage.html | --html https://host/path/] [--size 390x844] [--scale 3] [--desktop]
//                           [--hash "frames=2"] [--out DIR] [--timeout 240] [--settle 12]
// --desktop uses mouse input and a plain window. --hash is the address hash; empty (the default) is the page exactly as a visitor
// opens it. --settle is how many seconds to wait for a redraw when the page does not report its frame count (older builds).
// Exits 1 when a step fails, the page reports an error, writes to storage or asks for anything outside its own address.
// On a small machine run only one browser at a time (tools/chrome-lock.sh).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { html: null, size: '390x844', scale: '3', hash: '', out: null, timeout: 240, settle: 12, desktop: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--desktop') opt.desktop = true;
  else if (a.startsWith('--') && a.slice(2) in opt && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
  else { console.error(`usage: node tools/interact.mjs [--html FILE|URL] [--size WxH] [--scale N] [--desktop] [--hash H] [--out DIR] [--timeout S] [--settle S] (got ${a})`); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [W, H] = opt.size.split('x').map(Number);
const live = /^https?:\/\//i.test(opt.html ?? '');
const target = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/planstage.html'))).href;
const own = live ? new URL(opt.html).origin + '/' : null;
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'planstage-chrome-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
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
  const url = `${target}${opt.hash ? `#${opt.hash}` : ''}`;
  await send('Page.navigate', { url });

  // 1. the first frames
  const ready = await waitFor('window.__done === true || !!window.__fail', Number(opt.timeout));
  const first = await ev('JSON.stringify({ done: window.__done === true, fail: window.__fail || null, quality: window.__stats?.quality ?? null, size: window.__stats?.size ?? null, touch: navigator.maxTouchPoints })');
  const info = JSON.parse(first);
  record('first frames', ready && info.done && !info.fail, { ...info, viewport: `${W}x${H}`, input: opt.desktop ? 'mouse' : 'touch' });
  if (!(ready && info.done && !info.fail)) throw new Error('the page did not draw its first frames');
  const bar = await rectOf('#ps-ui');
  record('controls on screen', !!bar && bar.x >= -1 && bar.x + bar.w <= W + 1 && bar.y >= 0 && bar.y + bar.h <= H + 1, { bar });
  let pic = await picture('0-start');

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
  const dragPx = Math.round(0.45 * Math.min(W, H)), y = Math.round(upToBar * 0.35), x0 = Math.round(W * 0.2);
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
