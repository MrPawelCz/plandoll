// Walk-through of Spacer (the mode that walks the flat at eye height) in a real browser (headless Chrome, software GL), with real mouse, keyboard and touch events sent through the
// browser's own input pipeline: the click on the Spacer button, W A S D, the arrows, Shift, Space (a jump, a door, Ctrl+Space, Space on the Exit button), 1 to 3, Shift with an arrow, Escape,
// a drag of one finger or of two on a phone. Every step prints ok or FAIL with the numbers it measured.
//   node tools/spacer-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout 900] [--phone] [--only A,B,C] [--steps 4,6]
// Desktop run (1280x720, mouse and keyboard), in scenes that each open the page with live=1 (no intro):
//   A  the flat: 1 the click, 2 the keys (real clock, then a stopped clock and advanceTime for exact distances), 3 walls, a window and a shut door, 4 Space (jump, the door, Ctrl+Space,
//      the Exit button), 5 moods and Shift with an arrow, 6 Escape and everything back as it was, 6b the first jump after a click, 7 the mouse under a simulated pointer lock
//   B  the address: walk=1 opens inside, walk=0 has no button, edit=1 has no button and refuses
//   C  the duplex: the stairs lead up without a jump of the eyes, the floor and plan buttons are out of the way
// --phone runs scene P instead (390x844, touch emulation, Polish): 10 the touch click on the button, the two zones and the hint for about 4 s, the small map clear of the bar and of the
//   version mark, 11 one finger on the left half walks (60 px is full speed), one on the right looks (0.005 rad per px), both fingers at once, 12 Exit by touch puts everything back.
// --only runs some of the scenes (A, B, C, or P with --phone) and --steps some of the steps of scene A (by the number at the start of their name, e.g. 4,6), for a quick look. Headless Chrome has no pointer lock: the script defines document.pointerLockElement itself (an init script
// of the page, tools only) and sends mousemove events with movementX and movementY, the way the browser does under a lock.
// --out writes a few JPEG shots of key steps (at most 12 files, quality 55). At the end of each run: no console or script error, no request outside the page's own address, nothing in storage.
// The tool expects the page's hooks window.__spacer, __camera, __shell, __frames (see tests/app/spacer-wiring.test.mjs). Exits 1 when a step fails.
// On a small machine run it under tools/chrome-lock.sh (one browser at a time) and nice. CHROME names the browser (chrome-headless-shell is fine), PS_ANGLE=metal draws on the GPU.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = { html: null, out: null, timeout: 900, only: null, steps: null };
let phone = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--phone') phone = true;
  else if (argv[i].startsWith('--') && argv[i].slice(2) in opt && argv[i + 1] !== undefined) opt[argv[i].slice(2)] = argv[++i];
  else { console.error('usage: node tools/spacer-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout S] [--phone] [--only A,B,C] [--steps 4,6]'); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = /^https?:\/\//i.test(opt.html ?? '');
const page = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const ownOrigin = live ? new URL(opt.html).origin : 'file://';
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });
const only = opt.only ? String(opt.only).toUpperCase().split(',') : null;
const stepsWanted = opt.steps ? String(opt.steps).split(',') : null;
const W = phone ? 390 : 1280, H = phone ? 844 : 720, tag = phone ? 'phone' : 'desktop';
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const GL_FLAGS = ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-spacer-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--use-gl=angle', `--use-angle=${ANGLE}`, ...GL_FLAGS,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map(), logs = [], requests = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const cleanup = async () => { try { ws?.close(); } catch { /* closed */ } chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

const steps = [];
const check = (name, ok, detail = '') => { steps.push({ name, ok: !!ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` | ${String(detail).slice(0, 420)}` : ''}`); };
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const waitFor = async (expression, ms = 20000, label = expression) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expression); if (v) return v; } catch { /* the page is busy */ } await sleep(150); }
  throw new Error(`timed out waiting for ${label}`);
};
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const near = (v, to, tol) => Number.isFinite(v) && Math.abs(v - to) <= tol;

// ---------- pictures ----------
// A screenshot as raw pixels (Chrome writes 8-bit RGB or RGBA PNG files that are not interlaced), so that two pictures can be compared by pixels.
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
const grab = async () => { const b64 = (await send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, p = decodePng(b64); p.b64 = b64; return p; };
// How many pixels differ by more than tol (of 255) in some colour channel, inside the box (fractions of the picture) when one is given.
function changed(a, b, box = [0, 0, 1, 1], tol = 12) {
  if (a.w !== b.w || a.h !== b.h || a.bpp !== b.bpp) return Infinity;
  const x0 = Math.floor(a.w * box[0]), y0 = Math.floor(a.h * box[1]), x1 = Math.ceil(a.w * box[2]), y1 = Math.ceil(a.h * box[3]);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.w + x) * a.bpp;
    if (Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2])) > tol) n++;
  }
  return n;
}
// Where the pixels that differ lie: the count and the box around them (client pixels), for the line of a failing step.
function whereChanged(a, b, tol = 3) {
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  if (a.w !== b.w || a.h !== b.h) return { n: Infinity, box: 'size differs' };
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = (y * a.w + x) * a.bpp;
    if (Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2])) > tol) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { n, box: n ? `${x0},${y0}..${x1},${y1}` : 'none' };
}
let shots = 0;
const shot = async (name) => { // a JPEG of the step for a look, at most 12 per run
  if (!out || shots >= 12) return;
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55, fromSurface: true });
  writeFileSync(join(out, `${tag}-${name}.jpg`), Buffer.from(r.data, 'base64')); shots++;
};

// ---------- real input ----------
const KEYS = {
  W: ['w', 'KeyW', 87], A: ['a', 'KeyA', 65], S: ['s', 'KeyS', 83], D: ['d', 'KeyD', 68], Space: [' ', 'Space', 32], Escape: ['Escape', 'Escape', 27],
  Shift: ['Shift', 'ShiftLeft', 16], Control: ['Control', 'ControlLeft', 17], ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37], ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39], ArrowDown: ['ArrowDown', 'ArrowDown', 40], 3: ['3', 'Digit3', 51], 1: ['1', 'Digit1', 49],
};
const MOD = { Shift: 8, Control: 2 };
const keyEv = (type, name, modifiers = 0) => send('Input.dispatchKeyEvent', { type, key: KEYS[name][0], code: KEYS[name][1], windowsVirtualKeyCode: KEYS[name][2], modifiers });
// Shift with an arrow as a key event that has a `key` and no `code` (what a virtual keyboard may send). A first try with Input.dispatchKeyEvent (no code given) did not catch the shift-time breakage, so the browser
// probably fills the code in from the key code. This one is a KeyboardEvent made in the page and sent to the body: the only event of the whole check that is not a real one, and the control outside Spacer shows that the page's handler takes it.
async function keyOnlyShiftArrow(key) {
  await ev(`(() => { const o = { key: ${JSON.stringify(key)}, shiftKey: true, bubbles: true, cancelable: true }; document.body.dispatchEvent(new KeyboardEvent('keydown', o)); document.body.dispatchEvent(new KeyboardEvent('keyup', o)); })()`); await sleep(120);
}
// a key pressed and let go at once, with the modifiers held around it (Shift, Control)
async function press(name, mods = []) {
  const m = mods.reduce((s, k) => s | MOD[k], 0);
  for (const k of mods) await keyEv('keyDown', k, m);
  await keyEv('keyDown', name, m); await keyEv('keyUp', name, m);
  for (const k of [...mods].reverse()) await keyEv('keyUp', k, 0);
  await sleep(120);
}
// keys held while the page walks ms of a stopped clock (advanceTime): the events are real, the time is exact
async function hold(names, ms) {
  const m = names.reduce((s, k) => s | (MOD[k] ?? 0), 0);
  for (const k of names) await keyEv('keyDown', k, m);
  const s = await ev(`window.__spacer.advanceTime(${ms})`);
  for (const k of [...names].reverse()) await keyEv('keyUp', k, 0);
  return s;
}
const mouseClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
};
const touchTap = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(200);
};
const rectOf = (sel) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return null; const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
  return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: !n.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 }; })()`);
const tapSel = async (sel) => { const r = await rectOf(sel); if (!r || !r.shown) return false; await (phone ? touchTap : mouseClick)(r.x + r.w / 2, r.y + r.h / 2); return true; };
// fingers: [[x, y, id], ...]. They go down one after another, move together, and are lifted together.
const pts = (list) => list.map(([x, y, id]) => ({ x, y, id }));
async function fingersDown(list) { for (let i = 1; i <= list.length; i++) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(list.slice(0, i)) }); await sleep(40); } }
async function fingersMove(from, to, n = 6) {
  for (let k = 1; k <= n; k++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from.map((p, i) => [p[0] + ((to[i][0] - p[0]) * k) / n, p[1] + ((to[i][1] - p[1]) * k) / n, p[2]])) }); await sleep(30); }
  await frameAfter(2); // the browser hands the pointer moves to the page once per drawn frame: the last one has arrived after two
}
const fingersUp = () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

