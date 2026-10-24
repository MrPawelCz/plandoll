// The furniture contract (src/furniture/specs.js) stays consistent: the layout engine and the piece builders both rely on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECS, SPEC_BY_ID, ROOM_TYPES, GROUPS, PLACE_MODES, byTier, specOf } from '../../src/furniture/specs.js';

test('ids are unique, kebab-case and found by specOf', () => {
  const ids = SPECS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) { assert.match(id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/); assert.equal(specOf(id).id, id); }
  assert.equal(specOf('__proto__'), null);
  assert.equal(specOf('constructor'), null);
});

test('tier counts match the spec table (26 / 10 / 12)', () => {
  assert.deepEqual([byTier(1).length, byTier(2).length, byTier(3).length], [26, 10, 12]);
});

test('sizes, ranges and budgets are sane', () => {
  for (const s of SPECS) {
    assert.ok(GROUPS.includes(s.group), s.id);
    assert.equal(s.size.length, 3, s.id);
    for (const v of s.size) assert.ok(Number.isFinite(v) && v > 0 && v < 5, `${s.id} size`);
    for (const [axis, [lo, hi]] of Object.entries(s.range)) {
      const v = s.size[{ w: 0, d: 1, h: 2 }[axis]];
      assert.ok(lo <= v && v <= hi, `${s.id} range ${axis} must contain the default size`);
    }
    assert.ok(s.maxTris >= 500 && s.maxTris <= 20000, s.id);
    assert.ok(new Set(s.slots).size === s.slots.length, `${s.id} duplicate slot`);
    assert.ok(s.label.en && s.label.pl, s.id);
    assert.ok(!/[\u2013\u2014]/.test(s.label.en + s.label.pl), `${s.id}: no long dashes in labels`);
  }
});

test('rooms and placement modes use the known vocabulary', () => {
  for (const s of SPECS) {
    assert.ok(s.rooms.length > 0, `${s.id} has no rooms`);
    for (const r of s.rooms) assert.ok(r === 'any' || ROOM_TYPES.includes(r), `${s.id}: ${r}`);
    assert.ok(PLACE_MODES.includes(s.place.mode), s.id);
    if (s.place.mode === 'surface') {
      assert.ok(s.place.onTop?.length, `${s.id} needs onTop`);
      for (const id of s.place.onTop) assert.ok(SPEC_BY_ID[id], `${s.id} sits on unknown ${id}`);
    }
    if (s.place.mode === 'wall-mount') assert.ok(s.place.elevation >= 0, `${s.id} needs elevation`);
    if (s.place.mode === 'ceiling') assert.ok(s.place.drop > 0 && s.place.elevation > 0, `${s.id} needs drop and elevation`);
    if (s.emits) assert.ok(s.emits.kind && s.emits.color && s.emits.power > 0, s.id);
  }
});

test('every room type that matters has something to put in it', () => {
  for (const r of ['living', 'dining', 'kitchen', 'bedroom', 'bath', 'hall']) {
    assert.ok(SPECS.some((s) => s.rooms.includes(r) && s.tier <= 2), r);
  }
});
