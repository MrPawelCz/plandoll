// Click-through check of the built page or a published address, the way a visitor uses it: headless Chrome (software GL, so slow),
// by default with a phone screen and touch input. It waits for the first frames, then taps a mood button, drags the time-of-day
// slider and changes the quality, and after each step checks that the PICTURE changed, not only the controls.
//   node tools/interact.mjs [--html dist/plandoll.html | --html https://host/path/] [--size 390x844] [--scale 3] [--desktop]
//                           [--hash "frames=2"] [--out DIR] [--timeout 240] [--settle 12] [--edit] [--quick] [--btn] [--floors]
// --desktop uses mouse input and a plain window. --hash is the address hash; empty (the default) is the page exactly as a visitor
// opens it. --settle is how many seconds to wait for a redraw when the page does not report its frame count (older builds).
// --edit opens the page with edit=1 and adds the steps of the layout editor (select, drag, turn, undo, redo, delete, automatic layout), then the same with the
// shell open (step 10f: a floor piece and a piece that hangs on an outer wall are selected, dragged, turned, recoloured, resized and deleted; Escape clears the
// selection first and folds the shell second); without it the page is tested as a visitor sees it and the check is that there is no edit bar.
// --btn opens the page with btn=1 and tests the extra buttons: the example plans, the open shell, saving the picture (a PNG), the frame hook, the Edit button (the page reloads with the shell closed), the shell button while editing and leaving the editor again.
// --btn also drives the camera on the flat and on the duplex (cameraBlock): on a phone two fingers that move, a pinch about a point, three fingers, a long drag to the limit, one finger turning
// while moved, the double tap and the touch hint; with the mouse the right and middle button, Shift with the left button, the wheel at the pointer, the nearest zoom and the double click; and the
// card board (closed, half open, open, closed again, a loaded plan). --edit adds gestures that start on a piece: two or three fingers, the right button and Shift move the picture and no piece.
// Each camera step reads the ground point under the fingers from the page (window.__camera.groundAt) and checks that it did not drift, besides the picture changing.
// After the camera steps of each plan (liftBlock) it checks that the centre of the projection is lifted over the part above the controls, that the model starts in the middle of that part and that three turns
// of 45 degrees after a zoom to about half the distance keep it there (the camera looks at the middle of the model, not at a point below the floor).
// With --btn on the duplex (floorsBlock) the floor buttons are tapped one by one: the ground floor, the upper floor (the base of the house comes up under it), with the shell open, in Polish, and back to
// both; every tap checks the hooks, the address, that the turn and the tilt stay, that the floors on show fit above the controls and that the PICTURE changed, and the last tap that the first picture is back (to within 3 levels of 255 of screen noise).
// --edit on a plan with two or more levels adds floorsEditBlock: a piece is selected only on the floor on show, the selection of a floor that goes is cleared, a hidden piece cannot be hit, Add uses the floor on show.
// --floors runs only those steps (plan=duplex-1 in --hash; with --edit the editor ones): the first frames, then the floor steps, then the check that nothing is drawn at rest.
// Exits 1 when a step fails, the page reports an error, writes to storage or asks for anything outside its own address.
// On a small machine run only one browser at a time (tools/chrome-lock.sh).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = { html: null, size: '390x844', scale: '3', hash: '', out: null, timeout: 240, settle: 12, desktop: false, edit: false, quick: false, btn: false, floors: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--desktop') opt.desktop = true;
  else if (a === '--edit') opt.edit = true;
  else if (a === '--quick') opt.quick = true;
  else if (a === '--btn') opt.btn = true;
  else if (a === '--floors') { opt.floors = true; opt.quick = true; }
  else if (a.startsWith('--') && a.slice(2) in opt && i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
  else { console.error(`usage: node tools/interact.mjs [--html FILE|URL] [--size WxH] [--scale N] [--desktop] [--edit] [--quick] [--btn] [--floors] [--hash H] [--out DIR] [--timeout S] [--settle S] (got ${a})`); process.exit(2); }
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
// during: an async function that runs with the pointer still down, after the last move (the state in the middle of a drag)
async function drag(x0, y0, x1, y1, hold = 0, during = null) {
  const n = 12, at = (k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n];
  if (opt.desktop) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' }); await sleep(30); }
    if (hold) await sleep(hold);
    if (during) await during();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
  } else {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(30); }
    if (hold) await sleep(hold);
    if (during) await during();
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
// Several fingers at once (touch only): the fingers go down one after another, move together in small steps, rest a moment and go up together.
const fingers = (pts) => pts.map((p, k) => ({ x: p.x, y: p.y, id: k + 1 }));
async function multiDrag(from, to, steps = 12) {
  for (let i = 0; i < from.length; i++) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(from.slice(0, i + 1)) }); await sleep(35); }
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(from.map((p, i) => ({ x: p.x + (to[i].x - p.x) * k, y: p.y + (to[i].y - p.y) * k }))) });
    await sleep(30);
  }
  await sleep(150);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// The mouse with a chosen button (left, right or middle) and modifier keys (Shift is 8), a drag from (x0, y0) to (x1, y1).
async function mouseDrag(button, x0, y0, x1, y1, modifiers = 0) {
  const mask = { left: 1, right: 2, middle: 4 }[button], n = 12;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button, buttons: mask, clickCount: 1, modifiers });
  for (let k = 1; k <= n; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, button, buttons: mask, modifiers }); await sleep(30); }
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button, buttons: 0, clickCount: 1, modifiers });
}
const wheelAt = (x, y, deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
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
// A screenshot as raw pixels (Chrome writes 8-bit RGB or RGBA PNG files that are not interlaced), so that two pictures can be compared with a small tolerance.
function decodePng(b64) {
  const buf = Buffer.from(b64, 'base64');
  let pos = 8, w = 0, h = 0, bpp = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4); bpp = body[9] === 6 ? 4 : 3;
      if (body[8] !== 8 || (body[9] !== 6 && body[9] !== 2) || body[12] !== 0) throw new Error('a PNG of a kind that is not handled');
    } else if (type === 'IDAT') idat.push(body);
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
// Two screenshots are the same picture when no colour channel of any pixel differs by more than tol of 255. The screen adds a level or two of noise at the soft edge of a hint or
// a shadow (a phone run differed in one pixel by one level), while a floor that is left behind or a camera that moved changes thousands of pixels by much more.
function nearPictures(a, b, tol = 3) {
  const A = decodePng(a), B = decodePng(b);
  if (A.w !== B.w || A.h !== B.h || A.bpp !== B.bpp) return { same: false, why: 'the size differs' };
  let bad = 0, worst = 0;
  for (let i = 0; i < A.px.length; i += A.bpp) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.px[i + k] - B.px[i + k]));
    if (d > worst) worst = d;
    if (d > tol) bad++;
  }
  return { same: bad === 0, bad, worst };
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

// ---- the camera: pan, pinch, wheel and the double tap, with real touch and mouse events ----
// The page reports where the camera stands (window.__camera: turn, distance, pan in metres) and the ground point under a client point (groundAt), so a step can
// check that the ground under the fingers stays under them, besides the picture changing.
const camNow = async () => JSON.parse(await ev(`JSON.stringify({ az: window.__camera.azimuth, d: window.__camera.distance, base: window.__camera.base, pan: window.__camera.pan, target: window.__camera.target, near: window.__camera.nearPlane })`));
const groundAt = async (x, y) => JSON.parse(await ev(`JSON.stringify(window.__camera.groundAt(${x}, ${y}))`));
const gap = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity);
const panLen = (c) => Math.hypot(c.pan[0], c.pan[1]);
const round2 = (v) => +Number(v).toFixed(2);
const homeAgain = async () => { const f = await frames(); await ev('window.__camera.reset()'); await redrawn(f); await sleep(250); };
// Runs an input action, waits for the page to draw, and returns the camera before and after.
async function gesture(action) {
  const f = await frames(), c0 = await camNow();
  await action(); await redrawn(f); await sleep(250);
  return { c0, c1: await camNow() };
}
// The part of the screen above the controls where fingers may go, and its middle.
const pictureArea = async () => {
  const top = await ev(`Math.floor(Math.min(...['#ps-ui', '#ps-ui .blurb', '#ps-edit'].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? innerHeight)) - 8)`);
  return { top, cx: Math.round(W / 2), cy: Math.round(top * 0.5) };
};

// The window changes shape (a turned phone, bars that grow): the view is framed again, and the move the person made stays, now from the new home.
async function resizeKeepsPan(tag) {
  const f = await frames();
  if (opt.desktop) await mouseDrag('right', Math.round(W / 2), 200, Math.round(W / 2) + 70, 240); else await multiDrag([{ x: 150, y: 220 }, { x: 240, y: 220 }], [{ x: 220, y: 260 }, { x: 310, y: 260 }]);
  await redrawn(f); await sleep(200);
  const before = await camNow(), home0 = JSON.parse(await ev('JSON.stringify(window.__camera.target)')), f1 = await frames();
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H - 90, deviceScaleFactor: opt.desktop ? 1 : Number(opt.scale), mobile: !opt.desktop });
  await waitFor(`window.__frames > ${f1}`, 30); await sleep(700);
  const after = await camNow();
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: opt.desktop ? 1 : Number(opt.scale), mobile: !opt.desktop });
  const f2 = await frames(); await waitFor(`window.__frames > ${f2}`, 30); await sleep(500);
  record(`camera ${tag}: framing again after the window changed shape keeps the move`, panLen(before) > 0.3 && gap(before.pan, after.pan) < 1e-6 && Number.isFinite(after.d) && after.d > 0, { panBefore: before.pan.map(round2), panAfter: after.pan.map(round2), targetBefore: before.target.map(round2), targetAfter: after.target.map(round2), distance: `${round2(before.d)} -> ${round2(after.d)}` });
  await homeAgain();
}