// ---------- page ----------
// Headless Chrome has no pointer lock. This init script gives the page a document.pointerLockElement of its own (the picture, while the "lock" is on) and a requestPointerLock that
// counts its calls and, when the check lets it, grants the lock and says so with pointerlockchange, as a browser does. exitPointerLock lets go the same way.
const INIT = `(() => {
  const lock = { on: false, allow: false }; window.__lock = lock; window.__lockAsks = 0;
  const canvas = () => document.querySelector('canvas:not(#ps-walk-map)');
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return lock.on ? canvas() : null; } });
  const said = () => setTimeout(() => document.dispatchEvent(new Event('pointerlockchange')), 0);
  Element.prototype.requestPointerLock = function () { window.__lockAsks++; if (lock.allow && !lock.on) { lock.on = true; said(); } return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (lock.on) { lock.on = false; said(); } };
  // The reading at the space bar (see armSpaceProbe): the listener has to be the first on the window in the capture phase, ahead of the one that Spacer adds and that keeps the key to itself.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !window.__probeArmed) return; window.__probeArmed = false;
    const keyAt = performance.now(); // the moment of the key itself; the reading follows it by some tens of ms (it paints the view first)
    setTimeout(() => { const h = document.getElementById('ps-walk-hint'), s = window.__spacer.state(); if (s.cam) window.__spacer.walkTo(s.cam.x, s.cam.z, s.level, s.cam.yaw, s.cam.pitch);
      window.__spaceProbe = { keyAt, at: performance.now(), notice: s.notice, text: h ? h.textContent : null, hidden: h ? h.hidden : null, doors: s.doors.map((d) => [d.id, d.open]), jump: s.jump.active }; }, 0);
  }, true);
})()`;
async function open(hash, ready = 'typeof window.__spacer === "object" && (window.__done === true || window.__frames >= 1 || !!window.__fail)') {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300); // a change of the part after # alone would not reload the page
  await send('Page.navigate', { url: `${page}#${hash}` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`, 90000, 'the page');
  await waitFor(ready, 150000, 'the page to be done').catch(async (e) => { throw new Error(`${e.message}: ${await ev(`JSON.stringify({ rs: document.readyState, done: window.__done, fail: window.__fail, frames: window.__frames, spacer: typeof window.__spacer })`).catch((x) => String(x))}`); });
  await waitFor('!window.__camera || window.__camera.busy === false', 30000).catch(() => {});
  await sleep(600);
  if (await ev('!!window.__fail')) throw new Error(`the page failed: ${await ev('window.__fail')}`);
}
const frames = () => ev('typeof window.__frames === "number" ? window.__frames : -1');
const frameAfter = async (n = 1) => { const f = await frames(); await waitFor(`window.__frames >= ${f + n}`, 60000, 'a drawn frame'); };
const st = () => ev('window.__spacer.state()');
const dist2 = (a, b) => Math.hypot(b.cam.x - a.cam.x, b.cam.z - a.cam.z);
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const place = (x, y, yawDeg, pitchDeg = 0, level = 'L0') => ev(`window.__spacer.walkTo(${x}, ${y}, ${JSON.stringify(level)}, ${yawDeg}, ${pitchDeg})`);
const eyeY = () => ev('window.__shell && window.__shell.view ? window.__shell.view().position[1] : null'); // the camera as three.js holds it
const BTN = '#ps-ui button[data-tool="spacer"]';
// everything on the control bar that can be seen or pressed, by name
const controls = () => ev(`[...document.querySelectorAll('#ps-ui button, #ps-ui input, #ps-ui select')].filter((n) => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; })
  .map((n) => (n.dataset.tool ? 'tool:' + n.dataset.tool : n.dataset.preset ? 'mood:' + n.dataset.preset : n.dataset.plan ? 'plan:' + n.dataset.plan : n.dataset.floor ? 'floor:' + n.dataset.floor : n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : '')))`);
// the view from above, as the page keeps it
const view = () => ev(`(() => { const c = window.__camera, v = window.__shell && window.__shell.view ? window.__shell.view() : null, m = document.querySelector('#ps-ui button.mood[aria-pressed="true"]'), sl = document.querySelector('#ps-ui input[type=range]');
  return { az: c.azimuth, pol: c.polar, dist: c.distance, near: c.nearPlane, fov: v ? v.fov : null, preset: m ? m.dataset.preset : null, t: sl ? Number(sl.value) : null, floor: window.__floors ? String(window.__floors.get()) : null,
    cls: document.getElementById('ps-ui').className, shell: window.__shell ? window.__shell.mode : null, clock: (document.querySelector('#ps-ui .clock') || {}).textContent ?? null }; })()`);
const sameView = (a, b) => Math.abs(a.az - b.az) < 1e-6 && Math.abs(a.pol - b.pol) < 1e-6 && Math.abs(a.dist - b.dist) < 1e-6 && a.near === b.near && a.fov === b.fov && a.preset === b.preset
  && Math.abs(a.t - b.t) < 1e-6 && a.floor === b.floor && a.shell === b.shell && a.clock === b.clock;
const storageUse = () => ev(`(async () => { let idb = 0; try { idb = (await indexedDB.databases()).length; } catch { /* no listing */ } try { return { local: localStorage.length, session: sessionStorage.length, cookie: document.cookie.length, idb }; } catch (e) { return { error: String(e).slice(0, 80) }; } })()`);
let storageHit = null;
async function noStorage() { try { const u = await storageUse(); if (u && (u.local || u.session || u.cookie || u.idb)) storageHit = JSON.stringify(u); } catch { /* the page is gone */ } }

// The page at rest: the camera is not moving and __frames has not grown for `polls` polls of 0.5 s in a row (a page at rest draws nothing). The frames that a change asks for come first, so
// a picture or a reading taken after this one is of the settled page (the camera distance, for one, is refitted by the frames that follow a load or a way out), not of a moment on the way there.
async function atRest(polls = 6, maxMs = 120000) {
  const end = Date.now() + maxMs; let f = -1, quiet = 0;
  while (Date.now() < end && quiet < polls) { await sleep(500); const n = await frames(), busy = await ev('!!(window.__camera && window.__camera.busy)').catch(() => true); quiet = n === f && !busy ? quiet + 1 : 0; f = n; }
  return quiet >= polls;
}
// The mouse goes to a bare spot of the picture, so that no button stands in its hover state in a picture (a click on the Walk button leaves the pointer over it). The hover is a CSS transition: it needs a moment.
async function mouseAway() { if (!phone) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: H / 2 }); await sleep(450); } }
// The page shows a first-visit hint ("Drag to turn", #ps-hint) until the first gesture on the view; entering Spacer takes it away for good. A visitor has made that gesture by the time they walk,
// so the pictures before and after are taken with the hint out of both (an explicit style, here and nowhere else): it is not part of the scene, and with it in the first picture only the diff counts 5 600 pixels it cannot help.
const muteFirstVisitHint = () => ev(`(() => { if (!document.getElementById('w7-mute')) { const s = document.createElement('style'); s.id = 'w7-mute'; s.textContent = '#ps-hint{display:none!important}'; document.head.appendChild(s); } })()`);

// After Spacer ends: the bar, the map, the view and the picture are as they were, nothing is drawn at rest. pre: { view, controls, picture }.
async function backAsItWas(label, pre) {
  await waitFor('window.__spacer.active === false', 20000, 'Spacer to end');
  await waitFor('!window.__camera || window.__camera.busy === false', 30000).catch(() => {});
  await mouseAway(); await atRest(); // the frames that the way out itself asks for come first, then nothing
  const v = await view(), c = await controls(), s = await st(), map = await rectOf('#ps-walk-map'), hint = await rectOf('#ps-walk-hint'), zones = await ev(`!!document.querySelector('#ps-walk-zones.on')`);
  check(`${label}: Spacer is off and the page says nothing of it (no state, bar without "walking")`, s.active === false && s.cam === null && !/walking/.test(v.cls), `${JSON.stringify(s).slice(0, 80)} bar "${v.cls}"`);
  check(`${label}: the bar has all its tools again, the same as before`, JSON.stringify(c) === JSON.stringify(pre.controls), `${c.length} controls now, ${pre.controls.length} before`);
  check(`${label}: the map, the hint and the zones are gone`, (!map || !map.shown) && (!hint || !hint.shown) && !zones, `map ${map ? map.shown : 'none'}, hint ${hint ? hint.shown : 'none'}, zones ${zones}`);
  check(`${label}: the view is the one from before (azimuth, tilt, distance within 1e-6; mood, time of day, floors, shell)`, sameView(v, pre.view), `now ${JSON.stringify({ ...v, cls: undefined })} before ${JSON.stringify({ ...pre.view, cls: undefined })}`);
  check(`${label}: the lens is the one from above again (fov 27, near 0.5)`, v.fov === 27 && v.near === 0.5, `fov ${v.fov}, near ${v.near}`);
  const f0 = await frames(); await sleep(3000); const f1 = await frames();
  check(`${label}: nothing is drawn at rest (3 s)`, f1 === f0, `${f0} to ${f1}`);
  const pic = await grab(), diff = whereChanged(pre.picture, pic, 3);
  check(`${label}: the picture is the one from before the walk (doors open again, walls, mood: at most 0.1% of the pixels differ by more than 3 of 255)`, diff.n <= pic.w * pic.h * 0.001, `${diff.n} of ${pic.w * pic.h} pixels, in the box ${diff.box}; two pictures of the page at rest before the walk differed in ${pre.rest} pixels`);
  if (out && diff.n > pic.w * pic.h * 0.001) { writeFileSync(join(out, `diag-${label.replace(/\W+/g, '-')}-before.png`), Buffer.from(pre.picture.b64, 'base64')); writeFileSync(join(out, `diag-${label.replace(/\W+/g, '-')}-after.png`), Buffer.from(pic.b64, 'base64')); }
  return { v, c, pic };
}
// The page as it stands before the walk, read once it has come to rest (the first frames refit the camera distance: 35.18 at the first reading, 26.42 settled, the same picture). rest: how many pixels
// two pictures of the settled page differ in (the noise of the screen, 0 expected).
const snapshotBefore = async () => {
  await muteFirstVisitHint(); await mouseAway();
  await waitFor('!window.__camera || window.__camera.busy === false', 30000).catch(() => {});
  await atRest();
  const picture = await grab(), v = await view(), c = await controls();
  await sleep(700);
  return { view: v, controls: c, picture, rest: whereChanged(picture, await grab(), 3).n };
};

// ---------- the word in the doorway ----------
// Reads what the page shows at the moment of the space bar, not some frames later: one frame takes seconds on this renderer and the word stands for 2.5 s of the wall clock, so a reading from
// outside could come after it was gone. The probe (in INIT, first on the window in the capture phase, ahead of the listener that Spacer adds and that keeps the key to itself) takes its reading in
// a timeout of 0, which runs after Spacer has answered the key and before Spacer's own timer of 2.5 s (due later, so it fires later). The reading paints the view first (walkTo to the very place
// it stands paints at once; a frame is not needed). The log writes down every change of the hint element with performance.now(), so that the time the word stood is the page's own.
const armSpaceProbe = () => ev(`(() => {
  window.__spaceProbe = null; window.__hintLog = []; window.__probeArmed = true; const h = () => document.getElementById('ps-walk-hint');
  if (!window.__hintObserver && h()) { window.__hintObserver = new MutationObserver(() => window.__hintLog.push({ t: performance.now(), text: h().textContent, hidden: h().hidden })); window.__hintObserver.observe(h(), { childList: true, characterData: true, subtree: true, attributes: true }); }
})()`);
const spaceAnd = async (mods = []) => { await armSpaceProbe(); await press('Space', mods); return waitFor('window.__spaceProbe', 20000, 'the reading at the space bar'); };
const DOOR = 'd-hall-living';

// ---------- scene A: the flat, with mouse and keyboard ----------
// A step that fails or throws is recorded and the next one goes on from a known state (Spacer on with a stopped clock, or off).
async function sec(label, fn) { if (stepsWanted && !stepsWanted.some((n) => label === n || label.startsWith(`${n} `))) return; try { await fn(); } catch (e) { check(`${label} ran to the end`, false, e.message); } }
async function ensureWalking(manual = true) {
  if (!(await ev('window.__spacer.active'))) { await ev('window.__spacer.enter()'); await waitFor('window.__spacer.active === true', 60000, 'Spacer to begin'); }
  await ev(`window.__spacer.manualClock(${manual})`);
}
async function ensureOff() { if (await ev('window.__spacer.active')) { await ev('window.__spacer.leave()'); await waitFor('window.__spacer.active === false', 20000); await sleep(800); } }
async function sceneA() {
  await open('plan=flat-1&lang=en&q=low&live=1');
  check('A: the page is up with the hooks of Spacer and no script error', await ev(`typeof window.__spacer === 'object' && window.__spacer.active === false && !window.__fail`));
  const btn0 = await rectOf(BTN);
  check('A: the Spacer button is on the bar and reads "Walk"', !!btn0 && btn0.shown && /Walk/.test(await ev(`document.querySelector(${JSON.stringify(BTN)}).textContent`)), JSON.stringify(btn0));
  // the readout of the time of day works: outside Spacer Shift with the right arrow moves it (the control for step 5)
  const t0 = (await view()).t;
  await press('ArrowRight', ['Shift']); await sleep(400);
  const t1 = (await view()).t;
  check('A: control: outside Spacer Shift with the right arrow moves the time of day', t1 > t0 + 0.01, `${f3(t0)} to ${f3(t1)}`);
  // the same key with a `key` and no `code` (some virtual keyboards send no code): Spacer reads the code, so it is not Spacer's; the page's own handler reads the key
  await keyOnlyShiftArrow('ArrowRight'); await sleep(400);
  const t2 = (await view()).t;
  check('A: control: outside Spacer Shift with the right arrow sent with a key and no code moves the time of day too', t2 > t1 + 0.01, `${f3(t1)} to ${f3(t2)}`);
  const pre = await snapshotBefore();
  check('A: before the walk the bar shows its tools (the moods, the time, the plans, the tools)', pre.controls.length > 8 && pre.controls.includes('tool:spacer'), pre.controls.join(' '));

  await sec('1 click', async () => {
    // 1. the click
    const f0 = await frames();
    const clicked = await tapSel(BTN);
    await waitFor('window.__spacer.active === true', 60000, 'Spacer to begin').catch(() => {});
    await waitFor(`window.__frames > ${f0}`, 60000).catch(() => {});
    await sleep(500);
    const a = await ev(`window.__spacer.active`), s1 = await st(), v1 = await view(), c1 = await controls();
    const map = await rectOf('#ps-walk-map'), hint = await rectOf('#ps-walk-hint'), hintText = await ev(`(document.getElementById('ps-walk-hint') || {}).textContent ?? ''`);
    check('1 click: a real click on the button begins Spacer', clicked && a === true && s1.active && s1.denied === '', `active ${a}, denied "${s1.denied}"`);
    check('1 click: the bar keeps the moods and the Exit button only (class walking)', /walking/.test(v1.cls) && JSON.stringify([...c1].sort()) === JSON.stringify(['mood:amber', 'mood:clear', 'mood:lamplit', 'tool:spacer']), `class "${v1.cls}", controls ${c1.join(' ')}`);
    check('1 click: the button reads Exit and is pressed', await ev(`(() => { const b = document.querySelector(${JSON.stringify(BTN)}); return /Exit/.test(b.textContent) && b.getAttribute('aria-pressed') === 'true'; })()`));
    check('1 click: the map (180 px) and the hint are on the picture', !!map && map.shown && near(map.w, 180, 1) && near(map.h, 180, 1) && !!hint && hint.shown && /W S walk/.test(hintText), `map ${map ? f2(map.w) + 'x' + f2(map.h) : 'none'}, hint "${hintText.slice(0, 60)}"`);
    check('1 click: the button gave up the focus (the active element is BODY)', (await ev(`document.activeElement ? document.activeElement.tagName : null`)) === 'BODY');
    check('1 click: the eyes are at 1.6 m, in a room, level L0', s1.cam && near(s1.cam.y, 1.6, 0.001) && s1.level === 'L0' && !!s1.room, JSON.stringify(s1.cam) + ` room ${s1.room}`);
    check('1 click: the lens of the eyes is on (near 0.05, fov 70)', (await ev(`window.__camera.nearPlane`)) === 0.05 && (await ev(`window.__shell && window.__shell.view ? window.__shell.view().fov : null`)) === 70);
    // the start of the flat is where the label of the hall puts it, and the rule about the open leaf of a door (W6b) moves nothing here: the front door leaf stands 0.64 m behind the walker
    check('1 click: the start is (1.0, 4.5) within 0.05 m, the same as before the rule about the leaf of a door', near(s1.cam.x, 1.0, 0.05) && near(s1.cam.z, 4.5, 0.05), `x ${f3(s1.cam.x)}, z ${f3(s1.cam.z)}, yaw ${f2(s1.cam.yaw)}`);
    check('1 click: the first-visit hint of the page ("Drag to turn") is gone for good', !(await ev(`!!document.getElementById('ps-hint')`)));
    await shot('1-entered');

  });
  await sec('2 keys real clock', async () => {
    await ensureWalking(false);
    // 2. the keys. First with the real clock: the key goes down, the walker moves, the key goes up, the walker stops.
    await place(1.5, 1.5, 0);
    const r0 = await st();
    await keyEv('keyDown', 'W'); await sleep(2500); await keyEv('keyUp', 'W');
    const r1 = await st(); await sleep(2500); const r2 = await st(); // a key that stayed down in the page would go on walking
    const walked = dist2(r0, r1), after = dist2(r1, r2);
    check('2 keys: W held for 2.5 s of real time walks forward by the real frames (0 to 3.5 m) and stops when it is let go', walked > 0.05 && walked < 3.5 && after < 0.001, `walked ${f3(walked)} m, then ${f3(after)} m in 2.5 s more`);
  });
  await sec('2 keys exact', async () => {
    await ensureWalking();
    // then the stopped clock and exact times
    await ev('window.__spacer.manualClock(true)');
    await place(1.5, 1.5, 0);
    let a0 = await st(), a1 = await hold(['W'], 500);
    check('2 keys: W for 0.5 s goes forward 0.70 m (1.4 m/s), along the look, on the floor', near(dist2(a0, a1), 0.7, 0.03) && near(a1.cam.x - a0.cam.x, 0.7, 0.03) && near(a1.cam.z, a0.cam.z, 0.01) && near(a1.cam.y, 1.6, 0.001), `moved ${f3(a1.cam.x - a0.cam.x)} along x, ${f3(a1.cam.z - a0.cam.z)} across`);
    const walkDist = dist2(a0, a1);
    a0 = a1; a1 = await hold(['S'], 500);
    check('2 keys: S for 0.5 s goes back 0.70 m', near(a0.cam.x - a1.cam.x, 0.7, 0.03) && near(a1.cam.z, a0.cam.z, 0.01), `moved ${f3(a1.cam.x - a0.cam.x)} along x`);
    a0 = a1; a1 = await hold(['D'], 500);
    check('2 keys: D steps aside to the right, 0.70 m, without turning', near(a1.cam.z - a0.cam.z, 0.7, 0.03) && near(a1.cam.x, a0.cam.x, 0.01) && near(a1.cam.yaw, a0.cam.yaw, 0.01), `moved ${f3(a1.cam.z - a0.cam.z)} across, yaw ${f2(a0.cam.yaw)} to ${f2(a1.cam.yaw)}`);
    a0 = a1; a1 = await hold(['A'], 500);
    check('2 keys: A steps aside to the left, 0.70 m, without turning', near(a0.cam.z - a1.cam.z, 0.7, 0.03) && near(a1.cam.x, a0.cam.x, 0.01) && near(a1.cam.yaw, a0.cam.yaw, 0.01), `moved ${f3(a0.cam.z - a1.cam.z)} across, yaw ${f2(a0.cam.yaw)} to ${f2(a1.cam.yaw)}`);
    a0 = a1; a1 = await hold(['ArrowUp'], 500);
    check('2 keys: the arrow up walks forward like W', near(a1.cam.x - a0.cam.x, 0.7, 0.03), `moved ${f3(a1.cam.x - a0.cam.x)}`);
    a0 = a1; a1 = await hold(['ArrowRight'], 500);
    check('2 keys: the right arrow TURNS (yaw grows by 55 degrees, 110 per second) and does not step aside', near(wrapDeg(a1.cam.yaw - a0.cam.yaw), 55, 2) && dist2(a0, a1) < 0.01, `yaw ${f2(a0.cam.yaw)} to ${f2(a1.cam.yaw)}, moved ${f3(dist2(a0, a1))} m`);
    a0 = a1; a1 = await hold(['ArrowLeft'], 500);
    check('2 keys: the left arrow turns back (yaw falls by 55 degrees) and does not step aside', near(wrapDeg(a0.cam.yaw - a1.cam.yaw), 55, 2) && dist2(a0, a1) < 0.01, `yaw ${f2(a0.cam.yaw)} to ${f2(a1.cam.yaw)}, moved ${f3(dist2(a0, a1))} m`);
    await place(1.5, 1.5, 0);
    a0 = await st(); a1 = await hold(['Shift', 'W'], 500);
    const runDist = dist2(a0, a1);
    check('2 keys: Shift with W runs, 1.40 m in 0.5 s (2.8 m/s), twice the walk', near(runDist, 1.4, 0.05) && near(runDist / walkDist, 2, 0.1), `run ${f3(runDist)} m, walk ${f3(walkDist)} m, ratio ${f2(runDist / walkDist)}`);

  });
  await sec('3 walls', async () => {
    await ensureWalking();
    // 3. walls
    await place(3.0, 2.0, 90);
    let w0 = await st(), w1 = await hold(['W'], 2000);
    check('3 walls: walking at a wall for 2 s (2.8 m) stops short of it and counts the contacts', w1.cam.z < 3.0 && w1.cam.z > 2.5 && w1.collisions > w0.collisions && w1.room === w0.room, `z ${f3(w0.cam.z)} to ${f3(w1.cam.z)} (the wall is at 3.0), room ${w0.room} to ${w1.room}, contacts ${w0.collisions} to ${w1.collisions}`);
    await place(1.8, 1.5, -90);
    w0 = await st(); w1 = await hold(['W'], 2000);
    check('3 walls: a wall with a window blocks too (the wall is at 0)', w1.cam.z > 0.1 && w1.cam.z < 0.6 && w1.collisions > w0.collisions, `z ${f3(w0.cam.z)} to ${f3(w1.cam.z)}, contacts ${w0.collisions} to ${w1.collisions}`);
    await place(1.05, 3.9, -90);
    w0 = await st(); w1 = await hold(['W'], 1500);
    check('3 walls: control: an open door lets through (the wall at 3.0 is crossed)', w0.cam.z > 3.5 && w1.cam.z < 2.5, `z ${f3(w0.cam.z)} to ${f3(w1.cam.z)}`);

  });
  await sec('4 jump', async () => {
    await ensureWalking();
    // 4. Space
    await place(2.5, 1.5, 0);
    let j0 = await st();
    const eye0 = await eyeY();
    await press('Space');
    const j1 = await st();
    check('4 space: far from a door Space starts a jump', j1.jump.active === true && j1.doors.every((d) => d.open), JSON.stringify(j1.jump));
    const peak = await ev('window.__spacer.advanceTime(306)'), eyePeak = await eyeY();
    check('4 space: the jump peaks near 0.46 m (3.0 m/s, 9.8 m/s2), the eyes of the state and of the camera with it', near(peak.jump.height, 0.459, 0.015) && near(peak.cam.y - j0.cam.y, 0.459, 0.015) && (eyePeak === null || near(eyePeak - eye0, 0.459, 0.015)), `height ${f3(peak.jump.height)}, state eye +${f3(peak.cam.y - j0.cam.y)}, camera eye +${eyePeak === null ? 'n/a' : f3(eyePeak - eye0)}`);
    await shot('4-jump-peak');
    await press('Space'); // in the air: nothing
    const again = await ev('window.__spacer.advanceTime(100)');
    const expected = 3.0 * 0.406 - 0.5 * 9.8 * 0.406 * 0.406; // the first jump alone, 0.406 s after the start (a second jump would be higher)
    check('4 space: a second Space in the air does nothing (the height follows the first jump)', near(again.jump.height, expected, 0.01), `height ${f3(again.jump.height)}, the first jump alone ${f3(expected)}`);
    const landed = await ev('window.__spacer.advanceTime(500)');
    check('4 space: the jump ends on the floor (0.61 s, height 0, eyes at 1.6 m)', landed.jump.active === false && landed.jump.height === 0 && near(landed.cam.y, 1.6, 0.001), JSON.stringify(landed.jump) + ` eye ${landed.cam.y}`);
    await press('Space', ['Control']);
    const ctrl = await st();
    check('4 space: Ctrl with Space neither jumps nor works a door', ctrl.jump.active === false, JSON.stringify(ctrl.jump));
  });
  await sec('4 door', async () => {
    await ensureWalking();
    let w0, w1;
    // the door
    await place(1.05, 3.9, -90);
    await sleep(500); await frameAfter(2); await sleep(300);
    const open0 = await grab(), d0 = (await st()).doors.find((d) => d.id === 'd-hall-living');
    await press('Space');
    const d1 = await st(), dm = await ev('window.__spacer.advanceTime(200)');
    const mid = dm.doors.find((d) => d.id === 'd-hall-living');
    check('4 space: at a door in reach (0.9 m, looking at it) Space shuts it and does not jump', d0.open === true && d1.doors.find((d) => d.id === 'd-hall-living').open === false && d1.jump.active === false && d1.cam.y === 1.6, `open ${d0.open} to ${d1.doors.find((d) => d.id === 'd-hall-living').open}, jump ${d1.jump.active}`);
    check('4 space: the leaf swings (0.45 s): 0.2 s later it stands between open and shut', mid.t > 0.3 && mid.t < 0.8, `t ${f3(mid.t)}`);
    await ev('window.__spacer.advanceTime(400)'); await frameAfter(2); await sleep(300);
    const shut0 = await grab();
    const dOpenVsShut = changed(open0, shut0, [0.15, 0.1, 0.85, 0.9]);
    check('4 space: the picture shows it: open and shut differ over the door (pixels changed in the middle of the picture)', dOpenVsShut > 1500, `${dOpenVsShut} pixels`);
    await shot('4-door-shut');
    w0 = await st(); w1 = await hold(['W'], 2000);
    check('4 space: a shut door blocks (the wall line is at 3.0, the walker started at 3.9)', w1.cam.z > 3.0 && w1.collisions > w0.collisions, `z ${f3(w0.cam.z)} to ${f3(w1.cam.z)}`);
    await place(1.05, 3.9, -90);
    await press('Space');
    const d2 = await ev('window.__spacer.advanceTime(500)');
    await frameAfter(2); await sleep(300);
    const open1 = await grab();
    check('4 space: a second Space opens it again, and the picture is the open one', d2.doors.find((d) => d.id === 'd-hall-living').open === true && d2.jump.active === false && changed(open0, open1, [0.15, 0.1, 0.85, 0.9]) < dOpenVsShut / 4, `open ${d2.doors.find((d) => d.id === 'd-hall-living').open}, t ${f3(d2.doors.find((d) => d.id === 'd-hall-living').t)}, ${changed(open0, open1, [0.15, 0.1, 0.85, 0.9])} pixels from the first open picture`);
    await shot('4-door-open');
  });
  await sec('4 doorway', async () => {
    await ensureWalking();
    const doorOf = (list) => list.find((d) => d[0] === DOOR); // list: [[id, open], ...] as the probe writes it
    // from afar the door is shut and opened without a word
    await place(1.05, 3.9, -90);
    let p = await spaceAnd();
    check('4 doorway: from 0.9 m away Space shuts the door and the page says nothing about a doorway', doorOf(p.doors)[1] === false && p.notice === null && p.jump === false && !/doorway/.test(p.text ?? ''), `open ${doorOf(p.doors)[1]}, notice ${p.notice}, hint "${p.text}"`);
    await ev('window.__spacer.advanceTime(500)');
    p = await spaceAnd(); await ev('window.__spacer.advanceTime(500)');
    check('4 doorway: a second Space opens it again, still without a word', doorOf(p.doors)[1] === true && p.notice === null, `open ${doorOf(p.doors)[1]}, notice ${p.notice}`);
    // in the doorway (the open door is on top of the walker) the door stays open and the page says why, for 2.5 s of the wall clock
    await place(1.05, 3.0, -90);
    const s0 = await st();
    p = await spaceAnd();
    check('4 doorway: standing in the doorway Space leaves the door open, does not jump, and the state carries the word (notice "doorway")', doorOf(p.doors)[1] === true && p.jump === false && p.notice === 'doorway', `door open ${doorOf(p.doors)[1]}, jump ${p.jump}, notice ${p.notice}, at ${f3(s0.cam.x)},${f3(s0.cam.z)}`);
    check('4 doorway: the hint element reads "Step out of the doorway to shut the door" (the text in the page, not the key) and is shown', p.text === 'Step out of the doorway to shut the door' && p.hidden === false, `"${p.text}", hidden ${p.hidden}`);
    // it goes by itself 2.5 s after the key (the page's own clock; a slow frame may hold it up, so up to 4 s are allowed) and the hint of the mouse comes back
    const gone = await waitFor(`(() => { const e = window.__hintLog.find((l) => l.t > window.__spaceProbe.at && l.text !== ${JSON.stringify('Step out of the doorway to shut the door')}); return e ? { t: e.t, text: e.text } : null; })()`, 12000, 'the word to go').catch(() => null);
    const stood = gone ? gone.t - p.keyAt : null, sNow = await st(); // counted from the key itself
    check('4 doorway: the word goes after about 2.5 s of the wall clock (2.49 to 4.0 s from the key), notice is null, the hint of the mouse is back, the door is still open', gone !== null && stood >= 2490 && stood <= 4000 && sNow.notice === null && /W S walk/.test(gone.text) && doorOf(sNow.doors.map((d) => [d.id, d.open]))[1] === true, `stood ${stood === null ? 'n/a' : Math.round(stood)} ms, notice ${sNow.notice}, hint "${gone ? gone.text.slice(0, 40) : 'n/a'}"`);
    // leaving takes the word away: a new walk begins without it
    p = await spaceAnd();
    check('4 doorway: a new try in the doorway shows the word again', p.notice === 'doorway' && p.text === 'Step out of the doorway to shut the door', `notice ${p.notice}, hint "${p.text}"`);
    await press('Escape');
    await waitFor('window.__spacer.active === false', 15000, 'Escape in the doorway');
    const left = await st();
    await ev('window.__spacer.enter()'); await waitFor('window.__spacer.active === true', 60000, 'Spacer to begin again');
    const again = await st(), txt = await ev(`document.getElementById('ps-walk-hint').textContent`);
    check('4 doorway: leaving clears the word (notice null at once, and none in the next walk)', left.notice === null && again.notice === null && /W S walk/.test(txt) && !/doorway/.test(txt), `after leaving ${left.notice}, in the next walk ${again.notice}, hint "${txt.slice(0, 40)}"`);
    await ev('window.__spacer.manualClock(true)');
    // a look at the word (only with --out): a frame takes longer here than the 2.5 s that the word stands, so for this one shot the page's timer of 2.5 s is made 100 times longer; nothing else is changed
    if (out) {
      await place(1.05, 3.0, -90);
      await ev(`(() => { if (!window.__setTimeout) { window.__setTimeout = window.setTimeout; window.setTimeout = (fn, ms, ...a) => window.__setTimeout(fn, ms === 2500 ? 250000 : ms, ...a); } })()`);
      p = await spaceAnd(); await frameAfter(2); await sleep(300);
      check('4 doorway: for the shot the word is up in the picture (timer made long, only here)', p.notice === 'doorway' && (await ev(`document.getElementById('ps-walk-hint').textContent`)) === 'Step out of the doorway to shut the door', `hint "${await ev(`document.getElementById('ps-walk-hint').textContent`)}"`);
      await shot('4-doorway-word');
      await press('Escape'); await waitFor('window.__spacer.active === false', 15000, 'Escape after the shot');
      await ev(`(() => { if (window.__setTimeout) { window.setTimeout = window.__setTimeout; window.__setTimeout = null; } })()`);
      await ev('window.__spacer.enter()'); await waitFor('window.__spacer.active === true', 60000, 'Spacer to begin again'); await ev('window.__spacer.manualClock(true)');
    }
  });
  await sec('4 exit button', async () => {
    await ensureWalking();
    // Space on the Exit button presses the button
    await ev(`document.querySelector(${JSON.stringify(BTN)}).focus()`);
    const jumpFocus = await st();
    await press('Space');
    const ended = await waitFor('window.__spacer.active === false', 15000, 'Space on Exit').then(() => true, () => false);
    check('4 space: Space with the focus on the Exit button presses it (Spacer ends) and does not jump', ended && jumpFocus.jump.active === false);
    await backAsItWas('4 space (after Exit)', pre);

  });
  await sec('6b first jump', async () => {
    await ensureOff();
    // 6b. the first Space after a click on the button jumps (the button gave up the focus)
    await tapSel(BTN);
    await waitFor('window.__spacer.active === true', 60000);
    await ev('window.__spacer.manualClock(true)');
    await place(2.5, 1.5, 0);
    const focusTag = await ev(`document.activeElement ? document.activeElement.tagName : null`);
    await press('Space');
    const first = await st();
    check('6b: after a click on the button the first Space jumps (the focus is on BODY, not on the button)', focusTag === 'BODY' && first.jump.active === true && first.active === true, `focus ${focusTag}, jump ${first.jump.active}`);
    await ev('window.__spacer.advanceTime(800)');

  });
  await sec('5 moods', async () => {
    await ensureWalking();
    // 5. moods and time
    const m0 = await view(), pic5a = await grab();
    await press('3');
    await frameAfter(2); await sleep(400);
    const m1 = await view(), pic5b = await grab();
    check('5 moods: the key 3 picks the third mood (Night) and the picture changes', m0.preset !== 'lamplit' && m1.preset === 'lamplit' && changed(pic5a, pic5b) > 20000, `${m0.preset} to ${m1.preset}, ${changed(pic5a, pic5b)} pixels changed`);
    await shot('5-night');
    await press('1'); await frameAfter(1);
    check('5 moods: the key 1 picks Day again', (await view()).preset === 'clear');
    const tBefore = (await view()).t, yawBefore = (await st()).cam.yaw;
    await press('ArrowRight', ['Shift']); await sleep(400);
    const tAfter = (await view()).t;
    check('5 moods: Shift with the right arrow does NOT move the time of day in Spacer (it runs and turns)', near(tAfter, tBefore, 1e-9) && (await st()).active, `time ${f3(tBefore)} to ${f3(tAfter)}`);
    await press('ArrowLeft', ['Shift']); await sleep(300);
    check('5 moods: Shift with the left arrow does not either', near((await view()).t, tBefore, 1e-9) && yawBefore !== undefined);
    // the page's own handler of the time of day (main.js) is the second line behind Spacer, which takes these keys by their code: sent by key alone they pass Spacer and reach it
    await keyOnlyShiftArrow('ArrowRight'); await sleep(400); const tCodeR = (await view()).t; // read after each arrow: the right one and the left one are a step each way, so after both the time would be where it began
    await keyOnlyShiftArrow('ArrowLeft'); await sleep(400); const tCodeL = (await view()).t;
    check('5 moods: Shift with an arrow sent as a key with no code does NOT move the time of day in Spacer either (the page\'s own handler stands down while it walks)', near(tCodeR, tBefore, 1e-9) && near(tCodeL, tBefore, 1e-9) && (await st()).active, `time ${f3(tBefore)}, after the right arrow ${f3(tCodeR)}, after the left ${f3(tCodeL)}`);

  });
  await sec('7 mouse', async () => {
    await ensureWalking();
    // 7. the mouse under a (simulated) pointer lock
    await ev('window.__lock.allow = true');
    const asks0 = await ev('window.__lockAsks');
    await mouseClick(W / 2, H * 0.45);
    await sleep(300);
    const locked = await ev('!!document.pointerLockElement');
    check('7 mouse: a click on the picture asks for the pointer lock, and the lock is taken', (await ev('window.__lockAsks')) === asks0 + 1 && locked, `asks ${asks0} to ${await ev('window.__lockAsks')}, locked ${locked}`);
    await frameAfter(2);
    check('7 mouse: with the mouse taken the hint at the bottom goes', !(await rectOf('#ps-walk-hint')).shown);
    const look = (mx, my) => ev(`document.dispatchEvent(new MouseEvent('mousemove', { movementX: ${mx}, movementY: ${my}, bubbles: true }))`);
    await place(2.5, 1.5, 0, 0);
    let l0 = await st(); await look(100, 0); let l1 = await st();
    check('7 mouse: 100 px to the right turn the head 0.22 rad (12.61 degrees, 0.0022 per px) to the right', near(wrapDeg(l1.cam.yaw - l0.cam.yaw), 12.607, 0.01) && near(l1.cam.pitch, l0.cam.pitch, 0.001), `yaw ${f3(l0.cam.yaw)} to ${f3(l1.cam.yaw)}`);
    l0 = l1; await look(-100, 0); l1 = await st();
    check('7 mouse: 100 px to the left turn it back', near(wrapDeg(l0.cam.yaw - l1.cam.yaw), 12.607, 0.01), `yaw ${f3(l0.cam.yaw)} to ${f3(l1.cam.yaw)}`);
    l0 = l1; await look(0, -100); l1 = await st();
    check('7 mouse: 100 px up raise the head 12.61 degrees', near(l1.cam.pitch - l0.cam.pitch, 12.607, 0.01) && near(l1.cam.yaw, l0.cam.yaw, 0.001), `pitch ${f3(l0.cam.pitch)} to ${f3(l1.cam.pitch)}`);
    await look(0, -5000); const up = await st();
    check('7 mouse: looking up stops at 1.35 rad (77.35 degrees)', near(up.cam.pitch, 77.349, 0.01), `pitch ${f3(up.cam.pitch)}`);
    await look(0, 9000); const down = await st();
    check('7 mouse: looking down stops at -1.35 rad', near(down.cam.pitch, -77.349, 0.01), `pitch ${f3(down.cam.pitch)}`);
    await ev('window.__lock.on = false; document.dispatchEvent(new Event("pointerlockchange"))'); await sleep(200);
    const free0 = await st(); await look(300, -300); const free1 = await st();
    await frameAfter(2);
    check('7 mouse: without the lock the mouse does not look around, and the hint comes back', free1.cam.yaw === free0.cam.yaw && free1.cam.pitch === free0.cam.pitch && (await rectOf('#ps-walk-hint')).shown);
    await ev('window.__lock.on = true; document.dispatchEvent(new Event("pointerlockchange"))'); await sleep(200);
    await tapSel(BTN);
    await waitFor('window.__spacer.active === false', 15000, 'Exit with the lock on').catch(() => {});
    check('7 mouse: Exit lets go of the pointer lock', (await ev('window.__spacer.active')) === false && (await ev('!document.pointerLockElement')));
    await ev('window.__lock.allow = false');

  });
  await sec('6 escape', async () => {
    await ensureOff(); await ev('window.__lock.allow = false; window.__lock.on = false');
    // 6. Escape: one press ends it, everything is as before (a door is shut when it ends, the mood and the angle were changed in the walk)
    await tapSel(BTN);
    await waitFor('window.__spacer.active === true', 60000);
    await ev('window.__spacer.manualClock(true)');
    await press('3'); await frameAfter(1);
    await place(1.05, 3.9, -90);
    await press('Space');
    const shutNow = await ev('window.__spacer.advanceTime(500)');
    await press('Escape');
    const esc = await waitFor('window.__spacer.active === false', 15000, 'Escape').then(() => true, () => false);
    check('6 escape: one Escape ends Spacer (a door was shut, the mood Night)', esc && shutNow.doors.find((d) => d.id === 'd-hall-living').open === false);
    await backAsItWas('6 escape', pre);
    await shot('6-back');
  });
  await noStorage();
}

// ---------- scene B: the address ----------
async function sceneB() {
  await open('walk=1&lang=en&q=low');
  const s = await st(), ctl = await controls(), map = await rectOf('#ps-walk-map'), intro = await ev(`({ el: !!document.getElementById('ps-intro'), state: window.__intro ? window.__intro.state : null })`);
  check('B: walk=1 opens inside Spacer at once, with no intro', s.active === true && !intro.el && (intro.state === 'off' || intro.state === 'done'), `active ${s.active}, intro ${JSON.stringify(intro)}`);
  check('B: walk=1: the bar is the walking bar and the map is up', JSON.stringify([...ctl].sort()) === JSON.stringify(['mood:amber', 'mood:clear', 'mood:lamplit', 'tool:spacer']) && !!map && map.shown, ctl.join(' '));
  await shot('B-walk1');
  await noStorage();
  await open('walk=0&lang=en&q=low&live=1');
  check('B: walk=0 takes the Spacer button away', (await ev(`!document.querySelector(${JSON.stringify(BTN)})`)) && (await st()).active === false, '');
  await noStorage();
  await open('edit=1&lang=en&q=low&live=1');
  const hidden = await ev(`(() => { const b = document.querySelector(${JSON.stringify(BTN)}); if (!b) return true; const r = b.getBoundingClientRect(); return getComputedStyle(b).display === 'none' || r.width === 0; })()`);
  const refused = await ev(`window.__spacer.enter()`), after = await st();
  check('B: edit=1 has no Spacer button, and enter() refuses with a reason', hidden && refused === false && after.active === false && after.denied === 'edit', `hidden ${hidden}, enter() ${refused}, denied "${after.denied}"`);
  await noStorage();
  // the word in the doorway in Polish (scene A reads it in English)
  await open('walk=1&plan=flat-1&lang=pl&q=low');
  await ev('window.__spacer.manualClock(true)');
  await place(1.05, 3.0, -90);
  const p = await spaceAnd();
  check('B: in the doorway of a page in Polish the word reads "Wyjdź z progu, żeby zamknąć drzwi" and the door stays open', p.notice === 'doorway' && p.text === 'Wyjdź z progu, żeby zamknąć drzwi' && p.hidden === false && p.doors.every((d) => d[1]), `notice ${p.notice}, hint "${p.text}", doors open ${p.doors.map((d) => d[1]).join(',')}`);
  await shot('B-doorway-pl');
  await noStorage();
}

// ---------- scene C: the duplex, the stairs ----------
async function sceneC() {
  await open('plan=duplex-1&lang=en&q=low&live=1');
  const f = await frames();
  await ev('window.__spacer.enter()');
  await waitFor('window.__spacer.active === true', 60000);
  await waitFor(`window.__frames > ${f}`, 60000);
  await ev('window.__spacer.manualClock(true)');
  const first = await st();
  check('C: the start of the duplex hall is (1.2, 1.7) within 0.05 m, on the ground floor (the rule about the leaf of a door moved nothing)', near(first.cam.x, 1.2, 0.05) && near(first.cam.z, 1.7, 0.05) && first.level === 'L0', `x ${f3(first.cam.x)}, z ${f3(first.cam.z)}, yaw ${f2(first.cam.yaw)}, level ${first.level}`);
  const floorsBox = await rectOf('#ps-ui .floors'), plansBox = await rectOf('#ps-ui .plans');
  await ev(`window.__floors.set('0')`); await sleep(300);
  check('C: the floor and the plan buttons are out of the way in Spacer, and the floor switch does nothing', (!floorsBox || !floorsBox.shown) && (!plansBox || !plansBox.shown) && (await ev(`String(window.__floors.get())`)) === 'all' && (await st()).active, `floors ${floorsBox ? floorsBox.shown : 'none'}, plans ${plansBox ? plansBox.shown : 'none'}, floor "${await ev(`String(window.__floors.get())`)}"`);
  await place(1.1, 5.7, -90, 0, 'L0');
  let prev = await st();
  const start = prev;
  let worst = 0, switched = null, n = 0;
  for (; n < 40; n++) {
    const s = await hold(['W'], 120);
    worst = Math.max(worst, Math.abs(s.cam.y - prev.cam.y));
    if (s.level !== prev.level && switched === null) switched = { n, from: prev.cam.y, to: s.cam.y };
    prev = s;
    if (s.level === 'L1' && s.cam.y > 4.3 && n > 10) break;
  }
  check('C: W up the stairs: the level changes to the upper floor and the eyes rise', prev.level === 'L1' && prev.cam.y > start.cam.y + 2.5 && prev.cam.z < start.cam.z - 2, `${start.level} y ${f2(start.cam.y)} to ${prev.level} y ${f2(prev.cam.y)} in ${n + 1} steps of 0.12 s, z ${f2(start.cam.z)} to ${f2(prev.cam.z)}`);
  check('C: the eyes never jump more than 0.3 m in a step of 0.12 s (a walk up is 0.17 m), also where the level changes', worst < 0.3, `largest step ${f3(worst)} m${switched ? `, the level changed at step ${switched.n} (${f3(switched.from)} to ${f3(switched.to)})` : ''}`);
  await frameAfter(2); await sleep(300);
  await shot('C-upstairs');
  check('C: no error on the way', !(await ev('!!window.__fail')));
  await noStorage();
}

// ---------- scene P: the phone ----------
async function sceneP() {
  await open('plan=flat-1&lang=pl&q=low&live=1');
  const coarse = await ev(`matchMedia('(pointer: coarse)').matches`);
  check('P: the window is a touch screen (pointer: coarse, touch points)', coarse && (await ev('navigator.maxTouchPoints')) > 0, `coarse ${coarse}, touch points ${await ev('navigator.maxTouchPoints')}`);
  const pre = await snapshotBefore();
  const lockAsks0 = await ev('window.__lockAsks');

  // 10. the touch click
  // The two zones and the hint are due for 4 s of the wall clock (performance.now) and go at the first frame that starts after that. A frame takes seconds on this renderer, and so does an
  // evaluate from here while one is on, so the time is read by the page itself: an observer writes down when the zones came and went, and a recorder of animation frames shows how far apart
  // the frames were around the fourth second.
  await ev(`(() => { window.__zoneLog = []; window.__raf = []; let on = false;
    new MutationObserver(() => { const z = document.getElementById('ps-walk-zones'), now = !!(z && z.classList.contains('on')); if (now !== on) { on = now; window.__zoneLog.push({ on, t: performance.now(), frames: window.__frames }); } })
      .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const tick = (t) => { window.__raf.push(t); if (window.__zoneLog.length < 2 && window.__raf.length < 6000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
  const f0 = await frames(), t0 = Date.now();
  const tapped = await tapSel(BTN);
  await waitFor('window.__spacer.active === true', 90000, 'Spacer to begin');
  await waitFor(`window.__frames > ${f0}`, 60000);
  const sEnt = await st();
  const zonesOn = await ev(`!!document.querySelector('#ps-walk-zones.on')`), zoneWords = await ev(`[...document.querySelectorAll('#ps-walk-zones span')].map((n) => n.textContent)`);
  const hintOn = await rectOf('#ps-walk-hint'), hintTxt = await ev(`(document.getElementById('ps-walk-hint') || {}).textContent ?? ''`);
  const tShown = Date.now() - t0;
  check('10 touch: a touch on the button begins Spacer; the bar keeps the moods and Exit only; the focus is on BODY', tapped && sEnt.active && (await controls()).filter((c) => !c.startsWith('mood:')).join() === 'tool:spacer' && (await ev(`document.activeElement.tagName`)) === 'BODY', `controls ${(await controls()).join(' ')}`);
  check('10 touch: the start is (1.0, 4.5) within 0.05 m and the first-visit hint of the page is gone', near(sEnt.cam.x, 1.0, 0.05) && near(sEnt.cam.z, 4.5, 0.05) && !(await ev(`!!document.getElementById('ps-hint')`)), `x ${f3(sEnt.cam.x)}, z ${f3(sEnt.cam.z)}`);
  check('10 touch: the two zones "Idź" and "Rozglądaj się" and the hint are on the picture', zonesOn && zoneWords.join('|') === 'Idź|Rozglądaj się' && hintOn.shown && /Lewa połowa/.test(hintTxt), `zones ${zonesOn} (${zoneWords.join(' / ')}), hint "${hintTxt}", ${tShown} ms after the touch`);
  await shot('10-zones');
  const mapR = await rectOf('#ps-walk-map'), barR = await rectOf('#ps-ui'), exitR = await rectOf(BTN), verR = await rectOf('#ps-version');
  const inter = (a, b) => !!a && !!b && a.shown !== false && b.shown !== false && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  check('10 touch: the map is small (112 px), inside the window, and clear of the bar, the Exit button and the version mark', near(mapR.w, 112, 1) && near(mapR.h, 112, 1) && mapR.x >= 0 && mapR.r <= W && mapR.y >= 0 && !inter(mapR, barR) && !inter(mapR, exitR) && !inter(mapR, verR),
    `map ${f2(mapR.x)},${f2(mapR.y)}..${f2(mapR.r)},${f2(mapR.b)} (${f2(mapR.w)}x${f2(mapR.h)}); bar from y ${f2(barR.y)}; exit ${f2(exitR.x)},${f2(exitR.y)}..${f2(exitR.r)},${f2(exitR.b)}; version ${verR ? f2(verR.x) + ',' + f2(verR.y) : 'none'}`);
  const goneAt = await waitFor(`window.__zoneLog.length >= 2 ? window.__zoneLog : null`, 90000, 'the zones to go').catch(() => null);
  const hintGone = await waitFor(`document.getElementById('ps-walk-hint').hidden`, 30000).then(() => true, () => false);
  if (goneAt) {
    const raf = await ev('window.__raf'), tOn = goneAt[0].t, tOff = goneAt[1].t, held = tOff - tOn;
    let gap = 0; for (let i = 1; i < raf.length; i++) if (raf[i - 1] <= tOn + 4000 && raf[i] >= tOn + 4000) gap = raf[i] - raf[i - 1]; // the frames on either side of the fourth second
    // the page counts from the moment Spacer begins (a few ms before the zones show), so a little under 4 s is fine; the zones go at the first frame after the fourth second, so at most one gap of frames over it
    check('10 touch: the zones and the hint go after 4 s of the WALL clock, at the first frame after that (the page\'s own timestamps: held 3.9 s up to 4 s plus the gap of the frames there)', held >= 3900 && held <= 4000 + gap + 400 && hintGone, `zones held ${Math.round(held)} ms (frames ${goneAt[0].frames} to ${goneAt[1].frames}), the frames around the 4th second were ${Math.round(gap)} ms apart, ${raf.length} frames recorded, hint hidden ${hintGone}`);
  } else check('10 touch: the zones and the hint go after 4 s of the wall clock', false, 'the zones did not go within 90 s');

  // 11. touch walking and looking
  await ev('window.__spacer.manualClock(true)');
  await place(2.5, 1.5, 0);
  const atLeft = await ev(`(() => { const e = document.elementFromPoint(100, 380), c = document.querySelector('canvas:not(#ps-walk-map)'); return e === c; })()`);
  let s0 = await st();
  await fingersDown([[100, 380, 1]]); await fingersMove([[100, 380, 1]], [[100, 320, 1]]);
  let s1 = await ev('window.__spacer.advanceTime(500)');
  check('11 touch: one finger dragged 60 px up on the left half walks forward at full speed (0.70 m in 0.5 s)', atLeft && near(s1.cam.x - s0.cam.x, 0.7, 0.04) && near(s1.cam.z, s0.cam.z, 0.02), `moved ${f3(s1.cam.x - s0.cam.x)} along x, ${f3(s1.cam.z - s0.cam.z)} across, yaw ${f2(s1.cam.yaw)} (the finger on the canvas: ${atLeft})`);
  await fingersUp();
  s0 = await ev('window.__spacer.advanceTime(10)'); s1 = await ev('window.__spacer.advanceTime(600)');
  check('11 touch: lifting the finger stops the walk', dist2(s0, s1) < 0.001, `moved ${f3(dist2(s0, s1))} m in 0.6 s`);
  await place(2.5, 1.5, 0);
  s0 = await st(); await fingersDown([[100, 380, 1]]); await fingersMove([[100, 380, 1]], [[100, 350, 1]]);
  s1 = await ev('window.__spacer.advanceTime(500)'); await fingersUp();
  check('11 touch: a drag of 30 px is half speed (0.35 m in 0.5 s)', near(s1.cam.x - s0.cam.x, 0.35, 0.03), `moved ${f3(s1.cam.x - s0.cam.x)}`);
  await place(2.5, 1.5, 0, 0);
  s0 = await st(); await fingersDown([[250, 380, 2]]); await fingersMove([[250, 380, 2]], [[350, 330, 2]]);
  s1 = await st(); await fingersUp();
  check('11 touch: one finger dragged 100 px right and 50 px up on the right half looks around: yaw +28.65 degrees, pitch +14.32 degrees (0.005 rad per px), and the walker stays', near(wrapDeg(s1.cam.yaw - s0.cam.yaw), 28.648, 0.1) && near(s1.cam.pitch - s0.cam.pitch, 14.324, 0.1) && dist2(s0, s1) < 0.001, `yaw ${f2(s0.cam.yaw)} to ${f2(s1.cam.yaw)}, pitch ${f2(s0.cam.pitch)} to ${f2(s1.cam.pitch)}`);
  await shot('11-look');
  await place(2.5, 1.5, 0, 0);
  s0 = await st(); await fingersDown([[100, 400, 1], [290, 400, 2]]); await fingersMove([[100, 400, 1], [290, 400, 2]], [[100, 340, 1], [350, 400, 2]]);
  s1 = await ev('window.__spacer.advanceTime(500)'); await fingersUp();
  const heading = (Math.atan2(s1.cam.z - s0.cam.z, s1.cam.x - s0.cam.x) * 180) / Math.PI;
  check('11 touch: two fingers at once (one per half) walk and look together: yaw +17.19 degrees, 0.70 m along the new heading', near(wrapDeg(s1.cam.yaw - s0.cam.yaw), 17.189, 0.1) && near(dist2(s0, s1), 0.7, 0.04) && near(wrapDeg(heading - s1.cam.yaw), 0, 2), `yaw ${f2(s0.cam.yaw)} to ${f2(s1.cam.yaw)}, moved ${f3(dist2(s0, s1))} m heading ${f2(heading)}`);
  check('11 touch: a touch never asks for the mouse (no pointer lock request)', (await ev('window.__lockAsks')) === lockAsks0, `asks ${lockAsks0} to ${await ev('window.__lockAsks')}`);

  // 12. Exit by touch
  await tapSel(BTN);
  await backAsItWas('12 exit', pre);
  await shot('12-back');
  await noStorage();
}

// ---------- run ----------
async function scene(name, fn) {
  if (only && !only.includes(name)) return;
  console.log(`-- scene ${name} (${tag})`);
  try { await fn(); } catch (e) { check(`scene ${name} ran to the end`, false, e.message); }
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
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'assert')) logs.push(`console.${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
    if (d.method === 'Network.requestWillBeSent') requests.add(d.params.request.url);
    if (d.method === 'Network.webSocketCreated') requests.add(`ws: ${d.params.url}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: phone });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const timer = setTimeout(async () => { console.error(`FAIL timeout after ${opt.timeout} s`); await cleanup(); process.exit(1); }, Number(opt.timeout) * 1000);
  if (phone) await scene('P', sceneP);
  else { await scene('A', sceneA); await scene('B', sceneB); await scene('C', sceneC); }
  clearTimeout(timer);
  const foreign = [...requests].filter((u) => !(u.startsWith(ownOrigin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank'));
  check('the page made no request of its own to anywhere else', foreign.length === 0, foreign.slice(0, 3).join(' '));
  check('nothing was written to storage (local, session, cookie, indexed databases)', storageHit === null, storageHit ?? '');
  check('no script error or console error', logs.length === 0, logs.slice(0, 3).join(' | '));
} catch (e) {
  check('the check ran to the end', false, e.message);
}
await cleanup();
const failed = steps.filter((s) => !s.ok).length;
console.log(`${failed ? 'FAIL' : 'PASS'}: ${steps.length - failed} of ${steps.length} steps (${tag})`);
process.exit(failed ? 1 : 0);
