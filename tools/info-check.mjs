// Click-through of the card of a tapped piece and of the list of rooms in a real browser (headless Chrome, software GL), with real mouse or touch events: a tap on a piece opens the card (name,
// room, size in millimetres) and outlines the piece, the model still turns and the double tap still takes the view back, a tap on nothing, the close button and Escape take the card away, the Rooms button
// opens the list with the areas (one total, a heading per floor on a duplex, the floors on show only), a row outlines its room, the language and the plan change what both say, the shell
// opens with the card still tappable, rooms=1 opens the list at start, ui=0 and edit=1 build none of it and the editor still selects a piece by a tap, and the page makes no request of its own.
//   node tools/info-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout 240] [--phone | --small]
// --small (a touch window as --phone) runs only the check of small and low windows: the card and the list open together and end above the control bar, the Rooms button stays free.
// On a small machine run it under tools/chrome-lock.sh (one browser at a time). CHROME names the browser (chrome-headless-shell is fine). Exits 1 when a step fails.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { html: null, out: null, timeout: 240 };
let phone = false, small = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--phone') phone = true;
  else if (argv[i] === '--small') { phone = true; small = true; }
  else if (argv[i].startsWith('--') && argv[i].slice(2) in opt && argv[i + 1] !== undefined) opt[argv[i].slice(2)] = argv[++i];
  else { console.error('usage: node tools/info-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout S] [--phone | --small]'); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = /^https?:\/\//i.test(opt.html ?? '');
const page = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const ownOrigin = live ? new URL(opt.html).origin : 'file://';
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });
const W = phone ? 390 : 1100, H = phone ? 844 : 760, tag = small ? 'small' : phone ? 'phone' : 'desktop', PTR = phone ? 'touch' : 'mouse';
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-info-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--use-gl=angle', `--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map(), logs = [], requests = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const cleanup = async () => { try { ws?.close(); } catch { /* closed */ } chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

const steps = [];
const check = (name, ok, detail = '') => { steps.push({ name, ok: !!ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` | ${String(detail).slice(0, 300)}` : ''}`); };
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const waitFor = async (expression, ms = 20000, label = expression) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expression); if (v) return v; } catch { /* the page is busy */ } await sleep(200); }
  throw new Error(`timed out waiting for ${label}`);
};
const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${tag}-${name}.png`), Buffer.from(r.data, 'base64')); };

// real input: a mouse click or a touch tap at a client point, a drag, a key
const mouseTap = async (x, y, o = {}) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: o.modifiers ?? 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: o.button ?? 'left', buttons: o.button === 'right' ? 2 : 1, clickCount: 1, modifiers: o.modifiers ?? 0 }); await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: o.button ?? 'left', buttons: 0, clickCount: 1, modifiers: o.modifiers ?? 0 }); await sleep(o.settle ?? 200);
};
// The touch and the lift go out together, as in doubleTap: the page counts a tap only when the lift comes within 350 ms of the touch (as the camera does for its double tap), and on the
// software renderer the frames just after a load are so slow that, with a wait of 60 ms between the two events, the page saw the lift 1025 ms after the touch with no stall of its own thread
// (this check printed it on the first tap of the English run, three runs in a row): no tap, no card. A phone with a graphics chip draws a frame in 16 ms and never sees that.
const touchTap = async (x, y, o = {}) => {
  await Promise.all([send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }), send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })]);
  await sleep(o.settle ?? 250);
};
const tap = (x, y, o) => (phone ? touchTap(x, y, o) : mouseTap(x, y, o));
const drag = async (x0, y0, x1, y1, n = 8) => {
  const at = (k) => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n];
  if (phone) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(30); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= n; k++) { const [x, y] = at(k); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(500);
};
// Two taps queued back to back (the browser handles them one after the other, so a page that is slow to draw still sees them closer than the 350 ms of a double tap)
const doubleTap = async (x, y) => {
  if (phone) {
    const down = { type: 'touchStart', touchPoints: [{ x, y }] }, up = { type: 'touchEnd', touchPoints: [] };
    await Promise.all([down, up, down, up].map((e) => send('Input.dispatchTouchEvent', e)));
  } else {
    const ev1 = (type, n) => ({ type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: n });
    await Promise.all([{ type: 'mouseMoved', x, y }, ev1('mousePressed', 1), ev1('mouseReleased', 1), ev1('mousePressed', 2), ev1('mouseReleased', 2)].map((e) => send('Input.dispatchMouseEvent', e)));
  }
  await sleep(900);
};
const pressKey = async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(250); };

