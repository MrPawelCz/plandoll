// Editor panel: a button that opens the list of furniture to add (groups, rooms, extras), and for the selected piece the size fields
// and one colour bar per material slot. It talks to a session object only (see createPanel); it does not move, turn or delete a piece,
// read or write files, or touch three.js. Texts in English and Polish; styles come from one <style id="ps-panel-style">.
import { catalogGroups, resizableAxes, clampSize, defaultSizeOf } from '../furniture/catalog.js';
import { paletteOf, defaultColorOf, roomPalette } from '../furniture/palettes.js';

const STR = {
  en: {
    add: 'Add', addTitle: 'Add a piece of furniture', listTitle: 'Add furniture', close: 'Close', extra: 'extra', panel: 'Furniture',
    room: 'Room', collapseRoom: 'Show or hide the colours of the selected room', walls: 'Walls', floor: 'Floor',
    snap: 'Snap to neighbours', snapTitle: 'Snap a piece to the sides of the pieces next to it',
    selected: 'Selected piece', collapse: 'Show or hide the details of the selected piece', size: 'Size', cm: 'cm',
    axis: { w: 'Width', d: 'Depth', h: 'Height' }, colours: 'Colours', defaultColour: 'Default', defaultTitle: 'Default colour', more: 'more',
    rooms: { living: 'living room', dining: 'dining room', kitchen: 'kitchen', bedroom: 'bedroom', kids: 'kids room', bath: 'bathroom', wc: 'toilet', hall: 'hall', office: 'office', utility: 'utility room', balcony: 'balcony', storage: 'storage', any: 'any room' },
    problems: { overlap: 'overlaps another piece', 'outside-room': 'sticks out of the room', 'floating-prop': 'has nothing to stand on', 'door-zone': 'blocks a door', stair: 'blocks the stairs', 'tall-before-window': 'tall piece in front of a window', 'unknown-type': 'unknown piece', 'bad-number': 'invalid position' },
    fail: { 'no-room': 'There is no free place for it in this room.', 'limit-level': 'This floor already holds as many pieces as it can.', 'limit-total': 'The flat already holds as many pieces as it can.', other: 'The piece could not be added.' },
  },
  pl: {
    add: 'Dodaj', addTitle: 'Dodaj mebel', listTitle: 'Dodaj mebel', close: 'Zamknij', extra: 'dodatek', panel: 'Meble',
    room: 'Pokój', collapseRoom: 'Pokaż lub ukryj kolory zaznaczonego pokoju', walls: 'Ściany', floor: 'Podłoga',
    snap: 'Przyciągaj do sąsiadów', snapTitle: 'Przyciągaj sztukę do boków sąsiednich sztuk',
    selected: 'Zaznaczona sztuka', collapse: 'Pokaż lub ukryj szczegóły zaznaczonej sztuki', size: 'Rozmiar', cm: 'cm',
    axis: { w: 'Szerokość', d: 'Głębokość', h: 'Wysokość' }, colours: 'Kolory', defaultColour: 'Domyślny', defaultTitle: 'Kolor domyślny', more: 'więcej',
    rooms: { living: 'salon', dining: 'jadalnia', kitchen: 'kuchnia', bedroom: 'sypialnia', kids: 'pokój dziecka', bath: 'łazienka', wc: 'toaleta', hall: 'przedpokój', office: 'gabinet', utility: 'pomieszczenie gospodarcze', balcony: 'balkon', storage: 'schowek', any: 'każdy pokój' },
    problems: { overlap: 'zachodzi na inną sztukę', 'outside-room': 'wystaje poza pokój', 'floating-prop': 'nie ma na czym stać', 'door-zone': 'zastawia drzwi', stair: 'zastawia schody', 'tall-before-window': 'wysoki mebel przed oknem', 'unknown-type': 'nieznany typ', 'bad-number': 'błędne położenie' },
    fail: { 'no-room': 'Brak wolnego miejsca w tym pokoju.', 'limit-level': 'Na tym piętrze jest już tyle sztuk, ile się mieści.', 'limit-total': 'W mieszkaniu jest już tyle sztuk, ile się mieści.', other: 'Nie udało się dodać.' },
  },
};
export const PANEL_TEXT = STR;

