// The words and the skip of the intro (intro.js has the timeline, buildup.js moves the scene). Plain DOM, no three.js, no network, no storage; the styles are one <style id="ps-intro-style">.
// The word that names the stage and the counter ("piece 7 of 35") stand in the top right corner, where neither the control bar nor the marks that a page puts in the top left and at
// the bottom left (the brand and the privacy button of plandoll.com) are; "Tap to skip" stands at the bottom, clear of the corners. A shield covers the whole window while the intro
// plays: the first touch, click, key or turn of the wheel ends the intro and nothing else happens (the shield takes the event, and the click that follows a touch, before the page under it
// could get it). The control bar is hidden by the page's own style while data-intro on the body is "loading" or "playing" (see tools/build.mjs), so it is not here.
import { introText, counterText, skipKey, keyLeftAlone } from './intro.js';

export const INTRO_STYLE_ID = 'ps-intro-style';

const CSS = `
#ps-intro{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:"DIN Condensed","Arial Narrow","Avenir Next Condensed",ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;font-weight:700;-webkit-user-select:none;user-select:none}
#ps-intro-shield{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:pointer;background:transparent}
#ps-intro .psi-hud{position:absolute;top:14px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 28px)}
#ps-intro .psi-pill{box-sizing:border-box;padding:.12em .55em .06em;border-radius:.3em;white-space:nowrap;line-height:1.1;transform-origin:right center;font-variant-numeric:tabular-nums;will-change:transform,opacity}
#ps-intro-chip{font-size:clamp(16px,calc(2.4vw + 6px),30px);color:#fff;background:rgba(11,36,71,.82);letter-spacing:.03em}
#ps-intro-count{font-size:clamp(18px,calc(2.8vw + 6px),34px);color:#1d1308;background:#ff9f43}
#ps-intro-hint{position:absolute;left:50%;bottom:max(64px,calc(env(safe-area-inset-bottom,0px) + 56px));transform:translateX(-50%);font:600 13px/1.3 ui-rounded,"SF Pro Rounded","Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink,#4a3b2a);background:var(--paper,rgba(250,245,234,.84));padding:6px 14px;border-radius:16px;border:1px solid var(--line,rgba(120,96,64,.22));box-shadow:0 6px 18px rgba(40,28,12,.22);white-space:nowrap;max-width:calc(100vw - 24px);box-sizing:border-box;opacity:0}
`;

// handlers: onSkip(how) is called once, with 'pointer', 'key' or 'wheel', when the visitor skips. Returns the view: show(look) draws what the timeline says, arm() starts listening for the skip,
// end() says the intro is over (the words go; the shield goes with them, or a moment after a touch that skipped, so that its click does not reach the page), dispose() takes everything away.
export function createIntroView({ doc = document, win = window, lang = 'en', onSkip = () => {} } = {}) {
  if (!doc.getElementById(INTRO_STYLE_ID)) { const s = doc.createElement('style'); s.id = INTRO_STYLE_ID; s.textContent = CSS; doc.head.appendChild(s); }
  const T = introText(lang), L = lang === 'pl' ? 'pl' : 'en';
  const mk = (tag, id, cls) => { const n = doc.createElement(tag); if (id) n.id = id; if (cls) n.className = cls; return n; };
  const root = mk('div', 'ps-intro'), shield = mk('div', 'ps-intro-shield'), hud = mk('div', '', 'psi-hud'), chip = mk('div', 'ps-intro-chip', 'psi-pill'), count = mk('div', 'ps-intro-count', 'psi-pill'), hint = mk('div', 'ps-intro-hint');
  root.setAttribute('aria-hidden', 'true'); root.setAttribute('data-lang', L);
  chip.style.display = 'none'; count.style.display = 'none'; hint.textContent = T.skip;
  hud.append(chip, count); root.append(shield, hud, hint);
  doc.body.appendChild(root);

  let armed = false, swallow = false, ended = false, releaseTimer = 0, chipText = '', countText = '';
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
  // The shield and the listeners go; the words go with them when the intro has ended.
  function release() {
    clearTimeout(releaseTimer); swallow = false; armed = false;
    for (const [t, f, o] of on) win.removeEventListener(t, f, o);
    shield.remove();
    if (ended) root.remove();
  }
  // The intro is over: the words go at once; the shield goes now, or, after a touch that skipped, when that touch has let go (its click would reach the page under it).
  function end() { ended = true; hud.style.display = 'none'; hint.style.display = 'none'; if (!swallow) release(); }
  function dispose() { ended = true; release(); root.remove(); }

  // look: { chip: { text, show, opacity, scale }, count: { show, opacity, scale, n, m }, hint: opacity }
  function show(look) {
    const c = look.chip;
    if (c.show) {
      const text = T.chips[c.key] ?? '';
      if (chipText !== text) { chip.textContent = text; chipText = text; }
      chip.style.display = ''; chip.style.opacity = String(+c.opacity.toFixed(3)); chip.style.transform = `scale(${c.scale.toFixed(4)})`;
    } else chip.style.display = 'none';
    const k = look.count;
    if (k.show) {
      const text = counterText(L, k.n, k.m);
      if (countText !== text) { count.textContent = text; countText = text; }
      count.style.display = ''; count.style.opacity = String(+k.opacity.toFixed(3)); count.style.transform = `scale(${k.scale.toFixed(4)})`;
    } else count.style.display = 'none';
    hint.style.opacity = String(+look.hint.toFixed(3));
  }
  return { element: root, shield, arm, show, end, release, dispose, get swallowing() { return swallow; }, get text() { return { chip: chipText, count: countText, hint: T.skip }; } };
}
