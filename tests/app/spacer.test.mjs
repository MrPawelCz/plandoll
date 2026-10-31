// The input and timing of Spacer (spacer.js): keys, who owns the space bar, mouse look, the two halves of a touch screen, how the sources
// add up, the clock and the touch hint. Everything runs in Node on plain objects; the page only passes real events to these functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEYMAP, RUN_KEYS, PITCH_LIMIT, MOUSE_LOOK, TOUCH_LOOK, STICK_PX, TOUCH_HELP_MS, MAX_FRAME_MS, MAX_STEP,
  keyAxis, createKeyState, isTyping, isPressable, spaceAction, keyAction, lookDelta, createTouch, effectiveInput, stepClock, substeps, touchHelpVisible,
} from '../../src/app/spacer.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// A tree of plain objects that answers what the functions ask of an element: tagName, parentElement, getAttribute, hasAttribute, isContentEditable.
const el = (tag, { parent = null, attrs = {}, editable = false } = {}) => ({
  tagName: tag.toUpperCase(),
  parentElement: parent,
  isContentEditable: editable,
  getAttribute: (k) => (k in attrs ? attrs[k] : null),
  hasAttribute: (k) => k in attrs,
});
const body = el('body');
const key = (code, extra = {}) => ({ type: 'keydown', code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: body, ...extra });
const ON = { active: true };

// ---------- keys ----------

test('KEYMAP: W and the arrow up go forward, S and the arrow down back, D and A step sideways, the arrows left and right TURN', () => {
  assert.deepEqual(keyAxis('KeyW'), { axis: 'forward', sign: 1 });
  assert.deepEqual(keyAxis('ArrowUp'), { axis: 'forward', sign: 1 });
  assert.deepEqual(keyAxis('KeyS'), { axis: 'forward', sign: -1 });
  assert.deepEqual(keyAxis('ArrowDown'), { axis: 'forward', sign: -1 });
  assert.deepEqual(keyAxis('KeyD'), { axis: 'strafe', sign: 1 });
  assert.deepEqual(keyAxis('KeyA'), { axis: 'strafe', sign: -1 });
  assert.deepEqual(keyAxis('ArrowRight'), { axis: 'turn', sign: 1 });
  assert.deepEqual(keyAxis('ArrowLeft'), { axis: 'turn', sign: -1 });
  assert.equal(Object.keys(KEYMAP).length, 8);
});

test('keyAxis: Space, Escape, Shift, other letters, odd values and names from the prototype are not movement keys', () => {
  for (const code of ['Space', 'Escape', 'ShiftLeft', 'ShiftRight', 'KeyE', 'Digit1', '', undefined, null, 42, 'constructor', 'toString', '__proto__']) {
    assert.equal(keyAxis(code), null, String(code));
  }
});

test('KEYMAP is frozen all the way down', () => {
  assert.ok(Object.isFrozen(KEYMAP) && Object.isFrozen(RUN_KEYS));
  for (const v of Object.values(KEYMAP)) assert.ok(Object.isFrozen(v));
  assert.throws(() => { KEYMAP.KeyQ = ['turn', 1]; }, TypeError);
});

test('key state: nothing held is all zeros and no run', () => {
  assert.deepEqual(createKeyState().axes(), { forward: 0, strafe: 0, turn: 0, run: false });
});

test('key state: each movement key moves its axis, and down says it is a movement key', () => {
  const cases = [['KeyW', 'forward', 1], ['KeyS', 'forward', -1], ['KeyD', 'strafe', 1], ['KeyA', 'strafe', -1], ['ArrowRight', 'turn', 1], ['ArrowLeft', 'turn', -1], ['ArrowUp', 'forward', 1], ['ArrowDown', 'forward', -1]];
  for (const [code, axis, sign] of cases) {
    const k = createKeyState();
    assert.equal(k.down(code), true);
    const want = { forward: 0, strafe: 0, turn: 0, run: false };
    want[axis] = sign;
    assert.deepEqual(k.axes(), want, code);
    k.up(code);
    assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false }, `${code} released`);
  }
});

