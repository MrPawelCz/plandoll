// The share link (src/app/share.js): a layout and a plan of your own packed into the address and read back. Node has the same CompressionStream as a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { specOf } from '../../src/furniture/specs.js';
import { serializeLayout, parseLayout } from '../../src/editor/index.js';
import { createEditSession } from '../../src/app/edit.js';
import { readPlanText } from '../../src/app/planfile.js';
import { parseParams, planHash, editHash, floorHash, withoutShare, splitHash } from '../../src/app/params.js';
import { encodeShare, decodeShare, packLayout, planForLink, setViewParams, lostCount, SHARE_MAX_VALUE, SHARE_MAX_TEXT, SHARE_LONG, SHARE_KEY } from '../../src/app/share.js';

const exampleText = (name) => readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8');
function build(name) {
  const plan = JSON.parse(exampleText(name));
  for (const lv of plan.levels) lv.furniture = [];
  const model = buildModel(modelOf(analyzePlan(plan)));
  const layout = autoFurnish(model, { seed: 1, allowedTypes: piecesImplemented() });
  return { model, layout };
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');

test('constants: the key, and the limits that keep a link from being a way to hang the page', () => {
  assert.equal(SHARE_KEY, 'share'); assert.equal(SHARE_MAX_VALUE, 400000); assert.equal(SHARE_LONG, 4000);
  assert.ok(SHARE_MAX_TEXT > 2 * 2000000, 'room for a plan and a layout, each at the file limit');
});

for (const name of ['flat-1', 'duplex-1']) {
  test(`${name}: the packed layout reads back to the same layout, with no warning, and is shorter than the saved text`, () => {
    const { model, layout } = build(name);
    const text = serializeLayout(layout), packed = packLayout(text);
    const full = parseLayout(text, model), back = parseLayout(JSON.stringify(packed), model);
    assert.ok(full.ok && back.ok);
    assert.deepEqual(back.layout, full.layout, 'every piece with its place, turn, size, height, support and colours');
    assert.deepEqual(back.warnings, full.warnings, 'packing adds no warning');
    assert.ok(JSON.stringify(packed).length < text.length * 0.8, `${JSON.stringify(packed).length} of ${text.length} characters`);
  });

  test(`${name}: through encodeShare and decodeShare the layout comes back as it went in; the link stays under the budget`, async () => {
    const { model, layout } = build(name);
    const packed = packLayout(serializeLayout(layout));
    const enc = await encodeShare({ layout: packed });
    assert.ok(enc.ok); assert.equal(enc.compressed, true); assert.match(enc.value, /^z1\.[A-Za-z0-9_-]+$/); assert.equal(enc.chars, enc.value.length);
    // what a person was told: about 1 700 characters for the flat and 2 600 for the duplex, plus the view parameters
    assert.ok(enc.value.length < (name === 'flat-1' ? 2000 : 3000), `${name}: ${enc.value.length} characters`);
    assert.ok(enc.value.length < SHARE_LONG);
    const dec = await decodeShare(enc.value);
    assert.ok(dec.ok); assert.equal(dec.plan, null); assert.deepEqual(dec.layout, packed);
    assert.deepEqual(parseLayout(JSON.stringify(dec.layout), model).layout, parseLayout(serializeLayout(layout), model).layout);
  });
}

test('an edited layout (a turned and recoloured piece, a recoloured room, a piece that stands on another) survives the link', async () => {
  const { model, layout } = build('duplex-1');
  const session = createEditSession({ layout, model, allowedTypes: piecesImplemented() });
  const piece = layout.levels[0].pieces.find((p) => specOf(p.type)?.slots?.length && !p.on);
  assert.ok(piece, 'a piece with a colour slot');
  session.select(piece.id);
  assert.ok(session.turn(90).ok);
  assert.ok(session.recolor(specOf(piece.type).slots[0], '#336699').ok);
  const room = model.levels[0].rooms[0];
  assert.ok(session.selectRoom(model.levels[0].id, room.id));
  assert.ok(session.recolorRoom('wall', '#abcdef').ok); assert.ok(session.recolorRoom('floor', '#102030').ok);
  const text = session.exportText();
  const enc = await encodeShare({ layout: packLayout(text) });
  const dec = await decodeShare(enc.value);
  const back = parseLayout(JSON.stringify(dec.layout), model);
  assert.ok(back.ok);
  assert.deepEqual(back.layout, parseLayout(text, model).layout);
  const moved = back.layout.levels[0].pieces.find((p) => p.id === piece.id);
  assert.equal(moved.colors[specOf(piece.type).slots[0]], '#336699');
  assert.deepEqual(back.layout.levels[0].rooms[room.id], { wall: '#abcdef', floor: '#102030' });
  assert.ok(back.layout.levels.flatMap((l) => l.pieces).some((p) => p.on), 'props that stand on a piece keep their height and support');
  assert.deepEqual(back.warnings, ['Piece ' + piece.id + ' sticks out of its room.'], 'turned, the piece sticks out a little: kept, with a soft warning');
  assert.equal(lostCount(back.warnings), 0, 'and that is no loss, so the page says nothing about items left out');
});

test('lostCount counts what was skipped or left out and nothing else', () => {
  assert.equal(lostCount(['Piece a sticks out of its room.', 'Piece b: the size was moved into the range of sofa.', 'Piece c: the height was moved onto d.']), 0);
  assert.equal(lostCount(['Piece a has an unknown type: skipped.', 'Piece b sticks out of its room.', 'Level x is not in the plan: its 3 pieces were skipped.', '4 more warnings left out.']), 3);
  assert.equal(lostCount([]), 0); assert.equal(lostCount(undefined), 0); assert.equal(lostCount(null), 0);
  const { model } = build('flat-1');
  const room = model.levels[0].rooms[0].id;
  const r = parseLayout(JSON.stringify({ version: 1, levels: [{ id: model.levels[0].id, pieces: [{ id: 'a', type: 'no-such-type', room, x: 1, y: 1 }] }, { id: 'ghost', pieces: [] }] }), model);
  assert.ok(r.ok); assert.ok(lostCount(r.warnings) >= 1);
});

test('packLayout leaves out only what a reader fills in by itself; text that is no layout gives null', () => {
  const { layout } = build('flat-1');
  const text = serializeLayout(layout);
  const packed = packLayout(text);
  assert.equal(packed.version, 1); assert.equal(packed.seed, undefined, 'the seed 1 is the default');
  for (const lv of packed.levels) for (const p of lv.pieces) {
    assert.deepEqual(Object.keys(p).filter((k) => ['id', 'type', 'room', 'x', 'y'].includes(k)), ['id', 'type', 'room', 'x', 'y']);
    assert.ok(!('colors' in p) || Object.keys(p.colors).length > 0); assert.ok(!('on' in p) || p.on);
  }
  assert.equal(packLayout('not json'), null); assert.equal(packLayout('{"version":2,"levels":[]}'), null); assert.equal(packLayout('[]'), null);
  assert.equal(packLayout(JSON.stringify({ version: 1, seed: 7, levels: [] })).seed, 7);
});

for (const name of ['flat-1', 'duplex-1']) {
  test(`${name}: a plan packed for a link is read by the validator to the same walls, openings, rooms and stairs`, () => {
    const first = readPlanText(exampleText(name), 'en');
    assert.ok(first.ok);
    const link = planForLink(first.plan);
    assert.equal(link.units, 'm');
    assert.ok(!('bounds' in link)); assert.ok(link.levels.every((lv) => !('furniture' in lv) && lv.walls.every((w) => !('length' in w) && !('dir' in w))));
    const second = readPlanText(JSON.stringify(link), 'en');
    assert.ok(second.ok, second.message);
    assert.ok(second.warnings <= first.warnings, 'no new warning');
    const near = (a, b, path) => {
      if (typeof a === 'number' && typeof b === 'number') return assert.ok(Math.abs(a - b) < 2e-4, `${path}: ${a} vs ${b}`);
      if (Array.isArray(a)) { assert.equal(a.length, b.length, path); return a.forEach((x, i) => near(x, b[i], `${path}[${i}]`)); }
      if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a), Object.keys(b), path); return Object.keys(a).forEach((k) => near(a[k], b[k], `${path}.${k}`)); }
      assert.equal(a, b, path);
    };
    const L = (plan) => plan.levels.map((lv) => ({
      id: lv.id, name: lv.name, elevation: lv.elevation, height: lv.height, slab: lv.slab,
      walls: lv.walls.map((w) => [w.id, w.kind, w.from, w.to, w.thickness, w.height]),
      openings: lv.openings.map((o) => [o.id, o.wall, o.type, o.offset, o.width, o.height, o.sill, o.hinge, o.opens_to]),
      rooms: lv.rooms.map((r) => [r.id, r.name, r.use, r.floor, r.ceiling, r.polygon]),
      stairs: lv.stairs.map((s) => [s.id, s.from, s.to, s.width, s.steps, s.to_level, s.rise]),
    }));
    near(L(second.plan), L(first.plan), 'plan');
  });
}

