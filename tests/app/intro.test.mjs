// The story of the intro (intro.js): whether it runs, the words in both languages, the timeline for any number of pieces, how a piece drops and settles, the camera on its way down,
// the frame-rate guard and the keys that skip. Pure functions, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTRO, introWanted, INTRO_TEXT, introText, counterText, introTimeline, chipAt, chipLook, counterLook, hintOpacity, wallRise, waveOf, pieceStarts, pieceMotion, pieceRank, pieceOrder,
  cameraAt, cameraFrom, liftAt, createFpsGuard, skipKey, keyLeftAlone, easeOut, backOut, smooth, sine,
} from '../../src/app/intro.js';
import { parseParams } from '../../src/app/params.js';

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('intro=0 in the address switches it off, and it is on without the word', () => {
  assert.equal(parseParams('').intro, true);
  assert.equal(parseParams('#intro=0').intro, false);
  assert.equal(parseParams('#preset=clear&intro=1').intro, true);
  assert.equal(parseParams('#intro=false').intro, true, 'only 0 turns it off, as ui=0 and btn=0 do');
});

test('the intro belongs to the plain page: not the editor, not a picture without controls, not live=1, not intro=0, not a visitor who asked for less motion', () => {
  const on = (hash, env) => introWanted(parseParams(hash), env);
  assert.deepEqual(on(''), { run: true, why: '' });
  assert.deepEqual(on('#lang=pl&q=low&plan=duplex-1'), { run: true, why: '' });
  assert.deepEqual(on('#intro=0'), { run: false, why: 'off' });
  assert.deepEqual(on('#edit=1'), { run: false, why: 'editor' });
  assert.deepEqual(on('#ui=0'), { run: false, why: 'no-ui' });
  assert.deepEqual(on('#live=1'), { run: false, why: 'live' });
  assert.deepEqual(on('', { reducedMotion: true }), { run: false, why: 'reduced-motion' });
  assert.deepEqual(on('', { reducedMotion: false }), { run: true, why: '' });
  assert.deepEqual(on('#edit=1&intro=0'), { run: false, why: 'off' }, 'the first reason is named');
  assert.equal(on('#btn=0&shell=0').run, true, 'a bar without the extra buttons, or without the shell, still gets it');
  assert.equal(introWanted(null).run, false, 'no parameters, no intro');
});

test('the words are the ones that were asked for, in both languages, with no long dash', () => {
  assert.deepEqual(INTRO_TEXT.pl.chips, { empty: 'PUSTY RZUT', walls: 'ŚCIANY', openings: 'OKNA I DRZWI', furniture: 'MEBLE', ready: 'GOTOWE' });
  assert.deepEqual(INTRO_TEXT.en.chips, { empty: 'EMPTY PLAN', walls: 'WALLS', openings: 'WINDOWS AND DOORS', furniture: 'FURNITURE', ready: 'READY' });
  assert.equal(INTRO_TEXT.pl.skip, 'Dotknij, aby pominąć');
  assert.equal(INTRO_TEXT.en.skip, 'Tap to skip');
  assert.equal(INTRO_TEXT.pl.loading, 'Wczytywanie');
  assert.equal(INTRO_TEXT.en.loading, 'Loading');
  assert.equal(counterText('pl', 7, 35), 'mebel 7 z 35');
  assert.equal(counterText('en', 7, 35), 'piece 7 of 35');
  assert.equal(counterText('xx', 1, 2), 'piece 1 of 2', 'an unknown language is English');
  assert.equal(introText('pl'), INTRO_TEXT.pl); assert.equal(introText('de'), INTRO_TEXT.en);
  assert.ok(!LONG_DASH.test(JSON.stringify(INTRO_TEXT)));
});

