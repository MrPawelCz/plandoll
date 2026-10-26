// Click-through of the Load plan box in a real browser (headless Chrome, software GL): the folded instruction opens, the Copy the prompt button copies exactly the prompt of the repository
// (English or Polish), a refused clipboard leaves the prompt open to copy by hand, a plan that does not pass stays in the box with its message and a button that copies it, a good plan loads,
// the box fits a desktop and a phone window, and the page makes no request of its own.
//   node tools/help-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout 150] [--phone]
// On a small machine run it under tools/chrome-lock.sh (one browser at a time). CHROME names the browser (chrome-headless-shell is fine). Exits 1 when a step fails.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PROMPT_EN, PROMPT_PL } from '../src/app/prompts.js';

const argv = process.argv.slice(2);
const opt = { html: null, out: null, timeout: 150 };
let phone = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--phone') phone = true;
  else if (argv[i].startsWith('--') && argv[i].slice(2) in opt && argv[i + 1] !== undefined) opt[argv[i].slice(2)] = argv[++i];
  else { console.error('usage: node tools/help-check.mjs [--html dist/plandoll.html | --html https://host/path/] [--out DIR] [--timeout S] [--phone]'); process.exit(2); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = /^https?:\/\//i.test(opt.html ?? '');
const page = live ? opt.html : pathToFileURL(resolve(opt.html ?? join(root, 'dist/plandoll.html'))).href;
const ownOrigin = live ? new URL(opt.html).origin : 'file://';
const out = opt.out ? resolve(opt.out) : null;
if (out) mkdirSync(out, { recursive: true });
const W = phone ? 390 : 1100, H = phone ? 844 : 760, tag = phone ? 'phone' : 'desktop';
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-help-'));
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

const example = JSON.parse(readFileSync(join(root, 'examples/flat-1.plan.json'), 'utf8'));
const goodText = JSON.stringify(example);
const badPlan = JSON.parse(goodText); // an opening that lies far past the end of its wall: the validator refuses it with a message
{ const lv = badPlan.levels[0]; const op = lv.openings.find((o) => o.type === 'door') ?? lv.openings[0]; op.offset = 99; }
const badText = JSON.stringify(badPlan);

const LANGS = {
  en: { prompt: PROMPT_EN, load: 'Load plan', head: 'Could not load the plan', loaded: 'Plan loaded', copied: 'Prompt copied', failed: 'Could not copy', msgCopied: 'Message copied' },
  pl: { prompt: PROMPT_PL, load: 'Wczytaj plan', head: 'Nie wczytano planu', loaded: 'Wczytano plan', copied: 'Skopiowano polecenie', failed: 'Nie udało się skopiować', msgCopied: 'Skopiowano komunikat' },
};
const STUB = `window.__copied = []; Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); true`;
const STUB_REFUSE = `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('refused'); } }, configurable: true }); document.execCommand = () => false; true`;
const click = (sel) => ev(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true; })()`);
const setBox = (text) => ev(`(() => { const a = document.getElementById('ps-files-text'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); return a.value.length; })()`);
const fits = () => ev(`(() => { const d = document.querySelector('.ps-files-dialog'); const r = d.getBoundingClientRect();
  return { dialogW: d.scrollWidth <= d.clientWidth + 1, page: document.documentElement.scrollWidth <= innerWidth + 1, inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 }; })()`);

async function run(lang) {
  const T = LANGS[lang];
  await send('Page.navigate', { url: `${page}#lang=${lang}&q=low&live=1` });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('canvas')`, 60000, 'the page');
  await sleep(1500);
  const opened = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(T.load)}); if (!b) return false; b.click(); return true; })()`);
  check(`${lang}: the ${T.load} button opens the box`, opened && await ev(`!!document.getElementById('ps-files-overlay')`));
  const help = await ev(`(() => { const h = document.getElementById('ps-files-help'); return h ? { open: h.open, steps: h.querySelectorAll('li').length, focus: document.activeElement?.id } : null; })()`);
  check(`${lang}: the instruction is there, folded, and the focus is in the box`, help && help.open === false && help.steps === 4 && help.focus === 'ps-files-text', JSON.stringify(help));
  await shot(`${lang}-1-folded`);
  check(`${lang}: the folded box fits the window`, Object.values(await fits()).every(Boolean), JSON.stringify(await fits()));

  await click('#ps-files-help > summary');
  check(`${lang}: the summary unfolds the instruction`, await ev(`document.getElementById('ps-files-help').open === true`));
  const f = await fits();
  check(`${lang}: the unfolded box fits the window without sideways scrolling`, Object.values(f).every(Boolean), JSON.stringify(f));
  await shot(`${lang}-2-unfolded`);
  const reach = await ev(`(() => { const d = document.querySelector('.ps-files-dialog'); d.scrollTop = d.scrollHeight; const b = document.querySelector('.ps-files-load').getBoundingClientRect(); const c = document.querySelector('.ps-files-copyprompt').getBoundingClientRect();
    return { loadVisible: b.top >= 0 && b.bottom <= innerHeight + 1, copyTall: c.height >= 36, copyWide: c.width >= 100 }; })()`);
  check(`${lang}: after scrolling the box, Load is reachable and the Copy button is a comfortable target`, reach.loadVisible && reach.copyTall && reach.copyWide, JSON.stringify(reach));

  await ev(STUB);
  await click('.ps-files-copyprompt'); await sleep(300);
  const copied = await ev(`window.__copied`);
  check(`${lang}: Copy the prompt copies exactly the prompt of the repository (${T.prompt.length} characters)`, copied.length === 1 && copied[0] === T.prompt, `copied ${copied[0]?.length}`);
  check(`${lang}: the button says so next to itself`, (await ev(`document.querySelector('.ps-files-copyprompt').parentNode.querySelector('.ps-files-copied').textContent`)).startsWith(T.copied));
  const promptShown = await ev(`document.querySelector('.ps-files-prompt-text').value`);
  check(`${lang}: the prompt to read is the same text`, promptShown === T.prompt);

  await ev(STUB_REFUSE);
  await click('.ps-files-copyprompt'); await sleep(300);
  const refused = await ev(`({ open: document.querySelector('.ps-files-prompt').open, said: document.querySelector('.ps-files-copyprompt').parentNode.querySelector('.ps-files-copied').textContent })`);
  check(`${lang}: when the clipboard refuses, the prompt opens to be copied by hand and the button says so`, refused.open === true && refused.said.startsWith(T.failed), JSON.stringify(refused));
  await shot(`${lang}-3-prompt-open`);
  await ev(STUB);

  await setBox(badText); await click('.ps-files-load'); await sleep(500);
  const prob = await ev(`(() => ({ open: !!document.getElementById('ps-files-overlay'), text: document.getElementById('ps-files-error').textContent, row: document.querySelector('.ps-files-msgrow')?.style.display }))()`);
  check(`${lang}: a plan that does not pass stays in the box with the reason`, prob.open && prob.text.startsWith(T.head) && prob.text.includes('\n') && prob.row !== 'none', prob.text.slice(0, 200));
  await ev(`document.querySelector('.ps-files-dialog').scrollTop = 0; document.getElementById('ps-files-error').scrollIntoView({ block: 'center' }); true`);
  await shot(`${lang}-4-problem`);
  await click('.ps-files-copymsg'); await sleep(300);
  const copiedMsg = await ev(`window.__copied.at(-1)`);
  check(`${lang}: Copy the message copies the whole problem text`, copiedMsg === prob.text, `copied ${copiedMsg?.length}`);
  check(`${lang}: and says so`, (await ev(`document.querySelector('.ps-files-msgrow .ps-files-copied').textContent`)).startsWith(T.msgCopied));

  await setBox(goodText); await click('.ps-files-load');
  const closed = await waitFor(`!document.getElementById('ps-files-overlay')`, 20000, 'the box to close').catch(() => false);
  check(`${lang}: a good plan closes the box`, closed);
  const said = await waitFor(`document.body.innerText.includes(${JSON.stringify(T.loaded)})`, 30000, 'the loaded line').catch(() => false);
  check(`${lang}: and the page says "${T.loaded}"`, said);
  await shot(`${lang}-5-loaded`);
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
  if (phone) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  const timer = setTimeout(async () => { console.error(`FAIL timeout after ${opt.timeout} s`); await cleanup(); process.exit(1); }, Number(opt.timeout) * 1000);
  for (const lang of ['en', 'pl']) await run(lang);
  clearTimeout(timer);
  const foreign = [...requests].filter((u) => !(u.startsWith(ownOrigin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank'));
  check('the page made no request of its own to anywhere else', foreign.length === 0, foreign.slice(0, 3).join(' '));
  check('no script error or console error', logs.length === 0, logs.slice(0, 3).join(' | '));
} catch (e) {
  check(`the check ran to the end`, false, e.message);
}
await cleanup();
const failed = steps.filter((s) => !s.ok).length;
console.log(`${failed ? 'FAIL' : 'PASS'}: ${steps.length - failed} of ${steps.length} steps (${tag})`);
process.exit(failed ? 1 : 0);
