// The address after a plan is picked in the page (planHash): plan= is set, the default is left out, every other parameter stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, planHash, splitHash } from '../../src/app/params.js';

test('picking the duplex sets plan=duplex-1 and keeps everything else', () => {
  const h = planHash('#lamplit&t=0.7&q=low&lang=pl', 'duplex-1');
  const p = parseParams(`#${h}`);
  assert.equal(p.plan.name, 'duplex-1'); assert.equal(p.preset, 'lamplit'); assert.equal(p.q, 'low'); assert.equal(p.lang, 'pl'); assert.equal(p.t, 0.7);
  assert.deepEqual(splitHash(h).bare, ['lamplit'], 'a bare preset word stays');
});

test('picking the flat takes plan= out of the address, since flat-1 is the default', () => {
  assert.equal(splitHash(planHash('#plan=duplex-1&q=high', 'flat-1')).kv.plan, undefined);
  assert.equal(parseParams(`#${planHash('#plan=duplex-1&q=high', 'flat-1')}`).q, 'high');
  assert.equal(planHash('#plan=duplex-1', 'flat-1'), '');
});

test('a name that is no built-in plan removes plan= and nothing else; an address with a broken sequence does not throw', () => {
  assert.equal(planHash('#plan=duplex-1&lang=en', 'gen:5'), 'lang=en');
  assert.equal(planHash('#plan=duplex-1&lang=en', undefined), 'lang=en');
  assert.doesNotThrow(() => planHash('#t=%&plan=duplex-1', 'duplex-1'));
});

test('the edit and shell parameters survive a pick, so the picture and the address still agree after a reload', () => {
  const p = parseParams(`#${planHash('#edit=1&shell=0&btn=0', 'duplex-1')}`);
  assert.equal(p.edit, true); assert.equal(p.shell, false); assert.equal(p.btn, false); assert.equal(p.plan.name, 'duplex-1');
});