test('the timeline of the example (35 pieces) is the one of the approved sample: seven seconds, the furniture from 2.3 to 5.9, Ready at 6.0', () => {
  const tl = introTimeline(35);
  close(tl.furniture.start, 2.3); close(tl.furniture.end, 5.9, 0.01); close(tl.readyAt, 6.0, 0.01); close(tl.total, 7.0, 0.01);
  assert.deepEqual(tl.chips.map((c) => c.key), ['empty', 'walls', 'openings', 'furniture', 'ready']);
  assert.deepEqual(tl.chips.slice(0, 4).map((c) => c.t), [0, 0.25, 1.6, 2.3]);
  close(tl.counterFrom, 2.2);
  assert.equal(tl.pieces, 35);
});

test('whatever the plan, the intro lasts at least minS and at most maxS seconds, and the stages stay in order', () => {
  for (const n of [0, 1, 2, 5, 12, 35, 45, 46, 60, 120, 400, 5000, NaN, -3, 2.7, '40', undefined]) {
    const tl = introTimeline(n);
    assert.ok(tl.total >= INTRO.minS - 1e-9 && tl.total <= INTRO.maxS + 1e-9, `${n}: ${tl.total}`);
    assert.ok(tl.readyAt <= tl.total, `${n}: Ready before the end`);
    assert.ok(tl.furniture.end <= tl.readyAt + 1e-9, `${n}: the last piece lands before Ready`);
    const ts = tl.chips.map((c) => c.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b), `${n}: the words come in order`);
    assert.ok(tl.openings.start >= tl.walls.start && tl.furniture.start >= tl.openings.start, `${n}: walls, then openings, then furniture`);
  }
  assert.equal(introTimeline(0).counterFrom, null, 'no furniture, no counter');
  assert.ok(!introTimeline(0).chips.some((c) => c.key === 'furniture'), 'and no word for it');
  assert.ok(introTimeline(4).furniture.end - introTimeline(4).furniture.start >= INTRO.furnitureMin - 1e-9, 'a small plan does not flash by');
  assert.ok(introTimeline(5000).total <= INTRO.maxS + 1e-9);
  assert.ok(introTimeline(80).total > introTimeline(35).total - 1e-9, 'more pieces never make a shorter intro');
});

test('the word in the corner is the last one whose time has come, it pops in, and it fades with the end', () => {
  const tl = introTimeline(35);
  assert.equal(chipAt(0, tl).key, 'empty'); assert.equal(chipAt(0.24, tl).key, 'empty'); assert.equal(chipAt(0.25, tl).key, 'walls');
  assert.equal(chipAt(1.7, tl).key, 'openings'); assert.equal(chipAt(3, tl).key, 'furniture'); assert.equal(chipAt(6.5, tl).key, 'ready');
  assert.equal(chipAt(-1, tl), null);
  const first = chipLook(0, chipAt(0, tl), true, tl);
  assert.deepEqual([first.show, first.opacity, first.scale], [true, 1, 1], 'the first word is there from the start');
  const pop = chipLook(1.6, chipAt(1.6, tl), false, tl);
  assert.ok(pop.opacity === 0 && pop.scale < 0.6, 'a later word starts small and clear');
  const set = chipLook(2.0, chipAt(2.0, tl), false, tl);
  assert.ok(set.opacity === 1 && Math.abs(set.scale - 1) < 0.05);
  const gone = chipLook(tl.total, chipAt(tl.total, tl), false, tl);
  assert.equal(gone.opacity, 0, 'nothing is left of the word at the end');
  assert.equal(chipLook(1, null, false, tl).show, false);
  const c0 = counterLook(2.0, tl), c1 = counterLook(2.2, tl), c2 = counterLook(4, tl), c3 = counterLook(tl.total, tl);
  assert.ok(!c0.show && c1.show && c2.opacity === 1 && c3.opacity === 0);
  assert.equal(counterLook(3, introTimeline(0)).show, false);
  assert.ok(hintOpacity(0) === 0 && hintOpacity(1) === 1 && hintOpacity(INTRO.hintS) === 0 && hintOpacity(6) === 0, 'the line to skip is there for the first seconds only');
});

