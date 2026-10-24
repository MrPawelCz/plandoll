// Furniture contract: pure data, no three.js import. The layout engine (src/layout) reads sizes, clearances and rooms from here;
// the piece builders (src/furniture/pieces) build exactly these ids. Change an entry here first, then the code that uses it.
//
// Local frame of every piece: x = width, z = depth, y up (metres). The FRONT faces +z, the BACK is -z, so a piece placed
// "against the wall" has its back on the wall. Beds follow the same rule: headboard at -z, foot at +z, width along x.
// Origin: centre of the footprint at floor level (y = 0). Wall-mounted pieces (art, mirror, upper cabinets) keep y = 0 at the
// piece's own bottom edge; `place.elevation` is the height of that edge above the floor.
// `size` is [w, d, h]. `range` lists the sizes the editor may reach as [min, max] per axis (a missing axis is fixed).
// `slots` are the named material slots of the piece (the editor recolours a slot, not a mesh): every slot listed must exist
// on the built object as a mesh whose userData.slot equals the slot name.

export const ROOM_TYPES = ['living', 'dining', 'kitchen', 'bedroom', 'kids', 'bath', 'wc', 'hall', 'office', 'utility', 'balcony', 'storage'];
export const GROUPS = ['living', 'dining', 'sleep', 'work', 'kitchen', 'bath', 'hall', 'decor'];
// place.mode: floor (stands on the floor), floor-flat (lies on the floor and does not block: rugs), corner (prefers a room corner),
// wall-mount (hangs on a wall at place.elevation), window (follows an opening), ceiling (hangs from the ceiling, place.drop = length of
// the hanging part), surface (sits on top of another piece, place.onTop lists the ids it may sit on).
// place.against: back (back touches a wall), free (anywhere), back-or-free.
export const PLACE_MODES = ['floor', 'floor-flat', 'corner', 'wall-mount', 'window', 'ceiling', 'surface'];

const DEFAULT_TRIS = 6000;
function P(id, group, tier, en, pl, size, o = {}) {
  return {
    id, group, tier, label: { en, pl }, size,
    range: o.range ?? {},
    place: { mode: 'floor', against: 'back-or-free', clearFront: 0, clearSide: 0, ...(o.place ?? {}) },
    rooms: o.rooms ?? [],
    tall: o.tall ?? size[2] >= 1.2,
    slots: o.slots ?? [],
    emits: o.emits ?? null,
    maxTris: o.maxTris ?? DEFAULT_TRIS,
    legacy: o.legacy ?? null,
  };
}

