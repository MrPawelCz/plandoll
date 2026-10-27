// The words and the skip of the intro (introview.js) against a small DOM stub: the word and the counter in both languages, the line to skip, and the shield that takes the first touch, key
// or turn of the wheel (and the click that follows a touch) so that nothing else on the page sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntroView, INTRO_STYLE_ID } from '../../src/app/introview.js';

function makeDoc() {
  const doc = {};
  const mk = (tag) => ({
    tag, children: [], parent: null, style: {}, attrs: {}, className: '', textContent: '', id: '',
    appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; },
    remove() { this.parent?.removeChild(this); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
  });
  Object.assign(doc, { head: mk('head'), body: mk('body'), createElement: mk });
  const all = (n) => [n, ...n.children.flatMap(all)];
  doc.getElementById = (id) => all(doc.head).concat(all(doc.body)).find((n) => n.id === id) ?? null;
  doc.all = () => all(doc.body);
  return doc;
}
// a window that records its listeners and sends events to them like the browser: capture listeners in the order they were added
function makeWin() {
  const ls = [];
  return {
    ls,
    addEventListener(type, fn, opt) { ls.push({ type, fn, capture: opt === true || !!opt?.capture }); },
    removeEventListener(type, fn) { const i = ls.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) ls.splice(i, 1); },
    send(type, props = {}) {
      const e = { type, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
      for (const l of [...ls]) { if (l.type === type && !e.stopped) l.fn(e); }
      return e;
    },
    count: (type) => ls.filter((l) => l.type === type).length,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const look = (o = {}) => ({ chip: { show: true, key: 'walls', opacity: 1, scale: 1 }, count: { show: false, opacity: 0, scale: 1, n: 0, m: 0 }, hint: 0.5, ...o });

test('the view builds its own style once, a root that no pointer reaches except the shield, and says nothing to a screen reader', () => {
  const doc = makeDoc(), win = makeWin();
  const a = createIntroView({ doc, win, lang: 'en' });
  assert.equal(doc.all().filter((n) => n.id === 'ps-intro').length, 1);
  const css = doc.getElementById(INTRO_STYLE_ID).textContent;
  assert.match(css, /#ps-intro\{position:fixed;inset:0;z-index:40;pointer-events:none/, 'the root lets everything through');
  assert.match(css, /#ps-intro-shield\{position:absolute;inset:0;pointer-events:auto/, 'and the shield takes it');
  assert.match(css, /\.psi-hud\{position:absolute;top:14px;right:14px/, 'the words are in the top right corner, away from the marks of a page in the other corners');
  assert.ok(!LONG_DASH.test(css) && !/fetch|XMLHttpRequest|localStorage|cookie/.test(css));
  assert.equal(a.element.attrs['aria-hidden'], 'true');
  createIntroView({ doc, win: makeWin(), lang: 'pl' });
  assert.equal(doc.head.children.filter((n) => n.id === INTRO_STYLE_ID).length, 1, 'the style is added once');
});

test('the word, the counter and the line to skip are drawn in the language of the page', () => {
  for (const [lang, chip, count, skip] of [['pl', 'ŚCIANY', 'mebel 7 z 35', 'Dotknij, aby pominąć'], ['en', 'WALLS', 'piece 7 of 35', 'Tap to skip']]) {
    const doc = makeDoc(), v = createIntroView({ doc, win: makeWin(), lang });
    v.show(look({ count: { show: true, opacity: 0.5, scale: 0.8, n: 7, m: 35 } }));
    assert.equal(doc.getElementById('ps-intro-chip').textContent, chip);
    assert.equal(doc.getElementById('ps-intro-count').textContent, count);
    assert.equal(doc.getElementById('ps-intro-hint').textContent, skip);
    assert.equal(doc.getElementById('ps-intro-chip').style.opacity, '1'); assert.equal(doc.getElementById('ps-intro-count').style.transform, 'scale(0.8000)');
    assert.equal(doc.getElementById('ps-intro-hint').style.opacity, '0.5');
    v.show(look({ chip: { show: false, key: 'x', opacity: 0, scale: 1 } }));
    assert.equal(doc.getElementById('ps-intro-chip').style.display, 'none'); assert.equal(doc.getElementById('ps-intro-count').style.display, 'none');
  }
  const doc = makeDoc(), v = createIntroView({ doc, win: makeWin(), lang: 'de' });
  v.show(look()); assert.equal(doc.getElementById('ps-intro-chip').textContent, 'WALLS', 'an unknown language is English');
});

test('the first touch ends the intro and the page under it sees nothing; the click that follows goes nowhere; the shield stays until the touch is over', async () => {
  const doc = makeDoc(), win = makeWin(), got = [];
  const v = createIntroView({ doc, win, lang: 'en', onSkip: (how) => got.push(how) });
  v.arm();
  const down = win.send('pointerdown', { pointerType: 'touch', isPrimary: true });
  assert.deepEqual(got, ['pointer']);
  assert.ok(down.defaultPrevented && down.stopped, 'the touch is taken');
  v.end(); // the page ends the intro in the handler of onSkip
  assert.equal(v.swallowing, true);
  assert.ok(doc.getElementById('ps-intro-shield'), 'the shield is still there for the click');
  const up = win.send('pointerup', { pointerType: 'touch' });
  assert.ok(up.stopped, 'the lift is taken too');
  const click = win.send('click', {});
  assert.ok(click.defaultPrevented && click.stopped, 'and the click');
  assert.deepEqual(got, ['pointer'], 'one skip only');
  const second = win.send('pointerdown', { isPrimary: true }); assert.ok(second.stopped && got.length === 1, 'a second touch in that moment is swallowed, not a second skip');
  await sleep(520);
  assert.equal(doc.getElementById('ps-intro-shield'), null, 'the shield goes shortly after the lift');
  assert.equal(doc.getElementById('ps-intro'), null, 'and the root with it');
  assert.equal(win.ls.length, 0, 'no listener is left');
  const after = win.send('click', {}); assert.equal(after.stopped, false, 'a click after that is the page\'s own');
});

test('a key ends the intro (Space, a letter, Escape), a modifier alone or a shortcut does not, and a key leaves no shield behind', () => {
  const doc = makeDoc(), win = makeWin(), got = [];
  const v = createIntroView({ doc, win, lang: 'en', onSkip: (how) => { got.push(how); v.end(); } });
  v.arm();
  for (const e of [{ key: 'Shift' }, { key: 'Control' }, { key: 'r', metaKey: true }, { key: 'l', ctrlKey: true }]) { const r = win.send('keydown', e); assert.equal(r.stopped, false, JSON.stringify(e)); }
  assert.deepEqual(got, []);
  const k = win.send('keydown', { key: ' ' });
  assert.deepEqual(got, ['key']); assert.ok(k.stopped && k.defaultPrevented, 'Space does not open the shell or scroll the page');
  assert.equal(doc.getElementById('ps-intro'), null, 'a key has no click after it: everything goes at once');
  assert.equal(win.ls.length, 0);
});

test('the wheel ends the intro and does not zoom; the right button and the context menu are taken while the intro plays', () => {
  const doc = makeDoc(), win = makeWin(), got = [];
  const v = createIntroView({ doc, win, lang: 'pl', onSkip: (how) => got.push(how) });
  v.arm();
  const menu = win.send('contextmenu', {}); assert.ok(menu.stopped && menu.defaultPrevented);
  const w = win.send('wheel', { deltaY: 40 });
  assert.deepEqual(got, ['wheel']); assert.ok(w.stopped && w.defaultPrevented);
  v.dispose();
  assert.equal(win.ls.length, 0); assert.equal(doc.getElementById('ps-intro'), null);
});

test('an intro that ends by itself takes the words and the shield away at once, and arm() after the end does nothing', () => {
  const doc = makeDoc(), win = makeWin(), v = createIntroView({ doc, win, lang: 'en' });
  v.arm();
  assert.equal(win.count('pointerdown'), 1); assert.equal(win.count('keydown'), 1); assert.equal(win.count('wheel'), 1);
  v.end();
  assert.equal(doc.getElementById('ps-intro'), null); assert.equal(win.ls.length, 0);
  v.arm(); assert.equal(win.ls.length, 0);
  const e = win.send('pointerdown', { isPrimary: true }); assert.equal(e.stopped, false, 'the page gets its touches back');
});

test('every listener of the skip is in the capture phase, so no handler of the page runs before it', () => {
  const win = makeWin();
  createIntroView({ doc: makeDoc(), win, lang: 'en' }).arm();
  assert.ok(win.ls.length >= 6);
  assert.ok(win.ls.every((l) => l.capture), win.ls.filter((l) => !l.capture).map((l) => l.type).join());
});
