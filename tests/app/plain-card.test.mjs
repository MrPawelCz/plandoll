// How main.js wires the card of a tapped piece and the list of rooms on the plain page. These read the source (as shell.test.mjs does for the keys and the stray click):
// the parts that decide whether the editor and the camera still work as they did cannot run without a browser, so the browser check (tools/info-check.mjs) covers
// the behaviour and these keep the wiring from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
const start = src.indexOf('// ---------- the plain page: a tap on a piece shows its card');
const end = src.indexOf('// The bars exist now: the view is framed again above them');
const block = src.slice(start, end);

test('the plain-page block exists, and is built only without editing and with the controls (ui=0 leaves the picture alone)', () => {
  assert.ok(start > 0 && end > start, 'the block is there');
  assert.match(block, /if \(parts\.controls && !params\.edit\) \{/);
  assert.ok(block.trim().endsWith('}'), 'and closed');
});

test('the card never takes the pointer from the camera or the editor: the tap watcher only listens', () => {
  for (const banned of [/cam\.enabled/, /setPointerCapture/, /releasePointerCapture/, /session\./, /window\.__edit/]) assert.doesNotMatch(block, banned, String(banned));
  // the whole body of every handler is read, not its first line: pointerdown and the lift are several lines long (a one-line pattern let a broken handler through)
  const at = (needle) => { const i = block.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  const slices = {
    pointerdown: block.slice(at("dom.addEventListener('pointerdown'"), at("dom.addEventListener('pointermove'")),
    pointermove: block.slice(at("dom.addEventListener('pointermove'"), at('const lifted = ')),
    lifted: block.slice(at('const lifted = '), at("dom.addEventListener('pointerup', (e) => lifted(e, false));")),
  };
  for (const [name, text] of Object.entries(slices)) {
    assert.ok(text.length > 60, `${name} is read in full`);
    assert.doesNotMatch(text, /preventDefault|stopPropagation|stopImmediatePropagation|setPointerCapture/, `${name} does not take the event from the camera`);
    assert.doesNotMatch(text, /,\s*true\);\s*$/, `${name} is not in the capture phase`);
  }
  assert.ok(slices.pointerdown.includes('tapG = down.size > 1 ? null'), 'the whole body of pointerdown is in the slice');
  assert.ok(slices.lifted.includes('const hit = hitAt(e);'), 'and the whole body of the lift');
  assert.match(block, /dom\.addEventListener\('pointerup', \(e\) => lifted\(e, false\)\);\n/);
  assert.match(block, /dom\.addEventListener\('pointercancel', \(e\) => lifted\(e, true\)\);\n/);
  assert.doesNotMatch(block, /dom\.addEventListener\('pointer(down|move|up|cancel)'[^\n]*, true\);/, 'no pointer listener of the picture in the capture phase');
});

test('a tap is what the camera calls a tap, and the second tap of a double tap changes nothing', () => {
  assert.match(block, /SLOP_MOUSE|slopOf/);
  assert.match(block, /t - g\.t0 >= 350/, 'lifts within 350 ms, as camera.js');
  assert.match(block, /lastTap && t - lastTap\.t < 350 && Math\.hypot\(e\.clientX - lastTap\.x, e\.clientY - lastTap\.y\) < 30/, 'two close taps are the double tap that takes the view back');
  assert.match(block, /e\.pointerType === 'mouse' && \(e\.button !== 0 \|\| e\.shiftKey\)/, 'the right and the middle button and Shift with the left one move the view, they never tap');
  assert.match(block, /down\.size > 1 \? null/, 'a second finger is never a tap');
});

test('the piece under a tap is picked as the editor picks it, and a hidden piece or one of a floor that is not on show cannot be tapped', () => {
  assert.match(block, /pickPiece\(curLayout, cam\.pointerToRay\(e\)/);
  assert.match(block, /frameOf: \(id\) => shell\?\.hostMatrix\(id\) \?\? null/, 'a piece on a turned wall is found where the wall has put it');
  assert.match(block, /furn\.cutOff\.has\(id\)/, 'the cutaway hides pieces, also the merged ones');
  assert.match(block, /!shownLevel\(lv\.get\(id\)\)/);
  assert.match(block, /touch: 0\.06/, 'a fingertip is wider than a mouse pointer');
});

test('the card and the list follow what changes under them: a floor, a new plan, a hidden piece, the language, Escape, and the stray click of a touch tap', () => {
  assert.match(block, /onFloorChange = \(\) => \{[\s\S]*closeCard\(\)[\s\S]*refreshRooms\(\)/);
  assert.match(block, /onPlanSwapped = \(\) => \{ closeCard\(\); clearRoom\(\); refreshRooms\(\); \}/);
  assert.match(block, /onSettled = \(\) => \{ if \(shownPiece && hidden\(levelIds\(\)\)\(shownPiece\.id\)\) closeCard\(\); \}/);
  assert.match(block, /onHinge = followHinge/, 'the outline of a piece on a turned wall turns with the wall');
  assert.match(block, /strayClick\(lift, \{ x: e\.clientX, y: e\.clientY, onPicture: e\.target === dom \}, performance\.now\(\)\)/);
  assert.match(block, /lift = shownPiece \? \{ x: e\.clientX, y: e\.clientY, t: performance\.now\(\), type: e\.pointerType \} : null;/, 'only a tap that left a card on show marks the lift');
  assert.doesNotMatch(block, /lift = \{ x: e\.clientX/, 'the end of a drag or a pinch is not marked: a button pressed a moment later is pressed');
  assert.match(block, /if \(shownPiece\) \{ closeCard\(\); e\.preventDefault\(\); \} else if \(dock\.picked\) \{ clearRoom\(\); e\.preventDefault\(\); \}/, 'an Escape that did something is marked as taken, so the open shell stays open');
  assert.match(src, /panel\?\.setLang\(l\); dock\?\.setLang\(l\); spacerView\?\.setLang\(l\); \}/);
  assert.match(src, /onShell: \(\) => \{ if \(shell\) shellGo\(shellTarget !== 1\); \}, onRooms: \(\) => toggleRooms\?\.\(\),\n\s+onSpacer: \(\) => \{[^\n]*\} \}, S\)/);
  assert.match(src, /onSettled\?\.\(\);\n  \}\n  \/\/ The floors on show/, 'settle tells the plain page');
  assert.ok(src.indexOf('let onSettled = null;') < src.indexOf('function furnish()'), 'declared before the first settle');
});