const rectOf = (sel) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return null; const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
  return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: !n.hidden && cs.display !== 'none' && r.width > 0 }; })()`);
const tapSel = async (sel, o) => { const r = await rectOf(sel); if (!r || !r.shown) return false; await tap(r.x + r.w / 2, r.y + r.h / 2, o); return true; };
const cam = () => ev(`({ az: window.__camera.azimuth, pol: window.__camera.polar, dist: window.__camera.distance })`);
const sameCam = (a, b) => Math.abs(a.az - b.az) < 1e-6 && Math.abs(a.pol - b.pol) < 1e-6 && Math.abs(a.dist - b.dist) < 1e-6;
const texts = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((n) => n.textContent.trim().replace(/\\s+/g, ' '))`);
const inside = (r) => r && r.x >= 0 && r.y >= 0 && r.r <= W + 1 && r.b <= H + 1;
const dockTop = async () => parseFloat(await ev(`getComputedStyle(document.documentElement).getPropertyValue('--psd-top')`)) || 10; // where the dock starts on a narrow window: 10 px, or more on a page with marks of its own in the corner
const overlap = (a, b) => a.shown && b.shown && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

// A piece that can be tapped now: not hidden by the cutaway, drawn on the picture (not under a bar, the card or the list), and the one that a tap there finds.
const findPiece = async (o = {}) => JSON.parse(await ev(`(() => {
  const I = window.__info, canvas = document.querySelector('canvas'), want = ${JSON.stringify(o)};
  const list = I.pieces().filter((p) => !p.hidden && (!want.level || p.level === want.level) && (!want.types || want.types.includes(p.type)) && (!want.skip || !want.skip.includes(p.id)));
  list.sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]);
  for (const p of list) {
    const s = I.screenOf(p.id); if (!s) continue;
    if (s.x < 30 || s.x > innerWidth - 30 || s.y < 30 || s.y > innerHeight - 30) continue;
    if (want.avoid && s.x > want.avoid.x - 12 && s.x < want.avoid.r + 12 && s.y > want.avoid.y - 12 && s.y < want.avoid.b + 12) continue; // under where the card of the first tap stands: the second tap of a double tap would land on the card
    if (document.elementFromPoint(s.x, s.y) !== canvas) continue;
    if (I.hit(s.x, s.y, ${JSON.stringify(PTR)}) !== p.id) continue;
    return JSON.stringify({ id: p.id, type: p.type, level: p.level, size: p.size, x: s.x, y: s.y });
  }
  return JSON.stringify(null);
})()`));
// a point of the picture where nothing is: not on a piece, not under anything of the page
const findEmpty = async () => JSON.parse(await ev(`(() => {
  const I = window.__info, canvas = document.querySelector('canvas');
  for (const [fx, fy] of [[0.08, 0.5], [0.92, 0.5], [0.5, 0.06], [0.1, 0.3], [0.9, 0.3], [0.05, 0.65], [0.95, 0.65]]) {
    const x = innerWidth * fx, y = innerHeight * fy;
    if (document.elementFromPoint(x, y) === canvas && I.hit(x, y, ${JSON.stringify(PTR)}) === null) return JSON.stringify({ x, y });
  }
  return JSON.stringify(null);
})()`));