test('planForLink: something that is not a normalized plan gives null; a declared room area is kept', () => {
  assert.equal(planForLink(null), null); assert.equal(planForLink([]), null); assert.equal(planForLink({ levels: 'x' }), null);
  const first = readPlanText(exampleText('flat-1'), 'en');
  const withArea = JSON.parse(JSON.stringify(first.plan));
  withArea.levels[0].rooms[0].declaredArea = 12.3456789;
  assert.equal(planForLink(withArea).levels[0].rooms[0].area, 12.3457);
});

test('a plan of your own travels with its layout: both come back, and the plan is read by the validator again', async () => {
  const first = readPlanText(exampleText('duplex-1'), 'en');
  const { layout } = build('duplex-1');
  const enc = await encodeShare({ plan: planForLink(first.plan), layout: packLayout(serializeLayout(layout)) });
  assert.ok(enc.ok);
  const dec = await decodeShare(enc.value);
  assert.ok(dec.ok && dec.plan && dec.layout);
  assert.ok(readPlanText(JSON.stringify(dec.plan), 'en').ok);
  assert.ok(enc.value.length < 4000, `${enc.value.length} characters with the plan`);
});

test('without CompressionStream the link is the plain text (u1.), and every browser reads it back; a deflated one needs DecompressionStream', async () => {
  const { layout } = build('flat-1');
  const packed = packLayout(serializeLayout(layout));
  const plain = await encodeShare({ layout: packed }, {});
  assert.ok(plain.ok); assert.equal(plain.compressed, false); assert.match(plain.value, /^u1\./);
  const dec = await decodeShare(plain.value);
  assert.ok(dec.ok); assert.deepEqual(dec.layout, packed);
  const z = await encodeShare({ layout: packed });
  assert.deepEqual(await decodeShare(z.value, {}), { ok: false, error: 'unsupported' });
  assert.ok(plain.value.length > z.value.length);
});

