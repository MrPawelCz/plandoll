// The dock: what the plain page (no editing) can show at the top of the picture. A card for the piece that was tapped (its name, where it stands, its size in
// millimetres) and the list of rooms with their areas. Plain DOM, no three.js, no network; the page (main.js) says what to show and gets told what was closed or picked.
// Texts in English and Polish (info.js); the styles are one <style id="ps-dock-style">. On a wide window the list sits at the left and the card at the right; on a narrow
// one both stack at the top, the card first, and the empty space between them lets the finger through to the model. A page that has its own marks in a corner moves the
// dock clear of them with three variables on the root element: --psd-top (the stack on a narrow window), --psd-list-top and --psd-card-top (the list and the card on a wide one).
// Both end above the control bar, which the page publishes as --ps-stack-h, except in a window lower than 480 px (a phone on its side): the bar takes nearly all of such a window, so
// the dock would be squeezed to a few pixels with its text spilling out, and there it floats over the bar instead (the close buttons give the bar back), leaving 64 px at the bottom
// for a mark of the page in that corner.
import { INFO_TEXT, cardView, roomsView } from './info.js';

export const DOCK_STYLE_ID = 'ps-dock-style';

const CSS = `
.psd-root,.psd-root *{box-sizing:border-box}
.psd-root{position:fixed;z-index:30;top:var(--psd-top,10px);left:10px;right:10px;max-height:calc(100vh - var(--ps-stack-h,0px) - var(--psd-top,10px) - 10px);max-height:calc(100dvh - var(--ps-stack-h,0px) - var(--psd-top,10px) - 10px);display:flex;flex-direction:column;align-items:stretch;gap:8px;pointer-events:none;font:13px/1.35 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink,#4a3b2a)}
.psd-root>*{pointer-events:auto}
.psd-root [hidden]{display:none!important}
.psd-card,.psd-rooms{position:relative;border-radius:18px;background:var(--paper,rgba(250,245,234,.9));border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 8px 24px rgba(40,28,12,.26);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.psd-card{flex:none;order:-1;padding:10px 6px 12px 14px}
.psd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.psd-titles{flex:1;min-width:0;padding-top:2px}
.psd-title,.psd-rooms-title{margin:0;font-size:15px;font-weight:800;line-height:1.25;overflow-wrap:anywhere}
.psd-where{margin:1px 0 0;font-size:12px;opacity:.72;overflow-wrap:anywhere}
.psd-close{flex:none;min-width:44px;min-height:44px;margin:-6px 0 -6px 0;padding:0;border:0;background:none;color:inherit;font:inherit;font-size:22px;line-height:1;border-radius:12px;cursor:pointer;touch-action:manipulation}
@media (hover:hover) and (pointer:fine){.psd-close:hover{background:rgba(200,121,58,.14)}}
.psd-close:focus-visible,.psd-row:focus-visible{outline:2px solid var(--accent,#c8793a);outline-offset:2px}
.psd-dimrow{display:flex;align-items:center;gap:8px;margin:8px 8px 0 0}
.psd-dims{display:flex;flex:1;min-width:0;gap:8px;margin:0;padding:0}
.psd-dim{display:flex;flex-direction:column-reverse;flex:1;min-width:0;padding:6px 6px 5px;border-radius:12px;background:#fffaf0;border:1px solid var(--line,rgba(120,96,64,.22));text-align:center}
.psd-dim dt{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.65}
.psd-dim dd{margin:0;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
.psd-unit{flex:none;font-weight:700;opacity:.7}
.psd-rooms{display:flex;flex:0 1 auto;flex-direction:column;min-height:0;max-height:46vh;max-height:46dvh;padding:8px 8px 6px 14px}
.psd-rooms-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.psd-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;margin-right:4px}
.psd-group-head{display:flex;justify-content:space-between;gap:8px;margin:8px 8px 2px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.65}
.psd-list{list-style:none;margin:0;padding:0}
.psd-row{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:36px;padding:4px 8px;border-radius:10px;cursor:pointer;touch-action:manipulation}
@media (pointer:coarse){.psd-row{min-height:44px}}
@media (hover:hover) and (pointer:fine){.psd-row:hover{background:rgba(200,121,58,.12)}}
.psd-close,.psd-row{transition:transform .12s cubic-bezier(.23,1,.32,1)}
.psd-close:active{transform:scale(.97)}
.psd-row:active{transform:scale(.985)}
.psd-row[aria-pressed="true"]{background:#fffaf0;box-shadow:inset 0 0 0 1px var(--accent,#c8793a)}
.psd-row-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.psd-row-area{flex:none;font-weight:800;font-variant-numeric:tabular-nums}
.psd-row[data-balcony="1"] .psd-row-area{opacity:.62;font-weight:700}
.psd-empty{margin:8px;opacity:.75}
.psd-total{display:flex;justify-content:space-between;gap:12px;margin:6px 12px 0 0;padding:8px 8px 4px;border-top:2px solid var(--line,rgba(120,96,64,.22));font-weight:800;font-variant-numeric:tabular-nums}
.psd-note{margin:0 12px 2px 8px;font-size:11px;opacity:.7}
@media (min-width:761px){
.psd-root{display:contents}
.psd-rooms{position:fixed;z-index:30;left:14px;top:var(--psd-list-top,14px);width:288px;max-height:min(60vh,calc(100vh - var(--ps-stack-h,150px) - var(--psd-list-top,14px) - 20px));max-height:min(60dvh,calc(100dvh - var(--ps-stack-h,150px) - var(--psd-list-top,14px) - 20px))}
.psd-card{position:fixed;z-index:31;right:14px;top:var(--psd-card-top,14px);width:288px}
}
@media (max-height:480px){
.psd-root{max-height:calc(100vh - var(--psd-top,10px) - 64px);max-height:calc(100dvh - var(--psd-top,10px) - 64px)}
}
@media (max-height:480px) and (min-width:761px){
.psd-rooms{max-height:min(60vh,calc(100vh - var(--psd-list-top,14px) - 64px));max-height:min(60dvh,calc(100dvh - var(--psd-list-top,14px) - 64px))}
}
`;