// The visitor's camera steps (no editor): on a phone two fingers move and zoom, three fingers move; with the mouse the right button, the middle button and
// Shift with the left button move, the wheel zooms towards the pointer; a double tap or double click goes back to the start, the pan included.
async function cameraBlock(tag) {
  const { top, cx, cy } = await pictureArea();
  await homeAgain();
  const home = await camNow(), picHome = await picture(`${tag}-cam-0-home`);
  const label = (s) => `camera ${tag}: ${s}`;
  if (!opt.desktop) {
    // two fingers move the picture: the ground under the middle of the fingers follows it
    const [dx, dy] = [70, 40], g0 = await groundAt(cx, cy);
    const a = await gesture(() => multiDrag([{ x: cx - 45, y: cy }, { x: cx + 45, y: cy }], [{ x: cx - 45 + dx, y: cy + dy }, { x: cx + 45 + dx, y: cy + dy }]));
    const g1 = await groundAt(cx + dx, cy + dy), picA = await picture(`${tag}-cam-1-two-finger-move`);
    record(label('two fingers move the picture and the ground stays under them'), panLen(a.c1) > 0.3 && gap(g0, g1) < 0.2 && Math.abs(a.c1.d / a.c0.d - 1) < 0.02 && Math.abs(a.c1.az - a.c0.az) < 0.5 && picA !== picHome,
      { panMetres: a.c1.pan.map(round2), driftMetres: round2(gap(g0, g1)), distance: `${round2(a.c0.d)} -> ${round2(a.c1.d)}`, turned: round2(a.c1.az - a.c0.az), pictureChanged: picA !== picHome });
    // a pinch around a point: the picture zooms in and the ground under that point stays under it
    await homeAgain();
    const P = { x: cx + 30, y: cy - 20 }, gp0 = await groundAt(P.x, P.y), picP0 = await picture(`${tag}-cam-2-before-pinch`);
    const b = await gesture(() => multiDrag([{ x: P.x - 40, y: P.y }, { x: P.x + 40, y: P.y }], [{ x: P.x - 100, y: P.y }, { x: P.x + 100, y: P.y }]));
    const gp1 = await groundAt(P.x, P.y), picP1 = await picture(`${tag}-cam-3-pinch-in`);
    record(label('a pinch zooms in around the point between the fingers and keeps that point under them'), b.c1.d < 0.6 * b.c0.d && b.c1.d >= 0.2 * b.c0.base - 1e-6 && gap(gp0, gp1) < 0.15 && picP1 !== picP0,
      { distance: `${round2(b.c0.d)} -> ${round2(b.c1.d)} (default ${round2(b.c0.base)})`, driftMetres: round2(gap(gp0, gp1)), nearPlane: round2(b.c1.near), pictureChanged: picP1 !== picP0 });
    // a pinch the other way zooms out, again about the point
    const out1 = await gesture(() => multiDrag([{ x: P.x - 100, y: P.y }, { x: P.x + 100, y: P.y }], [{ x: P.x - 60, y: P.y }, { x: P.x + 60, y: P.y }])); // a moderate zoom out: the target stays inside its box
    const gp2 = await groundAt(P.x, P.y);
    record(label('a pinch the other way zooms out about the same point'), out1.c1.d > out1.c0.d * 1.5 && gap(gp0, gp2) < 0.15, { distance: `${round2(out1.c0.d)} -> ${round2(out1.c1.d)}`, driftMetres: round2(gap(gp0, gp2)) });
    // three fingers move the picture with their middle
    await homeAgain();
    const tri = [{ x: cx - 60, y: cy + 10 }, { x: cx, y: cy - 10 }, { x: cx + 60, y: cy + 10 }], mid0 = { x: cx, y: cy + 10 / 3 }, [tx, ty] = [-60, 50], gt0 = await groundAt(mid0.x, mid0.y);
    const c = await gesture(() => multiDrag(tri, tri.map((p) => ({ x: p.x + tx, y: p.y + ty }))));
    const gt1 = await groundAt(mid0.x + tx, mid0.y + ty), picT = await picture(`${tag}-cam-4-three-finger-move`);
    record(label('three fingers move the picture and the ground stays under their middle'), panLen(c.c1) > 0.3 && gap(gt0, gt1) < 0.2 && Math.abs(c.c1.d / c.c0.d - 1) < 0.02 && picT !== picP0,
      { panMetres: c.c1.pan.map(round2), driftMetres: round2(gap(gt0, gt1)), distance: `${round2(c.c0.d)} -> ${round2(c.c1.d)}`, pictureChanged: picT !== picP0 });
    // one finger still turns the model while it is moved and zoomed in; the pan does not change by the turn
    const dragPx = Math.round(0.35 * Math.min(W, H)), turn0 = await camNow();
    await gesture(() => drag(Math.round(W * 0.2), cy, Math.round(W * 0.2) + dragPx, cy, 150));
    await waitFor('window.__camera.busy === false', 60);
    const turn1 = await camNow(), picTurn = await picture(`${tag}-cam-5-turned-while-moved`);
    record(label('one finger still turns the model while it is moved'), Math.abs(turn1.az - turn0.az) > 15 && gap(turn0.pan, turn1.pan) < 1e-6 && picTurn !== picT, { turned: round2(turn1.az - turn0.az), panKept: gap(turn0.pan, turn1.pan) < 1e-6, pictureChanged: picTurn !== picT });
    // a double tap goes back to the start: turn, zoom and pan
    await gesture(() => multiDrag([{ x: cx - 45, y: cy }, { x: cx + 45, y: cy }], [{ x: cx - 85, y: cy + 20 }, { x: cx + 85, y: cy + 20 }])); // a pinch and a move on top
    const before = await camNow(), f = await frames();
    await tap(cx, cy); await sleep(90); await tap(cx, cy);
    await waitFor('window.__camera.busy === false', 60); await redrawn(f); await sleep(200);
    const after = await camNow(), picReset = await picture(`${tag}-cam-6-double-tap-reset`);
    record(label('a double tap goes back to the start: turn, zoom and pan'), panLen(before) > 0.05 && panLen(after) < 0.005 && Math.abs(after.d - home.base) < 0.01 && Math.abs(((after.az - home.az + 540) % 360) - 180) < 1.5 && picReset !== picTurn,
      { before: { pan: before.pan.map(round2), d: round2(before.d), az: round2(before.az) }, after: { pan: after.pan.map(round2), d: round2(after.d), az: round2(after.az) }, home: { d: round2(home.base), az: round2(home.az) }, sameAsStart: picReset === picHome });
    // the move stops at the edge of the card board (with the shell: the board of the moment grown by 4 percent; without: the model grown by 15 percent): a long drag does not lose the model
    for (let k = 0; k < 3; k++) await multiDrag([{ x: 10, y: cy }, { x: 60, y: cy }], [{ x: W - 40, y: cy }, { x: W - 10, y: cy }], 6);
    await sleep(300);
    const far = await camNow(), boardNow = JSON.parse(await ev('JSON.stringify(window.__shell ? window.__stats.board : null)'));
    const lim = boardNow ?? JSON.parse(await ev('JSON.stringify(window.__planInfo().extent)')), grow = boardNow ? 0.04 : 0.15;
    const box = Array.isArray(lim) ? { minX: lim[0], maxX: lim[1], minZ: lim[2], maxZ: lim[3] } : lim, gx = (box.maxX - box.minX) * grow, gz = (box.maxZ - box.minZ) * grow;
    const edgeGap = Math.min(Math.abs(far.target[0] - (box.minX - gx)), Math.abs(far.target[0] - (box.maxX + gx)), Math.abs(far.target[2] - (box.minZ - gz)), Math.abs(far.target[2] - (box.maxZ + gz))); // the drag really reached the limit on one side
    record(label(boardNow ? 'a long drag stops at the edge of the card board grown by 4 percent' : 'a long drag stops at the edge of the model grown by 15 percent'), panLen(far) > 1 && edgeGap < 0.2 && far.target[0] >= box.minX - gx - 0.01 && far.target[0] <= box.maxX + gx + 0.01 && far.target[2] >= box.minZ - gz - 0.01 && far.target[2] <= box.maxZ + gz + 0.01,
      { target: far.target.map(round2), box: [box.minX, box.maxX, box.minZ, box.maxZ].map(round2), grow, edgeGap: round2(edgeGap), pan: far.pan.map(round2) });
    await homeAgain();
    await resizeKeepsPan(tag);
  } else {
    // the right button moves the picture, and no menu opens
    await ev(`window.__ctx = []; window.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented))`);
    const [dx, dy] = [90, 50], g0 = await groundAt(cx, cy);
    const a = await gesture(() => mouseDrag('right', cx, cy, cx + dx, cy + dy));
    const g1 = await groundAt(cx + dx, cy + dy), picA = await picture(`${tag}-cam-1-right-button`), ctx = JSON.parse(await ev('JSON.stringify(window.__ctx)'));
    record(label('the right button moves the picture, the ground stays under the pointer, no menu'), panLen(a.c1) > 0.3 && gap(g0, g1) < 0.2 && Math.abs(a.c1.az - a.c0.az) < 0.5 && Math.abs(a.c1.d / a.c0.d - 1) < 0.01 && picA !== picHome && ctx.every((x) => x === true),
      { panMetres: a.c1.pan.map(round2), driftMetres: round2(gap(g0, g1)), turned: round2(a.c1.az - a.c0.az), contextMenuPrevented: ctx, pictureChanged: picA !== picHome });
    // the middle button
    await homeAgain();
    const gm0 = await groundAt(cx, cy), m = await gesture(() => mouseDrag('middle', cx, cy, cx - dx, cy + dy)), gm1 = await groundAt(cx - dx, cy + dy);
    record(label('the middle button moves the picture'), panLen(m.c1) > 0.3 && gap(gm0, gm1) < 0.2 && Math.abs(m.c1.az - m.c0.az) < 0.5, { panMetres: m.c1.pan.map(round2), driftMetres: round2(gap(gm0, gm1)) });
    // Shift with the left button
    await homeAgain();
    const gs0 = await groundAt(cx, cy), s = await gesture(() => mouseDrag('left', cx, cy, cx + dx, cy - dy, 8)), gs1 = await groundAt(cx + dx, cy - dy), picS = await picture(`${tag}-cam-2-shift-left`);
    record(label('Shift with the left button moves the picture'), panLen(s.c1) > 0.3 && gap(gs0, gs1) < 0.2 && Math.abs(s.c1.az - s.c0.az) < 0.5 && picS !== picA, { panMetres: s.c1.pan.map(round2), driftMetres: round2(gap(gs0, gs1)), pictureChanged: picS !== picA });
    // the wheel zooms towards the pointer: the ground point under it stays under it
    await homeAgain();
    const P = { x: cx + 160, y: cy - 40 }, gw0 = await groundAt(P.x, P.y), picW0 = await picture(`${tag}-cam-3-before-wheel`);
    const w = await gesture(async () => { for (let k = 0; k < 4; k++) { await wheelAt(P.x, P.y, -240); await sleep(70); } });
    const gw1 = await groundAt(P.x, P.y), picW1 = await picture(`${tag}-cam-4-wheel-in`);
    record(label('the wheel zooms towards the pointer and keeps the ground under it'), w.c1.d < 0.7 * w.c0.d && gap(gw0, gw1) < 0.15 && picW1 !== picW0 && panLen(w.c1) > 0.05,
      { distance: `${round2(w.c0.d)} -> ${round2(w.c1.d)}`, driftMetres: round2(gap(gw0, gw1)), panMetres: w.c1.pan.map(round2), nearPlane: round2(w.c1.near), pictureChanged: picW1 !== picW0 });
    const wo = await gesture(async () => { for (let k = 0; k < 6; k++) { await wheelAt(P.x, P.y, 300); await sleep(70); } });
    const gw2 = await groundAt(P.x, P.y);
    record(label('the wheel the other way zooms out about the same point, up to the far limit'), wo.c1.d > wo.c0.d * 1.4 && wo.c1.d <= 1.8 * wo.c1.base + 1e-6 && gap(gw0, gw2) < 0.3, { distance: `${round2(wo.c0.d)} -> ${round2(wo.c1.d)} (limit ${round2(1.8 * wo.c1.base)})`, driftMetres: round2(gap(gw0, gw2)) });
    // zoom in to the near limit: the camera stays outside the walls and the near plane has shrunk
    await homeAgain();
    await gesture(async () => { for (let k = 0; k < 30; k++) { await wheelAt(cx, cy, -400); await sleep(25); } });
    const nearest = await camNow(), picNear = await picture(`${tag}-cam-5-nearest`);
    record(label('the nearest zoom is 0.2 times the default distance and the near plane shrinks with it'), Math.abs(nearest.d - 0.2 * nearest.base) < 0.02 && nearest.near < 0.5, { distance: round2(nearest.d), base: round2(nearest.base), nearPlane: round2(nearest.near) });
    // a double click goes back to the start, the pan included
    await gesture(() => mouseDrag('right', cx, cy, cx + 60, cy + 30));
    const before = await camNow(), f = await frames();
    await tap(cx, cy); await sleep(90); await tap(cx, cy);
    await waitFor('window.__camera.busy === false', 60); await redrawn(f); await sleep(200);
    const after = await camNow(), picReset = await picture(`${tag}-cam-6-double-click-reset`);
    record(label('a double click goes back to the start: turn, zoom and pan'), panLen(before) > 0.05 && panLen(after) < 0.005 && Math.abs(after.d - home.base) < 0.01 && picReset !== picNear,
      { before: { pan: before.pan.map(round2), d: round2(before.d) }, after: { pan: after.pan.map(round2), d: round2(after.d) }, sameAsStart: picReset === picHome });
    // the left button still turns
    const t0 = await camNow(), turn = await gesture(() => drag(Math.round(W * 0.2), cy, Math.round(W * 0.2) + Math.round(0.35 * Math.min(W, H)), cy, 150));
    await waitFor('window.__camera.busy === false', 60);
    record(label('the left button still turns the model'), Math.abs(turn.c1.az - t0.az) > 15 && gap(t0.pan, turn.c1.pan) < 1e-6, { turned: round2(turn.c1.az - t0.az) });
    await homeAgain();
    await resizeKeepsPan(tag);
  }
}

