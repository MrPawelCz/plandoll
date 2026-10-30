// The controls answer a press and light up on a hover only for a mouse; leaving the editor puts intro=0 in the address, the plain link never has it
// (docs/DESIGN.md 6l).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editHash, parseParams } from '../../src/app/params.js';
import { setViewParams } from '../../src/app/share.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CSS_FILES = ['src/app/ui.js', 'src/app/dock.js', 'src/app/panel.js', 'src/app/files.js'];
const HOVER_GATE = '@media (hover:hover) and (pointer:fine){';

test('every :hover rule of the controls sits inside the pointer-only media query', () => {
  let seen = 0;
  for (const f of CSS_FILES) {
    for (const line of read(f).split('\n')) {
      const at = line.indexOf(':hover');
      if (at < 0) continue;
      seen++;
      const gate = line.lastIndexOf(HOVER_GATE, at);
      assert.ok(gate >= 0 && !line.slice(gate, at).includes('}'), `${f}: a :hover rule outside the hover gate: ${line.slice(0, 90)}`);
    }
  }
  assert.ok(seen >= 8, 'the eight hover rules of the page are still there and checked');
});

test('every group of controls answers a press: a short transform transition with the strong ease-out and an :active scale', () => {
  for (const f of CSS_FILES) {
    const css = read(f);
    assert.match(css, /transition:transform \.12s cubic-bezier\(\.23,1,\.32,1\)/, `${f} has the press transition`);
    assert.match(css, /:active[^{]*\{transform:scale\(\.9(7|85)\)\}/, `${f} has a press rule`);
  }
  assert.match(read('src/app/ui.js'), /#ps-edit button:active:not\(\[disabled\]\)\{transform:scale\(\.97\)\}/, 'a disabled edit button does not move');
});

test('no grey box on a tap, and the browser bar takes the colour of the page', () => {
  const b = read('tools/build.mjs');
  assert.match(b, /-webkit-tap-highlight-color:transparent/);
  assert.match(b, /<meta name="theme-color" content="#e9dfcf">/);
});

test('the edit panel keeps inside a phone window: dvh next to vh', () => {
  assert.match(read('src/app/ui.js'), /#ps-edit-panel\{[^}]*max-height:calc\(100vh - 140px\);max-height:calc\(100dvh - 140px\)/);
});

test('leaving the editor puts intro=0 in the address, entering keeps what is there, the plain link of Copy link never has it', () => {
  const off = editHash('#amber&edit=1&az=40', false, { preset: 'clear', t: 0.25, lang: 'pl' });
  const o = parseParams(off, {});
  assert.ok(!o.intro, 'intro is off after Done');
  assert.equal(o.edit, false);
  assert.equal(o.az, 40, 'the rest of the address stays');
  const on = editHash(off, true, {});
  assert.equal(parseParams(on, {}).edit, true);
  assert.ok(on.includes('intro=0'), 'entering the editor again does not touch it');
  const link = setViewParams('', { preset: 'clear', t: 0.4, az: 30 }, 'z1.x');
  assert.equal(link.includes('intro'), false, 'the clean link has no intro parameter');
  assert.equal(setViewParams(off, { preset: 'clear' }, null).includes('intro=0'), true, 'the address of the page keeps it');
  assert.ok(parseParams('#amber', {}).intro, 'a page opened from a link still gets the intro');
});