test('a wall rises with a soft stop and reaches its height exactly; the wave runs from the north-west corner to the south-east one', () => {
  const W = INTRO.walls;
  assert.equal(wallRise(0, 0.25, W.dur, W.power), 0);
  assert.equal(wallRise(0.25 + W.dur, 0.25, W.dur, W.power), 1);
  assert.equal(wallRise(99, 0.25, W.dur, W.power), 1);
  let last = 0;
  for (let k = 0; k <= 20; k++) { const v = wallRise(0.25 + (W.dur * k) / 20, 0.25, W.dur, W.power); assert.ok(v >= last); last = v; }
  const slope = (a, b) => wallRise(b, 0, 1, 2.6) - wallRise(a, 0, 1, 2.6);
  assert.ok(slope(0.9, 1) < slope(0, 0.1), 'it slows down as it arrives');
  const ext = { minX: 0, maxX: 10, minZ: 0, maxZ: 6 };
  assert.equal(waveOf(0, 0, ext), 0); assert.equal(waveOf(10, 6, ext), 1); close(waveOf(5, 3, ext), 0.5);
  assert.ok(waveOf(10, 0, ext) > waveOf(0, 0, ext) && waveOf(10, 0, ext) < waveOf(10, 6, ext));
  assert.equal(waveOf(50, 50, ext), 1, 'a point outside the box is clamped'); assert.equal(waveOf(1, 1, { minX: 3, maxX: 3, minZ: 3, maxZ: 3 }), 0, 'a plan with no extent does not divide by zero');
});

test('the pieces land one after another: first at the start, the last at the end, faster and faster, with a small pause at the first piece of a room', () => {
  const tl = introTimeline(35);
  const first = Array.from({ length: 35 }, (_, i) => i === 0 || i === 12 || i === 20);
  const t = pieceStarts(first, tl);
  assert.equal(t.length, 35);
  close(t[0], tl.furniture.start, 1e-9);
  close(t[34] + INTRO.piece.fall + INTRO.piece.bounce, tl.furniture.end, 1e-9);
  for (let i = 1; i < 35; i++) assert.ok(t[i] > t[i - 1], `strictly later: ${i}`);
  const gap = (i) => t[i] - t[i - 1];
  assert.ok(gap(5) > gap(30), 'the counter speeds up');
  assert.ok(gap(12) > gap(11) && gap(12) > gap(13), 'a pause before the first piece of a room');
  assert.deepEqual(pieceStarts([], tl), []);
  assert.deepEqual(pieceStarts([true], tl), [tl.furniture.start]);
});

test('a piece that stands on the floor falls, squashes and settles; a flat one or a hung one grows in; both are exactly at rest afterwards', () => {
  const P = INTRO.piece;
  assert.equal(pieceMotion(-0.01, true).on, false); assert.equal(pieceMotion(NaN, true).on, false);
  const air = pieceMotion(0, true);
  assert.ok(air.on && Math.abs(air.dy - P.dropH) < 1e-9 && air.sx < 0.75, 'it starts high and small');
  const landing = pieceMotion(P.fall, true);
  assert.ok(Math.abs(landing.dy) < 1e-9 && landing.sx > 1 && landing.sy < 1, 'it lands squashed (wider and lower)');
  for (const u of [P.fall + P.bounce, P.fall + P.bounce + 0.5, 99]) assert.deepEqual(pieceMotion(u, true), { on: true, dy: 0, sx: 1, sy: 1, sz: 1 }, `at rest ${u}`);
  let last = Infinity;
  for (let k = 0; k <= 20; k++) { const d = pieceMotion((P.fall * k) / 20, true).dy; assert.ok(d <= last + 1e-12); last = d; }
  const grow = pieceMotion(0.05, false);
  assert.ok(grow.on && grow.sx < 1 && grow.sy < 1 && grow.dy === 0);
  assert.ok(pieceMotion(P.pop * 0.7, false).sx > 1, 'a small overshoot');
  assert.deepEqual(pieceMotion(P.pop, false), { on: true, dy: 0, sx: 1, sy: 1, sz: 1 });
  const rug = pieceMotion(0.1, false, true);
  assert.equal(rug.sy, 1, 'a rug is flat: it grows along the floor only'); assert.ok(rug.sx < 1 && rug.sz < 1);
  assert.deepEqual(pieceMotion(5, false, true), { on: true, dy: 0, sx: 1, sy: 1, sz: 1 });
  for (let u = 0; u < 1; u += 0.013) for (const m of [pieceMotion(u, true), pieceMotion(u, false), pieceMotion(u, false, true)]) assert.ok(m.sx > 0 && m.sy > 0 && m.sz > 0 && Number.isFinite(m.dy), `finite and positive at ${u}`);
});

