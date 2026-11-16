// How main.js wires the world outside Spacer (the source is read, as spacer-wiring.test.mjs does), the margin of the walk and the parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseParams } from '../../src/app/params.js';
import { setViewParams } from '../../src/app/share.js';
import { createSpacerRun } from '../../src/app/spacerrun.js';
import { fileModel } from '../helpers/walk-model.mjs';

const main = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
const begin = main.slice(main.indexOf('begin() {', main.indexOf('spacer = createSpacerRun')), main.indexOf('end(saved) {', main.indexOf('spacer = createSpacerRun')));
const end = main.slice(main.indexOf('end(saved) {', main.indexOf('spacer = createSpacerRun')), main.indexOf('pose(e) {', main.indexOf('spacer = createSpacerRun')));

test('begin makes the world after the base is down and shows it; end drops it first, so the fog and the background come back', () => {
  assert.ok(begin.indexOf('stage.setBase(false)') < begin.indexOf('createOutside('));
  assert.match(begin, /if \(params\.outside\) \{ outside = createOutside\(\{ scene, camera, model \}\);[^}]*outside\.show\(\); \}/);
  assert.match(end, /walkMode = false;\n\s+outside\?\.dispose\(\); outside = null;/);
  assert.ok(end.indexOf('outside?.dispose()') < end.indexOf('stage.setBase(true)'));
});

test('a change of mood refreshes the sky right after the stage has its new time; the margin is 40 m with the world and 6 m without it', () => {
  assert.match(main, /const k = stage\.applyTime\(S\.t\); post\.setLook\(k\); lastLook = k; outside\?\.setLook\(k\);/);
  assert.match(main, /margin: \(\) => \(params\.outside \? 40 : undefined\)/);
});

test('outside is on by default and off only for outside=0; a link keeps outside=0 with the other choices of the view', () => {
  assert.equal(parseParams('').outside, true);
  assert.equal(parseParams('#outside=0').outside, false);
  assert.equal(parseParams('#outside=1').outside, true);
  assert.equal(parseParams('#outside=false').outside, true, 'only 0 turns it off, as btn=0 and shell=0 do');
  assert.match(setViewParams('#outside=0&walk=1', { preset: 'clear', t: 0.3 }), /outside=0/);
});

test('the world of the walk reaches the margin the host names and 6 m when it names none', () => {
  const model = fileModel('examples/flat-1.plan.json');
  for (const [margin, want] of [[undefined, 6], [40, 40]]) {
    let world = null;
    const host = {
      model: () => model, refusal: () => '', snapshot: () => ({}), begin() {}, end() {}, pose() {}, doors() {}, paint() {}, changed() {}, redraw() {}, now: () => 0, width: () => 800, touchDevice: () => false,
      ...(margin === undefined ? {} : { margin: () => margin }),
    };
    const win = { addEventListener() {}, removeEventListener() {} }, doc = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null, visibilityState: 'visible' };
    const canvas = { addEventListener() {}, removeEventListener() {} };
    const run = createSpacerRun({ host, win, doc, canvas });
    assert.equal(run.enter(), true);
    const b = model.bounds, s = run.state();
    run.walkTo(b.maxX + 100, b.maxY + 100, model.levels[0].id, 0, 0); // as far as the world lets it
    const c = run.state().cam;
    assert.ok(Math.abs(c.z - (b.maxY + want)) < 0.05 || Math.abs(c.x - (b.maxX + want)) < 0.05, `margin ${want}: ${JSON.stringify(c)} ${JSON.stringify(s.cam)}`);
    run.leave();
    world = null;
  }
});

test('in Spacer the bracket keys move the time of day by 0.01 and only in Spacer; the tools can read the time', () => {
  assert.match(main, /else if \(walkMode && \(e\.code === 'BracketRight' \|\| e\.key === '\]'\)\) setTime\(S\.t \+ 0\.01\);/);
  assert.match(main, /else if \(walkMode && \(e\.code === 'BracketLeft' \|\| e\.key === '\['\)\) setTime\(S\.t - 0\.01\);/);
  assert.match(main, /if \(!walkMode && e\.shiftKey && e\.key === 'ArrowRight'\) setTime\(S\.t \+ 0\.02\)/, 'Shift with an arrow is unchanged');
  assert.match(main, /time: \(\) => S\.t,/);
});