// The editor's camera steps (--edit): a gesture of two or three fingers (or the right button, or Shift with the left one) that starts on a piece moves the
// picture and touches no piece and no selection; one finger on a piece still drags it (the steps above), one finger beside the pieces still turns.
async function editCameraBlock(pieceId) {
  { // the shell is built while editing too, so the board is the one that hugs the closed house, as outside the editor (boardRect in src/look/board.js): the closed model grown
    // by the outer faces of its exterior walls (half of the default thickness of 0.3 m on every side), then by a rim of max(0.35 m, 6 percent of the larger side of that). The
    // old board (the model plus a margin of 9 percent, at least 0.5 m: the board of shell=0) is 0.14 to 0.2 m wider on these plans, so it does not pass this check.
    const e = JSON.parse(await ev('JSON.stringify(window.__planInfo().extent)')), w = e[1] - e[0], d = e[3] - e[2], wall = 0.3, rim = Math.max(0.35, 0.06 * (Math.max(w, d) + wall)), b = JSON.parse(await ev('JSON.stringify(window.__stats.board)'));
    record('edit: the board hugs the closed house, as outside the editor (the shell is built while editing): the closed model, the outer faces of its walls and a rim of max(0.35 m, 6 percent of the larger side)', Math.abs(b.width - (w + wall + 2 * rim)) < 0.03 && Math.abs(b.depth - (d + wall + 2 * rim)) < 0.03, { board: `${b.width} x ${b.depth} m`, model: `${w.toFixed(2)} x ${d.toFixed(2)} m`, rim: +rim.toFixed(3), expected: `${(w + wall + 2 * rim).toFixed(3)} x ${(d + wall + 2 * rim).toFixed(3)} m` });
  }
  await ev('window.__edit.session.select(null)'); await homeAgain(); await sleep(300);
  const layoutNow = () => ev('JSON.stringify(window.__edit.session.state.layout)');
  const { top } = await pictureArea();
  let pt = await ev(`window.__edit.screenOf(${JSON.stringify(pieceId)})`);
  if (!pt || (await ev(`window.__edit.hit(${pt.x}, ${pt.y})`)) !== pieceId || pt.y > top - 40) pt = null;
  if (!pt) { record('camera edit: a piece is on the picture to start the gestures on', false, { piece: pieceId }); return; }
  const lay0 = await layoutNow(), cx = Math.round(pt.x), cy = Math.round(pt.y), pic0 = await picture('cam-edit-0');
  const sel = () => ev('window.__edit.selectedId()');
  if (!opt.desktop) {
    const g0 = await groundAt(cx, cy);
    const a = await gesture(() => multiDrag([{ x: cx, y: cy }, { x: Math.min(W - 20, cx + 90), y: cy }], [{ x: cx + 50, y: cy + 30 }, { x: Math.min(W - 20, cx + 90) + 50, y: cy + 30 }]));
    const g1 = await groundAt(cx + 50 + (Math.min(W - 20, cx + 90) - cx) / 2, cy + 30), picA = await picture('cam-edit-1-two-fingers');
    record('camera edit: two fingers that start on a piece move the picture, no piece moves, nothing is selected', panLen(a.c1) > 0.2 && (await layoutNow()) === lay0 && (await sel()) === null && picA !== pic0,
      { panMetres: a.c1.pan.map(round2), layoutSame: (await layoutNow()) === lay0, selected: await sel(), pictureChanged: picA !== pic0 });
    await homeAgain();
    const tri = [{ x: cx, y: cy }, { x: Math.max(20, cx - 70), y: cy + 20 }, { x: Math.min(W - 20, cx + 70), y: cy + 20 }];
    const c = await gesture(() => multiDrag(tri, tri.map((p) => ({ x: p.x - 40, y: p.y + 30 }))));
    record('camera edit: three fingers that start on a piece move the picture, no piece moves, nothing is selected', panLen(c.c1) > 0.2 && (await layoutNow()) === lay0 && (await sel()) === null,
      { panMetres: c.c1.pan.map(round2), layoutSame: (await layoutNow()) === lay0, selected: await sel() });
    await homeAgain();
    // one finger beside the pieces turns the model and moves no piece
    const area = await pictureArea(); let spot = null;
    search: for (const fy of [0.35, 0.2, 0.5, 0.1, 0.65]) for (const fx of [0.2, 0.1, 0.3, 0.05, 0.4]) {
      const px = Math.round(W * fx), py = Math.round(area.top * fy);
      if ((await ev(`window.__edit.hit(${px}, ${py})`)) === null) { spot = { x: px, y: py }; break search; }
    }
    const t0 = await camNow(), turn = spot ? await gesture(() => drag(spot.x, spot.y, Math.min(W - 10, spot.x + Math.round(0.35 * Math.min(W, H))), spot.y, 150)) : null;
    if (turn) await waitFor('window.__camera.busy === false', 60);
    record('camera edit: one finger beside the pieces still turns the model and moves no piece', !!turn && Math.abs(turn.c1.az - t0.az) > 15 && (await layoutNow()) === lay0, { turned: turn ? round2(turn.c1.az - t0.az) : null, layoutSame: (await layoutNow()) === lay0 });
  } else {
    const [dx, dy] = [80, 40], g0 = await groundAt(cx, cy);
    const a = await gesture(() => mouseDrag('right', cx, cy, cx + dx, cy + dy)), g1 = await groundAt(cx + dx, cy + dy);
    record('camera edit: the right button on a piece moves the picture, no piece moves, nothing is selected', panLen(a.c1) > 0.2 && gap(g0, g1) < 0.2 && (await layoutNow()) === lay0 && (await sel()) === null,
      { panMetres: a.c1.pan.map(round2), driftMetres: round2(gap(g0, g1)), layoutSame: (await layoutNow()) === lay0, selected: await sel() });
    await homeAgain();
    const s = await gesture(() => mouseDrag('left', cx, cy, cx + dx, cy - dy, 8));
    record('camera edit: Shift with the left button on a piece moves the picture and no piece', panLen(s.c1) > 0.2 && (await layoutNow()) === lay0 && (await sel()) === null, { panMetres: s.c1.pan.map(round2), layoutSame: (await layoutNow()) === lay0, selected: await sel() });
    await homeAgain();
    const gw0 = await groundAt(cx, cy), w = await gesture(async () => { for (let k = 0; k < 3; k++) { await wheelAt(cx, cy, -240); await sleep(70); } }), gw1 = await groundAt(cx, cy);
    record('camera edit: the wheel zooms towards the pointer, the ground under it stays', w.c1.d < 0.8 * w.c0.d && gap(gw0, gw1) < 0.15 && (await layoutNow()) === lay0, { distance: `${round2(w.c0.d)} -> ${round2(w.c1.d)}`, driftMetres: round2(gap(gw0, gw1)) });
  }
  await homeAgain();
}

// The centre of the projection sits over the part of the picture that the controls leave free, and the camera looks at the middle of the model: it stays in that
// part at the start and while the person zooms in and turns it (the fit puts the middle of the closed model and of every wall lying flat there; a turn about a point
// below the floor swung the house out of the picture). Reads the corners from window.__shell.project() (px) and the top of the controls from the same call.
const modelOnPicture = async () => JSON.parse(await ev(`JSON.stringify((() => {
  const p = window.__shell.project(), pts = p.pts, xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), cl = pts.filter((q) => q.kind === 'closed');
  return { w: p.w, h: p.h, barTop: p.barTop, lift: window.__camera.lift, all: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, closed: { x: cl.reduce((s, q) => s + q.x, 0) / cl.length, y: cl.reduce((s, q) => s + q.y, 0) / cl.length } };
})())`));
async function liftBlock(tag) {
  const label = (s) => `lift ${tag}: ${s}`;
  await homeAgain();
  const i0 = await modelOnPicture(), top = i0.barTop ?? H, mid = { x: W / 2, y: top / 2 };
  record(label('at the start the middle of the model is in the middle of the part above the controls, and the centre of the projection is lifted by the share they cover'),
    Math.abs(i0.all.x - mid.x) < 0.05 * W && Math.abs(i0.all.y - mid.y) < 0.04 * H && Math.abs(i0.lift - Math.min(0.4, (H - top) / H)) < 0.02 && i0.lift > 0,
    { middle: { x: round2(i0.all.x), y: round2(i0.all.y) }, wantMiddle: { x: round2(mid.x), y: round2(mid.y) }, barTop: round2(top), lift: round2(i0.lift) });
  // zoom in about the middle of the free part to about 0.45 of the start distance: a pinch (touch) or the wheel (mouse)
  const c0 = await camNow(), cyF = Math.round(mid.y);
  if (opt.desktop) await gesture(async () => { for (let k = 0; k < 6 && (await camNow()).d > 0.5 * c0.base; k++) { await wheelAt(Math.round(mid.x), cyF, -300); await sleep(80); } });
  else await gesture(() => multiDrag([{ x: mid.x - 35, y: cyF }, { x: mid.x + 35, y: cyF }], [{ x: mid.x - 78, y: cyF }, { x: mid.x + 78, y: cyF }]));
  const z = await camNow(), step = Math.round(0.225 * Math.min(W, H)); // 45 degrees of turn
  const seen = [];
  let allIn = z.d < 0.7 * z.base, az = z.az, turned = true;
  for (let k = 1; k <= 3; k++) {
    const x0 = Math.round(W * 0.25), yy = Math.min(Math.round(top * 0.85), cyF + 70);
    const t = await gesture(() => drag(x0, yy, x0 + step, yy, 150)); await waitFor('window.__camera.busy === false', 60);
    const i = await modelOnPicture(), da = Math.abs(((t.c1.az - az + 540) % 360) - 180);
    turned = turned && da > 20 && da < 70;
    const inside = Math.abs(i.closed.x - mid.x) < 0.25 * W && Math.abs(i.closed.y - mid.y) < 0.3 * top;
    allIn = allIn && inside; az = t.c1.az;
    seen.push({ turn: k, azimuth: round2(t.c1.az), closed: { x: round2(i.closed.x), y: round2(i.closed.y) }, inside });
  }
  record(label('zoomed in to about half the distance, three turns of 45 degrees keep the model in the middle of the part above the controls'), allIn && turned, { distance: `${round2(c0.d)} -> ${round2(z.d)}`, middle: { x: round2(mid.x), y: round2(mid.y) }, seen });
  await homeAgain();
}