test('a share value that is not one is refused with a reason, never an exception', async () => {
  const err = async (v, env) => (await decodeShare(v, env)).error;
  assert.equal(await err(undefined), 'empty'); assert.equal(await err(''), 'empty'); assert.equal(await err(42), 'empty');
  assert.equal(await err('abc'), 'format'); assert.equal(await err('x1.abcd'), 'format'); assert.equal(await err('z1abcd'), 'format');
  assert.equal(await err('z1.ab+c'), 'format'); assert.equal(await err('z1.ab/c'), 'format'); assert.equal(await err('z1.a b'), 'format');
  assert.equal(await err('z1.abcde'), 'format', 'a length that no base64 text has');
  assert.equal(await err(`z1.${'A'.repeat(SHARE_MAX_VALUE)}`), 'too-long');
  assert.equal(await err('z1.AAAA'), 'broken', 'bytes that are no deflate stream');
  assert.equal(await err('z1.'), 'broken', 'nothing to inflate');
  const good = (await encodeShare({ layout: { version: 1, levels: [] } })).value;
  assert.equal(await err(good.slice(0, good.length - 6)), 'broken', 'a link that was cut off');
  assert.equal(await err(`u1.${b64(Buffer.from('{"v":1,"layout":{"version":1,"levels":[]}}'))}`.replace(/.$/, '')), 'broken', 'a plain text that was cut');
});