export const SPECS = [
  // ---- living, dining, sleeping, working and decor ----
  P('sofa2', 'living', 1, 'Two-seat sofa', 'Sofa 2-osobowa', [1.6, 0.9, 0.85], { range: { w: [1.4, 1.9] }, place: { clearFront: 0.9 }, rooms: ['living'], slots: ['upholstery', 'legs', 'cushions'], legacy: 'sofa' }),
  P('sofa3', 'living', 1, 'Three-seat sofa', 'Sofa 3-osobowa', [2.1, 0.95, 0.85], { range: { w: [1.9, 2.8] }, place: { clearFront: 0.9 }, rooms: ['living'], slots: ['upholstery', 'legs', 'cushions'], legacy: 'sofa' }),
  P('armchair', 'living', 1, 'Armchair', 'Fotel', [0.85, 0.85, 0.85], { place: { against: 'free', clearFront: 0.6 }, rooms: ['living', 'bedroom', 'office'], slots: ['upholstery', 'legs', 'cushion'], legacy: 'sofa' }),
  P('coffee-table', 'living', 1, 'Coffee table', 'Stolik kawowy', [1.1, 0.6, 0.4], { range: { w: [0.8, 1.4], d: [0.5, 0.8] }, place: { against: 'free' }, rooms: ['living'], slots: ['top', 'frame'], legacy: 'table' }),
  P('tv-unit', 'living', 1, 'TV unit', 'Szafka RTV', [1.6, 0.4, 0.5], { range: { w: [1.2, 2.4] }, place: { against: 'back', clearFront: 1.5 }, rooms: ['living', 'bedroom'], slots: ['body', 'top', 'legs'], legacy: 'tvunit' }),
  P('tv', 'living', 1, 'Television', 'Telewizor', [1.1, 0.06, 0.65], { place: { mode: 'surface', against: 'back', onTop: ['tv-unit'] }, rooms: ['living', 'bedroom'], slots: ['screen', 'frame'], maxTris: 800 }),
  P('bookshelf', 'living', 1, 'Bookshelf', 'Regał', [0.9, 0.32, 1.9], { range: { w: [0.6, 1.8], h: [1.2, 2.4] }, place: { against: 'back', clearFront: 0.5 }, rooms: ['living', 'bedroom', 'office', 'hall'], slots: ['body', 'books'], maxTris: 12000, legacy: 'bookshelf' }),
  P('rug', 'living', 1, 'Rug', 'Dywan', [2.4, 1.7, 0.015], { range: { w: [1.2, 3.4], d: [0.8, 2.6] }, place: { mode: 'floor-flat', against: 'free' }, rooms: ['living', 'bedroom', 'dining', 'kids'], slots: ['fabric', 'border'], tall: false, maxTris: 1500, legacy: 'rug' }),
  P('floor-lamp', 'decor', 1, 'Floor lamp', 'Lampa stojąca', [0.35, 0.35, 1.6], { place: { mode: 'corner', against: 'free' }, rooms: ['living', 'bedroom', 'office'], slots: ['base', 'shade'], emits: { kind: 'point', color: '#ffd9a0', power: 1 }, maxTris: 2500 }),
  P('plant-large', 'decor', 1, 'Large plant', 'Duża roślina', [0.55, 0.55, 1.3], { range: { h: [0.9, 1.8] }, place: { mode: 'corner', against: 'free' }, rooms: ['living', 'bedroom', 'office', 'hall', 'dining'], slots: ['pot', 'leaves'], maxTris: 12000, legacy: 'plant' }),
  P('plant-small', 'decor', 1, 'Small plant', 'Mała roślina', [0.25, 0.25, 0.4], { place: { mode: 'surface', against: 'free', onTop: ['coffee-table', 'dining-table', 'bookshelf', 'dresser', 'sideboard', 'desk', 'nightstand', 'tv-unit'] }, rooms: ['living', 'dining', 'bedroom', 'office', 'kitchen', 'bath'], slots: ['pot', 'leaves'], tall: false, maxTris: 6000, legacy: 'plant' }),
  P('art-large', 'decor', 1, 'Large picture', 'Duży obraz', [0.9, 0.03, 1.2], { place: { mode: 'wall-mount', against: 'back', elevation: 0.85 }, rooms: ['living', 'bedroom', 'hall', 'dining'], slots: ['frame', 'canvas'], tall: false, maxTris: 800 }),
  P('art-small', 'decor', 1, 'Small picture', 'Mały obraz', [0.5, 0.03, 0.7], { place: { mode: 'wall-mount', against: 'back', elevation: 1.1 }, rooms: ['living', 'bedroom', 'hall', 'dining', 'office'], slots: ['frame', 'canvas'], tall: false, maxTris: 800 }),
  P('mirror', 'decor', 1, 'Mirror', 'Lustro', [0.6, 0.03, 1.6], { range: { w: [0.4, 1.2], h: [0.5, 1.8] }, place: { mode: 'wall-mount', against: 'back', elevation: 0.2 }, rooms: ['hall', 'bedroom', 'bath'], slots: ['frame', 'glass'], tall: false, maxTris: 800 }),
  P('curtain', 'decor', 1, 'Curtain', 'Zasłona', [1.6, 0.12, 2.5], { range: { w: [0.6, 4.0], h: [1.0, 3.2] }, place: { mode: 'window', against: 'back' }, rooms: ['any'], slots: ['fabric', 'rod'], tall: true, maxTris: 6000 }),
  P('table-lamp', 'decor', 1, 'Table lamp', 'Lampka', [0.25, 0.25, 0.45], { place: { mode: 'surface', against: 'free', onTop: ['nightstand', 'dresser', 'sideboard', 'desk', 'tv-unit', 'bookshelf'] }, rooms: ['living', 'bedroom', 'office', 'hall'], slots: ['base', 'shade'], emits: { kind: 'point', color: '#ffcf8a', power: 0.5 }, tall: false, maxTris: 2500 }),
  P('pendant', 'decor', 1, 'Pendant lamp', 'Lampa wisząca', [0.5, 0.5, 0.45], { place: { mode: 'ceiling', against: 'free', drop: 0.45, elevation: 2.0 }, rooms: ['dining', 'living', 'kitchen', 'hall'], slots: ['shade', 'cord'], emits: { kind: 'point', color: '#ffd9a0', power: 0.8 }, tall: false, maxTris: 2500 }),
  P('dining-table', 'dining', 1, 'Dining table', 'Stół jadalny', [1.6, 0.9, 0.75], { range: { w: [1.2, 2.4], d: [0.8, 1.1] }, place: { against: 'free', clearSide: 0.8 }, rooms: ['dining', 'kitchen', 'living'], slots: ['top', 'legs'], tall: false, legacy: 'table' }),
  P('dining-chair', 'dining', 1, 'Dining chair', 'Krzesło', [0.45, 0.5, 0.9], { place: { against: 'free' }, rooms: ['dining', 'kitchen', 'living'], slots: ['seat', 'frame'], tall: false, maxTris: 3000, legacy: 'chair' }),
  P('bed-double', 'sleep', 1, 'Double bed', 'Łóżko podwójne', [1.6, 2.0, 0.55], { range: { w: [1.4, 1.8], d: [1.9, 2.1] }, place: { against: 'back', clearFront: 0.7, clearSide: 0.5 }, rooms: ['bedroom'], slots: ['frame', 'bedding', 'pillows', 'throw'], tall: false, maxTris: 9000, legacy: 'bed' }),
  P('bed-single', 'sleep', 1, 'Single bed', 'Łóżko pojedyncze', [0.9, 2.0, 0.5], { range: { w: [0.8, 1.0] }, place: { against: 'back', clearFront: 0.7, clearSide: 0.4 }, rooms: ['bedroom', 'kids'], slots: ['frame', 'bedding', 'pillows'], tall: false, maxTris: 7000, legacy: 'bed' }),
  P('nightstand', 'sleep', 1, 'Nightstand', 'Szafka nocna', [0.45, 0.4, 0.5], { place: { against: 'back', clearFront: 0.4 }, rooms: ['bedroom', 'kids'], slots: ['body', 'top', 'handles'], tall: false, maxTris: 3000 }),
  P('wardrobe', 'sleep', 1, 'Wardrobe', 'Szafa', [1.8, 0.6, 2.2], { range: { w: [0.9, 3.2], h: [1.8, 2.5] }, place: { against: 'back', clearFront: 0.9 }, rooms: ['bedroom', 'hall', 'kids'], slots: ['body', 'doors', 'handles'], legacy: 'wardrobe' }),
  P('dresser', 'sleep', 1, 'Chest of drawers', 'Komoda', [1.2, 0.5, 0.85], { range: { w: [0.8, 1.6] }, place: { against: 'back', clearFront: 0.8 }, rooms: ['bedroom', 'hall', 'kids'], slots: ['body', 'top', 'handles'], tall: false, maxTris: 4000 }),
  P('desk', 'work', 1, 'Desk', 'Biurko', [1.3, 0.65, 0.75], { range: { w: [1.0, 1.8] }, place: { against: 'back', clearFront: 0.9 }, rooms: ['office', 'bedroom', 'kids', 'living'], slots: ['top', 'frame'], tall: false, legacy: 'desk' }),
  P('desk-chair', 'work', 1, 'Desk chair', 'Krzesło biurowe', [0.55, 0.55, 0.95], { place: { against: 'free' }, rooms: ['office', 'bedroom', 'kids', 'living'], slots: ['upholstery', 'base'], tall: false, maxTris: 3500, legacy: 'chair' }),

  // ---- kitchen and bathroom ----
  P('kitchen-base', 'kitchen', 2, 'Base cabinet', 'Szafka dolna', [0.6, 0.6, 0.9], { range: { w: [0.3, 1.2] }, place: { against: 'back', clearFront: 1.0 }, rooms: ['kitchen'], slots: ['body', 'fronts', 'worktop', 'handles'], tall: false, maxTris: 4000, legacy: 'counter' }),
  P('kitchen-sink', 'kitchen', 2, 'Sink cabinet', 'Szafka ze zlewem', [1.2, 0.6, 1.1], { range: { w: [0.8, 1.6], h: [1.05, 1.2] }, place: { against: 'back', clearFront: 1.0 }, rooms: ['kitchen'], slots: ['body', 'fronts', 'worktop', 'basin', 'tap'], tall: false, maxTris: 5000, legacy: 'counter' }),
  P('kitchen-hob', 'kitchen', 2, 'Hob cabinet', 'Szafka z płytą', [0.6, 0.6, 0.9], { range: { w: [0.6, 0.9] }, place: { against: 'back', clearFront: 1.0 }, rooms: ['kitchen'], slots: ['body', 'fronts', 'worktop', 'hob', 'handles'], tall: false, maxTris: 4500, legacy: 'stove' }),
  P('kitchen-upper', 'kitchen', 2, 'Wall cabinet', 'Szafka wisząca', [0.6, 0.35, 0.7], { range: { w: [0.3, 1.2] }, place: { mode: 'wall-mount', against: 'back', elevation: 1.45 }, rooms: ['kitchen'], slots: ['body', 'fronts', 'handles'], tall: false, maxTris: 3000, legacy: 'counter' }),
  P('fridge', 'kitchen', 2, 'Fridge-freezer', 'Lodówka', [0.6, 0.65, 1.85], { range: { h: [0.85, 2.0] }, place: { against: 'back', clearFront: 0.9 }, rooms: ['kitchen'], slots: ['body', 'handle'], maxTris: 3000, legacy: 'fridge' }),
  P('toilet', 'bath', 2, 'Toilet', 'Toaleta', [0.38, 0.7, 0.78], { place: { against: 'back', clearFront: 0.6, clearSide: 0.2 }, rooms: ['bath', 'wc'], slots: ['ceramic', 'seat'], tall: false, maxTris: 4500, legacy: 'toilet' }),
  P('washbasin', 'bath', 2, 'Washbasin with vanity', 'Umywalka z szafką', [0.65, 0.5, 0.85], { range: { w: [0.45, 1.2] }, place: { against: 'back', clearFront: 0.7 }, rooms: ['bath', 'wc'], slots: ['vanity', 'basin', 'tap'], tall: false, maxTris: 4500, legacy: 'basin' }),
  P('shower', 'bath', 2, 'Shower', 'Prysznic', [0.9, 0.9, 2.05], { range: { w: [0.8, 1.2], d: [0.8, 1.2] }, place: { mode: 'corner', against: 'back', clearFront: 0.6 }, rooms: ['bath'], slots: ['tray', 'glass', 'fittings'], maxTris: 4000, legacy: 'shower' }),
  P('bathtub', 'bath', 2, 'Bathtub', 'Wanna', [1.7, 0.75, 0.58], { range: { w: [1.5, 1.9] }, place: { against: 'back', clearFront: 0.6 }, rooms: ['bath'], slots: ['shell', 'fittings'], tall: false, maxTris: 5000, legacy: 'bathtub' }),
  P('washing-machine', 'bath', 2, 'Washing machine', 'Pralka', [0.6, 0.6, 0.85], { place: { against: 'back', clearFront: 0.7 }, rooms: ['bath', 'utility', 'kitchen'], slots: ['body', 'door'], tall: false, maxTris: 3000 }),

  // ---- extras ----
  P('sideboard', 'dining', 3, 'Sideboard', 'Kredens', [1.6, 0.42, 0.8], { range: { w: [1.0, 2.2] }, place: { against: 'back', clearFront: 0.7 }, rooms: ['dining', 'living', 'hall'], slots: ['body', 'top', 'handles'], tall: false, maxTris: 4000 }),
  P('vase', 'decor', 3, 'Vase', 'Wazon', [0.15, 0.15, 0.3], { place: { mode: 'surface', against: 'free', onTop: ['coffee-table', 'dining-table', 'sideboard', 'dresser', 'bookshelf', 'tv-unit'] }, rooms: ['living', 'dining', 'bedroom', 'hall'], slots: ['body', 'stems'], tall: false, maxTris: 2000 }),
  P('books-stack', 'decor', 3, 'Stack of books', 'Stos książek', [0.24, 0.18, 0.1], { place: { mode: 'surface', against: 'free', onTop: ['coffee-table', 'nightstand', 'desk', 'sideboard'] }, rooms: ['living', 'bedroom', 'office'], slots: ['books'], tall: false, maxTris: 800 }),
  P('centerpiece', 'decor', 3, 'Table centrepiece', 'Dekoracja stołu', [0.3, 0.3, 0.2], { place: { mode: 'surface', against: 'free', onTop: ['dining-table'] }, rooms: ['dining', 'kitchen'], slots: ['bowl', 'fruit'], tall: false, maxTris: 2500 }),
  P('bed-king', 'sleep', 3, 'King bed', 'Łóżko king size', [1.8, 2.0, 0.55], { place: { against: 'back', clearFront: 0.7, clearSide: 0.5 }, rooms: ['bedroom'], slots: ['frame', 'bedding', 'pillows', 'throw'], tall: false, maxTris: 9000, legacy: 'bed' }),
  P('coffee-table-round', 'living', 3, 'Round coffee table', 'Okrągły stolik', [0.8, 0.8, 0.42], { range: { w: [0.6, 1.0], d: [0.6, 1.0] }, place: { against: 'free' }, rooms: ['living'], slots: ['top', 'frame'], tall: false, legacy: 'table' }),
  P('rug-runner', 'decor', 3, 'Runner rug', 'Chodnik', [0.8, 2.4, 0.012], { range: { w: [0.6, 1.0], d: [1.2, 4.0] }, place: { mode: 'floor-flat', against: 'free' }, rooms: ['hall', 'kitchen'], slots: ['fabric', 'border'], tall: false, maxTris: 1200, legacy: 'rug' }),
  P('shoe-cabinet', 'hall', 3, 'Shoe cabinet', 'Szafka na buty', [0.8, 0.35, 0.95], { range: { w: [0.5, 1.2] }, place: { against: 'back', clearFront: 0.8 }, rooms: ['hall'], slots: ['body', 'top', 'handles'], tall: false, maxTris: 3000 }),
  P('coat-rack', 'hall', 3, 'Wall coat rack', 'Wieszak ścienny', [0.6, 0.1, 0.3], { range: { w: [0.4, 1.2] }, place: { mode: 'wall-mount', against: 'back', elevation: 1.6 }, rooms: ['hall'], slots: ['board', 'hooks'], tall: false, maxTris: 2000 }),
  P('bench', 'hall', 3, 'Bench', 'Ławka', [1.0, 0.35, 0.45], { range: { w: [0.6, 1.6] }, place: { against: 'back-or-free', clearFront: 0.6 }, rooms: ['hall', 'bedroom'], slots: ['seat', 'frame'], tall: false, maxTris: 2500 }),
  P('kitchen-island', 'kitchen', 3, 'Kitchen island', 'Wyspa kuchenna', [1.6, 0.9, 0.9], { range: { w: [1.2, 2.6] }, place: { against: 'free', clearFront: 1.0, clearSide: 1.0 }, rooms: ['kitchen'], slots: ['body', 'fronts', 'worktop'], tall: false, maxTris: 5000, legacy: 'counter' }),
  P('bar-stool', 'kitchen', 3, 'Bar stool', 'Hoker', [0.38, 0.38, 0.75], { place: { against: 'free' }, rooms: ['kitchen', 'dining'], slots: ['seat', 'frame'], tall: false, maxTris: 2500, legacy: 'chair' }),
  P('wardrobe-small', 'sleep', 3, 'Small wardrobe', 'Szafa mała', [0.9, 0.55, 1.9], { range: { w: [0.6, 1.2], h: [1.5, 2.2] }, place: { against: 'back', clearFront: 0.8 }, rooms: ['bedroom', 'hall', 'kids'], slots: ['body', 'doors', 'handles'], maxTris: 3500 }),
  P('sofa-bed', 'living', 3, 'Sofa bed', 'Sofa rozkładana', [1.9, 0.95, 0.85], { range: { w: [1.6, 2.4] }, place: { clearFront: 0.9 }, rooms: ['living', 'office', 'kids'], slots: ['upholstery', 'legs', 'cushions'] }),
  P('shelf-wall', 'living', 3, 'Wall shelf', 'Półka ścienna', [0.9, 0.2, 0.5], { range: { w: [0.5, 1.6] }, place: { mode: 'wall-mount', against: 'back', elevation: 1.3 }, rooms: ['living', 'bedroom', 'office', 'hall', 'kids'], slots: ['board', 'books'], tall: false, maxTris: 4000 }),
  P('bathroom-cabinet', 'bath', 3, 'Bathroom cabinet', 'Szafka łazienkowa', [0.6, 0.15, 0.7], { range: { w: [0.4, 1.0], h: [0.5, 0.9] }, place: { mode: 'wall-mount', against: 'back', elevation: 1.2 }, rooms: ['bath', 'wc'], slots: ['body', 'mirror', 'handle'], tall: false, maxTris: 2500 }),
];

export const SPEC_BY_ID = Object.fromEntries(SPECS.map((s) => [s.id, s]));
export const specOf = (id) => (Object.prototype.hasOwnProperty.call(SPEC_BY_ID, id) ? SPEC_BY_ID[id] : null);
export const byTier = (n) => SPECS.filter((s) => s.tier === n);
