// Headless Chrome (software GL, so slow: 2 to 20 s per frame) screenshots of the built single file or of a published address.
//   node tools/shot.mjs [--size 1600x900] [--html dist/plandoll.html | --html https://host/path/] [--out shots] [--timeout 300] [--quality 86] [--eval JS] [--init JS] [--strict] name=hash[:frames] ...
// On a small machine run only one browser at a time.
// --init JS runs that script in every new document before the page's own scripts (for example to hide an API). PS_CHROME_FLAGS adds
// space separated flags to the Chrome command line.
// --plan FILE injects that plan JSON as window.__plan before the page loads (use "plan=ext" in the hash to show it).
// Page contract: the URL hash carries options (for example "preset=amber&t=0.7&cam=close"); the tool appends "&frames=N" (default 3). After N
// rendered frames the page sets window.__done = true and window.__stats = { ... }; a fatal error sets window.__fail = "message".
// Output: out/name.jpg per job, one JSON line per job on stdout, then the console errors and warnings, every request that is not a
// local file, data or blob URL (NETWORK; with an https address, requests to that address itself are allowed), and the browser storage in use
// (STORAGE). --strict exits 1 when any of those is non-empty.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { size: '1600x900', html: null, out: 'shots', timeout: 300, quality: 86, eval: null, init: null, strict: false, plan: null };
const jobs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--strict') opt.strict = true;
  else if (a.startsWith('--') && a.slice(2) in opt) opt[a.slice(2)] = argv[++i];
  else if (a.includes('=')) jobs.push(a);
  else { console.error(`shot: unknown argument ${a}`); process.exit(2); }
}
if (!jobs.length) { console.error('usage: node tools/shot.mjs [--size WxH] [--html FILE] [--out DIR] [--timeout S] [--quality Q] [--eval JS] [--init JS] [--strict] name=hash[:frames] ...'); process.exit(2); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [W, H] = opt.size.split('x').map(Number);
const live = /^https?:\/\//i.test(opt.html ?? '');
const html = live ? opt.html : resolve(opt.html ?? join(root, 'dist/plandoll.html'));
const own = live ? new URL(html).origin + '/' : null;
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });

// Software GL by default (swiftshader); PS_ANGLE=metal draws on the GPU where the machine has one.
const ANGLE = process.env.PS_ANGLE || 'swiftshader';
const GL_FLAGS = ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const EXTRA_FLAGS = (process.env.PS_CHROME_FLAGS || '').split(/\s+/).filter(Boolean);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'plandoll-chrome-'));
const chrome = spawn('nice', ['-n', '19', CHROME, '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--use-gl=angle', `--use-angle=${ANGLE}`, ...GL_FLAGS, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars', `--window-size=${W},${H}`, ...EXTRA_FLAGS, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pend = new Map();
const logs = new Set(), requests = new Set(), storage = new Set();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const text = (a) => String(a.value ?? a.description ?? '').slice(0, 300);
let failed = false;
const cleanup = async () => { try { ws?.close(); } catch {} chrome.kill('SIGTERM'); await sleep(400); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }); };
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await cleanup(); process.exit(130); });

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
  if (opt.plan) { const json = readFileSync(resolve(opt.plan), 'utf8'); JSON.parse(json); await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__plan = ${json};` }); }
  if (opt.init) await send('Page.addScriptToEvaluateOnNewDocument', { source: opt.init });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (const job of jobs) {
    const eq = job.indexOf('=');
    const name = job.slice(0, eq), rest = job.slice(eq + 1), co = rest.lastIndexOf(':');
    const hash = co >= 0 ? rest.slice(0, co) : rest, frames = co >= 0 ? rest.slice(co + 1) : '3';
    await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
    const t0 = Date.now();
    await send('Page.navigate', { url: `${live ? html : pathToFileURL(html).href}#${hash}${hash ? '&' : ''}frames=${frames}` });
    let done = false;
    for (let k = 0; k < Number(opt.timeout) * 2 && !done; k++) {
      await sleep(500);
      try { const r = await send('Runtime.evaluate', { expression: 'window.__done === true || !!window.__fail', returnByValue: true }); done = !!r.result.value; } catch {}
    }
    const st = await send('Runtime.evaluate', { expression: 'JSON.stringify({ done: window.__done === true, fail: window.__fail || null, stats: window.__stats || null })', returnByValue: true });
    const info = JSON.parse(st.result.value);
    if (!info.done || info.fail) failed = true;
    let extra = null;
    if (opt.eval) { const r = await send('Runtime.evaluate', { expression: opt.eval, returnByValue: true, awaitPromise: true }); extra = r.result.value ?? r.result.description ?? null; }
    const used = await send('Runtime.evaluate', { expression: 'JSON.stringify((() => { try { return { local: localStorage.length, session: sessionStorage.length, cookie: document.cookie.length }; } catch (e) { return { error: String(e).slice(0, 80) }; } })())', returnByValue: true });
    const u = JSON.parse(used.result.value);
    if (u.local || u.session || u.cookie) storage.add(JSON.stringify(u));
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: Number(opt.quality), fromSurface: true });
    writeFileSync(join(out, `${name}.jpg`), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ name, wallS: +((Date.now() - t0) / 1000).toFixed(1), ...info, extra }));
  }
  if (logs.size) console.log('console:\n' + [...logs].slice(0, 20).join('\n'));
  if (requests.size) console.log('NETWORK (not a local file, data or blob URL):\n' + [...requests].join('\n'));
  if (storage.size) console.log('STORAGE in use: ' + [...storage].join(' '));
  if (failed || (opt.strict && (logs.size || requests.size || storage.size))) process.exitCode = 1;
} finally { await cleanup(); }
process.exit(process.exitCode ?? 0);