const HARD = ['overlap', 'outside-room', 'floating-prop']; // problems drawn in red; the others in yellow
const AX = { w: 0, d: 1, h: 2 };
const ROOMS_SHOWN = 3;

const CSS = `
.psp-root,.psp-root *{box-sizing:border-box}
.psp-root{position:fixed;top:14px;right:14px;z-index:30;width:304px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:13px/1.35 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink,#4a3b2a);pointer-events:none}
.psp-root>*{pointer-events:auto}
.psp-root[hidden],.psp-root [hidden]{display:none!important}
.psp-root button{font:inherit;color:inherit;margin:0;cursor:pointer}
.psp-root :focus-visible{outline:2px solid var(--accent,#c8793a);outline-offset:2px}
.psp-toggle{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 16px 0 10px;border-radius:22px;background:var(--paper,rgba(250,245,234,.9));border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 8px 24px rgba(40,28,12,.26);font-weight:700;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.psp-plus{width:26px;height:26px;border-radius:50%;background:var(--accent,#c8793a);color:#fffaf0;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;font-weight:600}
.psp-root[data-open="1"] .psp-toggle{background:#fffaf0}
.psp-sheet{width:100%;max-height:calc(100vh - 150px);overflow-y:auto;overscroll-behavior:contain;padding:10px;border-radius:18px;background:var(--paper,rgba(250,245,234,.92));border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 10px 30px rgba(40,28,12,.28);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.psp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}
.psp-title{margin:0;font-size:14px;font-weight:800}
.psp-close{min-width:44px;min-height:44px;margin:-6px -6px -6px 0;border:0;background:none;font-size:22px;line-height:1;border-radius:12px}
.psp-note{margin:0 0 8px;padding:6px 10px;border-radius:10px;background:rgba(217,72,59,.12);color:#8f2a22;font-weight:600}
.psp-group{border-top:1px solid var(--line,rgba(120,96,64,.22))}
.psp-group:first-of-type{border-top:0}
.psp-group-head{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 4px;border:0;background:none;text-align:left;font-weight:800}
.psp-group-name{flex:1;min-width:0}
.psp-count{font-size:11px;font-weight:700;opacity:.6}
.psp-chev{width:8px;height:8px;margin:0 4px 3px 0;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg)}
[aria-expanded="true"]>.psp-chev{transform:rotate(-135deg);margin:4px 4px 0 0}
.psp-items{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:2px 0 10px}
.psp-item{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n t" "r r";align-items:center;gap:0 8px;width:100%;min-height:44px;padding:6px 10px;text-align:left;background:#fffaf0;border:1px solid var(--line,rgba(120,96,64,.22));border-radius:12px}
.psp-item:hover{background:#fff3df}
.psp-item-name{grid-area:n;font-weight:700;overflow-wrap:anywhere}
.psp-tag{grid-area:t;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(200,121,58,.18);color:#80441a;padding:1px 7px;border-radius:8px}
.psp-item-rooms{grid-area:r;font-size:11px;opacity:.72;overflow-wrap:anywhere}
.psp-root[data-open="1"] .psp-add+.psp-sel,.psp-root[data-open="1"] .psp-add+.psp-room{margin-top:10px;padding-top:6px;border-top:2px solid var(--line,rgba(120,96,64,.22))}
@media (min-width:761px){.psp-groups{max-height:min(340px,46vh);overflow-y:auto;overscroll-behavior:contain}}
.psp-opts{margin:6px 0 0;padding-top:6px;border-top:1px solid var(--line,rgba(120,96,64,.22))}
.psp-switch{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 4px;border:0;background:none;text-align:left;font-weight:700}
.psp-knob{flex:none;position:relative;width:40px;height:24px;border-radius:12px;background:rgba(90,70,40,.28);box-shadow:inset 0 0 0 1px rgba(0,0,0,.18);transition:background .15s}
.psp-knob::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fffaf0;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .15s}
.psp-switch[aria-checked="true"] .psp-knob{background:var(--accent,#c8793a)}
.psp-switch[aria-checked="true"] .psp-knob::after{transform:translateX(16px)}
.psp-sel-head{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 4px;border:0;background:none;text-align:left}
.psp-sel-kicker{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.psp-sel-name{display:block;font-size:15px;font-weight:800;overflow-wrap:anywhere}
.psp-sel-text{flex:1;min-width:0}
.psp-problems{list-style:none;margin:0 0 6px;padding:0;display:grid;gap:3px}
.psp-problems li{position:relative;padding-left:16px;font-size:12px;font-weight:700}
.psp-problems li::before{content:"";position:absolute;left:2px;top:.4em;width:9px;height:9px;border-radius:50%}
.psp-bad{color:#a8322a}.psp-bad::before{background:#d9483b}
.psp-warn{color:#86600f}.psp-warn::before{background:#e0a82e}
.psp-sizes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:2px 0 6px}
.psp-field{display:grid;gap:2px;min-width:0}
.psp-field-name{font-size:11px;font-weight:700;opacity:.8}
.psp-num{width:100%;min-width:0;min-height:40px;padding:4px 8px;font:inherit;font-size:16px;color:inherit;background:#fffaf0;border:1px solid var(--line,rgba(120,96,64,.3));border-radius:10px}
.psp-slot{margin:8px 0 0}
.psp-slot-name{font-size:12px;font-weight:800;margin:0 0 4px}
.psp-swatches{display:flex;flex-wrap:wrap;gap:8px 7px;padding:4px}
.psp-sw{width:30px;height:30px;padding:0;border:0;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.24)}
.psp-sw[aria-pressed="true"],.psp-default[aria-pressed="true"]{box-shadow:inset 0 0 0 1px rgba(0,0,0,.24),0 0 0 2px #fffaf0,0 0 0 4px var(--ink,#4a3b2a)}
.psp-default{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px 0 4px;border:0;border-radius:15px;background:#fffaf0;font-size:12px;font-weight:700;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.psp-dot{width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.24)}
@media (pointer:coarse),(max-width:760px){.psp-sw{width:36px;height:36px}.psp-default{height:36px;border-radius:18px}.psp-dot{width:26px;height:26px}.psp-swatches{gap:9px 8px}}
@media (max-width:760px){
.psp-root{top:52px;right:12px;width:auto}
.psp-sheet{position:fixed;left:8px;right:8px;bottom:calc(var(--psp-stack,200px) + 8px);width:auto;max-height:40vh;max-height:40dvh;border-radius:18px;padding:6px 12px 8px}
.psp-items{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.psp-swatches{gap:6px}
}
`;

