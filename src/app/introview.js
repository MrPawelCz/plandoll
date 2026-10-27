// The skip of the intro (intro.js has the timeline, buildup.js moves the scene). Plain DOM, no three.js, no network, no storage; the styles are one <style id="ps-intro-style">.
// The picture carries no caption: the stage names and the piece counter of the first version are gone (27 October 2026). The only words are "Tap to skip" at the bottom, clear of the
// corners (the control bar is not there while the intro plays, and the marks that a page puts in its corners, the brand and the privacy button of plandoll.com, stay free). A shield covers the whole window while the intro
// plays: the first touch, click, key or turn of the wheel ends the intro and nothing else happens (the shield takes the event, and the click that follows a touch, before the page under it
// could get it). The control bar is hidden by the page's own style while data-intro on the body is "loading" or "playing" (see tools/build.mjs), so it is not here.
import { introText, skipKey, keyLeftAlone } from './intro.js';

export const INTRO_STYLE_ID = 'ps-intro-style';

const CSS = `
#ps-intro{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:"DIN Condensed","Arial Narrow","Avenir Next Condensed",ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;font-weight:700;-webkit-user-select:none;user-select:none}
#ps-intro-shield{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:pointer;background:transparent}
#ps-intro-hint{position:absolute;left:50%;bottom:max(64px,calc(env(safe-area-inset-bottom,0px) + 56px));transform:translateX(-50%);font:600 13px/1.3 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink,#4a3b2a);background:var(--paper,rgba(250,245,234,.84));padding:6px 14px;border-radius:16px;border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 6px 18px rgba(40,28,12,.22);white-space:nowrap;max-width:calc(100vw - 24px);box-sizing:border-box;opacity:0}
`;

// handlers: onSkip(how) is called once, with 'pointer', 'key' or 'wheel', when the visitor skips. Returns the view: show(look) draws what the timeline says, arm() starts listening for the skip,
// end() says the intro is over (the line to skip goes; the shield goes with them, or a moment after a touch that skipped, so that its click does not reach the page), dispose() takes everything away.
export function createIntroView({ doc = document, win = window, lang = 'en', onSkip = () => {} } = {}) {
  if (!doc.getElementById(INTRO_STYLE_ID)) { const s = doc.createElement('style'); s.id = INTRO_STYLE_ID; s.textContent = CSS; doc.head.appendChild(s); }
  const T = introText(lang), L = lang === 'pl' ? 'pl' : 'en';
  const mk = (tag, id, cls) => { const n = doc.createElement(tag); if (id) n.id = id; if (cls) n.className = cls; return n; };
  const root = mk('div', 'ps-intro'), shield = mk('div', 'ps-intro-shield'), hint = mk('div', 'ps-intro-hint');
  root.setAttribute('aria-hidden', 'true'); root.setAttribute('data-lang', L);
  hint.textContent = T.skip;
  root.append(shield, hint);
  doc.body.appendChild(root);

  let armed = false, swallow = false, ended = false, releaseTimer = 0;
  const stop = (e) => { try { e.preventDefault?.(); e.stopImmediatePropagation?.(); } catch { /* an event that cannot be stopped is left alone */ } };
  const skip = (how, e, take = true) => { // take: whether the event is taken (a key of the browser, F5 or Tab, ends the intro and is left to the browser)
    if (!armed) return;
    armed = false; swallow = true; if (take) stop(e);
    clearTimeout(releaseTimer); releaseTimer = setTimeout(() => release(), how === 'wheel' ? 600 : 1500); // a touch that never lifts (or lifts elsewhere) does not hold the shield for good
    onSkip(how);
    if (how === 'key') release(); // a key has no click that follows
  };
  const onDown = (e) => { if (!armed && !swallow) return; if (armed) { skip('pointer', e); return; } stop(e); };
  const onKey = (e) => { if (!armed) return; if (skipKey(e)) skip('key', e, !keyLeftAlone(e)); };
  const onWheel = (e) => { if (armed) skip('wheel', e); else if (swallow) stop(e); };
  const onUp = (e) => { if (!swallow) return; stop(e); clearTimeout(releaseTimer); releaseTimer = setTimeout(() => release(), 450); };
  const onClick = (e) => { if (swallow) stop(e); }; // the click of a touch tap goes to whatever is under the finger: here it goes nowhere
  const onMenu = (e) => { if (armed || swallow) stop(e); };
  const on = [['pointerdown', onDown, true], ['pointerup', onUp, true], ['pointercancel', onUp, true], ['click', onClick, true], ['contextmenu', onMenu, true], ['keydown', onKey, true], ['wheel', onWheel, { capture: true, passive: false }]];

  function arm() { if (armed || ended) return; armed = true; for (const [t, f, o] of on) win.addEventListener(t, f, o); }
  // The shield and the listeners go; the line to skip goes with them when the intro has ended.
  function release() {
    clearTimeout(releaseTimer); swallow = false; armed = false;
    for (const [t, f, o] of on) win.removeEventListener(t, f, o);
    shield.remove();
    if (ended) root.remove();
  }
  // The intro is over: the line to skip goes at once; the shield goes now, or, after a touch that skipped, when that touch has let go (its click would reach the page under it).
  function end() { ended = true; hint.style.display = 'none'; if (!swallow) release(); }
  function dispose() { ended = true; release(); root.remove(); }

  // look: { hint: opacity } (the line to skip fades in and out; nothing else is drawn)
  function show(look) { hint.style.opacity = String(+look.hint.toFixed(3)); }
  return { element: root, shield, arm, show, end, release, dispose, get swallowing() { return swallow; }, get text() { return { hint: T.skip }; } };
}