test('key state: opposite keys cancel, different axes add up, a repeating key counts once', () => {
  const k = createKeyState();
  k.down('KeyW'); k.down('KeyS');
  assert.equal(k.axes().forward, 0);
  k.up('KeyS');
  assert.equal(k.axes().forward, 1);
  k.down('KeyA'); k.down('ArrowLeft');
  assert.deepEqual(k.axes(), { forward: 1, strafe: -1, turn: -1, run: false });
  for (let i = 0; i < 5; i++) k.down('KeyW'); // keydown repeats while a key is held
  assert.equal(k.axes().forward, 1, 'five repeats are still one key');
  k.up('KeyW');
  assert.equal(k.axes().forward, 0, 'one keyup ends it');
});

test('key state: W and the arrow up are two keys for one direction, so releasing one keeps walking', () => {
  const k = createKeyState();
  k.down('KeyW'); k.down('ArrowUp');
  assert.equal(k.axes().forward, 1, 'both held do not add up to 2');
  k.up('KeyW');
  assert.equal(k.axes().forward, 1, 'the arrow is still down');
  k.up('ArrowUp');
  assert.equal(k.axes().forward, 0);
});

test('key state: Shift is the run key, either one; it is held but not a movement key', () => {
  const k = createKeyState();
  assert.equal(k.down('ShiftLeft'), false);
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: true });
  k.down('ShiftRight');
  k.up('ShiftLeft');
  assert.equal(k.axes().run, true, 'the other Shift is still down');
  k.up('ShiftRight');
  assert.equal(k.axes().run, false);
});

test('key state: arrow plus Shift runs while turning, W plus Shift runs forward', () => {
  const k = createKeyState();
  k.down('ShiftLeft'); k.down('ArrowRight');
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 1, run: true });
  k.down('KeyW');
  assert.deepEqual(k.axes(), { forward: 1, strafe: 0, turn: 1, run: true });
});

test('key state: keys that are not ours are not held and say so; a keyup of a key never pressed does nothing', () => {
  const k = createKeyState();
  for (const code of ['Space', 'Escape', 'KeyQ', 'Digit1', undefined, 'constructor']) assert.equal(k.down(code), false, String(code));
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false });
  assert.doesNotThrow(() => { k.up('KeyW'); k.up(undefined); });
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false });
});

test('key state: the window losing focus (clear) lets go of every key, also Shift, so nothing stays stuck', () => {
  const k = createKeyState();
  for (const c of ['KeyW', 'KeyA', 'ArrowLeft', 'ShiftLeft']) k.down(c);
  assert.notDeepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false });
  k.clear();
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false });
  k.up('KeyW'); // the keyup that arrives after the blur is harmless
  assert.deepEqual(k.axes(), { forward: 0, strafe: 0, turn: 0, run: false });
});

test('key state: axes() hands out a new object each time', () => {
  const k = createKeyState();
  const a = k.axes();
  a.forward = 9;
  assert.equal(k.axes().forward, 0);
});

// ---------- who owns a key press ----------

test('isTyping: input, textarea, select, dialog, role=dialog and editable regions, also when the target sits inside one', () => {
  for (const tag of ['input', 'textarea', 'select', 'dialog']) assert.equal(isTyping(el(tag)), true, tag);
  assert.equal(isTyping(el('div', { attrs: { role: 'dialog' } })), true, 'the Menu sheet of a phone is a div with role=dialog');
  assert.equal(isTyping(el('div', { attrs: { role: 'DIALOG' } })), true, 'a role in capitals is the same role');
  assert.equal(isTyping(el('div', { editable: true })), true);
  const sheet = el('div', { attrs: { role: 'dialog' } });
  assert.equal(isTyping(el('span', { parent: el('button', { parent: sheet }) })), true, 'a button inside the sheet');
  assert.equal(isTyping(el('div', { editable: false })), false, 'contenteditable=false is not editable');
});

test('isTyping: the page body, an ordinary element, a canvas, a button, nothing at all', () => {
  for (const t of [body, el('div'), el('canvas'), el('button'), el('a', { attrs: { href: '#x' } }), null, undefined, {}]) assert.equal(isTyping(t), false);
});