test('the pieces come room by room: the fullest room first, what lies flat before what stands, what stands before what hangs', () => {
  assert.deepEqual(['floor-flat', 'floor', 'corner', 'surface', 'wall-mount', 'window', 'x'].map(pieceRank), [0, 1, 1, 2, 3, 4, 5]);
  const items = [
    { id: 'b1', room: 'L|bed', rank: 1, area: 2 }, { id: 'b2', room: 'L|bed', rank: 0, area: 4 }, { id: 'b3', room: 'L|bed', rank: 3, area: 0.1 },
    { id: 'k1', room: 'L|kit', rank: 1, area: 1 }, { id: 'k2', room: 'L|kit', rank: 1, area: 3 },
    { id: 'l1', room: 'L|liv', rank: 1, area: 1 }, { id: 'l2', room: 'L|liv', rank: 2, area: 1 }, { id: 'l3', room: 'L|liv', rank: 1, area: 1 }, { id: 'l4', room: 'L|liv', rank: 5, area: 1 },
  ];
  const out = pieceOrder(items);
  assert.deepEqual(out.map((o) => o.id), ['l1', 'l3', 'l2', 'l4', 'b2', 'b1', 'b3', 'k2', 'k1'], 'liv (4), bed (3), kit (2); in a room by rank, then footprint, then id');
  assert.deepEqual(out.map((o) => o.first), [true, false, false, false, true, false, false, true, false]);
  assert.deepEqual(pieceOrder([]), []);
  const again = pieceOrder(items.slice().reverse());
  assert.deepEqual(again.map((o) => o.id), out.map((o) => o.id), 'the order does not depend on how the pieces were listed');
});

test('the camera comes down from above to the view the page starts in, and is exactly there at Ready', () => {
  const tl = introTimeline(35), to = { azimuth: 35.5, polar: 50.9, distance: 21 }, from = cameraFrom(to);
  assert.ok(from.polar === INTRO.fromPolar && Math.abs(from.azimuth - (35.5 - INTRO.azSweep)) < 1e-9 && Math.abs(from.distance - 21 * INTRO.fromZoom) < 1e-9);
  assert.deepEqual(cameraAt(0, tl, from, to), from);
  assert.deepEqual(cameraAt(tl.readyAt, tl, from, to), to);
  assert.deepEqual(cameraAt(tl.total, tl, from, to), to, 'it rests in the starting view for the last second');
  assert.deepEqual(cameraAt(-5, tl, from, to), from);
  let last = { ...from };
  for (let k = 0; k <= 40; k++) {
    const c = cameraAt((tl.readyAt * k) / 40, tl, from, to);
    assert.ok(c.polar >= last.polar - 1e-9 && c.azimuth >= last.azimuth - 1e-9 && c.distance >= last.distance - 1e-9, `moves one way only at ${k}`);
    assert.ok(c.polar >= 12, 'the camera never goes under its own tilt limit');
    last = c;
  }
  const mid = cameraAt(tl.readyAt / 2, tl, from, to);
  assert.ok(mid.polar > from.polar && mid.polar < to.polar && mid.azimuth > from.azimuth && mid.azimuth < to.azimuth);
});

