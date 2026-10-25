// The decisions of the page shell (shell.js): start options, the failure card, which parts are built, and the order in which a loaded plan is built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_WEBGL2, hasWebgl2, failureDetail, planChoice, startState, partsOf, buildPlanParts } from '../../src/app/shell.js';
import { parseParams } from '../../src/app/params.js';
import { analyzePlan, modelOf } from '../../src/core/validate.js';
import { buildModel, modelExtent } from '../../src/model/geometry.js';
import { autoFurnish } from '../../src/layout/index.js';
import { piecesImplemented } from '../../src/furniture/index.js';
import { readFileSync } from 'node:fs';

test('hasWebgl2: a canvas with a context passes; a missing context, a throwing probe and a canvas without getContext do not', () => {
  assert.equal(hasWebgl2(() => ({ getContext: (k) => (k === 'webgl2' ? {} : null) })), true);
  assert.equal(hasWebgl2(() => ({ getContext: () => null })), false);
  assert.equal(hasWebgl2(() => { throw new Error('no canvas'); }), false);
  assert.equal(hasWebgl2(() => ({})), false);
  assert.equal(hasWebgl2(() => null), false);
  assert.equal(hasWebgl2(), false);
});

test('failureDetail: the message of an error, else the value as text; the WebGL2 message names WebGL2', () => {
  assert.equal(failureDetail(new Error(NO_WEBGL2)), 'WebGL2 is not available');
  assert.match(NO_WEBGL2, /WebGL2/);
  assert.equal(failureDetail('plain text'), 'plain text');
  assert.equal(failureDetail(undefined), 'undefined');
  assert.equal(failureDetail(null), 'null');
  assert.equal(failureDetail({ message: 'from an object' }), 'from an object');
  assert.equal(failureDetail(42), '42');
});

test('planChoice: the injected plan only with plan=ext, duplex-1 by name, anything else flat-1', () => {
  const of = (hash) => parseParams(hash, {});
  assert.equal(planChoice(of(''), undefined), 'flat-1');
  assert.equal(planChoice(of('#plan=duplex-1'), undefined), 'duplex-1');
  assert.equal(planChoice(of('#plan=flat-1'), {}), 'flat-1', 'an injected plan is ignored without plan=ext');
  assert.equal(planChoice(of('#plan=ext'), { levels: [] }), 'ext');
  assert.equal(planChoice(of('#plan=ext'), undefined), 'flat-1', 'plan=ext without an injected plan opens the default');
  assert.equal(planChoice(of('#plan=gen:42'), undefined), 'flat-1');
  assert.equal(planChoice(of('#plan=nope'), undefined), 'flat-1');
  assert.equal(planChoice(undefined, undefined), 'flat-1');
});

test('startState: the preset, the time, the quality, the language, the buttons and the edit mode come from the address', () => {
  const s = startState(parseParams('#clear&t=0.4&q=low&lang=pl&edit=1', {}));
  assert.deepEqual(s, { preset: 'clear', t: 0.4, q: 'low', lang: 'pl', tools: true, editing: true });
  const d = startState(parseParams('', { language: 'en-GB' }));
  assert.equal(d.tools, true); assert.equal(d.editing, false); assert.equal(d.lang, 'en'); assert.equal(d.q, 'auto');
  assert.equal(startState(parseParams('#btn=0', {})).tools, false);
});

test('partsOf: ui=0 builds no bars, btn=0 hides only the extra buttons, edit=1 adds the edit bar and the sheet', () => {
  const of = (hash) => partsOf(parseParams(hash, {}));
  assert.deepEqual(of(''), { controls: true, tools: true, editBar: false, sheet: false, editing: false });
  assert.deepEqual(of('#ui=0'), { controls: false, tools: false, editBar: false, sheet: false, editing: false });
  assert.deepEqual(of('#btn=0'), { controls: true, tools: false, editBar: false, sheet: false, editing: false });
  assert.deepEqual(of('#edit=1'), { controls: true, tools: true, editBar: true, sheet: true, editing: true });
  assert.deepEqual(of('#edit=1&ui=0'), { controls: false, tools: false, editBar: false, sheet: false, editing: true }, 'the editing gestures stay, the bars do not');
  assert.deepEqual(of('#edit=1&btn=0'), { controls: true, tools: false, editBar: true, sheet: true, editing: true });
  assert.deepEqual(of('#btn=1&ui=1'), of(''), 'btn=1 and ui=1 are the defaults');
});