test('isPressable: buttons, links with an address and role=button or link; a link without href and a canvas are not', () => {
  assert.equal(isPressable(el('button')), true);
  assert.equal(isPressable(el('a', { attrs: { href: '/x' } })), true);
  assert.equal(isPressable(el('div', { attrs: { role: 'button' } })), true);
  assert.equal(isPressable(el('span', { attrs: { role: 'link' } })), true);
  assert.equal(isPressable(el('span', { parent: el('button') })), true, 'the content of a button');
  assert.equal(isPressable(el('a')), false, 'an anchor without href cannot take focus');
  for (const t of [body, el('canvas'), el('div'), null, undefined]) assert.equal(isPressable(t), false);
});

test('isTyping and isPressable stop on a cycle in the parents instead of hanging', () => {
  const a = el('div'), b = el('div', { parent: a });
  a.parentElement = b;
  assert.equal(isTyping(a), false);
  assert.equal(isPressable(b), false);
});

test('spaceAction: a plain press of Space with Spacer on takes the walk', () => {
  assert.equal(spaceAction(key('Space'), ON), 'use');
  assert.equal(spaceAction(key('Space', { target: el('canvas') }), ON), 'use');
  assert.equal(spaceAction(key('Space', { target: null }), ON), 'use');
  assert.equal(spaceAction(key('Space', { shiftKey: true }), ON), 'use', 'Shift is the run key and does not take Space away');
});

test('spaceAction: Spacer off, a context without active, or a key other than Space is not ours', () => {
  assert.equal(spaceAction(key('Space'), { active: false }), 'pass');
  assert.equal(spaceAction(key('Space'), {}), 'pass');
  assert.equal(spaceAction(key('Space'), undefined), 'pass');
  assert.equal(spaceAction(undefined, ON), 'pass');
  for (const code of ['Enter', 'KeyW', 'Escape', 'Tab', 'ShiftLeft']) assert.equal(spaceAction(key(code), ON), 'pass', code);
});

test('spaceAction: a repeating Space (key held down) does nothing more, but the page must not scroll or press either: swallow', () => {
  assert.equal(spaceAction(key('Space', { repeat: true }), ON), 'swallow');
  assert.equal(spaceAction(key('Space', { repeat: true }), { active: false }), 'pass');
  assert.equal(spaceAction(key('Space', { repeat: true, target: el('input') }), ON), 'pass');
});

test('spaceAction: Ctrl+Space, Alt+Space and Meta+Space belong to the browser or the system', () => {
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(spaceAction(key('Space', { [mod]: true }), ON), 'pass', mod);
    assert.equal(spaceAction(key('Space', { [mod]: true, repeat: true }), ON), 'pass', `${mod} repeating`);
  }
});

test('spaceAction: Space in a text field, list, textarea or editable region stays a space', () => {
  for (const target of [el('input'), el('textarea'), el('select'), el('div', { editable: true })]) {
    assert.equal(spaceAction(key('Space', { target }), ON), 'pass', target.tagName);
  }
});

test('spaceAction: Space inside a dialog (the dialog element or role=dialog) is for the dialog, on the dialog and on what it holds', () => {
  const dlg = el('dialog'), sheet = el('div', { attrs: { role: 'dialog' } });
  assert.equal(spaceAction(key('Space', { target: dlg }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: sheet }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('div', { parent: sheet }) }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('button', { parent: sheet }) }), ON), 'pass', 'the buttons of the Menu sheet press on Space');
  assert.equal(spaceAction(key('Space', { target: el('span', { parent: el('div', { parent: dlg }) }) }), ON), 'pass');
});

test('spaceAction: Space on a button or a link (a bar button that has focus) presses it and does not jump', () => {
  assert.equal(spaceAction(key('Space', { target: el('button') }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('a', { attrs: { href: '#/x' } }) }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('div', { attrs: { role: 'button' } }) }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('span', { parent: el('button') }) }), ON), 'pass');
  assert.equal(spaceAction(key('Space', { target: el('button'), repeat: true }), ON), 'pass', 'also while repeating');
});

test('spaceAction: the release of Space is swallowed only where its press was taken', () => {
  const up = (extra) => key('Space', { type: 'keyup', ...extra });
  assert.equal(spaceAction(up(), ON), 'swallow');
  assert.equal(spaceAction(up({ target: el('canvas') }), ON), 'swallow');
  assert.equal(spaceAction(up({ target: el('button') }), ON), 'pass', 'the button presses on the release');
  assert.equal(spaceAction(up({ target: el('input') }), ON), 'pass');
  assert.equal(spaceAction(up({ target: el('div', { parent: el('dialog') }) }), ON), 'pass');
  assert.equal(spaceAction(up(), { active: false }), 'pass');
  assert.equal(spaceAction(up({ ctrlKey: true }), ON), 'pass');
});