function injectStyle(doc) {
  if (doc.getElementById('ps-panel-style')) return;
  const s = doc.createElement('style'); s.id = 'ps-panel-style'; s.textContent = CSS; doc.head.appendChild(s);
}

const langOf = (lang) => (typeof lang === 'string' && lang.toLowerCase().startsWith('pl') ? 'pl' : 'en');
const fmtCm = (m) => String(Number((m * 100).toFixed(1))); // 1.4 -> "140", 0.455 -> "45.5"
// '#rrggbb' values match without regard to case; keys ('lib:oak', 'f:wood') match literally.
const isKey = (v) => /^(lib|f):/i.test(v);
const sameColor = (a, b) => typeof a === 'string' && typeof b === 'string' && (isKey(a) || isKey(b) ? a === b : a.toLowerCase() === b.toLowerCase());
const ROOM_DOT = { wall: '#ece6da', floor: '#bfa078' }; // the dot of the "Default" pill of a room: a room has no single default colour

// createPanel({ doc, host, lang, session }) -> { element, refresh(), setLang(lang), dispose() }
// `session` is the editing session (src/app/edit.js). The panel reads: selected() (a layout piece { id, type, size?, colors? } or null),
// problems() (list of { kind }), selectedRoom() ({ level, id, name, colors: { wall?, floor? } } or null; a piece and a room are never both
// selected), snapEdges(); and calls add(type), resize({ w, d, h }) in metres, recolor(slot, color | null), recolorRoom('wall' | 'floor',
// color | null), setSnapEdges(bool); subscribe(fn) tells it when to refresh and returns the function that stops it. Every method but
// selected/subscribe is optional: a section whose methods the session lacks does not appear.
export function createPanel({ doc = document, host, lang = 'en', session } = {}) {
  injectStyle(doc);
  let L = langOf(lang), S = STR[L];
  // On a phone the details of a selected piece start folded to their header: an open sheet would cover the model, and the piece could not be dragged.
  const narrow = () => { const w = doc.defaultView?.innerWidth; return typeof w === 'number' && w <= 760; };
  let open = false, selOpen = !narrow(), roomOpen = !narrow(), disposed = false, noteKey = null;
  const openGroups = new Set(); // ids of the expanded groups; the first one starts open
  let selSig = '', probSig = '', roomSig = '', snapOn = null, stackPx = null;
  let entries = new Map(); // catalogue entries by id, in the current language
  let fields = {}, slotRows = [], roomRows = [];

  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  const root = el('div', 'psp-root'); root.id = 'ps-panel';
  const toggle = button('psp-toggle'); toggle.setAttribute('aria-controls', 'psp-sheet'); toggle.setAttribute('aria-expanded', 'false');
  const plus = el('span', 'psp-plus', '+'); plus.setAttribute('aria-hidden', 'true');
  const toggleText = el('span', 'psp-toggle-text');
  toggle.append(plus, toggleText);
  const sheet = el('div', 'psp-sheet'); sheet.id = 'psp-sheet'; sheet.setAttribute('role', 'region');
  const addBox = el('section', 'psp-add'); addBox.id = 'psp-add';
  const head = el('div', 'psp-head'), title = el('h2', 'psp-title'), closeBtn = button('psp-close', '×');
  head.append(title, closeBtn);
  const note = el('p', 'psp-note'); note.setAttribute('role', 'status'); note.hidden = true;
  const groupsBox = el('div', 'psp-groups');
  addBox.append(head, note, groupsBox);
  const selBox = el('section', 'psp-sel');
  const selHead = button('psp-sel-head'), selText = el('span', 'psp-sel-text'), selKicker = el('span', 'psp-sel-kicker'), selName = el('span', 'psp-sel-name');
  selText.append(selKicker, selName);
  selHead.append(selText, el('span', 'psp-chev'));
  const problemsEl = el('ul', 'psp-problems'); problemsEl.setAttribute('aria-live', 'polite');
  const selBody = el('div', 'psp-sel-body');
  const sizesBox = el('div', 'psp-sizes'), slotsBox = el('div', 'psp-slots');
  selBody.append(sizesBox, slotsBox);
  selBox.append(selHead, problemsEl, selBody);
  const roomBox = el('section', 'psp-room');
  const roomHead = button('psp-sel-head'), roomText = el('span', 'psp-sel-text'), roomKicker = el('span', 'psp-sel-kicker'), roomName = el('span', 'psp-sel-name');
  roomText.append(roomKicker, roomName);
  roomHead.append(roomText, el('span', 'psp-chev'));
  const roomBody = el('div', 'psp-sel-body');
  roomBox.append(roomHead, roomBody);
  const optsBox = el('div', 'psp-opts');
  const snapBtn = button('psp-switch'), snapText = el('span', 'psp-switch-text');
  snapBtn.setAttribute('role', 'switch'); snapBtn.setAttribute('aria-checked', 'false');
  snapBtn.append(el('span', 'psp-knob'), snapText);
  optsBox.append(snapBtn);
  sheet.append(addBox, selBox, roomBox, optsBox);
  root.append(toggle, sheet);
  (host ?? doc.body).appendChild(root);

  // ---- the list of pieces to add
  function renderGroups() {
    clear(groupsBox);
    entries = new Map();
    const groups = catalogGroups(L);
    if (!openGroups.size && groups.length) openGroups.add(groups[0].group);
    for (const g of groups) {
      const wrap = el('div', 'psp-group'); wrap.dataset.group = g.group;
      const gh = button('psp-group-head'), list = el('div', 'psp-items');
      gh.id = `psp-gh-${g.group}`; list.id = `psp-gl-${g.group}`; gh.setAttribute('aria-controls', list.id);
      gh.append(el('span', 'psp-group-name', g.label), el('span', 'psp-count', String(g.items.length)), el('span', 'psp-chev'));
      const shown = () => { const on = openGroups.has(g.group); gh.setAttribute('aria-expanded', String(on)); list.hidden = !on; };
      shown();
      gh.addEventListener('click', () => { if (openGroups.has(g.group)) openGroups.delete(g.group); else openGroups.add(g.group); shown(); });
      for (const item of g.items) {
        entries.set(item.id, item);
        const b = button('psp-item'); b.dataset.id = item.id;
        b.append(el('span', 'psp-item-name', item.label));
        if (item.tier === 3) b.append(el('span', 'psp-tag', S.extra));
        const names = item.rooms.map((r) => S.rooms[r]).filter(Boolean);
        if (names.length) b.append(el('span', 'psp-item-rooms', names.slice(0, ROOMS_SHOWN).join(', ') + (names.length > ROOMS_SHOWN ? ` +${names.length - ROOMS_SHOWN}` : '')));
        b.addEventListener('click', () => addPiece(item.id));
        list.append(b);
      }
      wrap.append(gh, list); groupsBox.append(wrap);
    }
  }

  function addPiece(id) {
    const res = session.add(id);
    if (res && res.ok === false) noteKey = res.reason ?? 'other';
    else { noteKey = null; open = false; }
    refresh();
    if (!noteKey && pieceNow()) selHead.focus?.(); // the touched entry is hidden now: keep the keyboard focus in the panel
  }

  // ---- the selected piece
  const pieceNow = () => (typeof session.selected === 'function' ? session.selected() : null) ?? null;

  function onSize(axis, input) {
    const piece = pieceNow();
    if (!piece) return;
    const cur = (Array.isArray(piece.size) ? piece.size : defaultSizeOf(piece.type)).slice();
    const cm = Number(String(input.value).trim().replace(',', '.'));
    if (String(input.value).trim() === '' || !Number.isFinite(cm)) { input.value = fmtCm(cur[AX[axis]]); return; }
    const next = cur.slice(); next[AX[axis]] = cm / 100;
    const size = clampSize(piece.type, next);
    if (!size) return;
    input.value = fmtCm(size[AX[axis]]); // shows the value that was kept
    if (Math.abs(size[AX[axis]] - cur[AX[axis]]) < 0.0005) return;
    const res = session.resize({ w: size[0], d: size[1], h: size[2] });
    if (res && res.ok === false) input.value = fmtCm(cur[AX[axis]]); // the session kept the old size: show it
    refresh();
  }

  function recolor(slot, color) { session.recolor(slot, color); refresh(); }

  function buildSelected(piece) {
    clear(sizesBox); clear(slotsBox); fields = {}; slotRows = [];
    const entry = entries.get(piece.type);
    selKicker.textContent = S.selected;
    selName.textContent = entry ? entry.label : String(piece.type);
    selHead.setAttribute('aria-label', `${S.selected}: ${selName.textContent}. ${S.collapse}`);
    if (!entry) return;
    const axes = resizableAxes(piece.type);
    for (const ax of axes) {
      const lab = el('label', 'psp-field'), name = el('span', 'psp-field-name', `${S.axis[ax]} (${S.cm})`);
      const input = el('input', 'psp-num'); input.type = 'number'; input.dataset.axis = ax;
      const [lo, hi] = entry.range[ax];
      input.setAttribute('min', String(Math.ceil(lo * 100 - 1e-6))); input.setAttribute('max', String(Math.floor(hi * 100 + 1e-6)));
      input.setAttribute('step', '1'); input.setAttribute('inputmode', 'decimal');
      input.addEventListener('change', () => onSize(ax, input));
      lab.append(name, input); sizesBox.append(lab); fields[ax] = input;
    }
    sizesBox.hidden = axes.length === 0;
    for (const slot of entry.slots) {
      const pal = paletteOf(piece.type, slot.name);
      const list = (pal ? pal.colors : []).map((c) => ({ value: c.hex, swatch: c.swatch ?? c.hex, title: c.name[L] }));
      const bar = makeBar(slot.name, slot.label, defaultColorOf(piece.type, slot.name), list, (v) => recolor(slot.name, v));
      slotsBox.append(bar.row); slotRows.push(bar);
    }
  }

  // One colour bar: the "Default" pill (pick(null)) and one swatch per list entry { value, swatch, title } (pick(value)).
  function makeBar(slotName, label, base, list, pick) {
    const row = el('div', 'psp-slot'), name = el('div', 'psp-slot-name', label), bar = el('div', 'psp-swatches');
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', label); bar.setAttribute('role', 'presentation');
    const def = button('psp-default'), dot = el('span', 'psp-dot'), defLabel = el('span', 'psp-default-text', S.defaultColour);
    dot.style.background = base ?? 'transparent';
    def.title = `${S.defaultTitle}${base ? ` (${base})` : ''}`; def.setAttribute('aria-label', `${label}: ${S.defaultTitle}`);
    def.dataset.slot = slotName; def.append(dot, defLabel);
    def.addEventListener('click', () => pick(null));
    def.setAttribute('aria-pressed', 'false');
    bar.append(def);
    const sws = [];
    for (const c of list) {
      const b = button('psp-sw'); b.dataset.slot = slotName; b.dataset.color = c.value;
      b.style.background = c.swatch; b.title = c.title; b.setAttribute('aria-label', `${label}: ${c.title}`); b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => pick(c.value));
      bar.append(b); sws.push({ b, value: c.value, on: false });
    }
    row.append(name, bar);
    return { slot: slotName, row, def, defOn: false, sws };
  }

  // Marks the pill or the swatch that matches `cur` (a colour, a library key or nothing).
  function syncBar(row, cur) {
    const none = cur === undefined || cur === null;
    if (row.defOn !== none) { row.defOn = none; row.def.setAttribute('aria-pressed', String(none)); }
    for (const sw of row.sws) {
      const on = !none && sameColor(cur, sw.value);
      if (sw.on !== on) { sw.on = on; sw.b.setAttribute('aria-pressed', String(on)); }
    }
  }

  // ---- the selected room
  const roomNow = () => (typeof session.selectedRoom === 'function' ? session.selectedRoom() : null) ?? null;

  function buildRoom(room) {
    clear(roomBody); roomRows = [];
    roomKicker.textContent = S.room;
    roomName.textContent = String(room.name ?? room.id);
    roomHead.setAttribute('aria-label', `${S.room}: ${roomName.textContent}. ${S.collapseRoom}`);
    for (const part of ['wall', 'floor']) {
      const list = (roomPalette(part, L) ?? []).map((e) => ({ value: e.value, swatch: e.swatch, title: e.name }));
      const bar = makeBar(part, part === 'wall' ? S.walls : S.floor, ROOM_DOT[part], list, (v) => { if (typeof session.recolorRoom === 'function') session.recolorRoom(part, v); refresh(); });
      roomBody.append(bar.row); roomRows.push(bar);
    }
  }

  function syncRoom(room) {
    const colors = room.colors && typeof room.colors === 'object' ? room.colors : {};
    for (const row of roomRows) syncBar(row, colors[row.slot]);
  }

  function syncSnap() {
    const has = typeof session.snapEdges === 'function' && typeof session.setSnapEdges === 'function';
    optsBox.hidden = !has;
    if (!has) return;
    const on = !!session.snapEdges();
    if (on !== snapOn) { snapOn = on; snapBtn.setAttribute('aria-checked', String(on)); }
  }

  // The sheet of a phone sits above the page's own bars: the page publishes their height as --ps-stack-h on the root element
  // (a number of pixels, with or without "px"); 200 px is assumed while it is missing.
  function syncStack() {
    const de = doc.documentElement, view = doc.defaultView;
    if (!de || !view || typeof view.getComputedStyle !== 'function' || !root.style || typeof root.style.setProperty !== 'function') return;
    const n = parseFloat(view.getComputedStyle(de).getPropertyValue('--ps-stack-h'));
    const px = Number.isFinite(n) && n >= 0 ? Math.round(n) : 200;
    if (px !== stackPx) { stackPx = px; root.style.setProperty('--psp-stack', `${px}px`); }
  }

  function syncSelected(piece) {
    const size = Array.isArray(piece.size) ? piece.size : defaultSizeOf(piece.type) ?? [];
    for (const [ax, input] of Object.entries(fields)) {
      if (doc.activeElement === input) continue; // do not overwrite what the person is typing
      const v = fmtCm(size[AX[ax]]);
      if (input.value !== v) input.value = v;
    }
    const colors = piece.colors && typeof piece.colors === 'object' ? piece.colors : {};
    for (const row of slotRows) syncBar(row, colors[row.slot]);
    const list = (typeof session.problems === 'function' ? session.problems() : null) ?? [];
    const sig = `${L}|${list.map((p) => p.kind).join(',')}`;
    if (sig !== probSig) {
      probSig = sig; clear(problemsEl);
      for (const p of list) {
        const text = S.problems[p.kind];
        if (!text) continue;
        problemsEl.append(el('li', HARD.includes(p.kind) ? 'psp-bad' : 'psp-warn', text));
      }
    }
  }

  function syncShell(piece, room) {
    const has = !!piece, inRoom = !!room;
    root.dataset.open = open ? '1' : '0'; root.dataset.sel = has ? '1' : '0'; root.dataset.room = inRoom ? '1' : '0';
    toggle.setAttribute('aria-expanded', String(open));
    addBox.hidden = !open; selBox.hidden = !has; roomBox.hidden = !inRoom; sheet.hidden = !(open || has || inRoom);
    selBody.hidden = !selOpen; selHead.setAttribute('aria-expanded', String(selOpen));
    roomBody.hidden = !roomOpen; roomHead.setAttribute('aria-expanded', String(roomOpen));
    note.hidden = !noteKey; // a refusal stays visible until the next successful add or the next opening
    note.textContent = noteKey ? (S.fail[noteKey] ?? S.fail.other) : '';
  }

  function texts() {
    toggleText.textContent = S.add; toggle.title = S.addTitle; toggle.setAttribute('aria-label', S.addTitle);
    title.textContent = S.listTitle; closeBtn.setAttribute('aria-label', S.close); closeBtn.title = S.close;
    sheet.setAttribute('aria-label', S.panel);
    snapText.textContent = S.snap; snapBtn.title = S.snapTitle; snapBtn.setAttribute('aria-label', S.snap);
  }

  // ---- events
  toggle.addEventListener('click', () => { open = !open; if (open) noteKey = null; refresh(); });
  closeBtn.addEventListener('click', () => { open = false; refresh(); toggle.focus?.(); });
  selHead.addEventListener('click', () => { selOpen = !selOpen; refresh(); });
  roomHead.addEventListener('click', () => { roomOpen = !roomOpen; refresh(); });
  snapBtn.addEventListener('click', () => { if (typeof session.setSnapEdges === 'function') session.setSnapEdges(!session.snapEdges()); refresh(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { open = false; refresh(); toggle.focus?.(); } });
  const view = doc.defaultView;
  const onResize = () => syncStack();
  if (view && typeof view.addEventListener === 'function') view.addEventListener('resize', onResize);

  function refresh() {
    if (disposed) return;
    const piece = pieceNow();
    const room = piece ? null : roomNow(); // a piece and a room exclude each other; the piece wins if a session reports both
    const sig = piece ? `${piece.id}\u0001${piece.type}` : '';
    if (sig !== selSig) {
      selSig = sig; probSig = '';
      if (piece) buildSelected(piece); else { clear(sizesBox); clear(slotsBox); clear(problemsEl); fields = {}; slotRows = []; }
    }
    if (piece) syncSelected(piece);
    const rsig = room ? `${room.level}\u0001${room.id}\u0001${room.name}` : '';
    if (rsig !== roomSig) {
      roomSig = rsig;
      if (room) buildRoom(room); else { clear(roomBody); roomRows = []; }
    }
    if (room) syncRoom(room);
    syncSnap();
    syncShell(piece, room);
    syncStack();
  }

  function setLang(next) {
    const n = langOf(next);
    if (n === L) return;
    L = n; S = STR[L]; selSig = ''; roomSig = '';
    texts(); renderGroups(); refresh();
  }

  const unsubscribe = typeof session.subscribe === 'function' ? session.subscribe(() => refresh()) : null;
  texts(); renderGroups(); refresh();

  return {
    element: root,
    refresh,
    setLang,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      if (view && typeof view.removeEventListener === 'function') view.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}
