// What Spacer puts on the picture (spacerview.js) against a small DOM stub: the map, the hint at the bottom and the two halves of a touch screen, in both languages,
// when each shows, and the map itself (drawMap) against a 2D context that records what it is told to draw. Node only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpacerView, drawMap, SPACER_TEXT, SPACER_STYLE_ID, MAP_SIZE } from '../../src/app/spacerview.js';
import { createWorld, createPlayer, openAllDoors } from '../../src/model/physics.js';
import { fileModel, twoRooms } from '../helpers/walk-model.mjs';

const flat = fileModel('examples/flat-1.plan.json');
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function ctx2d() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const c = { calls, fillStyle: '' };
  for (const n of ['clearRect', 'save', 'restore', 'translate', 'rotate', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill']) c[n] = rec(n);
  return c;
}
function makeDoc() {
  let writes = 0;
  const mk = (tag) => {
    const n = { tag, children: [], parent: null, style: {}, attrs: {}, className: '', id: '', hidden: false, width: 0, height: 0, _text: '',
      get textContent() { return this._text; }, set textContent(v) { this._text = String(v); writes++; },
      appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.appendChild(c); },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; },
      remove() { this.parent?.removeChild(this); },
      setAttribute(k, v) { this.attrs[k] = String(v); } };
    if (tag === 'canvas') { const ctx = ctx2d(); n.getContext = () => ctx; n.ctx = ctx; }
    return n;
  };
  const doc = { head: mk('head'), body: mk('body'), createElement: mk };
  const all = (n) => [n, ...n.children.flatMap(all)];
  doc.getElementById = (id) => all(doc.head).concat(all(doc.body)).find((n) => n.id === id) ?? null;
  doc.writes = () => writes;
  return doc;
}
const frame = (o = {}) => ({ model: flat, world: createWorld(flat), player: createPlayer(createWorld(flat), { level: 0, x: 1, y: 4.5, yawDeg: 0 }), ...o });