test('keyAction: Escape leaves, a movement key moves, Shift runs, anything else is not ours', () => {
  assert.equal(keyAction(key('Escape'), ON), 'exit');
  for (const code of Object.keys(KEYMAP)) assert.equal(keyAction(key(code), ON), 'move', code);
  for (const code of RUN_KEYS) assert.equal(keyAction(key(code), ON), 'run', code);
  for (const code of ['Space', 'Enter', 'Digit1', 'KeyQ', 'Tab']) assert.equal(keyAction(key(code), ON), 'pass', code);
});

test('keyAction: nothing is ours when Spacer is off, or when the key is aimed at a field or a dialog', () => {
  assert.equal(keyAction(key('KeyW'), { active: false }), 'pass');
  assert.equal(keyAction(key('Escape'), { active: false }), 'pass');
  assert.equal(keyAction(key('KeyW'), undefined), 'pass');
  assert.equal(keyAction(undefined, ON), 'pass');
  for (const target of [el('input'), el('textarea'), el('select'), el('dialog'), el('div', { attrs: { role: 'dialog' } }), el('button', { parent: el('div', { attrs: { role: 'dialog' } }) })]) {
    for (const code of ['KeyW', 'ArrowLeft', 'Escape', 'ShiftLeft']) assert.equal(keyAction(key(code, { target }), ON), 'pass', `${code} in ${target.tagName}`);
  }
});

test('keyAction: a button in focus does not take the movement keys or Escape from the walk (only Space presses it)', () => {
  const target = el('button');
  assert.equal(keyAction(key('KeyW', { target }), ON), 'move');
  assert.equal(keyAction(key('Escape', { target }), ON), 'exit');
});

// ---------- mouse ----------

test('lookDelta: 0.0022 rad per px, to the right turns the yaw up, moving the mouse down lowers the head', () => {
  assert.equal(MOUSE_LOOK, 0.0022);
  const d = lookDelta(100, 0, 0);
  near(d.dyaw, 0.22);
  assert.equal(d.dpitch, 0);
  assert.equal(d.pitch, 0);
  const down = lookDelta(0, 100, 0);
  near(down.pitch, -0.22);
  near(down.dpitch, -0.22);
  const up = lookDelta(0, -100, 0.1);
  near(up.pitch, 0.32);
  near(lookDelta(-50, 0, 0).dyaw, -0.11);
});

test('lookDelta: the pitch stops at 1.35 rad up and down, and dpitch is what it really moved', () => {
  assert.equal(PITCH_LIMIT, 1.35);
  assert.equal(lookDelta(0, -100000, 0).pitch, 1.35);
  assert.equal(lookDelta(0, 100000, 0).pitch, -1.35);
  const near_top = lookDelta(0, -200, 1.3);
  assert.equal(near_top.pitch, 1.35);
  near(near_top.dpitch, 0.05);
  assert.equal(lookDelta(0, -200, 1.35).dpitch, 0, 'at the stop there is no more room');
  near(lookDelta(0, 200, -1.3).dpitch, -0.05);
  assert.equal(lookDelta(10, 0, 1.35).pitch, 1.35, 'a sideways movement keeps the pitch where it is');
});

test('lookDelta: zero movement changes nothing, odd numbers count as 0, a pitch outside the limit is pulled back', () => {
  assert.deepEqual(lookDelta(0, 0, 0.5), { dyaw: 0, dpitch: 0, pitch: 0.5 });
  assert.deepEqual(lookDelta(NaN, undefined, 0.5), { dyaw: 0, dpitch: 0, pitch: 0.5 });
  assert.deepEqual(lookDelta(Infinity, -Infinity, 0), { dyaw: 0, dpitch: 0, pitch: 0 });
  assert.deepEqual(lookDelta(0, 0, undefined), { dyaw: 0, dpitch: 0, pitch: 0 });
  const out = lookDelta(0, 0, 3);
  assert.equal(out.pitch, 1.35);
  assert.equal(out.dpitch, 0, 'dpitch is measured from the pulled-back pitch');
  assert.ok(Object.is(lookDelta(0, 0, 0).dyaw, 0) && !Object.is(lookDelta(-0, 0, 0).dyaw, -0), 'no negative zero leaks out');
});