// ---- the floors on show (a plan with two or more levels): one button per floor and one for all of them ----
// Every tap must change the PICTURE, not only the hooks: the other floors are not drawn, the camera keeps its turn and tilt and fits the floors on show above the controls, the
// address follows without a reload, the language changes the words, and a tap on the last button brings the first picture back, to within the noise of the screen.
const floorBtns = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ps-ui button.floor')].map((b) => { const r = b.getBoundingClientRect(); return { key: b.dataset.floor, text: b.textContent, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), x: r.left, y: r.top, w: r.width, h: r.height }; }))`));
const floorNow = async () => JSON.parse(await ev(`JSON.stringify({ floor: window.__floors.get(), visible: window.__floors.visible(), lift: window.__floors.lift(), count: window.__floors.count, hash: location.hash, fail: window.__fail || null, az: window.__camera.azimuth, pol: window.__camera.polar, dist: window.__camera.distance, pressed: [...document.querySelectorAll('#ps-ui button.floor')].map((b) => b.getAttribute('aria-pressed')).join(',') })`));
// where the corners of the closed model and of every wall lying flat (the floors on show only) land: all of them must be inside the window and above the controls
const floorFit = () => ev(`(() => { if (typeof window.__shell !== 'object') return null; const p = window.__shell.project(), top = p.barTop ?? p.h; return { n: p.pts.length, inside: p.pts.every((q) => q.x >= -1 && q.x <= p.w + 1 && q.y >= -1 && q.y <= top + 1), lowest: Math.round(Math.max(...p.pts.map((q) => q.y))), top: Math.round(top) }; })()`);
// draw calls of the frame the page draws now (the frame hook draws one frame and reports renderer.info.render.calls)
const floorCalls = () => ev('window.__frame({}).then((r) => r.drawCalls)');
const tapFloor = async (key) => { const f = await frames(), ok = await tapAt(`#ps-ui button.floor[data-floor="${key}"]`); await redrawn(f); await sleep(300); return ok; };
async function floorsBlock(tag) {
  const label = (s) => `floors ${tag}: ${s}`, noFloor = (h) => !/(^|[#&])floor=/.test(h);
  if ((await ev('typeof window.__floors')) !== 'object') { record(label('the page has the floor hook'), false, { error: 'window.__floors is missing' }); return; }
  const startFloor = await ev('window.__floors.get()');
  if (startFloor !== 'all') { // the address asked for one floor (--hash floor=1): the page opens with it
    const s = await floorNow(), pic = await picture(`${tag}-floor-00-from-address`), fit = await floorFit();
    record(label(`the address floor=${startFloor} opens with that floor only, its button pressed, fitted above the controls`), s.floor === startFloor && s.visible.join() === String(startFloor) && s.pressed.split(',')[startFloor] === 'true' && fit?.inside !== false && !s.fail && (startFloor === 0 ? s.lift === 0 : s.lift > 2), { state: s, fit, pictureBytes: pic.length });
    await tapFloor('all');
  }
  const b0 = await floorBtns(), s0 = await floorNow(), pic0 = await picture(`${tag}-floor-1-both`), fit0 = await floorFit(), calls0 = await floorCalls();
  record(label('the buttons are there: one per floor and one for both, at least 40 px, on the screen, Both pressed, each with a name'),
    b0.length === 3 && b0.map((b) => b.key).join() === '0,1,all' && b0.every((b) => b.h >= 39.5 && b.w >= 39.5 && b.x >= -1 && b.x + b.w <= W + 1 && b.y >= 0 && b.y + b.h <= H + 1 && b.label?.length > 6) && s0.pressed === 'false,false,true'
      && /Ground floor|Parter/.test(b0[0].text) && /Upper floor|Piętro/.test(b0[1].text) && /Both|Oba/.test(b0[2].text) && s0.floor === 'all' && s0.visible.join() === '0,1' && s0.lift === 0 && s0.count === 2 && fit0?.inside !== false,
    { buttons: b0.map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)} at ${Math.round(b.x)},${Math.round(b.y)}${b.pressed === 'true' ? ' pressed' : ''}`), fit: fit0 });

  await tapFloor('0');
  const g = await floorNow(), picG = await picture(`${tag}-floor-2-ground`), fitG = await floorFit(), callsG = await floorCalls();
  const litGround = await ev(`typeof window.__shell === 'object' ? window.__shell.patchesLit() : null`); // the window light on the ground floor while the shell is closed
  record(label('Ground floor: only that floor is drawn, the picture changes, the address follows, the turn and the tilt stay, the floor fits above the controls'),
    g.floor === 0 && g.visible.join() === '0' && g.lift === 0 && /floor=0/.test(g.hash) && g.pressed === 'true,false,false' && picG !== pic0 && Math.abs(g.az - s0.az) < 1e-6 && Math.abs(g.pol - s0.pol) < 1e-6 && fitG?.inside !== false && !g.fail,
    { state: g, fit: fitG, pictureChanged: picG !== pic0 });

  await tapFloor('1');
  const u = await floorNow(), picU = await picture(`${tag}-floor-3-upper`), fitU = await floorFit(), callsU = await floorCalls();
  record(label('Upper floor: the other floor is drawn instead, the base of the house comes up under it, the picture differs from both, the address follows, the floor fits'),
    u.floor === 1 && u.visible.join() === '1' && u.lift > 2 && /floor=1/.test(u.hash) && !/floor=0/.test(u.hash) && u.pressed === 'false,true,false' && picU !== pic0 && picU !== picG && Math.abs(u.az - s0.az) < 1e-6 && Math.abs(u.pol - s0.pol) < 1e-6 && fitU?.inside !== false && !u.fail,
    { state: u, fit: fitU, differsFromBoth: picU !== pic0 && picU !== picG });

  // the hook and the address take the same values: a wrong one means all
  const hookSet = await ev(`JSON.stringify([window.__floors.set('0'), window.__floors.set('1'), window.__floors.set('nonsense'), window.__floors.set(7), window.__floors.set(0), window.__floors.set('all')])`);
  await waitFor('window.__camera.busy === false', 30); await sleep(400);
  record(label('the test hook takes 0, 1 and all, and a wrong value or a floor that does not exist is all'), hookSet === JSON.stringify([0, 1, 'all', 'all', 0, 'all']), { returned: hookSet });
  // nothing is merged again and nothing is added: a floor that is not on show costs no draw call, and all floors cost again what they cost before (measured before the shell moves:
  // opening and closing the shell itself leaves four more calls than the start, with or without the floor buttons), under the limit of the page (1800 on high)
  const callsA = await floorCalls();
  record(label('draw calls: a single floor draws fewer calls than both, both again draw exactly as many as before, and the number stays under the limit'), callsG < calls0 && callsU < calls0 && callsA === calls0 && calls0 <= 1800, { both: calls0, ground: callsG, upper: callsU, bothAgain: callsA, limit: 1800 });
  // Save image hands over the picture of the floors on show: three PNG files that differ from each other
  const saveSel = '#ps-ui button.tool[data-tool="saveImage"]';
  if (await rectOf(saveSel)) {
    await ev(`(() => { window.__pngF = []; if (!window.__pngHook) { window.__pngHook = true; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__pngF.push(b); return orig(b); }; } })()`);
    try { await send('Browser.setDownloadBehavior', { behavior: 'deny' }); } catch {}
    const saved = {};
    for (const [name, key] of [['both', 'all'], ['ground', '0'], ['upper', '1']]) {
      if (String(await ev('window.__floors.get()')) !== key) await tapFloor(key); // a tap on the button that is pressed already draws nothing, and the wait for a frame would run to its limit
      await ev('window.__pngF.length = 0'); await tapAt(saveSel);
      await waitFor('window.__pngF.length > 0', 30);
      saved[name] = await ev(`(async () => { const b = window.__pngF[0]; if (!b) return null; const u = new Uint8Array(await b.slice(0, 8).arrayBuffer()); return { png: [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ').startsWith('89 50 4e 47'), size: b.size }; })()`);
    }
    const sizes = Object.values(saved).map((x) => x?.size);
    record(label('Save image: the picture of the floors on show is handed over, a PNG for Both, for the ground floor and for the upper floor, all three different'), Object.values(saved).every((x) => x?.png && x.size > 5000) && new Set(sizes).size === 3, { saved });
    await tapFloor('all');
  }
  await tapFloor('1');

  // the open shell with only the upper floor on show: its walls lie flat on the board that came up, and everything stays in the picture
  const shellSel = '#ps-ui button.tool[data-tool="shell"]';
  if ((await ev('typeof window.__shell')) === 'object' && (await rectOf(shellSel))) {
    const fsh = await frames();
    await tapAt(shellSel);
    const opened = await waitFor('window.__shell.mode === "open"', 240); // the shell moves a little with every frame, so a slow software renderer takes minutes
    await redrawn(fsh); await sleep(400);
    const picO = await picture(`${tag}-floor-4-upper-shell-open`), fitO = await floorFit(), litO = await ev('window.__shell.patchesLit()');
    const board = JSON.parse(await ev('JSON.stringify(window.__stats.board)')), open = JSON.parse(await ev('JSON.stringify(window.__shell.extent())'));
    const holds = board.minX <= open.minX + 1e-6 && board.maxX >= open.maxX - 1e-6 && board.minZ <= open.minZ + 1e-6 && board.maxZ >= open.maxZ - 1e-6;
    const floorO = (await floorNow()).floor;
    record(label('Upper floor with the shell open: the walls lie flat, the board holds them, no window light lies on the floor, the picture changes and everything stays above the controls'), opened && picO !== picU && fitO?.inside !== false && holds && litO === 0 && floorO === 1, { opened, floor: floorO, fit: fitO, boardHoldsOpenExtent: holds, pictureChanged: picO !== picU, windowLightOn: litO });
    await tapFloor('0'); await sleep(300);
    const picO0 = await picture(`${tag}-floor-5-ground-shell-open`), fitO0 = await floorFit(), litG = await ev('window.__shell.patchesLit()');
    record(label('switching to the ground floor while the shell is open: the walls of the floor on show stay flat, no window light lies on the floor, the picture changes, nothing leaves the picture'), picO0 !== picO && fitO0?.inside !== false && litG === 0 && (await ev('window.__shell.mode')) === 'open' && (await floorNow()).floor === 0, { fit: fitO0, pictureChanged: picO0 !== picO, windowLightOn: litG });
    // turning the view across a side of the house settles the pieces again, and that must not bring the window light back under the walls that lie flat
    const az0 = await ev('window.__camera.azimuth'), pol0 = await ev('window.__camera.polar'), fcam = await frames();
    await ev(`window.__camera.set(${az0 + 100}, ${pol0})`); await redrawn(fcam); await sleep(300);
    const litT = await ev('window.__shell.patchesLit()'), modeT = await ev('window.__shell.mode');
    record(label('turning the view while the shell is open keeps the window light off the floor and the shell open'), litT === 0 && modeT === 'open', { windowLightOn: litT, mode: modeT });
    await ev(`window.__camera.set(${az0}, ${pol0})`); await sleep(200);
    const fsc = await frames(); await tapAt(shellSel); const closed = await waitFor('window.__shell.mode === "closed"', 240); await redrawn(fsc); await sleep(300);
    // the ground floor is on show again (the tap on it above), so the light that comes back is the one the ground floor had before the shell moved
    const relit = await waitFor(`window.__shell.patchesLit() === ${litGround}`, 30), litC = await ev('window.__shell.patchesLit()');
    record(label('closing the shell brings the window light of the floor on show back, as many panes as before it opened'), closed && litGround > 0 && relit, { windowLightBefore: litGround, windowLightOpen: litG, windowLightClosed: litC, closed });
  }

  await tapFloor('all');
  const a = await floorNow(), picA = await picture(`${tag}-floor-6-both-again`), back = nearPictures(picA, pic0);
  record(label('Both brings the first picture back (to within 3 levels of 255 of screen noise), with the camera where it was and floor= out of the address'),
    a.floor === 'all' && a.visible.join() === '0,1' && a.lift === 0 && noFloor(a.hash) && a.pressed === 'false,false,true' && back.same && Math.abs(a.az - s0.az) < 1e-6 && Math.abs(a.pol - s0.pol) < 1e-6 && Math.abs(a.dist - s0.dist) < 1e-6 * Math.max(1, s0.dist) && !a.fail,
    { state: a, first: { az: s0.az, pol: s0.pol, dist: s0.dist }, samePicture: back });


  // another language: the buttons are translated (Polish: Parter, Piętro, Oba), the pressed one stays
  const lang0 = await ev('document.documentElement.lang');
  if (lang0 !== 'pl') { await tapAt('#ps-ui button.lang'); await sleep(500); }
  const pl = await floorBtns(), picPl = await picture(`${tag}-floor-7-polish`);
  record(label('in Polish the buttons read Parter, Piętro and Oba and the pressed one stays'), pl.map((b) => b.text).join() === 'Parter,Piętro,Oba' && pl[2].pressed === 'true' && pl.every((b) => !/[–—]/.test(b.text + b.label)), { buttons: pl.map((b) => b.text), labels: pl.map((b) => b.label), pictureBytes: picPl.length });
  if (lang0 !== 'pl') { await tapAt('#ps-ui button.lang'); await sleep(400); }

  // a plan of another size: the floor row goes with a one-level plan, and a new plan starts with all its floors on show
  if (await rectOf('#ps-ui button[data-plan="flat-1"]')) {
    await tapFloor('1');
    let fp = await frames(); await tapAt('#ps-ui button[data-plan="flat-1"]'); await redrawn(fp);
    const flat = JSON.parse(await ev(`JSON.stringify({ levels: window.__planInfo().levels, count: window.__floors.count, floor: window.__floors.get(), rows: [...document.querySelectorAll('#ps-ui button.floor')].filter((b) => b.getBoundingClientRect().width > 0).length, hash: location.hash })`));
    fp = await frames(); await tapAt('#ps-ui button[data-plan="duplex-1"]'); await redrawn(fp);
    const back = await floorNow(), rows = (await floorBtns()).filter((b) => b.w > 0).length;
    record(label('a plan with one floor has no floor buttons, and a plan picked again starts with all floors on show and floor= out of the address'), flat.levels === 1 && flat.count === 1 && flat.floor === 'all' && flat.rows === 0 && noFloor(flat.hash) && back.floor === 'all' && back.visible.join() === '0,1' && back.lift === 0 && noFloor(back.hash) && rows === 3 && back.pressed === 'false,false,true' && !back.fail, { flat, back, rows });
  }
}

// The editor with a floor hidden (--edit on a plan with two or more levels): a tap selects only on the floor on show, a change of floors clears the selection that belongs to
// the floor that goes, a piece of the floor that is hidden cannot be hit, and Add puts the new piece on the floor on show.
async function floorsEditBlock() {
  const label = (s) => `floors edit: ${s}`;
  if ((await ev('typeof window.__floors')) !== 'object' || (await ev('window.__floors.count')) < 2 || (await ev('typeof window.__edit')) !== 'object') return;
  if ((await ev('window.__floors.get()')) !== 'all') await tapFloor('all');
  const ids = await ev('window.__edit.session.state.layout.levels.map((l) => l.id)'), area = await pictureArea();
  const inside = (pt) => pt && pt.x > 8 && pt.x < W - 8 && pt.y > 8 && pt.y < area.top;
  const selected = () => ev('window.__edit.selectedId()'), levelOf = (pid) => ev(`window.__edit.session.levelOf(${JSON.stringify(pid)})`);
  const layoutJson = () => ev('JSON.stringify(window.__edit.session.state.layout)');
  const layout0 = await layoutJson();
  // a floor piece of one level that a tap can reach on the picture now (nothing selected, so no sheet covers the picture)
  const reach = async (levelIndex) => {
    await ev('window.__edit.session.select(null)'); await sleep(300);
    const cands = await ev(`(() => { const lv = window.__edit.session.state.layout.levels[${levelIndex}]; return lv.pieces.filter((p) => !p.on && p.elev === 0 && p.size[2] > 0.3).map((p) => ({ id: p.id, area: p.size[0] * p.size[1] })).sort((a, b) => b.area - a.area).slice(0, 14); })()`);
    for (const c of cands) {
      const pt = await ev(`window.__edit.screenOf(${JSON.stringify(c.id)})`);
      if (inside(pt) && (await ev(`window.__edit.hit(${pt.x}, ${pt.y}, 'mouse')`)) === c.id) return { id: c.id, pt };
    }
    return null;
  };
  const upper = await reach(1);
  if (!upper) { record(label('a piece of the upper floor can be reached by a tap'), false, { error: 'none found' }); return; }
  let f = await frames(); await tap(upper.pt.x, upper.pt.y); await redrawn(f); await sleep(300);
  const sel1 = await selected(), picSel = await picture('floor-edit-1-upper-selected');
  record(label('with both floors on show a tap selects a piece of the upper floor'), sel1 === upper.id && (await levelOf(upper.id)) === ids[1], { piece: upper.id, selected: sel1 });

  await tapFloor('0'); await sleep(300);
  const sel2 = await selected(), picG = await picture('floor-edit-2-ground-only');
  const hiddenPt = await ev(`window.__edit.screenOf(${JSON.stringify(upper.id)})`), hitHidden = hiddenPt ? await ev(`window.__edit.hit(${hiddenPt.x}, ${hiddenPt.y}, 'mouse')`) : null;
  record(label('the ground floor alone: the selection of the upper floor is gone, the picture changes, and a piece of the hidden floor cannot be hit'), sel2 === null && picG !== picSel && hitHidden !== upper.id && (await ev('window.__floors.get()')) === 0, { selectedNow: sel2, hitWhereTheHiddenPieceWas: hitHidden, pictureChanged: picG !== picSel });

  const ground = await reach(0);
  if (ground) {
    f = await frames(); await tap(ground.pt.x, ground.pt.y); await redrawn(f); await sleep(300);
    const sel3 = await selected();
    record(label('on the ground floor alone a tap selects a piece of the ground floor'), sel3 === ground.id && (await levelOf(ground.id)) === ids[0], { piece: ground.id, selected: sel3 });
    const added = JSON.parse(await ev(`JSON.stringify((() => { const r = window.__edit.session.add('armchair'); return { ok: r.ok, id: r.id ?? null, reason: r.reason ?? null, level: r.ok ? window.__edit.session.levelOf(r.id) : null }; })())`));
    await sleep(300);
    record(label('Add puts the new piece on the floor on show (ground)'), added.ok && added.level === ids[0], { added });
    await ev('window.__edit.session.undo()'); await sleep(200);
  } else record(label('on the ground floor alone a tap selects a piece of the ground floor'), false, { error: 'no piece of the ground floor could be reached' });

  await tapFloor('1'); await sleep(300);
  const sel4 = await selected();
  const picU = await picture('floor-edit-3-upper-only');
  const upper2 = await reach(1);
  if (upper2) {
    f = await frames(); await tap(upper2.pt.x, upper2.pt.y); await redrawn(f); await sleep(300);
    const sel5 = await selected(), picSel2 = await picture('floor-edit-4-upper-selected-alone');
    const added = JSON.parse(await ev(`JSON.stringify((() => { const r = window.__edit.session.add('armchair'); return { ok: r.ok, id: r.id ?? null, reason: r.reason ?? null, level: r.ok ? window.__edit.session.levelOf(r.id) : null }; })())`));
    await sleep(300);
    record(label('the upper floor alone: the ground selection was cleared by the change, a tap selects an upper piece, and Add puts the new piece on the upper floor'), sel4 === null && sel5 === upper2.id && added.ok && added.level === ids[1] && picSel2 !== picU, { clearedByTheChange: sel4 === null, selected: sel5, added });
    await ev('window.__edit.session.undo()'); await sleep(200);
  } else record(label('the upper floor alone: a tap selects an upper piece'), false, { error: 'no piece of the upper floor could be reached' });

  // a room picked on a floor goes when that floor goes
  await tapFloor('all'); await sleep(300);
  const planFile = JSON.parse(readFileSync(new URL('../examples/duplex-1.plan.json', import.meta.url), 'utf8')), roomUp = planFile.levels[1]?.rooms?.[0]?.id;
  if (roomUp) {
    await ev(`window.__edit.session.selectRoom(${JSON.stringify(ids[1])}, ${JSON.stringify(roomUp)})`); await sleep(300);
    const rs1 = await ev('window.__edit.selectedRoomId()');
    await tapFloor('0'); await sleep(300);
    const rs2 = await ev('window.__edit.selectedRoomId()');
    record(label('a room picked on a floor is no longer selected when that floor goes'), rs1 === roomUp && rs2 === null, { before: rs1, after: rs2 });
    await tapFloor('all'); await sleep(300);
  }
  await ev('window.__edit.session.select(null)');
  const layout1 = await layoutJson();
  record(label('Both brings every piece back and the layout is the one it was'), layout1 === layout0 && (await ev('window.__floors.get()')) === 'all' && (await ev('window.__edit.count()')) === JSON.parse(layout0).levels.reduce((n, l) => n + l.pieces.length, 0), { layoutBack: layout1 === layout0 });
}

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
  const a0 = await turnAz(), f4 = await frames(), picBefore = pic, turnT0 = Date.now();
  await drag(x0, y, Math.min(W - 10, x0 + dragPx), y, 150);
  await waitFor('window.__camera && window.__camera.busy === false', 60);
  const r5 = await redrawn(f4);
  const a1 = await turnAz(), near1 = await ev('window.__camera.near');
  const hintGone = await ev('!document.querySelector("#ps-hint")');
  const msgNow = await ev(`document.querySelector('#ps-ui-msg')?.textContent ?? ''`); // the one-line message above the bar: the touch hint is there right after the first turn
  const pic5 = await picture('5-turned');
  const turned = Math.abs(wrap(a1 - a0));
  record('turn the model', a0 >= 0 && turned > 45 && turned < 140 && pic5 !== picBefore && r5.ok !== false && hintGone, { azimuth: `${a0.toFixed(0)} -> ${a1.toFixed(0)}`, turned: Math.round(turned), nearEdges: near1, hintGone, redrawnFrames: r5.counts ? `${f4} -> ${await frames()}` : 'not reported', pictureChanged: pic5 !== picBefore });
  pic = pic5;

  // the first one-finger turn on a touch screen says how to zoom and move, in one line that fits the screen and goes away by itself after about 6 seconds; with the mouse nothing is said
  if (!opt.desktop) {
    const fits = await ev(`(() => { const m = document.querySelector('#ps-ui-msg'); return !!m && m.scrollWidth <= m.clientWidth + 1; })()`);
    const goneAfter = await waitFor(`!document.querySelector('#ps-ui-msg').textContent`, 14, 150), goneMs = Date.now() - turnT0;
    const other = await ev(`(() => { const m = document.querySelector('#ps-ui-msg'), old = m.textContent, lang = document.documentElement.lang; m.textContent = lang === 'pl' ? '1 finger: turn, 2 fingers: zoom and move, double tap: back' : '1 palec: obrót, 2 palce: zoom i ruch, 2 dotknięcia: wróć'; const ok = m.scrollWidth <= m.clientWidth + 1; m.textContent = old; return ok; })()`);
    record('touch hint: the first turn shows one line (zoom, move, double tap), it fits, it goes away after about 6 s', /palec|finger/.test(msgNow) && /zoom/.test(msgNow) && fits && other && goneAfter && goneMs > 5000 && goneMs < 11000, { line: msgNow, fitsOnOneLine: fits, otherLanguageFits: other, goneAfterMs: goneMs });
    const f4b = await frames(); await drag(x0, y, Math.min(W - 10, x0 + Math.round(dragPx / 2)), y, 150); await waitFor('window.__camera && window.__camera.busy === false', 60); await redrawn(f4b);
    record('touch hint: shown once per page load (a second turn says nothing)', (await ev(`document.querySelector('#ps-ui-msg')?.textContent ?? ''`)) === '', {});
    pic = await picture('5b-turned-again');
  } else record('no touch hint with the mouse', msgNow === '', { line: msgNow });

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
  if (opt.edit && !opt.floors) {
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

    // the camera in the editor: gestures of several fingers, the right button and Shift start on a piece and touch no piece
    await editCameraBlock(id);

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

    // 10f. editing with the shell open: the outer walls lie flat and everything the editor does still works, the pieces that hang on the outer walls included.
    // A floor piece and a wall piece each go through select (the outline is on the piece), drag, turn, undo, redo, colour, size, delete and undo; Escape
    // clears the selection first and folds the shell second; after the shell closes the layout and the picture are exactly what they were. The edit bar and the panel
    // are used by touch or mouse like above; the page reports where things are drawn (window.__edit: screenOf, outlineGap, own, hostOf, alongWall).
    {
      const shellSel = '#ps-ui button.tool[data-tool="shell"]';
      const shellNow = async () => JSON.parse(await ev(`JSON.stringify(window.__shell ? { mode: window.__shell.mode, clock: window.__shell.clock, target: window.__shell.target, deg: window.__shell.state().map((w) => Math.round(w.deg)) } : null)`));
      const gapOf = (pid) => ev(`window.__edit.outlineGap(${JSON.stringify(pid)})`);
      const ownOf = (pid) => ev(`window.__edit.own(${JSON.stringify(pid)})`);
      const hostOf = async (pid) => JSON.parse(await ev(`JSON.stringify(window.__edit.hostOf(${JSON.stringify(pid)}))`));
      const infoOf = (pid) => ev(`(() => { const p = window.__edit.session.pieceById(${JSON.stringify(pid)}); return p ? { x: p.x, y: p.y, rot: p.rot, elev: p.elev, size: p.size, colors: p.colors } : null; })()`);
      const isOpen = async () => { const s = await shellNow(); return !!s && s.mode === 'open' && s.deg.length > 0 && s.deg.every((d) => Math.abs(d - 90) <= 1); };
      // On a phone the details of the selected piece stay unfolded after an earlier step opened them, and the open sheet covers the model: fold them (a tap on the header)
      // so that the piece can be tapped and dragged again.
      const foldSheet = async () => {
        if (W > 760) return;
        const r = await ev(`(() => { const h = [...document.querySelectorAll('.psp-sel-head')].find((x) => x.offsetParent !== null && x.getAttribute('aria-expanded') === 'true'); if (!h) return null; const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
        if (r) { await tap(r.x, r.y); await sleep(450); }
      };
      // a real tap on the piece where it is drawn now; the sheet of a selected piece must not cover it (looked at first, as in the select step above)
      const tapPiece = async (pid) => {
        const pt = await ev(`window.__edit.screenOf(${JSON.stringify(pid)})`);
        if (!inside(pt)) return null;
        await ev(`window.__edit.session.select(${JSON.stringify(pid)})`); await sleep(350); await foldSheet();
        const pt2 = await ev(`window.__edit.screenOf(${JSON.stringify(pid)})`), top = pt2 ? await ev(`document.elementFromPoint(${pt2.x}, ${pt2.y})?.tagName ?? null`) : null;
        await ev('window.__edit.session.select(null)'); await sleep(350);
        if (top !== 'CANVAS' || !inside(pt2)) return null;
        await tap(pt2.x, pt2.y); await sleep(350);
        return (await selected()) === pid ? pt2 : null;
      };
      const unfoldSheet = async () => {
        const r = await ev(`(() => { const h = [...document.querySelectorAll('.psp-sel-head')].find((x) => x.offsetParent !== null && x.getAttribute('aria-expanded') === 'false'); if (!h) return null; h.scrollIntoView({ block: 'center' }); const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
        if (r) { await tap(r.x, r.y); await sleep(450); }
      };
      const tapIn = async (sel) => { const r = await rectOf(sel); if (!r || r.w < 1 || r.h < 1) return false; await tap(r.x + r.w / 2, r.y + r.h / 2); return true; };
      // the 3D picture alone: the bars, the sheet and the hints are hidden for the capture, so equal bytes mean an equal scene and a difference means the scene changed
      const scenePicture = async (label) => {
        await ev(`(() => { const s = document.createElement('style'); s.id = 'ps-hide-bars'; s.textContent = '#ps-ui,#ps-edit,.psp-sheet,.psp-toggle,#ps-hint,#ps-edit-msg,#ps-ui-msg{visibility:hidden !important}'; document.head.appendChild(s); })()`); await sleep(200);
        const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
        await ev(`document.getElementById('ps-hide-bars')?.remove()`);
        if (out) writeFileSync(join(out, `${label}.png`), Buffer.from(shot.data, 'base64'));
        return shot.data;
      };
      await ev('window.__edit.session.select(null)'); await sleep(300);
      const layout0 = await layoutJson(), count0 = await count(), picClosed0 = await scenePicture('50-open-edit-closed');

      // 1. the button opens the shell while editing
      const btnLook = JSON.parse(await ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(shellSel)}); return b ? { disabled: b.getAttribute('aria-disabled'), title: b.title } : null; })())`));
      let f10 = await frames();
      await tapIn(shellSel);
      const openedOk = await waitFor('window.__shell && window.__shell.mode === "open"', 25);
      await redrawn(f10); await sleep(500);
      const picOpen = await scenePicture('51-open-edit-open'), openMsg = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`);
      record('edit with the shell open: the shell button opens the shell, every wall lies flat, nothing is dimmed and no message appears', openedOk && (await isOpen()) && !!btnLook && btnLook.disabled !== 'true' && !/Finish editing|Zakończ edycję/.test(`${btnLook.title}${openMsg}`) && picOpen !== picClosed0, { shell: await shellNow(), button: btnLook, message: openMsg, pictureChanged: picOpen !== picClosed0 });

      // 2. the pieces: one on the floor (the largest that can be tapped), one that hangs on an outer wall (a wall that has turned now holds it)
      const floorCands = JSON.parse(await ev(`JSON.stringify((() => { const out = []; for (const lv of window.__edit.session.state.layout.levels) for (const p of lv.pieces) if (!p.on && p.elev === 0 && p.size[2] > 0.3 && !window.__edit.hostOf(p.id)) out.push({ id: p.id, type: p.type, area: p.size[0] * p.size[1] }); return out.sort((a, b) => b.area - a.area).slice(0, 14); })())`));
      const wallCands = JSON.parse(await ev(`JSON.stringify((() => { const rank = { curtain: 0, mirror: 1, 'art-large': 2, 'shelf-wall': 3, 'art-small': 4 }; const out = []; for (const lv of window.__edit.session.state.layout.levels) for (const p of lv.pieces) if (window.__edit.hostOf(p.id)) out.push({ id: p.id, type: p.type, wall: window.__edit.hostOf(p.id).wall, rank: rank[p.type] ?? 9 }); return out.sort((a, b) => a.rank - b.rank).slice(0, 30); })())`));
      let floor = null, wall = null;
      for (const c of floorCands) { const pt = await tapPiece(c.id); if (pt) { floor = { ...c, pt }; break; } }
      if (floor) await ev('window.__edit.session.select(null)');
      for (const c of wallCands) { const pt = await tapPiece(c.id); if (pt) { wall = { ...c, pt }; await ev('window.__edit.session.select(null)'); break; } }
      await sleep(300);
      record('edit with the shell open: there is a floor piece and a wall piece that a real tap selects', !!floor && !!wall, { floor: floor && `${floor.id} ${floor.type}`, wall: wall && `${wall.id} ${wall.type} on ${wall.wall}`, wallCandidates: wallCands.length, floorCandidates: floorCands.length });

      // The same steps for each piece. `end` gives the point the finger goes to from the piece: the floor piece 80 px over the floor, the wall piece along its wall.
      const pass = async (kind, c) => {
        const id = c.id, N = (s) => `edit with the shell open, ${kind} piece: ${s}`, layoutStart = await layoutJson();
        // select: the tap puts the outline on the piece
        let fq = await frames(), picBefore = await scenePicture(`52-${kind}-before`);
        await tap(c.pt.x, c.pt.y); await sleep(400); await redrawn(fq);
        const picSel = await scenePicture(`53-${kind}-selected`), gapSel = await gapOf(id);
        // A tap only selects. The selection opens the sheet of the panel over the picture, perhaps under the finger (on a phone the details of the sheet stay unfolded from the pass before), and
        // the browser sends the click of a touch tap to whatever is under the finger when it lifts: a colour swatch there would recolour the piece. The layout must be what it was.
        const layoutSel = await layoutJson();
        record(N('a tap selects it, changes nothing, and the outline is within 4 px of the piece as drawn'), (await selected()) === id && layoutSel === layoutStart && gapSel !== null && gapSel <= 4 && picSel !== picBefore, { piece: `${id} ${c.type}`, layoutSame: layoutSel === layoutStart, outlineGapPx: gapSel, pictureChanged: picSel !== picBefore });
        if ((await selected()) !== id) return;
        await foldSheet(); // a phone: the sheet must not cover the piece when the finger goes down on it again

        // drag: the piece moves (the floor piece over the floor, the wall piece along its wall), stays drawn as an object of its own while it moves, and the outline follows
        const attempt = async (d) => {
          const p0 = await infoOf(id), s0 = await ev(`window.__edit.screenOf(${JSON.stringify(id)})`), h0 = await hostOf(id);
          const e1 = kind === 'floor' ? { x: Math.min(W - 12, s0.x + 80), y: Math.min(area - 6, s0.y + 30) } : await ev(`window.__edit.alongWall(${JSON.stringify(id)}, ${d})`);
          let mid = null;
          fq = await frames();
          await drag(s0.x, s0.y, e1.x, e1.y, 0, async () => { mid = { own: await ownOf(id), gap: await gapOf(id), picture: await scenePicture(`54-${kind}-mid-drag`) }; });
          await sleep(350); await redrawn(fq);
          const p1 = await infoOf(id), h1 = await hostOf(id), s1 = await ev(`window.__edit.screenOf(${JSON.stringify(id)})`);
          return { p0, p1, h0, h1, s1, e1, mid, d };
        };
        const layoutBeforeMove = await layoutJson();
        let a = await attempt(0.8);
        if (kind === 'wall' && Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y) < 0.4) { // the wall ends there: go the other way (a drag that changed nothing left no undo step)
          if ((await layoutJson()) !== layoutBeforeMove) { await click('undo'); await sleep(350); }
          a = await attempt(-0.8);
        }
        const moved = Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y), picDrag = await scenePicture(`55-${kind}-dragged`), gapDrag = await gapOf(id);
        const ang = ((a.p0.rot ?? 0) * Math.PI) / 180, across = Math.abs(-(a.p1.x - a.p0.x) * Math.sin(ang) + (a.p1.y - a.p0.y) * Math.cos(ang)); // the part of the move across the width axis of the piece (along its front)
        const okMove = kind === 'floor' ? moved > 0.1 : moved > 0.3 && moved < 1.4 && across < 0.08 && !!a.h0 && !!a.h1 && a.h0.wall === a.h1.wall && Math.abs(a.p1.elev - a.p0.elev) < 1e-9 && a.p1.rot === a.p0.rot;
        record(N('a drag moves it (a wall piece along its wall), it stays drawn while it moves and the outline stays on it'), okMove && a.mid?.own === true && a.mid.gap !== null && a.mid.gap <= 4 && gapDrag !== null && gapDrag <= 4 && picDrag !== picSel && (await selected()) === id && (await shellNow()).mode === 'open',
          { moved: `${moved.toFixed(2)} m`, acrossWall: +across.toFixed(3), from: `${a.p0.x.toFixed(2)},${a.p0.y.toFixed(2)}`, to: `${a.p1.x.toFixed(2)},${a.p1.y.toFixed(2)}`, wall: a.h1?.wall ?? null, ownInMiddle: a.mid?.own, outlineGapMiddlePx: a.mid?.gap, outlineGapAfterPx: gapDrag, endsAt: { fingerEnd: [Math.round(a.e1.x), Math.round(a.e1.y)], pieceNow: [Math.round(a.s1.x), Math.round(a.s1.y)] }, pictureChanged: picDrag !== picSel });

        // turn, undo, redo
        const r0 = await infoOf(id); fq = await frames();
        await click('turn'); await sleep(350); await redrawn(fq);
        const r1 = await infoOf(id), gapTurn = await gapOf(id), picTurn = await scenePicture(`56-${kind}-turned`);
        await click('undo'); await sleep(350);
        const r2 = await infoOf(id);
        await click('redo'); await sleep(350);
        const r3 = await infoOf(id), gapRedo = await gapOf(id);
        const dRot = (((r1.rot - r0.rot) % 360) + 360) % 360;
        record(N('turn, undo and redo work and the outline stays on the piece'), Math.abs(dRot - 90) < 1 && r2.rot === r0.rot && r3.rot === r1.rot && gapTurn !== null && gapTurn <= 4 && gapRedo !== null && gapRedo <= 4 && picTurn !== picDrag, { rot: `${r0.rot} -> ${r1.rot}, undo ${r2.rot}, redo ${r3.rot}`, outlineGapPx: [gapTurn, gapRedo], pictureChanged: picTurn !== picDrag });
        await click('undo'); await sleep(300);

        // colour through the panel: a swatch recolours a slot (undo and redo)
        await unfoldSheet();
        const sw = await ev(`(() => { const b = [...document.querySelectorAll('.psp-sw')].find((x) => x.getAttribute('aria-pressed') !== 'true' && x.offsetParent !== null); return b ? { slot: b.dataset.slot, color: b.dataset.color } : null; })()`);
        const picPre = await scenePicture(`57-${kind}-before-colour`), col0 = (await infoOf(id)).colors ?? {};
        let colOk = false, picCol = picPre, col1 = null;
        if (sw) {
          const q = `.psp-sw[data-slot="${sw.slot}"][data-color="${sw.color}"]`;
          await ev(`document.querySelector(${JSON.stringify(q)})?.scrollIntoView({ block: 'center' })`); await sleep(250);
          fq = await frames(); await tapIn(q); await sleep(600); await redrawn(fq);
          col1 = (await infoOf(id)).colors ?? {}; picCol = await scenePicture(`58-${kind}-coloured`);
          await undoApi(); await sleep(250); const col2 = (await infoOf(id)).colors ?? {};
          await redoApi(); await sleep(250); const col3 = (await infoOf(id)).colors ?? {};
          colOk = String(col1[sw.slot] ?? '').toLowerCase() === String(sw.color).toLowerCase() && JSON.stringify(col2) === JSON.stringify(col0) && JSON.stringify(col3) === JSON.stringify(col1);
        }
        const gapCol = await gapOf(id);
        record(N('a colour swatch recolours it and the picture changes (undo and redo)'), colOk && picCol !== picPre && gapCol !== null && gapCol <= 4 && (await selected()) === id, { swatch: sw, outlineGapPx: gapCol, pictureChanged: picCol !== picPre });
        await undoApi(); await sleep(300);

        // size through the panel, where the piece has a range (undo and redo)
        await unfoldSheet();
        const field = await ev(`(() => { const i = document.querySelector('.psp-num'); return i && i.offsetParent !== null ? { axis: i.dataset.axis, min: Number(i.min), max: Number(i.max), value: Number(i.value) } : null; })()`);
        if (field) {
          const idx = { w: 0, d: 1, h: 2 }[field.axis], span = field.max - field.min, want = Math.round(field.value + (field.max - field.value >= field.value - field.min ? 1 : -1) * Math.max(2, span / 4));
          const sizeNow = async () => (await infoOf(id)).size[idx];
          const s0 = await sizeNow();
          await ev(`(() => { const i = document.querySelector('.psp-num[data-axis="${field.axis}"]'); i.scrollIntoView({ block: 'center' }); i.value = '${want}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(600);
          const s1 = await sizeNow(), gapSize = await gapOf(id); await undoApi(); await sleep(250); const s2 = await sizeNow(); await redoApi(); await sleep(250); const s3 = await sizeNow();
          record(N('a size field changes the size within its range and the outline follows (undo and redo)'), Math.abs(s1 * 100 - want) < 1.01 && Math.abs(s2 - s0) < 1e-9 && Math.abs(s3 - s1) < 1e-9 && gapSize !== null && gapSize <= 4, { axis: field.axis, range: `${field.min}..${field.max} cm`, typed: want, kept: +(s1 * 100).toFixed(1), undo: +(s2 * 100).toFixed(1), redo: +(s3 * 100).toFixed(1), outlineGapPx: gapSize });
          await undoApi(); await sleep(300);
        } else record(N('a size field changes the size within its range and the outline follows (undo and redo)'), true, { note: `${c.type} has no size range` });

        // delete and undo
        const n0 = await count(); fq = await frames();
        await click('remove'); await sleep(400); await redrawn(fq);
        const n1 = await count(), selAfter = await selected(), hostGone = await hostOf(id), picDel = await scenePicture(`59-${kind}-deleted`), outlineHidden = await gapOf(id);
        await click('undo'); await sleep(450);
        const n2 = await count(), hostBack = await hostOf(id);
        record(N('delete removes it and clears the outline, undo brings it back where it was'), n1 < n0 && selAfter === null && hostGone === null && outlineHidden === null && n2 === n0 && (kind === 'floor' || !!hostBack) && picDel !== picTurn, { count: `${n0} -> ${n1} -> ${n2}`, selectedAfter: selAfter, wallAfterUndo: hostBack?.wall ?? null, pictureChanged: picDel !== picTurn });
        // the move at the start of the pass is the only change left: one undo brings the layout back to what it was before the pass
        await click('undo'); await sleep(450);
        record(N('undoing the move leaves the layout exactly as it was before the pass'), (await layoutJson()) === layoutStart, { count: await count() });
        await ev('window.__edit.session.select(null)'); await sleep(300);
      };
      if (floor) await pass('floor', floor); else record('edit with the shell open, floor piece: select, drag, turn, colour, size, delete', false, { error: 'no floor piece could be tapped' });
      if (wall) await pass('wall', wall); else record('edit with the shell open, wall piece: select, drag, turn, colour, size, delete', false, { error: 'no piece hanging on an outer wall could be tapped (the shell is open)' });

      // 2b. a wall piece stays outlined while the walls move: with it selected, Space folds the shell and Space opens it again; the outline is on the piece in every sample
      if (wall) {
        await ev(`window.__edit.session.select(${JSON.stringify(wall.id)})`); await sleep(400);
        const follow = async (want) => {
          await ev('document.activeElement?.blur?.()');
          await key(' ', 'Space', 32, 0, ' ');
          const gaps = [], clocks = [], end = Date.now() + 12000;
          while (Date.now() < end) {
            const s = await shellNow(), g = await gapOf(wall.id);
            clocks.push(s.clock); if (g !== null) gaps.push(g);
            if (s.mode === want) break;
            await sleep(60);
          }
          await sleep(300);
          return { gaps, clocks, final: await shellNow() };
        };
        const closing = await follow('closed'), opening = await follow('open');
        const midOf = (r) => r.clocks.filter((c) => c > 0.05 && c < 0.95).length, worst = Math.max(...closing.gaps, ...opening.gaps);
        record('edit with the shell open: the outline of a wall piece stays on it while the walls fold and unfold', closing.final.mode === 'closed' && opening.final.mode === 'open' && midOf(closing) >= 3 && midOf(opening) >= 3 && worst <= 4 && (await selected()) === wall.id, { samples: [closing.gaps.length, opening.gaps.length], samplesWhileMoving: [midOf(closing), midOf(opening)], worstGapPx: worst });
        await ev('window.__edit.session.select(null)'); await sleep(300);
      }

      // 3. Escape: the first press clears the selection and leaves the shell open, the next one folds the shell
      const escId = (floor ?? wall)?.id;
      if (escId) {
        await ev(`window.__edit.session.select(${JSON.stringify(escId)})`); await sleep(400);
        const sel0 = await selected(), openBefore = await isOpen();
        await key('Escape', 'Escape', 27); await sleep(700);
        const sel1 = await selected(), mid1 = await shellNow(); await sleep(1200); const mid2 = await shellNow();
        record('edit with the shell open: the first Escape clears the selection and leaves the shell open', sel0 === escId && openBefore && sel1 === null && mid1.target === 1 && mid1.mode === 'open' && mid2.mode === 'open' && mid2.clock === 1, { selectedBefore: sel0, selectedAfter: sel1, shellAfterOneEscape: mid1, shellLater: mid2 });
        f10 = await frames();
        await key('Escape', 'Escape', 27);
        const folding = await waitFor('window.__shell.target === 0', 5), closedOk = await waitFor('window.__shell.mode === "closed"', 25);
        await redrawn(f10); await sleep(500);
        const st = await shellNow(), picAfter = await scenePicture('60-open-edit-closed-again');
        record('edit with the shell open: with nothing selected the next Escape folds the shell, the layout is as it was and the picture is the closed picture of before', folding && closedOk && st.deg.every((d) => d === 0) && (await layoutJson()) === layout0 && (await count()) === count0 && picAfter === picClosed0 && (await selected()) === null, { shell: st, layoutSame: (await layoutJson()) === layout0, pictureSameAsBefore: picAfter === picClosed0 });
      }

      // 4. an edit made with the shell open is kept when it closes: the piece is where it was left, the layout does not change, the outline is on the piece
      if (floor) {
        await tapIn(shellSel); await waitFor('window.__shell.mode === "open"', 25); await sleep(600);
        const pt = await ev(`window.__edit.screenOf(${JSON.stringify(floor.id)})`), p0 = await infoOf(floor.id);
        if (pt && inside(pt) && (await tapPiece(floor.id))) {
          const s = await ev(`window.__edit.screenOf(${JSON.stringify(floor.id)})`); f10 = await frames();
          await drag(s.x, s.y, Math.min(W - 12, s.x + 70), Math.min(area - 6, s.y + 25)); await sleep(350); await redrawn(f10);
          const p1 = await infoOf(floor.id), layoutEdited = await layoutJson();
          await tapIn(shellSel); const closed2 = await waitFor('window.__shell.mode === "closed"', 25); await sleep(500);
          const p2 = await infoOf(floor.id), gapClosed = await gapOf(floor.id), picEdited = await scenePicture('61-edited-closed');
          record('edit with the shell open: after the shell closes the moved piece stays where it was left, the layout is unchanged and the outline is on the piece', closed2 && Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.1 && p2.x === p1.x && p2.y === p1.y && (await layoutJson()) === layoutEdited && gapClosed !== null && gapClosed <= 4 && picEdited !== picClosed0, { moved: `${Math.hypot(p1.x - p0.x, p1.y - p0.y).toFixed(2)} m`, outlineGapPx: gapClosed, pictureChanged: picEdited !== picClosed0 });
          await click('undo'); await sleep(400);
          await ev('window.__edit.session.select(null)'); await sleep(500);
          const layoutBack = (await layoutJson()) === layout0, pictureBack = (await scenePicture('62-undone-closed')) === picClosed0;
          record('edit with the shell open: undoing the move brings the first layout and the first picture back exactly', layoutBack && pictureBack, { layoutSame: layoutBack, pictureSameAsBefore: pictureBack });
        } else record('edit with the shell open: after the shell closes the moved piece stays where it was left, the layout is unchanged and the outline is on the piece', false, { error: 'the floor piece could not be tapped again' });
      }
    }
  }

  // 10c. the floors on show (--floors alone, or after the editor steps when the plan has two or more levels)
  if (opt.floors) { if (opt.edit) await floorsEditBlock(); else await floorsBlock('duplex-1'); }
  else if (opt.edit && (await ev('window.__floors ? window.__floors.count : 1')) >= 2) await floorsEditBlock();

  // 10d. the extra buttons (--btn): saving the picture, the frame hook, the Edit button and leaving the editor again
  if (opt.btn && !opt.edit && !opt.floors) {
    const toolInfo = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#ps-ui button.tool')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.dataset.tool ?? 'plan:' + b.dataset.plan, x: r.left, y: r.top, w: r.width, h: r.height, text: b.textContent }; }))`));
    await picture('30-buttons');
    const onScreen = (b) => b.w >= 43.5 && b.h >= 43.5 && b.x >= -1 && b.x + b.w <= W + 1 && b.y >= 0 && b.y + b.h <= H + 1;
    const classic = toolInfo.filter((b) => ['edit', 'saveImage', 'loadPlan'].includes(b.name)), extra = toolInfo.filter((b) => !['edit', 'saveImage', 'loadPlan'].includes(b.name));
    record('buttons: Edit, Save image and Load plan are on screen, at least 44 px', classic.length === 3 && classic.every(onScreen), { buttons: classic.map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)} at ${Math.round(b.x)},${Math.round(b.y)}`) });
    record('buttons: the example plans and the open shell are on screen, at least 44 px', extra.length === 3 && extra.every(onScreen), { buttons: extra.map((b) => `${b.text} ${Math.round(b.w)}x${Math.round(b.h)} at ${Math.round(b.x)},${Math.round(b.y)}`) });

    // the camera steps (pan, pinch, wheel, double tap) on the flat, then on the duplex below
    await cameraBlock('flat-1');
    await liftBlock('flat-1');

    // the example plans: Duplex builds the two-storey plan in place (a second level, another picture, plan=duplex-1 in the address, its button pressed), Flat goes back
    const planNow = async () => JSON.parse(await ev(`JSON.stringify({ levels: window.__planInfo().levels, pieces: window.__planInfo().pieces, pressed: [...document.querySelectorAll('#ps-ui button[data-plan]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.plan), hash: location.hash, fail: window.__fail || null })`));
    const planBefore = await planNow(), picPlanFlat = await picture('35-plan-flat');
    let fpl = await frames();
    await tapAt('#ps-ui button[data-plan="duplex-1"]'); await redrawn(fpl);
    const planDup = await planNow(), picPlanDup = await picture('36-plan-duplex');
    record('example plans: Duplex builds the two-storey plan in place', planBefore.levels === 1 && planBefore.pressed.join() === 'flat-1' && planDup.levels === 2 && planDup.pressed.join() === 'duplex-1' && /plan=duplex-1/.test(planDup.hash) && picPlanDup !== picPlanFlat && !planDup.fail, { before: planBefore, after: planDup, pictureChanged: picPlanDup !== picPlanFlat });
    await cameraBlock('duplex-1');
    await liftBlock('duplex-1');
    await floorsBlock('duplex-1');
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

    // the card board under the model: it hugs the closed model, holds every wall as the shell opens and shrinks back as it folds (asserted from the page)
    {
      const e = JSON.parse(await ev('JSON.stringify(window.__planInfo().extent)')), open = JSON.parse(await ev('JSON.stringify(window.__shell.extent())'));
      const w = e[1] - e[0], d = e[3] - e[2], rim = Math.max(0.35, 0.06 * Math.max(w, d));
      const boardAt = async (p) => { await ev(`window.__shell.seek(${p})`); return JSON.parse(await ev('JSON.stringify(window.__stats.board)')); };
      const holds = (b, x) => b.minX <= x.minX + 1e-6 && b.maxX >= x.maxX - 1e-6 && b.minZ <= x.minZ + 1e-6 && b.maxZ >= x.maxZ - 1e-6;
      const b0 = await boardAt(0), picBoard0 = await picture('38b-board-closed'), bMid = await boardAt(0.4), b1 = await boardAt(1), picBoard1 = await picture('39b-board-open'), b2 = await boardAt(0);
      record('board: hugs the closed model (rim of 6 percent, at least 0.35 m), grows with the open shell, holds every wall, shrinks back',
        b0.width >= w + 2 * rim - 0.04 && b0.width <= w + 2 * rim + 0.7 && b0.depth >= d + 2 * rim - 0.04 && b0.depth <= d + 2 * rim + 0.7 && b0.width < 0.8 * b1.width && b0.depth < 0.9 * b1.depth && b0.width < bMid.width && bMid.width < b1.width && holds(b1, open) && Math.abs(b2.width - b0.width) < 0.01 && Math.abs(b2.depth - b0.depth) < 0.01 && picBoard0 !== picBoard1,
        { closedModel: `${w.toFixed(2)} x ${d.toFixed(2)} m`, rimMetres: +rim.toFixed(2), closedBoard: `${b0.width} x ${b0.depth} m`, halfOpenBoard: `${bMid.width} x ${bMid.depth} m`, openBoard: `${b1.width} x ${b1.depth} m`, backClosedBoard: `${b2.width} x ${b2.depth} m`, holdsOpenExtent: holds(b1, open), pictureChanged: picBoard0 !== picBoard1 });
    }

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

    // the shell is opened once more and left open on purpose: the Edit button below reloads the page, which starts with the shell closed
    await tapAt(shellSel); await waitFor('window.__shell.mode === "open"', 20); await sleep(300);

    // the Edit button turns the editor on (the page reloads with edit=1) and Done leaves it; unsaved changes need a second tap
    const editSel = '#ps-ui button.tool[data-tool="edit"]';
    await tapAt(editSel);
    const entered = await waitFor('window.__done === true && typeof window.__edit === "object" && !!document.querySelector("#ps-edit")', Number(opt.timeout));
    await sleep(800);
    const label1 = await ev(`document.querySelector(${JSON.stringify(editSel)})?.textContent ?? null`), btn1 = await rectOf(editSel), bar1 = await rectOf('#ps-edit'), ui1 = await rectOf('#ps-ui');
    await picture('33-edit-entered');
    const shellAfter = JSON.parse(await ev(`JSON.stringify(typeof window.__shell === 'object' ? { mode: window.__shell.mode, clock: window.__shell.clock, deg: window.__shell.state().map((w) => Math.round(w.deg)) } : null)`));
    record('Edit button opens the editor and turns into Done', entered && !!bar1 && !!btn1 && btn1.h >= 43.5 && btn1.x >= -1 && btn1.x + btn1.w <= W + 1 && /Done|Zakończ/.test(label1 ?? ''), { label: label1, button: btn1, hash: await ev('location.hash'), uiBar: ui1 });
    record('Edit from the open shell reloads the page, which starts with the shell closed and its API there', entered && !!shellAfter && shellAfter.mode === 'closed' && shellAfter.clock === 0 && shellAfter.deg.every((d) => d === 0), { shell: shellAfter });
    if (entered) {
      // while editing the shell button works as outside the editor: not dimmed, no hint to finish editing, a tap opens the shell and the next tap folds it, with no message
      const shBtn = JSON.parse(await ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(shellSel)}); if (!b) return null; const r = b.getBoundingClientRect(); return { disabled: b.getAttribute('aria-disabled'), title: b.title, shown: r.width > 0 && getComputedStyle(b).display !== 'none', api: typeof window.__shell }; })())`));
      const picE0 = await picture('33b-edit-shell-closed');
      await tapAt(shellSel);
      const openedEdit = await waitFor('window.__shell.mode === "open"', 25); await sleep(400);
      const degE = JSON.parse(await ev('JSON.stringify(window.__shell.state().map((w) => Math.round(w.deg)))')), picE1 = await picture('33c-edit-shell-open');
      const shMsg = await ev(`document.querySelector('#ps-edit-msg')?.textContent ?? ''`);
      await tapAt(shellSel);
      const closedEdit = await waitFor('window.__shell.mode === "closed"', 25); await sleep(400);
      record('editing: the shell button is active, a tap opens the shell and the next one folds it, and nothing tells the person to finish editing', !!shBtn && shBtn.shown && shBtn.disabled !== 'true' && shBtn.api === 'object' && !/Finish editing|Zakończ edycję/.test(`${shBtn.title}${shMsg}`) && openedEdit && degE.length > 0 && degE.every((d) => Math.abs(d - 90) <= 1) && closedEdit && picE1 !== picE0 && !(await ev('window.__fail')), { button: shBtn, message: shMsg, opened: openedEdit, closed: closedEdit, pictureChanged: picE1 !== picE0 });
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
  if (!opt.floors) {
    let planText = null; // the other example than the one on show: the duplex over the flat, the flat over the duplex (a run started with plan=duplex-1)
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
    planText = readFileSync(new URL(before?.levels === 2 ? '../examples/flat-1.plan.json' : '../examples/duplex-1.plan.json', import.meta.url), 'utf8');
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
    if (!opt.edit && (await ev('typeof window.__shell')) === 'object') { // a plan loaded at run time: the board hugs the closed model of the new plan, and grows with its shell
      const e2 = JSON.parse(await ev('JSON.stringify(window.__planInfo().extent)')), open2 = JSON.parse(await ev('JSON.stringify(window.__shell.extent())')), w2 = e2[1] - e2[0], rim2 = Math.max(0.35, 0.06 * Math.max(w2, e2[3] - e2[2]));
      const bc = JSON.parse(await ev('JSON.stringify(window.__stats.board)')); await ev('window.__shell.seek(1)'); const bo = JSON.parse(await ev('JSON.stringify(window.__stats.board)')); await ev('window.__shell.seek(0)');
      record('Load plan: the board of the new plan hugs its closed model and grows to hold its open shell', bc.width >= w2 + 2 * rim2 - 0.04 && bc.width <= w2 + 2 * rim2 + 0.7 && bc.width < 0.8 * bo.width && bo.minX <= open2.minX + 1e-6 && bo.maxX >= open2.maxX - 1e-6 && bo.minZ <= open2.minZ + 1e-6 && bo.maxZ >= open2.maxZ - 1e-6, { closedBoardWidth: bc.width, openBoardWidth: bo.width, closedModelWidth: round2(w2), rim: round2(rim2) });
    }
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