test('the picture stands in the middle of the window while the bar is away, and glides up into its place in the second half of the way down', () => {
  const tl = introTimeline(35);
  assert.equal(liftAt(0, tl), 0); assert.equal(liftAt(tl.readyAt * 0.5, tl), 0);
  assert.equal(liftAt(tl.readyAt, tl), 1); assert.equal(liftAt(tl.total, tl), 1); assert.equal(liftAt(-3, tl), 0);
  let last = 0;
  for (let k = 0; k <= 40; k++) { const v = liftAt((tl.readyAt * k) / 40, tl); assert.ok(v >= last - 1e-12 && v >= 0 && v <= 1); last = v; }
  assert.ok(liftAt(tl.readyAt * 0.75, tl) > 0.3 && liftAt(tl.readyAt * 0.75, tl) < 0.7);
});

test('the easing functions stay in range and hit their ends', () => {
  for (const f of [easeOut, smooth, sine]) { close(f(0), 0); close(f(1), 1); close(f(-4), 0); close(f(9), 1); }
  close(backOut(0, 1.9), 1 + 2.9 * -1 + 1.9, 1e-9); close(backOut(1), 1);
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => backOut(i / 100, 1.9))) > 1.05, 'it overshoots a little');
});

test('the frame-rate guard says nothing to a steady 60 frames a second, and calls for the end when frames come at 8 a second', () => {
  const g = createFpsGuard();
  let said = false;
  for (let i = 0; i < 400; i++) said ||= g.push(1000 + i * (1000 / 60));
  assert.equal(said, false);
  const slow = createFpsGuard(); let at = null;
  for (let i = 0; i < 60 && at === null; i++) if (slow.push(5000 + i * 125)) at = i * 125;
  assert.ok(at !== null && at <= 2500, `it speaks within a couple of seconds: ${at}`);
  assert.ok(at >= 1000, 'but not before the grace period and one window');
  const hitch = createFpsGuard(); let any = false;
  for (let i = 0; i < 300; i++) { const ts = i * 16.7 + (i > 120 ? 450 : 0); any ||= hitch.push(ts); }
  assert.equal(any, false, 'one hitch (a shader, a garbage collection) is not a slow device');
  const edge = createFpsGuard({ minFps: 15 }); let e = false;
  for (let i = 0; i < 200; i++) e ||= edge.push(i * (1000 / 20));
  assert.equal(e, false, '20 frames a second is fine');
});

test('a key skips the intro, except the modifier keys on their own and any shortcut with Ctrl, Cmd or Alt', () => {
  for (const key of ['a', ' ', 'Enter', 'Escape', 'ArrowLeft', 'Tab', '1', 'Backspace']) assert.equal(skipKey({ key }), true, key);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']) assert.equal(skipKey({ key }), false, key);
  assert.equal(skipKey({ key: 'r', metaKey: true }), false, 'Cmd+R reloads the page');
  assert.equal(skipKey({ key: 'l', ctrlKey: true }), false);
  assert.equal(skipKey({ key: 'Tab', altKey: true }), false);
  assert.equal(skipKey({ key: 'a', shiftKey: true }), true);
  assert.equal(skipKey(null), false); assert.equal(skipKey({}), false);
});

test('the keys that belong to the browser still skip the intro but are left alone, and the keys the page uses are not', () => {
  for (const key of ['F1', 'F5', 'F11', 'F12', 'F24', 'Tab', 'ContextMenu', 'PrintScreen', 'Dead', 'Process', 'Unidentified', 'AudioVolumeUp', 'VolumeDown', 'MediaPlayPause', 'BrowserBack', 'LaunchMail']) {
    assert.equal(keyLeftAlone({ key }), true, key); assert.equal(skipKey({ key }), true, `${key} still skips`);
  }
  for (const key of ['a', ' ', 'Enter', 'Escape', 'ArrowLeft', 'ArrowDown', 'Backspace', 'Delete', 'Home', '1', 'F', 'F0', 'F25', 'F123', 'Fn', 'Shift']) assert.equal(keyLeftAlone({ key }), false, key);
  assert.equal(keyLeftAlone(null), false); assert.equal(keyLeftAlone({}), false); assert.equal(keyLeftAlone({ key: 5 }), false);
});