// ---------- touch ----------

test('touch: the left half is the stick, the right half looks; the split is at half the width', () => {
  const t = createTouch({ width: 800 });
  assert.equal(t.down(1, 0, 300).side, 'left');
  assert.equal(t.down(2, 399.9, 300).side, 'left');
  assert.equal(t.down(3, 400, 300).side, 'right', 'the middle line belongs to the right');
  assert.equal(t.down(4, 800, 0).side, 'right');
  assert.equal(t.count, 4);
});

test('touch: setWidth moves the split (a window that was resized or turned)', () => {
  const t = createTouch({ width: 800 });
  t.setWidth(1000);
  assert.equal(t.down(1, 450, 0).side, 'left');
  assert.equal(t.down(2, 500, 0).side, 'right');
  const none = createTouch();
  assert.equal(none.down(1, 5, 0).side, 'right', 'without a width every finger looks');
});

test('touch stick: strafe = dx/60, forward = -dy/60 (up is forward), 60 px is full', () => {
  assert.equal(STICK_PX, 60);
  const t = createTouch({ width: 800 });
  assert.deepEqual(t.down(1, 100, 400), { side: 'left' });
  assert.deepEqual(t.axes(), { forward: 0, strafe: 0 });
  assert.deepEqual(t.move(1, 100, 370), { side: 'left', forward: 0.5, strafe: 0 });
  assert.deepEqual(t.move(1, 130, 400), { side: 'left', forward: 0, strafe: 0.5 });
  assert.deepEqual(t.move(1, 70, 430), { side: 'left', forward: -0.5, strafe: -0.5 });
  assert.deepEqual(t.axes(), { forward: -0.5, strafe: -0.5 });
  const d = t.move(1, 160, 340);
  near(d.strafe, 1); near(d.forward, 1);
});

test('touch stick: the push is cut at full, however far the finger goes, and is measured from where it landed', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 100);
  assert.deepEqual(t.move(1, 1000, -1000), { side: 'left', forward: 1, strafe: 1 });
  assert.deepEqual(t.move(1, -1000, 1000), { side: 'left', forward: -1, strafe: -1 });
  assert.deepEqual(t.move(1, 100, 100), { side: 'left', forward: 0, strafe: 0 }, 'back at the start is still');
  assert.ok(Object.is(t.axes().forward, 0) && Object.is(t.axes().strafe, 0), 'no negative zero');
});

test('touch stick: letting go zeroes the axes', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.move(1, 160, 340);
  assert.deepEqual(t.up(1), { side: 'left', forward: 0, strafe: 0 });
  assert.deepEqual(t.axes(), { forward: 0, strafe: 0 });
  assert.equal(t.count, 0);
});

test('touch look: yaw += dx * 0.005 and pitch -= dy * 0.005, from the last place of the finger', () => {
  assert.equal(TOUCH_LOOK, 0.005);
  const t = createTouch({ width: 800 });
  t.down(7, 600, 200);
  const a = t.move(7, 700, 200, 0);
  assert.equal(a.side, 'right');
  near(a.dyaw, 0.5); assert.equal(a.dpitch, 0); assert.equal(a.pitch, 0);
  const b = t.move(7, 700, 160, 0); // the second step counts from 700, 200
  assert.equal(b.dyaw, 0);
  near(b.pitch, 0.2); near(b.dpitch, 0.2);
  const c = t.move(7, 650, 160, 0.2);
  near(c.dyaw, -0.25); near(c.pitch, 0.2);
});

test('touch look: the pitch stops at 1.35 as with the mouse, and a finger that moves up past the stop loses nothing at the other end', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 600, 500);
  assert.equal(t.move(1, 600, -5000, 0).pitch, 1.35);
  assert.equal(t.move(1, 600, 5000, 0).pitch, -1.35);
  const near_top = t.move(1, 600, 4900, 1.3); // 100 px up = 0.5 rad, only 0.05 of it fits
  assert.equal(near_top.pitch, 1.35);
  near(near_top.dpitch, 0.05);
});