test('the text inside must be a JSON object of the right version with a plan or a layout', async () => {
  const plain = (obj) => `u1.${b64(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))}`;
  assert.equal((await decodeShare(plain('[1,2]'))).error, 'broken');
  assert.equal((await decodeShare(plain('"text"'))).error, 'broken');
  assert.equal((await decodeShare(plain('null'))).error, 'broken');
  assert.equal((await decodeShare(plain({ v: 2, layout: {} }))).error, 'version');
  assert.equal((await decodeShare(plain({ layout: {} }))).error, 'version');
  assert.equal((await decodeShare(plain({ v: 1 }))).error, 'empty');
  assert.equal((await decodeShare(plain({ v: 1, layout: 'x', plan: [] }))).error, 'empty', 'a plan or layout that is no object counts as none');
  assert.equal((await decodeShare(`u1.${b64(Buffer.from([0xff, 0xfe, 0x80]))}`)).error, 'broken', 'bytes that are no UTF-8 text');
  const ok = await decodeShare(plain({ v: 1, layout: { version: 1, levels: [] }, extra: 'ignored' }));
  assert.ok(ok.ok); assert.equal(ok.plan, null); assert.deepEqual(ok.layout, { version: 1, levels: [] });
});

test('a small deflated text that unpacks to a huge one is stopped while it unpacks', async () => {
  const bomb = deflateRawSync(Buffer.alloc(60 * 1024 * 1024)); // 60 MB of zeros deflate to about 60 KB
  const value = `z1.${b64(bomb)}`;
  assert.ok(value.length < SHARE_MAX_VALUE, `${value.length} characters`);
  const t0 = Date.now();
  assert.deepEqual(await decodeShare(value), { ok: false, error: 'too-large' });
  assert.ok(Date.now() - t0 < 5000, 'it stops at the limit, it does not unpack it all');
});

test('a layout too big for a link says so (too-long), and nothing at all is not a link', async () => {
  const noise = Array.from({ length: 120000 }, (_, i) => Math.round(((i * 7919) % 1000003) * 997) / 1000);
  assert.deepEqual(await encodeShare({ layout: { version: 1, levels: [], junk: noise } }), { ok: false, error: 'too-long' });
  assert.deepEqual(await encodeShare({}), { ok: false, error: 'empty' });
  assert.deepEqual(await encodeShare(), { ok: false, error: 'empty' });
});

test('hostile content is data: keys like __proto__ do not reach Object.prototype, and the readers refuse or clean what they are given', async () => {
  const plain = (text) => `u1.${b64(Buffer.from(text))}`;
  const dec = await decodeShare(plain('{"v":1,"layout":{"__proto__":{"polluted":true},"version":1,"levels":[]},"plan":{"__proto__":{"polluted2":true},"levels":[]}}'));
  assert.ok(dec.ok);
  assert.equal({}.polluted, undefined); assert.equal({}.polluted2, undefined);
  const { model } = build('flat-1');
  const lv = model.levels[0].id, room = model.levels[0].rooms[0].id;
  const hostile = {
    version: 1, seed: 'NaN', levels: [{ id: lv, pieces: [
      { id: '<img src=x onerror=alert(1)>', type: 'sofa', room, x: 1, y: 1 },
      { id: 'a', type: 'no-such-type', room, x: 1, y: 1 },
      { id: 'b', type: specOf('bed') ? 'bed' : 'sofa', room: 'x'.repeat(100), x: 1e308, y: -1e308 },
      { id: 'c', type: 'sofa', room, x: Infinity, y: 0 },
      { id: 'd', type: 'sofa', room, x: 1, y: 1, size: [1e9, 1e9, 1e9], colors: { seat: 'javascript:alert(1)' } },
    ] }, { id: 'ghost', pieces: [] }],
  };
  const r = parseLayout(JSON.stringify(hostile), model);
  assert.ok(r.ok, 'a hostile layout is cleaned, it does not crash the reader');
  assert.ok(r.warnings.length >= 4);
  assert.equal(r.layout.levels.flatMap((l) => l.pieces).filter((p) => /[<>]/.test(p.id)).length, 0, 'no piece id with markup');
  assert.equal(parseLayout(JSON.stringify({ version: 2, levels: [] }), model).ok, false);
  assert.equal(readPlanText(JSON.stringify(dec.plan), 'en').ok, false, 'a plan with no walls is no plan');
});

