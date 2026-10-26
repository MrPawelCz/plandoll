// Click-through of the share link in a real browser (headless Chrome, software GL, a desktop window with the mouse): a layout is edited in the page, Copy link is pressed,
// and the link must bring the same layout to a fresh page, through the Edit and Done reload and into a page of someone else; a link for a plan of your own opens that plan;
// broken, huge and hostile links open the page without them and say so, and nothing from a link ends up in the page as markup.
//   node tools/share-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout 240] [--quick]  (--quick: no editing, two hostile links; for a published address)
// On a small machine run it under tools/chrome-lock.sh (one browser at a time). CHROME names the browser (chrome-headless-shell is fine). Exits 1 when a step fails.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateRawSync, inflateSync } from 'node:zlib';
import { analyzePlan, modelOf } from '../src/core/validate.js';
import { buildModel } from '../src/model/geometry.js';
import { autoFurnish } from '../src/layout/index.js';
import { piecesImplemented } from '../src/furniture/index.js';
import { specOf } from '../src/furniture/specs.js';
import { serializeLayout } from '../src/editor/index.js';
import { readPlanText } from '../src/app/planfile.js';
import { encodeShare, decodeShare, packLayout, planForLink } from '../src/app/share.js';

const argv = process.argv.slice(2);
const opt = { html: null, out: null, timeout: 240, quick: false };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--quick') opt.quick = true;
  else if (argv[i].startsWith('--') && argv[i].slice(2) in opt && argv[i + 1] !== undefined) opt[argv[i].slice(2)] = argv[++i];
  else { console.error('usage: node tools/share-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout S] [--quick]'); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = /^https?:\/\//i.test(opt.html ?? ''); // a published address instead of the built file
const html = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const own = live ? new URL(opt.html).origin + '/' : null;
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });
const W = 1100, H = 760;
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const GL_FLAGS = ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-chrome-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--use-gl=angle', `--use-angle=${ANGLE}`, ...GL_FLAGS,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map(), logs = new Set(), requests = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const text = (a) => String(a.value ?? a.description ?? '').slice(0, 300);
const cleanup = async () => { try { ws?.close(); } catch {} chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

const steps = [];
let failed = false;
function record(name, ok, info = {}) {
  steps.push({ name, ok: !!ok, ...info });
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${Object.keys(info).length ? ` ${JSON.stringify(info).slice(0, 400)}` : ''}`);
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(text(r.exceptionDetails.exception ?? { value: r.exceptionDetails.text }));
  return r.result.value;
}
async function waitFor(expr, secs) {
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) { try { if (await ev(expr)) return true; } catch { /* the page is loading */ } await sleep(300); }
  return false;
}
const T = Number(opt.timeout);
// A fresh load of the page at an address (a blank page in between, so that a change of the hash alone never counts as a load).
async function load(hashOrUrl) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(250);
  await send('Page.navigate', { url: /^(file|https?):/.test(hashOrUrl) ? hashOrUrl : `${html}${hashOrUrl ? `#${hashOrUrl}` : ''}` });
  const ok = await waitFor('window.__done === true || !!window.__fail', T);
  const fail = await ev('window.__fail || null').catch(() => 'no page');
  return ok && !fail;
}
async function mouse(type, x, y, extra = {}) { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }); }
const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; })()`);
async function click(sel) {
  const r = await rectOf(sel);
  if (!r) throw new Error(`nothing to click at ${sel}`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y);
}
// The part of the screen above the controls (only the 3D picture), as base64 PNG.
async function picture(label) {
  const top = await ev(`Math.floor(Math.min(...['#ps-ui', '#ps-edit'].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? innerHeight)) - 4)`);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: W, height: Math.max(40, top), scale: 1 } });
  if (out) {
    writeFileSync(join(out, `${label}.png`), Buffer.from(shot.data, 'base64'));
    const full = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, fromSurface: true });
    writeFileSync(join(out, `${label}-full.jpg`), Buffer.from(full.data, 'base64'));
  }
  return shot.data;
}
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
// How far two screenshots are from each other, in blocks of 8 by 8 pixels (each block averaged): the renderer puts a little noise on every load (the soft shadows and the ambient
// occlusion are not the same pixel for pixel in two loads of one page), which the average takes out, while a piece that moved or a room that changed colour stays. maxBlock is the largest
// difference of one colour channel between two blocks (of 255); over8 is the share of blocks that differ by more than 8.
function diff(a, b) {
  const A = decodePng(a), B = decodePng(b), F = 8;
  if (A.w !== B.w || A.h !== B.h || A.bpp !== B.bpp) return { same: false, maxBlock: 255, over8: 1, why: 'the size differs' };
  const bw = Math.floor(A.w / F), bh = Math.floor(A.h / F);
  let maxBlock = 0, over = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      let sa = 0, sb = 0;
      for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) { const i = ((by * F + y) * A.w + bx * F + x) * A.bpp + k; sa += A.px[i]; sb += B.px[i]; }
      worst = Math.max(worst, Math.abs(sa - sb) / (F * F));
    }
    if (worst > maxBlock) maxBlock = worst;
    if (worst > 8) over++;
  }
  const over8 = +(over / (bw * bh)).toFixed(5);
  return { same: maxBlock <= 12 && over8 <= 0.002, maxBlock: +maxBlock.toFixed(1), over8 };
}
const shareOf = (link) => /[#&]share=([^&]+)/.exec(link)?.[1] ?? null;
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const plainValue = (obj) => `u1.${b64(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))}`;
function build(planText) {
  const plan = JSON.parse(planText);
  for (const lv of plan.levels) lv.furniture = [];
  const model = buildModel(modelOf(analyzePlan(plan)));
  return { model, layout: autoFurnish(model, { seed: 1, allowedTypes: piecesImplemented() }) };
}
const examplePlan = (name) => readFileSync(join(root, `examples/${name}.plan.json`), 'utf8');
const pageState = () => ev(`JSON.stringify({ done: window.__done === true, fail: window.__fail || null, pieces: window.__planInfo ? window.__planInfo().pieces : null, levels: window.__planInfo ? window.__planInfo().levels : null,
  notes: window.__share ? window.__share.notes : null, said: window.__share ? window.__share.said : null, line: (document.querySelector('#ps-ui-msg') || {}).textContent || '', editLine: (document.querySelector('#ps-edit-msg') || {}).textContent || '', hash: location.hash.slice(0, 120),
  pressedPlans: document.querySelectorAll('#ps-ui .tool.plan[aria-pressed="true"]').length, storage: localStorage.length + sessionStorage.length + document.cookie.length, injected: document.querySelectorAll('[onerror]').length, pwned: typeof window.__pwned })`).then(JSON.parse);

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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

  // ---------- 1. a plain page: Copy link makes a link, the address follows, and the link opens the same page ----------
  record('the plain duplex page loads', await load('plan=duplex-1&preset=clear&t=0.45'));
  const base = await pageState();
  record('no link in the address yet, no start note', base.notes?.length === 0 && !/share=/.test(base.hash), { notes: base.notes });
  const picA0 = await picture('1-sender-plain'); // before the click: afterwards the line 'Link copied' is in the picture
  await click('#ps-ui .tool[data-tool="share"]');
  record('Copy link makes a link', await waitFor('!!(window.__share && window.__share.last())', 60));
  const linkA = await ev('window.__share.last()');
  await waitFor("((document.querySelector('#ps-ui-msg') || {}).textContent || '') !== '' || !!document.querySelector('#ps-files-overlay')", 30); // the line comes after the copy
  const sA = await pageState();
  const copied = /Link skopiowany|Link copied/.test(sA.line), dialog = await rectOf('#ps-files-overlay');
  record('the page says the link is copied, or shows it in a dialog when the browser would not copy', copied || !!dialog, { line: sA.line, dialog: !!dialog });
  if (dialog) { await click('.ps-files-cancel'); await sleep(200); }
  record('the link is a clean address with the view and share=z1.', /^(file|https?):.*#preset=clear&t=0\.450&az=-?[\d.]+&pol=[\d.]+&plan=duplex-1&share=z1\.[A-Za-z0-9_-]+$/.test(linkA), { chars: linkA.length, link: linkA.slice(-90) });
  record('the address bar follows the button', /share=z1\./.test(sA.hash) && /plan=duplex-1/.test(sA.hash), { hash: sA.hash.slice(0, 80) });
  const decA = await decodeShare(shareOf(linkA));
  record('the link unpacks to a layout and no plan (an example plan is named in the address)', decA.ok && decA.plan === null && decA.layout?.levels?.length === 2, { error: decA.error });
  record('the link opens the same page: same pieces, and the link made there is the same link', await load(linkA));
  const rA = await pageState();
  const relinked = await ev('window.__share.build().then((r) => r.url)');
  record('opened from the link, the page builds the very same link again', rA.pieces === base.pieces && rA.notes.length === 0 && shareOf(relinked) === shareOf(linkA), { pieces: `${base.pieces} -> ${rA.pieces}`, sameShare: shareOf(relinked) === shareOf(linkA) });
  const picA1 = await picture('2-receiver-plain');
  const dA = diff(picA0, picA1);
  record('and it looks the same (blocks of 8 by 8 pixels, the noise of a load averaged out)', dA.same, dA);

  const { model, layout } = build(examplePlan('duplex-1'));
  const lv0 = model.levels[0], piece = layout.levels[0].pieces.find((p) => specOf(p.type)?.slots?.length && !p.on), slot = specOf(piece.type).slots[0], room = lv0.rooms[0];
  if (!opt.quick) {
  // ---------- 2. an edited layout: the link carries every change, through the Edit and Done reload, into a page of someone else ----------
  record('the editor page loads', await load('plan=duplex-1&edit=1&preset=clear&t=0.45'));
  const edits = await ev(`(() => { const s = window.__edit.session, r = [];
    r.push(s.select(${JSON.stringify(piece.id)})); r.push(s.turn(90).ok); r.push(s.recolor(${JSON.stringify(slot)}, '#2a6fb0').ok);
    r.push(s.selectRoom(${JSON.stringify(lv0.id)}, ${JSON.stringify(room.id)})); r.push(s.recolorRoom('wall', '#d4a373').ok); r.push(s.recolorRoom('floor', '#335c67').ok);
    r.push(s.add(${JSON.stringify(piece.type)}, { level: ${JSON.stringify(lv0.id)} }).ok); s.select(null); return r; })()`);
  record('a piece is turned and recoloured, a room is recoloured, a piece is added', edits.every(Boolean), { edits });
  const senderText = await ev('window.__edit.session.exportText()');
  const countEdited = await ev('window.__edit.count()');
  await click('#ps-edit [data-edit="more"]'); await sleep(200);
  await click('#ps-edit-menu [data-edit-item="link"]');
  record('File, Copy link makes the link while editing', await waitFor('!!(window.__share && window.__share.last())', 60));
  const linkB = await ev('window.__share.last()');
  await waitFor("((document.querySelector('#ps-edit-msg') || {}).textContent || '') !== '' || !!document.querySelector('#ps-files-overlay')", 30);
  const sB = await pageState();
  record('the address bar keeps edit=1 and gets the layout; the edit bar says the link is copied (or the dialog shows it)', /edit=1/.test(sB.hash) && /share=/.test(sB.hash) && (/Link skopiowany|Link copied/.test(sB.editLine) || !!(await rectOf('#ps-files-overlay'))), { hash: sB.hash.slice(0, 100), line: sB.editLine });
  if (await rectOf('#ps-files-overlay')) { await click('.ps-files-cancel'); await sleep(200); }
  record('the link is longer than the plain one, and still short', linkB.length > linkA.length && linkB.length < 4000, { chars: linkB.length });
  await ev('window.__marker = 1');
  await click('#ps-ui .tool[data-tool="edit"]'); // Done: the page reloads in view mode and must keep the layout, with no warning about unsaved changes
  record('Done reloads the page in view mode', await waitFor("typeof window.__marker === 'undefined' && window.__done === true", T));
  const sD = await pageState();
  record('the reloaded page has the layout of the address (one piece more) and no edit bar', sD.pieces === countEdited && !/edit=1/.test(sD.hash) && (await rectOf('#ps-edit')) === null, { pieces: sD.pieces, countEdited, hash: sD.hash.slice(0, 60) });
  const picB0 = await picture('3-sender-after-done');
  record('another person opens the link', await load(linkB));
  const sR = await pageState();
  const picB1 = await picture('4-receiver-edited');
  const dB = diff(picB0, picB1);
  record('who opens the link sees the same picture as the sender after Done', dB.same && sR.pieces === countEdited && sR.notes.length === 0, { ...dB, pieces: sR.pieces });
  record('the changed colours and the added piece show: the page without the link looks different', diff(picB1, picA1).over8 > 0.004, diff(picB1, picA1));
  record('the same link in the editor gives the layout of the sender, character for character (turn, colours, room colours, the added piece)', await load(`${linkB}&edit=1`) && (await ev('window.__edit.session.exportText()')) === senderText);
  await ev(`window.__edit.session.select(${JSON.stringify(piece.id)})`);
  const turned = await ev(`window.__edit.session.pieceById(${JSON.stringify(piece.id)}).rot`);
  record('the piece stands turned by 90 degrees there', Math.abs(turned - ((layout.levels[0].pieces.find((p) => p.id === piece.id).rot + 90) % 360)) < 1e-6, { turned });

  } // --quick leaves out the edited layout (2)
  // ---------- 3. a plan of your own travels in the link ----------
  const fixtureText = readFileSync(join(root, 'tests/fixtures/duplex-min.plan.json'), 'utf8');
  const fx = readPlanText(fixtureText, 'en');
  const fixture = build(fixtureText);
  const ownLink = await encodeShare({ plan: planForLink(fx.plan), layout: packLayout(serializeLayout(fixture.layout)) }); // not `own`: that name is the origin of a live address, read by the request listener above
  record('a link with a plan of your own is made', ownLink.ok, { chars: ownLink.chars });
  record('and it opens that plan with its layout; no example button is pressed', await load(`${html}#preset=amber&share=${ownLink.value}`));
  const sO = await pageState();
  record('the plan has its levels and pieces, no note, no error', sO.levels === fx.plan.levels.length && sO.pieces === fixture.layout.levels.reduce((n, l) => n + l.pieces.length, 0) && sO.notes.length === 0 && sO.pressedPlans === 0, { levels: sO.levels, pieces: sO.pieces, pressed: sO.pressedPlans });
  await click('#ps-ui .tool[data-tool="share"]');
  await waitFor('!!(window.__share && window.__share.last())', 60);
  const linkO = await ev('window.__share.last()');
  const decO = await decodeShare(shareOf(linkO));
  record('Copy link on that page carries the plan again', decO.ok && !!decO.plan && !!decO.layout && !/plan=/.test(linkO), { chars: linkO.length });
  await picture('5-own-plan');

  // ---------- 4. broken, huge and hostile links: the page opens without them, says so, and puts nothing in the page as markup ----------
  const bomb = `z1.${b64(deflateRawSync(Buffer.alloc(40 * 1024 * 1024)))}`;
  const evil = '<img src=x onerror="window.__pwned=1">';
  const hostileLayout = { version: 1, levels: [{ id: model.levels[0].id, pieces: [{ id: evil, type: piece.type, room: room.id, x: 1, y: 1 }, { id: 'ok1', type: 'no-such-type', room: room.id, x: 1, y: 1 }, { id: 'ok2', type: piece.type, room: evil, x: 1e308, y: 1 }] }, { id: evil, pieces: [] }] };
  const hostilePlan = JSON.parse(examplePlan('flat-1')); hostilePlan.name = evil; hostilePlan.levels[0].name = evil; for (const r of hostilePlan.levels[0].rooms) r.name = evil;
  const deep = `z1.${b64(deflateRawSync(Buffer.from(`{"v":1,"layout":{"version":1,"levels":[],"x":${'['.repeat(20000)}${']'.repeat(20000)}}}`)))}`; // a link of a few hundred characters that nests 20 000 levels deep
  const cases = [
    ['a value that is no deflate stream (z1.AAAA)', 'z1.AAAA', (s) => s.notes[0]?.[0] === 'link' && s.notes[0][1] === 'broken'],
    ['a value of the wrong kind', 'zz.abc', (s) => s.notes[0]?.[0] === 'link' && s.notes[0][1] === 'format'],
    ['a text nested 20 000 levels deep', deep, (s) => s.notes[0]?.[0] === 'link' && s.notes[0][1] === 'broken'],
    ['a small deflated text that unpacks to 40 MB', bomb, (s) => s.notes[0]?.[0] === 'link' && s.notes[0][1] === 'too-large'],
    ['a plan that is no plan', plainValue({ v: 1, plan: { levels: [] } }), (s) => s.notes[0]?.[0] === 'plan'],
    ['a layout of other plan levels and bad pieces', plainValue({ v: 1, layout: hostileLayout }), (s) => s.notes.length === 1 && s.pieces === 48],
    ['a plan and a layout full of markup', plainValue({ v: 1, plan: hostilePlan, layout: hostileLayout }), () => true],
  ];
  for (const [name, value, check] of opt.quick ? cases.slice(0, 2) : cases) {
    for (const edit of opt.quick ? [false] : [false, true]) {
      const ok = await load(`${html}#share=${value}${edit ? '&edit=1' : ''}`);
      const s = ok ? await pageState() : null;
      if (edit && ok) { await click('#ps-edit [data-edit="more"]').catch(() => {}); await sleep(150); }
      const after = ok ? await pageState() : null;
      record(`${name}${edit ? ' (editor)' : ''}: the page opens, says so if it left something out, and no markup got in`, ok && check(s) && s.injected === 0 && after.injected === 0 && s.pwned === 'undefined' && (s.notes.length === 0 || (s.said || '').length > 0),
        { notes: s?.notes, said: s?.said, pieces: s?.pieces, injected: after?.injected, pwned: s?.pwned });
    }
  }
  const last = await pageState();
  record('no storage was written', last.storage === 0, { storage: last.storage });
  record('no request left the page', requests.size === 0, { requests: [...requests] });
  record('the console has no error', logs.size === 0, { logs: [...logs].slice(0, 5) });
} catch (e) {
  record('the script ran to the end', false, { error: String(e?.stack ?? e).slice(0, 500) });
} finally {
  console.log(JSON.stringify({ ok: !failed, steps: steps.length, failed: steps.filter((s) => !s.ok).map((s) => s.name) }));
  await cleanup();
  process.exit(failed ? 1 : 0);
}