test('touch: two fingers at once, one on each half; the stick keeps steering while the other looks, and each lets go on its own', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.down(2, 600, 200);
  assert.deepEqual(t.move(1, 100, 340), { side: 'left', forward: 1, strafe: 0 });
  const look = t.move(2, 640, 200, 0);
  near(look.dyaw, 0.2);
  assert.deepEqual(t.axes(), { forward: 1, strafe: 0 }, 'looking does not touch the stick');
  assert.deepEqual(t.up(2), { side: 'right' });
  assert.deepEqual(t.axes(), { forward: 1, strafe: 0 }, 'letting go of the look finger does not stop the walk');
  t.down(3, 700, 100);
  assert.deepEqual(t.up(1), { side: 'left', forward: 0, strafe: 0 });
  assert.equal(t.move(3, 710, 100, 0).side, 'right', 'the look finger goes on after the stick finger left');
  assert.equal(t.count, 1);
});

test('touch: a finger the page never told us about (moved or lifted) changes nothing', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.move(1, 100, 370);
  assert.equal(t.move(99, 0, 0), null);
  assert.equal(t.up(99), null);
  assert.deepEqual(t.axes(), { forward: 0.5, strafe: 0 });
  assert.equal(t.up(1).side, 'left');
  assert.equal(t.up(1), null, 'a second lift of the same finger');
  assert.equal(t.move(1, 5, 5), null, 'and a move after it');
});

test('touch: pointerId 0 is a pointer like the others', () => {
  const t = createTouch({ width: 800 });
  assert.equal(t.down(0, 100, 400).side, 'left');
  assert.equal(t.move(0, 100, 370).forward, 0.5);
  assert.equal(t.up(0).side, 'left');
});

test('touch: a second finger on the left half does not steer', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.down(2, 200, 400);
  assert.deepEqual(t.move(1, 100, 370), { side: 'left', forward: 0.5, strafe: 0 });
  assert.equal(t.move(2, 260, 300), null, 'the second finger is only followed');
  assert.deepEqual(t.axes(), { forward: 0.5, strafe: 0 });
  assert.deepEqual(t.up(2), { side: 'left', forward: 0.5, strafe: 0 }, 'lifting it leaves the owner steering');
  assert.deepEqual(t.axes(), { forward: 0.5, strafe: 0 });
});

test('touch: when the finger that steers lifts, the next one on the left takes over from where it is, so the walker does not lurch', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.down(2, 200, 400);
  t.move(2, 260, 300); // far from where it landed: taken as its origin it would be full speed at once
  assert.deepEqual(t.up(1), { side: 'left', forward: 0, strafe: 0 });
  assert.deepEqual(t.axes(), { forward: 0, strafe: 0 });
  assert.deepEqual(t.move(2, 260, 270), { side: 'left', forward: 0.5, strafe: 0 }, 'it steers by what it moves from now on');
});

test('touch: the same pointerId coming down again starts over', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.move(1, 160, 340);
  t.down(1, 600, 100);
  assert.equal(t.count, 1);
  assert.deepEqual(t.axes(), { forward: 0, strafe: 0 }, 'it is a look finger now');
  assert.equal(t.move(1, 610, 100, 0).side, 'right');
});

test('touch: clear (pointercancel, leaving Spacer) forgets every finger and zeroes the stick', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400); t.down(2, 600, 100);
  t.move(1, 160, 340);
  t.clear();
  assert.equal(t.count, 0);
  assert.deepEqual(t.axes(), { forward: 0, strafe: 0 });
  assert.equal(t.move(2, 650, 100), null);
});

test('touch: a move with a coordinate that is not a number leaves the finger where it was', () => {
  const t = createTouch({ width: 800 });
  t.down(1, 100, 400);
  t.move(1, 130, 370);
  assert.deepEqual(t.move(1, NaN, undefined), { side: 'left', forward: 0.5, strafe: 0.5 });
  assert.deepEqual(t.axes(), { forward: 0.5, strafe: 0.5 });
  t.down(2, 600, 200);
  const look = t.move(2, NaN, 200, 0.3);
  assert.deepEqual(look, { side: 'right', dyaw: 0, dpitch: 0, pitch: 0.3 });
});