test('setViewParams: the view of the page goes in the address, defaults stay out, the long part comes last', () => {
  const view = { preset: 'lamplit', t: 0.7, az: 41.6, pol: 52.2, floor: 1, plan: 'duplex-1', seed: 1 };
  assert.equal(setViewParams('', view, 'z1.abc'), 'preset=lamplit&t=0.700&az=41.6&pol=52.2&floor=1&plan=duplex-1&share=z1.abc');
  assert.equal(setViewParams('', { az: 35.4567, pol: 51 }, ''), 'az=35.46&pol=51', 'two decimals at most, no trailing zeros');
  const p = parseParams(`#${setViewParams('', view, 'z1.abc')}`);
  assert.deepEqual([p.preset, p.t, p.az, p.pol, p.floor, p.plan.name, p.share], ['lamplit', 0.7, 41.6, 52.2, 1, 'duplex-1', 'z1.abc']);
  assert.equal(setViewParams('', { preset: 'amber', t: 0.25, floor: 'all', plan: 'flat-1', seed: 1 }, 'u1.x'), 'preset=amber&t=0.250&share=u1.x', 'all floors, the flat and the seed 1 are defaults');
  assert.equal(setViewParams('', { preset: 'amber', t: 0.25, seed: 7 }, 'u1.x'), 'preset=amber&t=0.250&seed=7&share=u1.x');
  assert.equal(setViewParams('', { preset: 'nonsense', t: 5, az: NaN, floor: 'x' }), 't=1.000', 'a wrong value is left out; no value, no share=');
  assert.equal(setViewParams('', {}, ''), '');
});

test('setViewParams: a hash that is kept keeps its other parameters and takes the new view and link instead of the old', () => {
  const h = setViewParams('#lamplit&lang=pl&edit=1&q=low&t=0.1&floor=0&share=old&az=1', { preset: 'clear', t: 0.4, floor: 'all' }, 'z1.new');
  const kv = splitHash(h);
  assert.deepEqual(kv.bare, [], 'a bare preset word is replaced by preset=');
  assert.equal(kv.kv.preset, 'clear'); assert.equal(kv.kv.t, '0.400'); assert.equal(kv.kv.floor, undefined); assert.equal(kv.kv.az, undefined);
  assert.equal(kv.kv.lang, 'pl'); assert.equal(kv.kv.edit, '1'); assert.equal(kv.kv.q, 'low'); assert.equal(kv.kv.share, 'z1.new');
  assert.ok(h.endsWith('share=z1.new'));
  assert.equal(setViewParams('#t=%&share=x', { preset: 'amber' }, 'z1.y').includes('share=z1.y'), true, 'a broken percent sequence does not stop it');
});

test('the address helpers: share= is read, kept by edit and floor changes, and dropped when the plan changes', () => {
  assert.equal(parseParams('#share=z1.abc').share, 'z1.abc'); assert.equal(parseParams('#t=0.5').share, null); assert.equal(parseParams('#share=').share, null);
  assert.equal(splitHash(editHash('#share=z1.x&edit=1', false, {})).kv.share, 'z1.x');
  assert.equal(splitHash(editHash('#share=z1.x', true, { preset: 'amber' })).kv.share, 'z1.x');
  assert.equal(splitHash(floorHash('#share=z1.x&floor=1', 0)).kv.share, 'z1.x');
  assert.equal(splitHash(planHash('#share=z1.x&plan=duplex-1&floor=1&lang=pl', 'flat-1')).kv.share, undefined, 'the layout belonged to the other plan');
  assert.equal(splitHash(planHash('#share=z1.x', 'duplex-1')).kv.share, undefined);
  assert.equal(withoutShare('#lamplit&share=z1.x&lang=pl'), 'lamplit&lang=pl');
  assert.equal(withoutShare('#t=0.3'), 't=0.3'); assert.equal(withoutShare(''), '');
});

