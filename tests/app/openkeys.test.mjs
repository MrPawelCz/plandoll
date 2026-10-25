// What Space and Escape do to the open shell (shellKey in shell.js), and that the page registers its key handler only while the shell is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellKey } from '../../src/app/shell.js';

const key = (k, target = { tagName: 'BODY' }, mods = {}) => ({ key: k, code: k === ' ' ? 'Space' : k, target, ...mods });

test('Space opens a closed shell and closes an open one; Escape only closes', () => {
  assert.equal(shellKey(key(' '), false), 'open'); assert.equal(shellKey(key(' '), true), 'close');
  assert.equal(shellKey(key('Escape'), true), 'close'); assert.equal(shellKey(key('Escape'), false), null);
  assert.equal(shellKey({ key: 'Spacebar', code: 'Space', target: { tagName: 'DIV' } }, false), 'open', 'the code tells Space even when the key name differs');
  for (const k of ['a', 'Enter', 'ArrowLeft', 'Tab', '1', 'r', 'Delete']) { assert.equal(shellKey(key(k), false), null, k); assert.equal(shellKey(key(k), true), null, k); }
});

test('keys that belong to something else are left alone', () => {
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) for (const k of [' ', 'Escape']) assert.equal(shellKey(key(k, { tagName: tag }), true), null, `${tag} ${k}`);
  assert.equal(shellKey(key(' ', { tagName: 'DIV', isContentEditable: true }), false), null);
  for (const tag of ['BUTTON', 'A']) assert.equal(shellKey(key(' ', { tagName: tag }), false), null, `Space on a ${tag} activates it, not the shell`);
  assert.equal(shellKey(key('Escape', { tagName: 'BUTTON' }), true), 'close', 'Escape on a button still closes the shell');
  for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) { assert.equal(shellKey(key(' ', undefined, mods), false), null); assert.equal(shellKey(key('Escape', undefined, mods), true), null); }
  assert.equal(shellKey(null, true), null); assert.equal(shellKey({}, true), null); assert.equal(shellKey({ key: ' ' }, false), 'open', 'an event without a target is a key on the page');
});

test('a key that is held down counts once: the repeats do nothing', () => {
  assert.equal(shellKey(key(' ', undefined, { repeat: false }), false), 'open');
  for (const wantOpen of [false, true]) { assert.equal(shellKey(key(' ', undefined, { repeat: true }), wantOpen), null); assert.equal(shellKey(key('Escape', undefined, { repeat: true }), wantOpen), null); }
});

test('a key press that something else already took does nothing to the shell: one Escape never clears a selection and folds the shell', () => {
  for (const k of [' ', 'Escape']) for (const wantOpen of [false, true]) assert.equal(shellKey(key(k, undefined, { defaultPrevented: true }), wantOpen), null, `${k} ${wantOpen}`);
  assert.equal(shellKey(key('Escape', undefined, { defaultPrevented: false }), true), 'close', 'the next Escape, with nothing taking it, folds the shell');
});

test('main.js listens for the shell keys whenever the shell is on (also while editing) and through shellKey, and the editor takes the first Escape', () => {
  const src = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
  assert.match(src, /if \(useShell\) addEventListener\('keydown', onShellKey\)/);
  assert.match(src, /const useShell = shellOn\(params\)/);
  assert.match(src, /const act = shellKey\(e, shellTarget === 1\)/);
  // the editor's key listener comes first and marks an Escape that cleared a selection (a piece or a room) as taken
  assert.match(src, /e\.key === 'Escape' && \(session\.selected\(\) \|\| session\.selectedRoom\(\)\)\) \{ session\.select\(null\); e\.preventDefault\(\); \}/);
  assert.ok(src.indexOf("session.select(null); e.preventDefault();") < src.indexOf("if (useShell) addEventListener('keydown', onShellKey)"), 'the editor listener is registered before the shell listener');
});