// ---------- sources ----------

test('effectiveInput: keys, stick and the test hook add up and are cut to [-1, 1]', () => {
  const keys = { forward: 1, strafe: 0, turn: -1, run: false };
  const touch = { forward: 0.5, strafe: -0.25 };
  const api = { forward: 0, strafe: 0.5, turn: 0.5, run: false };
  assert.deepEqual(effectiveInput({ keys, touch, api }), { forward: 1, strafe: 0.25, turn: -0.5, run: false });
  assert.deepEqual(effectiveInput({ keys: { forward: -1 }, touch: { forward: -1 }, api: { forward: -1 } }), { forward: -1, strafe: 0, turn: 0, run: false });
});

test('effectiveInput: sources that push against each other cancel', () => {
  assert.equal(effectiveInput({ keys: { forward: 1 }, api: { forward: -1 } }).forward, 0);
  assert.equal(effectiveInput({ keys: { forward: 1 }, touch: { forward: -0.5 } }).forward, 0.5);
});

test('effectiveInput: the stick has no turn, the keys and the hook do', () => {
  assert.equal(effectiveInput({ touch: { forward: 1, strafe: 1, turn: 1 } }).turn, 0);
  assert.equal(effectiveInput({ keys: { turn: 1 } }).turn, 1);
  assert.equal(effectiveInput({ api: { turn: -1 } }).turn, -1);
});

test('effectiveInput: run when any source asks for it, and only a true run counts', () => {
  assert.equal(effectiveInput({ keys: { run: true } }).run, true);
  assert.equal(effectiveInput({ api: { run: true } }).run, true);
  assert.equal(effectiveInput({ keys: { run: false }, api: { run: false } }).run, false);
  assert.equal(effectiveInput({ touch: { run: true } }).run, false, 'the stick does not run');
});

test('effectiveInput: missing parts and odd numbers count as zero, and the answer is a new object', () => {
  assert.deepEqual(effectiveInput(), { forward: 0, strafe: 0, turn: 0, run: false });
  assert.deepEqual(effectiveInput({}), { forward: 0, strafe: 0, turn: 0, run: false });
  assert.deepEqual(effectiveInput({ keys: { forward: NaN, strafe: 'x', turn: undefined }, api: { forward: Infinity } }), { forward: 0, strafe: 0, turn: 0, run: false });
  assert.equal(effectiveInput({ api: { forward: 7 } }).forward, 1, 'a hook value over 1 is cut');
  assert.equal(effectiveInput({ api: { forward: '0.5' } }).forward, 0.5, 'a number given as text is read as a number, as walkInput did');
  const a = effectiveInput({ keys: { forward: 1 } }), b = effectiveInput({ keys: { forward: 1 } });
  assert.notEqual(a, b);
});

test('effectiveInput with the real sources: W held and the stick pushed forward do not make a double speed', () => {
  const k = createKeyState(), t = createTouch({ width: 800 });
  k.down('KeyW'); k.down('ShiftLeft');
  t.down(1, 100, 400); t.move(1, 100, 340);
  assert.deepEqual(effectiveInput({ keys: k.axes(), touch: t.axes() }), { forward: 1, strafe: 0, turn: 0, run: true });
});

// ---------- time ----------

test('stepClock: dt is the time since the last frame in s, and last moves on', () => {
  const c = stepClock({ now: 1016.6, last: 1000 });
  near(c.dt, 0.0166);
  assert.equal(c.last, 1016.6);
  assert.deepEqual(stepClock({ now: 1000, last: 1000 }), { dt: 0, last: 1000 });
});

test('stepClock: a frame longer than 100 ms counts as 100 ms (a hidden tab, a stall), but last still moves to now', () => {
  assert.equal(MAX_FRAME_MS, 100);
  assert.deepEqual(stepClock({ now: 1100, last: 1000 }), { dt: 0.1, last: 1100 });
  assert.deepEqual(stepClock({ now: 61000, last: 1000 }), { dt: 0.1, last: 61000 });
});

