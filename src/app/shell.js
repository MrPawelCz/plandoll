// Decisions of the page shell that need no browser: what the address asks for, which parts of the page are built, what the failure card says and the
// order in which a loaded plan is built. main.js calls these; tests/app/shell.test.mjs runs them in Node.

export const NO_WEBGL2 = 'WebGL2 is not available';

// true when the canvas that makeCanvas returns gives a WebGL2 context; a probe that throws or returns nothing counts as no.
// A key press that lands in a form field (a size box in the panel, a pasted text) belongs to the field, never to the shortcuts of the page.
export function isFormTarget(target) {
  const tag = String(target?.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' || target?.isContentEditable === true;
}

// Whether the page builds the open shell: the button is on (shell=0 takes it away) and the editor is off. The editor needs the closed model (the page reloads
// into edit mode with the walls up), so while editing the button is inactive and the view is framed for the closed model alone.
export function shellOn(params) {
  return !!params?.shell && !params?.edit;
}

// What a key press does to the open shell: Space opens a closed shell and closes an open one, Escape closes an open one; 'open', 'close' or null.
// Keys with Ctrl, Cmd or Alt, keys that land in a form field, and Space on a button or a link (they use it themselves) do nothing. `wantOpen` is true while the
// shell is open or opening. A key that is held down counts once: the repeats of the system do nothing.
export function shellKey(e, wantOpen) {
  if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isFormTarget(e.target)) return null;
  const tag = String(e.target?.tagName ?? '').toLowerCase();
  if (e.key === 'Escape') return wantOpen ? 'close' : null;
  if ((e.key === ' ' || e.code === 'Space') && tag !== 'button' && tag !== 'a') return wantOpen ? 'close' : 'open';
  return null;
}

export function hasWebgl2(makeCanvas) {
  try { return !!makeCanvas()?.getContext?.('webgl2'); } catch { return false; }
}

// The line shown under the failure card for an error: its message (or the value itself when it is not an error), as text.
export function failureDetail(e) {
  return String((e && e.message) || e);
}

// Which plan the page opens: the plan that a test tool injected as window.__plan ('ext'), duplex-1, otherwise flat-1 (a generator name opens flat-1 too).
export function planChoice(params, injected) {
  if (params?.plan?.kind === 'ext' && injected) return 'ext';
  return params?.plan?.name === 'duplex-1' ? 'duplex-1' : 'flat-1';
}

// What the controls show at the start, from the parsed address parameters (the page adds the quality levels). plan: the example the page opens with (null for a
// plan injected by a test tool or a generated one, which no example button stands for); shell: whether the open-shell button is there.
export function startState(params) {
  return { preset: params.preset, t: params.t, q: params.q, lang: params.lang, tools: params.btn, editing: params.edit, shell: !!params.shell, shellOpen: false,
    plan: params.plan?.kind === 'example' ? planChoice(params, null) : null };
}

// Which parts of the page are built. ui=0 leaves the picture alone (no controls, no edit bar, no sheet; the editing gestures still work), btn=0 hides only
// the row of extra buttons, edit=1 adds the edit bar and the sheet.
export function partsOf(params) {
  const ui = !!params.ui;
  return { controls: ui, tools: ui && !!params.btn, editBar: ui && !!params.edit, sheet: ui && !!params.edit, editing: !!params.edit };
}

// Builds everything that a loaded plan needs before the page touches the scene it shows, so a plan that cannot be built leaves the page as it was. The plan
// is copied and stripped of furniture (the layout engine furnishes it). deps: { analyzePlan, modelOf, buildModel, modelExtent, makeScene(model),
// autoFurnish(model, options), piecesImplemented() }. The order is fixed: analyse, model, extent, scene, layout. Returns { model, ext, scene, layout } or null.
export function buildPlanParts(next, seed, deps) {
  let scene = null;
  try {
    const p = JSON.parse(JSON.stringify(next));
    for (const lv of p.levels) lv.furniture = [];
    const res = deps.analyzePlan(p), model = deps.buildModel(deps.modelOf(res)), ext = deps.modelExtent(model);
    scene = deps.makeScene(model);
    const layout = deps.autoFurnish(model, { seed, allowedTypes: deps.piecesImplemented() });
    return { model, ext, scene, layout };
  } catch {
    try { scene?.dispose?.(); } catch { /* the scene is dropped anyway */ }
    return null;
  }
}
