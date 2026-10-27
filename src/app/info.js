// What the plain page tells about the plan on show: the card of a piece that was tapped (its name, where it stands, its size in millimetres) and the list of rooms with
// their areas. Pure functions, no DOM and no three.js: tested in Node. The data is neutral (numbers, ids and the names the plan carries); the words come from INFO_TEXT
// for a language, so a change of language redraws both without asking the page again (dock.js draws them).
import { specOf } from '../furniture/specs.js';
import { listedArea, formatArea } from '../model/areas.js';
import { levelLabel } from './floors.js';

const langOf = (lang) => (lang === 'pl' ? 'pl' : 'en');

export const INFO_TEXT = {
  en: {
    card: 'Piece of furniture', close: 'Close', closeCard: 'Close the card', unit: 'mm', dims: { w: 'width', d: 'depth', h: 'height' },
    rooms: 'Rooms', roomsTitle: 'Show the list of rooms with their areas', roomsCloseTitle: 'Hide the list of rooms', closeRooms: 'Hide the list of rooms',
    total: 'Total', empty: 'There are no rooms in this plan.', emptyFloor: 'There are no rooms on this floor.', pickRoom: 'Show this room on the plan', unpickRoom: 'Stop showing this room',
    estimate: '~ worked out from the drawing', balcony: 'Balconies are not counted in the total.',
  },
  pl: {
    card: 'Mebel', close: 'Zamknij', closeCard: 'Zamknij kartę', unit: 'mm', dims: { w: 'szer.', d: 'głęb.', h: 'wys.' },
    rooms: 'Pokoje', roomsTitle: 'Pokaż listę pokoi z metrażami', roomsCloseTitle: 'Ukryj listę pokoi', closeRooms: 'Ukryj listę pokoi',
    total: 'Razem', empty: 'W tym planie nie ma pokoi.', emptyFloor: 'Na tym piętrze nie ma pokoi.', pickRoom: 'Pokaż ten pokój na planie', unpickRoom: 'Przestań pokazywać ten pokój',
    estimate: '~ policzone z rysunku', balcony: 'Balkony nie wchodzą do sumy.',
  },
};

const MM = (m) => Math.round(m * 1000);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// The card of a piece of the layout: what it is, where it stands (the room, and the floor when the plan has more than one) and its size. `levelId` is the level the piece
// stands on; `model` is the built model (for the names of the room and the floor). null for something that is not a piece with a size.
export function pieceInfo(piece, levelId, model) {
  if (!piece || !Array.isArray(piece.size) || piece.size.length !== 3 || !piece.size.every(fin)) return null;
  const levels = model?.levels ?? [], at = levels.findIndex((l) => l.id === levelId), level = at >= 0 ? levels[at] : null;
  const room = level?.rooms?.find((r) => r.id === piece.room) ?? null;
  return {
    id: piece.id, type: piece.type, size: [...piece.size], mm: piece.size.map(MM),
    room: room ? String(room.name || room.id) : null,
    level: level ? { id: level.id, name: level.name, index: at } : null, levels: levels.length,
  };
}

// The words of the card: { title, where, dims: [{ key, label, value }], unit, text } (text is the whole card in one line, for a screen reader).
export function cardView(info, lang = 'en') {
  const L = langOf(lang), T = INFO_TEXT[L], spec = specOf(info.type);
  const title = spec ? spec.label[L] : String(info.type ?? T.card);
  const floor = info.levels >= 2 && info.level ? levelLabel(info.level.name, info.level.index, L, info.level.id) : null;
  const where = [info.room, floor].filter(Boolean).join(', ');
  const dims = ['w', 'd', 'h'].map((key, i) => ({ key, label: T.dims[key], value: String(info.mm[i]) }));
  return { title, where, dims, unit: T.unit, text: `${title}${where ? `, ${where}` : ''}: ${dims.map((d) => `${d.label} ${d.value}`).join(', ')} ${T.unit}` };
}

// The rooms of the floors on show: { groups: [{ level: { id, name, index }, rooms: [{ id, name, m2, estimated, balcony }], m2, estimated }], levels, shown, m2, estimated, rooms, balconies }
// (levels: the floors of the plan, shown: how many of them are on show).
// `flags` says per level whether it is on show (floors.js visibleFlags), null for all. A room without a polygon or with no area is left out. The area of a room is what the
// list may show (model/areas.js listedArea: the declared figure when the drawing agrees with it, else worked out from the drawing). The total leaves out the balconies
// (`use: 'balcony'`): in a flat the usable area is counted without them.
export function roomsData(model, flags = null) {
  const levels = model?.levels ?? [], groups = [];
  let m2 = 0, estimated = false, rooms = 0, balconies = 0, shown = 0;
  levels.forEach((lv, index) => {
    if (flags && flags[index] === false) return;
    shown++;
    const list = [];
    let gm2 = 0, gest = false;
    for (const r of lv.rooms ?? []) {
      if (!Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      const a = listedArea(r, lv.walls ?? []);
      if (!(a.m2 > 0)) continue;
      const balcony = r.use === 'balcony';
      list.push({ id: r.id, name: String(r.name || r.id), m2: a.m2, estimated: !!a.estimated, balcony });
      rooms++;
      if (balcony) { balconies++; continue; }
      gm2 += a.m2; gest = gest || !!a.estimated;
    }
    if (!list.length) return;
    groups.push({ level: { id: lv.id, name: lv.name, index }, rooms: list, m2: gm2, estimated: gest });
    m2 += gm2; estimated = estimated || gest;
  });
  return { groups, levels: levels.length, shown, m2, estimated, rooms, balconies };
}

// The words of the list: { groups: [{ key, title, area, rooms: [{ level, id, name, area, balcony }] }], total (the text, or '' when there is nothing to add up), notes: [text], empty, emptyText }.
// A floor gets a heading (with its own total) when the plan has two or more; an estimate or a balcony gets a note once. With no rooms on show, emptyText says so for the plan, or
// for the floor when the plan has more floors than are on show (one floor picked, and it has no rooms: the others may have).
export function roomsView(data, lang = 'en') {
  const L = langOf(lang), T = INFO_TEXT[L], many = data.levels >= 2;
  const groups = data.groups.map((g) => ({
    key: g.level.id,
    title: many ? levelLabel(g.level.name, g.level.index, L, g.level.id) : '',
    area: many && g.m2 > 0 ? formatArea(g.m2, g.estimated, L) : '',
    rooms: g.rooms.map((r) => ({ level: g.level.id, id: r.id, name: r.name, area: formatArea(r.m2, r.estimated, L), balcony: r.balcony })),
  }));
  const anyEstimate = data.groups.some((g) => g.rooms.some((r) => r.estimated));
  const notes = [];
  if (anyEstimate) notes.push(T.estimate);
  if (data.balconies > 0) notes.push(T.balcony);
  const emptyText = many && data.shown < data.levels ? T.emptyFloor : T.empty;
  return { groups, total: data.m2 > 0 ? formatArea(data.m2, data.estimated, L) : '', notes, empty: data.rooms === 0, emptyText };
}