async function open(hash, ready = `!!window.__info || !!window.__edit`) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300); // a change of the part after # alone would not reload the page
  await send('Page.navigate', { url: `${page}#${hash}` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`, 60000, 'the page');
  await waitFor(ready, 60000, 'the hooks of the page');
  await sleep(1200);
  await waitFor('!window.__camera || window.__camera.busy === false', 20000).catch(() => {}); // the first tap of a check is not a race with the camera still settling on its first view
}

async function plainPage(lang) {
  const L = lang === 'pl' ? { rooms: 'Pokoje', total: 'Razem', area: '13,4 m²', dim: ['szer.', 'głęb.', 'wys.'] } : { rooms: 'Rooms', total: 'Total', area: '13.4 m²', dim: ['width', 'depth', 'height'] };
  await open(`lang=${lang}&q=low&live=1`);
  check(`${lang}: the plain page has the hooks of the card, none of the editor, and no editor sheet`, await ev(`!!window.__info && !window.__edit && !document.querySelector('.psp-root') && !!document.getElementById('ps-dock')`));
  const btn = await ev(`(() => { const b = document.querySelector('#ps-ui button.tool[data-tool="rooms"]'); return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed') } : null; })()`);
  check(`${lang}: the Rooms button is in the bar, not pressed, and the card and the list are hidden`, btn && btn.text === L.rooms && btn.pressed === 'false' && !(await rectOf('#ps-piece-card')).shown && !(await rectOf('#ps-rooms')).shown, JSON.stringify(btn));
  const home = await cam();

  // the card
  const p = await findPiece();
  check(`${lang}: a piece can be tapped on the picture`, !!p, p ? `${p.type} at ${Math.round(p.x)},${Math.round(p.y)}` : 'none found');
  if (!p) throw new Error('no piece to tap');
  // what the page sees of this first tap, for the line of the step below: the time between its touch and its lift (a tap is under 350 ms) and the stalls of its main thread (a stall between the two stretches the tap)
  await ev(`(() => { const L = window.__tapLog = { ev: [], long: [] }; for (const t of ['pointerdown', 'pointerup']) addEventListener(t, () => L.ev.push([t, Math.round(performance.now())]), true);
    try { new PerformanceObserver((l) => { for (const x of l.getEntries()) L.long.push([Math.round(x.startTime), Math.round(x.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch { /* a browser with no long task entries */ } return true; })()`);
  await tap(p.x, p.y);
  const seen = await ev(`(() => { const L = window.__tapLog, d = L.ev.find((e) => e[0] === 'pointerdown'), u = L.ev.find((e) => e[0] === 'pointerup');
    return d && u ? 'the page saw ' + Math.round(u[1] - d[1]) + ' ms from touch to lift' + (L.long.length ? ', main thread stalls: ' + L.long.map((x) => x[1] + ' ms at ' + (x[0] - Math.round(d[1]))).join(', ') : ', no stall') : 'the page saw no ' + (d ? 'lift' : 'touch'); })()`);
  const card = await rectOf('#ps-piece-card');
  const info = await ev(`({ open: window.__info.cardOpen(), shown: window.__info.shown(), outline: window.__info.outlineOn(), title: document.querySelector('.psd-title').textContent, where: document.querySelector('.psd-where').textContent,
    labels: [...document.querySelectorAll('.psd-dim dt')].map((n) => n.textContent), values: [...document.querySelectorAll('.psd-dim dd')].map((n) => n.textContent), unit: document.querySelector('.psd-unit').textContent, aria: document.getElementById('ps-piece-card').getAttribute('aria-label') })`);
  check(`${lang}: a tap on a piece opens its card, outlines the piece and says what it is`, info.open && info.shown?.id === p.id && info.outline && info.title.length > 1, `${seen} | ${JSON.stringify(info).slice(0, 170)}`);
  check(`${lang}: the card gives the size in whole millimetres, width then depth then height`, JSON.stringify(info.values) === JSON.stringify(p.size.map((v) => String(Math.round(v * 1000)))) && JSON.stringify(info.labels) === JSON.stringify(L.dim) && info.unit === 'mm', `${info.values} ${info.labels}`);
  check(`${lang}: the card names the room`, info.where.length > 1 && info.aria.includes(info.title), `${info.where} | ${info.aria}`);
  check(`${lang}: the card is on the picture (${phone ? 'at the top, nearly the width of the window' : 'at the right'})`, inside(card) && (phone ? card.y < (await dockTop()) + 14 && card.w > W - 40 : card.r > W - 30 && card.w < 320), JSON.stringify(card));
  check(`${lang}: the tap did not move the view`, sameCam(home, await cam()));
  await shot(`${lang}-1-card`);

  // the model still turns; a drag is not a tap
  const empty = await findEmpty();
  check(`${lang}: there is empty picture to drag and tap`, !!empty);
  await drag(empty.x, empty.y, empty.x + 70, empty.y + 5);
  const turned = await cam();
  check(`${lang}: dragging the picture turns the model and leaves the card`, Math.abs(turned.az - home.az) > 0.5 && await ev(`window.__info.cardOpen()`), `${home.az} to ${turned.az}`);
  // a tap on nothing takes it away
  const empty2 = await findEmpty();
  await tap(empty2.x, empty2.y);
  check(`${lang}: a tap on nothing takes the card and the outline away`, await ev(`!window.__info.cardOpen() && !window.__info.outlineOn()`) && !(await rectOf('#ps-piece-card')).shown);

  // the close button, Escape
  const p2 = await findPiece();
  await tap(p2.x, p2.y);
  check(`${lang}: a piece opens its card again`, await ev(`window.__info.cardOpen()`));
  const closeRect = await rectOf('#ps-piece-card .psd-close');
  const closeOk = await tapSel('#ps-piece-card .psd-close');
  check(`${lang}: the close button closes it`, closeOk && await ev(`!window.__info.cardOpen()`), `button ${Math.round(closeRect.w)} x ${Math.round(closeRect.h)}`);
  check(`${lang}: the close button is a comfortable target (44 px)`, closeRect.w >= 43.5 && closeRect.h >= 43.5, `${closeRect.w} x ${closeRect.h}`);
  const p3 = await findPiece();
  await tap(p3.x, p3.y);
  await pressKey('Escape', 'Escape', 27);
  check(`${lang}: Escape closes it`, await ev(`!window.__info.cardOpen() && !window.__info.outlineOn()`));

  // the double tap that takes the view back goes on working, and does not toggle the card
  await ev(`window.__camera.set(window.__camera.azimuth + 40, window.__camera.polar)`); await sleep(500);
  await waitFor('window.__camera.busy === false', 15000).catch(() => {}); // a double tap that lands while the camera still moves to the view just set is a race of the check, not of the page
  const p4 = await findPiece({ avoid: card.shown ? { x: card.x, y: card.y, r: card.r, b: card.b } : undefined });
  const before = await cam();
  await doubleTap(p4.x, p4.y);
  const after = await cam();
  check(`${lang}: a double tap on a piece takes the view back (as before) and the card stays open once`, !sameCam(before, after) && Math.abs(after.az - home.az) < 0.5 && await ev(`window.__info.cardOpen() && window.__info.shown().id === ${JSON.stringify(p4.id)}`), `${before.az} to ${after.az} (home ${home.az})`);
  await waitFor('window.__camera.busy === false', 15000).catch(() => {});
  { const e4 = await findEmpty(); await tap(e4.x, e4.y); }
  if (await ev(`window.__info.cardOpen()`)) await tapSel('#ps-piece-card .psd-close'); // the steps below start with no card, whatever a slow software renderer made of that tap
  if (!phone) {
    // the right button and Shift with the left one move the view: they open no card
    const p5 = await findPiece();
    await mouseTap(p5.x, p5.y, { button: 'right' });
    check(`${lang}: the right button on a piece opens no card`, await ev(`!window.__info.cardOpen()`));
    await mouseTap(p5.x, p5.y, { modifiers: 8 });
    check(`${lang}: Shift with the left button on a piece opens no card`, await ev(`!window.__info.cardOpen()`));
  }

  // the list of rooms
  const opened = await tapSel('#ps-ui button.tool[data-tool="rooms"]');
  const list = await rectOf('#ps-rooms');
  const rows = await texts('.psd-row');
  check(`${lang}: the Rooms button opens the list, pressed`, opened && list.shown && await ev(`document.querySelector('#ps-ui button.tool[data-tool="rooms"]').getAttribute('aria-pressed') === 'true' && window.__info.roomsOpen()`), JSON.stringify(list));
  check(`${lang}: the list has the five rooms with their areas, and the total under them`, rows.length === 5 && rows[0].endsWith(L.area) && (await texts('.psd-total')).join('').includes(L.total) && (await texts('.psd-total')).join('').includes('42 m²'), `${rows.join(' | ')} | ${(await texts('.psd-total')).join('')}`);
  const rowRect = await rectOf('.psd-row');
  check(`${lang}: the list is on the picture (${phone ? 'at the top' : 'at the left'}) and a row is a comfortable target`, inside(list) && (phone ? list.y < (await dockTop()) + 80 && list.w > W - 40 : list.x < 24 && list.w < 320) && rowRect.h >= (phone ? 43.5 : 34), `${JSON.stringify(list)} row ${rowRect.h}`);
  if (phone) { const bar = await rectOf('#ps-ui'); check(`${lang}: the list stops above the control bar`, list.b <= bar.y + 1, `list bottom ${Math.round(list.b)}, bar top ${Math.round(bar.y)}`); }
  await shot(`${lang}-2-rooms`);
  await tapSel('.psd-row');
  check(`${lang}: a row outlines its room on the floor and is pressed`, await ev(`window.__info.roomOutlineOn() && document.querySelector('.psd-row').getAttribute('aria-pressed') === 'true' && !!window.__info.pickedRoom()`));
  await shot(`${lang}-3-room-outlined`);
  await tapSel('.psd-row');
  check(`${lang}: pressing it again lets go`, await ev(`!window.__info.roomOutlineOn() && document.querySelector('.psd-row').getAttribute('aria-pressed') === 'false'`));

  // card and list together
  await tapSel('.psd-row'); // a room is outlined while a piece is tapped
  const p6 = await findPiece();
  if (p6) {
    await tap(p6.x, p6.y);
    const c6 = await rectOf('#ps-piece-card'), l6 = await rectOf('#ps-rooms');
    check(`${lang}: the card and the list open together without covering each other`, c6.shown && l6.shown && !overlap(c6, l6) && inside(c6) && inside(l6), `${JSON.stringify(c6)} ${JSON.stringify(l6)}`);
    // a page with marks of its own in a corner (plandoll.com: the brand and the privacy button) keeps them clear of the card and the list
    const marks = JSON.parse(await ev(`JSON.stringify(['#pd-brand', '#pd-privacy'].map((s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { id: s, x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, shown: getComputedStyle(n).display !== 'none' && r.width > 0 }; }).filter(Boolean))`));
    check(`${lang}: the card and the list stay clear of the marks of the page (${marks.length} on this page)`, marks.every((m) => !overlap(c6, m) && !overlap(l6, m)), JSON.stringify(marks.map((m) => [m.id, Math.round(m.x), Math.round(m.y), Math.round(m.r), Math.round(m.b)])));
    if (phone) { const bar = await rectOf('#ps-ui'); check(`${lang}: both stop above the control bar`, l6.b <= bar.y + 1 && c6.b <= bar.y, `list bottom ${Math.round(l6.b)}, bar top ${Math.round(bar.y)}`); }
    await shot(`${lang}-4-card-and-list`);
    await tapSel('#ps-piece-card .psd-close');
  } else check(`${lang}: a piece is free to tap with the list open`, true, 'none outside the list; covered by the checks above');
  // closing the list lets go of the room
  await tapSel('.psd-row');
  await tapSel('#ps-rooms .psd-close');
  check(`${lang}: the close button of the list hides it, lets go of the room and un-presses the button`, await ev(`!window.__info.roomsOpen() && !window.__info.roomOutlineOn() && !window.__info.pickedRoom() && document.querySelector('#ps-ui button.tool[data-tool="rooms"]').getAttribute('aria-pressed') === 'false'`));
}

// Small and low windows (a phone smaller than the one above, a phone on its side). The page publishes the height of the control bar as --ps-stack-h (restack), and the dock ends above it:
// with the list and the card open together, both end above the bar, and the Rooms button is not under either. 320 x 568 is the smallest phone still in use: the bar alone takes most of
// its height, so only the page's own part (the height is published, the button is free) is held to account there, and the numbers are printed. A window lower than 480 px (a phone on its
// side: 844 x 390, 932 x 430) has the bar over nearly all of the picture, as the page always had it: no piece is free to tap there, and the dock cannot end above the bar, so it floats over it.
// What is held to account in such a window is that the list keeps its shape: inside the window, tall enough to read, its heading and its total inside its own box (squeezed to the few
// pixels above the bar, its text spilled out of the box), and the Rooms button free.
async function smallWindows() {
  const btn = '#ps-ui button.tool[data-tool="rooms"]';
  for (const [w, h, mode] of [[375, 667, 'above'], [360, 640, 'above'], [844, 390, 'low'], [932, 430, 'low'], [320, 568, 'print']]) {
    const strict = mode === 'above';
    const name = `${w}x${h}`;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await open('lang=en&q=low&live=1&rooms=1');
    let p = await findPiece();
    if (!p) { await tapSel(btn); p = await findPiece(); } // the open list hides part of the picture: close it, find a piece, open the list again below
    check(`${name}: a piece is free to tap${mode === 'low' ? ' (not asked of a window this low: the bar covers the picture)' : ''}`, !!p || !strict, p ? `${p.type} at ${Math.round(p.x)},${Math.round(p.y)}` : 'none found');
    if (p) await tap(p.x, p.y);
    if (!(await ev(`window.__info.roomsOpen()`))) await tapSel(btn);
    await sleep(400);
    const g = await ev(`(() => {
      const box = (s) => { const n = document.querySelector(s); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return r.width > 0 ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null; };
      const b = document.querySelector(${JSON.stringify(btn)}), br = b.getBoundingClientRect(), at = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      const body = box('.psd-body'), rows = [...document.querySelectorAll('.psd-row')].map((n) => { const r = n.getBoundingClientRect(); return { y: r.top, b: r.bottom }; });
      return { w: innerWidth, h: innerHeight, bar: box('#ps-ui'), card: box('#ps-piece-card'), list: box('#ps-rooms'), head: box('.psd-rooms-head'), total: box('.psd-total'), body, rows, free: at === b || b.contains(at), stack: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ps-stack-h')) || 0 };
    })()`);
    const num = (r) => (r ? `${Math.round(r.y)}..${Math.round(r.b)}` : 'hidden');
    const where = `window ${g.w}x${g.h}, bar from ${Math.round(g.bar.y)}, card ${num(g.card)}, list ${num(g.list)}`;
    check(`${name}: the page publishes the height of the control bar (--ps-stack-h)`, Math.abs(g.stack - Math.round(g.h - g.bar.y)) <= 1, `${g.stack} px; ${where}`);
    check(`${name}: the Rooms button is not under the card or the list`, g.free, where);
    check(`${name}: the list is open${p ? ' with the card' : ''}`, !!g.list && (!p || !!g.card), where);
    check(`${name}: the list ends above the control bar`, !g.list || g.list.b <= g.bar.y + 1 || !strict, where);
    check(`${name}: the card ends above the control bar`, !g.card || g.card.b <= g.bar.y + 1 || !strict, where);
    if (mode === 'low') {
      const L = g.list, inBox = (r) => !!L && !!r && r.y >= L.y - 1 && r.b <= L.b + 1;
      const rowsRead = L && g.body ? g.rows.filter((r) => r.y >= g.body.y - 1 && r.b <= g.body.b + 1).length : 0;
      check(`${name}: in a low window the list floats over the bar and keeps its shape (inside the window, 150 px or more, heading and total inside it, a row to read)`,
        !!L && L.y >= 0 && L.b <= g.h && L.b - L.y >= 150 && inBox(g.head) && inBox(g.total) && rowsRead >= 1, `${where}; list ${num(g.list)} of ${g.h}, head ${num(g.head)}, total ${num(g.total)}, rows in view ${rowsRead}`);
    }
    await shot(name);
  }
}

async function languageAndPlan() {
  await open('lang=en&q=low&live=1');
  await tapSel('#ps-ui button.tool[data-tool="rooms"]');
  const p = await findPiece();
  if (p) await tap(p.x, p.y);
  await tapSel('#ps-ui button.lang'); await sleep(500);
  const pl = await ev(`({ title: document.querySelector('.psd-rooms-title').textContent, total: document.querySelector('.psd-total').textContent, row: document.querySelector('.psd-row .psd-row-area').textContent,
    dims: [...document.querySelectorAll('.psd-dim dt')].map((n) => n.textContent), btn: document.querySelector('#ps-ui button.tool[data-tool="rooms"]').textContent })`);
  check('the language button redraws the list and the open card in place', pl.title === 'Pokoje' && pl.total.startsWith('Razem') && pl.row === '13,4 m²' && pl.btn === 'Pokoje' && (!p || pl.dims.join() === 'szer.,głęb.,wys.'), JSON.stringify(pl));
  await tapSel('#ps-ui button.lang'); await sleep(300);
  await tapSel('#ps-ui button[data-plan="duplex-1"]'); await sleep(1500);
  const duplex = await ev(`({ rows: document.querySelectorAll('.psd-row').length, heads: [...document.querySelectorAll('.psd-group-head')].map((n) => n.textContent.replace(/\\s+/g, ' ')), total: document.querySelector('.psd-total').textContent, card: window.__info.cardOpen(), outline: window.__info.outlineOn(), listOpen: window.__info.roomsOpen() })`);
  check('a new plan closes the card, keeps the list open and lists the new rooms with a heading per floor', duplex.rows === 8 && duplex.heads.length === 2 && /Ground floor/.test(duplex.heads[0]) && /Upper floor/.test(duplex.heads[1]) && duplex.total.includes('102.6') && !duplex.card && !duplex.outline && duplex.listOpen, JSON.stringify(duplex));
  await shot('5-duplex');
  // a card on the ground floor goes when that floor goes
  const down = await findPiece({ level: 'L0' });
  if (down) { await tap(down.x, down.y); check('a piece of the ground floor opens its card with the floor named', await ev(`window.__info.cardOpen() && /Ground floor/.test(document.querySelector('.psd-where').textContent)`), (await texts('.psd-where')).join()); }
  await tapSel('#ps-ui button[data-floor="1"]'); await sleep(1200);
  const up = await ev(`({ rows: document.querySelectorAll('.psd-row').length, heads: document.querySelectorAll('.psd-group-head').length, total: document.querySelector('.psd-total').textContent, card: window.__info.cardOpen(), outline: window.__info.outlineOn() })`);
  check('showing the upper floor only closes the card of a piece below and lists the four rooms upstairs with their total', up.rows === 4 && up.heads === 1 && up.total.includes('51.3') && (!down || (!up.card && !up.outline)), JSON.stringify(up));
  await tapSel('#ps-ui button[data-floor="all"]'); await sleep(1000);
  check('both floors back: the list has all eight rooms again', await ev(`document.querySelectorAll('.psd-row').length === 8`));
}

async function shellOpen() {
  await open('lang=en&q=low&live=1');
  await tapSel('#ps-ui button.tool[data-tool="shell"]');
  await waitFor(`window.__shell.mode === 'open'`, 40000, 'the shell to open').catch(() => {});
  await sleep(800);
  const mode = await ev(`window.__shell.mode`);
  const p = await findPiece();
  check('with the shell open a piece can still be tapped for its card', mode === 'open' && !!p, `shell ${mode}, piece ${p?.type}`);
  if (p) { await tap(p.x, p.y); check('and the card opens with the piece outlined', await ev(`window.__info.cardOpen() && window.__info.outlineOn() && window.__info.shown().id === ${JSON.stringify(p.id)}`)); await shot('6-shell-card'); }
  await tapSel('#ps-ui button.tool[data-tool="shell"]');
  await waitFor(`window.__shell.mode === 'closed'`, 40000, 'the shell to close').catch(() => {});
  await sleep(600);
  check('closing the shell leaves the page working (no script error)', await ev(`!window.__fail`));
}

async function otherModes() {
  await open('lang=en&q=low&live=1&rooms=1');
  const r = await ev(`({ open: window.__info.roomsOpen(), shown: !document.getElementById('ps-rooms').hidden, pressed: document.querySelector('#ps-ui button.tool[data-tool="rooms"]').getAttribute('aria-pressed') })`);
  check('rooms=1 opens the list at the start, with the button pressed', r.open && r.shown && r.pressed === 'true', JSON.stringify(r));
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await send('Page.navigate', { url: `${page}#lang=en&q=low&live=1&ui=0` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`, 60000, 'the page without controls'); await sleep(1500);
  check('ui=0 leaves the picture alone: no dock, no card hook, no bar', await ev(`!document.getElementById('ps-dock') && !window.__info && !document.getElementById('ps-ui')`));
  // the editor: no card, no dock, no button, and a tap still selects a piece
  await open('lang=en&q=low&live=1&edit=1', `!!window.__edit`);
  check('edit=1 builds neither the dock nor the card hook, and the Rooms button leaves the bar', await ev(`!document.getElementById('ps-dock') && !window.__info && getComputedStyle(document.querySelector('#ps-ui button.tool[data-tool="rooms"]')).display === 'none'`));
  const pick = JSON.parse(await ev(`(() => { const E = window.__edit, canvas = document.querySelector('canvas'); const layout = E.session.layout();
    for (const lv of layout.levels) for (const p of lv.pieces) { const s = E.screenOf(p.id); if (!s || s.x < 30 || s.x > innerWidth - 30 || s.y < 90 || s.y > innerHeight - 260) continue;
      if (document.elementFromPoint(s.x, s.y) !== canvas) continue; if (E.hit(s.x, s.y, ${JSON.stringify(PTR)}) !== p.id) continue; return JSON.stringify({ id: p.id, x: s.x, y: s.y }); }
    return JSON.stringify(null); })()`));
  if (pick) {
    await tap(pick.x, pick.y);
    check('in the editor a tap on a piece selects it (the card is not in the way)', await ev(`window.__edit.selectedId() === ${JSON.stringify(pick.id)}`));
    const before = JSON.parse(await ev(`JSON.stringify(window.__edit.session.pieceById(${JSON.stringify(pick.id)}))`));
    await drag(pick.x, pick.y, pick.x + 60, pick.y + 30, 10);
    const after = JSON.parse(await ev(`JSON.stringify(window.__edit.session.pieceById(${JSON.stringify(pick.id)}))`));
    check('and dragging that piece moves it', Math.hypot(after.x - before.x, after.y - before.y) > 0.05, `${before.x},${before.y} to ${after.x},${after.y}`);
    await shot('7-editor');
  } else check('in the editor a piece is free to tap', false, 'none found');
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
  if (phone) { await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  const timer = setTimeout(async () => { console.error(`FAIL timeout after ${opt.timeout} s`); await cleanup(); process.exit(1); }, Number(opt.timeout) * 1000);
  if (small) await smallWindows();
  else {
    await plainPage('en');
    await plainPage('pl');
    await languageAndPlan();
    await shellOpen();
    await otherModes();
  }
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
