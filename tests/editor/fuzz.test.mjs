// Random input with fixed seeds: damaged layout texts through parseLayout, and random sequences of editing operations.
// Nothing here may throw, produce a number that is not finite, break the limits or make a layout that cannot be saved and read back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, addPiece, movePiece, rotatePiece, turnPiece, deletePiece, resizePiece, recolorPiece, recolorRoom, duplicatePiece, resetToAuto, loadLayout,
  selectPiece, undo, redo, serializeLayout, parseLayout, HISTORY_LIMIT, IO_LIMITS, MATERIAL_KEYS,
} from '../../src/editor/index.js';
import { SPECS, specOf } from '../../src/furniture/specs.js';
import { LIMITS } from '../../src/layout/engine.js';
import { testPlans } from './plans.mjs';

function rng(seed) { // small seeded generator (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const plans = testPlans();

// A layout with room colours on every plan, as text: the starting points of the damage.
function colouredText(plan, n) {
  let st = createState(plan.layout);
  for (const lv of plan.model.levels) lv.rooms.slice(0, 3).forEach((r, i) => {
    st = recolorRoom(st, lv.id, r.id, i % 2 ? 'wall' : 'floor', i % 2 ? '#c8b8a0' : MATERIAL_KEYS[(i + n) % MATERIAL_KEYS.length], { model: plan.model }).state;
  });
  return serializeLayout(st.layout);
}
const bases = plans.map((p, i) => colouredText(p, i));

const NUM = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g;
function mutate(text, rand, kind) {
  const at = (n) => Math.floor(rand() * n);
  const numbers = () => [...text.matchAll(NUM)];
  const braces = () => [...text.matchAll(/\{/g)];
  switch (kind) {
    case 0: { const i = at(text.length); return text.slice(0, i) + text.slice(i + 1); }                       // remove a character
    case 1: case 2: case 3: {                                                                              // a number becomes 1e999, "NaN" or null
      const hits = numbers();
      const h = hits[at(hits.length)];
      return text.slice(0, h.index) + ['1e999', '"NaN"', 'null'][kind - 1] + text.slice(h.index + h[0].length);
    }
    case 4: { const b = braces()[at(braces().length)]; return `${text.slice(0, b.index + 1)}"x": 1, "x": 2, "id": "dup", "id": 5,${text.slice(b.index + 1)}`; }   // duplicated keys
    case 5: { const b = braces()[at(braces().length)]; return `${text.slice(0, b.index + 1)}"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted": 1}},${text.slice(b.index + 1)}`; }
    case 6: return text.slice(0, text.length >> 1);                                                         // cut in half
    case 7: {                                                                                              // repeat the arrays
      const d = JSON.parse(text);
      for (const lv of d.levels) lv.pieces = lv.pieces.concat(lv.pieces, lv.pieces, lv.pieces);
      return JSON.stringify(d);
    }
    case 8: { const i = at(text.length), j = at(text.length); const a = text.split(''); [a[i], a[j]] = [a[j], a[i]]; return a.join(''); }   // swap two characters
    case 9: return text.replace(/"type": "[a-z0-9-]+"/, `"type": "${['constructor', '__proto__', 'toString', ''][at(4)]}"`);
    case 10: { const hits = numbers(); const h = hits[at(hits.length)]; return `${text.slice(0, h.index)}[${h[0]}]${text.slice(h.index + h[0].length)}`; }
    default: { const hits = numbers(); const h = hits[at(hits.length)]; return `${text.slice(0, h.index)}${['-1e308', '1e308', '0.0000001', '9'.repeat(25), '-0'][at(5)]}${text.slice(h.index + h[0].length)}`; }
  }
}

test('300 damaged layout texts: the parser never throws, says ok or not, keeps the warning list short and answers within 50 ms', () => {
  const rand = rng(20241024);
  let worst = 0, accepted = 0, refused = 0, kept = 0;
  for (let i = 0; i < 300; i++) {
    const plan = plans[i % 3];
    const text = mutate(bases[i % 3], rand, i % 12);
    const t0 = performance.now();
    let r;
    assert.doesNotThrow(() => { r = parseLayout(text, i % 4 === 3 ? null : plan.model); }, `mutation ${i} kind ${i % 12}`);
    worst = Math.max(worst, performance.now() - t0);
    assert.ok(r.ok === true || r.ok === false, `ok must be a boolean (${i})`);
    assert.ok(Array.isArray(r.warnings) && r.warnings.length <= IO_LIMITS.warnings, `${r.warnings.length} warnings (${i})`);
    assert.ok(Array.isArray(r.errors));
    if (r.ok) {
      accepted++;
      const again = serializeLayout(r.layout);
      assert.equal(typeof again, 'string', `a layout that was accepted can be saved (${i})`);
      const back = parseLayout(again);
      assert.equal(back.ok, true, `${i} ${JSON.stringify(back.errors)}`);
      assert.equal(serializeLayout(back.layout), again, `a second save gives the same text (${i})`);
      for (const lv of r.layout.levels) for (const p of lv.pieces) { assert.ok([p.x, p.y, p.rot, p.elev, ...p.size].every(Number.isFinite)); kept++; }
    } else {
      refused++;
      assert.equal(r.layout, null);
      assert.ok(r.errors.length > 0, `a refused text says why (${i})`);
    }
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  }
  assert.ok(worst < 50, `slowest read ${worst.toFixed(1)} ms`);
  assert.ok(accepted >= 100 && refused >= 20 && kept > 1000, `the damage was mixed: ${accepted} accepted, ${refused} refused, ${kept} pieces kept`);
});

// ---- random sequences of operations ----
const TYPES = SPECS.map((s) => s.id);
const WILD = [NaN, Infinity, -Infinity, 1e300, -1e300, '5', null, undefined, {}, [], 'x', -0];

function allPieces(st) { return st.layout.levels.flatMap((lv) => lv.pieces); }
function invariants(st, label) {
  let total = 0;
  for (const lv of st.layout.levels) {
    assert.ok(lv.pieces.length <= LIMITS.perLevel, label);
    total += lv.pieces.length;
    for (const p of lv.pieces) assert.ok([p.x, p.y, p.rot, p.elev, ...p.size].every(Number.isFinite), `${label}: a number is not finite in ${p.id}`);
  }
  assert.ok(total <= LIMITS.total, label);
  assert.ok(st.history.past.length <= HISTORY_LIMIT && st.history.future.length <= HISTORY_LIMIT, `${label}: history ${st.history.past.length}/${st.history.future.length}`);
  const text = serializeLayout(st.layout);
  assert.equal(typeof text, 'string', `${label}: the layout can be saved`);
  const back = parseLayout(text);
  assert.equal(back.ok, true, `${label}: ${JSON.stringify(back.errors)}`);
  assert.equal(serializeLayout(back.layout), text, `${label}: save, load and save again give the same text`);
}

test('500 random sequences of editing operations on three plans: no exception, no number that is not finite, always savable', () => {
  const stats = {};
  const bump = (name, ok) => { const s = (stats[name] ??= { ok: 0, refused: 0 }); s[ok ? 'ok' : 'refused']++; };
  for (let seq = 0; seq < 500; seq++) {
    const plan = plans[seq % 3], rand = rng(7000 + seq);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const wild = (v) => (rand() < 0.04 ? pick(WILD) : v);
    let st = createState(plan.layout);
    for (let step = 0; step < 60; step++) {
      const pieces = allPieces(st);
      const id = pieces.length && rand() < 0.95 ? pick(pieces).id : 'nope';
      const level = pick(plan.model.levels);
      const opts = {
        model: plan.model,
        mode: rand() < 0.15 ? 'strict' : rand() < 0.08 ? 'off' : undefined,
        snap: rand() < 0.1 ? false : rand() < 0.15 ? { edges: true } : undefined,
        coalesceKey: rand() < 0.2 ? `drag:${id}` : undefined,
      };
      const near = pieces.length ? pick(pieces) : { x: 2, y: 2 };
      const x = near.x + (rand() - 0.5) * 3, y = near.y + (rand() - 0.5) * 3;
      const r = rand() * 100;
      let name, res;
      if (r < 14) { name = 'add'; res = addPiece(st, { type: rand() < 0.97 ? pick(TYPES) : pick(['nope', '__proto__', undefined]), x: wild(x), y: wild(y), rot: wild(rand() * 360), level: level.id }, opts); }
      else if (r < 36) { name = 'move'; res = movePiece(st, id, wild(x), wild(y), opts); }
      else if (r < 44) { name = 'turn'; res = turnPiece(st, id, wild(pick([90, -90, 15, 7.5])), opts); }
      else if (r < 48) { name = 'rotate'; res = rotatePiece(st, id, wild(rand() * 720 - 360), opts); }
      else if (r < 56) { name = 'delete'; res = deletePiece(st, id); }
      else if (r < 66) { name = 'resize'; res = resizePiece(st, id, { w: wild(0.2 + rand() * 3), d: wild(0.2 + rand() * 3), h: wild(0.2 + rand() * 3) }, opts); }
      else if (r < 74) { const spec = specOf(pieces.find((p) => p.id === id)?.type); name = 'recolor'; res = recolorPiece(st, id, spec ? pick(spec.slots) : 'body', rand() < 0.2 ? null : rand() < 0.5 ? pick(MATERIAL_KEYS) : wild(`#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}`), opts); }
      else if (r < 82) { name = 'room colour'; res = recolorRoom(st, level.id, rand() < 0.9 ? pick(level.rooms).id : 'nowhere', rand() < 0.5 ? 'wall' : 'floor', rand() < 0.2 ? null : wild(`#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}`), opts); }
      else if (r < 88) { name = 'duplicate'; res = duplicatePiece(st, id, opts); }
      else if (r < 93) { name = 'undo'; res = undo(st); }
      else if (r < 96) { name = 'redo'; res = redo(st); }
      else if (r < 98) { name = 'select'; res = selectPiece(st, rand() < 0.2 ? null : id); }
      else if (r < 99) { name = 'reset'; res = resetToAuto(st, plan.model, { seed: wild(seq) }); }
      else { name = 'load'; res = loadLayout(st, parseLayout(serializeLayout(st.layout)).layout); }
      const label = `sequence ${seq} step ${step} ${name}`;
      assert.equal(typeof res.ok, 'boolean', label);
      assert.ok(res.state && typeof res.state === 'object', label);
      assert.notEqual(res.reason, 'internal-error', `${label}: ${res.error}`);
      if (!res.ok) assert.equal(res.state, st, `${label}: a refused operation returns the same state`);
      bump(name, res.ok);
      st = res.state;
      if (step % 10 === 9) invariants(st, label);
    }
  }
  for (const name of ['add', 'move', 'turn', 'delete', 'resize', 'recolor', 'room colour', 'duplicate', 'undo', 'redo']) {
    assert.ok(stats[name] && stats[name].ok >= (name === 'redo' ? 5 : 20), `${name} succeeded only ${stats[name]?.ok ?? 0} times: ${JSON.stringify(stats)}`);
  }
  assert.ok(Object.values(stats).some((s) => s.refused > 0), 'some operations were refused, so the hostile input reached them');
});

test('1500 pieces and 200 steps of history: the limits hold under a long random run', () => {
  const plan = plans[1], rand = rng(99);
  let st = createState({ version: 1, seed: 1, levels: plan.model.levels.map((l) => ({ id: l.id, pieces: [] })) });
  const room = plan.model.levels[0].rooms.find((r) => r.id === 'living').id;
  for (let i = 0; i < 260; i++) st = addPiece(st, { type: 'plant-small', x: 1 + rand() * 6, y: 1 + rand() * 4, level: 'L0', room }, { mode: 'off' }).state;
  assert.equal(st.history.past.length, HISTORY_LIMIT);
  for (let i = 0; i < 300; i++) st = movePiece(st, st.layout.levels[0].pieces[i % 200].id, rand() * 8, rand() * 6, { model: plan.model, coalesceKey: `k${i}` }).state;
  assert.equal(st.history.past.length, HISTORY_LIMIT);
  invariants(st, 'long run');
});
