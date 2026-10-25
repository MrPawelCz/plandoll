// Review page for the editor panel: the real catalogue and palettes with a stand-in session and no 3D view. Hash options:
//   lang=en|pl   open=1 (the list of pieces)   groups=a,b (groups to expand)   sel=<type> (a selected piece)
//   pick=<slot>.<index> (a colour from the palette of that slot)   problems=a,b (problem kinds of the selected piece)
import { createPanel } from '../src/app/panel.js';
import { createUI } from '../src/app/ui.js';
import { defaultSizeOf } from '../src/furniture/catalog.js';
import { paletteOf, roomPalette } from '../src/furniture/palettes.js';

const opt = Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, '')));
const lang = opt.lang === 'pl' ? 'pl' : 'en';
document.body.style.cssText = 'margin:0;height:100vh;background:radial-gradient(120% 90% at 40% 35%,#e9dfcb 0%,#cdbfa6 60%,#a99b82 100%)';
document.documentElement.style.setProperty('--ps-stack-h', '190px'); // the height of the page's own bars, published by the page
createUI({ onPreset() {}, onTime() {}, onQuality() {}, onLang() {}, onReset() {} }, { preset: 'amber', t: 0.5, q: 'auto', level: 'low', lang }, document);

const subs = new Set();
let sel = null;
if (opt.sel) {
  sel = { id: 'demo', type: opt.sel, size: defaultSizeOf(opt.sel), colors: {} };
  if (opt.pick) { const [slot, i] = opt.pick.split('.'); sel.colors[slot] = paletteOf(opt.sel, slot).colors[Number(i)].hex; }
}
// room=1 selects a room instead of a piece; pickroom=<wall|floor>.<index> gives it a colour from the palette of that part
let room = opt.room === '1' && !sel ? { level: 'L1', id: 'living', name: lang === 'pl' ? 'Salon' : 'Living room', colors: {} } : null;
if (room && opt.pickroom) { const [part, i] = opt.pickroom.split('.'); room.colors[part] = roomPalette(part, 'en')[Number(i)].value; }
let snap = false;
const emit = () => subs.forEach((f) => f({ type: 'change' }));
const session = {
  selectedRoom: () => (sel ? null : room),
  recolorRoom(part, color) { const colors = { ...room.colors }; if (color === null) delete colors[part]; else colors[part] = color; room = { ...room, colors }; emit(); return { ok: true }; },
  snapEdges: () => snap,
  setSnapEdges(v) { snap = !!v; emit(); },
  selected: () => sel,
  problems: () => (opt.problems ? opt.problems.split(',').map((kind) => ({ kind })) : []),
  add(type) { sel = { id: 'demo', type, size: defaultSizeOf(type), colors: {} }; emit(); return { ok: true }; },
  resize(s) { sel = { ...sel, size: [s.w, s.d, s.h] }; emit(); return { ok: true }; },
  recolor(slot, color) { const colors = { ...sel.colors }; if (color === null) delete colors[slot]; else colors[slot] = color; sel = { ...sel, colors }; emit(); return { ok: true }; },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};
const panel = createPanel({ doc: document, host: document.body, lang, session });
if (opt.open === '1') panel.element.querySelector('.psp-toggle').click();
for (const g of (opt.groups ?? '').split(',').filter(Boolean)) {
  const head = document.getElementById(`psp-gh-${g}`);
  if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
}

// two frames later: measure what a phone screen needs (nothing outside the screen sideways, touch targets of at least 44 px)
requestAnimationFrame(() => requestAnimationFrame(() => {
  const vw = innerWidth, off = [], small = [];
  for (const n of document.querySelectorAll('.psp-root, .psp-root *')) {
    const r = n.getBoundingClientRect();
    if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) off.push(String(n.className || n.tagName));
  }
  for (const n of document.querySelectorAll('.psp-item, .psp-toggle, .psp-group-head, .psp-close, .psp-sel-head, .psp-switch')) {
    const r = n.getBoundingClientRect();
    if (r.width && (r.height < 43.5 || r.width < 43.5)) small.push(`${n.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const sh = document.querySelector('.psp-sheet')?.getBoundingClientRect();
  const sheet = sh && sh.width ? { top: Math.round(sh.top), bottom: Math.round(sh.bottom), h: Math.round(sh.height), vh: innerHeight } : null;
  window.__stats = { vw, scrollW: document.documentElement.scrollWidth, offscreen: off.slice(0, 8), small: small.slice(0, 8), sheet };
  window.__done = true;
}));
