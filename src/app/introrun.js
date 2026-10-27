// The clock of the intro: begins it (the empty plan is put on the stage before the first frame), runs it from the first frame drawn on, and ends it exactly once, whatever ends it:
// the end of the story (reason 'finished'), a touch or a key (the page calls skip: 'skipped'), frames that come too slowly ('slow'), or the failsafe ('timeout'; 'error' when the
// scene could not be prepared, a frame could not be painted or a step of the end threw). It knows nothing of three.js or the DOM: the page hands it what moves the scene (buildup.js), what draws the line to skip (introview.js) and a few
// functions, and a test hands it fakes (src/app/introrun.js is run in Node with a clock of its own).
import { INTRO, hintOpacity, cameraAt, cameraFrom, liftAt, createFpsGuard } from './intro.js';

// deps: { build, view, end ({ azimuth, polar, distance }: the view the page starts in), setCamera(state), render() (draws one frame at once), invalidate() (asks for a frame),
//   nextFrame() (a promise that resolves after the next frame), finishScene() (the page puts its scene in the usual state: merged pieces, walls cut), setState(state, why),
//   setLift(k) (the picture is moved up by k of what the starting view has, 0 to 1; optional), from (the view the camera starts in; cameraFrom(end) when none), guard (false: do not watch the frame rate), request/cancel (requestAnimationFrame and cancelAnimationFrame), setTimeout/clearTimeout }
export function createIntroRun(deps) {
  const { build, view, end, setCamera, render, invalidate, finishScene, setState } = deps;
  const raf = deps.request ?? ((f) => requestAnimationFrame(f)), caf = deps.cancel ?? ((h) => cancelAnimationFrame(h));
  const later = deps.setTimeout ?? ((f, ms) => setTimeout(f, ms)), unlater = deps.clearTimeout ?? ((h) => clearTimeout(h));
  const nextFrame = deps.nextFrame ?? (() => new Promise((r) => raf(() => raf(() => r()))));
  const guard = deps.guard === false ? null : createFpsGuard();
  const from = deps.from ?? cameraFrom(end);
  let state = 'idle', reason = '', how = '', tl = null, t0 = null, rafId = 0, timer = 0, tNow = 0, counts = { placed: 0, total: 0 };

  // the scene and the line to skip at time t (seconds since the clock began)
  function paint(t) {
    counts = build.apply(t);
    setCamera(cameraAt(t, tl, from, end));
    deps.setLift?.(liftAt(t, tl));
    view.show({ hint: hintOpacity(t) });
    tNow = t;
  }

  // Puts the empty plan on the stage, before the first frame is drawn. A frame with everything on show is drawn first (its picture never reaches the screen, the empty plan is put
  // in the same turn): the shaders for the walls, the furniture and the lights are built now, not as the pieces appear. false when the scene could not be prepared (the page then goes on without the intro).
  function begin() {
    try {
      build.prepare(); tl = build.timeline;
      build.apply(tl.total); render();
      paint(0);
      view.arm();
    } catch (e) {
      try { build.finish(); } catch { /* the scene is put right by the page below */ }
      try { view.dispose(); } catch { /* gone anyway */ }
      state = 'done'; reason = 'error';
      try { finishScene(); } catch { /* the page shows what it can */ }
      setState('done', 'error');
      return false;
    }
    state = 'ready';
    timer = later(() => finish('timeout'), INTRO.failsafeS * 1000);
    return true;
  }
  // The first frame is on the screen: the control bar waits, and the clock begins with the next animation frame (t = 0 is the first tick after the first frame, so the story is as long
  // on the screen as it is in the timeline, and the slow frames of a slow device are inside it, not before it). The failsafe starts over from here: a slow first frame (the shaders of a slow device)
  // is not a stuck intro.
  function shown() {
    if (state !== 'ready' || rafId) return;
    state = 'playing'; t0 = null;
    setState('playing');
    unlater(timer); timer = later(() => finish('timeout'), (tl.total + 7) * 1000);
    rafId = raf(tick);
  }
  function tick(ts) {
    rafId = 0;
    if (state !== 'playing') return;
    if (t0 === null) t0 = ts;
    const t = (ts - t0) / 1000;
    if (guard && guard.push(ts)) { finish('slow'); return; }
    if (t >= tl.total) { finish('finished'); return; }
    try { paint(t); invalidate(); } catch { finish('error'); return; } // a frame that cannot be painted ends the intro, it does not freeze it half way
    rafId = raf(tick);
  }

  // Ends the intro once: the scene goes back to what the page always shows, the line to skip and the shield go, the control bar comes back. Every step has a try of its own: nothing can end the intro
  // again once it is 'done', so a step that throws (a box the scene did not expect) must not leave the others undone, with the bar hidden, the camera in the air and the shield up.
  // The page is then told 'error' as the reason.
  function finish(why) {
    if (state === 'done' || state === 'idle') return false;
    state = 'done'; reason = why;
    if (rafId) { caf(rafId); rafId = 0; }
    unlater(timer);
    let failed = false;
    for (const step of [() => build.finish(), () => view.end(), () => finishScene()]) { try { step(); } catch { failed = true; } }
    if (failed) reason = 'error';
    try { setState('done', reason); } catch { /* the page has what it was told */ }
    try { invalidate(); } catch { /* the loop of the page asks again */ }
    return true;
  }
  // A touch, a key or the wheel (how), or anything else that needs the scene as it is: the intro ends now.
  function skip(kind = 'api') {
    if (state === 'done' || state === 'idle') return false; // a late call changes nothing, not even how it ended
    how = kind;
    return finish('skipped');
  }
  // For test tools: puts the story at time t and holds it there (the clock stops); a t at the end ends the intro. Resolves after the frame.
  function seek(t) {
    if (state === 'ready') state = 'playing';
    if (state !== 'playing') return Promise.resolve(false);
    if (rafId) { caf(rafId); rafId = 0; }
    unlater(timer);
    const c = Math.max(0, Math.min(tl.total, Number(t) || 0));
    if (c >= tl.total) finish('finished'); else { paint(c); invalidate(); }
    return nextFrame().then(() => true);
  }

  return { begin, shown, skip, seek, get state() { return state; }, get reason() { return reason; }, get how() { return how; }, get t() { return tNow; }, get total() { return tl?.total ?? 0; }, get counts() { return { ...counts }; },
    get timeline() { return tl; }, get active() { return state === 'ready' || state === 'playing'; } };
}