// handlers: onCardClose() (the close button of the card), onRoomsClose() (the close button of the list), onRoomPick({ level, id } | null) (a row was pressed: that room is
// to be shown on the plan, or null when the pressed row was the one on show already). The returned object draws what it is told; it never touches the plan itself.
export function createDock({ doc = document, host = doc.body, lang = 'en', onCardClose = () => {}, onRoomsClose = () => {}, onRoomPick = () => {} } = {}) {
  if (!doc.getElementById(DOCK_STYLE_ID)) { const s = doc.createElement('style'); s.id = DOCK_STYLE_ID; s.textContent = CSS; doc.head.appendChild(s); }
  let L = lang === 'pl' ? 'pl' : 'en', info = null, data = null, picked = null, rows = [], open = false;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const closeBtn = (action) => { const b = mk('button', 'psd-close', '×'); b.type = 'button'; b.addEventListener('click', () => action()); return b; };

  const root = mk('div', 'psd-root'); root.id = 'ps-dock';

  // the card of a piece
  const cardEl = mk('section', 'psd-card'); cardEl.id = 'ps-piece-card'; cardEl.hidden = true;
  cardEl.setAttribute('role', 'dialog'); cardEl.setAttribute('aria-modal', 'false'); cardEl.setAttribute('aria-live', 'polite'); cardEl.setAttribute('aria-atomic', 'true');
  const head = mk('div', 'psd-head'), titles = mk('div', 'psd-titles'), title = mk('h2', 'psd-title'), where = mk('p', 'psd-where'), cardClose = closeBtn(onCardClose);
  titles.append(title, where); head.append(titles, cardClose);
  const dimRow = mk('div', 'psd-dimrow'), dims = mk('dl', 'psd-dims'), unit = mk('span', 'psd-unit');
  dimRow.append(dims, unit); cardEl.append(head, dimRow);

  // the list of rooms: a heading with a close button, the rooms (scrolls when long), the total and the notes stay in view under them
  const roomsEl = mk('section', 'psd-rooms'); roomsEl.id = 'ps-rooms'; roomsEl.hidden = true;
  const rhead = mk('div', 'psd-rooms-head'), rtitle = mk('h2', 'psd-rooms-title'), roomsClose = closeBtn(onRoomsClose);
  rhead.append(rtitle, roomsClose);
  const body = mk('div', 'psd-body'), total = mk('div', 'psd-total'), totalName = mk('span'), totalArea = mk('span'), notes = mk('div', 'psd-notes');
  total.append(totalName, totalArea); total.hidden = true; notes.hidden = true;
  roomsEl.append(rhead, body, total, notes);
  root.append(cardEl, roomsEl);
  host.appendChild(root);

  function renderCard() {
    const T = INFO_TEXT[L];
    cardClose.setAttribute('aria-label', T.closeCard); cardClose.title = T.close;
    if (!info) { cardEl.hidden = true; return; }
    const v = cardView(info, L);
    title.textContent = v.title; where.textContent = v.where; where.hidden = !v.where;
    cardEl.setAttribute('aria-label', v.text);
    clear(dims);
    for (const d of v.dims) {
      const cell = mk('div', 'psd-dim'); cell.dataset.dim = d.key;
      cell.append(mk('dt', '', d.label), mk('dd', '', d.value));
      dims.append(cell);
    }
    unit.textContent = v.unit;
    cardEl.hidden = false;
  }

  function paintPicked() {
    const T = INFO_TEXT[L];
    for (const r of rows) {
      const on = !!picked && picked.level === r.level && picked.id === r.id;
      r.el.setAttribute('aria-pressed', String(on)); r.el.title = on ? T.unpickRoom : T.pickRoom;
    }
  }

  function renderRooms() {
    const T = INFO_TEXT[L];
    rtitle.textContent = T.rooms; roomsEl.setAttribute('aria-label', T.rooms);
    roomsClose.setAttribute('aria-label', T.closeRooms); roomsClose.title = T.roomsCloseTitle;
    clear(body); clear(notes); rows = [];
    if (!data) { total.hidden = true; notes.hidden = true; return; }
    const v = roomsView(data, L);
    if (v.empty) body.append(mk('p', 'psd-empty', v.emptyText));
    for (const g of v.groups) {
      const group = mk('div', 'psd-group');
      if (g.title) { const gh = mk('div', 'psd-group-head'); gh.append(mk('span', '', g.title), mk('span', '', g.area)); group.append(gh); }
      const list = mk('ul', 'psd-list');
      for (const r of g.rooms) {
        const item = mk('li'), b = mk('button', 'psd-row');
        b.type = 'button'; b.dataset.level = r.level; b.dataset.room = r.id; b.dataset.balcony = r.balcony ? '1' : '0';
        b.setAttribute('aria-label', `${r.name}, ${r.area}`);
        b.append(mk('span', 'psd-row-name', r.name), mk('span', 'psd-row-area', r.area));
        b.addEventListener('click', () => {
          const same = !!picked && picked.level === r.level && picked.id === r.id;
          picked = same ? null : { level: r.level, id: r.id };
          paintPicked(); onRoomPick(picked ? { ...picked } : null);
        });
        item.append(b); list.append(item); rows.push({ el: b, level: r.level, id: r.id });
      }
      group.append(list); body.append(group);
    }
    totalName.textContent = T.total; totalArea.textContent = v.total; total.hidden = !v.total;
    for (const n of v.notes) notes.append(mk('p', 'psd-note', n));
    notes.hidden = !v.notes.length;
    if (picked && !rows.some((r) => r.level === picked.level && r.id === picked.id)) picked = null;
    paintPicked();
  }

  renderCard(); renderRooms();
  return {
    element: root,
    get cardOpen() { return !!info; },
    get card() { return info; },
    get roomsOpen() { return open; },
    get picked() { return picked ? { ...picked } : null; },
    // the card of a piece (pieceInfo of info.js); null or hideCard() takes it away
    showCard(next) { info = next ?? null; renderCard(); },
    hideCard() { info = null; renderCard(); },
    // the rooms of the floors on show (roomsData of info.js); the pressed row stays pressed while its room is still in the list
    setRooms(next) { data = next ?? null; renderRooms(); },
    setRoomsOpen(on) { open = !!on; roomsEl.hidden = !open; },
    setPickedRoom(ref) { picked = ref ? { level: ref.level, id: ref.id } : null; paintPicked(); },
    setLang(next) { L = next === 'pl' ? 'pl' : 'en'; renderCard(); renderRooms(); },
    dispose() { root.remove(); },
  };
}