test('stepClock: a clock that went back, a first frame and odd values give no time', () => {
  assert.deepEqual(stepClock({ now: 900, last: 1000 }), { dt: 0, last: 900 });
  assert.deepEqual(stepClock({ now: 1000, last: undefined }), { dt: 0, last: 1000 });
  assert.deepEqual(stepClock({ now: 1000, last: NaN }), { dt: 0, last: 1000 });
  assert.deepEqual(stepClock({ now: NaN, last: 1000 }), { dt: 0, last: 1000 });
  assert.deepEqual(stepClock({}), { dt: 0, last: undefined });
  assert.deepEqual(stepClock(), { dt: 0, last: undefined });
});

test('stepClock: a manual clock never advances by itself, but keeps last current so the first real frame is not a leap', () => {
  assert.deepEqual(stepClock({ now: 5000, last: 1000, manual: true }), { dt: 0, last: 5000 });
  const real = stepClock({ now: 5016, last: 5000, manual: false });
  near(real.dt, 0.016);
  assert.equal(real.last, 5016);
});

test('substeps: a span is cut into slices of at most 1/60 s that add up to the span', () => {
  assert.equal(MAX_STEP, 1 / 60);
  for (const span of [0.001, 1 / 60, 0.05, 0.1, 0.5, 1, 7.31]) {
    const parts = [...substeps(span)];
    near(parts.reduce((a, b) => a + b, 0), span, 1e-8);
    assert.ok(parts.every((p) => p > 0 && p <= MAX_STEP + 1e-12), `slices of ${span}`);
  }
  assert.equal([...substeps(0.1)].length, 6);
  assert.deepEqual([...substeps(0.001)], [0.001], 'a short span is one short slice');
  assert.equal([...substeps(1)].length, 60);
});

test('substeps: nothing, a negative span and values that are not finite give no slices', () => {
  for (const span of [0, -1, NaN, Infinity, -Infinity, undefined, null, 1e-12]) assert.deepEqual([...substeps(span)], [], String(span));
});

test('a manual clock and a real one walk the same way: advancing 500 ms by hand equals thirty frames of 16.67 ms', () => {
  const manual = [...substeps(0.5)].reduce((a, b) => a + b, 0);
  let last = 0, real = 0;
  for (let i = 1; i <= 30; i++) {
    const c = stepClock({ now: (i * 1000) / 60, last });
    last = c.last;
    for (const dt of substeps(c.dt)) real += dt;
  }
  near(real, manual, 1e-8);
});

// ---------- touch help ----------

test('touchHelpVisible: on a touch device in Spacer with a model, for 4 s after entering', () => {
  assert.equal(TOUCH_HELP_MS, 4000);
  const on = { touchDevice: true, mode: 'walk', hasModel: true };
  assert.equal(touchHelpVisible({ ...on, elapsedMs: 0 }), true);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: 3999 }), true);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: 4000 }), false);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: 60000 }), false);
});

test('touchHelpVisible: never on a computer, outside Spacer, without a model, or when Spacer was not entered', () => {
  const on = { touchDevice: true, mode: 'walk', hasModel: true, elapsedMs: 1000 };
  assert.equal(touchHelpVisible({ ...on, touchDevice: false }), false);
  assert.equal(touchHelpVisible({ ...on, mode: 'orbit' }), false);
  assert.equal(touchHelpVisible({ ...on, hasModel: false }), false);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: undefined }), false);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: null }), false);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: -5 }), false);
  assert.equal(touchHelpVisible({ ...on, elapsedMs: NaN }), false);
  assert.equal(touchHelpVisible({}), false);
  assert.equal(touchHelpVisible(), false);
});

// ---------- the file itself ----------

test('spacer.js stands alone and passes the publication gate words', () => {
  const src = readFileSync(new URL('../../src/app/spacer.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false, 'no imports: the module is pure');
  assert.equal(/\bdocument\b|\bwindow\b|\bnavigator\b/.test(src.replace(/\/\/.*$/gm, '')), false, 'no DOM in the code');
  assert.equal(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|import\(/.test(src), false, 'the words the gate stops on, comments included');
  assert.equal(/[\u2014\u2013]/.test(src), false, 'no long dashes');
  assert.match(src.split('\n').slice(0, 6).join('\n'), /Ported from planwalk .*\(MIT, same author\), source commit fa1a280 \(v0\.3\.2\)\./);
});
