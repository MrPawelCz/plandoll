// How main.js wires Spacer. These read the source (as intro-wiring.test.mjs and plain-card.test.mjs do): the guards that keep the eyes from being moved by the rest of the page, the order in
// which the walk begins and ends, and the hooks cannot run without a browser, so the browser check covers the behaviour and these keep the wiring from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../src/app/main.js', import.meta.url), 'utf8');
const a = main.indexOf('// ---------- Spacer: the flat at eye height'), b = main.indexOf('// ---------- loop: the first N frames');
const block = main.slice(a, b);
const body = (name) => { const i = main.indexOf(name); assert.ok(i >= 0, name); return main.slice(i, i + 700); };

test('the Spacer block is there, before the loop, and keeps the page free of the network and the storage', () => {
  assert.ok(a > 0 && b > a && block.length > 1500);
  assert.ok(main.indexOf('let walkMode = false') < main.indexOf('const recut ='), 'the flag is declared before the first cut');
  assert.ok(main.indexOf('spacer = createSpacerRun({') > main.indexOf('const ui = parts.controls'), 'the run is made once the controls and the camera stand');
  assert.match(main, /import \{ createSpacerRun \} from '\.\/spacerrun\.js';/);
  assert.match(main, /import \{ createSpacerView \} from '\.\/spacerview\.js';/);
});