test('a link that nests a million levels deep is refused, and one that merely nests deeply too: the reader never recurses over it (review finding 1)', async () => {
  const nest = (depth) => `${'['.repeat(depth)}${']'.repeat(depth)}`;
  for (const depth of [41, 5000, 200000]) {
    const text = `{"v":1,"layout":{"version":1,"levels":[],"x":${nest(depth)}}}`;
    const link = `z1.${b64(deflateRawSync(Buffer.from(text)))}`;
    assert.ok(link.length < 2000, `${depth} levels in ${link.length} characters`);
    assert.deepEqual(await decodeShare(link), { ok: false, error: 'broken' }, `${depth} levels`);
    if (depth <= 5000) assert.equal((await decodeShare(`u1.${b64(Buffer.from(text))}`)).error, 'broken', 'the plain form too');
  }
  const objects = `{"v":1,"plan":${'{"a":'.repeat(20000)}1${'}'.repeat(20000)}}`;
  assert.equal((await decodeShare(`u1.${b64(Buffer.from(objects))}`)).error, 'broken', 'nested objects count too');
  const fine = await decodeShare(`u1.${b64(Buffer.from(`{"v":1,"layout":{"version":1,"levels":[],"x":${nest(30)}}}`))}`);
  assert.ok(fine.ok, 'a layout of ordinary depth is read');
});

test('a DecompressionStream that exists but does not know deflate-raw is "unsupported", not "broken"', async () => {
  const { layout } = build('flat-1');
  const z = await encodeShare({ layout: packLayout(serializeLayout(layout)) });
  const env = { DecompressionStream: class { constructor() { throw new TypeError('Unsupported compression format'); } } };
  assert.deepEqual(await decodeShare(z.value, env), { ok: false, error: 'unsupported' });
});

test('planForLink never rounds a positive number to zero, and leaves the free text of meta out (review findings 3 and 8)', () => {
  const first = readPlanText(exampleText('flat-1'), 'en');
  const thin = JSON.parse(JSON.stringify(first.plan));
  thin.meta = { notes: 'x'.repeat(500) };
  thin.levels[0].walls[0].thickness = 1e-9; thin.levels[0].walls[0].height = 0.00001;
  thin.levels[0].openings[0].width = 2e-6; thin.levels[0].rooms[0].declaredArea = 1e-7;
  const link = planForLink(thin);
  assert.ok(!('meta' in link), 'the page never reads meta');
  assert.equal(link.levels[0].walls[0].thickness, 1e-4); assert.equal(link.levels[0].walls[0].height, 1e-4);
  assert.equal(link.levels[0].openings[0].width, 1e-4); assert.equal(link.levels[0].rooms[0].area, 1e-4);
  assert.equal(planForLink({ levels: [{ id: 'a', elevation: 0, walls: [{ id: 'w', from: [0, 0], to: [1, 0], thickness: 0.1234567 }] }] }).levels[0].walls[0].thickness, 0.1235);
  assert.equal(planForLink({ levels: [{ id: 'a', elevation: 0, walls: [{ id: 'w', from: [-0.00001, 0], to: [1, 0], thickness: 0.1 }] }] }).levels[0].walls[0].from[0], -0, 'a coordinate may be zero');
});

test('no long dash in the new source (the repository keeps its texts free of them)', () => {
  const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  for (const f of ['src/app/share.js', 'tests/app/share.test.mjs']) assert.ok(!LONG_DASH.test(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')), f);
});
