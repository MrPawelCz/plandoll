// How main.js and the HTML of the page wire the intro. These read the sources (as plain-card.test.mjs does): the parts that decide whether the editor, the camera and the tools still work as they
// did cannot run without a browser, so the browser check (tools/intro-check.mjs) covers the behaviour and these keep the wiring from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const main = read('src/app/main.js');
const block = main.slice(main.indexOf('// ---------- the intro: the first model builds itself'), main.indexOf("loop = createLoop({ draw: frame"));

test('the intro block exists, runs only when introWanted says so, and is prepared before the loop draws its first frame', () => {
  assert.ok(block.length > 400, 'the block is there, before the loop is created');
  assert.match(block, /if \(introAsk\.run\) \{/);
  assert.match(main, /const introAsk = introWanted\(params, \{ reducedMotion: !!\(typeof matchMedia === 'function' && matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) \}\);/, 'the system setting for less motion is asked');
  assert.match(block, /intro\.begin\(\);/);
  assert.ok(main.indexOf('intro.begin();') < main.indexOf('loop.start();'), 'the empty plan is on the stage before the first frame');
  assert.match(block, /guard: window\.__introNoGuard !== true/, 'only a test tool can switch the frame-rate guard off');
});

test('the pieces stay objects of their own while the intro plays, and are merged when it ends, by the same settle() as on any page', () => {
  assert.match(main, /let introHold = introAsk\.run, intro = null;/);
  assert.match(main, /const merging = params\.merge && !introHold;/);
  assert.match(main, /if \(merging && \(params\.edit \|\| hung\?\.size\)\) \{/);
  assert.match(main, /\} else if \(merging\) \{ furn\.merged = mergeByMaterial\(furn\);/);
  assert.match(block, /finishScene: \(\) => \{ introHold = false; setLift\(1\); cam\.set\(endView\); recut\(\); shell\?\.hidePatches\(\); settle\(\); \}/, 'the camera first, then the cut and the merge for the view the page starts in');
  assert.match(main, /if \(!introHold && !sameSides\(n, near\)\) \{ near = n; recut\(\); shell\?\.hidePatches\(\); settle\(\); \}/, 'the camera of the intro does not cut the walls again for each view');
});

test('the picture glides up to where the page keeps it, and is put exactly there when the intro ends', () => {
  assert.match(block, /const setLift = \(k\) => \{ const l = viewLift \* k; if \(l > 0\) camera\.setViewOffset\(W, H, 0, \(l \* H\) \/ 2, W, H\); else camera\.clearViewOffset\(\); \};/, 'the same call as frameCamera makes, scaled');
  assert.match(block, /finishScene: \(\) => \{ introHold = false; setLift\(1\); cam\.set\(endView\);/);
  assert.match(block, /setLift\(liftAt\(at, \{ readyAt: 1 \}\)\); cam\.set\(cameraAt/, 'the fit is tried with the lift of that moment');
  assert.match(main, /if \(viewLift > 0\) camera\.setViewOffset\(W, H, 0, \(viewLift \* H\) \/ 2, W, H\); else camera\.clearViewOffset\(\);/, 'frameCamera makes the call that the end of the intro repeats');
});

test('the view the intro starts in is taken back until the whole box of the model is in the window', () => {
  assert.match(block, /const introFrom = \(\) => \{/);
  assert.match(block, /cam\.set\(cameraAt\(at, \{ readyAt: 1 \}, from, endView\)\)/, 'the whole way down is tried, not only the first view');
  assert.match(block, /v\.set\(x, y, z\)\.project\(camera\); if \(Math\.abs\(v\.x\) > 1 - bx \|\| Math\.abs\(v\.y\) > 1 - by\) fits = false;/);
  assert.match(block, /from\.distance \*= 1\.05;/);
  assert.match(block, /from: introFrom\(\)/);
});

test('the view the intro ends in is the one the page starts in (a link may name its own), and the first model only gets it', () => {
  assert.match(block, /const endView = \{ azimuth: cam\.state\.azimuth, polar: cam\.state\.polar, distance: cam\.state\.distance \};/);
  assert.match(main, /function applyPlan\(next\) \{\n    intro\?\.skip\('api'\);/, 'a plan loaded or picked ends the intro first');
});

test('whatever else needs the scene ends the intro first: the quality, the floors, the shell, the camera and frame hooks of tools', () => {
  assert.match(main, /function setQ\(q\) \{ intro\?\.skip\('api'\);/);
  assert.match(main, /function setFloor\(next\) \{\n    intro\?\.skip\('api'\);/);
  assert.match(main, /function shellGo\(open\) \{\n    if \(!shell\) return;\n    intro\?\.skip\('api'\);/);
  assert.match(main, /set: \(azimuth, polar\) => \{ intro\?\.skip\('api'\); cam\.set\(\{ azimuth, polar \}\); \}, reset: \(\) => \{ intro\?\.skip\('api'\); cam\.reset\(false\); \}/);
  assert.match(main, /seek: \(p\) => new Promise\(\(resolve\) => \{\n        intro\?\.skip\('api'\);/);
  assert.match(main, /window\.__frame = \(args\) => new Promise\(\(resolve\) => \{\n    intro\?\.skip\('api'\);/);
});

test('a resize of the window (a phone turned on its side) ends the intro first: the view it was to end in belongs to the old window', () => {
  assert.match(main, /const introSize = \[window\.innerWidth, window\.innerHeight\], introSized = \(w, h\) => Math\.abs\(w - introSize\[0\]\) > 1 \|\| Math\.abs\(h - introSize\[1\]\) > introSize\[1\] \* 0\.15;/);
  assert.match(main, /addEventListener\('resize', \(\) => \{ if \(intro\?\.active && introSized\(window\.innerWidth, window\.innerHeight\)\) intro\.skip\('resize'\); W = window\.innerWidth;/, 'a resize that leaves the width and moves the height by less than 15 percent (a phone\'s address bar) is not a new window');
});

test('the page is done (window.__done, the note of a link) after the intro, in a frame that is drawn after it, and the loading icon goes with the first frame', () => {
  const frame = main.slice(main.indexOf('function frame(n) {'), main.indexOf('function luminance()'));
  assert.match(frame, /if \(n === 1\) \{ if \(intro\?\.active\) intro\.shown\(\); else leaveLoading\('done', intro\?\.reason \|\| introAsk\.why \|\| 'off'\); \}/);
  assert.match(frame, /if \(n === params\.frames\) framesDrawn = true;/);
  assert.doesNotMatch(frame, /intro\??\.start\(\)/, 'the clock begins with the first frame (shown), not after the measured ones');
  assert.match(frame, /if \(!intro\?\.active\) \{[\s\S]*sayStartNote\(\)[\s\S]*done\(\);/);
  assert.ok(frame.indexOf('post.render()') < frame.indexOf('done();'), 'done() reads the picture right after a frame is drawn');
  assert.match(main, /const leaveLoading = \(state, why\) => \{ try \{ const b = document\.body; document\.getElementById\('ps-loading'\)\?\.remove\(\); if \(state === 'done' && b\.dataset\.intro === 'playing'\) b\.dataset\.introFade = '1'; b\.dataset\.intro = state; b\.dataset\.introEnd = why; \} catch \{\} \};/);
  assert.match(main, /leaveLoading\('done', 'error'\); try \{ showErrorCard/, 'a page that fails does not keep the icon or hide its bar');
});

test('the test hook says where the intro is and holds it', () => {
  assert.match(main, /window\.__intro = \{ get state\(\)/);
  assert.match(main, /seek: \(t\) => intro\?\.seek\(t\) \?\? Promise\.resolve\(false\)/);
});

test('the new modules use no network and no storage of the browser, and no long dash', () => {
  const long = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const f of ['src/app/intro.js', 'src/app/buildup.js', 'src/app/introview.js', 'src/app/introrun.js']) {
    const src = read(f);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|import\(|eval\(|Math\.random/.test(src), f);
    assert.ok(!long.test(src), `${f}: no long dash`);
  }
  assert.ok(!/\bAI\b/.test(read('src/app/intro.js') + read('src/app/introview.js')), 'the page does not talk about AI');
});

test('the HTML of the page: the loading icon is plain CSS, the body says where the page is, and the bar stays hidden only while it says loading or playing, with a failsafe in the style itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plandoll-wiring-'));
  try {
    const r = spawnSync(process.execPath, [new URL('../../tools/build.mjs', import.meta.url).pathname, '--out', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'plandoll.html'), 'utf8');
    const head = html.slice(0, html.indexOf('<script>'));
    assert.match(head, /<body data-intro="loading"><div id="ps-loading" role="status" aria-label="Loading \/ Wczytywanie"><\/div>/);
    assert.match(head, /#ps-loading\{position:fixed;left:50%;top:50%;z-index:50;width:28px;height:28px;/, 'about 28 px, in the middle');
    assert.match(head, /pointer-events:none;animation:ps-spin \.8s linear infinite,ps-load-off 0s linear 60s forwards\}/, 'it turns, never takes an event, and is gone after 60 s whatever happens');
    assert.match(head, /@media \(prefers-reduced-motion:reduce\)\{#ps-loading\{animation:ps-load-off 0s linear 60s forwards\}\}/, 'a request for less motion stops it turning');
    assert.match(head, /body\[data-intro-fade\] #ps-ui,body\[data-intro-fade\] #ps-hint\{transition:opacity \.45s ease\}/, 'the bar fades in after an intro that played, and shows at once on a page that had none');
    assert.match(head, /body\[data-intro=loading\] #ps-ui,body\[data-intro=loading\] #ps-hint,body\[data-intro=playing\] #ps-ui,body\[data-intro=playing\] #ps-hint\{opacity:0;pointer-events:none\}/);
    assert.match(head, /body\[data-intro=loading\] #ps-ui,body\[data-intro=loading\] #ps-hint\{animation:ps-show-wait 0s linear 90s forwards\}/, 'the bar is back after 90 s of loading...');
    assert.match(head, /body\[data-intro=playing\] #ps-ui,body\[data-intro=playing\] #ps-hint\{animation:ps-show-play 0s linear 40s forwards\}/, '...or 40 s of playing, even if the script never says done (two names: the clock starts over with the state)');
    assert.match(head, /@keyframes ps-show-wait\{to\{opacity:1;pointer-events:auto\}\}@keyframes ps-show-play\{to\{opacity:1;pointer-events:auto\}\}/);
    assert.match(head, /<noscript><style>#ps-loading\{display:none\}<\/style><\/noscript>/, 'and without scripts the icon does not turn for ever');
    assert.equal((html.match(/<script>/g) ?? []).length, 1, 'still one script (the overlay of plandoll.com looks for it)');
    assert.ok(html.includes('<title>plandoll</title>') && html.includes('<link rel="icon" href="data:,">') && html.includes('</head>'), 'the strings the overlay of plandoll.com needs');
    assert.ok(!/[\u2013\u2014]/.test(head));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
