// The world outside the doors of Spacer: where the steps and paths go (from the model alone), the colours of the sky and the fog for the three moods,
// and the promise that the module touches no network and no storage. The scene itself needs a browser (tools/spacer-check.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathsFor, skyOf, PATH, FOG } from '../../src/render/outside.js';
import { sample } from '../../src/look/timeofday.js';
import { PRESETS, PRESET_NAMES } from '../../src/look/presets.js';
import { fileModel } from '../helpers/walk-model.mjs';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('flat-1: one step and path, at the front door, leading away from the flat (south, plan y grows)', () => {
  const m = fileModel('examples/flat-1.plan.json'), list = pathsFor(m);
  assert.deepEqual(list.map((p) => p.id), ['front']);
  const p = list[0];
  near(p.x, 1.0); near(p.y, 6.15); near(p.out[0], 0); near(p.out[1], 1); near(p.width, 0.9);
});

test('duplex-1: one step and path at the front door; passages and doors between rooms get none', () => {
  const m = fileModel('examples/duplex-1.plan.json'), list = pathsFor(m);
  assert.deepEqual(list.map((p) => p.id), ['front']);
  const p = list[0], b = m.bounds, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  assert.ok((p.x - cx) * p.out[0] + (p.y - cy) * p.out[1] > 0, 'the path leads away from the middle of the flat');
  near(p.x, 1.875); near(p.y, 6.55);
});

// A made-up ground floor: a slanted outer wall with a narrow door, an outer passage, a door with a high sill, a door of an inner wall and a window.
const wall = (id, from, to, kind) => {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]), dir = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  return { id, kind, from, dir, thickness: 0.3, normal: [dir[1], -dir[0]] };
};
const opening = (id, wallId, type, u0, u1, sill = 0) => ({ id, wallId, type, u0, u1, width: u1 - u0, sill });
const made = (walls, openings) => ({ levels: [{ elevation: 0, walls, openings }] });

test('a slanted outer wall: the path is perpendicular to it, on the outside, and the narrow door keeps its width', () => {
  const w = wall('a', [0, 0], [4, 3], 'exterior'); // the normal points to the left of travel: (0.6, -0.8); the flat lies there, so out is (-0.6, 0.8)
  const list = pathsFor(made([w], [opening('d', 'a', 'door', 2, 2.7)]));
  assert.equal(list.length, 1);
  const p = list[0];
  near(p.out[0], -0.6); near(p.out[1], 0.8); near(p.width, 0.7);
  near(p.x, w.from[0] + w.dir[0] * 2.35 + p.out[0] * 0.15); near(p.y, w.from[1] + w.dir[1] * 2.35 + p.out[1] * 0.15);
});

test('only outer doors and passages of the ground floor with a low sill get a path; a plan without any gets none and no error', () => {
  const ex = wall('e', [0, 0], [6, 0], 'exterior'), inner = wall('i', [3, 0], [3, 4], 'interior');
  const ops = [opening('p', 'e', 'passage', 0.5, 2.5), opening('hi', 'e', 'door', 3, 3.9, 0.6), opening('w', 'e', 'window', 4, 5), opening('in', 'i', 'door', 1, 1.9)];
  assert.deepEqual(pathsFor(made([ex, inner], ops)).map((p) => p.id), ['p']);
  assert.deepEqual(pathsFor(made([ex, inner], ops.slice(1))), []);
  assert.deepEqual(pathsFor(made([], [])), []);
  assert.deepEqual(pathsFor({ levels: [] }), []);
  assert.deepEqual(pathsFor(null), []);
});

test('doors in walls of different directions each get their own path', () => {
  const list = pathsFor(made([wall('s', [0, 4], [6, 4], 'exterior'), wall('e', [6, 4], [6, 0], 'exterior'), wall('n', [6, 0], [0, 0], 'exterior'), wall('w', [0, 0], [0, 4], 'exterior')],
    [opening('ds', 's', 'door', 1, 2), opening('de', 'e', 'door', 1, 2), opening('dn', 'n', 'door', 1, 2), opening('dw', 'w', 'door', 1, 2)]));
  const dirs = Object.fromEntries(list.map((p) => [p.id, p.out.map((v) => Math.round(v) + 0)]));
  assert.deepEqual(dirs, { ds: [0, 1], de: [1, 0], dn: [0, -1], dw: [-1, 0] }); // clockwise on the plan: the flat lies inside, the normal points in
});

test('the sky and the fog of the three moods are real colours, the horizon and the fog are one colour, and the mood changes them', () => {
  const seen = new Set();
  for (const name of PRESET_NAMES) {
    const s = skyOf(sample(PRESETS[name].t));
    for (const c of [s.top, s.bot, s.glow, s.horizon]) for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 1, name);
    assert.ok(s.ga >= 0 && s.ga <= 1);
    seen.add(s.horizon.getHexString());
  }
  assert.equal(seen.size, 3);
  assert.ok(FOG.near >= 20 && FOG.far < 160 && FOG.far > FOG.near, 'the fog starts beyond the flat and ends before the far plane');
  assert.ok(PATH.width >= 1.2 && PATH.length >= 12);
});

test('the module makes no call to the network and writes nothing in the browser', () => {
  const src = readFileSync(new URL('../../src/render/outside.js', import.meta.url), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|import\(|eval\(|Math\.random/.test(src));
});
