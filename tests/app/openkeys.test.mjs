// What Space and Escape do to the open shell (shellKey in shell.js), and that the page registers that one handler and nothing else for the shell.
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

test('main.js listens for the shell keys only while the shell is on (not while editing) and through shellKey', () => {
  const src = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
  assert.match(src, /if \(useShell\) addEventListener\('keydown', onShellKey\)/);
  assert.match(src, /const useShell = shellOn\(params\)/);
  assert.match(src, /const act = shellKey\(e, shellTarget === 1\)/);
});