test('the view builds one style, one root that is hidden until the walk begins and that no pointer reaches, with the map, the two halves and the hint', () => {
  const doc = makeDoc();
  const v = createSpacerView({ doc, lang: 'en' });
  assert.equal(doc.getElementById('ps-walk'), v.element);
  assert.equal(v.element.hidden, true);
  assert.deepEqual(v.element.children.map((n) => n.id || n.tag), ['ps-walk-map', 'ps-walk-zones', 'ps-walk-hint']);
  const css = doc.getElementById(SPACER_STYLE_ID).textContent;
  assert.match(css, /#ps-walk\{position:fixed;inset:0;z-index:30;pointer-events:none/, 'it lets every event through to the picture');
  assert.match(css, /#ps-walk-map\{position:absolute;right:max\(12px[^}]*top:max\(12px/, 'the map is at the top on the right, clear of the bar, the version mark and the card');
  assert.match(css, /@media \(max-width:760px\)\{#ps-walk-map\{width:112px/, 'and smaller on a phone');
  assert.match(css, /#ps-walk-hint\{[^}]*bottom:calc\(var\(--ps-stack-h,80px\) \+ 14px\)/, 'the hint stands above whatever the bar has grown to');
  assert.match(css, /#ps-walk-zones div\{[^}]*align-items:center/, 'the names of the two halves stand mid screen, not at the foot where the hint is');
  assert.ok(!/#ps-walk-zones div\{[^}]*flex-end/.test(css));
  assert.ok(!LONG_DASH.test(css) && !/fetch|XMLHttpRequest|localStorage|cookie/.test(css));
  assert.equal(v.map.width, MAP_SIZE); assert.equal(v.map.height, MAP_SIZE); assert.equal(MAP_SIZE, 180);
  assert.equal(v.map.attrs.role, 'img'); assert.equal(v.map.attrs['aria-label'], 'Map of the floor');
  createSpacerView({ doc, lang: 'pl' });
  assert.equal(doc.head.children.filter((n) => n.id === SPACER_STYLE_ID).length, 1, 'the style is added once');
  v.show(); assert.equal(v.element.hidden, false);
  v.hide(); assert.equal(v.element.hidden, true);
  v.dispose(); assert.equal(doc.body.children.includes(v.element), false);
});

test('the words are in both languages, say what the keys do, and an unknown language is English', () => {
  assert.equal(SPACER_TEXT.en.hint, 'Click to look around. W S walk, A D step aside, arrows turn, Shift runs, Space jumps or opens and shuts doors, Esc goes back.');
  assert.equal(SPACER_TEXT.pl.hint, 'Kliknij, żeby się rozglądać. W S: naprzód i wstecz, A D: bokiem, strzałki: obrót, Shift: bieg, spacja: skok albo drzwi, Esc: powrót.');
  assert.equal(SPACER_TEXT.en.touchHint, 'Drag the left half to walk, the right half to look');
  assert.equal(SPACER_TEXT.pl.touchHint, 'Lewa połowa: idź, prawa: rozglądaj się');
  assert.deepEqual([SPACER_TEXT.en.left, SPACER_TEXT.en.right, SPACER_TEXT.pl.left, SPACER_TEXT.pl.right], ['Walk', 'Look around', 'Idź', 'Rozglądaj się']);
  for (const lang of ['en', 'pl']) for (const [k, t] of Object.entries(SPACER_TEXT[lang])) assert.ok(t.length > 2 && !LONG_DASH.test(t), `${lang}.${k}`);
  assert.ok(Object.isFrozen(SPACER_TEXT) && Object.isFrozen(SPACER_TEXT.en));
  const doc = makeDoc(), v = createSpacerView({ doc, lang: 'de' });
  assert.deepEqual(v.text, { hint: SPACER_TEXT.en.hint, touchHint: SPACER_TEXT.en.touchHint, left: 'Walk', right: 'Look around' });
  v.setLang('pl');
  assert.equal(v.text.hint, SPACER_TEXT.pl.hint);
  const zones = doc.getElementById('ps-walk-zones');
  assert.deepEqual(zones.children.map((z) => z.children[0].textContent), ['Idź', 'Rozglądaj się'], 'the halves are named in the new language at once');
  assert.equal(v.map.attrs['aria-label'], 'Plan piętra');
  v.paint(frame());
  assert.equal(doc.getElementById('ps-walk-hint').textContent, SPACER_TEXT.pl.hint);
});

test('a computer sees the hint until the mouse is captured and again when it is let go; a touch device sees the hint of the two halves for the time it is due, and the halves are named then', () => {
  const doc = makeDoc(), v = createSpacerView({ doc, lang: 'en' }), hint = doc.getElementById('ps-walk-hint'), zones = doc.getElementById('ps-walk-zones');
  v.show();
  v.paint(frame({ touch: false, help: false, locked: false }));
  assert.equal(hint.textContent, SPACER_TEXT.en.hint); assert.equal(hint.hidden, false); assert.equal(zones.className, '');
  v.paint(frame({ locked: true }));
  assert.equal(hint.hidden, true, 'the mouse is captured: the line goes');
  v.paint(frame({ locked: false }));
  assert.equal(hint.hidden, false, 'let go (Esc): it says how to look again');
  v.paint(frame({ touch: true, help: true }));
  assert.equal(hint.textContent, SPACER_TEXT.en.touchHint); assert.equal(zones.className, 'on');
  v.paint(frame({ touch: true, help: false }));
  assert.equal(hint.hidden, true, 'after the 4 s the picture is clean'); assert.equal(zones.className, '');
  v.paint(frame({ touch: false, help: true }));
  assert.equal(zones.className, '', 'a computer never shows the halves');
  v.paint(frame({ touch: true, help: true })); v.hide(); assert.equal(zones.className, '', 'hiding takes the halves away');
});

test('a notice stands in the place of the hint, in the language of the page, and the hint is back when it goes', () => {
  assert.equal(SPACER_TEXT.en.doorway, 'Step out of the doorway to shut the door');
  assert.equal(SPACER_TEXT.pl.doorway, 'Wyjdź z progu, żeby zamknąć drzwi');
  for (const lang of ['en', 'pl']) {
    const doc = makeDoc(), v = createSpacerView({ doc, lang }), hint = doc.getElementById('ps-walk-hint'), L = SPACER_TEXT[lang];
    v.show();
    v.paint(frame());
    assert.equal(hint.textContent, L.hint);
    v.paint(frame({ notice: 'doorway' }));
    assert.equal(hint.textContent, L.doorway); assert.equal(hint.hidden, false);
    v.paint(frame({ notice: 'doorway', locked: true }));
    assert.equal(hint.textContent, L.doorway, 'it shows with the mouse captured, when the hint is gone');
    v.paint(frame({ notice: null, locked: true }));
    assert.equal(hint.hidden, true, 'gone with the mouse captured: a clean picture');
    v.paint(frame({ notice: 'doorway', touch: true, help: false }));
    assert.equal(hint.textContent, L.doorway, 'and on a phone');
    v.paint(frame({ touch: true, help: false }));
    assert.equal(hint.hidden, true);
    v.paint(frame({ notice: 'doorway' })); v.paint(frame());
    assert.equal(hint.textContent, L.hint, 'the hint of the computer comes back after it');
    v.paint(frame({ notice: 'nothing-of-the-kind' }));
    assert.equal(hint.textContent, L.hint, 'an unknown key shows no word');
  }
  const doc = makeDoc(), v = createSpacerView({ doc, lang: 'en' }), hint = doc.getElementById('ps-walk-hint');
  v.paint(frame({ notice: 'doorway' })); v.setLang('pl'); v.paint(frame({ notice: 'doorway' }));
  assert.equal(hint.textContent, SPACER_TEXT.pl.doorway, 'a change of language is followed');
  v.hide(); v.show(); v.paint(frame({ notice: 'doorway' }));
  assert.equal(hint.textContent, SPACER_TEXT.pl.doorway, 'hiding forgets what was shown, so it is written again');
});

test('the words are written only when they change, the map every frame; a frame without a walker draws no map', () => {
  const doc = makeDoc(), v = createSpacerView({ doc, lang: 'en' });
  v.paint(frame()); const w = doc.writes(), clears = v.map.ctx.calls.filter((c) => c[0] === 'clearRect').length;
  for (let i = 0; i < 10; i++) v.paint(frame());
  assert.equal(doc.writes(), w, 'the hint is the same: no write to the page');
  assert.equal(v.map.ctx.calls.filter((c) => c[0] === 'clearRect').length, clears + 10, 'the map is drawn each time');
  const n = v.map.ctx.calls.length; v.paint({ model: null }); assert.equal(v.map.ctx.calls.length, n);
});

test('the map draws the walls, the stairs and the shut doors of the floor the walker is on, scaled to the whole plan, and an arrow that points the way it looks', () => {
  const world = createWorld(flat);
  const ctx = ctx2d(), player = createPlayer(world, { level: 0, x: 1, y: 4.5, yawDeg: 90 });
  drawMap(ctx, MAP_SIZE, { model: flat, world, player });
  const c = ctx.calls, count = (n) => c.filter((x) => x[0] === n).length;
  assert.deepEqual(c[0], ['clearRect', 0, 0, MAP_SIZE, MAP_SIZE]);
  const drawn = flat.levels[0].colliders.filter((k) => k.kind !== 'furniture' && k.kind !== 'rail');
  assert.ok(drawn.length > 8, 'the flat has walls to draw');
  assert.equal(count('fillRect'), drawn.length, 'one rectangle per wall piece; no rails, no furniture');
  const b = flat.bounds, s = Math.min((MAP_SIZE - 24) / (b.maxX - b.minX), (MAP_SIZE - 24) / (b.maxY - b.minY));
  const first = c.find((x) => x[0] === 'fillRect'), k0 = drawn[0];
  assert.ok(Math.abs(first[3] - 2 * k0.hx * s) < 1e-9, 'the scale fits the whole plan with a 12 px margin');
  assert.ok(first[4] >= 1.6 - 1e-9, 'a thin wall is still two pixels, nearly');
  const marks = c.filter((x) => x[0] === 'rotate'), last = marks.at(-1);
  assert.ok(Math.abs(last[1] - Math.PI / 2) < 1e-9, 'the arrow turns with the yaw');
  assert.equal(count('moveTo'), 1); assert.equal(count('lineTo'), 2);
  assert.equal(count('save'), count('restore'), 'the context is left as it was');
  assert.ok(c.some((x) => x[0] === 'translate' && Math.abs(x[1] - (12 + (MAP_SIZE - 24 - (b.maxX - b.minX) * s) / 2 + (1 - b.minX) * s)) < 1e-9), 'the walker is where the plan says');
});

test('a shut door is a wall on the map, an open one a gap, and the floor drawn is the floor of the walker', () => {
  const m = twoRooms(), world = createWorld(m), player = createPlayer(world, { level: 0, x: 2, y: 2, yawDeg: 0 });
  const rects = () => { const c = ctx2d(); drawMap(c, MAP_SIZE, { model: m, world, player }); return c.calls.filter((x) => x[0] === 'fillRect').length; };
  const open = rects();
  world.doors[0].closed = true;
  assert.equal(rects(), open + 1, 'the shut door adds its piece');
  openAllDoors(world);
  assert.equal(rects(), open);
  const duplex = fileModel('examples/duplex-1.plan.json'), dw = createWorld(duplex);
  const per = [0, 1].map((level) => { const c = ctx2d(); drawMap(c, MAP_SIZE, { model: duplex, world: dw, player: createPlayer(dw, { level, x: 2, y: 3, yawDeg: 0 }) }); return c.calls.filter((x) => x[0] === 'fillRect').length; });
  assert.deepEqual(per, duplex.levels.map((lv) => lv.colliders.filter((k) => k.kind !== 'furniture' && k.kind !== 'rail').length), 'each floor has its own map');
  assert.notEqual(per[0], per[1]);
});