test('begin puts the eyes on in the order the page needs, end gives back what it took, and each sets the flag before anything else', () => {
  const begin = block.slice(block.indexOf('begin() {'), block.indexOf('end(saved) {')), end = block.slice(block.indexOf('end(saved) {'), block.indexOf('pose(e) {'));
  assert.match(begin, /begin\(\) \{\n\s+walkMode = true;/, 'the flag first: recut and settle read it');
  assert.match(end, /end\(saved\) \{\n\s+walkMode = false;/);
  assert.match(begin, /intro\?\.skip\('api'\)/, 'the intro is left');
  assert.match(begin, /shellSnap\(\)/, 'the shell shuts at once');
  assert.match(begin, /visibleFlags\(ALL, model\.levels\.length\)/, 'every floor shows');
  assert.match(begin, /stage\.setLift\(0\); stage\.setBase\(false\)/, 'the base comes down and the table goes');
  assert.match(begin, /cam\.enabled = false/);
  assert.match(begin, /ps\.setCeilings\(true\); ps\.setWalkShadows\(true\); post\.setEyes\(true\)/);
  assert.match(begin, /camera\.fov = EYES\.fov; camera\.near = EYES\.near; camera\.aspect = W \/ H; camera\.clearViewOffset\(\)/);
  assert.match(block, /const EYES = \{ fov: 70, near: 0\.05 \}/);
  assert.match(begin, /recut\(\); shell\?\.hidePatches\(\); settle\(\);/, 'the walls full height and every piece shown');
  assert.match(end, /post\.setEyes\(false\); stage\.rig\.setFocus\(null\); stage\.setBase\(true\); ps\.setCeilings\(false\); ps\.setWalkShadows\(false\)/, 'the lamps spread over the home again');
  assert.match(block, /pose\(e\) \{[^}]*stage\.rig\.setFocus\(\[e\.x, e\.y, e\.z\]\)/, 'the lamps follow the eyes');
  assert.match(end, /cam\.enabled = true/);
  assert.match(end, /cam\.set\(\{ azimuth: saved\.cam\.azimuth, polar: saved\.cam\.polar, distance: saved\.cam\.distance \}\)/);
  assert.match(end, /setPreset\(saved\.preset, true\); setTime\(saved\.t\)/, 'the mood and the time of day come back');
  assert.match(end, /frameCamera\(\);/, 'the lens, the near plane and the lift of the view from above');
  assert.match(end, /toggleRooms\?\.\(\)/, 'and the list of rooms');
  assert.match(block, /snapshot: \(\) => \(\{ cam: cam\.state, flags: flags\.slice\(\), ext, frameExt, framePts, preset: S\.preset, t: S\.t, rooms: !!S\.rooms \}\)/);
});

test('nothing else may move the eyes: the framing, the controller, the cut, the pieces, the time keys, the shell keys and the taps all stand aside', () => {
  assert.match(body('function frameCamera() {'), /if \(walkMode\) \{ camera\.aspect = W \/ H; camera\.updateProjectionMatrix\(\); stage\.fitBackdrop\(W \/ H\); return; \}/, 'a window that changes shape changes the aspect only');
  assert.match(body('function onCamera(s) {'), /if \(walkMode\) return;/);
  assert.match(main, /const recut = \(\) => \{ if \(walkMode\) \{ applyWallCut\(ps, ext, near, \{ height: \(\) => Infinity \}\); ps\.setCut\(null\); \}/, 'every wall full height, no cap on the tops');
  assert.match(main, /furn\.hidden = walkMode \? showPieces\(furn\.pieces\) : cutawayPieces\(/, 'nothing is hidden for a view');
  assert.match(main, /if \(!walkMode && e\.shiftKey && e\.key === 'ArrowRight'\) setTime\(S\.t \+ 0\.02\); else if \(!walkMode && e\.shiftKey && e\.key === 'ArrowLeft'\)/, 'Shift is the run');
  assert.match(main, /\['1', '2', '3'\]\.includes\(e\.key\)\) setPreset/, 'the moods stay on the keys');
  assert.match(body('const onShellKey = (e) => {'), /if \(walkMode\) return;/);
  assert.match(body('function shellGo(open) {'), /intro\?\.skip\('api'\);\n\s+if \(walkMode\) return;/, 'the shell stays shut');
  assert.match(body('function setFloor(next) {'), /intro\?\.skip\('api'\);\n\s+if \(walkMode\) return floor;/, 'every floor stays on show');
  assert.match(main, /if \(walkMode\) return; \/\/ the camera that picks is the one of the view from above/, 'a tap is a step, not a card');
  assert.match(main, /W = window\.innerWidth; H = window\.innerHeight; frameCamera\(\); coverSeen = cover; post\.resize\(W, H\);/);
});

test('a plan that is loaded ends the walk first; the box that asks for one holds it off; the button gives up its focus; walk=1 begins once the loop runs and the intro is not played', () => {
  assert.match(body('function applyPlan(next) {'), /intro\?\.skip\('api'\);[^\n]*\n\s+spacer\?\.leave\(\);/);
  assert.match(main, /planAsk = true;[^\n]*\n\s+askForText\(/);
  assert.match(main, /\.then\(\(text\) => \{\n\s+planAsk = false;/);
  assert.match(block, /refusal: \(\) => \(params\.edit \? 'edit' : planAsk \? 'loading' : !model\?\.levels\?\.length \? 'no-model' : ''\)/);
  assert.match(main, /onSpacer: \(\) => \{ document\.activeElement\?\.blur\?\.\(\); if \(spacer\?\.active\) spacer\.leave\(\); else spacer\?\.enter\(\); \}/, 'a space on a button presses it: the first space in Spacer must jump');
  assert.ok(main.indexOf('loop.start();') < main.indexOf('if (params.walk) spacer.enter();'), 'after the loop is started');
  assert.match(main, /introWanted\(\{ \.\.\.params, intro: params\.intro && !params\.walk \}/);
});

test('every drawn frame in Spacer steps the walk before it draws and asks for the next one; the test hooks are all there', () => {
  const frame = body('function frame(n) {');
  assert.ok(frame.indexOf('if (walkMode) spacer.frame(t0);') > 0 && frame.indexOf('if (walkMode) spacer.frame(t0);') < frame.indexOf('post.render();'));
  assert.match(main, /if \(walkMode\) redraw\(\); \/\/ Spacer draws every frame/);
  for (const name of ['active', 'enter', 'leave', 'state', 'walkTo', 'walkInput', 'walkUse', 'manualClock', 'advanceTime']) assert.match(block, new RegExp(`window\\.__spacer = \\{[\\s\\S]*\\b${name}\\b`), name);
  assert.doesNotMatch(block, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|import\(/);
});