test('the plain page publishes the height of the control bar as --ps-stack-h, so the card and the list end above it (only the edit bar did before)', () => {
  assert.match(src, /function publishStack\(\) \{\n    const top = ui\?\.root\?\.getBoundingClientRect\?\.\(\)\.top;\n    if \(!params\.edit && Number\.isFinite\(top\) && innerHeight > 0 && top > 0\) document\.documentElement\.style\.setProperty\('--ps-stack-h', `\$\{Math\.round\(innerHeight - top\)\}px`\);\n  \}/);
  assert.match(src, /function restack\(\) \{\n    publishStack\(\);\n    const c = barsCover\(\)/, 'before the early return, so every change of the bar is published');
  assert.match(src, /new ResizeObserver\(\(\) => restack\(\)\)[\s\S]*'#ps-ui'/, 'and the bar is watched');
});

test('the list opens from rooms=1 and closing it lets go of the room that was shown', () => {
  assert.match(block, /dock\.setRoomsOpen\(!!S\.rooms\)/);
  assert.match(block, /toggleRooms = \(\) => \{ S\.rooms = !S\.rooms; if \(S\.rooms && roomsStale\) refreshRooms\(\); dock\.setRoomsOpen\(S\.rooms\); if \(!S\.rooms\) clearRoom\(\); ui\?\.update\(S\); \}/);
  assert.match(block, /const refreshRooms = \(\) => \{ if \(S\.rooms\) \{ dock\.setRooms\(roomsData\(model, flags\)\); roomsStale = false; \} else roomsStale = true; \};/, 'the list is added up only while it is open, and again when it opens after a change under it');
});