const real = () => ({ analyzePlan, modelOf, buildModel, modelExtent, makeScene: () => ({ dispose() {} }), autoFurnish, piecesImplemented });
const examplePlan = (name) => JSON.parse(readFileSync(new URL(`../../examples/${name}.plan.json`, import.meta.url), 'utf8'));

test('buildPlanParts: the steps run in a fixed order with a copy of the plan, stripped of furniture, and the input is not touched', () => {
  const log = [], plan = { levels: [{ id: 'L0', furniture: [{ id: 'x' }] }], marker: 1 }, json0 = JSON.stringify(plan);
  const scene = { dispose: () => log.push('dispose') };
  const deps = {
    analyzePlan: (p) => { log.push('analyze'); assert.notEqual(p, plan); assert.deepEqual(p.levels[0].furniture, []); return { p }; },
    modelOf: (r) => { log.push('modelOf'); return r; },
    buildModel: () => { log.push('build'); return { m: 1 }; },
    modelExtent: () => { log.push('extent'); return { e: 1 }; },
    makeScene: () => { log.push('scene'); return scene; },
    autoFurnish: (m, o) => { log.push(`layout seed ${o.seed} types ${o.allowedTypes.join()}`); return { l: 1 }; },
    piecesImplemented: () => ['bed'],
  };
  const out = buildPlanParts(plan, 7, deps);
  assert.deepEqual(log, ['analyze', 'modelOf', 'build', 'extent', 'scene', 'layout seed 7 types bed']);
  assert.deepEqual(out, { model: { m: 1 }, ext: { e: 1 }, scene, layout: { l: 1 } });
  assert.equal(JSON.stringify(plan), json0);
});

test('buildPlanParts: a step that throws gives null, later steps do not run, and a scene that was already built is released', () => {
  const base = { analyzePlan: () => ({}), modelOf: (r) => r, buildModel: () => ({}), modelExtent: () => ({}), piecesImplemented: () => [] };
  let ran = [];
  const failing = (name) => ({ ...base, [name]: () => { throw new Error(name); }, makeScene: name === 'makeScene' ? () => { throw new Error('x'); } : () => { ran.push('scene'); return { dispose: () => ran.push('dispose') }; },
    autoFurnish: name === 'autoFurnish' ? () => { throw new Error('layout'); } : () => { ran.push('layout'); return {}; } });
  for (const name of ['analyzePlan', 'buildModel', 'modelExtent', 'makeScene']) { ran = []; assert.equal(buildPlanParts({ levels: [] }, 1, failing(name)), null, name); assert.deepEqual(ran, [], `nothing after ${name}`); }
  ran = []; assert.equal(buildPlanParts({ levels: [] }, 1, failing('autoFurnish')), null);
  assert.deepEqual(ran, ['scene', 'dispose'], 'the scene built before the layout failed is released');
  assert.equal(buildPlanParts(null, 1, base), null, 'a plan that is not an object');
  assert.equal(buildPlanParts({ levels: 5 }, 1, base), null, 'levels that are not a list');
  assert.equal(buildPlanParts({ levels: [] }, 1, { ...base, makeScene: () => ({}), autoFurnish: () => { throw new Error('x'); } }), null, 'a scene without dispose does not break the clean-up');
});

test('buildPlanParts: the example plan builds a model and a furnished layout (the scene is a stand-in, it needs a browser); the same input gives the same layout; a broken plan gives null', () => {
  const plan = examplePlan('flat-1');
  const a = buildPlanParts(plan, 1, real()), b = buildPlanParts(plan, 1, real());
  assert.ok(a && a.model && a.ext && a.scene && a.layout);
  assert.ok(a.layout.levels.reduce((n, l) => n + l.pieces.length, 0) > 0);
  assert.equal(JSON.stringify(a.layout), JSON.stringify(b.layout));
  a.scene.dispose(); b.scene.dispose();
  assert.equal(buildPlanParts({ version: 1, levels: [{ id: 'L0', rooms: 'nope' }] }, 1, real()), null);
});
